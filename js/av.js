// ==========================================
// CENTRAL AUDIO & VIDEO ENGINE (js/av.js)
// Dual-Engine: WebRTC P2P + Instant Dedicated CGNAT Voice & Screen Relay
// ==========================================
window.peers = {};
window.iceCandidateQueue = {};
window.makingOffer = {};
window.ignoreOffer = {};
window.pendingRenegotiation = {};
window.disconnectTimers = {};
window.offerStuckTimers = {};
window.localMicStream = null;
window.localCamStream = null;
window.localScreenStream = null;
window.rawScreenStream = null;
window.audioCtx = null;
window.soundboardDest = null;
window.soundboardTrack = null;
window.isMuted = false;
window.remoteGainNodes = {};
window.remoteAudioEls = {};
window.bridgePlayTimes = {};
window._activeBridgeSources = {};
window._webrtcAudioActive = {};
window._peerAckedAudio = {};
window._peerAckedVideo = {};
window._peerCreatedAt = {};
window._callWatchdogInterval = null;
window._screenBridgeInterval = null;

window.rtcConfig = { 
    iceCandidatePoolSize: 2,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
        {
            urls: [
                "turn:openrelay.metered.ca:80",
                "turn:openrelay.metered.ca:443",
                "turn:openrelay.metered.ca:443?transport=tcp",
                "turns:openrelay.metered.ca:443?transport=tcp"
            ],
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: [
                "turn:standard.relay.metered.ca:80",
                "turn:standard.relay.metered.ca:80?transport=tcp",
                "turn:standard.relay.metered.ca:443",
                "turns:standard.relay.metered.ca:443?transport=tcp"
            ],
            username: "e8dd65b92aad9a3828ef62a4",
            credential: "282/325+t32768="
        }
    ] 
};

window.initAudioCtx = function() {
    if (!window.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        try {
            window.audioCtx = new AudioContextClass({
                sampleRate: 48000,
                latencyHint: 'interactive'
            });
        } catch (e) {
            window.audioCtx = new AudioContextClass();
        }
        window.soundboardDest = window.audioCtx.createMediaStreamDestination();
        window.soundboardTrack = window.soundboardDest.stream.getAudioTracks()[0];

        const outId = localStorage.getItem('appAudioOut');
        if (outId && outId !== 'default' && typeof window.audioCtx.setSinkId === 'function') {
            window.audioCtx.setSinkId(outId).catch(() => {});
        }
    }
    if (window.audioCtx.state === 'suspended') {
        window.audioCtx.resume().catch(() => {});
    }
};

window.isAnyFriendSpeaking = function() {
    if (!window.audioCtx) return false;
    const now = window.audioCtx.currentTime;
    for (const uid of Object.keys(window.bridgePlayTimes)) {
        if (window.bridgePlayTimes[uid] > now) return true;
    }
    return false;
};

window.getOrCreateRemoteGain = function(remoteUserId) {
    if (!window.audioCtx) window.initAudioCtx();
    if (window.audioCtx.state === 'suspended') window.audioCtx.resume().catch(() => {});
    if (window.remoteGainNodes[remoteUserId]) return window.remoteGainNodes[remoteUserId];

    const remoteGain = window.audioCtx.createGain();
    const slider = document.getElementById(`vol-${remoteUserId}`);
    const savedVol = slider ? parseFloat(slider.value) : 1.0;
    remoteGain.gain.value = window.inVoiceCall ? Math.min(1.0, savedVol) : 0.0;

    remoteGain.connect(window.audioCtx.destination);
    window.remoteGainNodes[remoteUserId] = remoteGain;
    return remoteGain;
};

window.stopBridgeSourcesForPeer = function(uid) {
    if (window._activeBridgeSources && window._activeBridgeSources[uid]) {
        window._activeBridgeSources[uid].forEach(s => {
            try { s.stop(); s.disconnect(); } catch (e) {}
        });
        window._activeBridgeSources[uid] = [];
    }
    if (window.bridgePlayTimes) window.bridgePlayTimes[uid] = 0;
};

// Receptor de Voz Dedicado (Ativo imediatamente enquanto o WebRTC P2P estiver bloqueado por CGNAT!)
window.handleVoiceFrame = function(data) {
    if (!window.inVoiceCall) return;
    if (!data || data.userId === window.myId || !data.d) return;

    // Só desliga a ponte se o WebRTC P2P deste amigo já confirmou reprodução ativa de áudio
    if (window._webrtcAudioActive[data.userId]) {
        window.stopBridgeSourcesForPeer(data.userId);
        return;
    }

    if (data.ts && Math.abs(Date.now() - data.ts) > 2500) return;

    if (!window.audioCtx) window.initAudioCtx();
    if (window.audioCtx.state === 'suspended') window.audioCtx.resume().catch(() => {});

    const statusEl = document.getElementById('voice-status');
    if (statusEl && window.inVoiceCall && statusEl.innerText.includes('Connecting')) {
        statusEl.style.color = '#10b981';
        statusEl.innerText = 'Call: Studio Voice Active 🟢';
    }

    try {
        const binaryStr = atob(data.d);
        const byteLen = binaryStr.length;
        let float32;

        if (data.fmt === 'i16') {
            const bytes = new Uint8Array(byteLen);
            for (let i = 0; i < byteLen; i++) bytes[i] = binaryStr.charCodeAt(i);
            const int16 = new Int16Array(bytes.buffer);
            float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768.0;
            }
        } else {
            float32 = new Float32Array(byteLen);
            for (let i = 0; i < byteLen; i++) {
                let v = binaryStr.charCodeAt(i);
                if (v >= 128) v -= 256;
                float32[i] = v / 128.0;
            }
        }

        // Suavização de 48 amostras nas bordas para eliminar cliques entre pacotes
        const fadeLen = Math.min(48, Math.floor(float32.length / 8));
        for (let i = 0; i < fadeLen; i++) {
            const w = i / fadeLen;
            float32[i] *= w;
            float32[float32.length - 1 - i] *= w;
        }

        const sr = data.sr || 16000;
        const audioBuffer = window.audioCtx.createBuffer(1, float32.length, sr);
        audioBuffer.getChannelData(0).set(float32);

        const source = window.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gainNode = window.getOrCreateRemoteGain(data.userId);
        const slider = document.getElementById(`vol-${data.userId}`);
        const savedVol = slider ? parseFloat(slider.value) : 1.0;
        gainNode.gain.value = window.inVoiceCall ? Math.min(1.0, savedVol) : 0.0;

        source.connect(gainNode);

        const now = window.audioCtx.currentTime;
        let startTime = window.bridgePlayTimes[data.userId] || 0;

        // Se a fila acumular mais de 280ms de atraso, limpa os buffers antigos para zero sobreposição/eco!
        if (startTime > now + 0.28) {
            window.stopBridgeSourcesForPeer(data.userId);
            startTime = now + 0.03;
        } else if (startTime < now) {
            startTime = now + 0.03;
        }

        if (!window._activeBridgeSources[data.userId]) window._activeBridgeSources[data.userId] = [];
        window._activeBridgeSources[data.userId].push(source);
        source.onended = () => {
            if (window._activeBridgeSources[data.userId]) {
                window._activeBridgeSources[data.userId] = window._activeBridgeSources[data.userId].filter(s => s !== source);
            }
        };

        source.start(startTime);
        window.bridgePlayTimes[data.userId] = startTime + audioBuffer.duration;
    } catch (e) {}
};

// Receptor de Compartilhamento de Tela (Ponte Dedicada + WebRTC)
window.handleScreenFrame = function(data) {
    if (!data || data.userId === window.myId) return;

    const stageCont = document.getElementById('remote-audio-container') || document.querySelector('#video-grid .panel-content');
    if (!stageCont) return;

    if (data.action === 'screen_stop') {
        const old = document.getElementById(`bridge-screen-container-${data.userId}`);
        if (old) old.remove();
        return;
    }

    if (!data.frame) return;

    const hasNativeVideo = Array.from(document.querySelectorAll(`.stream-${data.userId} video`)).some(v => v.readyState >= 2 && !v.paused && v.videoWidth > 0);
    if (hasNativeVideo) {
        const old = document.getElementById(`bridge-screen-container-${data.userId}`);
        if (old) old.remove();
        return;
    }

    let container = document.getElementById(`bridge-screen-container-${data.userId}`);
    let imgEl = document.getElementById(`bridge-screen-img-${data.userId}`);

    if (!container) {
        container = document.createElement('div');
        container.id = `bridge-screen-container-${data.userId}`;
        container.className = `stream-container stream-${data.userId}`;
        container.style.cssText = 'position:relative; width:100%; height:100%; min-height:260px; background:#000; border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center;';

        const label = document.createElement('div');
        label.className = 'stream-label';
        label.innerText = `💻 ${window.peerNames[data.userId] || 'Friend'} (Live Screen)`;

        imgEl = document.createElement('img');
        imgEl.id = `bridge-screen-img-${data.userId}`;
        imgEl.style.cssText = 'width:100%; height:100%; max-height:65vh; object-fit:contain; display:block;';

        container.appendChild(label);
        container.appendChild(imgEl);
        stageCont.appendChild(container);
    }

    if (imgEl) imgEl.src = data.frame;
};

// Transmissor de Tela em Canal Dedicado (WebP 480p ~5KB/frame -> 4 FPS suaves sem travar o chat nem a UI!)
window.startScreenBridgeSender = function() {
    if (window._screenBridgeInterval) clearInterval(window._screenBridgeInterval);
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');
    let encodingBusy = false;

    window._screenBridgeInterval = setInterval(() => {
        if (!window.localScreenStream || !window.socket || window.socket.readyState !== WebSocket.OPEN) {
            clearInterval(window._screenBridgeInterval);
            window._screenBridgeInterval = null;
            return;
        }
        if (encodingBusy) return;

        const peerIds = Object.keys(window.peerNames || {});
        if (peerIds.length === 0) return;

        // Continua enviando enquanto o amigo ainda não confirmou recepção do vídeo WebRTC nativo (`_peerAckedVideo`)
        const needsScreenBridge = peerIds.some(uid => !window._peerAckedVideo[uid]);
        if (!needsScreenBridge) return;

        const localVideo = document.getElementById('local-screen-video');
        if (!localVideo || localVideo.videoWidth === 0 || localVideo.videoHeight === 0) return;

        // 480x270 em WebP 0.38 gera frames de apenas ~4.5 KB (passa instantaneamente pelo broker de mídia a ~4 FPS!)
        const targetW = Math.min(480, localVideo.videoWidth);
        const scale = targetW / localVideo.videoWidth;
        const targetH = Math.round(localVideo.videoHeight * scale);

        if (offCanvas.width !== targetW) offCanvas.width = targetW;
        if (offCanvas.height !== targetH) offCanvas.height = targetH;

        offCtx.drawImage(localVideo, 0, 0, targetW, targetH);
        encodingBusy = true;

        offCanvas.toBlob((blob) => {
            if (!blob || !window.localScreenStream) {
                encodingBusy = false;
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                encodingBusy = false;
                const base64Url = reader.result;
                if (base64Url && window.socket && window.socket.readyState === WebSocket.OPEN) {
                    window.socket.send(JSON.stringify({
                        action: 'screen_frame',
                        userId: window.myId,
                        ts: Date.now(),
                        frame: base64Url
                    }));
                }
            };
            reader.readAsDataURL(blob);
        }, 'image/webp', 0.38);
    }, 260);
};

window.rebuildMicPipeline = async function() {
    if (!window.audioCtx) window.initAudioCtx();
    if (window.audioCtx.state === 'suspended') await window.audioCtx.resume().catch(() => {});

    window._micGeneration = (window._micGeneration || 0) + 1;
    const myGen = window._micGeneration;
    const micId = localStorage.getItem('appAudioIn');
    const useAiSuppression = localStorage.getItem('appAiNoise') !== 'false';

    if (window._rawMicStream) {
        window._rawMicStream.getTracks().forEach(t => t.stop());
        window._rawMicStream = null;
    }

    [
        '_micSourceNode', '_micHighPass', '_micSuppressor', '_micCompressor',
        '_micGain', '_micBridgeFilter', '_micBridgeProcessor', '_micBridgeKeepAlive'
    ].forEach(k => {
        try { window[k]?.disconnect(); } catch(e) {}
        try { window[k]?.destroy?.(); } catch(e) {}
        window[k] = null;
    });

    const baseAudioCfg = {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 }
    };

    let rawStream;
    try {
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: (micId && micId !== 'default') ? { ...baseAudioCfg, deviceId: { ideal: micId } } : baseAudioCfg
        });
    } catch (e) {
        rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    window._rawMicStream = rawStream;

    const nowTime = window.audioCtx.currentTime;
    const source = window.audioCtx.createMediaStreamSource(rawStream);
    const destination = window.audioCtx.createMediaStreamDestination();

    const highPass = window.audioCtx.createBiquadFilter();
    highPass.channelCount = 1;
    highPass.channelCountMode = 'explicit';
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(85, nowTime);
    highPass.Q.setValueAtTime(0.707, nowTime);

    const compressor = window.audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, nowTime);
    compressor.knee.setValueAtTime(8, nowTime);
    compressor.ratio.setValueAtTime(4.0, nowTime);
    compressor.attack.setValueAtTime(0.003, nowTime);
    compressor.release.setValueAtTime(0.15, nowTime);

    const micGain = window.audioCtx.createGain();
    micGain.gain.setValueAtTime(0.95, nowTime);

    source.connect(highPass);
    let head = highPass;

    if (useAiSuppression && window.loadKrispRNNoiseNode && window.audioCtx.sampleRate === 48000) {
        try {
            const suppressor = await window.loadKrispRNNoiseNode(window.audioCtx);
            head.connect(suppressor);
            head = suppressor;
            window._micSuppressor = suppressor;
        } catch (e) {}
    }

    head.connect(compressor);
    compressor.connect(micGain);
    micGain.connect(destination);

    // Filtro anti-aliasing para a Ponte de Voz 16kHz 16-bit (ativa imediatamente até que o amigo confirme WebRTC P2P!)
    const bridgeFilter = window.audioCtx.createBiquadFilter();
    bridgeFilter.type = 'lowpass';
    bridgeFilter.frequency.setValueAtTime(7200, nowTime);
    bridgeFilter.Q.setValueAtTime(0.707, nowTime);

    const bridgeProcessor = window.audioCtx.createScriptProcessor(2048, 1, 1);
    const keepAliveGain = window.audioCtx.createGain();
    keepAliveGain.gain.value = 0.00001;

    micGain.connect(bridgeFilter);
    bridgeFilter.connect(bridgeProcessor);
    bridgeProcessor.connect(keepAliveGain);
    keepAliveGain.connect(window.audioCtx.destination);

    let int16Queue = [];
    const targetSr = 16000;
    const step = Math.max(1, Math.round(window.audioCtx.sampleRate / targetSr));
    let lastVoiceDetectedAt = 0;

    bridgeProcessor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const output = ev.outputBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) output[i] = 0;

        if (myGen !== window._micGeneration || window.isMuted || !window.inVoiceCall) {
            int16Queue = [];
            return;
        }
        if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;

        const roomPeers = Object.keys(window.peerNames || {});
        if (roomPeers.length === 0) return;

        // Continua transmitindo pela ponte até que o amigo confirme explicitamente ('audio_ack') que o WebRTC P2P está tocando!
        const needsBridge = roomPeers.some(uid => !window._peerAckedAudio[uid]);
        if (!needsBridge) {
            int16Queue = [];
            return;
        }

        let sum = 0;
        for (let i = 0; i < input.length; i += 4) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / (input.length / 4));

        const slider = document.getElementById('noise-gate-slider');
        const threshold = slider ? Math.min(0.015, Math.max(0.0008, parseFloat(slider.value) * 0.3)) : 0.0015;
        const nowMs = performance.now();

        if (rms >= threshold) {
            lastVoiceDetectedAt = nowMs;
        }

        if (nowMs - lastVoiceDetectedAt > 240) {
            int16Queue = [];
            return;
        }

        for (let j = 0; j < input.length; j += step) {
            // Soft-clipper suave (Math.tanh): 0% de chance de estourar/clipar o áudio!
            const s = Math.tanh(input[j] * 0.9);
            int16Queue.push(Math.round(s * 32767));
        }

        // Pacotes curtos de 120ms (1920 amostras @ 16kHz) para baixa latência!
        if (int16Queue.length >= 1920) {
            const int16Arr = new Int16Array(int16Queue);
            int16Queue = [];
            const bytes = new Uint8Array(int16Arr.buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }

            window.socket.send(JSON.stringify({
                action: 'voice_frame',
                userId: window.myId,
                fmt: 'i16',
                sr: Math.round(window.audioCtx.sampleRate / step),
                ts: Date.now(),
                d: btoa(binary)
            }));
        }
    };

    const oldMicTrack = window.localMicStream?.getAudioTracks()[0] || window._lastMicTrack;
    const newTrack = destination.stream.getAudioTracks()[0] || rawStream.getAudioTracks()[0];
    newTrack.enabled = !window.isMuted;
    if ('contentHint' in newTrack) newTrack.contentHint = 'speech';
    window._lastMicTrack = newTrack;

    Object.values(window.peers).forEach(pc => {
        const sender = pc.getSenders().find(s =>
            s.track && (s.track === oldMicTrack || (s.track.kind === 'audio' && s.track !== window.soundboardTrack))
        );
        if (sender) {
            sender.replaceTrack(newTrack).catch(() => {});
            if (window.boostAudioSenderBitrate) window.boostAudioSenderBitrate(sender);
        }
    });

    window.localMicStream = destination.stream;
    window._micSourceNode = source;
    window._micHighPass = highPass;
    window._micCompressor = compressor;
    window._micGain = micGain;
    window._micBridgeFilter = bridgeFilter;
    window._micBridgeProcessor = bridgeProcessor;
    window._micBridgeKeepAlive = keepAliveGain;

    return destination.stream;
};

window.tuneVideoSenderBitrate = async function(sender) {
    if (!sender || !sender.getParameters) return;
    try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].maxBitrate = 2500000;
        params.encodings[0].maxFramerate = 30;
        params.encodings[0].priority = 'high';
        await sender.setParameters(params);
    } catch (e) {}
};

window.addLocalTracksSafely = function(pc) {
    const sentTracks = pc.getSenders().map(s => s.track).filter(Boolean);
    const streams = [window.localMicStream, window.localScreenStream, window.localCamStream].filter(Boolean);
    
    streams.forEach(stream => {
        stream.getTracks().forEach(track => {
            if (!sentTracks.includes(track) && track.readyState === 'live') {
                try { 
                    const sender = pc.addTrack(track, stream);
                    if (track.kind === 'audio' && window.boostAudioSenderBitrate) {
                        window.boostAudioSenderBitrate(sender);
                    } else if (track.kind === 'video') {
                        window.tuneVideoSenderBitrate(sender);
                    }
                } catch(e){}
            }
        });
    });
};

window.flushCandidateQueue = async function(remoteUserId) {
    const pc = window.peers[remoteUserId];
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) return;
    const queue = window.iceCandidateQueue[remoteUserId];
    if (!queue) return;

    while (queue.length > 0) {
        const cand = queue.shift();
        try { await pc.addIceCandidate(cand); } catch (e) {}
    }
};

window.sendOfferSafely = async function(pc, remoteUserId, iceRestart = false) {
    if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;
    if (window.makingOffer[remoteUserId]) {
        window.pendingRenegotiation[remoteUserId] = true;
        return;
    }

    if (pc.signalingState !== 'stable' && !iceRestart) {
        window.pendingRenegotiation[remoteUserId] = true;
        return;
    }

    try {
        window.makingOffer[remoteUserId] = true;
        window.pendingRenegotiation[remoteUserId] = false;

        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : {});
        if (pc.signalingState !== 'stable' && !iceRestart) return;
        await pc.setLocalDescription(offer);

        const outboundOffer = {
            type: pc.localDescription.type,
            sdp: window.enhanceOpusSDP ? window.enhanceOpusSDP(pc.localDescription.sdp) : pc.localDescription.sdp
        };

        window.socket.send(JSON.stringify({
            action: 'offer',
            userId: window.myId,
            targetId: remoteUserId,
            offer: outboundOffer,
            ts: Date.now()
        }));

        clearTimeout(window.offerStuckTimers[remoteUserId]);
        window.offerStuckTimers[remoteUserId] = setTimeout(async () => {
            if (pc.signalingState === 'have-local-offer') {
                try { await pc.setLocalDescription({ type: "rollback" }); } catch (e) {}
                if (window.myId < remoteUserId) {
                    window.sendOfferSafely(pc, remoteUserId, true);
                }
            }
        }, 6000);
    } catch (e) {
        console.warn("sendOfferSafely error:", e);
    } finally {
        window.makingOffer[remoteUserId] = false;
    }
};

window.createPeerConnection = function(remoteUserId) {
    if (window.peers[remoteUserId]) return window.peers[remoteUserId];

    const pc = new RTCPeerConnection(window.rtcConfig);
    window.peers[remoteUserId] = pc;
    window.ignoreOffer[remoteUserId] = false;
    window._peerCreatedAt[remoteUserId] = Date.now();

    pc.onicecandidate = (event) => { 
        if (event.candidate && window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({
                action: 'ice-candidate',
                userId: window.myId,
                targetId: remoteUserId,
                candidate: event.candidate,
                ts: Date.now()
            }));
        }
    };

    const triggerIceRecovery = async () => {
        if (!window.peers[remoteUserId]) return;
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return;
        if (window.myId < remoteUserId) {
            await window.sendOfferSafely(pc, remoteUserId, true);
        }
    };

    pc.oniceconnectionstatechange = async () => {
        const state = pc.iceConnectionState;
        const statusEl = document.getElementById('voice-status');
        if (statusEl && window.inVoiceCall) {
            statusEl.style.display = 'block';
            if (state === 'connected' || state === 'completed') {
                statusEl.style.color = '#10b981';
                statusEl.innerText = 'Call: Studio 256kbps P2P 🟢';
            } else {
                statusEl.style.color = '#10b981';
                statusEl.innerText = 'Call: Studio Voice Active 🟢';
            }
        }

        if (state === 'connected' || state === 'completed') {
            clearTimeout(window.disconnectTimers[remoteUserId]);
        }

        if (state === 'disconnected') {
            window._peerAckedAudio[remoteUserId] = false;
            window._peerAckedVideo[remoteUserId] = false;
            window._webrtcAudioActive[remoteUserId] = false;
            clearTimeout(window.disconnectTimers[remoteUserId]);
            window.disconnectTimers[remoteUserId] = setTimeout(triggerIceRecovery, 4000);
        }

        if (state === 'failed') {
            window._peerAckedAudio[remoteUserId] = false;
            window._peerAckedVideo[remoteUserId] = false;
            window._webrtcAudioActive[remoteUserId] = false;
            clearTimeout(window.disconnectTimers[remoteUserId]);
            await triggerIceRecovery();
        }

        if (state === 'closed') {
            window._peerAckedAudio[remoteUserId] = false;
            window._peerAckedVideo[remoteUserId] = false;
            window._webrtcAudioActive[remoteUserId] = false;
            clearTimeout(window.disconnectTimers[remoteUserId]);
            clearTimeout(window.offerStuckTimers[remoteUserId]);
            document.querySelectorAll(`.stream-${remoteUserId}`).forEach(el => el.remove());
            delete window.peers[remoteUserId]; 
            delete window.iceCandidateQueue[remoteUserId];
        }
    };

    pc.ontrack = (event) => {
        if (event.receiver && 'playoutDelayHint' in event.receiver) {
            event.receiver.playoutDelayHint = 0.02;
        }

        const stream = event.streams[0] || new MediaStream([event.track]);
        
        event.track.onended = () => { 
            const aud = document.getElementById(`audio-${event.track.id}`); if (aud) aud.remove(); 
            const vid = document.getElementById(`video-container-${event.track.id}`); if (vid) vid.remove();
            if (event.track.kind === 'audio') window._webrtcAudioActive[remoteUserId] = false;
        };

        if (event.track.kind === 'audio') {
            let audioCont = document.getElementById('hidden-audio-sinks');
            if (!audioCont) {
                audioCont = document.createElement('div');
                audioCont.id = 'hidden-audio-sinks';
                audioCont.style.cssText = 'width:0; height:0; position:absolute; overflow:hidden; opacity:0; pointer-events:none;';
                document.body.appendChild(audioCont);
            }
            
            let remoteAudio = document.getElementById(`audio-${event.track.id}`);
            if (!remoteAudio) {
                remoteAudio = document.createElement('audio'); 
                remoteAudio.id = `audio-${event.track.id}`; 
                remoteAudio.className = `stream-${remoteUserId}`;
                remoteAudio.autoplay = true;
                remoteAudio.playsInline = true;
                audioCont.appendChild(remoteAudio);
            }

            const slider = document.getElementById(`vol-${remoteUserId}`);
            const savedVol = slider ? parseFloat(slider.value) : 1.0;
            remoteAudio.muted = !window.inVoiceCall;
            remoteAudio.volume = window.inVoiceCall ? Math.min(1.0, savedVol) : 0.0;
            remoteAudio.srcObject = stream;

            const outId = localStorage.getItem('appAudioOut'); 
            if (outId && outId !== 'default' && typeof remoteAudio.setSinkId === 'function') {
                remoteAudio.setSinkId(outId).catch(() => {});
            }

            remoteAudio.onplaying = () => {
                window._webrtcAudioActive[remoteUserId] = true;
                window.stopBridgeSourcesForPeer(remoteUserId);
                if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                    window.socket.send(JSON.stringify({
                        action: 'audio_ack',
                        userId: window.myId,
                        targetId: remoteUserId,
                        ts: Date.now()
                    }));
                }
            };

            remoteAudio.play().catch(() => {});
            window.remoteAudioEls[remoteUserId] = remoteAudio;
        }
        
        if (event.track.kind === 'video') {
            let videoContainer = document.getElementById(`video-container-${event.track.id}`);
            if (!videoContainer) {
                videoContainer = document.createElement('div'); 
                videoContainer.id = `video-container-${event.track.id}`; 
                videoContainer.className = `stream-container stream-${remoteUserId}`;
                
                const label = document.createElement('div');
                label.className = "stream-label"; 
                label.innerText = `💻 ${window.peerNames[remoteUserId] || 'Friend'}`;
                
                const remoteVideo = document.createElement('video'); 
                remoteVideo.id = `video-${event.track.id}`; 
                remoteVideo.autoplay = true;
                remoteVideo.playsInline = true;
                remoteVideo.controls = true; 
                remoteVideo.srcObject = stream;

                remoteVideo.onplaying = () => {
                    const oldBr = document.getElementById(`bridge-screen-container-${remoteUserId}`);
                    if (oldBr) oldBr.remove();
                    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                        window.socket.send(JSON.stringify({
                            action: 'video_ack',
                            userId: window.myId,
                            targetId: remoteUserId,
                            ts: Date.now()
                        }));
                    }
                };
                
                videoContainer.appendChild(label);
                videoContainer.appendChild(remoteVideo); 
                
                const stageCont = document.getElementById('remote-audio-container') || document.querySelector('#video-grid .panel-content') || document.getElementById('video-grid');
                if (stageCont) stageCont.appendChild(videoContainer);
                
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
        await window.sendOfferSafely(pc, remoteUserId, false);
    }
};

window.startCallConnectionWatchdog = function() {
    if (window._callWatchdogInterval) clearInterval(window._callWatchdogInterval);
    window._callWatchdogInterval = setInterval(async () => {
        if (!window.inVoiceCall && !window.localScreenStream && !window.localCamStream) {
            clearInterval(window._callWatchdogInterval);
            window._callWatchdogInterval = null;
            return;
        }

        for (const uid of Object.keys(window.peerNames || {})) {
            const peerWantsMedia = (window.peerInCall && window.peerInCall[uid]) || window.localScreenStream || window.localCamStream;
            if (!peerWantsMedia) continue;

            let pc = window.peers[uid];
            const state = pc ? pc.iceConnectionState : 'none';

            if (!pc || state === 'closed' || state === 'failed') {
                if (pc) { try { pc.close(); } catch (e) {} delete window.peers[uid]; }
                pc = window.createPeerConnection(uid);
                window.addLocalTracksSafely(pc);
                if (window.myId < uid || !window.peerInCall[uid]) {
                    await window.sendOfferSafely(pc, uid, false);
                }
            } else if (state === 'new' && pc.signalingState === 'stable') {
                window.addLocalTracksSafely(pc);
                if (window.myId < uid || !window.peerInCall[uid]) {
                    await window.sendOfferSafely(pc, uid, false);
                }
            }
        }
    }, 4000);
};

window.handleWebRTCSignal = async function(data) {
    if ((data.action === 'join' || data.action === 'presence') && data.userId !== window.myId) {
        if (data.action === 'presence' && data.targetId && data.targetId !== window.myId) return;

        const existingPc = window.peers[data.userId];
        const ageMs = Date.now() - (window._peerCreatedAt[data.userId] || 0);
        const isDead = existingPc && (existingPc.iceConnectionState === 'closed' || (existingPc.iceConnectionState === 'failed' && ageMs > 8000));

        if (isDead) {
            try { existingPc.close(); } catch (e) {}
            delete window.peers[data.userId];
        }

        const pc = window.peers[data.userId];
        const isUnconnected = !pc || (pc.iceConnectionState === 'new' && pc.signalingState === 'stable');

        if (isUnconnected && (window.inVoiceCall || window.localMicStream || window.localCamStream || window.localScreenStream)) {
            const activePc = pc || window.createPeerConnection(data.userId);
            window.addLocalTracksSafely(activePc);
            if (!data.inCall || window.myId < data.userId) {
                await window.sendOfferSafely(activePc, data.userId, false);
            }
        }
    }
    else if (data.action === 'offer' && data.targetId === window.myId) {
        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);
        
        try {
            const isPolite = window.myId > data.userId;
            const offerCollision = window.makingOffer[data.userId] || pc.signalingState !== 'stable';
            window.ignoreOffer[data.userId] = !isPolite && offerCollision;
            if (window.ignoreOffer[data.userId]) return;

            clearTimeout(window.offerStuckTimers[data.userId]);
            if (offerCollision) {
                try { await pc.setLocalDescription({ type: "rollback" }); } catch (rbErr) {}
            }
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

            window.ignoreOffer[data.userId] = false;
            await window.flushCandidateQueue(data.userId);
            window.addLocalTracksSafely(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const outboundAnswer = {
                type: pc.localDescription.type,
                sdp: window.enhanceOpusSDP ? window.enhanceOpusSDP(pc.localDescription.sdp) : pc.localDescription.sdp
            };

            window.socket.send(JSON.stringify({
                action: 'answer',
                userId: window.myId,
                targetId: data.userId,
                answer: outboundAnswer,
                ts: Date.now()
            }));

            if (window.pendingRenegotiation[data.userId]) {
                window.pendingRenegotiation[data.userId] = false;
                setTimeout(() => window.sendOfferSafely(pc, data.userId, false), 120);
            }
        } catch(e) {
            console.warn("Offer handling error:", e);
        }
    }
    else if (data.action === 'answer' && data.targetId === window.myId) {
        const pc = window.peers[data.userId];
        if (pc && pc.signalingState === 'have-local-offer') {
            try {
                clearTimeout(window.offerStuckTimers[data.userId]);
                window.ignoreOffer[data.userId] = false;
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                await window.flushCandidateQueue(data.userId);

                if (window.pendingRenegotiation[data.userId]) {
                    window.pendingRenegotiation[data.userId] = false;
                    setTimeout(() => {
                        window.addLocalTracksSafely(pc);
                        window.sendOfferSafely(pc, data.userId, false);
                    }, 100);
                }
            } catch(e) {
                console.warn("Answer handling error:", e);
            }
        }
    }
    else if ((data.action === 'ice-candidate' || data.action === 'ice-candidates') && data.targetId === window.myId) {
        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);
        if (window.ignoreOffer[data.userId]) return;

        const list = data.candidates || (data.candidate ? [data.candidate] : []);
        for (const rawCand of list) {
            const candidate = new RTCIceCandidate(rawCand);
            if (pc.remoteDescription && pc.remoteDescription.type) {
                try {
                    await pc.addIceCandidate(candidate);
                } catch (e) {
                    if (!window.iceCandidateQueue[data.userId]) window.iceCandidateQueue[data.userId] = [];
                    window.iceCandidateQueue[data.userId].push(candidate);
                }
            } else { 
                if (!window.iceCandidateQueue[data.userId]) window.iceCandidateQueue[data.userId] = []; 
                window.iceCandidateQueue[data.userId].push(candidate); 
            }
        }
    }
};

// ==========================================
// CLICK LISTENERS (JOIN CALL, MUTE, CAM, SHARE SCREEN)
// ==========================================
document.addEventListener('click', async (e) => {
    // 1. JOIN / LEAVE CALL BUTTON
    if (e.target.closest('#join-voice-btn')) {
        const btn = document.getElementById('join-voice-btn');
        const muteBtn = document.getElementById('mute-mic-btn');
        const statusEl = document.getElementById('voice-status');

        if (window.inVoiceCall) {
            window.inVoiceCall = false;
            window._micGeneration = (window._micGeneration || 0) + 1;
            if (window.playUiSound) window.playUiSound('leave_call');

            if (window._rawMicStream) {
                window._rawMicStream.getTracks().forEach(t => t.stop());
                window._rawMicStream = null;
            }
            if (window.localMicStream) {
                const oldTracks = window.localMicStream.getTracks();
                oldTracks.forEach(t => {
                    t.stop();
                    Object.values(window.peers).forEach(pc => {
                        const sender = pc.getSenders().find(s => s.track === t);
                        if (sender) { try { pc.removeTrack(sender); } catch(err){} }
                    });
                });
                window.localMicStream = null;
            }
            if (window.localCamStream) document.getElementById('toggle-cam-btn')?.click();
            if (window.localScreenStream) document.getElementById('share-screen-btn')?.click();

            Object.values(window.remoteGainNodes).forEach(g => {
                try { g.gain.setTargetAtTime(0, window.audioCtx.currentTime, 0.01); } catch (err) {}
            });
            Object.values(window.remoteAudioEls).forEach(a => {
                try { a.muted = true; a.volume = 0; } catch (err) {}
            });
            Object.keys(window.peers).forEach(uid => {
                try { window.peers[uid].close(); } catch (err) {}
                delete window.peers[uid];
            });
            window._webrtcAudioActive = {};
            window._peerAckedAudio = {};
            window._peerAckedVideo = {};

            if (btn) {
                btn.innerText = "🎙️ Join Call";
                btn.style.background = "";
                btn.style.color = "";
            }
            if (muteBtn) muteBtn.disabled = true;
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.color = 'var(--text-muted)';
                statusEl.innerText = 'Call: Left Voice Channel (LAN Active 🎮)';
            }

            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                window.socket.send(JSON.stringify({ action: 'call_state', userId: window.myId, inCall: false, ts: Date.now() }));
            }
            if (window.renderConnectedUsers) window.renderConnectedUsers();
            return;
        }

        // JOIN VOICE CALL
        window.inVoiceCall = true;
        window._peerAckedAudio = {};
        if (!window.audioCtx) window.initAudioCtx();
        if (window.audioCtx.state === 'suspended') await window.audioCtx.resume().catch(() => {});
        if (window.playUiSound) window.playUiSound('join_call');

        Object.keys(window.remoteGainNodes).forEach(uid => {
            const saved = document.getElementById(`vol-${uid}`)?.value;
            const vol = saved !== undefined ? parseFloat(saved) : 1.0;
            try {
                window.remoteGainNodes[uid].gain.setTargetAtTime(vol, window.audioCtx.currentTime, 0.01);
            } catch (err) {}
        });
        Object.keys(window.remoteAudioEls).forEach(uid => {
            const saved = document.getElementById(`vol-${uid}`)?.value;
            const vol = saved !== undefined ? parseFloat(saved) : 1.0;
            try {
                window.remoteAudioEls[uid].muted = false;
                window.remoteAudioEls[uid].volume = Math.min(1.0, vol);
                window.remoteAudioEls[uid].play().catch(() => {});
            } catch (err) {}
        });

        let micSuccess = false;
        try {
            await window.rebuildMicPipeline();
            if (window.addChatLine) window.addChatLine('System', '🎙️ Joined Voice Channel (Dual-Engine Studio Voice active).', 'system');
            micSuccess = true;
        } catch (err) {
            if (window.addChatLine) window.addChatLine('System', '🎧 Joined Voice Channel in Listen-Only mode (No mic detected).', 'system');
        }

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#10b981';
            statusEl.innerText = 'Call: Studio Voice Active 🟢';
        }
        if (btn) {
            btn.innerText = "📴 Leave Call";
            btn.style.background = "#ef4444";
            btn.style.color = "#fff";
        }
        if (micSuccess && muteBtn) muteBtn.disabled = false;

        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'call_state', userId: window.myId, inCall: true, ts: Date.now() }));
        }
        if (window.renderConnectedUsers) window.renderConnectedUsers();

        window.startCallConnectionWatchdog();
        await new Promise(r => setTimeout(r, 60)); 
        window.renegotiatePeers();
    }

    // 2. MUTE / UNMUTE BUTTON
    if (e.target.closest('#mute-mic-btn')) {
        if (window.localMicStream) {
            window.isMuted = !window.isMuted; 
            window.localMicStream.getAudioTracks()[0].enabled = !window.isMuted;
            const mBtn = e.target.closest('#mute-mic-btn');
            mBtn.innerText = window.isMuted ? "🔈 Unmute" : "🔇 Mute"; 
            mBtn.style.color = window.isMuted ? "var(--accent-alert)" : "var(--text-main)"; 
            mBtn.style.borderColor = window.isMuted ? "var(--accent-alert)" : "var(--border-color)";
        }
    }

    // 3. CAMERA BUTTON
    if (e.target.closest('#toggle-cam-btn')) {
        const btn = e.target.closest('#toggle-cam-btn');
        const localCam = document.getElementById('local-cam-video');
        if (window.localCamStream) {
            window.localCamStream.getTracks().forEach(t => {
                t.stop();
                Object.values(window.peers).forEach(pc => { const sender = pc.getSenders().find(s => s.track === t); if(sender) pc.removeTrack(sender); });
            });
            window.localCamStream = null;
            btn.innerText = "📷 Camera"; btn.classList.replace('primary-btn', 'secondary-btn');
            if (localCam) { localCam.style.display = 'none'; localCam.srcObject = null; }
            window.renegotiatePeers();
        } else {
            try {
                const camId = localStorage.getItem('appVideoIn');
                window.localCamStream = await navigator.mediaDevices.getUserMedia({
                    video: camId ? { deviceId: { ideal: camId }, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } } : { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } }
                });
                if (localCam) { localCam.style.display = 'block'; localCam.srcObject = window.localCamStream; }
                btn.innerText = "📷 Stop Cam"; btn.classList.replace('secondary-btn', 'primary-btn');
                window.startCallConnectionWatchdog();
                window.renegotiatePeers();
            } catch (err) {}
        }
    }

    // 4. SHARE SCREEN BUTTON
    if (e.target.closest('#share-screen-btn')) {
        const shareBtn = e.target.closest('#share-screen-btn');
        const localVideo = document.getElementById('local-screen-video'); 
        
        if (window.localScreenStream) {
            window._peerAckedVideo = {};
            if (window._screenBridgeInterval) {
                clearInterval(window._screenBridgeInterval);
                window._screenBridgeInterval = null;
            }
            window.localScreenStream.getTracks().forEach(t => {
                t.stop();
                Object.values(window.peers).forEach(pc => { const sender = pc.getSenders().find(s => s.track === t); if(sender) pc.removeTrack(sender); });
            });
            if (window.rawScreenStream) {
                window.rawScreenStream.getTracks().forEach(t => t.stop());
                window.rawScreenStream = null;
            }
            window.localScreenStream = null;
            shareBtn.innerText = "💻 Share Screen"; shareBtn.classList.replace('primary-btn', 'secondary-btn');
            if (localVideo) { localVideo.style.display = 'none'; localVideo.srcObject = null; }
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                window.socket.send(JSON.stringify({ action: 'screen_stop', userId: window.myId, ts: Date.now() }));
            }
            window.renegotiatePeers();
            return;
        }
        
        try {
            window._screenPickerCancelled = false;
            window._peerAckedVideo = {};
            const screenConfig = { 
                video: { 
                    cursor: "always",
                    frameRate: { ideal: 30, max: 30 },
                    width: { ideal: 1280, max: 1280 },
                    height: { ideal: 720, max: 720 }
                }, 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                } 
            };

            let capturedStream;
            try {
                capturedStream = await navigator.mediaDevices.getDisplayMedia(screenConfig);
            } catch(err1) {
                if (window._screenPickerCancelled || err1.name === 'NotAllowedError' || err1.name === 'AbortError') {
                    return;
                }
                screenConfig.audio = false;
                capturedStream = await navigator.mediaDevices.getDisplayMedia(screenConfig);
            }

            window.rawScreenStream = capturedStream;
            const vidTrack = capturedStream.getVideoTracks()[0];
            if (vidTrack && 'contentHint' in vidTrack) vidTrack.contentHint = 'motion';

            window.localScreenStream = capturedStream;
            
            shareBtn.innerText = "💻 Stop Share"; shareBtn.classList.replace('secondary-btn', 'primary-btn');
            if (localVideo) {
                localVideo.muted = true;
                localVideo.style.display = 'block';
                localVideo.srcObject = window.localScreenStream;
                localVideo.play().catch(() => {});
            }
            window.startCallConnectionWatchdog();
            await window.renegotiatePeers();
            window.startScreenBridgeSender();

            vidTrack.onended = () => {
                if (window.localScreenStream) shareBtn.click();
            };
        } catch(err) {}
    }
});

window.setScreenPickerBlurState = function(isOpen) {
    const modal = document.getElementById('screen-picker-modal');
    const overlay = document.getElementById('modal-overlay');
    const netBox = document.getElementById('network-switcher-box');

    if (isOpen) {
        try { document.activeElement?.blur(); } catch (e) {}
        if (overlay) {
            if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
            overlay.style.cssText = 'display:block; position:fixed; inset:0; width:100vw; height:100vh; background:rgba(5, 10, 6, 0.85); z-index:99998;';
        }
        if (modal) {
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            modal.style.zIndex = '99999';
            modal.style.display = 'flex';
        }
        if (netBox) {
            netBox.style.opacity = '0.35';
            netBox.style.pointerEvents = 'none';
        }
    } else {
        if (modal) modal.style.display = 'none';
        if (overlay) overlay.style.display = 'none';
        if (netBox) {
            netBox.style.opacity = '';
            netBox.style.pointerEvents = '';
        }
    }
};

if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');
    ipcRenderer.removeAllListeners('show-screen-picker');
    ipcRenderer.on('show-screen-picker', (event, sources) => {
        const modal = document.getElementById('screen-picker-modal'); 
        const overlay = document.getElementById('modal-overlay'); 
        const grid = document.getElementById('screen-picker-grid');
        if(!modal || !overlay || !grid) return;
        
        window._screenPickerCancelled = false;
        grid.innerHTML = '';
        sources.forEach(source => {
            const item = document.createElement('div'); item.className = 'screen-option'; 
            item.innerHTML = `<img src="${source.thumbnailDataUrl}" alt="${source.name}"><span>${source.name}</span>`;
            item.onclick = () => {
                window._screenPickerCancelled = false;
                window.setScreenPickerBlurState(false);
                ipcRenderer.send('screen-picker-result', source.id);
            };
            grid.appendChild(item);
        });
        window.setScreenPickerBlurState(true);
    });

    document.getElementById('cancel-screen-picker')?.addEventListener('click', () => { 
        window._screenPickerCancelled = true;
        window.setScreenPickerBlurState(false);
        ipcRenderer.send('screen-picker-result', null); 
    });
}