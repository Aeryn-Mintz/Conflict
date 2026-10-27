// ==========================================
// CENTRAL AUDIO & VIDEO ENGINE (js/av.js)
// Otimizado para Baixo Uso de CPU e Compatibilidade Total com Discord/WhatsApp
// ==========================================
window.peers = {};
window.iceCandidateQueue = {};
window.makingOffer = {};
window.ignoreOffer = {};
window.disconnectTimers = {};
window.localMicStream = null;
window.localCamStream = null;
window.localScreenStream = null;
window.rawScreenStream = null;
window.audioCtx = null;
window.soundboardDest = null;
window.soundboardTrack = null;
window.isMuted = false;
window.remoteGainNodes = {};
window.bridgePlayTimes = {};
window.bridgeAudioEls = {};
window.voiceCancelRefNode = null;
window.remoteVoiceMonitorAnalyser = null;
window._gateInterval = null;

window.rtcConfig = { 
    iceCandidatePoolSize: 2,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
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
        }
    ] 
};

window.initAudioCtx = function() {
    if (!window.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        // Usa o sampleRate nativo do Windows (evita reamostragem forçada e crash no Discord/WhatsApp)
        window.audioCtx = new AudioContextClass({
            latencyHint: 'balanced'
        });
        window.soundboardDest = window.audioCtx.createMediaStreamDestination();
        window.soundboardTrack = window.soundboardDest.stream.getAudioTracks()[0];

        window.voiceCancelRefNode = window.audioCtx.createGain();
        window.voiceCancelRefNode.gain.value = 1.0;

        window.remoteVoiceMonitorAnalyser = window.audioCtx.createAnalyser();
        window.remoteVoiceMonitorAnalyser.fftSize = 256;
        window.voiceCancelRefNode.connect(window.remoteVoiceMonitorAnalyser);
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
    if (window.remoteVoiceMonitorAnalyser && Object.keys(window.remoteGainNodes).length > 0) {
        if (!window._friendMonitorBuf) {
            window._friendMonitorBuf = new Float32Array(window.remoteVoiceMonitorAnalyser.frequencyBinCount);
        }
        window.remoteVoiceMonitorAnalyser.getFloatTimeDomainData(window._friendMonitorBuf);
        let sum = 0;
        for (let i = 0; i < window._friendMonitorBuf.length; i += 2) {
            sum += window._friendMonitorBuf[i] * window._friendMonitorBuf[i];
        }
        const rms = Math.sqrt(sum / (window._friendMonitorBuf.length / 2));
        if (rms > 0.006) return true;
    }
    return false;
};

window.getOrCreateRemoteGain = function(remoteUserId) {
    if (!window.audioCtx) window.initAudioCtx();
    if (window.remoteGainNodes[remoteUserId]) return window.remoteGainNodes[remoteUserId];

    let audioCont = document.getElementById('remote-audio-container');
    if (!audioCont) {
        audioCont = document.createElement('div');
        audioCont.id = 'remote-audio-container';
        audioCont.style.cssText = 'width:0; height:0; position:absolute; overflow:hidden; opacity:0; pointer-events:none;';
        document.body.appendChild(audioCont);
    }

    const remoteGain = window.audioCtx.createGain();
    const slider = document.getElementById(`vol-${remoteUserId}`);
    const savedVol = slider ? parseFloat(slider.value) : 1.0;
    remoteGain.gain.value = window.inVoiceCall ? savedVol : 0.0;

    // Se o usuário não selecionou um dispositivo de saída customizado, conecta direto no destino padrão
    // (Evita criar MediaStreamDestinations extras que sobrecarregam o audiodg.exe do Windows)
    const outId = localStorage.getItem('appAudioOut');
    if (outId && outId !== 'default') {
        const outDest = window.audioCtx.createMediaStreamDestination();
        remoteGain.connect(outDest);
        const boostedAudio = document.createElement('audio');
        boostedAudio.id = `audio-out-${remoteUserId}`;
        boostedAudio.className = `stream-${remoteUserId}`;
        boostedAudio.autoplay = true;
        boostedAudio.srcObject = outDest.stream;
        if (typeof boostedAudio.setSinkId === 'function') {
            boostedAudio.setSinkId(outId).catch(() => {});
        }
        audioCont.appendChild(boostedAudio);
        boostedAudio.play().catch(() => {});
        window.bridgeAudioEls[remoteUserId] = boostedAudio;
    } else {
        remoteGain.connect(window.audioCtx.destination);
    }

    if (window.voiceCancelRefNode) {
        remoteGain.connect(window.voiceCancelRefNode);
    }

    window.remoteGainNodes[remoteUserId] = remoteGain;
    return remoteGain;
};

window.handleVoiceFrame = function(data) {
    if (!window.inVoiceCall) return;
    if (!data || data.userId === window.myId || !data.d) return;

    const pc = window.peers[data.userId];
    if (pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) return;

    if (!window.audioCtx) window.initAudioCtx();

    try {
        const binaryStr = atob(data.d);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);

        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }

        const sr = data.sr || 16000;
        const audioBuffer = window.audioCtx.createBuffer(1, float32.length, sr);
        audioBuffer.getChannelData(0).set(float32);

        const source = window.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gainNode = window.getOrCreateRemoteGain(data.userId);
        source.connect(gainNode);

        const now = window.audioCtx.currentTime;
        let startTime = window.bridgePlayTimes[data.userId] || 0;
        if (startTime < now || startTime > now + 0.4) {
            startTime = now + 0.04;
        }
        source.start(startTime);
        window.bridgePlayTimes[data.userId] = startTime + audioBuffer.duration;
    } catch (e) {}
};

window.rebuildMicPipeline = async function() {
    if (!window.audioCtx) window.initAudioCtx();
    window._micGeneration = (window._micGeneration || 0) + 1;
    const myGen = window._micGeneration;
    const micId = localStorage.getItem('appAudioIn');

    const useEchoCancel = localStorage.getItem('appEchoCancel') === 'true';
    const useAiSuppression = localStorage.getItem('appAiNoise') !== 'false';

    if (window._gateInterval) {
        clearInterval(window._gateInterval);
        window._gateInterval = null;
    }

    if (window._rawMicStream) {
        window._rawMicStream.getTracks().forEach(t => t.stop());
        window._rawMicStream = null;
    }

    [
        '_micSourceNode', '_micHighPass', '_micLowPass', '_micSuppressor',
        '_micAnalyser', '_micGateGain', '_micWarmthEQ', '_micMudCutEQ',
        '_micPresenceEQ', '_micCompressor', '_micMakeupGain',
        '_micBridgeProcessor', '_micBridgeMute'
    ].forEach(k => {
        try { window[k]?.disconnect(); } catch(e) {}
        try { window[k]?.destroy?.(); } catch(e) {}
        window[k] = null;
    });

    // IMPORTANTE: Sem `latency: 0.01`, sem `sampleRate` forçado e usando `ideal` em vez de `exact`.
    // Isso permite que o Windows compartilhe o microfone em Modo Compartilhado (Shared Mode)
    // com o Discord e o WhatsApp sem nunca derrubar chamadas externas!
    const baseAudioCfg = {
        echoCancellation: useEchoCancel,
        noiseSuppression: false,
        autoGainControl: false,
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
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(95, nowTime);
    highPass.Q.setValueAtTime(0.707, nowTime);

    const lowPass = window.audioCtx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(12000, nowTime);
    lowPass.Q.setValueAtTime(0.707, nowTime);

    source.connect(highPass);
    highPass.connect(lowPass);
    let head = lowPass;

    if (useAiSuppression && window.loadKrispRNNoiseNode) {
        try {
            const suppressor = await window.loadKrispRNNoiseNode(window.audioCtx);
            head.connect(suppressor);
            head = suppressor;
            window._micSuppressor = suppressor;
        } catch (e) {
            console.warn("RNNoise fallback to spectral gate:", e);
        }
    }

    const analyser = window.audioCtx.createAnalyser();
    analyser.fftSize = 512; // Reduzido de 1024 para 512 (metade do custo de FFT na CPU)
    analyser.smoothingTimeConstant = 0.2;
    const timeArray = new Float32Array(analyser.fftSize);
    const freqArray = new Float32Array(analyser.frequencyBinCount);

    const gateGain = window.audioCtx.createGain();
    gateGain.gain.setValueAtTime(0.0, nowTime);

    head.connect(analyser);
    head.connect(gateGain);

    const warmthEQ = window.audioCtx.createBiquadFilter();
    warmthEQ.type = 'peaking';
    warmthEQ.frequency.setValueAtTime(140, nowTime);
    warmthEQ.Q.setValueAtTime(1.1, nowTime);
    warmthEQ.gain.setValueAtTime(1.8, nowTime);

    const mudCutEQ = window.audioCtx.createBiquadFilter();
    mudCutEQ.type = 'peaking';
    mudCutEQ.frequency.setValueAtTime(320, nowTime);
    mudCutEQ.Q.setValueAtTime(1.4, nowTime);
    mudCutEQ.gain.setValueAtTime(-2.5, nowTime);

    const presenceEQ = window.audioCtx.createBiquadFilter();
    presenceEQ.type = 'highshelf';
    presenceEQ.frequency.setValueAtTime(5500, nowTime);
    presenceEQ.gain.setValueAtTime(2.0, nowTime);

    const compressor = window.audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, nowTime);
    compressor.knee.setValueAtTime(12, nowTime);
    compressor.ratio.setValueAtTime(3.5, nowTime);
    compressor.attack.setValueAtTime(0.004, nowTime);
    compressor.release.setValueAtTime(0.20, nowTime);

    const makeupGain = window.audioCtx.createGain();
    makeupGain.gain.setValueAtTime(1.45, nowTime);

    gateGain.connect(warmthEQ);
    warmthEQ.connect(mudCutEQ);
    mudCutEQ.connect(presenceEQ);
    presenceEQ.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(destination);

    // Buffer de 4096 reduz as interrupções na thread principal pela metade
    const bridgeProcessor = window.audioCtx.createScriptProcessor(4096, 1, 1);
    const bridgeMute = window.audioCtx.createGain();
    bridgeMute.gain.value = 0;
    makeupGain.connect(bridgeProcessor);
    bridgeProcessor.connect(bridgeMute);
    bridgeMute.connect(window.audioCtx.destination);

    let isGateOpen = false;
    let lastOpenTime = 0;
    let consecutiveVoiceFrames = 0;
    const holdTimeMs = 240;

    let bridgeFrameCounter = 0;
    bridgeProcessor.onaudioprocess = (ev) => {
        if (myGen !== window._micGeneration || window.isMuted || !window.inVoiceCall || !isGateOpen) return;
        if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;

        const activeCallPeers = Object.keys(window.peerNames || {}).filter(uid => window.peerInCall && window.peerInCall[uid]);
        if (activeCallPeers.length === 0) return;

        const needsBridge = activeCallPeers.some(uid => {
            const pc = window.peers[uid];
            return !pc || (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed');
        });
        if (!needsBridge) return;

        bridgeFrameCounter++;
        if (bridgeFrameCounter % 2 !== 0) return;

        const input = ev.inputBuffer.getChannelData(0);
        const outLen = Math.floor(input.length / 3);
        const int16 = new Int16Array(outLen);
        for (let i = 0, j = 0; i < outLen; i++, j += 3) {
            const s = Math.max(-1, Math.min(1, (input[j] + input[j + 1] + input[j + 2]) / 3));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }

        window.socket.send(JSON.stringify({
            action: 'voice_frame',
            userId: window.myId,
            sr: Math.round(window.audioCtx.sampleRate / 3),
            d: btoa(binary)
        }));
    };

    const oldMicTrack = window.localMicStream?.getAudioTracks()[0] || window._lastMicTrack;
    const newTrack = destination.stream.getAudioTracks()[0];
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

    window.localMicStream?.getTracks().forEach(t => t.stop());
    window.localMicStream = destination.stream;

    window._micSourceNode = source;
    window._micHighPass = highPass;
    window._micLowPass = lowPass;
    window._micWarmthEQ = warmthEQ;
    window._micMudCutEQ = mudCutEQ;
    window._micPresenceEQ = presenceEQ;
    window._micCompressor = compressor;
    window._micMakeupGain = makeupGain;
    window._micGateGain = gateGain;
    window._micAnalyser = analyser;
    window._micBridgeProcessor = bridgeProcessor;
    window._micBridgeMute = bridgeMute;

    // OTIMIZAÇÃO DE CPU: Roda a cada 40ms (25 vezes/seg) em vez de 144-240 vezes/seg no requestAnimationFrame!
    window._gateInterval = setInterval(() => {
        if (myGen !== window._micGeneration || !window.localMicStream) {
            clearInterval(window._gateInterval);
            return;
        }
        if (window.isMuted) {
            if (isGateOpen) {
                isGateOpen = false;
                gateGain.gain.setTargetAtTime(0.0, window.audioCtx.currentTime, 0.05);
            }
            return;
        }

        analyser.getFloatTimeDomainData(timeArray);
        let sum = 0;
        for (let i = 0; i < timeArray.length; i++) {
            sum += timeArray[i] * timeArray[i];
        }
        const rms = Math.sqrt(sum / timeArray.length);

        const slider = document.getElementById('noise-gate-slider');
        const openThreshold = slider ? Math.max(0.003, parseFloat(slider.value)) : 0.008;
        const closeThreshold = openThreshold * 0.45;
        const now = performance.now();

        if (!isGateOpen) {
            // Só calcula o FFT de frequências quando o volume realmente passa do threshold!
            if (rms > openThreshold) {
                analyser.getFloatFrequencyData(freqArray);
                let vocalDbSum = 0;
                for (let b = 1; b <= 10; b++) vocalDbSum += freqArray[b];
                const vocalAvgDb = vocalDbSum / 10;

                let clackDbSum = 0;
                for (let b = 26; b <= 80; b++) clackDbSum += freqArray[b];
                const clackAvgDb = clackDbSum / 55;

                const isVocalSpectrum = (vocalAvgDb - clackAvgDb) > 5.5;
                if (isVocalSpectrum) {
                    consecutiveVoiceFrames++;
                    if (consecutiveVoiceFrames >= 1) {
                        isGateOpen = true;
                        lastOpenTime = now;
                        gateGain.gain.setTargetAtTime(1.0, window.audioCtx.currentTime, 0.008);
                    }
                } else {
                    consecutiveVoiceFrames = 0;
                }
            } else {
                consecutiveVoiceFrames = 0;
            }
        } else {
            if (rms > closeThreshold) {
                lastOpenTime = now;
            } else if (now - lastOpenTime > holdTimeMs) {
                isGateOpen = false;
                consecutiveVoiceFrames = 0;
                gateGain.gain.setTargetAtTime(0.0, window.audioCtx.currentTime, 0.07);
            }
        }
    }, 40);

    return destination.stream;
};

window.addLocalTracksSafely = function(pc) {
    if (!window.audioCtx) window.initAudioCtx();
    const sentTracks = pc.getSenders().map(s => s.track).filter(Boolean);
    const streams = [window.localMicStream, window.localScreenStream, window.localCamStream, window.soundboardDest?.stream].filter(Boolean);
    
    streams.forEach(stream => {
        stream.getTracks().forEach(track => {
            if (!sentTracks.includes(track) && track.readyState === 'live') {
                try { 
                    const sender = pc.addTrack(track, stream);
                    if (track.kind === 'audio' && window.boostAudioSenderBitrate) {
                        window.boostAudioSenderBitrate(sender);
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
    if (window.makingOffer[remoteUserId]) return;
    if (pc.signalingState !== 'stable' && !iceRestart) return;

    try {
        window.makingOffer[remoteUserId] = true;
        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : {});
        await pc.setLocalDescription(offer);

        const outboundOffer = {
            type: pc.localDescription.type,
            sdp: window.enhanceOpusSDP ? window.enhanceOpusSDP(pc.localDescription.sdp) : pc.localDescription.sdp
        };

        window.socket.send(JSON.stringify({
            action: 'offer',
            userId: window.myId,
            targetId: remoteUserId,
            offer: outboundOffer
        }));
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

    pc.onicecandidate = (event) => { 
        if (event.candidate && window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({
                action: 'ice-candidate',
                userId: window.myId,
                targetId: remoteUserId,
                candidate: event.candidate
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
                statusEl.innerText = 'Call: Ultra-HD 256kbps P2P 🟢';
            } else if (window.localMicStream) {
                statusEl.style.color = '#10b981';
                statusEl.innerText = 'Call: Ultra-HD Connected 🟢';
            }
        }

        if (state === 'connected' || state === 'completed') {
            clearTimeout(window.disconnectTimers[remoteUserId]);
        }

        if (state === 'disconnected') {
            clearTimeout(window.disconnectTimers[remoteUserId]);
            window.disconnectTimers[remoteUserId] = setTimeout(triggerIceRecovery, 6000);
        }

        if (state === 'failed') {
            clearTimeout(window.disconnectTimers[remoteUserId]);
            await triggerIceRecovery();
        }

        if (state === 'closed') {
            clearTimeout(window.disconnectTimers[remoteUserId]);
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
        };

        if (event.track.kind === 'audio') {
            if (!window.audioCtx) window.initAudioCtx();

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
                remoteAudio.autoplay = true;
                
                try {
                    remoteAudio.muted = true;
                    const remoteSource = window.audioCtx.createMediaStreamSource(stream);
                    const remoteGain = window.getOrCreateRemoteGain(remoteUserId);
                    remoteSource.connect(remoteGain);
                } catch (err) {
                    remoteAudio.muted = false;
                    const outId = localStorage.getItem('appAudioOut'); 
                    if (outId && typeof remoteAudio.setSinkId === 'function') remoteAudio.setSinkId(outId).catch(()=>{});
                }

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
        await window.sendOfferSafely(pc, remoteUserId, false);
    }
};

window.handleWebRTCSignal = async function(data) {
    if ((data.action === 'join' || data.action === 'presence') && data.userId !== window.myId) {
        if (data.action === 'presence' && data.targetId && data.targetId !== window.myId) return;

        // Só cria RTCPeerConnection se alguém estiver em chamada ou transmitindo!
        if (window.inVoiceCall || data.inCall || window.localMicStream || window.localCamStream || window.localScreenStream) {
            let pc = window.peers[data.userId];
            if (!pc) pc = window.createPeerConnection(data.userId);

            if (window.localMicStream || window.localCamStream || window.localScreenStream) {
                window.addLocalTracksSafely(pc);
                if (pc.signalingState === 'stable') {
                    await window.sendOfferSafely(pc, data.userId, false);
                }
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

            if (offerCollision) {
                await Promise.all([
                    pc.setLocalDescription({ type: "rollback" }),
                    pc.setRemoteDescription(new RTCSessionDescription(data.offer))
                ]);
            } else {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            }

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
                answer: outboundAnswer
            }));
        } catch(e) {
            console.warn("Offer handling error:", e);
        }
    }
    else if (data.action === 'answer' && data.targetId === window.myId) {
        const pc = window.peers[data.userId];
        if (pc && pc.signalingState === 'have-local-offer') {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                await window.flushCandidateQueue(data.userId);
            } catch(e) {
                console.warn("Answer handling error:", e);
            }
        }
    }
    else if (data.action === 'ice-candidate' && data.targetId === window.myId) {
        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);
        if (window.ignoreOffer[data.userId]) return;

        const candidate = new RTCIceCandidate(data.candidate);
        if (pc.remoteDescription && pc.remoteDescription.type) {
            try { await pc.addIceCandidate(candidate); } catch(e){}
        } else { 
            if (!window.iceCandidateQueue[data.userId]) window.iceCandidateQueue[data.userId] = []; 
            window.iceCandidateQueue[data.userId].push(candidate); 
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
            if (window._gateInterval) {
                clearInterval(window._gateInterval);
                window._gateInterval = null;
            }
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
                window.socket.send(JSON.stringify({ action: 'call_state', userId: window.myId, inCall: false }));
            }
            if (window.renderConnectedUsers) window.renderConnectedUsers();
            return;
        }

        // JOIN VOICE CALL
        window.inVoiceCall = true;
        if (!window.audioCtx) window.initAudioCtx();
        if (window.audioCtx.state === 'suspended') await window.audioCtx.resume();
        if (window.playUiSound) window.playUiSound('join_call');

        Object.keys(window.remoteGainNodes).forEach(uid => {
            const saved = document.getElementById(`vol-${uid}`)?.value;
            const vol = saved !== undefined ? parseFloat(saved) : 1.0;
            try {
                window.remoteGainNodes[uid].gain.setTargetAtTime(vol, window.audioCtx.currentTime, 0.01);
                window.bridgeAudioEls[uid]?.play().catch(() => {});
            } catch (err) {}
        });

        let micSuccess = false;
        try {
            await window.rebuildMicPipeline();
            if (window.addChatLine) window.addChatLine('System', '🎙️ Joined Voice Channel (Shared-Mode Safe + Krisp RNNoise active).', 'system');
            micSuccess = true;
        } catch (err) {
            if (window.addChatLine) window.addChatLine('System', '🎧 Joined Voice Channel in Listen-Only mode (No mic detected).', 'system');
        }

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#10b981';
            statusEl.innerText = 'Call: Ultra-HD Connected 🟢';
        }
        if (btn) {
            btn.innerText = "📴 Leave Call";
            btn.style.background = "#ef4444";
            btn.style.color = "#fff";
        }
        if (micSuccess && muteBtn) muteBtn.disabled = false;

        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'call_state', userId: window.myId, inCall: true }));
        }
        if (window.renderConnectedUsers) window.renderConnectedUsers();

        await new Promise(r => setTimeout(r, 100)); 
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
                window.localCamStream = await navigator.mediaDevices.getUserMedia({ video: camId ? { deviceId: { ideal: camId } } : true });
                if (localCam) { localCam.style.display = 'block'; localCam.srcObject = window.localCamStream; }
                btn.innerText = "📷 Stop Cam"; btn.classList.replace('secondary-btn', 'primary-btn');
                window.renegotiatePeers();
            } catch (err) {}
        }
    }

    // 4. SHARE SCREEN BUTTON
    if (e.target.closest('#share-screen-btn')) {
        const shareBtn = e.target.closest('#share-screen-btn');
        const localVideo = document.getElementById('local-screen-video'); 
        
        if (window.localScreenStream) {
            window._screenShareDuckingActive = false;
            if (window._vocalPocketInterval) {
                clearInterval(window._vocalPocketInterval);
                window._vocalPocketInterval = null;
            }
            ['_scrSource', '_scrSplitter', '_scrMerger', '_scrCanceller', '_scrVocalPocketEQ', '_scrGain'].forEach(k => {
                try { window[k]?.disconnect(); } catch (err) {}
            });
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
            window.renegotiatePeers();
            return;
        }
        
        try {
            window._screenPickerCancelled = false;
            const screenConfig = { 
                video: { 
                    cursor: "always",
                    frameRate: { ideal: 30, max: 60 },
                    width: { ideal: 1920, max: 1920 },
                    height: { ideal: 1080, max: 1080 }
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

            if (capturedStream.getAudioTracks().length > 0 && window.buildCleanScreenAudioPipeline) {
                const cleanAudioTrack = window.buildCleanScreenAudioPipeline(capturedStream);
                window.localScreenStream = new MediaStream([
                    capturedStream.getVideoTracks()[0],
                    cleanAudioTrack
                ]);
            } else {
                window.localScreenStream = capturedStream;
            }
            
            shareBtn.innerText = "💻 Stop Share"; shareBtn.classList.replace('secondary-btn', 'primary-btn');
            if (localVideo) {
                localVideo.muted = true;
                localVideo.style.display = 'block';
                localVideo.srcObject = window.localScreenStream;
            }
            window.renegotiatePeers();

            capturedStream.getVideoTracks()[0].onended = () => {
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