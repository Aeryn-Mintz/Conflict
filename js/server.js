const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

let wss = null; 
let server = null;
let mqttControlClients = [];
let mqttMediaClients = [];
let directLanPeers = new Map();
let currentRoomCode = null;
let currentRoomTopics = ['conflict-room-DEFAULT'];
let currentMediaTopic = 'conflict-media-DEFAULT';
let currentHostInfo = null;
let pendingOutboundQueue = [];

const recentMessages = new Set();
const lanConnectCooldown = new Map();
const RADAR_QUERY_TOPIC = 'conflict-global-radar-v1/query';
const RADAR_RESPONSE_TOPIC = 'conflict-global-radar-v1/response';

// Brokers globais independentes
const CONTROL_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
];

// Clientes dedicados exclusivamente para Voz e Tela em tempo real (separados do Chat!)
const MEDIA_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
];

function sanitizeRoomMeta(roomName, roomCode) {
    let rawName = String(roomName || '').trim();
    let cleanCode = String(roomCode || 'DEFAULT').trim().toUpperCase();

    if (rawName.includes('|')) {
        const parts = rawName.split('|');
        rawName = parts[0].trim();
        if ((!cleanCode || cleanCode === 'DEFAULT') && parts[1]) {
            cleanCode = parts[1].trim().toUpperCase();
        }
    }
    if (cleanCode.includes('|')) {
        cleanCode = cleanCode.split('|').pop().trim().toUpperCase();
    }
    cleanCode = cleanCode.replace(/[^A-Z0-9-]/g, '') || 'DEFAULT';

    const cleanName = rawName || `Network #${cleanCode}`;
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    const codeTopic = `conflict-room-${cleanCode}`;
    const slugTopic = slug ? `conflict-room-${slug}_${cleanCode}` : codeTopic;
    const mediaTopic = `conflict-media-${cleanCode}`;

    const topics = [codeTopic];
    if (slugTopic !== codeTopic) topics.push(slugTopic);

    return {
        cleanName,
        cleanCode,
        primaryTopic: codeTopic,
        mediaTopic,
        topics
    };
}

// Se o amigo estiver usando um nome de rede diferente (ex: "fnaf"), adiciona automaticamente o tópico dele!
function learnPeerTopic(roomName, roomCode) {
    if (!roomName || !currentRoomCode) return;
    const slug = String(roomName).trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    if (!slug) return;
    const peerTopic = `conflict-room-${slug}_${currentRoomCode}`;
    if (!currentRoomTopics.includes(peerTopic)) {
        currentRoomTopics.push(peerTopic);
        mqttControlClients.forEach(c => {
            if (c && c.connected) {
                try { c.subscribe(peerTopic, { qos: 0 }); } catch (e) {}
            }
        });
    }
}

function stripOversizedFields(msgStr) {
    if (msgStr.length < 3500) return msgStr;
    try {
        const parsed = JSON.parse(msgStr);
        if (parsed.action === 'screen_frame' || parsed.action === 'voice_frame' || parsed.action === 'set_map_bg' || parsed.action === 'token_add') {
            return msgStr;
        }
        let modified = false;
        if (parsed.avatar && parsed.avatar.length > 1500) {
            delete parsed.avatar;
            modified = true;
        }
        if (parsed.portrait && parsed.portrait.length > 1500) {
            delete parsed.portrait;
            modified = true;
        }
        return modified ? JSON.stringify(parsed) : msgStr;
    } catch (e) {
        return msgStr;
    }
}

function rememberMessage(msgStr) {
    recentMessages.add(msgStr);
    setTimeout(() => recentMessages.delete(msgStr), 2500);
}

function hasActiveLocalUi() {
    if (!wss) return false;
    for (const client of wss.clients) {
        if (client.isLocalUi && client.readyState === WebSocket.OPEN) return true;
    }
    return false;
}

function tryDirectLanConnect(peerIp) {
    if (!peerIp || !/^10\.66\.0\.\d+$/.test(peerIp)) return;
    if (currentHostInfo && peerIp === currentHostInfo.virtualIp) return;
    const existing = directLanPeers.get(peerIp);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;

    const lastTry = lanConnectCooldown.get(peerIp) || 0;
    if (Date.now() - lastTry < 25000) return;
    lanConnectCooldown.set(peerIp, Date.now());

    try {
        const lanWs = new WebSocket(`ws://${peerIp}:8080`);
        directLanPeers.set(peerIp, lanWs);

        lanWs.on('open', () => {
            if (currentHostInfo && !hasActiveLocalUi()) {
                lanWs.send(JSON.stringify({
                    action: 'presence',
                    targetId: null,
                    userId: currentHostInfo.userId,
                    username: currentHostInfo.hostName,
                    virtualIp: currentHostInfo.virtualIp,
                    inCall: !!currentHostInfo.inCall,
                    ts: Date.now()
                }));
            }
        });

        lanWs.on('message', (data) => {
            const msgStr = data.toString();
            if (recentMessages.has(msgStr)) return;
            rememberMessage(msgStr);
            if (wss) {
                wss.clients.forEach(client => {
                    if (client.isLocalUi && client.readyState === WebSocket.OPEN) {
                        client.send(msgStr);
                    }
                });
            }
        });

        lanWs.on('error', () => { directLanPeers.delete(peerIp); });
        lanWs.on('close', () => { directLanPeers.delete(peerIp); });
    } catch (e) {}
}

function publishToMesh(topics, msgStr, isRealtimeFrame = false) {
    const safeMsg = stripOversizedFields(msgStr);
    // Registra a mensagem enviada para que o eco do broker MQTT não duplique na nossa própria tela
    rememberMessage(safeMsg);

    let sentOverDirectLan = false;

    // 1. Envia pelos WebSockets diretos da LAN Virtual (10.66.0.x) se disponíveis
    directLanPeers.forEach((lanWs) => {
        if (lanWs && lanWs.readyState === WebSocket.OPEN) {
            try { lanWs.send(safeMsg); sentOverDirectLan = true; } catch (e) {}
        }
    });

    if (wss) {
        wss.clients.forEach(client => {
            if (!client.isLocalUi && client.readyState === WebSocket.OPEN) {
                try { client.send(safeMsg); sentOverDirectLan = true; } catch (e) {}
            }
        });
    }

    // 2. Se for Voz ou Tela em tempo real, usa os clientes de MÍDIA dedicados (nunca bloqueia o cliente de Chat!)
    if (isRealtimeFrame) {
        let mediaSent = sentOverDirectLan;
        const targetTopics = [currentMediaTopic, topics[0]];
        for (const mClient of mqttMediaClients) {
            if (mClient && mClient.connected) {
                // Controle de congestionamento: só envia se o socket não estiver engarrafado
                const buffered = mClient.stream?.writableLength || 0;
                if (buffered < 65536) {
                    targetTopics.forEach(t => {
                        try { mClient.publish(t, safeMsg, { qos: 0 }); mediaSent = true; } catch (e) {}
                    });
                    break; // Publica em apenas 1 cluster de mídia por vez para não dobrar banda de upload
                }
            }
        }
        return mediaSent;
    }

    // 3. Pacotes de Chat, Presença, VTT e Sinalização WebRTC vão por TODOS os clientes de Controle e TODOS os tópicos!
    const topicList = Array.isArray(topics) ? topics : [topics];
    let sent = sentOverDirectLan;
    for (const client of mqttControlClients) {
        if (client && client.connected) {
            topicList.forEach(t => {
                try {
                    client.publish(t, safeMsg, { qos: 0 });
                    sent = true;
                } catch (e) {}
            });
        }
    }
    return sent;
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
    
    wss.on('connection', (ws, req) => {
        const upgradeReq = req || ws.upgradeReq;
        const remoteAddr = upgradeReq?.socket?.remoteAddress || '127.0.0.1';
        const isLocalUi = remoteAddr.includes('127.0.0.1') || remoteAddr.includes('::1') || remoteAddr === '';
        ws.isLocalUi = isLocalUi;

        ws.on('message', (msg) => {
            const msgStr = msg.toString();

            // Se veio de um par remoto da LAN, aplica filtro anti-duplicação
            if (!isLocalUi && recentMessages.has(msgStr)) return;

            let isRealtimeFrame = false;
            try {
                const parsed = JSON.parse(msgStr);
                isRealtimeFrame = (parsed.action === 'voice_frame' || parsed.action === 'screen_frame');
                if (isLocalUi && currentHostInfo) {
                    if (parsed.action === 'join' || parsed.action === 'presence') {
                        if (parsed.userId) currentHostInfo.userId = parsed.userId;
                        if (parsed.username) currentHostInfo.hostName = parsed.username;
                        if (parsed.virtualIp) currentHostInfo.virtualIp = parsed.virtualIp;
                        if (parsed.inCall !== undefined) currentHostInfo.inCall = !!parsed.inCall;
                    } else if (parsed.action === 'call_state') {
                        currentHostInfo.inCall = !!parsed.inCall;
                    }
                }
                if (!isLocalUi && parsed.virtualIp) {
                    tryDirectLanConnect(parsed.virtualIp);
                }
            } catch (e) {}

            // Repassa para outras abas locais abertas
            wss.clients.forEach(client => { 
                if (client !== ws && client.isLocalUi && client.readyState === WebSocket.OPEN) {
                    client.send(msgStr);
                }
            });
            
            // NUNCA bloqueia mensagens enviadas pela nossa própria interface local!
            if (isLocalUi) {
                const sent = publishToMesh(currentRoomTopics, msgStr, isRealtimeFrame);
                if (!sent && !isRealtimeFrame && pendingOutboundQueue.length < 40) {
                    pendingOutboundQueue.push(stripOversizedFields(msgStr));
                }
            } else {
                rememberMessage(msgStr);
            }
        });
    });
    
    server.on('error', () => {});
    server.listen(8080, '0.0.0.0');
    return { server, wss };
}

function clearMeshClients() {
    mqttControlClients.forEach(client => {
        try { client.removeAllListeners(); client.end(true); } catch (e) {}
    });
    mqttControlClients = [];
    mqttMediaClients.forEach(client => {
        try { client.removeAllListeners(); client.end(true); } catch (e) {}
    });
    mqttMediaClients = [];
    directLanPeers.forEach(ws => {
        try { ws.close(); } catch (e) {}
    });
    directLanPeers.clear();
}

function leaveSwarmRoom() {
    currentRoomCode = null;
    currentRoomTopics = ['conflict-room-DEFAULT'];
    currentMediaTopic = 'conflict-media-DEFAULT';
    currentHostInfo = null;
    pendingOutboundQueue = [];
    clearMeshClients();
}

function getActiveRoomCode() {
    return currentRoomCode;
}

async function joinSwarmRoom(roomCode, isHost = true, hostMeta = {}) {
    const { cleanName, cleanCode, mediaTopic, topics } = sanitizeRoomMeta(hostMeta.roomName, roomCode);

    if (currentHostInfo) {
        if (hostMeta.hostName) currentHostInfo.hostName = hostMeta.hostName;
        currentHostInfo.roomName = cleanName;
        currentHostInfo.roomCode = cleanCode;
        if (hostMeta.virtualIp) currentHostInfo.virtualIp = hostMeta.virtualIp;
        if (hostMeta.userId) currentHostInfo.userId = hostMeta.userId;
    } else {
        currentHostInfo = {
            roomCode: cleanCode,
            userId: hostMeta.userId || ('bg_' + Math.random().toString(36).slice(2, 10)),
            hostName: hostMeta.hostName || 'Player',
            roomName: cleanName,
            virtualIp: hostMeta.virtualIp || '10.66.0.x',
            inCall: false,
            avatar: './Banaya.png',
            createdAt: Date.now()
        };
    }

    // CORREÇÃO CRÍTICA: Se já estamos conectados nesta mesma sala, apenas garante a inscrição nos tópicos
    // e NÃO reenvia room_ready (evita o loop infinito announceRoomJoin <-> ensure-network)!
    if (currentRoomCode === cleanCode && mqttControlClients.length > 0) {
        topics.forEach(t => {
            if (!currentRoomTopics.includes(t)) currentRoomTopics.push(t);
        });
        currentMediaTopic = mediaTopic;
        mqttControlClients.forEach(c => {
            if (c && c.connected) {
                try { c.subscribe(currentRoomTopics, { qos: 0 }); } catch (e) {}
            }
        });
        mqttMediaClients.forEach(c => {
            if (c && c.connected) {
                try { c.subscribe([currentMediaTopic, ...currentRoomTopics], { qos: 0 }); } catch (e) {}
            }
        });
        return cleanCode;
    }

    clearMeshClients();
    currentRoomCode = cleanCode;
    currentRoomTopics = topics;
    currentMediaTopic = mediaTopic;

    const handleIncomingBrokerMessage = (receivedTopic, message, brokerClient) => {
        const msgStr = message.toString();

        if (receivedTopic === RADAR_QUERY_TOPIC && currentHostInfo && brokerClient) {
            try {
                const query = JSON.parse(msgStr);
                const replyPayload = JSON.stringify({
                    requesterId: query.requesterId,
                    roomCode: currentHostInfo.roomCode,
                    hostName: currentHostInfo.hostName,
                    roomName: currentHostInfo.roomName,
                    avatar: './Banaya.png'
                });
                brokerClient.publish(RADAR_RESPONSE_TOPIC, replyPayload, { qos: 0 });
            } catch (e) {}
            return;
        }

        if (currentRoomTopics.includes(receivedTopic) || receivedTopic === currentMediaTopic) {
            if (recentMessages.has(msgStr)) return;
            rememberMessage(msgStr);

            let parsed = null;
            try {
                parsed = JSON.parse(msgStr);
                // Ignora se for eco de um pacote nosso mesmo
                if (currentHostInfo && parsed.userId && parsed.userId === currentHostInfo.userId) return;

                if (parsed.roomName) {
                    learnPeerTopic(parsed.roomName, cleanCode);
                }
                if (parsed.virtualIp) {
                    tryDirectLanConnect(parsed.virtualIp);
                }
            } catch (e) {}

            let deliveredToUi = false;
            if (wss) {
                wss.clients.forEach(wsClient => { 
                    if (wsClient.isLocalUi && wsClient.readyState === WebSocket.OPEN) {
                        deliveredToUi = true;
                        wsClient.send(msgStr);
                    }
                });
            }

            if (!deliveredToUi && currentHostInfo && parsed) {
                if (parsed.action === 'join' && parsed.userId !== currentHostInfo.userId) {
                    const bgPresence = JSON.stringify({
                        action: 'presence',
                        targetId: parsed.userId,
                        userId: currentHostInfo.userId,
                        username: currentHostInfo.hostName,
                        virtualIp: currentHostInfo.virtualIp,
                        inCall: !!currentHostInfo.inCall,
                        roomName: currentHostInfo.roomName,
                        ts: Date.now()
                    });
                    publishToMesh(currentRoomTopics, bgPresence, false);
                }
            }
        }
    };

    // 1. Inicia Clientes de Controle, Chat e Sinalização WebRTC
    CONTROL_BROKERS.forEach((brokerUrl) => {
        let client;
        try {
            client = mqtt.connect(brokerUrl, {
                clientId: `cfl_ctrl_${cleanCode}_${Math.random().toString(16).slice(2, 10)}`,
                protocolVersion: 4,
                keepalive: 30,
                connectTimeout: 7000,
                reconnectPeriod: 4000,
                clean: true
            });
        } catch (err) {
            return;
        }

        client.on('error', () => {});

        client.on('connect', () => {
            const subs = [...currentRoomTopics, RADAR_QUERY_TOPIC];

            client.subscribe(subs, { qos: 0 }, (err) => {
                if (err) return;

                pendingOutboundQueue.forEach(queuedMsg => {
                    currentRoomTopics.forEach(t => {
                        try { client.publish(t, queuedMsg, { qos: 0 }); } catch (e) {}
                    });
                });

                if (currentHostInfo && !hasActiveLocalUi()) {
                    const bgJoin = JSON.stringify({
                        action: 'join',
                        userId: currentHostInfo.userId,
                        username: currentHostInfo.hostName,
                        virtualIp: currentHostInfo.virtualIp,
                        inCall: !!currentHostInfo.inCall,
                        roomCode: cleanCode,
                        roomName: cleanName,
                        ts: Date.now()
                    });
                    rememberMessage(bgJoin);
                    currentRoomTopics.forEach(t => {
                        try { client.publish(t, bgJoin, { qos: 0 }); } catch (e) {}
                    });
                }

                if (wss) {
                    const readyMsg = JSON.stringify({ action: 'room_ready', roomCode: cleanCode });
                    wss.clients.forEach(wsClient => {
                        if (wsClient.isLocalUi && wsClient.readyState === WebSocket.OPEN) {
                            wsClient.send(readyMsg);
                        }
                    });
                }
            });
        });

        client.on('message', (t, m) => handleIncomingBrokerMessage(t, m, client));
        mqttControlClients.push(client);
    });

    // 2. Inicia Clientes Dedicados de Mídia (Voz & Tela em Tempo Real)
    MEDIA_BROKERS.forEach((brokerUrl) => {
        let mClient;
        try {
            mClient = mqtt.connect(brokerUrl, {
                clientId: `cfl_media_${cleanCode}_${Math.random().toString(16).slice(2, 10)}`,
                protocolVersion: 4,
                keepalive: 30,
                connectTimeout: 7000,
                reconnectPeriod: 4000,
                clean: true
            });
        } catch (err) {
            return;
        }

        mClient.on('error', () => {});
        mClient.on('connect', () => {
            mClient.subscribe([currentMediaTopic, ...currentRoomTopics], { qos: 0 }, () => {});
        });
        mClient.on('message', (t, m) => handleIncomingBrokerMessage(t, m, null));
        mqttMediaClients.push(mClient);
    });

    setTimeout(() => { pendingOutboundQueue = []; }, 6000);
    return cleanCode;
}

function scanOpenRooms(timeoutMs = 2000) {
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

        CONTROL_BROKERS.slice(0, 2).forEach((brokerUrl) => {
            try {
                const scanner = mqtt.connect(brokerUrl, { protocolVersion: 4, connectTimeout: 1800, reconnectPeriod: 0 });
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