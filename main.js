const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog } = require('electron');const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const os = require('os'); 
const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const localtunnel = require('localtunnel'); 
let tunnelProcess = null;

let mainWindow;
let wss = null;
let tunnel = null;
let server = null;

// Generates a 6-character alphanumeric share code (base36: 0-9, a-z)
function generateShareCode() {
    return Math.random().toString(36).substring(2, 8);
}
// Finds your Local Network IP address (e.g., 192.168.1.15)
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}
function createWindow() {
    // 1. Create a local HTTP server so files load via http://localhost (Fixes file:// origin restrictions)
    server = http.createServer((req, res) => {
        let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
        let extname = String(path.extname(filePath)).toLowerCase();
        let mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.ico': 'image/x-icon'
        };
        let contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(data, 'utf-8');
                    });
                } else {
                    res.writeHead(500);
                    res.end('Server error: ' + error.code);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    });

    // 2. Attach WebSocket server to the HTTP server
    wss = new WebSocket.Server({ server });
    wss.on('connection', (ws) => {
        ws.on('message', (message) => {
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(message.toString());
                }
            });
        });

        // Without this, a socket hiccup on ANY one client (e.g. a flaky tunnel
        // connection) throws an unhandled 'error' event, which crashes the whole
        // Electron main process - kicking every connected client, not just the
        // one with the bad connection.
        ws.on('error', (err) => {
            console.error('Client socket error:', err.message);
        });

        ws.on('close', () => {
            console.log('Client disconnected from room');
        });
    });

    // Same failure mode at the server level - guard it too.
    wss.on('error', (err) => {
        console.error('WebSocket server error:', err.message);
    });

  server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log("App is already running! Launching secondary client window.");
        }
    });
    
    server.listen(8080);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#050a06',
        title: "Conflict",
        autoHideMenuBar: true, 
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false 
        }
    });

    // Load via HTTP instead of file:// to satisfy YouTube embed security policies
    mainWindow.loadURL('http://localhost:8080/index.html');

    // NOTE: There used to be a "header spoofing" interceptor here that forced every
    // request to youtube.com/ytimg.com to claim Origin/Referer "https://www.youtube.com" -
    // including the embed iframe's own top-level request, making it look like YouTube was
    // embedding itself inside itself. That's not a real embedding context, and it likely
    // conflicts with the player's own internal requests (config, thumbnails, DRM). Loading
    // over http://localhost:8080 (above) already gives the iframe a legitimate Referer,
    // which is all YouTube actually needs to allow the embed - so this was removed.

    // Screen Share Permission Handler
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }).then((sources) => {
            const serializedSources = sources.map(s => ({
                id: s.id,
                name: s.name,
                thumbnailDataUrl: s.thumbnail.toDataURL()
            }));
            mainWindow.webContents.send('show-screen-picker', serializedSources);

            ipcMain.once('screen-picker-result', (event, sourceId) => {
                if (sourceId) {
                    const selectedSource = sources.find(s => s.id === sourceId);
                    callback({ video: selectedSource, audio: 'loopback' });
                } else {
                    callback(null);
                }
            });
        }).catch(err => {
            console.error('Error getting screen sources:', err);
            callback(null);
        });
    });
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['Bypass-Tunnel-Reminder'] = 'true';
        details.requestHeaders['User-Agent'] = 'conflict-desktop-client';
        callback({ requestHeaders: details.requestHeaders });
    });
}

app.whenReady().then(() => {
    createWindow();

    // Check for updates from GitHub silently in the background
    autoUpdater.checkForUpdatesAndNotify();
});

// Listen for the download to finish, then prompt the user
autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: 'A new version of Conflict has been downloaded! Restart the app to install it?',
        buttons: ['Restart and Install', 'Later']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

app.on('window-all-closed', () => {
    if (tunnelProcess) tunnelProcess.close(); 
    if (server) server.close();
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('start-host', async (event) => {
    let tunnel = null;
    let shareCode = null;
    const lanIp = `${getLocalIp()}:8080`;

    try {
        const maxAttempts = 3;
        for (let i = 0; i < maxAttempts && !tunnel; i++) {
            const code = generateShareCode();
            try {
                tunnel = await new Promise((resolve, reject) => {
                    localtunnel({ port: 8080, subdomain: `conflict-${code}` }, (err, t) => {
                        if (err) reject(err); else resolve(t);
                    });
                });
                shareCode = code; 
            } catch (err) { continue; }
        }
    } catch (err) {
        console.log("No internet or Localtunnel failed. Falling back to Offline LAN Mode.");
    }

    // Send results to renderer (tunnel might be null if offline!)
    event.reply('host-started', {
        fullUrl: tunnel ? tunnel.url : null,
        shareCode: shareCode,
        lanIp: lanIp // Always send the local IP
    });
    
    if (tunnel) {
        tunnelProcess = tunnel;
        tunnel.on('close', () => console.log('Localtunnel closed'));
    }
});