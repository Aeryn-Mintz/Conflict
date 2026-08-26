const { ipcRenderer } = require('electron');

// ==========================================
// 1. WEBSOCKET & WEBRTC ENGINE
// ==========================================
const serverUrl = localStorage.getItem('conflictServerUrl') || 'ws://localhost:8080';
const socket = new WebSocket(serverUrl);

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
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const tabId = btn.dataset.tab;
        if (tabId === 'main') {
            document.getElementById('main-view').style.display = 'flex';
            document.getElementById('rpg-view').style.display = 'none';
            currentView = 'main';
        } else if (tabId === 'rpg') {
            document.getElementById('main-view').style.display = 'none';
            document.getElementById('rpg-view').style.display = 'flex';
            currentView = 'rpg';
            initCanvas(); 
        }
    });
});

socket.onopen = () => {
    console.log("🟢 Connected to signaling server.");
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

    setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: 'keep_alive' }));
    }, 15000); 
};

socket.onerror = (error) => {
    console.error("WebSocket Error:", error);
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.placeholder = '🔴 Disconnected from server.';
        chatInput.disabled = true;
    }
};

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
        else if (data.action === 'offer' && data.targetId === myId) {
            peerNames[data.userId] = data.username || "Guest";
            peerAvatars[data.userId] = data.avatar || null;
            addRemoteUserCard(data.userId, peerNames[data.userId], peerAvatars[data.userId]);
            
            let pc = peers[data.userId] || createPeerConnection(data.userId);

            await handleRemoteDescription(pc, data.userId, new RTCSessionDescription(data.offer));
            addLocalTracksSafely(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.send(JSON.stringify({ action: 'answer', userId: myId, targetId: data.userId, answer: answer }));
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
        
        Object.values(peers).forEach(pc => addLocalTracksSafely(pc));

        const currentName = document.getElementById('display-username').textContent;
        socket.send(JSON.stringify({ action: 'join', userId: myId, username: currentName, avatar: localStorage.getItem('appAvatar') || null }));
        
        document.getElementById('join-voice-btn').disabled = true;
        document.getElementById('join-voice-btn').innerText = "🎙️ Connected";
        document.getElementById('mute-mic-btn').disabled = false;
    } catch (error) {
        console.error("Could not access microphone:", error);
        alert("Microphone access denied or hardware error!");
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
// 7. CANVAS & TOKEN MANAGEMENT
// ==========================================
let canvas = null;
let ctx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let activeToken = null;
let tabletopContainer = null;

window.addEventListener('mousemove', (e) => {
    if (!activeToken || !tabletopContainer || !canvas) return;
    
    const rect = tabletopContainer.getBoundingClientRect();
    let mouseX = e.clientX - rect.left;
    let mouseY = e.clientY - rect.top;

    let snapX = Math.floor(mouseX / 50) * 50 + 25;
    let snapY = Math.floor(mouseY / 50) * 50 + 25;

    snapX = Math.max(25, Math.min(canvas.width - 25, snapX));
    snapY = Math.max(25, Math.min(canvas.height - 25, snapY));

    activeToken.style.left = snapX + 'px';
    activeToken.style.top = snapY + 'px';

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            action: 'token_move',
            userId: myId,
            tokenId: activeToken.id.replace('map-token-', ''),
            x: snapX,
            y: snapY
        }));
    }
});

window.addEventListener('mouseup', () => { activeToken = null; });

function initCanvas() {
    canvas = document.getElementById('shared-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    tabletopContainer = document.getElementById('tabletop-container');
    canvas.width = tabletopContainer.clientWidth;
    canvas.height = tabletopContainer.clientHeight;
    
    if (!canvas.dataset.initialized) {
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
        
        document.getElementById('pen-tool').addEventListener('click', () => setTool('pen'));
        document.getElementById('eraser-tool').addEventListener('click', () => setTool('eraser'));
        document.getElementById('clear-canvas-btn').addEventListener('click', () => {
            if (confirm('Clear the ink? (Tokens will remain)')) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'canvas_clear', userId: myId}));
            }
        });
        
        document.getElementById('stroke-color').addEventListener('change', updateStrokeStyle);
        document.getElementById('stroke-width').addEventListener('input', updateStrokeWidth);
        
        canvas.dataset.initialized = "true";
    }
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
    if (ctx) {
        ctx.lineWidth = strokeWidth; 
        ctx.lineCap = 'round'; 
        ctx.lineJoin = 'round'; 
    }
}

function getMousePosition(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
}

function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = getMousePosition(e);
}

function draw(e) {
    if (!isDrawing || !ctx) return;
    const [currentX, currentY] = getMousePosition(e);
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
    
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            action: 'canvas_draw', userId: myId,
            x0: lastX, y0: lastY, x1: currentX, y1: currentY,
            color: strokeColor, width: strokeWidth
        }));
    }
    [lastX, lastY] = [currentX, currentY];
}

function stopDrawing() {
    if (isDrawing && ctx) {
        ctx.stroke();
        ctx.beginPath();
        isDrawing = false;
    }
}

function addTokenToLibrary(token) {
    const tokenLibrary = document.getElementById('token-library');
    const tokenEl = document.createElement('div');
    tokenEl.className = 'token-item';
    tokenEl.innerHTML = `<img src="${token.src}" alt="${token.name}" class="token-preview"><div class="token-name">${token.name}</div>`;
    tokenEl.onclick = () => placeTokenOnMap(token, true);
    tokenLibrary.appendChild(tokenEl);
}

function placeTokenOnMap(token, broadcast = true) {
    if (document.getElementById('map-token-' + token.id)) return;

    const t = document.createElement('div');
    t.id = 'map-token-' + token.id;
    t.className = 'map-token';
    
    const container = document.getElementById('tabletop-container');
    let startX = Math.floor((container.clientWidth / 2) / 50) * 50 + 25;
    let startY = Math.floor((container.clientHeight / 2) / 50) * 50 + 25;
    
    t.style.left = (token.x || startX) + 'px';
    t.style.top = (token.y || startY) + 'px';
    t.style.backgroundImage = `url(${token.src})`;

    const delBtn = document.createElement('div');
    delBtn.className = 'token-delete';
    delBtn.innerHTML = '✕';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        t.remove();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({action: 'token_remove', userId: myId, tokenId: token.id}));
    };

    t.appendChild(delBtn);
    
    t.addEventListener('mousedown', (e) => {
        if (e.target === delBtn) return;
        activeToken = t; 
    });

    document.getElementById('token-layer').appendChild(t);

    if (broadcast && socket.readyState === WebSocket.OPEN) {
        token.x = startX;
        token.y = startY;
        socket.send(JSON.stringify({ action: 'token_add', userId: myId, token: token }));
    }
}

document.getElementById('add-token-btn').addEventListener('click', () => document.getElementById('token-upload').click());

document.getElementById('token-upload').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const token = {
            id: Math.random().toString(36).substring(2, 9),
            name: file.name.split('.')[0],
            src: e.target.result
        };
        addTokenToLibrary(token);
    };
    reader.readAsDataURL(file);
});
