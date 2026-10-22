const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

let wss = null; 
let server = null;
let mqttClient = null;
let currentHostInfo = null;
let pendingOutboundQueue = [];

const recentMessages = new Set();
const RADAR_QUERY_TOPIC = 'conflict-global-radar-v1/query';
const RADAR_RESPONSE_TOPIC = 'conflict-global-radar-v1/response';

function startLocalServer(baseDir) {
    server = http.createServer((req, res) => {
        let cleanUrl = decodeURIComponent(req.url.split('?')[0]);
        let relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
        let filePath = path.join(baseDir, relPath);
        let unpackedPath = filePath.replace('app.asar', 'app.asar.unpacked');

        let extname = String(path.extname(filePath)).toLowerCase();
        let mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wasm': 'application/wasm',
            '.json': 'application/json'
        };
        
        const targetFile = fs.existsSync(unpackedPath) ? unpackedPath : filePath;

        fs.readFile(targetFile, (error, content) => {
            if (error) {
                fs.readFile(path.join(baseDir, 'index.html'), (err, data) => {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(data);
                });
            } else {
                res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' });
                res.end(content);
            }
        });
    });

    wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws) => {
        if (mqttClient && mqttClient.connected && mqttClient.roomTopic) {
            ws.send(JSON.stringify({ action: 'room_ready', roomCode: mqttClient.roomCode }));
        }

        ws.on('message', (msg) => {
            const msgStr = msg.toString();
            
            try {
                const parsed = JSON.parse(msgStr);
                if (currentHostInfo && (parsed.action === 'join' || parsed.action === 'presence')) {
                    if (parsed.username) currentHostInfo.hostName = parsed.username;
                    if (parsed.avatar) currentHostInfo.avatar = parsed.avatar;
                }
            } catch (e) {}

            recentMessages.add(msgStr);
            setTimeout(() => recentMessages.delete(msgStr), 2000);
            
            wss.clients.forEach(client => { 
                if (client !== ws && client.readyState === WebSocket.OPEN) client.send(msgStr); 
            });
            
            if (mqttClient && mqttClient.connected && mqttClient.roomTopic) {
                mqttClient.publish(mqttClient.roomTopic, msgStr, { qos: 0 });
            } else {
                pendingOutboundQueue.push(msgStr);
            }
        });
    });
    
    server.listen(8080, '127.0.0.1');
    return { server, wss };
}

async function joinSwarmRoom(roomCode, isHost = false, hostMeta = {}) {
    return new Promise((resolve) => {
        if (mqttClient) mqttClient.end(true);
        
        const cleanCode = roomCode.trim().toUpperCase();
        const topic = `conflict-room-${cleanCode}`;
        
        currentHostInfo = isHost ? {
            roomCode: cleanCode,
            hostName: hostMeta.hostName || 'Host',
            roomName: hostMeta.roomName || `Sala de ${hostMeta.hostName || 'RPG'}`,
            avatar: hostMeta.avatar || './Banaya.png',
            createdAt: Date.now()
        } : null;

        mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883', {
            keepalive: 30,
            reconnectPeriod: 2000
        });
        mqttClient.roomTopic = topic;
        mqttClient.roomCode = cleanCode;

        mqttClient.on('connect', () => {
            const topicsToSub = [topic];
            if (isHost) topicsToSub.push(RADAR_QUERY_TOPIC);

            mqttClient.subscribe(topicsToSub, () => {
                while (pendingOutboundQueue.length > 0) {
                    const queuedMsg = pendingOutboundQueue.shift();
                    mqttClient.publish(topic, queuedMsg);
                }

                if (wss) {
                    const readyMsg = JSON.stringify({ action: 'room_ready', roomCode: cleanCode });
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) client.send(readyMsg);
                    });
                }

                resolve(cleanCode);
            });
        });

        mqttClient.on('message', (receivedTopic, message) => {
            const msgStr = message.toString();

            if (receivedTopic === RADAR_QUERY_TOPIC && currentHostInfo) {
                try {
                    const query = JSON.parse(msgStr);
                    const replyPayload = JSON.stringify({
                        requesterId: query.requesterId,
                        roomCode: currentHostInfo.roomCode,
                        hostName: currentHostInfo.hostName,
                        roomName: currentHostInfo.roomName,
                        avatar: currentHostInfo.avatar
                    });
                    mqttClient.publish(RADAR_RESPONSE_TOPIC, replyPayload);
                } catch (e) {}
                return;
            }

            if (receivedTopic === topic && wss) {
                if (recentMessages.has(msgStr)) return;

                wss.clients.forEach(client => { 
                    if (client.readyState === WebSocket.OPEN) client.send(msgStr); 
                });
            }
        });
    });
}

function scanOpenRooms(timeoutMs = 2200) {
    return new Promise((resolve) => {
        const scannerClient = mqtt.connect('mqtt://broker.emqx.io:1883');
        const requesterId = Math.random().toString(36).substring(2, 10);
        const foundRooms = new Map();

        const finish = () => {
            try { scannerClient.end(true); } catch (e) {}
            resolve(Array.from(foundRooms.values()));
        };

        const timer = setTimeout(finish, timeoutMs);

        scannerClient.on('connect', () => {
            scannerClient.subscribe(RADAR_RESPONSE_TOPIC, () => {
                scannerClient.publish(RADAR_QUERY_TOPIC, JSON.stringify({
                    action: 'discover',
                    requesterId: requesterId
                }));
            });
        });

        scannerClient.on('message', (topic, message) => {
            if (topic === RADAR_RESPONSE_TOPIC) {
                try {
                    const data = JSON.parse(message.toString());
                    if (data.requesterId === requesterId && data.roomCode) {
                        foundRooms.set(data.roomCode, {
                            roomCode: data.roomCode,
                            hostName: data.hostName || 'Amigo',
                            roomName: data.roomName || `Sala #${data.roomCode}`,
                            avatar: data.avatar || './Banaya.png'
                        });
                    }
                } catch (e) {}
            }
        });

        scannerClient.on('error', () => {
            clearTimeout(timer);
            finish();
        });
    });
}

function stopServer() {
    if (server) server.close();
    if (mqttClient) mqttClient.end(true);
}

module.exports = { startLocalServer, stopServer, joinSwarmRoom, scanOpenRooms };