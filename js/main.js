const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, exec } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { startLocalServer, stopServer, joinSwarmRoom, leaveSwarmRoom, scanOpenRooms, getActiveRoomCode } = require('./server');

process.on('uncaughtException', (err) => {
    console.warn('[Background Warning]:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.warn('[Background Rejection]:', reason);
});

// Mantém o serviço de áudio em processo separado nativo (evita "Not Responding") e desativa captura de teclas de mídia
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check', 'false');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let tray = null;
let edgeProcess = null;
let currentEdgeRoom = null;
let myVirtualIp = null;
let lanCheckInterval = null;
let tapCheckedOnce = false;
let firewallCheckedOnce = false;

// TRAVA DE INSTÂNCIA ÚNICA (Single Instance Lock):
// Se o Conflict já estiver aberto (ou minimizado na bandeja), foca a janela existente e fecha a nova tentativa imediatamente!
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.exit(0);
} else {
    app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (!mainWindow.isVisible()) mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

const SUPERNODE_ADDR = 'n2n.lucktu.com:10090';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

function cleanRoomCode(roomCode, roomName) {
    let code = String(roomCode || 'DEFAULT').trim().toUpperCase();
    if (code.includes('|')) code = code.split('|').pop().trim().toUpperCase();
    if ((!code || code === 'DEFAULT') && roomName && String(roomName).includes('|')) {
        code = String(roomName).split('|').pop().trim().toUpperCase();
    }
    return code.replace(/[^A-Z0-9-]/g, '') || 'DEFAULT';
}

autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Aeryn-Mintz',
    repo: 'conflict'
});
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update_available', info.version);
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download_progress', Math.round(progressObj.percent));
    }
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update_downloaded', info.version);
    }
});

autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater]:', err.message);
});

ipcMain.on('restart_app', () => {
    app.isQuiting = true;
    stopN2NNetwork();
    stopServer();
    setImmediate(() => {
        app.removeAllListeners('window-all-closed');
        autoUpdater.quitAndInstall(true, true);
    });
});

function resolveBinPath(...segments) {
    const candidates = [
        process.resourcesPath ? path.join(process.resourcesPath, 'bin', ...segments) : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', ...segments) : null,
        path.join(__dirname, '..', 'bin', ...segments),
        path.join(__dirname, 'bin', ...segments)
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return candidates[0];
}

function ensureTapDriverInstalledAsync() {
    if (!isWin || tapCheckedOnce) return;
    tapCheckedOnce = true;

    exec('ipconfig /all', (err, stdout) => {
        if (!err && stdout && stdout.includes('TAP-Windows Adapter')) return;

        const winBinDir = resolveBinPath('win');
        let installerPath = path.join(winBinDir, 'tap-windows.exe');

        if (!fs.existsSync(installerPath) && fs.existsSync(winBinDir)) {
            const found = fs.readdirSync(winBinDir).find(f => f.toLowerCase().startsWith('tap-windows') && f.toLowerCase().endsWith('.exe'));
            if (found) installerPath = path.join(winBinDir, found);
        }

        if (fs.existsSync(installerPath)) {
            exec(`"${installerPath}" /S`, () => {});
        }
    });
}

function getOrCreatePersistentLanIp() {
    const ipFile = path.join(app.getPath('userData'), 'conflict-lan-ip.txt');
    try {
        if (fs.existsSync(ipFile)) {
            const saved = fs.readFileSync(ipFile, 'utf8').trim();
            if (/^10\.66\.0\.\d+$/.test(saved)) return saved;
        }
    } catch (e) {}

    const oct4 = Math.floor(Math.random() * 240) + 10;
    const generatedIp = `10.66.0.${oct4}`;
    try { fs.writeFileSync(ipFile, generatedIp, 'utf8'); } catch (e) {}
    return generatedIp;
}

function updateTrayMenu() {
    if (!tray) return;
    const activeCode = getActiveRoomCode();
    const netLabel = activeCode
        ? `🟢 Network: #${activeCode} (${myVirtualIp || '10.66.0.x'})`
        : `⚪ Network: Disconnected`;

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Conflict P2P & Virtual LAN', enabled: false },
        { label: netLabel, enabled: false },
        { type: 'separator' },
        {
            label: '🖥️ Open Conflict',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '🔌 Disconnect Virtual LAN',
            enabled: !!activeCode,
            click: () => {
                stopN2NNetwork();
                leaveSwarmRoom();
                updateTrayMenu();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('network-disconnected');
                }
            }
        },
        { type: 'separator' },
        {
            label: '❌ Quit Conflict',
            click: () => {
                app.isQuiting = true;
                stopN2NNetwork();
                stopServer();
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function startN2NNetwork(roomCode) {
    const cleanKey = cleanRoomCode(roomCode);
    myVirtualIp = getOrCreatePersistentLanIp();

    if (edgeProcess && currentEdgeRoom === cleanKey) {
        updateTrayMenu();
        return myVirtualIp;
    }

    stopN2NNetwork();
    ensureTapDriverInstalledAsync();

    const edgePath = isWin 
        ? resolveBinPath('win', 'edge.exe')
        : resolveBinPath('linux', 'edge');

    if (!fs.existsSync(edgePath)) {
        console.warn(`Binário do n2n não encontrado em: ${edgePath}`);
        return myVirtualIp;
    }

    if (isLinux) {
        try { fs.chmodSync(edgePath, '755'); } catch (e) {}
    }

    if (isWin && !firewallCheckedOnce) {
        firewallCheckedOnce = true;
        const appExe = process.execPath;
        exec(
            `netsh advfirewall firewall delete rule name="Conflict Virtual LAN" & ` +
            `netsh advfirewall firewall add rule name="Conflict Virtual LAN" dir=in action=allow program="${edgePath}" profile=any enable=yes & ` +
            `netsh advfirewall firewall add rule name="Conflict Virtual LAN Out" dir=out action=allow program="${edgePath}" profile=any enable=yes & ` +
            `netsh advfirewall firewall delete rule name="Conflict WebRTC App" & ` +
            `netsh advfirewall firewall add rule name="Conflict WebRTC App" dir=in action=allow program="${appExe}" profile=any enable=yes`,
            () => {}
        );
    }

    const communityName = `cfl_${cleanKey}`;
    const secretKey = `key_${cleanKey}_conflict`;

    const args = [
        '-c', communityName,
        '-k', secretKey,
        '-a', myVirtualIp,
        '-l', SUPERNODE_ADDR,
        '-E'
    ];
    if (isLinux) args.push('-f');

    try {
        edgeProcess = spawn(edgePath, args, { windowsHide: true });
        currentEdgeRoom = cleanKey;

        edgeProcess.on('exit', () => {
            if (currentEdgeRoom === cleanKey) {
                edgeProcess = null;
                currentEdgeRoom = null;
            }
        });
    } catch (e) {}

    let checks = 0;
    lanCheckInterval = setInterval(() => {
        checks++;
        const nets = os.networkInterfaces();
        let foundIfaceName = null;
        for (const [name, list] of Object.entries(nets)) {
            if (list && list.some(iface => iface && iface.address === myVirtualIp)) {
                foundIfaceName = name;
                break;
            }
        }
        if (foundIfaceName) {
            clearInterval(lanCheckInterval);
            lanCheckInterval = null;
            if (isWin) {
                exec(`netsh interface ipv4 set interface "${foundIfaceName}" metric=25`, () => {});
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('n2n-status', 'connected');
            }
        } else if (checks > 10) {
            clearInterval(lanCheckInterval);
            lanCheckInterval = null;
        }
    }, 1000);

    updateTrayMenu();
    return myVirtualIp;
}

function stopN2NNetwork() {
    if (lanCheckInterval) {
        clearInterval(lanCheckInterval);
        lanCheckInterval = null;
    }
    currentEdgeRoom = null;
    if (edgeProcess) {
        try { edgeProcess.kill(); } catch (e) {}
        edgeProcess = null;
        if (isWin) {
            exec('taskkill /F /IM edge.exe /T', () => {});
        } else if (isLinux) {
            exec('pkill -f "edge -c cfl_"', () => {});
        }
    }
    updateTrayMenu();
}

ipcMain.on('download-radmin', () => {
    const dest = path.join(app.getPath('temp'), 'Radmin_VPN_1.4.exe');
    const file = fs.createWriteStream(dest);
    https.get('https://www.radmin-vpn.com/download/download.php', (response) => {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            shell.openPath(dest); 
        });
    });
});

ipcMain.on('toggle-startup', (event, enable) => {
    app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath('exe') });
});

ipcMain.on('connect-network', async (event, netMeta = {}) => {
    const roomCode = cleanRoomCode(netMeta.roomCode, netMeta.roomName);
    const virtualIp = startN2NNetwork(roomCode);
    await joinSwarmRoom(roomCode, true, { ...netMeta, roomCode, virtualIp });
    updateTrayMenu();
    event.reply('room-joined', { roomCode, virtualIp });
});

ipcMain.handle('ensure-network', async (event, netMeta = {}) => {
    const roomCode = cleanRoomCode(netMeta.roomCode, netMeta.roomName);
    const virtualIp = startN2NNetwork(roomCode);
    await joinSwarmRoom(roomCode, true, { ...netMeta, roomCode, virtualIp });
    updateTrayMenu();
    return { roomCode, virtualIp };
});

ipcMain.handle('get-network-status', () => {
    return {
        activeRoomCode: getActiveRoomCode(),
        virtualIp: myVirtualIp || getOrCreatePersistentLanIp()
    };
});

ipcMain.on('scan-rooms', async (event) => {
    const rooms = await scanOpenRooms(2000);
    event.reply('scan-rooms-result', rooms);
});

ipcMain.handle('get-virtual-ip', () => myVirtualIp || getOrCreatePersistentLanIp());

ipcMain.on('leave-virtual-lan', () => {
    stopN2NNetwork();
    leaveSwarmRoom();
    updateTrayMenu();
});

app.whenReady().then(() => {
    const rootDir = fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, '..');
    startLocalServer(rootDir);

    const iconPath = path.join(rootDir, 'conflict-logo.png');

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 900, minHeight: 600,
        backgroundColor: '#050a06', title: "Conflict", autoHideMenuBar: true,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            // IMPORTANTE: false impede que o Windows congele a janela quando minimizada ou em segundo plano!
            backgroundThrottling: false
        }
    });

    if (fs.existsSync(iconPath)) {
        try {
            tray = new Tray(iconPath);
            tray.setToolTip('Conflict — Virtual LAN & Studio Voice');
            tray.on('click', () => {
                if (mainWindow) {
                    if (mainWindow.isVisible()) mainWindow.focus();
                    else mainWindow.show();
                }
            });
            updateTrayMenu();
        } catch (e) {
            console.warn('Tray init error:', e);
        }
    }

    mainWindow.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }).then((sources) => {
            mainWindow.webContents.send('show-screen-picker', sources.map(s => ({ id: s.id, name: s.name, thumbnailDataUrl: s.thumbnail.toDataURL() })));
            ipcMain.once('screen-picker-result', (event, sourceId) => {
                callback(sourceId ? { video: sources.find(s => s.id === sourceId), audio: 'loopback' } : null);
            });
        }).catch(() => callback(null));
    });

    mainWindow.loadURL('http://localhost:8080/index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.webContents.on('did-finish-load', () => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates().catch(() => {});
        }
    });
});

app.on('before-quit', () => {
    app.isQuiting = true;
});

app.on('window-all-closed', () => { 
    if (app.isQuiting) {
        stopN2NNetwork();
        stopServer(); 
        if (process.platform !== 'darwin') app.quit(); 
    }
});