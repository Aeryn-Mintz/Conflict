const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

let wss = null; 
let server = null;
let mqttClient = null;

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
            const msgStr = msg.toString();
            
            // 1. Send locally to your UI
            wss.clients.forEach(client => { 
                if (client !== ws && client.readyState === WebSocket.OPEN) client.send(msgStr); 
            });
            
            // 2. Blast it across the internet to your friends
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(mqttClient.roomTopic, msgStr);
            }
        });
    });
    
    server.listen(8080, '127.0.0.1');
    return { server, wss };
}

async function joinSwarmRoom(roomCode) {
    return new Promise((resolve) => {
        if (mqttClient) mqttClient.end(); // Clear old rooms
        
        const topic = `conflict-room-${roomCode.toUpperCase()}`;
        console.log("Connecting to public broker for room:", roomCode);
        
        // Connect to a free, massive public messaging broker
        mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');
        mqttClient.roomTopic = topic;

        mqttClient.on('connect', () => {
            mqttClient.subscribe(topic, () => {
                console.log("Successfully joined room:", roomCode);
                resolve(roomCode); // Instantly resolves, no UI freezing!
            });
        });

        // When your friend sends data, route it back into your local UI
        mqttClient.on('message', (receivedTopic, message) => {
            if (receivedTopic === topic && wss) {
                const msgStr = message.toString();
                wss.clients.forEach(client => { 
                    if (client.readyState === WebSocket.OPEN) client.send(msgStr); 
                });
            }
        });
    });
}

function stopServer() {
    if (server) server.close();
    if (mqttClient) mqttClient.end();
}

module.exports = { startLocalServer, stopServer, joinSwarmRoom };