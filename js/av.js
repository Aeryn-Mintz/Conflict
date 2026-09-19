// ==========================================
// CENTRAL AUDIO & VIDEO ENGINE (WebRTC)
// ==========================================
window.peers = {};
window.iceCandidateQueue = {};
window.localMicStream = null;
window.localCamStream = null;
window.localScreenStream = null;
window.audioCtx = null;
window.soundboardDest = null;
window.soundboardTrack = null;
window.isMuted = false;

// TÚNEL LAN (RADMIN/ZEROTIER): ICE vazio força o p2p na rede local
// INTERNET P2P TUNNEL: Uses Google's free servers to punch through home routers
window.rtcConfig = { 
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ] 
};

window.initAudioCtx = function() {
    if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window.soundboardDest = window.audioCtx.createMediaStreamDestination();
        window.soundboardTrack = window.soundboardDest.stream.getAudioTracks()[0];
    }
    if (window.audioCtx.state === 'suspended') window.audioCtx.resume();
};
document.addEventListener('click', () => { if (!window.audioCtx) window.initAudioCtx(); }, { once: true });

window.addLocalTracksSafely = function(pc) {
    if (!window.audioCtx) window.initAudioCtx();
    const sentTracks = pc.getSenders().map(s => s.track).filter(Boolean);
    const streams = [window.localMicStream, window.localScreenStream, window.localCamStream, window.soundboardDest?.stream].filter(Boolean);
    
    streams.forEach(stream => {
        stream.getTracks().forEach(track => {
            if (!sentTracks.includes(track)) {
                try { pc.addTrack(track, stream); } catch(e){}
            }
        });
    });
};

window.createPeerConnection = function(remoteUserId) {
    const pc = new RTCPeerConnection(window.rtcConfig);
    window.peers[remoteUserId] = pc;

    pc.onicecandidate = (event) => { 
        if (event.candidate && window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'ice-candidate', userId: window.myId, targetId: remoteUserId, candidate: event.candidate })); 
        }
    };

    pc.oniceconnectionstatechange = () => {
        const statusEl = document.getElementById('voice-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                statusEl.style.color = '#10b981';
                statusEl.innerText = 'Call: Connected 🟢';
            } else if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') {
                statusEl.style.color = '#fbbf24';
                statusEl.innerText = 'Call: Connecting via UDP... 🟡';
            } else if (['failed', 'closed', 'disconnected'].includes(pc.iceConnectionState)) {
                statusEl.style.color = '#ef4444';
                statusEl.innerText = 'Call: Disconnected 🔴';
            }
        }

        if (['failed', 'closed', 'disconnected'].includes(pc.iceConnectionState)) {
            document.querySelectorAll(`.stream-${remoteUserId}`).forEach(el => el.remove());
            delete window.peers[remoteUserId]; 
            delete window.iceCandidateQueue[remoteUserId];
        }
    };

    pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        
        event.track.onended = () => { 
            const aud = document.getElementById(`audio-${event.track.id}`); if (aud) aud.remove(); 
            const vid = document.getElementById(`video-container-${event.track.id}`); if (vid) vid.remove();
        };
        event.track.onmute = () => { 
            const aud = document.getElementById(`audio-${event.track.id}`); if (aud) aud.remove(); 
            const vid = document.getElementById(`video-container-${event.track.id}`); if (vid) vid.remove();
        };

        if (event.track.kind === 'audio') {
            let audioCont = document.getElementById('remote-audio-container');
            if (!audioCont) {
                audioCont = document.createElement('div'); audioCont.id = 'remote-audio-container';
                audioCont.style.cssText = 'width:0; height:0; position:absolute; overflow:hidden; opacity:0; pointer-events:none;';
                document.body.appendChild(audioCont);
            }
            
            let remoteAudio = document.getElementById(`audio-${event.track.id}`);
            if (!remoteAudio) {
                remoteAudio = document.createElement('audio'); 
                remoteAudio.id = `audio-${event.track.id}`; 
                remoteAudio.className = `stream-${remoteUserId}`;
                remoteAudio.autoplay = true; remoteAudio.muted = false;
                
                const outId = localStorage.getItem('appAudioOut'); 
                if (outId && typeof remoteAudio.setSinkId === 'function') remoteAudio.setSinkId(outId).catch(()=>{});
                
                const slider = document.getElementById(`vol-${remoteUserId}`); 
                remoteAudio.volume = slider ? Math.min(parseFloat(slider.value), 1) : 0.8;
                audioCont.appendChild(remoteAudio);
            }
            remoteAudio.srcObject = stream;
            remoteAudio.play().catch(()=>{});
        }
        
        if (event.track.kind === 'video') {
            let videoContainer = document.getElementById(`video-container-${event.track.id}`);
            if (!videoContainer) {
                videoContainer = document.createElement('div'); 
                videoContainer.id = `video-container-${event.track.id}`; 
                videoContainer.className = `stream-container stream-${remoteUserId}`;
                
                const label = document.createElement('div'); label.className = "stream-label"; 
                label.innerText = window.peerNames[remoteUserId] || 'Friend';
                
                const remoteVideo = document.createElement('video'); 
                remoteVideo.id = `video-${event.track.id}`; 
                remoteVideo.autoplay = true; remoteVideo.playsInline = true; remoteVideo.controls = true; 
                remoteVideo.srcObject = stream;
                
                videoContainer.appendChild(label); videoContainer.appendChild(remoteVideo); 
                
                let grid = document.getElementById('video-grid');
                if (!grid) { grid = document.createElement('div'); grid.id = 'video-grid'; document.body.appendChild(grid); }
                (grid.querySelector('.panel-content') || grid).appendChild(videoContainer);
                
                remoteVideo.play().catch(()=>{});
            }
        }
    };
    return pc;
};

window.renegotiatePeers = async function() {
    for (const remoteUserId of Object.keys(window.peerNames)) {
        let pc = window.peers[remoteUserId];
        if (!pc) pc = window.createPeerConnection(remoteUserId);
        window.addLocalTracksSafely(pc);
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: pc.localDescription }));
            }
        } catch(e) {}
    }
};

window.handleWebRTCSignal = async function(data) {
    if (data.action === 'join' && data.userId !== window.myId) {
        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);
        
        window.addLocalTracksSafely(pc);
        if (window.localMicStream || window.localCamStream || window.localScreenStream) {
            try {
                const offer = await pc.createOffer(); 
                await pc.setLocalDescription(offer);
                window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: data.userId, offer: pc.localDescription }));
            } catch(e) {}
        }
    }
    else if (data.action === 'offer' && data.targetId === window.myId) {
        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);
        
        try {
            const isPolite = window.myId > data.userId;
            const isStable = pc.signalingState === 'stable';
            
            if (!isStable) {
                if (!isPolite) return; 
                await Promise.all([ pc.setLocalDescription({type: "rollback"}), pc.setRemoteDescription(new RTCSessionDescription(data.offer)) ]);
            } else {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            }

            window.addLocalTracksSafely(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            window.socket.send(JSON.stringify({ action: 'answer', userId: window.myId, targetId: data.userId, answer: pc.localDescription }));
            
            if (window.iceCandidateQueue[data.userId]) { 
                while (window.iceCandidateQueue[data.userId].length > 0) { 
                    try { await pc.addIceCandidate(window.iceCandidateQueue[data.userId].shift()); } catch(e){} 
                } 
            }
        } catch(e) {}
    }
    else if (data.action === 'answer' && data.targetId === window.myId) {
        const pc = window.peers[data.userId];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                if (window.iceCandidateQueue[data.userId]) { 
                    while (window.iceCandidateQueue[data.userId].length > 0) { 
                        try { await pc.addIceCandidate(window.iceCandidateQueue[data.userId].shift()); } catch(e){} 
                    } 
                }
            } catch(e) {}
        }
    }
    else if (data.action === 'ice-candidate' && data.targetId === window.myId) {
        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);
        
        const candidate = new RTCIceCandidate(data.candidate);
        if (pc.remoteDescription && pc.remoteDescription.type) {
            try { await pc.addIceCandidate(candidate); } catch(e){}
        } else { 
            if (!window.iceCandidateQueue[data.userId]) window.iceCandidateQueue[data.userId] = []; 
            window.iceCandidateQueue[data.userId].push(candidate); 
        }
    }
};

document.addEventListener('click', async (e) => {
    if (e.target.closest('#join-voice-btn')) {
        let micSuccess = false;
        try {
            if (!window.audioCtx) window.initAudioCtx();
            const micId = localStorage.getItem('appAudioIn');
            
            // ELECTRON'S BUILT-IN ML NOISE SUPPRESSION
            const audioConfig = { 
                echoCancellation: true, 
                noiseSuppression: true, // This triggers Chromium's ML denoiser natively
                autoGainControl: true 
            };
            if (micId) audioConfig.deviceId = { ideal: micId };
            
            try {
                window.localMicStream = await navigator.mediaDevices.getUserMedia({ audio: audioConfig });
            } catch (errFallback) {
                window.localMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            micSuccess = true;
            await new Promise(r => setTimeout(r, 100)); 
            window.renegotiatePeers();
        } catch (err) {
            if(window.addChatLine) window.addChatLine('System', '⚠️ Error: No microphone found or permission denied by hardware.', 'system');
        }

        const btn = document.getElementById('join-voice-btn');
        if (btn) { btn.disabled = true; btn.innerText = micSuccess ? "🎙️ Connected" : "🎧 Listening"; }
        if (micSuccess) { const muteBtn = document.getElementById('mute-mic-btn'); if (muteBtn) muteBtn.disabled = false; }
    }

    if (e.target.closest('#mute-mic-btn')) {
        if (window.localMicStream) {
            window.isMuted = !window.isMuted; 
            window.localMicStream.getAudioTracks()[0].enabled = !window.isMuted;
            e.target.innerText = window.isMuted ? "🔈 Unmute" : "🔇 Mute"; 
            e.target.style.color = window.isMuted ? "var(--accent-alert)" : "var(--text-main)"; 
            e.target.style.borderColor = window.isMuted ? "var(--accent-alert)" : "var(--border-color)";
        }
    }

    if (e.target.closest('#toggle-cam-btn')) {
        const btn = e.target.closest('#toggle-cam-btn'); const localCam = document.getElementById('local-cam-video');
        if (window.localCamStream) {
            window.localCamStream.getTracks().forEach(t => {
                t.stop();
                Object.values(window.peers).forEach(pc => { const sender = pc.getSenders().find(s => s.track === t); if(sender) pc.removeTrack(sender); });
            });
            window.localCamStream = null;
            btn.innerText = "📷 Camera"; btn.classList.replace('primary-btn', 'secondary-btn');
            localCam.style.display = 'none'; localCam.srcObject = null;
            window.renegotiatePeers();
        } else {
            try {
                const camId = localStorage.getItem('appVideoIn');
                window.localCamStream = await navigator.mediaDevices.getUserMedia({ video: camId ? { deviceId: { ideal: camId } } : true });
                localCam.style.display = 'block'; localCam.srcObject = window.localCamStream;
                btn.innerText = "📷 Stop Cam"; btn.classList.replace('secondary-btn', 'primary-btn');
                window.renegotiatePeers();
            } catch (err) {}
        }
    }

    if (e.target.closest('#share-screen-btn')) {
        const shareBtn = e.target.closest('#share-screen-btn');
        const localVideo = document.getElementById('local-screen-video'); 
        
        if (window.localScreenStream) {
            window.localScreenStream.getTracks().forEach(t => {
                t.stop();
                Object.values(window.peers).forEach(pc => { const sender = pc.getSenders().find(s => s.track === t); if(sender) pc.removeTrack(sender); });
            });
            window.localScreenStream = null;
            shareBtn.innerText = "💻 Share Screen"; shareBtn.classList.replace('primary-btn', 'secondary-btn');
            localVideo.style.display = 'none'; localVideo.srcObject = null;
            window.renegotiatePeers();
            return;
        }
        
        try {
            try {
                window.localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
            } catch(err1) {
                window.localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: false });
            }
            
            shareBtn.innerText = "💻 Stop Share"; shareBtn.classList.replace('secondary-btn', 'primary-btn');
            localVideo.style.display = 'block'; localVideo.srcObject = window.localScreenStream;
            window.renegotiatePeers();

            window.localScreenStream.getVideoTracks()[0].onended = () => { shareBtn.click(); };
        } catch(err) {}
    }
});

if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');
    ipcRenderer.removeAllListeners('show-screen-picker');
    ipcRenderer.on('show-screen-picker', (event, sources) => {
        const modal = document.getElementById('screen-picker-modal'); 
        const overlay = document.getElementById('modal-overlay'); 
        const grid = document.getElementById('screen-picker-grid');
        if(!modal || !overlay || !grid) return;
        
        grid.innerHTML = '';
        sources.forEach(source => {
            const item = document.createElement('div'); item.className = 'screen-option'; 
            item.innerHTML = `<img src="${source.thumbnailDataUrl}" alt="${source.name}"><span>${source.name}</span>`;
            item.onclick = () => { ipcRenderer.send('screen-picker-result', source.id); modal.style.display = 'none'; overlay.style.display = 'none'; };
            grid.appendChild(item);
        });
        modal.style.display = 'flex'; overlay.style.display = 'block';
    });

    document.getElementById('cancel-screen-picker')?.addEventListener('click', () => { 
        ipcRenderer.send('screen-picker-result', null); 
        const modal = document.getElementById('screen-picker-modal'); const overlay = document.getElementById('modal-overlay'); 
        if(modal) modal.style.display = 'none'; if(overlay) overlay.style.display = 'none'; 
    });
}