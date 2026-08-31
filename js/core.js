// ==========================================
// PC CORE ENGINE (Electron / Desktop)
// ==========================================
window.ipcRenderer = null; window.fs = null; window.path = null; window.os = null; window.net = null;
try {
    if (typeof require !== 'undefined') {
        window.ipcRenderer = require('electron').ipcRenderer; window.fs = require('fs');
        window.path = require('path'); window.os = require('os'); window.net = require('net');
        window.mapSavePath = window.path.join(window.os.homedir(), '.conflict_vtt_map.txt');
    }
} catch (e) {}

window.defaultAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="%231a1a1a"/><text x="50%" y="50%" fill="%2310b981" font-family="sans-serif" font-size="12" dy=".3em" text-anchor="middle">User</text></svg>';

window.myId = Math.random().toString(36).substring(2, 10); 
window.socket = null; window.isDM = false; window.partySheets = {};
window.activeCharId = null; window.viewingParty = false; window.viewingRemoteUid = null;
window.cropMode = 'avatar'; window.serverUrl = localStorage.getItem('conflictServerUrl') || 'ws://localhost:8080';
window.reconnectAttempts = 0; window.reconnectTimer = null;
window.audioCtx = null; window.soundboardDest = null; window.soundboardTrack = null;
window.peers = {}; window.peerNames = {}; window.peerAvatars = {}; window.iceCandidateQueue = {};
window.rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }], iceCandidatePoolSize: 10 };
window.localMicStream = null; window.localScreenStream = null; window.localCamStream = null;

// --- LAUNCHER LOGIC & UPDATER BRIDGE ---
window.hasCheckedForUpdates = false;

async function performActionWithUpdateCheck(actionCallback) {
    if (window.ipcRenderer && !window.hasCheckedForUpdates) {
        window.hasCheckedForUpdates = true; // Só checa uma vez por sessão para não travar o usuário
        const overlay = document.getElementById('update-overlay'); const msg = document.getElementById('update-msg');
        if(overlay) overlay.style.display = 'flex';
        if(msg) msg.innerText = window.conflictTranslations[localStorage.getItem('conflictLang') || 'en']?.updateCheck || 'Checking for updates...';
        try {
            await Promise.race([ window.ipcRenderer.invoke('manual-update-check'), new Promise(res => setTimeout(res, 4000)) ]);
        } catch(e) {}
        if(overlay) overlay.style.display = 'none';
    }
    actionCallback();
}

document.getElementById('host-game-btn')?.addEventListener('click', () => {
    performActionWithUpdateCheck(() => { if (window.ipcRenderer) window.ipcRenderer.send('start-host'); });
});

document.getElementById('join-game-btn')?.addEventListener('click', () => {
    performActionWithUpdateCheck(() => {
        const chatBox = document.getElementById('chat-messages'); if(chatBox) chatBox.innerHTML = '';
        window.scanForRooms();
    });
});

window.connectToRoom = function(ip) {
    const newUrl = `ws://${ip}:8080`;
    localStorage.setItem('conflictServerUrl', newUrl); window.serverUrl = newUrl;
    window.addChatLine('System', `🔄 Switching connection to ${ip}...`, true);
    if (window.socket) window.socket.close(); 
};

window.scanForRooms = function() {
    if (!window.os || !window.net) return window.addChatLine('System', '⚠️ Radar only works on the PC Host version.', true);
    const interfaces = window.os.networkInterfaces(); const subnets = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const parts = iface.address.split('.'); parts.pop(); subnets.push(parts.join('.')); 
            }
        }
    }
    
    const t = window.conflictTranslations[localStorage.getItem('conflictLang') || 'en'];
    document.getElementById('chat-input').placeholder = t?.radarScanning || "Scanning network...";
    
    subnets.forEach(subnet => {
        for (let i = 1; i <= 254; i++) {
            const targetIp = `${subnet}.${i}`;
            const scanner = new window.net.Socket(); scanner.setTimeout(800); 
            scanner.on('connect', () => {
                window.addChatLine('Radar', `🟢 Room found: <button onclick="window.connectToRoom('${targetIp}')" class="primary-btn glow-btn" style="padding:4px 8px; font-size:11px; margin-left: 10px;">Connect to ${targetIp}</button>`, true);
                scanner.destroy();
            });
            scanner.on('timeout', () => scanner.destroy()); scanner.on('error', () => scanner.destroy());
            scanner.connect(8080, targetIp);
        }
    });
    checkRecentRooms();
};

window.saveConnectedRoom = function(ip) {
    let history = JSON.parse(localStorage.getItem('conflictRecentRooms') || '[]');
    if (!history.includes(ip) && ip !== 'localhost') {
        history.unshift(ip); localStorage.setItem('conflictRecentRooms', JSON.stringify(history.slice(0, 5))); 
    }
};

function checkRecentRooms() {
    JSON.parse(localStorage.getItem('conflictRecentRooms') || '[]').forEach(ip => {
        window.addChatLine('Radar', `🕒 History: <button onclick="window.connectToRoom('${ip}')" class="secondary-btn" style="padding:4px 8px; font-size:11px; margin-left: 10px;">Connect to ${ip}</button>`, true);
    });
}

// --- DRAG & TABS ENGINE ---
function makeDraggable(element) {
    const handle = element.querySelector('.drag-handle');
    if (!handle) return;
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    handle.onmousedown = (e) => {
        e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY;
        document.onmouseup = () => {
            document.onmouseup = null; document.onmousemove = null;
            const snapSize = 20;
            const snappedLeft = Math.round(element.offsetLeft / snapSize) * snapSize;
            const snappedTop = Math.round(element.offsetTop / snapSize) * snapSize;
            anime({ targets: element, left: snappedLeft, top: snappedTop, scale: 1, duration: 400, easing: 'easeOutElastic(1, .6)' });
        };
        document.onmousemove = (e) => {
            e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px"; element.style.left = (element.offsetLeft - pos1) + "px";
        };
        document.querySelectorAll('.floating-panel').forEach(p => p.style.zIndex = 50); element.style.zIndex = 51;
        anime({ targets: element, scale: 1.02, duration: 200, easing: 'easeOutElastic(1, .8)' });
    };
}
document.querySelectorAll('.floating-panel').forEach(makeDraggable);

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
        const tabId = btn.dataset.tab;
        ['main-view', 'rpg-view', 'sheets-view', 'dm-view'].forEach(id => {
            const el = document.getElementById(id); if(el) el.style.display = 'none';
        });
        document.getElementById(`${tabId}-view`).style.display = 'flex';
        anime({ targets: `#${tabId}-view`, opacity: [0, 1], translateY: [20, 0], duration: 400, easing: 'easeOutQuart' });
        if (tabId === 'rpg' && window.initCanvas) window.initCanvas(); 
    });
});

// --- SOCKET LOGIC ---
function connectSocket() {
    window.socket = new WebSocket(window.serverUrl);
    window.saveConnectedRoom(window.serverUrl.replace('ws://', '').split(':')[0]);
    window.socket.onopen = () => {
        window.reconnectAttempts = 0; clearTimeout(window.reconnectTimer);
        const joinBtn = document.getElementById('join-voice-btn');
        if (joinBtn && !window.localMicStream) { joinBtn.disabled = false; joinBtn.innerText = window.conflictTranslations[localStorage.getItem('conflictLang') || 'en']?.joinCall || "🎙️ Join Call"; }
        const chatInput = document.getElementById('chat-input');
        if(chatInput) { chatInput.disabled = false; chatInput.placeholder = '🟢 Connected!'; }
        if (window.saveCharacterSheet && document.getElementById('rpg-system-select')) window.saveCharacterSheet(document.getElementById('rpg-system-select').value);
    };
    window.socket.onclose = () => {
        window.reconnectAttempts++; const delaySec = Math.min(30, Math.pow(2, window.reconnectAttempts));
        const chatInput = document.getElementById('chat-input');
        if(chatInput) { chatInput.placeholder = `🟡 Disconnected — reconnecting in ${delaySec}s...`; chatInput.disabled = true; }
        window.reconnectTimer = setTimeout(connectSocket, delaySec * 1000);
    };
    window.socket.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.action === 'join' && data.userId !== window.myId) {
                window.peerNames[data.userId] = data.username || "Guest"; window.peerAvatars[data.userId] = data.avatar || null;
                addRemoteUserCard(data.userId, window.peerNames[data.userId], window.peerAvatars[data.userId]);
                let pc = window.peers[data.userId] || createPeerConnection(data.userId); addLocalTracksSafely(pc);
                const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
                window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: data.userId, username: document.getElementById('display-username').textContent, avatar: localStorage.getItem('appAvatar') || null, offer: offer }));
                if (window.isDM) window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: document.getElementById('rpg-system-select').value }));
            }
            else if (data.action === 'remove_video') {
                const vid1 = document.getElementById(`video-container-${data.streamId}`); if (vid1) vid1.remove();
                const vid2 = document.getElementById(`video-container-${data.trackId}`); if (vid2) vid2.remove();
            }
            else if (data.action === 'set_campaign_system' && window.applyCampaignSystem) { window.applyCampaignSystem(data.system, false); window.addChatLine('System', `👑 The DM set the campaign system to **${data.system.toUpperCase()}**.`, true); }
            else if (data.action === 'toggle_fog' && data.userId !== window.myId) {
                const fog = document.getElementById('fog-canvas');
                if (fog) { fog.style.display = data.enabled ? 'block' : 'none'; if (data.enabled && window.fogCtx) { window.fogCtx.fillStyle = '#000000'; window.fogCtx.fillRect(0, 0, fog.width, fog.height); } }
            }
            else if (data.action === 'fog_reveal' && data.userId !== window.myId && window.fogCtx) {
                window.fogCtx.globalCompositeOperation = 'destination-out'; window.fogCtx.beginPath();
                window.fogCtx.moveTo(data.x0, data.y0); window.fogCtx.lineTo(data.x1, data.y1);
                window.fogCtx.lineWidth = data.width; window.fogCtx.lineCap = 'round'; window.fogCtx.lineJoin = 'round'; window.fogCtx.stroke(); window.fogCtx.globalCompositeOperation = 'source-over';
            }
            else if (data.action === 'request_sheets' && window.saveCharacterSheet) window.saveCharacterSheet(document.getElementById('rpg-system-select').value);
            else if (data.action === 'sheet_update') {
                window.partySheets[data.userId] = { username: data.username, system: data.system, charName: data.charName, data: data.data, portrait: data.portrait };
                if (window.isDM && window.viewingParty) { if (document.getElementById('party-list-grid')) window.renderPartyList(); if (window.viewingRemoteUid === data.userId) window.renderRemoteSheet(data.userId); }
            }
            else if (data.action === 'offer' && data.targetId === window.myId) {
                if (data.username) window.peerNames[data.userId] = data.username;
                if (data.avatar) window.peerAvatars[data.userId] = data.avatar;
                addRemoteUserCard(data.userId, window.peerNames[data.userId], window.peerAvatars[data.userId]);
                let pc = window.peers[data.userId] || createPeerConnection(data.userId);
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                if (window.iceCandidateQueue[data.userId]) { while (window.iceCandidateQueue[data.userId].length > 0) await pc.addIceCandidate(window.iceCandidateQueue[data.userId].shift()); }
                addLocalTracksSafely(pc); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
                window.socket.send(JSON.stringify({ action: 'answer', userId: window.myId, targetId: data.userId, answer: answer }));
            }
            else if (data.action === 'set_map_bg') document.getElementById('tabletop-container').style.backgroundImage = `url(${data.image})`;
            else if (data.action === 'claim_dm') {
                window.addChatLine('System', `👑 ${data.username} is now the Dungeon Master.`, true);
                const dmBtn = document.getElementById('claim-dm-btn');
                if (data.userId !== window.myId && dmBtn) { dmBtn.innerText = `👑 DM: ${data.username}`; dmBtn.disabled = true; dmBtn.style.borderColor = "var(--border-color)"; dmBtn.style.color = "var(--text-muted)"; }
            }
            else if (data.action === 'release_dm') {
                window.addChatLine('System', `👑 The Dungeon Master role is now open.`, true);
                const dmBtn = document.getElementById('claim-dm-btn'); if(dmBtn) { dmBtn.innerText = `👑 Claim DM`; dmBtn.disabled = false; dmBtn.style.borderColor = "#fbbf24"; dmBtn.style.color = "#fbbf24"; }
            }
            else if (data.action === 'answer' && data.targetId === window.myId && window.peers[data.userId]) await window.peers[data.userId].setRemoteDescription(new RTCSessionDescription(data.answer));
            else if (data.action === 'ice-candidate' && data.targetId === window.myId && window.peers[data.userId]) {
                const pc = window.peers[data.userId]; const candidate = new RTCIceCandidate(data.candidate);
                if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(candidate);
                else { if (!window.iceCandidateQueue[data.userId]) window.iceCandidateQueue[data.userId] = []; window.iceCandidateQueue[data.userId].push(candidate); }
            }
            else if (data.action === 'chat_message') window.addChatLine(data.username || 'Guest', data.text || '');
            else if (data.action === 'dice_roll' && data.userId !== window.myId && window.animateDiceRoll2D) {
                const sides = parseInt(data.type.replace(/^\d+d/, '')) || 20;
                window.animateDiceRoll2D(data.results, data.type.replace(/\d+/, ''), data.customClasses); 
                if (data.results.includes(sides)) window.triggerFireworks();
            }
            else if (data.action === 'token_add' && data.userId !== window.myId && window.placeTokenOnMap) window.placeTokenOnMap(data.token, false);
            else if (data.action === 'token_move' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.left = data.x + 'px'; el.style.top = data.y + 'px'; } }
            else if (data.action === 'token_remove' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) el.remove(); }
            else if (data.action === 'canvas_draw' && data.userId !== window.myId && window.remoteDraw) window.remoteDraw(data);
            else if (data.action === 'canvas_clear' && data.userId !== window.myId && window.ctx) window.ctx.clearRect(0, 0, 3000, 3000);
            else if (data.action === 'yt_load') { window.ytQueue.unshift({ id: data.videoId }); window.loadAndPlayVideo(data.videoId, 0); window.addChatLine('System', `▶️ Playing new YouTube Video`, true); }
            else if (data.action === 'yt_queue_add') { window.ytQueue.push({ id: data.videoId }); window.renderQueueUI(); window.addChatLine('System', `➕ A user added a video to the queue`, true); }
            else if (data.action === 'yt_skip' || data.action === 'yt_jump') { window.currentQueueIndex = data.action === 'yt_jump' ? data.index : window.currentQueueIndex + 1; if (window.ytQueue[window.currentQueueIndex]) window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); }
            else if (data.action === 'yt_pause') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PAUSED) window.ytPlayer.pauseVideo(); }
            else if (data.action === 'yt_play') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) window.ytPlayer.playVideo(); }
            else if (data.action === 'sound_played' && data.userId !== window.myId) window.addChatLine('System', `🔊 Sound played: ${data.soundName}`, true);
        } catch (e) {}
    };
}
connectSocket();
setInterval(() => { if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'keep_alive' })); }, 15000);

// --- WEBRTC ---
function addLocalTracksSafely(pc) {
    const sentTracks = pc.getSenders().map(s => s.track).filter(Boolean); const tracksToAdd = [];
    if (window.localMicStream) tracksToAdd.push(...window.localMicStream.getTracks());
    if (window.localScreenStream) tracksToAdd.push(...window.localScreenStream.getTracks());
    if (window.localCamStream) tracksToAdd.push(...window.localCamStream.getTracks());
    if (window.soundboardTrack) tracksToAdd.push(window.soundboardTrack);
    tracksToAdd.forEach(track => { if (!sentTracks.includes(track)) pc.addTrack(track, window.localMicStream || window.localScreenStream || window.localCamStream || window.soundboardDest.stream); });
}

function createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection(window.rtcConfig); window.peers[remoteUserId] = pc;
    pc.onicecandidate = (event) => { if (event.candidate) window.socket.send(JSON.stringify({ action: 'ice-candidate', userId: window.myId, targetId: remoteUserId, candidate: event.candidate })); };
    pc.oniceconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
            const card = document.getElementById(`user-card-${remoteUserId}`); if (card) card.remove();
            document.querySelectorAll(`.stream-${remoteUserId}`).forEach(el => el.remove());
            document.querySelectorAll(`[id*="${remoteUserId}"]`).forEach(el => { if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') el.remove(); });
            delete window.peers[remoteUserId]; delete window.iceCandidateQueue[remoteUserId];
        }
    };
    pc.ontrack = (event) => {
        const stream = event.streams && event.streams[0]; const streamId = stream ? stream.id : event.track.id;
        if (event.track.kind === 'audio') {
            let remoteAudio = document.getElementById(`audio-${streamId}`);
            if (!remoteAudio) {
                remoteAudio = document.createElement('audio'); remoteAudio.id = `audio-${streamId}`; remoteAudio.autoplay = true;
                const outId = localStorage.getItem('appAudioOut'); if (outId && typeof remoteAudio.setSinkId === 'function') remoteAudio.setSinkId(outId).catch(()=>{});
                document.getElementById('remote-audio-container').appendChild(remoteAudio);
                addRemoteUserCard(remoteUserId, window.peerNames[remoteUserId] || "Guest", window.peerAvatars[remoteUserId]);
                const slider = document.getElementById(`vol-${remoteUserId}`); if (slider) slider.addEventListener('input', (e) => remoteAudio.volume = Math.min(parseFloat(e.target.value), 1));
            }
            if (stream && remoteAudio.srcObject !== stream) remoteAudio.srcObject = stream; else if (!remoteAudio.srcObject) remoteAudio.srcObject = new MediaStream([event.track]);
            remoteAudio.play().catch(()=>{});
        }
        if (event.track.kind === 'video') {
            let videoContainer = document.getElementById(`video-container-${streamId}`); let remoteVideo = document.getElementById(`video-${streamId}`);
            if (!videoContainer) {
                videoContainer = document.createElement('div'); videoContainer.id = `video-container-${streamId}`; videoContainer.className = `stream-container stream-${remoteUserId}`;
                const label = document.createElement('div'); label.className = "stream-label"; label.innerText = `${window.peerNames[remoteUserId] || 'Friend'}'s Video`;
                remoteVideo = document.createElement('video'); remoteVideo.id = `video-${streamId}`; remoteVideo.autoplay = true; remoteVideo.playsInline = true; remoteVideo.controls = true; 
                videoContainer.appendChild(label); videoContainer.appendChild(remoteVideo); document.getElementById('video-grid').appendChild(videoContainer);
            }
            if (stream && remoteVideo.srcObject !== stream) remoteVideo.srcObject = stream; else if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream([event.track]);
            remoteVideo.play().catch(()=>{});
        }
    };
    return pc;
}

function addRemoteUserCard(userId, username, avatarDataUrl) {
    const callArea = document.querySelector('.call-area'); let card = document.getElementById(`user-card-${userId}`);
    if (!card) {
        card = document.createElement('div'); card.className = 'user-card'; card.id = `user-card-${userId}`;
        card.innerHTML = `<div class="avatar-wrapper"><img src="${avatarDataUrl || window.defaultAvatar}" class="avatar" alt="Avatar"></div><div class="user-info"><span class="username">${username}</span><input type="range" class="volume-slider" id="vol-${userId}" min="0" max="1" step="0.05" value="0.8"></div>`;
        if (callArea) callArea.appendChild(card);
        const slider = document.getElementById(`vol-${userId}`);
        if (slider) slider.addEventListener('input', (e) => { document.querySelectorAll(`[id*="${userId}"]`).forEach(el => { if (typeof el.volume !== 'undefined') el.volume = Math.min(parseFloat(e.target.value), 1); }); });
    } else {
        const nameSpan = card.querySelector('.username'); if (nameSpan && username) nameSpan.textContent = username;
        const imgEl = card.querySelector('.avatar'); if (imgEl && avatarDataUrl) imgEl.src = avatarDataUrl;
    }
}

window.isMuted = false;
async function populateDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(()=>{});
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioIn = document.getElementById('audio-in-select'); const audioOut = document.getElementById('audio-out-select'); const videoIn = document.getElementById('video-in-select');
        if(audioIn) audioIn.innerHTML = '<option value="">Default Microphone</option>'; if(audioOut) audioOut.innerHTML = '<option value="">Default Speakers</option>'; if(videoIn) videoIn.innerHTML = '<option value="">Default Camera</option>';
        devices.forEach(device => {
            const opt = document.createElement('option'); opt.value = device.deviceId; opt.text = device.label || `${device.kind} (${device.deviceId.substring(0, 5)})`;
            if (device.kind === 'audioinput' && audioIn) audioIn.appendChild(opt); else if (device.kind === 'audiooutput' && audioOut) audioOut.appendChild(opt); else if (device.kind === 'videoinput' && videoIn) videoIn.appendChild(opt);
        });
        if(audioIn) audioIn.value = localStorage.getItem('appAudioIn') || ''; if(audioOut) audioOut.value = localStorage.getItem('appAudioOut') || ''; if(videoIn) videoIn.value = localStorage.getItem('appVideoIn') || '';
    } catch (err) {}
}
document.getElementById('refresh-devices-btn')?.addEventListener('click', populateDevices);
async function applyAudioOutput(deviceId) { if (typeof document.createElement('audio').setSinkId !== 'undefined') document.querySelectorAll('audio, video').forEach(async el => { try { await el.setSinkId(deviceId); } catch(e){} }); }

document.getElementById('join-voice-btn')?.addEventListener('click', async () => {
    let micSuccess = false;
    try {
        if (!window.audioCtx) { window.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); window.soundboardDest = window.audioCtx.createMediaStreamDestination(); window.soundboardTrack = window.soundboardDest.stream.getAudioTracks()[0]; }
        if (window.audioCtx.state === 'suspended') await window.audioCtx.resume();
        const micId = localStorage.getItem('appAudioIn');
        const advancedAudio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 };
        const constraints = micId ? { audio: { ...advancedAudio, deviceId: { exact: micId } } } : { audio: advancedAudio };
        window.localMicStream = await navigator.mediaDevices.getUserMedia(constraints); micSuccess = true;
    } catch (error) { alert("Microphone blocked or not detected! Joining as a Listener."); }

    Object.values(window.peers).forEach(pc => addLocalTracksSafely(pc));
    const currentName = document.getElementById('display-username').textContent;
    window.socket.send(JSON.stringify({ action: 'join', userId: window.myId, username: currentName, avatar: localStorage.getItem('appAvatar') || null }));
    
    document.getElementById('join-voice-btn').disabled = true; document.getElementById('join-voice-btn').innerText = micSuccess ? "🎙️ Connected" : "🎧 Listening";
    if (micSuccess) document.getElementById('mute-mic-btn').disabled = false;
});

document.getElementById('mute-mic-btn')?.addEventListener('click', (e) => {
    if (window.localMicStream) {
        window.isMuted = !window.isMuted; window.localMicStream.getAudioTracks()[0].enabled = !window.isMuted;
        const t = window.conflictTranslations[localStorage.getItem('conflictLang') || 'en'];
        e.target.innerText = window.isMuted ? (t?.unmute || "🔈 Unmute") : (t?.mute || "🔇 Mute"); 
        e.target.style.color = window.isMuted ? "var(--accent-alert)" : "var(--text-main)"; e.target.style.borderColor = window.isMuted ? "var(--accent-alert)" : "var(--border-color)";
    }
});

document.getElementById('toggle-cam-btn')?.addEventListener('click', async (e) => {
    const btn = e.target; const localCam = document.getElementById('local-cam-video');
    if (window.localCamStream) {
        if (window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'remove_video', streamId: window.localCamStream.id, trackId: window.localCamStream.getVideoTracks()[0]?.id }));
        window.localCamStream.getTracks().forEach(t => { t.stop(); Object.values(window.peers).forEach(pc => { const sender = pc.getSenders().find(s => s.track === t); if (sender) pc.removeTrack(sender); }); });
        localCam.style.display = 'none'; localCam.srcObject = null; window.localCamStream = null;
        btn.innerText = "📷 Camera"; btn.classList.replace('primary-btn', 'secondary-btn');
        for (const [remoteUserId, pc] of Object.entries(window.peers)) {
            try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (err) {}
        }
    } else {
        try {
            const camId = localStorage.getItem('appVideoIn'); const constraints = camId ? { video: { deviceId: { exact: camId } } } : { video: true };
            window.localCamStream = await navigator.mediaDevices.getUserMedia(constraints);
            localCam.style.display = 'block'; localCam.srcObject = window.localCamStream;
            btn.innerText = "📷 Stop Cam"; btn.classList.replace('secondary-btn', 'primary-btn');
            for (const [remoteUserId, pc] of Object.entries(window.peers)) {
                addLocalTracksSafely(pc);
                try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (err) {}
            }
        } catch (err) { alert("Could not start camera!"); }
    }
});

document.getElementById('share-screen-btn')?.addEventListener('click', async (e) => {
    const shareScreenBtn = e.target; const localVideo = document.getElementById('local-screen-video'); 
    if (window.localScreenStream) {
        if (window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'remove_video', streamId: window.localScreenStream.id, trackId: window.localScreenStream.getVideoTracks()[0]?.id }));
        window.localScreenStream.getTracks().forEach(t => t.stop());
        if (window.localScreenStream.getVideoTracks().length > 0) window.localScreenStream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
        return;
    }
    try {
        window.localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
        shareScreenBtn.innerText = "💻 Stop Share"; shareScreenBtn.classList.replace('secondary-btn', 'primary-btn');
        localVideo.style.display = 'block'; localVideo.srcObject = window.localScreenStream; localVideo.controls = true; 
        for (const [remoteUserId, pc] of Object.entries(window.peers)) {
            addLocalTracksSafely(pc);
            try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (err) {}
        }
        window.localScreenStream.getVideoTracks()[0].onended = async () => {
            localVideo.style.display = 'none'; localVideo.srcObject = null;
            shareScreenBtn.innerText = "💻 Share Screen"; shareScreenBtn.classList.replace('primary-btn', 'secondary-btn');
            for (const [remoteUserId, pc] of Object.entries(window.peers)) {
                pc.getSenders().forEach(sender => { if (sender.track && sender.track.kind === 'video' && !window.localCamStream?.getTracks().includes(sender.track)) pc.removeTrack(sender); });
                try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (e) {}
            }
            window.localScreenStream = null;
        };
    } catch (error) {}
});

if (window.ipcRenderer) {
    window.ipcRenderer.on('show-screen-picker', (event, sources) => {
        const modal = document.getElementById('screen-picker-modal'); const overlay = document.getElementById('modal-overlay'); const grid = document.getElementById('screen-picker-grid');
        grid.innerHTML = '';
        sources.forEach(source => {
            const item = document.createElement('div'); item.className = 'screen-option'; item.innerHTML = `<img src="${source.thumbnailDataUrl}" alt="${source.name}"><span>${source.name}</span>`;
            item.onclick = () => { window.ipcRenderer.send('screen-picker-result', source.id); modal.style.display = 'none'; overlay.style.display = 'none'; };
            grid.appendChild(item);
        });
        modal.style.display = 'flex'; overlay.style.display = 'block';
    });
}
document.getElementById('cancel-screen-picker')?.addEventListener('click', () => { if(window.ipcRenderer) window.ipcRenderer.send('screen-picker-result', null); document.getElementById('screen-picker-modal').style.display = 'none'; document.getElementById('modal-overlay').style.display = 'none'; });

// --- YOUTUBE LOGIC ---
window.ytPlayer = null; window.pendingYtVideoId = null; window.ytQueue = []; window.currentQueueIndex = -1;
function extractYouTubeId(url) {
    if (!url) return null;
    try {
        const u = new URL(url.trim()); const host = u.hostname.replace(/^www\./, '').replace(/^m\./, ''); let id = null;
        if (host === 'youtu.be') id = u.pathname.split('/')[1];
        else if (host === 'youtube.com' || host === 'music.youtube.com') { if (u.pathname === '/watch') id = u.searchParams.get('v'); else { const match = u.pathname.match(/^\/(embed|shorts|live)\/([^\/]+)/); if (match) id = match[2]; } }
        return (id && /^[A-Za-z0-9_-]{11}$/.test(id)) ? id : null;
    } catch (e) { return null; }
}
window.ytApiTag = document.createElement('script'); window.ytApiTag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(window.ytApiTag);
window.onYouTubeIframeAPIReady = function () {
    window.ytPlayer = new YT.Player('yt-iframe', { height: '100%', width: '100%', playerVars: { autoplay: 1, origin: window.location.origin }, events: {
        onReady: () => { if (window.pendingYtVideoId) { window.loadAndPlayVideo(window.pendingYtVideoId); window.pendingYtVideoId = null; } },
        onStateChange: (event) => { if (event.data === YT.PlayerState.ENDED) window.playNextInQueue(); },
        onError: () => { window.addChatLine('System', "⚠️ That video can't be played here.", true); window.playNextInQueue(); }
    }});
};
window.loadAndPlayVideo = function(videoId, index = -1) {
    if (!videoId) return;
    document.getElementById('yt-wrapper').style.display = 'flex'; if (index !== -1) window.currentQueueIndex = index;
    if (window.ytPlayer && typeof window.ytPlayer.loadVideoById === 'function') window.ytPlayer.loadVideoById(videoId); else window.pendingYtVideoId = videoId;
    window.renderQueueUI();
}
window.queueVideo = function(videoId, broadcast = true) {
    if (!videoId) return;
    window.ytQueue.push({ id: videoId, title: `Video (${videoId})` });
    if (window.currentQueueIndex === -1) window.playNextInQueue(); else window.renderQueueUI();
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_queue_add', videoId: videoId }));
}
window.playNextInQueue = function() { if (window.ytQueue.length === 0) return; window.currentQueueIndex++; if (window.currentQueueIndex >= window.ytQueue.length) window.currentQueueIndex = 0; window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); }
window.renderQueueUI = function() {
    const listEl = document.getElementById('yt-queue-list'); const countEl = document.getElementById('queue-count');
    if (!listEl) return;
    listEl.innerHTML = ''; countEl.innerText = `${window.ytQueue.length} items`;
    window.ytQueue.forEach((item, index) => {
        const row = document.createElement('div'); row.className = index === window.currentQueueIndex ? 'yt-queue-item active-queue-item' : 'yt-queue-item';
        row.innerHTML = `<span>${index + 1}. ${item.id}</span><div class="yt-queue-controls"><button class="yt-queue-btn" onclick="window.jumpToQueue(${index})" title="Play Now">▶️</button><button class="yt-queue-btn" onclick="window.removeFromQueue(${index})" title="Remove">✕</button></div>`;
        listEl.appendChild(row);
    });
}
window.jumpToQueue = function(index) { window.currentQueueIndex = index; window.loadAndPlayVideo(window.ytQueue[index].id, index); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_jump', index: index })); };
window.removeFromQueue = function(index) { window.ytQueue.splice(index, 1); if (index === window.currentQueueIndex) window.playNextInQueue(); else if (index < window.currentQueueIndex) window.currentQueueIndex--; window.renderQueueUI(); };
document.getElementById('yt-queue-add-btn')?.addEventListener('click', () => { const vidId = extractYouTubeId(document.getElementById('yt-url-input').value); if (vidId) { window.queueVideo(vidId, true); document.getElementById('yt-url-input').value = ''; window.addChatLine('System', `➕ Added video to queue`, true); } else alert("Invalid Link!"); });
document.getElementById('yt-play-btn')?.addEventListener('click', () => { const vidId = extractYouTubeId(document.getElementById('yt-url-input').value); if (vidId) { window.ytQueue.unshift({ id: vidId, title: `Video (${vidId})` }); window.loadAndPlayVideo(vidId, 0); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_load', videoId: vidId })); document.getElementById('yt-url-input').value = ''; } else alert("Invalid Link!"); });
document.getElementById('yt-skip-btn')?.addEventListener('click', () => { window.playNextInQueue(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_skip' })); });
document.getElementById('toggle-queue-btn')?.addEventListener('click', () => { const drawer = document.getElementById('yt-queue-drawer'); drawer.style.display = drawer.style.display === 'flex' ? 'none' : 'flex'; });
document.getElementById('yt-playpause-btn')?.addEventListener('click', () => { if (!window.ytPlayer || typeof window.ytPlayer.getPlayerState !== 'function') return; if (window.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) { window.ytPlayer.pauseVideo(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_pause' })); } else { window.ytPlayer.playVideo(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_play' })); } });
document.getElementById('toggle-yt-view')?.addEventListener('click', () => { const wrapper = document.getElementById('yt-wrapper'); wrapper.style.display = (wrapper.style.display === 'none') ? 'flex' : 'none'; });

// --- SOUNDBOARD ---
document.getElementById('add-sound-btn')?.addEventListener('click', () => document.getElementById('add-sound-upload').click());
document.getElementById('add-sound-upload')?.addEventListener('change', (event) => {
    const file = event.target.files[0]; if (!file) return;
    const audioUrl = URL.createObjectURL(file); const tempAudio = new Audio(audioUrl);
    tempAudio.onloadedmetadata = () => {
        if (tempAudio.duration > 5) return alert(`Error: Audio must be 5 seconds or less.`);
        const btn = document.createElement('button'); btn.textContent = file.name.split('.')[0]; btn.className = 'secondary-btn';
        btn.onclick = () => {
            const effectAudio = new Audio(audioUrl);
            const outId = localStorage.getItem('appAudioOut'); if (outId && typeof effectAudio.setSinkId === 'function') effectAudio.setSinkId(outId).catch(()=>{});
            if (window.audioCtx) { const source = window.audioCtx.createMediaElementSource(effectAudio); const gainNode = window.audioCtx.createGain(); gainNode.gain.value = Math.min(parseFloat(document.getElementById('effectsVolumeSlider').value), 1); source.connect(gainNode); gainNode.connect(window.audioCtx.destination); gainNode.connect(window.soundboardDest); }
            effectAudio.play();
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'sound_played', userId: window.myId, soundName: btn.textContent }));
        };
        document.getElementById('soundboard-buttons').appendChild(btn);
    };
});

// --- CHAT ENGINE (Local Echo Fix) ---
window.addChatLine = function(author, text, isSystem = false) {
    const chatMessagesEl = document.getElementById('chat-messages'); if(!chatMessagesEl) return;
    const line = document.createElement('div'); line.className = isSystem ? 'chat-line chat-system' : 'chat-line';
    let safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--accent-main); font-weight: 900;">$1</strong>');
    if (isSystem) line.innerHTML = safeText; else line.innerHTML = `<span class="chat-author">${author}:</span> <span>${safeText}</span>`;
    chatMessagesEl.appendChild(line); chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
};

document.getElementById('chat-send-btn')?.addEventListener('click', () => {
    const chatInput = document.getElementById('chat-input');
    const text = chatInput ? chatInput.value.trim() : ''; 
    if (!text) return;
    
    if (chatInput) chatInput.value = ''; 
    const name = document.getElementById('display-username')?.textContent || 'You';
    
    window.addChatLine(name, text); // Render locally instantly
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: name, text: text }));
    }
});
document.getElementById('chat-input')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('chat-send-btn').click(); });

// --- SETTINGS & BOOT ---
window.defaultTheme = { bg: '#050a06', panel: 'rgba(13, 26, 16, 0.75)', text: '#ecfdf5', accent: '#10b981' };
function loadTheme() {
    const savedTheme = JSON.parse(localStorage.getItem('appTheme')) || window.defaultTheme;
    document.documentElement.style.setProperty('--bg-base', savedTheme.bg); document.documentElement.style.setProperty('--panel-bg', savedTheme.panel); document.documentElement.style.setProperty('--text-main', savedTheme.text); document.documentElement.style.setProperty('--accent-main', savedTheme.accent); 
    const cb = document.getElementById('color-bg'); if(cb) cb.value = savedTheme.bg;
    const cp = document.getElementById('color-panel'); if(cp) cp.value = savedTheme.panel.startsWith('rgba') ? '#0c1a10' : savedTheme.panel; 
    const ct = document.getElementById('color-text'); if(ct) ct.value = savedTheme.text;
    const ca = document.getElementById('color-accent'); if(ca) ca.value = savedTheme.accent;
}
loadTheme();
document.getElementById('settings-btn')?.addEventListener('click', () => {
    const configView = document.getElementById('config-view');
    if (configView.style.display === 'none' || !configView.style.display) {
        configView.style.display = 'flex'; document.querySelectorAll('.floating-panel').forEach(p => p.style.zIndex = 50); configView.style.zIndex = 51;
        if (configView.style.left === '50%') configView.style.left = `calc(50% - 250px)`;
        anime({ targets: configView, opacity: [0, 1], translateY: [20, 0], scale: [0.95, 1], duration: 400, easing: 'easeOutQuart' });
    } else anime({ targets: configView, opacity: [1, 0], translateY: [0, 20], scale: [1, 0.95], duration: 200, easing: 'easeInQuart', complete: () => configView.style.display = 'none' });
});
document.getElementById('username-input')?.addEventListener('input', (e) => { document.getElementById('display-username').textContent = e.target.value.trim() || 'You'; });
document.getElementById('save-theme-btn')?.addEventListener('click', () => {
    localStorage.setItem('appUsername', document.getElementById('username-input').value.trim());
    localStorage.setItem('appTheme', JSON.stringify({ bg: document.getElementById('color-bg').value, panel: document.getElementById('color-panel').value, text: document.getElementById('color-text').value, accent: document.getElementById('color-accent').value }));
    loadTheme(); document.getElementById('settings-btn').click(); 
});
document.getElementById('reset-theme-btn')?.addEventListener('click', () => { localStorage.setItem('appTheme', JSON.stringify(window.defaultTheme)); loadTheme(); });
document.getElementById('leave-room-btn')?.addEventListener('click', () => {
    Object.values(window.peers).forEach(pc => pc.close());
    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.close();
    window.location.href = 'index.html';
});

window.onload = () => {
    const savedName = localStorage.getItem('appUsername') || 'You';
    const ui = document.getElementById('username-input'); if(ui) ui.value = savedName === 'You' ? '' : savedName;
    const du = document.getElementById('display-username'); if(du) du.textContent = savedName;
    const savedAvatar = localStorage.getItem('appAvatar');
    if (savedAvatar) { document.getElementById('config-avatar-preview').src = savedAvatar; document.getElementById('user-avatar').src = savedAvatar; }
    populateDevices();
};
if (window.ipcRenderer) {
    const startupToggle = document.getElementById('startup-toggle');
    if (startupToggle) {
        startupToggle.checked = localStorage.getItem('conflictStartup') === 'true';
        startupToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked; localStorage.setItem('conflictStartup', isChecked); window.ipcRenderer.send('toggle-startup', isChecked);
        });
    }
    window.ipcRenderer.on('update-status', (event, data) => {
        const overlay = document.getElementById('update-overlay'); const msgEl = document.getElementById('update-msg');
        if (data.status === 'checking' || data.status === 'downloading') { overlay.style.display = 'flex'; if (msgEl) msgEl.innerText = data.msg; } else { overlay.style.display = 'none'; }
    });
    window.ipcRenderer.on('update-progress', (event, percent) => { const bar = document.getElementById('update-progress-bar'); if (bar) bar.style.width = `${percent}%`; });
}
