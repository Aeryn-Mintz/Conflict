const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path'); // Added to resolve parent directory
const { setupUpdater } = require('./updater');
const { startLocalServer, startHostTunnel, stopServer } = require('./server');

let mainWindow;

app.whenReady().then(() => {
    // __dirname is now inside "js/", so we point the server one folder up ('..') to the root
    const rootDir = path.join(__dirname, '..');
    const { lanIp } = startLocalServer(rootDir);

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 900, minHeight: 600,
        backgroundColor: '#050a06', title: "Conflict", autoHideMenuBar: true, 
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    });

    mainWindow.loadURL('http://localhost:8080/index.html');

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

    setupUpdater();
});

app.on('window-all-closed', () => { stopServer(); if (process.platform !== 'darwin') app.quit(); });
