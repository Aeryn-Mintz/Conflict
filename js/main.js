const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { startLocalServer, startHostTunnel, stopServer } = require('./server');

let mainWindow;

autoUpdater.setFeedURL({ provider: 'github', owner: 'Aeryn-Mintz', repo: 'conflict' });
autoUpdater.autoDownload = false; 

app.whenReady().then(() => {
    const rootDir = path.join(__dirname, '..');
    const { lanIp } = startLocalServer(rootDir);

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 900, minHeight: 600,
        backgroundColor: '#050a06', title: "Conflict", autoHideMenuBar: true, 
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    });

    mainWindow.loadURL('http://localhost:8080/index.html');
    autoUpdater.checkForUpdates();

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

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['Bypass-Tunnel-Reminder'] = 'true';
        callback({ requestHeaders: details.requestHeaders });
    });

    ipcMain.on('start-host', async (event) => {
        const { fullUrl, shareCode } = await startHostTunnel();
        event.reply('host-started', { fullUrl, shareCode, lanIp });
    });
});

autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização Disponível',
        message: `A versão ${info.version} do Conflict está disponível! Deseja baixar e instalar agora? (Arquivo de 106MB)`,
        buttons: ['Sim, atualizar agora', 'Não, pular']
    }).then((result) => {
        if (result.response === 0) {
            if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloading', msg: 'Baixando atualização (isso pode demorar)...' });
            autoUpdater.downloadUpdate();
        } else {
            // Cancela e permite o usuário jogar
            if (mainWindow) {
                mainWindow.webContents.send('update-status', { status: 'none' });
                mainWindow.webContents.send('update-cancelled');
            }
        }
    });
});

autoUpdater.on('update-not-available', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { status: 'none' });
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) mainWindow.webContents.send('update-progress', progressObj.percent);
});

autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloading', msg: 'Reiniciando para instalar...' }); 
    autoUpdater.quitAndInstall();
});

app.on('window-all-closed', () => { 
    stopServer(); 
    if (process.platform !== 'darwin') app.quit(); 
});

// Responde ao Launcher EXATAMENTE o que ocorreu no background
ipcMain.handle('manual-update-check', async () => {
    return new Promise((resolve) => {
        const cleanup = () => {
            autoUpdater.removeAllListeners('update-not-available');
            autoUpdater.removeAllListeners('update-available');
            autoUpdater.removeAllListeners('error');
        };
        autoUpdater.once('update-not-available', () => { cleanup(); resolve('clear'); });
        autoUpdater.once('update-available', () => { cleanup(); resolve('update-found'); });
        autoUpdater.once('error', () => { cleanup(); resolve('error'); });
        
        autoUpdater.checkForUpdates().catch(() => { cleanup(); resolve('error'); });
    });
});