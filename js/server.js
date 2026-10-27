const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

let wss = null; 
let server = null;
let mqttClients = [];
let currentRoomCode = null;
let currentRoomTopic = 'conflict-room-DEFAULT';
let currentHostInfo = null;
let pendingOutboundQueue = [];

const recentMessages = new Set();
const RADAR_QUERY_TOPIC = 'conflict-global-radar-v1/query';
const RADAR_RESPONSE_TOPIC = 'conflict-global-radar-v1/response';

const MESH_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'ws://broker.emqx.io:8083/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'ws://broker.hivemq.com:8000/mqtt'
];

function rememberMessage(msgStr) {
    recentMessages.add(msgStr);
    setTimeout(() => recentMessages.delete(msgStr), 1200);
}

function publishToMesh(topic, msgStr, maxCopies = Infinity) {
    let sentCount = 0;

    for (const client of mqttClients) {
        if (!client || !client.connected) continue;

        try {
            client.publish(topic, msgStr, { qos: 0 });
            sentCount++;

            // High-frequency voice frames do not need to be mirrored to every
            // broker. Keep limited redundancy while avoiding a 4x bandwidth multiplier.
            if (sentCount >= maxCopies) break;
        } catch (e) {}
    }

    return sentCount > 0;
}

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
        const isAnyConnected = mqttClients.some(c => c && c.connected);
        if (isAnyConnected && currentRoomCode) {
            ws.send(JSON.stringify({ action: 'room_ready', roomCode: currentRoomCode }));
        }

        ws.on('message', (msg) => {
            const msgStr = msg.toString();
            let isVoiceFrame = false;

            try {
                const parsed = JSON.parse(msgStr);
                isVoiceFrame = parsed.action === 'voice_frame';
                if (currentHostInfo && (parsed.action === 'join' || parsed.action === 'presence')) {
                    if (parsed.userId) currentHostInfo.userId = parsed.userId;
                    if (parsed.username) currentHostInfo.hostName = parsed.username;
                    if (parsed.virtualIp) currentHostInfo.virtualIp = parsed.virtualIp;
                }
            } catch (e) {}

            rememberMessage(msgStr);
            
            wss.clients.forEach(client => { 
                if (client !== ws && client.readyState === WebSocket.OPEN) client.send(msgStr); 
            });
            
            // Voice is latency- and bandwidth-sensitive: mirror it to at most two brokers.
            // Other control/chat messages retain the existing multi-broker redundancy.
            const sent = publishToMesh(currentRoomTopic, msgStr, isVoiceFrame ? 2 : Infinity);

            if (!sent && !isVoiceFrame && pendingOutboundQueue.length < 30) {
                pendingOutboundQueue.push(msgStr);
            }
        });
    });
    
    server.on('error', () => {});
    server.listen(8080, '127.0.0.1');
    return { server, wss };
}

function clearMeshClients() {
    mqttClients.forEach(client => {
        try { client.removeAllListeners(); client.end(true); } catch (e) {}
    });
    mqttClients = [];
}

function leaveSwarmRoom() {
    currentRoomCode = null;
    currentRoomTopic = 'conflict-room-DEFAULT';
    currentHostInfo = null;
    pendingOutboundQueue = [];
    clearMeshClients();
}

function getActiveRoomCode() {
    return currentRoomCode;
}

async function joinSwarmRoom(roomCode, isHost = true, hostMeta = {}) {
    const cleanCode = String(roomCode || 'DEFAULT').trim().toUpperCase();
    const slug = String(hostMeta.roomName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    const topicKey = hostMeta.netKey || (slug ? `${slug}_${cleanCode}` : cleanCode);
    const topic = `conflict-room-${topicKey}`;

    if (currentHostInfo) {
        if (hostMeta.hostName) currentHostInfo.hostName = hostMeta.hostName;
        if (hostMeta.roomName) currentHostInfo.roomName = hostMeta.roomName;
        if (hostMeta.virtualIp) currentHostInfo.virtualIp = hostMeta.virtualIp;
        if (hostMeta.userId) currentHostInfo.userId = hostMeta.userId;
    } else {
        currentHostInfo = {
            roomCode: cleanCode,
            userId: hostMeta.userId || ('bg_' + Math.random().toString(36).slice(2, 10)),
            hostName: hostMeta.hostName || 'Player',
            roomName: hostMeta.roomName || `Network #${cleanCode}`,
            virtualIp: hostMeta.virtualIp || '10.66.0.x',
            avatar: './Banaya.png',
            createdAt: Date.now()
        };
    }

    if (currentRoomTopic === topic && mqttClients.length > 0) {
        if (mqttClients.some(c => c && c.connected) && wss) {
            const readyMsg = JSON.stringify({ action: 'room_ready', roomCode: cleanCode });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(readyMsg);
            });
        }
        return cleanCode;
    }

    clearMeshClients();
    currentRoomCode = cleanCode;
    currentRoomTopic = topic;

    MESH_BROKERS.forEach((brokerUrl) => {
        let client;
        try {
            client = mqtt.connect(brokerUrl, {
                clientId: `cfl_${cleanCode}_${Math.random().toString(16).slice(2, 10)}`,
                protocolVersion: 4,
                keepalive: 25,
                connectTimeout: 8000,
                reconnectPeriod: 3000,
                clean: true
            });
        } catch (err) {
            return;
        }

        client.on('error', () => {});

        client.on('connect', () => {
            const subs = [topic, RADAR_QUERY_TOPIC];

            client.subscribe(subs, { qos: 0 }, (err) => {
                if (err) return;

                pendingOutboundQueue.forEach(queuedMsg => {
                    try { client.publish(topic, queuedMsg, { qos: 0 }); } catch (e) {}
                });

                if (currentHostInfo) {
                    const bgJoin = JSON.stringify({
                        action: 'join',
                        userId: currentHostInfo.userId,
                        username: currentHostInfo.hostName,
                        virtualIp: currentHostInfo.virtualIp,
                        inCall: false,
                        roomCode: cleanCode,
                        ts: Date.now()
                    });
                    rememberMessage(bgJoin);
                    try { client.publish(topic, bgJoin, { qos: 0 }); } catch (e) {}
                }

                if (wss) {
                    const readyMsg = JSON.stringify({ action: 'room_ready', roomCode: cleanCode });
                    wss.clients.forEach(wsClient => {
                        if (wsClient.readyState === WebSocket.OPEN) wsClient.send(readyMsg);
                    });
                }
            });
        });

        client.on('message', (receivedTopic, message) => {
            const msgStr = message.toString();

            if (receivedTopic === RADAR_QUERY_TOPIC && currentHostInfo) {
                try {
                    const query = JSON.parse(msgStr);
                    const replyPayload = JSON.stringify({
                        requesterId: query.requesterId,
                        roomCode: currentHostInfo.roomCode,
                        hostName: currentHostInfo.hostName,
                        roomName: currentHostInfo.roomName,
                        avatar: './Banaya.png'
                    });
                    client.publish(RADAR_RESPONSE_TOPIC, replyPayload, { qos: 0 });
                } catch (e) {}
                return;
            }

            if (receivedTopic === topic) {
                if (recentMessages.has(msgStr)) return;
                rememberMessage(msgStr);

                let hasActiveUiClient = false;
                if (wss) {
                    wss.clients.forEach(wsClient => { 
                        if (wsClient.readyState === WebSocket.OPEN) {
                            hasActiveUiClient = true;
                            wsClient.send(msgStr);
                        }
                    });
                }

                if (!hasActiveUiClient && currentHostInfo) {
                    try {
                        const parsed = JSON.parse(msgStr);
                        if (parsed.action === 'join' && parsed.userId !== currentHostInfo.userId) {
                            const bgPresence = JSON.stringify({
                                action: 'presence',
                                targetId: parsed.userId,
                                userId: currentHostInfo.userId,
                                username: currentHostInfo.hostName,
                                virtualIp: currentHostInfo.virtualIp,
                                inCall: false,
                                ts: Date.now()
                            });
                            rememberMessage(bgPresence);
                            publishToMesh(topic, bgPresence);
                        }
                    } catch (e) {}
                }
            }
        });

        mqttClients.push(client);
    });

    setTimeout(() => { pendingOutboundQueue = []; }, 6000);
    return cleanCode;
}

function scanOpenRooms(timeoutMs = 2200) {
    return new Promise((resolve) => {
        const requesterId = Math.random().toString(36).substring(2, 10);
        const foundRooms = new Map();
        const tempScanners = [];
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            tempScanners.forEach(s => { try { s.removeAllListeners(); s.end(true); } catch (e) {} });
            resolve(Array.from(foundRooms.values()));
        };

        setTimeout(finish, timeoutMs);

        MESH_BROKERS.forEach((brokerUrl) => {
            try {
                const scanner = mqtt.connect(brokerUrl, { protocolVersion: 4, connectTimeout: 2000, reconnectPeriod: 0 });
                scanner.on('error', () => {});
                tempScanners.push(scanner);

                scanner.on('connect', () => {
                    scanner.subscribe(RADAR_RESPONSE_TOPIC, () => {
                        scanner.publish(RADAR_QUERY_TOPIC, JSON.stringify({
                            action: 'discover',
                            requesterId: requesterId
                        }));
                    });
                });

                scanner.on('message', (topic, message) => {
                    if (topic === RADAR_RESPONSE_TOPIC) {
                        try {
                            const data = JSON.parse(message.toString());
                            if (data.requesterId === requesterId && data.roomCode) {
                                foundRooms.set(data.roomCode, {
                                    roomCode: data.roomCode,
                                    hostName: data.hostName || 'Friend',
                                    roomName: data.roomName || `Network #${data.roomCode}`,
                                    avatar: data.avatar || './Banaya.png'
                                });
                            }
                        } catch (e) {}
                    }
                });
            } catch (e) {}
        });
    });
}

function stopServer() {
    if (server) server.close();
    clearMeshClients();
}

module.exports = { startLocalServer, stopServer, joinSwarmRoom, leaveSwarmRoom, scanOpenRooms, getActiveRoomCode };