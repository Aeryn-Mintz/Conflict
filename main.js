const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const localtunnel = require('localtunnel'); // ADD THIS LINE
let tunnelProcess = null;

let mainWindow;
let wss = null;
let tunnel = null;
let server = null;

// Generates a 6-character alphanumeric share code (base36: 0-9, a-z)
function generateShareCode() {
    return Math.random().toString(36).substring(2, 8);
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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (tunnelProcess) tunnelProcess.close(); // Close localtunnel properly
    if (server) server.close();
    if (process.platform !== 'darwin') app.quit();
});
ipcMain.on('start-host', async (event) => {
    try {
        let tunnel = null;
        let shareCode = null;
        const maxAttempts = 5;
        
        // Try up to 5 times to get our preferred subdomain format
        for (let i = 0; i < maxAttempts && !tunnel; i++) {
            const code = generateShareCode();
            
            try {
                // Try our preferred format: conflict-<code>
                tunnel = await new Promise((resolve, reject) => {
                    localtunnel({ 
                        port: 8080, 
                        subdomain: `conflict-${code}` 
                    }, (err, t) => {
                        if (err) reject(err);
                        else resolve(t);
                    });
                });
                shareCode = code; // We know this code worked
            } catch (err) {
                try {
                    // Fallback: just <code> as subdomain
                    tunnel = await new Promise((resolve, reject) => {
                        localtunnel({ 
                            port: 8080, 
                            subdomain: code 
                        }, (err, t) => {
                            if (err) reject(err);
                            else resolve(t);
                        });
                    });
                    shareCode = code; // We know this code worked
                } catch (err2) {
                    // Both formats failed, try next code
                    continue;
                }
            }
        }
        
        // If we still don't have a tunnel after 5 attempts, let localtunnel choose
        if (!tunnel) {
            tunnel = await new Promise((resolve, reject) => {
                localtunnel({ port: 8080 }, (err, t) => {
                    if (err) reject(err);
                    else resolve(t);
                });
            });
            // Extract a share code from the random subdomain (best effort)
            try {
                const url = new URL(tunnel.url);
                const hostname = url.hostname;
                // Extract alphanumeric sequence from subdomain
                const match = hostname.match(/[a-z0-9]+/i);
                shareCode = match ? match[0].substring(0, 6).toLowerCase() : 
                           Math.random().toString(36).substring(2, 8);
            } catch (e) {
                shareCode = generateShareCode(); // Last resort
            }
        }
        
        // Send results to renderer
        event.reply('host-started', {
            fullUrl: tunnel.url,
            shareCode: shareCode // What to share with friends (6-char alphanumeric)
        });
        
        // Store tunnel reference for cleanup
        tunnelProcess = tunnel;
        tunnel.on('close', () => console.log('Localtunnel closed'));
        
    } catch (err) {
        console.error("Hosting failed:", err);
        event.reply('host-failed', err.message);
    }
});

// Update the cleanup code (around lines 115-118) to:
app.on('window-all-closed', () => {
    if (tunnelProcess) tunnelProcess.close(); // Close localtunnel properly
    if (server) server.close();
    if (process.platform !== 'darwin') app.quit();
});
