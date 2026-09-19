const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { startLocalServer, stopServer, joinSwarmRoom } = require('./server');

// Prevent Chromium from hiding real virtual adapter IPs
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check', 'false');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); 

let mainWindow;

autoUpdater.setFeedURL({ provider: 'github', owner: 'Aeryn-Mintz', repo: 'conflict' });
autoUpdater.autoDownload = false; 

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
    const rootDir = path.join(__dirname, '..');
    const { lanIp } = startLocalServer(rootDir);

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

    // --- HYPERSWARM P2P ROUTES ---
    ipcMain.on('start-host', async (event) => {
        // Generate a random 6-character room code (e.g. A4X9B2)
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await joinSwarmRoom(roomCode);
        event.reply('host-started', { roomCode: roomCode });
    });

    ipcMain.on('join-room', async (event, roomCode) => {
        await joinSwarmRoom(roomCode);
        event.reply('room-joined');
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
    stopServer(); 
    if (process.platform !== 'darwin') app.quit(); 
});