const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execSync } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { startLocalServer, stopServer, joinSwarmRoom, scanOpenRooms } = require('./server');

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check', 'false');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); 

let mainWindow;
let edgeProcess = null;
let myVirtualIp = null;
let lanCheckInterval = null;

const SUPERNODE_ADDR = 'n2n.lucktu.com:10090';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

autoUpdater.setFeedURL({ provider: 'github', owner: 'Aeryn-Mintz', repo: 'conflict' });
autoUpdater.autoDownload = false; 

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

function ensureTapDriverInstalled() {
    if (!isWin) return true;

    try {
        const output = execSync('ipconfig /all', { encoding: 'utf8' });
        if (output.includes('TAP-Windows Adapter')) return true;
    } catch (e) {}

    // Procura tap-windows.exe ou qualquer ficheiro tap-windows*.exe dentro de bin/win
    const winBinDir = resolveBinPath('win');
    let installerPath = path.join(winBinDir, 'tap-windows.exe');

    if (!fs.existsSync(installerPath) && fs.existsSync(winBinDir)) {
        const found = fs.readdirSync(winBinDir).find(f => f.toLowerCase().startsWith('tap-windows') && f.toLowerCase().endsWith('.exe'));
        if (found) installerPath = path.join(winBinDir, found);
    }

    if (fs.existsSync(installerPath)) {
        try {
            execSync(`"${installerPath}" /S`);
            return true;
        } catch (err) {
            console.error('Erro ao instalar driver TAP:', err);
        }
    }
    return false;
}

function startN2NNetwork(roomCode, isHost) {
    stopN2NNetwork();
    ensureTapDriverInstalled();

    const edgePath = isWin 
        ? resolveBinPath('win', 'edge.exe')
        : resolveBinPath('linux', 'edge');

    if (!fs.existsSync(edgePath)) {
        console.warn(`Binário do n2n não encontrado em: ${edgePath}`);
        return null;
    }

    if (isLinux) {
        try { fs.chmodSync(edgePath, '755'); } catch (e) {}
    }

    if (isWin) {
        try {
            execSync(`netsh advfirewall firewall delete rule name="Conflict Virtual LAN"`, { stdio: 'ignore' });
            execSync(`netsh advfirewall firewall add rule name="Conflict Virtual LAN" dir=in action=allow program="${edgePath}" enable=yes`, { stdio: 'ignore' });
            execSync(`netsh advfirewall firewall add rule name="Conflict Virtual LAN Out" dir=out action=allow program="${edgePath}" enable=yes`, { stdio: 'ignore' });
        } catch (e) {}
    }

    if (isHost) {
        myVirtualIp = '10.66.0.1';
    } else {
        const oct4 = Math.floor(Math.random() * 250) + 2;
        myVirtualIp = `10.66.0.${oct4}`;
    }

    const communityName = `cfl_${roomCode.toUpperCase()}`;
    const secretKey = `key_${roomCode.toUpperCase()}_conflict`;

    const args = [
        '-c', communityName,
        '-k', secretKey,
        '-a', myVirtualIp,
        '-l', SUPERNODE_ADDR,
        '-r',
        '-E'
    ];
    if (isLinux) args.push('-f');

    edgeProcess = spawn(edgePath, args, { windowsHide: true });

    // Verifica nas interfaces de rede do sistema quando o IP 10.66.0.x sobe
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

    return myVirtualIp;
}

function stopN2NNetwork() {
    if (lanCheckInterval) {
        clearInterval(lanCheckInterval);
        lanCheckInterval = null;
    }
    if (edgeProcess) {
        try { edgeProcess.kill('SIGTERM'); } catch (e) {}
        edgeProcess = null;
    }
    try {
        if (isWin) {
            execSync('taskkill /F /IM edge.exe /T', { stdio: 'ignore' });
        } else if (isLinux) {
            execSync('pkill -f "edge -c cfl_"', { stdio: 'ignore' });
        }
    } catch (e) {}
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
    const rootDir = fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, '..');
    startLocalServer(rootDir);

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 900, minHeight: 600,
        backgroundColor: '#050a06', title: "Conflict", autoHideMenuBar: true, 
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    });

    mainWindow.loadURL('http://localhost:8080/index.html');

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

    ipcMain.on('start-host', async (event, hostMeta = {}) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const virtualIp = startN2NNetwork(roomCode, true);
        await joinSwarmRoom(roomCode, true, hostMeta);
        event.reply('host-started', { roomCode, virtualIp });
    });

    ipcMain.on('join-room', async (event, roomCode) => {
        const virtualIp = startN2NNetwork(roomCode, false);
        await joinSwarmRoom(roomCode, false);
        event.reply('room-joined', { roomCode, virtualIp });
    });

    ipcMain.on('scan-rooms', async (event) => {
        const rooms = await scanOpenRooms(2200);
        event.reply('scan-rooms-result', rooms);
    });

    ipcMain.handle('get-virtual-ip', () => myVirtualIp);

    ipcMain.on('leave-virtual-lan', () => {
        stopN2NNetwork();
    });
});

ipcMain.handle('manual-update-check', async () => {
    return new Promise((resolve) => {
        autoUpdater.once('update-available', (info) => {
            dialog.showMessageBox(mainWindow, {
                type: 'info', 
                title: 'Atualização Disponível',
                message: `A versão ${info.version} do Conflict está disponível!\n\nDeseja abrir o GitHub para baixar a nova versão?`,
                buttons: ['Sim, abrir o GitHub', 'Não, jogar agora']
            }).then((result) => {
                if (result.response === 0) shell.openExternal('https://github.com/Aeryn-Mintz/Conflict/releases');
                resolve('skipped');
            });
        });
        
        autoUpdater.once('update-not-available', () => resolve('none'));
        autoUpdater.once('error', () => resolve('error'));
        autoUpdater.checkForUpdates().catch(() => resolve('error'));
    });
});

app.on('window-all-closed', () => { 
    stopN2NNetwork();
    stopServer(); 
    if (process.platform !== 'darwin') app.quit(); 
});