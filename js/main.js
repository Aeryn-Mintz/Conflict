const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { startLocalServer, stopServer, joinSwarmRoom, leaveSwarmRoom, scanOpenRooms, getActiveRoomCode } = require('./server');

// Do not allow repeated launches to create a new Electron process tree each time.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    });
}

process.on('uncaughtException', (err) => {
    console.warn('[Background Warning]:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.warn('[Background Rejection]:', reason);
});

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check', 'false');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); 

let mainWindow = null;
let tray = null;
let edgeProcess = null;
let currentEdgeRoom = null;
let myVirtualIp = null;
let lanCheckInterval = null;
let tapCheckedOnce = false;
let firewallCheckedOnce = false;

const SUPERNODE_ADDR = 'n2n.lucktu.com:10090';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

function buildNetworkKey(roomName, roomCode) {
    const cleanCode = String(roomCode || 'DEFAULT').trim().toUpperCase();
    const slug = String(roomName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    return slug ? `${slug}_${cleanCode}` : cleanCode;
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

function startN2NNetwork(netKey) {
    const cleanKey = String(netKey || 'DEFAULT').trim();
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
        exec(`netsh advfirewall firewall delete rule name="Conflict Virtual LAN" & netsh advfirewall firewall add rule name="Conflict Virtual LAN" dir=in action=allow program="${edgePath}" enable=yes & netsh advfirewall firewall add rule name="Conflict Virtual LAN Out" dir=out action=allow program="${edgePath}" enable=yes`, () => {});
    }

    const communityName = `cfl_${cleanKey}`;
    const secretKey = `key_${cleanKey}_conflict`;

    const args = [
        '-c', communityName,
        '-k', secretKey,
        '-a', myVirtualIp,
        '-l', SUPERNODE_ADDR,
        '-r',
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
        const isUp = Object.values(nets).flat().some(iface => iface && iface.address === myVirtualIp);
        if (isUp) {
            clearInterval(lanCheckInterval);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('n2n-status', 'connected');
            }
        } else if (checks > 15) {
            clearInterval(lanCheckInterval);
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
        const child = edgeProcess;
        edgeProcess = null;

        // Only terminate the edge.exe tree started by this app instance.
        // Image-wide taskkill/pkill can terminate another session's process.
        if (isWin && child.pid) {
            execFile('taskkill', ['/F', '/PID', String(child.pid), '/T'], () => {});
        } else {
            try { child.kill(); } catch (e) {}
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

app.whenReady().then(() => {
    if (!hasSingleInstanceLock) return;

    const rootDir = fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, '..');
    startLocalServer(rootDir);

    const iconPath = path.join(rootDir, 'conflict-logo.png');

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 900, minHeight: 600,
        backgroundColor: '#050a06', title: "Conflict", autoHideMenuBar: true,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
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

    mainWindow.loadURL('http://localhost:8080/index.html');

    mainWindow.webContents.on('did-finish-load', () => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates().catch(() => {});
        }
    });

    ipcMain.on('toggle-startup', (event, enable) => {
        app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath('exe') });
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }).then((sources) => {
            mainWindow.webContents.send('show-screen-picker', sources.map(s => ({ id: s.id, name: s.name, thumbnailDataUrl: s.thumbnail.toDataURL() })));
            ipcMain.once('screen-picker-result', (event, sourceId) => {
                callback(sourceId ? { video: sources.find(s => s.id === sourceId), audio: 'loopback' } : null);
            });
        }).catch(() => callback(null));
    });

    ipcMain.on('connect-network', async (event, netMeta = {}) => {
        const roomCode = (netMeta.roomCode || 'DEFAULT').trim().toUpperCase();
        const netKey = buildNetworkKey(netMeta.roomName, roomCode);
        const virtualIp = startN2NNetwork(netKey);
        await joinSwarmRoom(roomCode, true, { ...netMeta, netKey, virtualIp });
        updateTrayMenu();
        event.reply('room-joined', { roomCode, virtualIp });
    });

    ipcMain.handle('ensure-network', async (event, netMeta = {}) => {
        const roomCode = (netMeta.roomCode || 'DEFAULT').trim().toUpperCase();
        const netKey = buildNetworkKey(netMeta.roomName, roomCode);
        const virtualIp = startN2NNetwork(netKey);
        await joinSwarmRoom(roomCode, true, { ...netMeta, netKey, virtualIp });
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
        const rooms = await scanOpenRooms(2200);
        event.reply('scan-rooms-result', rooms);
    });

    ipcMain.handle('get-virtual-ip', () => myVirtualIp || getOrCreatePersistentLanIp());

    ipcMain.on('leave-virtual-lan', () => {
        stopN2NNetwork();
        leaveSwarmRoom();
        updateTrayMenu();
    });
});

let appCleanupStarted = false;
function cleanupAppResources() {
    if (appCleanupStarted) return;
    appCleanupStarted = true;

    stopN2NNetwork();
    leaveSwarmRoom();
    stopServer();

    if (tray) {
        try { tray.destroy(); } catch (e) {}
        tray = null;
    }
}

app.on('before-quit', () => {
    app.isQuiting = true;
    cleanupAppResources();
});

app.on('window-all-closed', () => { 
    if (app.isQuiting) {
        stopN2NNetwork();
        stopServer(); 
        if (process.platform !== 'darwin') app.quit(); 
    }
});