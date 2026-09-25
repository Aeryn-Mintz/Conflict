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
// Rebuilds the entire mic pipeline against the currently-selected device
// and hot-swaps it into every peer connection. Returns the new localMicStream.
window.rebuildMicPipeline = async function() {
    window._micGeneration = (window._micGeneration || 0) + 1;
    const myGen = window._micGeneration;
    const micId = localStorage.getItem('appAudioIn');

    // 1. Kill the previous raw mic so its LED turns off
    if (window._rawMicStream) {
        window._rawMicStream.getTracks().forEach(t => t.stop());
        window._rawMicStream = null;
    }

    // 2. Disconnect old AudioContext nodes (best-effort)
    try { window._micSourceNode?.disconnect(); } catch(e) {}
    try { window._micSuppressor?.disconnect(); } catch(e) {}
    try { window._micGateGain?.disconnect(); } catch(e) {}
    try { window._micAnalyser?.disconnect(); } catch(e) {}

    // 3. Fresh raw capture from the chosen device
    const cfg = { echoCancellation: true, autoGainControl: true, noiseSuppression: true };
    if (micId) cfg.deviceId = { exact: micId };
    let rawStream;
    try {
        rawStream = await navigator.mediaDevices.getUserMedia({ audio: cfg });
    } catch (e) {
        if (micId) {
            rawStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { ideal: micId }, echoCancellation: true, autoGainControl: true }
            });
        } else throw e;
    }
    window._rawMicStream = rawStream;

    // 4. Fresh pipeline nodes
    const source = window.audioCtx.createMediaStreamSource(rawStream);
    const destination = window.audioCtx.createMediaStreamDestination();
    const gateGain = window.audioCtx.createGain();
    gateGain.gain.value = 0;
    const analyser = window.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    const dataArray = new Float32Array(analyser.frequencyBinCount);

    // 5. Try to attach the RNNoise suppressor; fall back to raw if it fails
    let head = source;
    try {
        const { createNoiseSuppressor } = require('@sapphi-red/web-noise-suppressor');
        const suppressor = await createNoiseSuppressor(window.audioCtx, {
            workletPath: './node_modules/@sapphi-red/web-noise-suppressor/dist/noise-suppressor-worklet.js',
            wasmPath: './node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm'
        });
        source.connect(suppressor);
        head = suppressor;
        window._micSuppressor = suppressor;
    } catch (e) {
        console.warn("AI suppressor unavailable, using raw mic:", e);
    }

    head.connect(analyser);
    head.connect(gateGain);
    gateGain.connect(destination);

    // 6. Replace localMicStream and hot-swap into peers by track identity
    const oldMicTrack = window.localMicStream?.getAudioTracks()[0];
    const newTrack = destination.stream.getAudioTracks()[0];

    Object.values(window.peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track === oldMicTrack);
        if (sender) sender.replaceTrack(newTrack);
    });

    window.localMicStream?.getTracks().forEach(t => t.stop());
    window.localMicStream = destination.stream;

    // 7. Keep references so the running gate loop reads fresh data
    window._micSourceNode = source;
    window._micGateGain = gateGain;
    window._micAnalyser = analyser;
    window._micDataArray = dataArray;

    // 8. Re-launch the gate loop against the new analyser
    (function processGate() {
         if (myGen !== window._micGeneration) return;   // a newer swap superseded us
        if (!window.localMicStream) return;
        window._micAnalyser.getFloatTimeDomainData(window._micDataArray);
        let sum = 0;
        for (let i = 0; i < window._micDataArray.length; i++) sum += window._micDataArray[i] * window._micDataArray[i];
        const rms = Math.sqrt(sum / window._micDataArray.length);
        const slider = document.getElementById('noise-gate-slider');
        const threshold = slider ? parseFloat(slider.value) : 0.01;
        if (rms > threshold) window._micGateGain.gain.setTargetAtTime(1, window.audioCtx.currentTime, 0.01);
        else                  window._micGateGain.gain.setTargetAtTime(0, window.audioCtx.currentTime, 0.1);
        requestAnimationFrame(processGate);
    })();

    return destination.stream;
};

// TÚNEL LAN (RADMIN/ZEROTIER): ICE vazio força o p2p na rede local
// INTERNET P2P TUNNEL: Uses Google's free servers to punch through home routers
// INTERNET P2P TUNNEL: Uses Google STUN + Public TURN Relay for CGNAT bypass
window.rtcConfig = { 
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { 
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        { 
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ] 
};

window.initAudioCtx = function() {
    if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window.soundboardDest = window.audioCtx.createMediaStreamDestination();
        window.soundboardTrack = window.soundboardDest.stream.getAudioTracks()[0];

        // Silent tone so the OS registers an audio output
        const osc = window.audioCtx.createOscillator();
        const gain = window.audioCtx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(window.audioCtx.destination);
        osc.start();
        osc.stop(window.audioCtx.currentTime + 0.1);
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

   pc.oniceconnectionstatechange = async () => {
        const statusEl = document.getElementById('voice-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                statusEl.style.color = '#10b981';
                statusEl.innerText = 'Call: Connected 🟢';
            } else if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') {
                statusEl.style.color = '#fbbf24';
                statusEl.innerText = 'Call: Connecting... 🟡';
            } else if (pc.iceConnectionState === 'disconnected') {
                // Don't kill the call yet. WebRTC is realizing the VPN dropped.
                statusEl.style.color = '#fbbf24';
                statusEl.innerText = 'Call: Reconnecting... 🟡';
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                statusEl.style.color = '#ef4444';
                statusEl.innerText = 'Call: Disconnected 🔴';
            }
        }

        // 1. If the connection fails completely, trigger an automatic ICE Restart
        if (pc.iceConnectionState === 'failed') {
            if (window.addChatLine) window.addChatLine('System', '🔄 Network drop detected. Attempting automatic call recovery...', 'system');
            
            try {
                // Force WebRTC to gather new IPs using the surviving Wi-Fi adapter
                const offer = await pc.createOffer({ iceRestart: true });
                await pc.setLocalDescription(offer);
                
                if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                    window.socket.send(JSON.stringify({ 
                        action: 'offer', 
                        userId: window.myId, 
                        targetId: remoteUserId, 
                        offer: pc.localDescription 
                    }));
                }
            } catch (err) {
                // If recovery fails, cleanly destroy the peer
                document.querySelectorAll(`.stream-${remoteUserId}`).forEach(el => el.remove());
                delete window.peers[remoteUserId]; 
                delete window.iceCandidateQueue[remoteUserId];
            }
        }

        // 2. Only destroy the UI elements if the connection is definitively closed
        if (pc.iceConnectionState === 'closed') {
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

    // Only the "junior" peer initiates to avoid glare
    if (window.myId < data.userId) {
        window.addLocalTracksSafely(pc);
        if (window.localMicStream || window.localCamStream || window.localScreenStream) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                window.socket.send(JSON.stringify({
                    action: 'offer', userId: window.myId,
                    targetId: data.userId, offer: pc.localDescription
                }));
            } catch(e) {}
        }
    } else {
        // Junior peer waits for the offer. Just pre-warm the connection.
        if (!pc) window.createPeerConnection(data.userId);
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
            
            // 1. Grab the raw hardware microphone feed
            const rawConfig = { 
                echoCancellation: true, 
                autoGainControl: true,
                noiseSuppression: true // Turn off the weak browser filter so the AI can do the heavy lifting
            };
            if (micId) rawConfig.deviceId = { ideal: micId };
            
            const rawStream = await navigator.mediaDevices.getUserMedia({ audio: rawConfig });

            try {
                // 2. Load the AI Noise Suppressor from your installed npm package
                const { createNoiseSuppressor } = require('@sapphi-red/web-noise-suppressor');
                
                // Point directly to the node_modules folder since we aren't using a Webpack bundler
                const suppressor = await createNoiseSuppressor(window.audioCtx, {
                    workletPath: './node_modules/@sapphi-red/web-noise-suppressor/dist/noise-suppressor-worklet.js',
                    wasmPath: './node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm'
                });

                const source = window.audioCtx.createMediaStreamSource(rawStream);
                const destination = window.audioCtx.createMediaStreamDestination();

                // 3. NOISE GATE COMPONENTS
                const gateGain = window.audioCtx.createGain();
                gateGain.gain.value = 0; // Start with mic fully muted

                const analyser = window.audioCtx.createAnalyser();
                analyser.fftSize = 512;
                const dataArray = new Float32Array(analyser.frequencyBinCount);

                // 4. WIRE THE PIPELINE: Raw Mic -> AI Suppressor -> Gate -> Output
                source.connect(suppressor);
                suppressor.connect(analyser); // Analyser listens to the cleaned audio to measure volume
                suppressor.connect(gateGain); // Audio flows through the valve
                gateGain.connect(destination);

                // 5. THE GATE ENGINE
                function processGate() {
                    if (!window.localMicStream) return; // Stop loop if call ends
                    
                    analyser.getFloatTimeDomainData(dataArray);
                    
                    // Calculate RMS (Root Mean Square) volume of the audio frame
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
                    const rms = Math.sqrt(sum / dataArray.length);

                    // Grab the threshold from your new slider (or default to 0.01)
                    const slider = document.getElementById('noise-gate-slider');
                    const threshold = slider ? parseFloat(slider.value) : 0.01;

                    // Smoothly open or close the valve to prevent audio popping
                    if (rms > threshold) {
                        // Attack: Open the gate instantly (0.01s) when you speak
                        gateGain.gain.setTargetAtTime(1, window.audioCtx.currentTime, 0.01);
                    } else {
                        // Release: Close the gate slightly slower (0.1s) so the end of words aren't chopped off
                        gateGain.gain.setTargetAtTime(0, window.audioCtx.currentTime, 0.1);
                    }

                    requestAnimationFrame(processGate);
                }
                window.localMicStream = destination.stream;
                processGate(); // Start the monitoring loop


                if (window.addChatLine) window.addChatLine('System', '🎙️ AI Noise Suppression & Noise Gate active.', 'system');

            } catch (aiError) {
                console.warn("AI Suppressor failed to load, falling back to raw mic:", aiError);
                window.localMicStream = rawStream; 
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
            // HIGH-FIDELITY SCREEN SHARE CONFIGURATION
            const screenConfig = { 
                video: { 
                    cursor: "always",
                    frameRate: { ideal: 60, max: 60 },
                    width: { ideal: 1920, max: 2560 },
                    height: { ideal: 1080, max: 1440 }
                }, 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: false,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 2 // Force stereo sound
                } 
            };

            try {
                window.localScreenStream = await navigator.mediaDevices.getDisplayMedia(screenConfig);
            } catch(err1) {
                // Fallback in case the user chooses a window that doesn't support audio capture
                screenConfig.audio = false;
                window.localScreenStream = await navigator.mediaDevices.getDisplayMedia(screenConfig);
            }
            
            shareBtn.innerText = "💻 Stop Share"; shareBtn.classList.replace('secondary-btn', 'primary-btn');
            localVideo.style.display = 'block'; localVideo.srcObject = window.localScreenStream;
            window.renegotiatePeers();

            window.localScreenStream.getVideoTracks()[0].onended = () => { shareBtn.click(); };
        } catch(err) {
            console.error("Screen share failed:", err);
        }
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