const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Define a secure, unlimited save location on the user's hard drive 
// (e.g., C:\Users\YourName\.conflict_vtt_map.txt)
const mapSavePath = path.join(os.homedir(), '.conflict_vtt_map.txt');
// ==========================================
// 1. WEBSOCKET & WEBRTC ENGINE
// ==========================================
const serverUrl = localStorage.getItem('conflictServerUrl') || 'ws://localhost:8080';
let socket;
let reconnectAttempts = 0;
let reconnectTimer = null;

let audioCtx = null;
let soundboardDest = null;
let soundboardTrack = null;

const myId = Math.random().toString(36).substring(2, 10); 
const peers = {}; 
const peerNames = {}; 
const peerAvatars = {}; 
const iceCandidateQueue = {};

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' } 
    ]
};

let localMicStream = null;
let localScreenStream = null;
let localCamStream = null;

let currentView = 'main';

// Tab Switching
// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const tabId = btn.dataset.tab;
        document.getElementById('main-view').style.display = 'none';
        document.getElementById('rpg-view').style.display = 'none';
        document.getElementById('sheets-view').style.display = 'none';
        
        if (tabId === 'main') {
            document.getElementById('main-view').style.display = 'flex';
            currentView = 'main';
        } else if (tabId === 'rpg') {
            document.getElementById('rpg-view').style.display = 'flex';
            currentView = 'rpg';
            initCanvas(); 
        } else if (tabId === 'sheets') {
            document.getElementById('sheets-view').style.display = 'flex';
            currentView = 'sheets';
        }
    });
});

function addLocalTracksSafely(pc) {
    const senders = pc.getSenders();
    const sentTracks = senders.map(s => s.track).filter(Boolean);

    const tracksToAdd = [];
    if (localMicStream) tracksToAdd.push(...localMicStream.getTracks());
    if (localScreenStream) tracksToAdd.push(...localScreenStream.getTracks());
    if (localCamStream) tracksToAdd.push(...localCamStream.getTracks());
    if (soundboardTrack) tracksToAdd.push(soundboardTrack);

    tracksToAdd.forEach(track => {
        if (!sentTracks.includes(track)) {
            pc.addTrack(track, localMicStream || localScreenStream || localCamStream || soundboardDest.stream);
        }
    });
}

async function handleRemoteDescription(pc, remoteUserId, desc) {
    await pc.setRemoteDescription(desc);
    if (iceCandidateQueue[remoteUserId]) {
        while (iceCandidateQueue[remoteUserId].length > 0) {
            const cand = iceCandidateQueue[remoteUserId].shift();
            await pc.addIceCandidate(cand);
        }
    }
}

function connectSocket() {
    socket = new WebSocket(serverUrl);

    socket.onopen = () => {
        console.log("🟢 Connected to signaling server.");
        reconnectAttempts = 0;
        clearTimeout(reconnectTimer);

        const joinBtn = document.getElementById('join-voice-btn');
        if (joinBtn && !localMicStream) {
            joinBtn.disabled = false;
            joinBtn.innerText = "🎙️ Join Call";
        }

        const chatInput = document.getElementById('chat-input');
        const chatBtn = document.getElementById('chat-send-btn');
        if (chatInput && chatBtn) {
            chatInput.disabled = false;
            chatBtn.disabled = false;
            chatInput.placeholder = '🟢 Connected! Message the room...';
        }
    };

    socket.onerror = (error) => {
        console.error("WebSocket Error:", error);
    };

    // This was the main gap: previously there was no onclose handler at all, so
    // once a connection dropped for ANY reason (host hiccup, tunnel restart, wifi
    // blip) the client just sat there dead with no way back in short of a full
    // relaunch. Now it retries with backoff (2s, 4s, 8s... capped at 30s) until
    // the room is reachable again.
    socket.onclose = () => {
        const chatInput = document.getElementById('chat-input');
        const chatBtn = document.getElementById('chat-send-btn');
        reconnectAttempts++;
        const delaySec = Math.min(30, Math.pow(2, reconnectAttempts));
        if (chatInput && chatBtn) {
            chatInput.placeholder = `🟡 Disconnected — reconnecting in ${delaySec}s...`;
            chatInput.disabled = true;
            chatBtn.disabled = true;
        }
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSocket, delaySec * 1000);
    };

    socket.onmessage = async (event) => {
    try {
        const data = JSON.parse(event.data);
        
        if (data.action === 'join' && data.userId !== myId) {
            peerNames[data.userId] = data.username || "Guest";
            peerAvatars[data.userId] = data.avatar || null;
            addRemoteUserCard(data.userId, peerNames[data.userId], peerAvatars[data.userId]);
            
            let pc = peers[data.userId] || createPeerConnection(data.userId);
            addLocalTracksSafely(pc);
            
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.send(JSON.stringify({ 
                action: 'offer', userId: myId, targetId: data.userId, 
                username: document.getElementById('display-username').textContent,
                avatar: localStorage.getItem('appAvatar') || null, offer: offer 
            }));
        }
        else if (data.action === 'remove_video') {
            // Explicitly destroy the frozen video container on the remote peer's screen
            const vid1 = document.getElementById(`video-container-${data.streamId}`);
            if (vid1) vid1.remove();
            
            const vid2 = document.getElementById(`video-container-${data.trackId}`);
            if (vid2) vid2.remove();
        }
        else if (data.action === 'offer' && data.targetId === myId) {
            // FIX: Only update name and avatar if they are actually included in this payload!
            if (data.username) {
                peerNames[data.userId] = data.username;
            } else if (!peerNames[data.userId]) {
                peerNames[data.userId] = "Guest";
            }
            
            if (data.avatar) {
                peerAvatars[data.userId] = data.avatar;
            }

            addRemoteUserCard(data.userId, peerNames[data.userId], peerAvatars[data.userId]);
            
            let pc = peers[data.userId] || createPeerConnection(data.userId);

            await handleRemoteDescription(pc, data.userId, new RTCSessionDescription(data.offer));
            addLocalTracksSafely(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.send(JSON.stringify({ action: 'answer', userId: myId, targetId: data.userId, answer: answer }));
        }
        else if (data.action === 'set_map_bg') {
            document.getElementById('tabletop-container').style.backgroundImage = `url(${data.image})`;
        }
        else if (data.action === 'claim_dm') {
            addChatLine('System', `👑 ${data.username} is now the Dungeon Master.`, true);
            const dmBtn = document.getElementById('claim-dm-btn');
            // If someone else claimed it, lock the button
            if (data.userId !== myId) {
                dmBtn.innerText = `👑 DM: ${data.username}`;
                dmBtn.disabled = true;
                dmBtn.style.borderColor = "var(--border-color)";
                dmBtn.style.color = "var(--text-muted)";
            }
        }
        else if (data.action === 'release_dm') {
            addChatLine('System', `👑 The Dungeon Master role is now open.`, true);
            const dmBtn = document.getElementById('claim-dm-btn');
            dmBtn.innerText = `👑 Claim DM`;
            dmBtn.disabled = false;
            dmBtn.style.borderColor = "#fbbf24";
            dmBtn.style.color = "#fbbf24";
        }

        else if (data.action === 'toggle_fog') {
            const fog = document.getElementById('fog-canvas');
            if (fog) {
                if (data.enabled) {
                    fog.style.display = 'block';
                    const fCtx = fog.getContext('2d');
                    fCtx.fillStyle = '#000000';
                    fCtx.fillRect(0, 0, fog.width, fog.height);
                } else {
                    fog.style.display = 'none';
                }
            }
        }
        else if (data.action === 'fog_reveal' && data.userId !== myId) {
            if (fogCtx) {
                fogCtx.globalCompositeOperation = 'destination-out';
                fogCtx.beginPath();
                fogCtx.arc(data.x, data.y, data.radius, 0, Math.PI * 2);
                fogCtx.fill();
            }
        }
        else if (data.action === 'answer' && data.targetId === myId) {
            if (peers[data.userId]) {
                await handleRemoteDescription(peers[data.userId], data.userId, new RTCSessionDescription(data.answer));
            }
        }
        else if (data.action === 'ice-candidate' && data.targetId === myId) {
            if (peers[data.userId]) {
                const pc = peers[data.userId];
                const candidate = new RTCIceCandidate(data.candidate);
                if (pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(candidate);
                } else {
                    if (!iceCandidateQueue[data.userId]) iceCandidateQueue[data.userId] = [];
                    iceCandidateQueue[data.userId].push(candidate);
                }
            }
        }
        else if (data.action === 'chat_message') {
            addChatLine(data.username || 'Guest', data.text || '');
        }
        else if (data.action === 'dice_roll' && data.userId !== myId) {
            const rollerName = data.username || 'Guest';
            addChatLine('System', `🎲 ${rollerName} rolled ${data.results.join(', ')} (${data.type})`, true);
            
            const sides = parseInt(data.type.replace(/^\d+d/, '')) || 20;

            if (currentView === 'rpg') {
                animateDiceRoll2D(data.results, data.type.replace(/\d+/, '')); 
            } 
            
            if (data.results.includes(sides)) {
                triggerFireworks();
            }
        }
        else if (data.action === 'token_add' && data.userId !== myId) {
            placeTokenOnMap(data.token, false);
        }
        else if (data.action === 'token_move' && data.userId !== myId) {
            const el = document.getElementById('map-token-' + data.tokenId);
            if (el) {
                el.style.left = data.x + 'px';
                el.style.top = data.y + 'px';
            }
        }
        else if (data.action === 'token_remove' && data.userId !== myId) {
            const el = document.getElementById('map-token-' + data.tokenId);
            if (el) el.remove();
        }
        else if (data.action === 'canvas_draw' && data.userId !== myId) {
            if (ctx) {
                ctx.beginPath();
                ctx.moveTo(data.x0, data.y0);
                ctx.lineTo(data.x1, data.y1);
                ctx.strokeStyle = data.color;
                ctx.lineWidth = data.width;
                ctx.stroke();
            }
        }
        else if (data.action === 'canvas_clear' && data.userId !== myId) {
            if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        else if (data.action === 'yt_load') {
            ytQueue.unshift({ id: data.videoId });
            loadAndPlayVideo(data.videoId, 0);
            addChatLine('System', `▶️ Playing new YouTube Video`, true);
        }
        else if (data.action === 'yt_queue_add') {
            ytQueue.push({ id: data.videoId });
            renderQueueUI();
            addChatLine('System', `➕ A user added a video to the queue`, true);
        }
        else if (data.action === 'yt_skip' || data.action === 'yt_jump') {
            if (data.action === 'yt_jump') {
                currentQueueIndex = data.index;
            } else {
                currentQueueIndex++;
            }
            if (ytQueue[currentQueueIndex]) {
                loadAndPlayVideo(ytQueue[currentQueueIndex].id, currentQueueIndex);
            }
        }
        else if (data.action === 'yt_pause') {
            if (ytPlayer && ytPlayer.getPlayerState() !== YT.PlayerState.PAUSED) ytPlayer.pauseVideo();
        }
        else if (data.action === 'yt_play') {
            if (ytPlayer && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) ytPlayer.playVideo();
        }
        else if (data.action === 'sound_played' && data.userId !== myId) {
            addChatLine('System', `🔊 Sound played: ${data.soundName}`, true);
        }
    } catch (e) {
        console.error("Error parsing message:", e);
    }
    };
}

connectSocket();

// Runs once for the app's lifetime (not per-connection), so reconnects don't
// stack up duplicate intervals sending multiple keep_alive pings per tick.
setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'keep_alive' }));
    }
}, 15000);

function createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection(rtcConfig);
    peers[remoteUserId] = pc;

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({ action: 'ice-candidate', userId: myId, targetId: remoteUserId, candidate: event.candidate }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            const card = document.getElementById(`user-card-${remoteUserId}`);
            if (card) card.remove();
            
            document.querySelectorAll(`.stream-${remoteUserId}`).forEach(el => el.remove());
            document.querySelectorAll(`[id*="${remoteUserId}"]`).forEach(el => {
                if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') el.remove();
            });
            delete peers[remoteUserId];
            delete iceCandidateQueue[remoteUserId];
        }
    };

    pc.ontrack = (event) => {
        const stream = event.streams && event.streams[0];
        const streamId = stream ? stream.id : event.track.id;
        
        if (event.track.kind === 'audio') {
            let remoteAudio = document.getElementById(`audio-${streamId}`);
            if (!remoteAudio) {
                remoteAudio = document.createElement('audio');
                remoteAudio.id = `audio-${streamId}`;
                remoteAudio.autoplay = true;
                remoteAudio.muted = false;
                
                const outId = localStorage.getItem('appAudioOut');
                if (outId && typeof remoteAudio.setSinkId === 'function') {
                    remoteAudio.setSinkId(outId).catch(e => console.warn('Sink error:', e));
                }

                document.getElementById('remote-audio-container').appendChild(remoteAudio);
                addRemoteUserCard(remoteUserId, peerNames[remoteUserId] || "Guest", peerAvatars[remoteUserId]);

                const slider = document.getElementById(`vol-${remoteUserId}`);
                if (slider) {
                    remoteAudio.volume = Math.min(parseFloat(slider.value), 1);
                    slider.addEventListener('input', (e) => remoteAudio.volume = Math.min(parseFloat(e.target.value), 1));
                }
            }
            if (stream) {
                if (remoteAudio.srcObject !== stream) remoteAudio.srcObject = stream;
            } else {
                if (!remoteAudio.srcObject) remoteAudio.srcObject = new MediaStream([event.track]);
            }
            remoteAudio.play().catch(e => console.warn("Audio autoplay blocked:", e));
        }
        
        if (event.track.kind === 'video') {
            let videoContainer = document.getElementById(`video-container-${streamId}`);
            let remoteVideo = document.getElementById(`video-${streamId}`);

            if (!videoContainer) {
                videoContainer = document.createElement('div');
                videoContainer.id = `video-container-${streamId}`;
                videoContainer.className = `stream-container stream-${remoteUserId}`;
                
                const label = document.createElement('div');
                label.className = "stream-label";
                label.innerText = `${peerNames[remoteUserId] || 'Friend'}'s Video`;

                remoteVideo = document.createElement('video');
                remoteVideo.id = `video-${streamId}`;
                remoteVideo.autoplay = true;
                remoteVideo.playsInline = true;
                remoteVideo.muted = false; 
                remoteVideo.controls = true; 

                videoContainer.appendChild(label);
                videoContainer.appendChild(remoteVideo);
                document.getElementById('video-grid').appendChild(videoContainer);
            }
            
            if (stream) {
                if (remoteVideo.srcObject !== stream) remoteVideo.srcObject = stream;
            } else {
                if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream([event.track]);
            }

            remoteVideo.play().catch(e => console.warn("Video autoplay blocked:", e));
            event.track.onended = () => { if (videoContainer) videoContainer.remove(); };
        }
    };

    return pc;
}

function addRemoteUserCard(userId, username, avatarDataUrl) {
    const callArea = document.querySelector('.call-area');
    let card = document.getElementById(`user-card-${userId}`);
    const avatarSrc = avatarDataUrl || 'https://via.placeholder.com/50';
    if (!card) {
        card = document.createElement('div');
        card.className = 'user-card';
        card.id = `user-card-${userId}`;
        card.innerHTML = `
            <div class="avatar-wrapper">
                <img src="${avatarSrc}" class="avatar" alt="Avatar">
            </div>
            <div class="user-info">
                <span class="username">${username}</span>
                <input type="range" class="volume-slider" id="vol-${userId}" min="0" max="1" step="0.05" value="0.8">
            </div>
        `;
        callArea.appendChild(card);

        const slider = document.getElementById(`vol-${userId}`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                const vol = Math.min(parseFloat(e.target.value), 1);
                document.querySelectorAll(`[id*="${userId}"]`).forEach(el => {
                    if (typeof el.volume !== 'undefined') el.volume = vol;
                });
            });
        }
    } else {
        const nameSpan = card.querySelector('.username');
        if (nameSpan && username) nameSpan.textContent = username;
        const imgEl = card.querySelector('.avatar');
        if (imgEl && avatarDataUrl) imgEl.src = avatarDataUrl;
    }
}

// ==========================================
// 2. HARDWARE MANAGERS & CALL LOGIC
// ==========================================
let isMuted = false;

async function populateDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(()=>{});
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioIn = document.getElementById('audio-in-select');
        const audioOut = document.getElementById('audio-out-select');
        const videoIn = document.getElementById('video-in-select');

        audioIn.innerHTML = '<option value="">Default Microphone</option>';
        audioOut.innerHTML = '<option value="">Default Speakers</option>';
        videoIn.innerHTML = '<option value="">Default Camera</option>';

        devices.forEach(device => {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.text = device.label || `${device.kind} (${device.deviceId.substring(0, 5)})`;
            
            if (device.kind === 'audioinput') audioIn.appendChild(opt);
            else if (device.kind === 'audiooutput') audioOut.appendChild(opt);
            else if (device.kind === 'videoinput') videoIn.appendChild(opt);
        });

        audioIn.value = localStorage.getItem('appAudioIn') || '';
        audioOut.value = localStorage.getItem('appAudioOut') || '';
        videoIn.value = localStorage.getItem('appVideoIn') || '';
    } catch (err) {
        console.error("Device fetch error:", err);
    }
}
document.getElementById('refresh-devices-btn').addEventListener('click', populateDevices);

async function applyAudioOutput(deviceId) {
    if (typeof document.createElement('audio').setSinkId !== 'undefined') {
        document.querySelectorAll('audio, video').forEach(async el => {
            try { await el.setSinkId(deviceId); } catch(e){}
        });
    }
}

document.getElementById('join-voice-btn').addEventListener('click', async () => {
    let micSuccess = false;
    
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            soundboardDest = audioCtx.createMediaStreamDestination();
            soundboardTrack = soundboardDest.stream.getAudioTracks()[0];
        }
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        const micId = localStorage.getItem('appAudioIn');
        const constraints = micId ? 
            { audio: { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true } } : 
            { audio: { echoCancellation: true, noiseSuppression: true } };

        localMicStream = await navigator.mediaDevices.getUserMedia(constraints);
        micSuccess = true;
    } catch (error) {
        console.error("Could not access microphone:", error);
        alert("Microphone blocked or not detected! Joining as a Listener. (Check your OS Privacy settings to allow Desktop Apps to use the microphone).");
    }

    // WE JOIN THE WEBRTC ROOM REGARDLESS OF MIC SUCCESS!
    Object.values(peers).forEach(pc => addLocalTracksSafely(pc));

    const currentName = document.getElementById('display-username').textContent;
    socket.send(JSON.stringify({ action: 'join', userId: myId, username: currentName, avatar: localStorage.getItem('appAvatar') || null }));
    
    document.getElementById('join-voice-btn').disabled = true;
    document.getElementById('join-voice-btn').innerText = micSuccess ? "🎙️ Connected" : "🎧 Listening";
    
    if (micSuccess) {
        document.getElementById('mute-mic-btn').disabled = false;
    }
});

document.getElementById('mute-mic-btn').addEventListener('click', (e) => {
    if (localMicStream) {
        isMuted = !isMuted;
        localMicStream.getAudioTracks()[0].enabled = !isMuted;
        e.target.innerText = isMuted ? "🔈 Unmute" : "🔇 Mute";
        e.target.style.color = isMuted ? "var(--accent-alert)" : "var(--text-main)";
        e.target.style.borderColor = isMuted ? "var(--accent-alert)" : "var(--border-color)";
    }
});

document.getElementById('toggle-cam-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    const localCam = document.getElementById('local-cam-video');

   if (localCamStream) {
        // NEW: Tell the room to destroy the frozen video container immediately
        const streamId = localCamStream.id;
        const trackId = localCamStream.getVideoTracks()[0]?.id;
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'remove_video', streamId, trackId }));
        }

        localCamStream.getTracks().forEach(t => {
            t.stop();
            Object.values(peers).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track === t);
                if (sender) pc.removeTrack(sender);
            });
        });
        
        localCam.style.display = 'none';
        localCam.srcObject = null;
        localCamStream = null;
        
        btn.innerText = "📷 Camera";
        btn.classList.replace('primary-btn', 'secondary-btn');
        
        for (const [remoteUserId, pc] of Object.entries(peers)) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ action: 'offer', userId: myId, targetId: remoteUserId, offer: offer }));
                }
            } catch (err) { console.error("Renegotiation error:", err); }
        }
    } else {
        try {
            const camId = localStorage.getItem('appVideoIn');
            const constraints = camId ? { video: { deviceId: { exact: camId } } } : { video: true };
            localCamStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            localCam.style.display = 'block';
            localCam.srcObject = localCamStream;
            
            btn.innerText = "📷 Stop Cam";
            btn.classList.replace('secondary-btn', 'primary-btn');

            for (const [remoteUserId, pc] of Object.entries(peers)) {
                addLocalTracksSafely(pc);
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ action: 'offer', userId: myId, targetId: remoteUserId, offer: offer }));
                    }
                } catch (err) { console.error("Renegotiation error:", err); }
            }
        } catch (err) {
            console.error("Camera error:", err);
            alert("Could not start camera!");
        }
    }
});

const shareScreenBtn = document.getElementById('share-screen-btn');
const localVideo = document.getElementById('local-screen-video'); 

shareScreenBtn.addEventListener('click', async () => {
    if (localScreenStream) {
        // NEW: Tell the room to destroy the frozen screen share container immediately
        const streamId = localScreenStream.id;
        const trackId = localScreenStream.getVideoTracks()[0]?.id;
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'remove_video', streamId, trackId }));
        }

        localScreenStream.getTracks().forEach(t => t.stop());
        if (localScreenStream.getVideoTracks().length > 0) {
            localScreenStream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
        }
        return;
    }

    try {
        localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
        
        shareScreenBtn.innerText = "💻 Stop Share";
        shareScreenBtn.classList.replace('secondary-btn', 'primary-btn');

        localVideo.style.display = 'block';
        localVideo.srcObject = localScreenStream;
        localVideo.controls = true; 

        for (const [remoteUserId, pc] of Object.entries(peers)) {
            addLocalTracksSafely(pc);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ action: 'offer', userId: myId, targetId: remoteUserId, offer: offer }));
                }
            } catch (err) { console.error("Renegotiation error:", err); }
        }

        localScreenStream.getVideoTracks()[0].onended = async () => {
            localVideo.style.display = 'none';
            localVideo.srcObject = null;
            shareScreenBtn.innerText = "💻 Share Screen";
            shareScreenBtn.classList.replace('primary-btn', 'secondary-btn');
            
            for (const [remoteUserId, pc] of Object.entries(peers)) {
                pc.getSenders().forEach(sender => {
                    if (sender.track && sender.track.kind === 'video' && !localCamStream?.getTracks().includes(sender.track)) {
                        pc.removeTrack(sender);
                    }
                });
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'offer', userId: myId, targetId: remoteUserId, offer: offer }));
                } catch (e) {}
            }
            localScreenStream = null;
        };
    } catch (error) {
        console.log("Screen share canceled.");
    }
});

ipcRenderer.on('show-screen-picker', (event, sources) => {
    const modal = document.getElementById('screen-picker-modal');
    const overlay = document.getElementById('modal-overlay');
    const grid = document.getElementById('screen-picker-grid');
    
    grid.innerHTML = '';
    sources.forEach(source => {
        const item = document.createElement('div');
        item.className = 'screen-option';
        item.innerHTML = `
            <img src="${source.thumbnailDataUrl}" alt="${source.name}">
            <span>${source.name}</span>
        `;
        item.onclick = () => {
            ipcRenderer.send('screen-picker-result', source.id);
            modal.style.display = 'none';
            overlay.style.display = 'none';
        };
        grid.appendChild(item);
    });

    modal.style.display = 'flex';
    overlay.style.display = 'block';
});

document.getElementById('cancel-screen-picker').onclick = () => {
    ipcRenderer.send('screen-picker-result', null);
    document.getElementById('screen-picker-modal').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
};

// ==========================================
// 3. FRONTEND YOUTUBE PLAYER & QUEUE SYSTEM
// ==========================================
let ytPlayer = null;
let pendingYtVideoId = null;
let ytQueue = [];
let currentQueueIndex = -1;

function extractYouTubeId(url) {
    if (!url) return null;
    try {
        const u = new URL(url.trim());
        const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
        let id = null;
        if (host === 'youtu.be') {
            id = u.pathname.split('/')[1];
        } else if (host === 'youtube.com' || host === 'music.youtube.com') {
            if (u.pathname === '/watch') id = u.searchParams.get('v');
            else {
                const match = u.pathname.match(/^\/(embed|shorts|live)\/([^\/]+)/);
                if (match) id = match[2];
            }
        }
        return (id && /^[A-Za-z0-9_-]{11}$/.test(id)) ? id : null;
    } catch (e) {
        return null;
    }
}

const ytApiTag = document.createElement('script');
ytApiTag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytApiTag);

window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player('yt-iframe', {
        height: '100%',
        width: '100%',
        playerVars: { autoplay: 1, origin: window.location.origin },
        events: {
            onReady: () => {
                if (pendingYtVideoId) {
                    loadAndPlayVideo(pendingYtVideoId);
                    pendingYtVideoId = null;
                }
            },
            onStateChange: (event) => {
                if (event.data === YT.PlayerState.ENDED) playNextInQueue();
            },
            onError: (e) => {
                console.error('YouTube player error:', e.data);
                addChatLine('System', "⚠️ That video can't be played here.", true);
                playNextInQueue();
            }
        }
    });
};

function loadAndPlayVideo(videoId, index = -1) {
    if (!videoId) return;
    document.getElementById('yt-wrapper').style.display = 'flex';
    if (index !== -1) currentQueueIndex = index;
    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById(videoId);
    } else {
        pendingYtVideoId = videoId;
    }
    renderQueueUI();
}

function queueVideo(videoId, broadcast = true) {
    if (!videoId) return;
    ytQueue.push({ id: videoId, title: `Video (${videoId})` });
    if (currentQueueIndex === -1) playNextInQueue();
    else renderQueueUI();

    if (broadcast && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'yt_queue_add', videoId: videoId }));
    }
}

function playNextInQueue() {
    if (ytQueue.length === 0) return;
    currentQueueIndex++;
    if (currentQueueIndex >= ytQueue.length) currentQueueIndex = 0; 
    loadAndPlayVideo(ytQueue[currentQueueIndex].id, currentQueueIndex);
}

function renderQueueUI() {
    const listEl = document.getElementById('yt-queue-list');
    const countEl = document.getElementById('queue-count');
    if (!listEl) return;

    listEl.innerHTML = '';
    countEl.innerText = `${ytQueue.length} items`;

    ytQueue.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = index === currentQueueIndex ? 'yt-queue-item active-queue-item' : 'yt-queue-item';
        row.innerHTML = `
            <span>${index + 1}. ${item.id}</span>
            <div class="yt-queue-controls">
                <button class="yt-queue-btn" onclick="jumpToQueue(${index})" title="Play Now">▶️</button>
                <button class="yt-queue-btn" onclick="removeFromQueue(${index})" title="Remove">✕</button>
            </div>
        `;
        listEl.appendChild(row);
    });
}

window.jumpToQueue = function(index) {
    currentQueueIndex = index;
    loadAndPlayVideo(ytQueue[index].id, index);
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'yt_jump', index: index }));
    }
};

window.removeFromQueue = function(index) {
    ytQueue.splice(index, 1);
    if (index === currentQueueIndex) playNextInQueue();
    else if (index < currentQueueIndex) currentQueueIndex--;
    renderQueueUI();
};

document.getElementById('yt-queue-add-btn').addEventListener('click', () => {
    const url = document.getElementById('yt-url-input').value;
    const vidId = extractYouTubeId(url);
    if (vidId) {
        queueVideo(vidId, true);
        document.getElementById('yt-url-input').value = '';
        addChatLine('System', `➕ Added video to queue`, true);
    } else alert("Invalid YouTube Link!");
});

document.getElementById('yt-play-btn').addEventListener('click', () => {
    const url = document.getElementById('yt-url-input').value;
    const vidId = extractYouTubeId(url);
    if (vidId) {
        ytQueue.unshift({ id: vidId, title: `Video (${vidId})` });
        loadAndPlayVideo(vidId, 0);
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'yt_load', videoId: vidId }));
        }
        document.getElementById('yt-url-input').value = '';
    } else alert("Invalid YouTube Link!");
});

document.getElementById('yt-skip-btn').addEventListener('click', () => {
    playNextInQueue();
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'yt_skip' }));
});

document.getElementById('toggle-queue-btn').addEventListener('click', () => {
    const drawer = document.getElementById('yt-queue-drawer');
    drawer.style.display = drawer.style.display === 'flex' ? 'none' : 'flex';
});

document.getElementById('yt-playpause-btn').addEventListener('click', () => {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
    if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'yt_pause' })); 
    } else {
        ytPlayer.playVideo();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'yt_play' }));
    }
});

document.getElementById('toggle-yt-view').addEventListener('click', () => {
    const wrapper = document.getElementById('yt-wrapper');
    wrapper.style.display = (wrapper.style.display === 'none') ? 'flex' : 'none';
});

// ==========================================
// SOUNDBOARD SYSTEM
// ==========================================
window.activeSounds = [];
document.getElementById('add-sound-btn').addEventListener('click', () => document.getElementById('add-sound-upload').click());

document.getElementById('add-sound-upload').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const audioUrl = URL.createObjectURL(file);
    const tempAudio = new Audio(audioUrl);
    
    tempAudio.onloadedmetadata = () => {
        if (tempAudio.duration > 5) return alert(`Error: Audio must be 5 seconds or less.`);
        
        const btn = document.createElement('button');
        btn.textContent = file.name.split('.')[0]; 
        btn.className = 'secondary-btn';
        
        btn.onclick = () => {
            const effectAudio = new Audio(audioUrl);
            window.activeSounds.push(effectAudio);
            effectAudio.onended = () => window.activeSounds = window.activeSounds.filter(a => a !== effectAudio);

            const outId = localStorage.getItem('appAudioOut');
            if (outId && typeof effectAudio.setSinkId === 'function') effectAudio.setSinkId(outId).catch(()=>{});

            if (audioCtx) {
                const source = audioCtx.createMediaElementSource(effectAudio);
                const effectsSlider = document.getElementById('effectsVolumeSlider');
                const gainNode = audioCtx.createGain();
                gainNode.gain.value = effectsSlider ? Math.min(parseFloat(effectsSlider.value), 1) : 1;
                
                source.connect(gainNode);
                gainNode.connect(audioCtx.destination); 
                gainNode.connect(soundboardDest);       
            }
            
            effectAudio.play();
            
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ action: 'sound_played', userId: myId, soundName: btn.textContent }));
            }
        };
        document.getElementById('soundboard-buttons').appendChild(btn);
    };
});

// ==========================================
// 4. CHAT SYSTEM
// ==========================================
const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl = document.getElementById('chat-input');
const chatSendBtnEl = document.getElementById('chat-send-btn');

function addChatLine(author, text, isSystem = false) {
    const line = document.createElement('div');
    line.className = isSystem ? 'chat-line chat-system' : 'chat-line';
    if (isSystem) {
        line.textContent = text;
    } else {
        const authorSpan = document.createElement('span');
        authorSpan.className = 'chat-author';
        authorSpan.textContent = author + ':';
        line.appendChild(authorSpan);
        line.appendChild(document.createTextNode(text));
    }
    chatMessagesEl.appendChild(line);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || socket.readyState !== WebSocket.OPEN) return;
    chatInputEl.value = '';

    const currentName = document.getElementById('display-username').textContent;
    socket.send(JSON.stringify({ action: 'chat_message', userId: myId, username: currentName, text: text }));
    addChatLine(currentName, text);
}

if (chatSendBtnEl) chatSendBtnEl.addEventListener('click', sendChatMessage);
if (chatInputEl) chatInputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });

// ==========================================
// 5. CONFIGURATION & THEME
// ==========================================
const defaultTheme = { bg: '#050a06', panel: 'rgba(13, 26, 16, 0.75)', text: '#ecfdf5', accent: '#10b981' };

function loadTheme() {
    const savedTheme = JSON.parse(localStorage.getItem('appTheme')) || defaultTheme;
    document.documentElement.style.setProperty('--bg-base', savedTheme.bg);
    document.documentElement.style.setProperty('--panel-bg', savedTheme.panel);
    document.documentElement.style.setProperty('--text-main', savedTheme.text);
    document.documentElement.style.setProperty('--accent-main', savedTheme.accent); 
    
    document.getElementById('color-bg').value = savedTheme.bg;
    document.getElementById('color-panel').value = savedTheme.panel.startsWith('rgba') ? '#0c1a10' : savedTheme.panel; 
    document.getElementById('color-text').value = savedTheme.text;
    document.getElementById('color-accent').value = savedTheme.accent;
}
loadTheme();

document.getElementById('settings-btn').addEventListener('click', () => {
    const mainView = document.getElementById('main-view');
    const rpgView = document.getElementById('rpg-view');
    const configView = document.getElementById('config-view');
    const isHidden = configView.style.display === 'none';
    
    configView.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
        mainView.style.display = 'none';
        rpgView.style.display = 'none';
    } else {
        if (currentView === 'main') mainView.style.display = 'flex';
        else rpgView.style.display = 'flex';
    }
});

document.getElementById('username-input').addEventListener('input', (e) => {
    document.getElementById('display-username').textContent = e.target.value.trim() || 'You';
});

document.getElementById('audio-in-select').addEventListener('change', (e) => localStorage.setItem('appAudioIn', e.target.value));
document.getElementById('video-in-select').addEventListener('change', (e) => localStorage.setItem('appVideoIn', e.target.value));
document.getElementById('audio-out-select').addEventListener('change', (e) => {
    localStorage.setItem('appAudioOut', e.target.value);
    applyAudioOutput(e.target.value);
});

document.getElementById('save-theme-btn').addEventListener('click', () => {
    localStorage.setItem('appUsername', document.getElementById('username-input').value.trim());
    const newTheme = {
        bg: document.getElementById('color-bg').value,
        panel: document.getElementById('color-panel').value,
        text: document.getElementById('color-text').value,
        accent: document.getElementById('color-accent').value
    };
    localStorage.setItem('appTheme', JSON.stringify(newTheme));
    loadTheme();
    document.getElementById('settings-btn').click(); 
});

document.getElementById('reset-theme-btn').addEventListener('click', () => {
    localStorage.setItem('appTheme', JSON.stringify(defaultTheme));
    loadTheme();
});

document.getElementById('change-avatar-btn').addEventListener('click', () => document.getElementById('avatar-upload').click());
document.getElementById('avatar-upload').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const base64Data = reader.result; 
        document.getElementById('config-avatar-preview').src = base64Data;
        document.getElementById('user-avatar').src = base64Data;
        localStorage.setItem('appAvatar', base64Data);
    };
    reader.readAsDataURL(file);
});

window.onload = () => {
    const savedName = localStorage.getItem('appUsername') || 'You';
    document.getElementById('username-input').value = savedName === 'You' ? '' : savedName;
    document.getElementById('display-username').textContent = savedName;

    const savedAvatar = localStorage.getItem('appAvatar');
    if (savedAvatar) {
        document.getElementById('config-avatar-preview').src = savedAvatar;
        document.getElementById('user-avatar').src = savedAvatar;
    }
    
    populateDevices();
};

document.getElementById('leave-room-btn').addEventListener('click', () => {
    Object.values(peers).forEach(pc => pc.close());
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (localMicStream) localMicStream.getTracks().forEach(t => t.stop());
    if (localCamStream) localCamStream.getTracks().forEach(t => t.stop());
    if (localScreenStream) localScreenStream.getTracks().forEach(t => t.stop());
    window.location.href = 'index.html';
});

// ==========================================
// 6. RPG TABLETOP & DICE ENGINE (2D)
// ==========================================
function triggerFireworks() {
    if (typeof confetti !== 'undefined') {
        var duration = 2 * 1000;
        var end = Date.now() + duration;

        (function frame() {
            confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#10b981', '#fbbf24', '#ffffff'] });
            confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#10b981', '#fbbf24', '#ffffff'] });
            if (Date.now() < end) requestAnimationFrame(frame);
        }());
    }
}

function animateDiceRoll2D(results, shapeType) {
    const diceLayer = document.getElementById('dice-layer');
    if (!diceLayer) return;
    
    diceLayer.innerHTML = ''; 
    const sides = parseInt(shapeType.substring(1)) || 20;
    
    results.forEach((result, index) => {
        const dieEl = document.createElement('div');
        dieEl.className = `die-2d shape-${shapeType}`;
        
        const randomX = (Math.random() * 200 - 100) + (index * 60);
        const randomY = (Math.random() * 200 - 100);
        
        dieEl.style.setProperty('--tx', `${randomX}px`);
        dieEl.style.setProperty('--ty', `${randomY}px`);
        
        const textSpan = document.createElement('span');
        dieEl.appendChild(textSpan);
        diceLayer.appendChild(dieEl);

        let scrambleInterval = setInterval(() => {
            textSpan.innerText = Math.floor(Math.random() * sides) + 1;
        }, 50);

        setTimeout(() => {
            clearInterval(scrambleInterval);
            textSpan.innerText = result;
            if (result === sides) triggerFireworks();
        }, 1000);
    });

    setTimeout(() => {
        Array.from(diceLayer.children).forEach(child => {
            child.style.opacity = '0';
            child.style.transform += ' scale(0.5)';
            setTimeout(() => child.remove(), 500);
        });
    }, 10000); 
}

function rollDice(type, count = 1) {
    const results = [];
    const sides = parseInt(type.substring(1));
    const randomBuffer = new Uint32Array(count);
    window.crypto.getRandomValues(randomBuffer);

    for (let i = 0; i < count; i++) {
        const floatRandom = randomBuffer[i] / (0xffffffff + 1);
        results.push(Math.floor(floatRandom * sides) + 1);
    }
    return results;
}

document.getElementById('roll-dice-btn').addEventListener('click', () => {
    const type = document.getElementById('dice-type').value;
    const count = parseInt(document.getElementById('dice-count').value) || 1;
    const notation = `${count}${type}`;
    const currentName = document.getElementById('display-username').textContent;
    
    const values = rollDice(type, count);
    animateDiceRoll2D(values, type);
    
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            action: 'dice_roll',
            userId: myId,
            username: currentName,
            results: values,
            type: notation
        }));
    }
    
    addChatLine('System', `🎲 You rolled ${values.join(', ')} (${notation})`, true);
});

document.getElementById('toggle-tokens-btn').addEventListener('click', () => {
    const panel = document.getElementById('floating-token-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

// ==========================================
// 7. VTT ENGINE: CANVAS, TOKENS, FOG & DM
// ==========================================
let canvas = null, ctx = null, fogCanvas = null, fogCtx = null;
let isDrawing = false, lastX = 0, lastY = 0, activeToken = null;
let isDM = false;

// Middle-Mouse Panning & Zoom Variables
let isPanning = false;
let startPanX = 0, startPanY = 0, startScrollLeft = 0, startScrollTop = 0;
let currentZoom = 1.0;

// VTT Map & Scroll Containers
const scrollArea = document.getElementById('vtt-scroll-area');
const mapLayer = document.getElementById('vtt-map-layer');

// --- ZOOM LOGIC (Mouse Wheel) ---
scrollArea.addEventListener('wheel', (e) => {
    e.preventDefault(); // Stop standard vertical page scrolling
    
    const zoomStep = 0.1;
    // Scroll Up = Zoom In, Scroll Down = Zoom Out
    if (e.deltaY < 0) {
        currentZoom = Math.min(3.0, currentZoom + zoomStep);
    } else {
        currentZoom = Math.max(0.3, currentZoom - zoomStep);
    }
    
    // Scale the map and set origin to top-left to keep layout math predictable
    mapLayer.style.transform = `scale(${currentZoom})`;
    mapLayer.style.transformOrigin = "0 0";
}, { passive: false }); // Requires passive: false to allow preventDefault()

// --- MIDDLE MOUSE PANNING LOGIC ---
scrollArea.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // Middle Mouse Button Only
        isPanning = true;
        startPanX = e.clientX;
        startPanY = e.clientY;
        startScrollLeft = scrollArea.scrollLeft;
        startScrollTop = scrollArea.scrollTop;
        scrollArea.style.cursor = 'grabbing';
        e.preventDefault(); 
    }
});
window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        scrollArea.scrollLeft = startScrollLeft - (e.clientX - startPanX);
        scrollArea.scrollTop = startScrollTop - (e.clientY - startPanY);
    }
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
        isPanning = false;
        scrollArea.style.cursor = 'grab';
    }
    activeToken = null; // Drop token on mouseup globally
});

// --- DM LOGIC ---
document.getElementById('claim-dm-btn').addEventListener('click', (e) => {
    isDM = !isDM;
    const btn = e.target;
    const controls = document.getElementById('dm-controls');
    const fogBrush = document.getElementById('fog-brush-tool');
    const fogCanvasLayer = document.getElementById('fog-canvas');
    const currentName = document.getElementById('display-username').textContent;
    
    if (isDM) {
        btn.innerText = "👑 Release DM";
        btn.style.background = "#fbbf24";
        btn.style.color = "#000";
        controls.style.display = "flex";
        fogBrush.style.display = "block";
        if (fogCanvasLayer) fogCanvasLayer.style.opacity = "0.5";
        
        if (fs.existsSync(mapSavePath)) document.getElementById('restore-map-btn').style.display = "block";
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'claim_dm', userId: myId, username: currentName}));
    } else {
        btn.innerText = "👑 Claim DM";
        btn.style.background = "transparent";
        btn.style.color = "#fbbf24";
        controls.style.display = "none";
        fogBrush.style.display = "none";
        if (fogCanvasLayer) fogCanvasLayer.style.opacity = "1.0";
        setTool('pen'); 
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'release_dm', userId: myId, username: currentName}));
    }
});

document.getElementById('restore-map-btn').addEventListener('click', () => {
    if (fs.existsSync(mapSavePath)) {
        try {
            const savedMap = fs.readFileSync(mapSavePath, 'utf-8');
            mapLayer.style.backgroundImage = `url(${savedMap})`;
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'set_map_bg', image: savedMap}));
            addChatLine('System', "🗺️ Map restored from hard drive.", true);
        } catch (error) { console.error("Failed to read map file:", error); }
    }
});

document.getElementById('map-upload-btn').addEventListener('click', () => document.getElementById('map-file-input').click());
document.getElementById('map-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const bgData = event.target.result;
        mapLayer.style.backgroundImage = `url(${bgData})`;
        try {
            fs.writeFileSync(mapSavePath, bgData, 'utf-8');
            document.getElementById('restore-map-btn').style.display = "block";
        } catch (error) { console.error("Failed to save map:", error); }
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'set_map_bg', image: bgData}));
    };
    reader.readAsDataURL(file);
});

document.getElementById('toggle-fog-btn').addEventListener('click', (e) => {
    const fog = document.getElementById('fog-canvas');
    if (fog.style.display !== 'none') {
        fog.style.display = 'none';
        e.target.innerText = "🌫️ Enable Fog";
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'toggle_fog', enabled: false}));
    } else {
        fog.style.display = 'block';
        fogCtx.fillStyle = '#000000';
        fogCtx.fillRect(0, 0, fog.width, fog.height);
        e.target.innerText = "🌫️ Disable Fog";
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'toggle_fog', enabled: true}));
    }
});

// --- INTERACTIVE MAP LOGIC ---
window.addEventListener('mousemove', (e) => {
    // Don't drag token if we are panning the map
    if (!activeToken || !mapLayer || !canvas || isPanning) return;
    
    const rect = mapLayer.getBoundingClientRect(); 
    
    // DIVIDE BY ZOOM: Calculates true position regardless of scale
    let mouseX = (e.clientX - rect.left) / currentZoom;
    let mouseY = (e.clientY - rect.top) / currentZoom;

    let snapX = Math.floor(mouseX / 50) * 50 + 25;
    let snapY = Math.floor(mouseY / 50) * 50 + 25;

    activeToken.style.left = Math.max(25, Math.min(canvas.width - 25, snapX)) + 'px';
    activeToken.style.top = Math.max(25, Math.min(canvas.height - 25, snapY)) + 'px';

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'token_move', userId: myId, tokenId: activeToken.id.replace('map-token-', ''), x: snapX, y: snapY }));
    }
});

function initCanvas() {
    canvas = document.getElementById('shared-canvas');
    fogCanvas = document.getElementById('fog-canvas');
    if (!canvas || !fogCanvas) return;
    ctx = canvas.getContext('2d');
    fogCtx = fogCanvas.getContext('2d');
    
    // Check if it's already initialized BEFORE setting width/height to prevent ink wiping
    if (!canvas.dataset.initialized) {
        // Set map to massive 3000x3000 size ONLY ONCE
        canvas.width = 3000; canvas.height = 3000;
        fogCanvas.width = 3000; fogCanvas.height = 3000;
        
        mapLayer.addEventListener('mousedown', startDrawing);
        mapLayer.addEventListener('mousemove', draw);
        mapLayer.addEventListener('mouseup', stopDrawing);
        mapLayer.addEventListener('mouseout', stopDrawing);
        
        document.getElementById('pen-tool').addEventListener('click', () => setTool('pen'));
        document.getElementById('eraser-tool').addEventListener('click', () => setTool('eraser'));
        document.getElementById('fog-brush-tool').addEventListener('click', () => setTool('fog-brush'));
        document.getElementById('clear-canvas-btn').addEventListener('click', () => {
            if (confirm('Clear the ink?')) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'canvas_clear', userId: myId}));
            }
        });
        document.getElementById('stroke-color').addEventListener('change', updateStrokeStyle);
        document.getElementById('stroke-width').addEventListener('input', updateStrokeWidth);
        canvas.dataset.initialized = "true";
    }

    // Always recenter the camera when opening the tab, but don't delete the ink
    setTimeout(() => {
        scrollArea.scrollLeft = 1500 - (scrollArea.clientWidth / 2);
        scrollArea.scrollTop = 1500 - (scrollArea.clientHeight / 2);
    }, 50);
}
let currentTool = 'pen';
let strokeColor = '#10b981';
let strokeWidth = 2;

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tool + '-tool').classList.add('active');
    if (ctx) ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
}

function updateStrokeStyle(e) { strokeColor = e.target.value; if (ctx) ctx.strokeStyle = strokeColor; }
function updateStrokeWidth(e) { 
    strokeWidth = parseInt(e.target.value); 
    if (ctx) { ctx.lineWidth = strokeWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
}

function getMousePosition(e) {
    const rect = canvas.getBoundingClientRect();
    // DIVIDE BY ZOOM: Keeps ink perfectly under your mouse pointer!
    return [(e.clientX - rect.left) / currentZoom, (e.clientY - rect.top) / currentZoom];
}

function startDrawing(e) {
    // Only allow drawing if it is a Left-Click! (Middle click is 1, Right click is 2)
    if (e.button !== 0) return; 

    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || activeToken) return;
    isDrawing = true;
    [lastX, lastY] = getMousePosition(e);
    
    if (currentTool === 'fog-brush' && isDM && fogCtx) revealFog(lastX, lastY);
}

function revealFog(x, y) {
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.beginPath();
    fogCtx.arc(x, y, strokeWidth * 3, 0, Math.PI * 2);
    fogCtx.fill();
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'fog_reveal', userId: myId, x: x, y: y, radius: strokeWidth * 3 }));
    }
}

function draw(e) {
    if (!isDrawing) return;
    const [currentX, currentY] = getMousePosition(e);
    
    if (currentTool === 'fog-brush') {
        if (isDM && fogCtx) revealFog(currentX, currentY);
    } else if (ctx) {
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
        
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'canvas_draw', userId: myId, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: strokeColor, width: strokeWidth }));
        }
    }
    [lastX, lastY] = [currentX, currentY];
}

function stopDrawing() {
    if (isDrawing && ctx && currentTool !== 'fog-brush') {
        ctx.stroke();
        ctx.beginPath();
    }
    isDrawing = false;
}

function addTokenToLibrary(asset) {
    const tokenLibrary = document.getElementById('token-library');
    const tokenEl = document.createElement('div');
    tokenEl.className = 'token-item';
    tokenEl.innerHTML = `<img src="${asset.src}" alt="${asset.name}" class="token-preview"><div class="token-name">${asset.name}</div>`;
    tokenEl.onclick = () => placeTokenOnMap(asset, true);
    tokenLibrary.appendChild(tokenEl);
}

function placeTokenOnMap(asset, broadcast = true) {
    if (document.getElementById('map-token-' + asset.id)) return;

    const t = document.createElement('div');
    t.id = 'map-token-' + asset.id;
    t.className = 'map-token';
    
    const mapRect = mapLayer.getBoundingClientRect();
    const scrollRect = scrollArea.getBoundingClientRect();
    
    // Find exact center of screen, adjusted perfectly for zoom
    let centerX = (scrollRect.left + scrollRect.width / 2 - mapRect.left) / currentZoom;
    let centerY = (scrollRect.top + scrollRect.height / 2 - mapRect.top) / currentZoom;
    
    let startX = Math.floor(centerX / 50) * 50 + 25;
    let startY = Math.floor(centerY / 50) * 50 + 25;
    
    t.style.left = (asset.x || startX) + 'px';
    t.style.top = (asset.y || startY) + 'px';
    t.style.backgroundImage = `url(${asset.src})`;

    const delBtn = document.createElement('div');
    delBtn.className = 'token-delete';
    delBtn.innerHTML = '✕';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        t.remove();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'token_remove', userId: myId, tokenId: asset.id}));
    };

    t.appendChild(delBtn);
    
    t.addEventListener('mousedown', (e) => {
        if (e.target === delBtn) return;
        activeToken = t; 
    });

    document.getElementById('token-layer').appendChild(t);

    if (broadcast && socket.readyState === WebSocket.OPEN) {
        asset.x = startX;
        asset.y = startY;
        socket.send(JSON.stringify({ action: 'token_add', userId: myId, token: asset }));
    }
}

document.getElementById('add-token-btn').addEventListener('click', () => document.getElementById('token-upload').click());

document.getElementById('token-upload').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const asset = {
            id: Math.random().toString(36).substring(2, 9),
            name: file.name.split('.')[0],
            src: e.target.result,
            type: 'token' 
        };
        addTokenToLibrary(asset);
    };
    reader.readAsDataURL(file);
});
// ==========================================
// 8. NATIVE CHARACTER SHEETS & AUTO-SAVE
// ==========================================
let saveTimeout;

const sheetBlueprints = {
    dnd: `
        <div class="sheet-row">
            <input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Character Name" style="font-size: 22px; font-weight: bold; flex: 2; color: var(--accent-main);">
            <input type="text" class="sheet-input dyn-save" data-key="class" placeholder="Class & Level" style="flex: 1;">
            <input type="text" class="sheet-input dyn-save" data-key="race" placeholder="Race & Background" style="flex: 1;">
        </div>
        <div class="sheet-row" style="margin-top: 15px;">
            <div class="sheet-col" style="flex: 2;">
                <div class="sheet-row" style="gap: 10px; margin-bottom: 15px;">
                    <div class="sheet-stat-box" style="flex: 1;"><label>Armor Class</label><input type="text" class="dyn-save" data-key="ac"></div>
                    <div class="sheet-stat-box" style="flex: 1;"><label>Initiative</label><input type="text" class="dyn-save" data-key="init"></div>
                    <div class="sheet-stat-box" style="flex: 1;"><label>Speed</label><input type="text" class="dyn-save" data-key="speed"></div>
                    <div class="sheet-stat-box" style="flex: 1;"><label>Prof Bonus</label><input type="text" class="dyn-save" data-key="prof" id="dnd-prof" value="2"></div>
                </div>
                <div class="sheet-row" style="gap: 10px; margin-bottom: 15px;">
                    <div class="sheet-stat-box" style="flex: 2;"><label>Current Hit Points</label><input type="text" class="dyn-save" data-key="hp" placeholder="Max / Current" style="font-size: 22px;"></div>
                    <div class="sheet-stat-box" style="flex: 1;"><label>Temp HP</label><input type="text" class="dyn-save" data-key="temp_hp"></div>
                    <div class="sheet-stat-box" style="flex: 1;"><label>Hit Dice</label><input type="text" class="dyn-save" data-key="hit_dice"></div>
                </div>
                
                <div class="sheet-box">
                    <h4>Attacks & Spellcasting</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="attacks" style="min-height: 120px;" placeholder="Weapon | Atk Bonus | Damage/Type"></textarea>
                </div>
                <div class="sheet-box" style="margin-top: 15px;">
                    <h4>Equipment & Gold</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="inventory" style="min-height: 100px;"></textarea>
                </div>
            </div>

            <div class="sheet-col" style="flex: 3;">
                <div class="sheet-box">
                    <h4>Attributes & Saves</h4>
                    <div style="display: flex; gap: 10px; justify-content: space-between; margin-bottom: 15px;">
                        <div class="attr-box"><label>STR</label><input type="text" class="dyn-save dnd-attr" data-key="str" id="dnd-str" value="10"></div>
                        <div class="attr-box"><label>DEX</label><input type="text" class="dyn-save dnd-attr" data-key="dex" id="dnd-dex" value="10"></div>
                        <div class="attr-box"><label>CON</label><input type="text" class="dyn-save dnd-attr" data-key="con" id="dnd-con" value="10"></div>
                        <div class="attr-box"><label>INT</label><input type="text" class="dyn-save dnd-attr" data-key="int" id="dnd-int" value="10"></div>
                        <div class="attr-box"><label>WIS</label><input type="text" class="dyn-save dnd-attr" data-key="wis" id="dnd-wis" value="10"></div>
                        <div class="attr-box"><label>CHA</label><input type="text" class="dyn-save dnd-attr" data-key="cha" id="dnd-cha" value="10"></div>
                    </div>
                    
                    <h4>Skills</h4>
                    <div class="skills-grid">
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_acro" data-attr="dex"> Acrobatics (Dex)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_acro" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_anim" data-attr="wis"> Animal Hand (Wis)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_anim" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_arca" data-attr="int"> Arcana (Int)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_arca" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_athl" data-attr="str"> Athletics (Str)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_athl" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_dece" data-attr="cha"> Deception (Cha)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_dece" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_hist" data-attr="int"> History (Int)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_hist" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_ins" data-attr="wis"> Insight (Wis)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_ins" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_inti" data-attr="cha"> Intimidation (Cha)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_inti" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_inv" data-attr="int"> Investigation (Int)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_inv" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_med" data-attr="wis"> Medicine (Wis)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_med" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_nat" data-attr="int"> Nature (Int)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_nat" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_perc" data-attr="wis"> Perception (Wis)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_perc" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_perf" data-attr="cha"> Performance (Cha)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_perf" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_pers" data-attr="cha"> Persuasion (Cha)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_pers" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_rel" data-attr="int"> Religion (Int)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_rel" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_slei" data-attr="dex"> Sleight of Hand (Dex)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_slei" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_ste" data-attr="dex"> Stealth (Dex)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_ste" readonly></div>
                        <div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_surv" data-attr="wis"> Survival (Wis)</span><input type="text" class="dyn-save dnd-skill" data-key="sk_surv" readonly></div>
                    </div>
                </div>
                <div class="sheet-box" style="margin-top: 15px;">
                    <h4>Features, Traits & Proficiencies</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="features" style="min-height: 150px;"></textarea>
                </div>
            </div>
        </div>
    `,
    daggerheart: `
        <div class="sheet-row">
            <input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Character Name" style="font-size: 20px; font-weight: bold; flex: 2; color: var(--accent-main);">
            <input type="text" class="sheet-input dyn-save" data-key="class" placeholder="Class & Subclass" style="flex: 2;">
            <input type="text" class="sheet-input dyn-save" data-key="level" placeholder="Level" style="flex: 1;">
        </div>
        <div class="sheet-row" style="margin: 15px 0; gap: 10px;">
            <div class="sheet-stat-box" style="flex: 1;"><label>HOPE</label><input type="text" class="dyn-save" data-key="hope"></div>
            <div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label>FEAR</label><input type="text" class="dyn-save" data-key="fear" style="color: #ef4444;"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>HP</label><input type="text" class="dyn-save" data-key="hp"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>STRESS</label><input type="text" class="dyn-save" data-key="stress"></div>
            <div class="sheet-stat-box" style="flex: 1.5;"><label>EVASION</label>
                <div style="display:flex; gap:5px; align-items:center;">
                    <input type="text" class="dyn-save dh-base-evasion" data-key="base_evasion" placeholder="Base" style="font-size: 12px; border-right: 1px solid var(--border-color); padding-right: 5px;" title="Base Class Evasion">
                    <input type="text" class="dyn-save dh-evasion" data-key="evasion" title="Total Evasion">
                </div>
            </div>
            <div class="sheet-stat-box" style="flex: 1;"><label>ARMOR</label><input type="text" class="dyn-save" data-key="armor"></div>
        </div>
        <div class="sheet-row">
            <div class="sheet-col" style="flex: 1;">
                <div class="sheet-box">
                    <h4>Traits & Attributes</h4>
                    <div class="skills-grid" style="grid-template-columns: 1fr;">
                        <div class="skill-item"><span>Agility</span><input type="text" class="dyn-save dh-agi" data-key="agility"></div>
                        <div class="skill-item"><span>Strength</span><input type="text" class="dyn-save" data-key="strength"></div>
                        <div class="skill-item"><span>Finesse</span><input type="text" class="dyn-save" data-key="finesse"></div>
                        <div class="skill-item"><span>Instinct</span><input type="text" class="dyn-save" data-key="instinct"></div>
                        <div class="skill-item"><span>Presence</span><input type="text" class="dyn-save" data-key="presence"></div>
                        <div class="skill-item"><span>Knowledge</span><input type="text" class="dyn-save" data-key="knowledge"></div>
                    </div>
                </div>
                <div class="sheet-box" style="margin-top: 15px;">
                    <h4>Experiences</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="experiences" style="min-height: 100px;"></textarea>
                </div>
            </div>
            <div class="sheet-col" style="flex: 2;">
                <div class="sheet-box" style="margin-bottom: 15px;">
                    <h4>Damage Thresholds</h4>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" class="sheet-input dyn-save" data-key="minor" placeholder="Minor">
                        <input type="text" class="sheet-input dyn-save" data-key="major" placeholder="Major">
                        <input type="text" class="sheet-input dyn-save" data-key="severe" placeholder="Severe">
                    </div>
                </div>
                <div class="sheet-box" style="margin-bottom: 15px;">
                    <h4>Active Weapons</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="weapons" style="min-height: 100px;"></textarea>
                </div>
                <div class="sheet-box">
                    <h4>Domain Cards & Abilities</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="abilities" style="min-height: 150px;"></textarea>
                </div>
            </div>
        </div>
    `,
    aquelarre: `
        <div class="sheet-row">
            <input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Name" style="font-size: 20px; font-weight: bold; flex: 2; color: var(--accent-main);">
            <input type="text" class="sheet-input dyn-save" data-key="profession" placeholder="Social Status / Profession" style="flex: 2;">
        </div>
        <div class="sheet-row" style="margin: 15px 0; gap: 10px;">
            <div class="sheet-stat-box" style="flex: 1;"><label>Rationality</label><input type="text" class="dyn-save aquelarre-rr" data-key="rr"></div>
            <div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label>Irrationality</label><input type="text" class="dyn-save aquelarre-irr" data-key="irr" style="color: #ef4444;"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Health (HP)</label><input type="text" class="dyn-save aquelarre-hp" data-key="hp"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Faith Points</label><input type="text" class="dyn-save" data-key="faith"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Luck</label><input type="text" class="dyn-save" data-key="luck"></div>
        </div>
        <div class="sheet-row">
            <div class="sheet-col" style="flex: 1;">
                <div class="sheet-box">
                    <h4>Primary Characteristics</h4>
                    <div class="skills-grid" style="grid-template-columns: 1fr;">
                        <div class="skill-item"><span>Strength (STR)</span><input type="text" class="dyn-save aquelarre-str" data-key="str"></div>
                        <div class="skill-item"><span>Agility (AGI)</span><input type="text" class="dyn-save" data-key="agi"></div>
                        <div class="skill-item"><span>Dexterity (DEX)</span><input type="text" class="dyn-save" data-key="dex"></div>
                        <div class="skill-item"><span>Stamina (STA)</span><input type="text" class="dyn-save aquelarre-sta" data-key="sta"></div>
                        <div class="skill-item"><span>Perception (PER)</span><input type="text" class="dyn-save" data-key="per"></div>
                        <div class="skill-item"><span>Communication (COM)</span><input type="text" class="dyn-save" data-key="com"></div>
                        <div class="skill-item"><span>Culture (CUL)</span><input type="text" class="dyn-save" data-key="cul"></div>
                    </div>
                </div>
            </div>
            <div class="sheet-col" style="flex: 2;">
                <div class="sheet-box" style="margin-bottom: 15px;">
                    <h4>Core Competences</h4>
                    <div class="skills-grid">
                        <div class="skill-item"><span>Alertness</span><input type="text" class="dyn-save" data-key="sk_alert"></div>
                        <div class="skill-item"><span>Brawl</span><input type="text" class="dyn-save" data-key="sk_brawl"></div>
                        <div class="skill-item"><span>Dodge</span><input type="text" class="dyn-save" data-key="sk_dodge"></div>
                        <div class="skill-item"><span>Empathy</span><input type="text" class="dyn-save" data-key="sk_emp"></div>
                        <div class="skill-item"><span>Eloquence</span><input type="text" class="dyn-save" data-key="sk_elo"></div>
                        <div class="skill-item"><span>Listen</span><input type="text" class="dyn-save" data-key="sk_list"></div>
                        <div class="skill-item"><span>Melee Weapons</span><input type="text" class="dyn-save" data-key="sk_melee"></div>
                        <div class="skill-item"><span>Memory</span><input type="text" class="dyn-save" data-key="sk_mem"></div>
                        <div class="skill-item"><span>Missile Weapons</span><input type="text" class="dyn-save" data-key="sk_miss"></div>
                        <div class="skill-item"><span>Ride</span><input type="text" class="dyn-save" data-key="sk_ride"></div>
                        <div class="skill-item"><span>Stealth</span><input type="text" class="dyn-save" data-key="sk_stealth"></div>
                        <div class="skill-item"><span>Theology</span><input type="text" class="dyn-save" data-key="sk_theo"></div>
                    </div>
                </div>
                <div class="sheet-box">
                    <h4>Spells, Rituals & Inventory</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="magic" style="min-height: 150px;"></textarea>
                </div>
            </div>
        </div>
    `,
    vampire: `
        <div class="sheet-row">
            <input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Name" style="font-size: 20px; font-weight: bold; flex: 2; color: #ef4444;">
            <input type="text" class="sheet-input dyn-save" data-key="clan" placeholder="Clan & Generation" style="flex: 1;">
            <input type="text" class="sheet-input dyn-save" data-key="concept" placeholder="Concept" style="flex: 1;">
        </div>
        <div class="sheet-row" style="margin: 15px 0; gap: 10px;">
            <div class="sheet-stat-box" style="flex: 1;"><label>Health (HP)</label><input type="text" class="dyn-save vamp-hp" data-key="hp"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Willpower</label><input type="text" class="dyn-save vamp-will" data-key="will"></div>
            <div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label>Hunger</label><input type="text" class="dyn-save" data-key="hunger" style="color: #ef4444;"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Humanity</label><input type="text" class="dyn-save" data-key="humanity"></div>
            <div class="sheet-stat-box" style="flex: 1; border-color: #fbbf24;"><label>Blood Potency</label><input type="text" class="dyn-save" data-key="potency" style="color: #fbbf24;"></div>
        </div>
        <div class="sheet-row">
            <div class="sheet-col" style="flex: 1;">
                <div class="sheet-box">
                    <h4>Attributes</h4>
                    <label style="font-size:10px; color:var(--text-muted);">Physical</label>
                    <div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;">
                        <div class="skill-item"><span>Strength</span><input type="text" class="dyn-save" data-key="str"></div>
                        <div class="skill-item"><span>Dexterity</span><input type="text" class="dyn-save" data-key="dex"></div>
                        <div class="skill-item"><span>Stamina</span><input type="text" class="dyn-save vamp-sta" data-key="sta"></div>
                    </div>
                    <label style="font-size:10px; color:var(--text-muted);">Social</label>
                    <div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;">
                        <div class="skill-item"><span>Charisma</span><input type="text" class="dyn-save" data-key="cha"></div>
                        <div class="skill-item"><span>Manipulation</span><input type="text" class="dyn-save" data-key="man"></div>
                        <div class="skill-item"><span>Composure</span><input type="text" class="dyn-save vamp-com" data-key="com"></div>
                    </div>
                    <label style="font-size:10px; color:var(--text-muted);">Mental</label>
                    <div class="skills-grid" style="grid-template-columns: 1fr;">
                        <div class="skill-item"><span>Intelligence</span><input type="text" class="dyn-save" data-key="int"></div>
                        <div class="skill-item"><span>Wits</span><input type="text" class="dyn-save" data-key="wit"></div>
                        <div class="skill-item"><span>Resolve</span><input type="text" class="dyn-save vamp-res" data-key="res"></div>
                    </div>
                </div>
            </div>
            <div class="sheet-col" style="flex: 2;">
                <div class="sheet-box" style="margin-bottom: 15px;">
                    <h4>Skills</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="skills" style="min-height: 100px;" placeholder="Athletics, Brawl, Firearms, Persuasion, Occult..."></textarea>
                </div>
                <div class="sheet-box">
                    <h4>Disciplines & Advantages</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="disciplines" style="min-height: 150px;"></textarea>
                </div>
            </div>
        </div>
    `,
    assimilacao: `
        <div class="sheet-row">
            <input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Nome do Personagem" style="font-size: 20px; font-weight: bold; flex: 2; color: var(--accent-main);">
            <input type="text" class="sheet-input dyn-save" data-key="player" placeholder="Origem / Jogador" style="flex: 1;">
        </div>
        <div class="sheet-row" style="margin: 15px 0; gap: 10px;">
            <div class="sheet-stat-box" style="flex: 1;"><label>Vitalidade</label><input type="text" class="dyn-save ass-hp" data-key="vitality"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Saúde Mental</label><input type="text" class="dyn-save ass-mental" data-key="mental_hp"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Defesa</label><input type="text" class="dyn-save" data-key="defesa"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Esquiva</label><input type="text" class="dyn-save ass-esq" data-key="esquiva"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Velocidade</label><input type="text" class="dyn-save" data-key="velocidade"></div>
            <div class="sheet-stat-box" style="flex: 1;"><label>Carga</label><input type="text" class="dyn-save ass-carga" data-key="carga"></div>
        </div>
        <div class="sheet-row">
            <div class="sheet-col" style="flex: 1;">
                <div class="sheet-box">
                    <h4>Atributos Principais</h4>
                    <label style="font-size:10px; color:var(--text-muted);">Corpo</label>
                    <div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;">
                        <div class="skill-item"><span>Força</span><input type="text" class="dyn-save ass-forca" data-key="forca"></div>
                        <div class="skill-item"><span>Agilidade</span><input type="text" class="dyn-save ass-agi" data-key="agilidade"></div>
                        <div class="skill-item"><span>Metabolismo</span><input type="text" class="dyn-save ass-met" data-key="metabolismo"></div>
                    </div>
                    <label style="font-size:10px; color:var(--text-muted);">Mente</label>
                    <div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;">
                        <div class="skill-item"><span>Intelecto</span><input type="text" class="dyn-save ass-int" data-key="intelecto"></div>
                        <div class="skill-item"><span>Raciocínio</span><input type="text" class="dyn-save" data-key="raciocinio"></div>
                        <div class="skill-item"><span>Percepção</span><input type="text" class="dyn-save ass-perc" data-key="percepcao"></div>
                    </div>
                    <label style="font-size:10px; color:var(--text-muted);">Essência</label>
                    <div class="skills-grid" style="grid-template-columns: 1fr;">
                        <div class="skill-item"><span>Carisma</span><input type="text" class="dyn-save" data-key="carisma"></div>
                        <div class="skill-item"><span>Manipulação</span><input type="text" class="dyn-save" data-key="manipulacao"></div>
                        <div class="skill-item"><span>Propósito</span><input type="text" class="dyn-save ass-prop" data-key="proposito"></div>
                    </div>
                </div>
            </div>
            <div class="sheet-col" style="flex: 2;">
                <div class="sheet-box" style="margin-bottom: 15px;">
                    <h4>Aptidões & Perícias</h4>
                    <div class="skills-grid">
                        <div class="skill-item"><span>Atletismo</span><input type="text" class="dyn-save" data-key="sk_atl"></div>
                        <div class="skill-item"><span>Furtividade</span><input type="text" class="dyn-save" data-key="sk_fur"></div>
                        <div class="skill-item"><span>Investigação</span><input type="text" class="dyn-save" data-key="sk_inv"></div>
                        <div class="skill-item"><span>Luta</span><input type="text" class="dyn-save" data-key="sk_lut"></div>
                        <div class="skill-item"><span>Medicina</span><input type="text" class="dyn-save" data-key="sk_med"></div>
                        <div class="skill-item"><span>Mira</span><input type="text" class="dyn-save" data-key="sk_mir"></div>
                        <div class="skill-item"><span>Sobrevivência</span><input type="text" class="dyn-save" data-key="sk_sob"></div>
                        <div class="skill-item"><span>Tecnologia</span><input type="text" class="dyn-save" data-key="sk_tec"></div>
                    </div>
                </div>
                <div class="sheet-box">
                    <h4>Mutação, Anomalia & Inventário</h4>
                    <textarea class="sheet-textarea dyn-save" data-key="skills" style="min-height: 150px;"></textarea>
                </div>
            </div>
        </div>
    `
};

// --- MATH CALCULATORS ---
function calculateDnDSkills() {
    const profBonus = parseInt(document.getElementById('dnd-prof')?.value) || 0;
    
    document.querySelectorAll('.prof-toggle').forEach(checkbox => {
        const attrKey = checkbox.getAttribute('data-attr'); 
        const skillInput = checkbox.closest('.skill-item').querySelector('.dnd-skill');
        const attrScore = parseInt(document.getElementById(`dnd-${attrKey}`)?.value) || 10;
        const attrMod = Math.floor((attrScore - 10) / 2);
        
        let finalMod = attrMod;
        if (checkbox.checked) finalMod += profBonus;
        skillInput.value = (finalMod >= 0 ? '+' : '') + finalMod;
    });
}

function calculateDaggerheart() {
    const agi = parseInt(document.querySelector('.dh-agi')?.value) || 0;
    const baseEva = parseInt(document.querySelector('.dh-base-evasion')?.value) || 0;
    const evaField = document.querySelector('.dh-evasion');
    if (evaField) evaField.value = baseEva + agi;
}

function calculateAquelarre(changedKey) {
    const str = parseInt(document.querySelector('.aquelarre-str')?.value) || 0;
    const sta = parseInt(document.querySelector('.aquelarre-sta')?.value) || 0;
    const hpField = document.querySelector('.aquelarre-hp');
    if (hpField && (str > 0 || sta > 0)) hpField.value = Math.ceil((str + sta) / 2);

    // Rationality/Irrationality balance equation (RR + IRR = 100)
    if (changedKey === 'rr') {
        const rr = parseInt(document.querySelector('.aquelarre-rr')?.value) || 0;
        const irrField = document.querySelector('.aquelarre-irr');
        if (irrField) irrField.value = 100 - rr;
    } else if (changedKey === 'irr') {
        const irr = parseInt(document.querySelector('.aquelarre-irr')?.value) || 0;
        const rrField = document.querySelector('.aquelarre-rr');
        if (rrField) rrField.value = 100 - irr;
    }
}

function calculateVampire() {
    const sta = parseInt(document.querySelector('.vamp-sta')?.value) || 0;
    const hpField = document.querySelector('.vamp-hp');
    if (hpField && sta > 0) hpField.value = sta + 3;

    const com = parseInt(document.querySelector('.vamp-com')?.value) || 0;
    const res = parseInt(document.querySelector('.vamp-res')?.value) || 0;
    const willField = document.querySelector('.vamp-will');
    if (willField && (com > 0 || res > 0)) willField.value = com + res;
}

function calculateAssimilacao() {
    const forca = parseInt(document.querySelector('.ass-forca')?.value) || 0;
    const met = parseInt(document.querySelector('.ass-met')?.value) || 0;
    const hpField = document.querySelector('.ass-hp');
    if (hpField && (forca > 0 || met > 0)) hpField.value = forca + met + 10;

    const int = parseInt(document.querySelector('.ass-int')?.value) || 0;
    const prop = parseInt(document.querySelector('.ass-prop')?.value) || 0;
    const mentalField = document.querySelector('.ass-mental');
    if (mentalField && (int > 0 || prop > 0)) mentalField.value = int + prop + 10;

    const agi = parseInt(document.querySelector('.ass-agi')?.value) || 0;
    const perc = parseInt(document.querySelector('.ass-perc')?.value) || 0;
    const esqField = document.querySelector('.ass-esq');
    if (esqField && (agi > 0 || perc > 0)) esqField.value = agi + perc;

    const cargaField = document.querySelector('.ass-carga');
    if (cargaField && forca > 0) cargaField.value = forca * 5;
}

// --- SHEET RENDERER ---
function renderCharacterSheet() {
    const system = document.getElementById('rpg-system-select').value;
    const container = document.getElementById('dynamic-sheet-container');
    
    container.innerHTML = sheetBlueprints[system] || `<p>System not found.</p>`;
    
    const saved = localStorage.getItem(`conflict_sheet_${system}`);
    let parsedData = {};
    if (saved) {
        try { parsedData = JSON.parse(saved); } catch (e) {}
    }
    
    container.querySelectorAll('.dyn-save').forEach(input => {
        const key = input.getAttribute('data-key');
        
        if (input.type === 'checkbox') {
            input.checked = parsedData[key] === true;
        } else if (parsedData[key]) {
            input.value = parsedData[key];
        }
        
        input.addEventListener('input', (e) => {
            const changedKey = e.target.getAttribute('data-key');
            if (system === 'dnd') calculateDnDSkills();
            if (system === 'daggerheart') calculateDaggerheart();
            if (system === 'aquelarre') calculateAquelarre(changedKey);
            if (system === 'vampire') calculateVampire();
            if (system === 'assimilacao') calculateAssimilacao();
            saveCharacterSheet(system);
        });
    });

    // Run initial calculations on load
    if (system === 'dnd') calculateDnDSkills();
    if (system === 'daggerheart') calculateDaggerheart();
    if (system === 'aquelarre') calculateAquelarre(null);
    if (system === 'vampire') calculateVampire();
    if (system === 'assimilacao') calculateAssimilacao();
}

function saveCharacterSheet(system) {
    const container = document.getElementById('dynamic-sheet-container');
    const data = {};
    
    container.querySelectorAll('.dyn-save').forEach(input => {
        const key = input.getAttribute('data-key');
        data[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    
    localStorage.setItem(`conflict_sheet_${system}`, JSON.stringify(data));
    
    const statusText = document.getElementById('sheet-save-status');
    statusText.style.opacity = 1;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { statusText.style.opacity = 0; }, 2000);
}

document.getElementById('rpg-system-select').addEventListener('change', renderCharacterSheet);
window.addEventListener('DOMContentLoaded', renderCharacterSheet);
