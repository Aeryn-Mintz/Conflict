const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const localtunnel = require('localtunnel');

let wss = null; let server = null; let tunnelProcess = null;

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    let lanIp = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (iface.address.startsWith('26.')) return iface.address; 
                lanIp = iface.address;
            }
        }
    }
    return lanIp;
}

function startLocalServer(baseDir) {
    server = http.createServer((req, res) => {
        let filePath = path.join(baseDir, req.url === '/' ? 'index.html' : req.url);
        let extname = String(path.extname(filePath)).toLowerCase();
        let mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
        
        fs.readFile(filePath, (error, content) => {
            if (error) {
                fs.readFile(path.join(baseDir, 'index.html'), (err, data) => {
                    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data, 'utf-8');
                });
            } else {
                res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' }); res.end(content, 'utf-8');
            }
        });
    });

    wss = new WebSocket.Server({ server });
    wss.on('connection', (ws) => {
        ws.on('message', (msg) => {
            wss.clients.forEach(client => { if (client !== ws && client.readyState === WebSocket.OPEN) client.send(msg.toString()); });
        });
        ws.on('error', (err) => console.error('Client socket error:', err.message));
    });
    
    // 0.0.0.0 força a liberação da porta para a Internet
    server.listen(8080, '0.0.0.0');
    return { server, wss, lanIp: `${getLocalIp()}:8080` };
}

async function startHostTunnel() {
    let tunnel = null; let shareCode = null;
    for (let i = 0; i < 3 && !tunnel; i++) {
        const code = Math.random().toString(36).substring(2, 8);
        try {
            tunnel = await localtunnel({ port: 8080, subdomain: `conflict-${code}` });
            shareCode = code;
        } catch (err) { continue; }
    }
    if (tunnel) {
        tunnelProcess = tunnel;
        tunnel.on('error', (err) => console.log('Tunnel error:', err));
    }
    return { fullUrl: tunnel ? tunnel.url : null, shareCode };
}

function stopServer() {
    if (tunnelProcess) tunnelProcess.close();
    if (server) server.close();
}
module.exports = { startLocalServer, startHostTunnel, stopServer };