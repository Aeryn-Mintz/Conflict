// ==========================================
// CENTRAL AUDIO & VIDEO ENGINE (WebRTC + CGNAT Bridge + NLMS Stream Canceller)
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

window.rtcConfig = { 
    iceCandidatePoolSize: 4,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" }
    ] 
};

window.enhanceOpusSDP = function(sdp) {
    if (!sdp || sdp.includes('maxaveragebitrate=256000')) return sdp;
    return sdp.replace(
        /a=fmtp:111 ([^\r\n]+)/g,
        'a=fmtp:111 $1;maxplaybackrate=48000;sprop-maxcapturerate=48000;maxaveragebitrate=256000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0'
    );
};

window.boostAudioSenderBitrate = async function(sender) {
    if (!sender || !sender.getParameters) return;
    try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].maxBitrate = 256000;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';
        await sender.setParameters(params);
    } catch (e) {}
};

window.initAudioCtx = function() {
    if (!window.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        window.audioCtx = new AudioContextClass({
            sampleRate: 48000,
            latencyHint: 'interactive'
        });
        window.soundboardDest = window.audioCtx.createMediaStreamDestination();
        window.soundboardTrack = window.soundboardDest.stream.getAudioTracks()[0];

        // Unified reference bus of all friends' voices for NLMS screen-share echo subtraction
        window.voiceCancelRefNode = window.audioCtx.createGain();
        window.voiceCancelRefNode.gain.value = 1.0;

        window.remoteVoiceMonitorAnalyser = window.audioCtx.createAnalyser();
        window.remoteVoiceMonitorAnalyser.fftSize = 256;
        window.voiceCancelRefNode.connect(window.remoteVoiceMonitorAnalyser);

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

window.isAnyFriendSpeaking = function() {
    const now = window.audioCtx ? window.audioCtx.currentTime : 0;
    for (const uid of Object.keys(window.bridgePlayTimes)) {
        if (window.bridgePlayTimes[uid] > now) return true;
    }
    if (window.remoteVoiceMonitorAnalyser) {
        const buf = new Float32Array(window.remoteVoiceMonitorAnalyser.frequencyBinCount);
        window.remoteVoiceMonitorAnalyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 0.006) return true;
    }
    return false;
};

// Unified remote voice output (supports 0% to 200% volume & feeds the echo-canceller reference bus)
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
    remoteGain.gain.value = slider ? parseFloat(slider.value) : 1.0;

    const outDest = window.audioCtx.createMediaStreamDestination();
    remoteGain.connect(outDest);

    // Feed this friend's exact audio into the screen-share echo subtraction reference bus
    if (window.voiceCancelRefNode) {
        remoteGain.connect(window.voiceCancelRefNode);
    }

    const boostedAudio = document.createElement('audio');
    boostedAudio.id = `audio-out-${remoteUserId}`;
    boostedAudio.className = `stream-${remoteUserId}`;
    boostedAudio.autoplay = true;
    boostedAudio.srcObject = outDest.stream;

    const outId = localStorage.getItem('appAudioOut');
    if (outId && typeof boostedAudio.setSinkId === 'function') {
        boostedAudio.setSinkId(outId).catch(() => {});
    }

    audioCont.appendChild(boostedAudio);
    boostedAudio.play().catch(() => {});

    window.remoteGainNodes[remoteUserId] = remoteGain;
    window.bridgeAudioEls[remoteUserId] = boostedAudio;
    return remoteGain;
};

window.handleVoiceFrame = function(data) {
    if (!data || data.userId === window.myId || !data.d) return;

    const pc = window.peers[data.userId];
    if (pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) return;

    if (!window.audioCtx) window.initAudioCtx();
    if (window.audioCtx.state === 'suspended') window.audioCtx.resume();

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

        const sr = data.sr || 24000;
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

        const statusEl = document.getElementById('voice-status');
        if (statusEl && statusEl.innerText.includes('Connecting')) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#10b981';
            statusEl.innerText = 'Call: Ultra-HD Connected 🟢';
        }
    } catch (e) {}
};

// Loads RNNoise WASM + Worklet directly from disk via Node fs
window.loadKrispRNNoiseNode = async function(audioCtx) {
    const { RnnoiseWorkletNode, loadRnnoise } = require('@sapphi-red/web-noise-suppressor');
    const fs = require('fs');
    const path = require('path');

    const pkgEntry = require.resolve('@sapphi-red/web-noise-suppressor');
    const distDir = path.dirname(pkgEntry).replace('app.asar', 'app.asar.unpacked');

    const findFile = (dir, predicate) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const res = findFile(full, predicate);
                if (res) return res;
            } else if (predicate(entry.name)) {
                return full;
            }
        }
        return null;
    };

    const workletPath = findFile(distDir, n => n.toLowerCase().includes('worklet') && n.endsWith('.js'));
    const wasmSimdPath = findFile(distDir, n => n.includes('rnnoise') && n.includes('simd') && n.endsWith('.wasm'));
    const wasmStdPath = findFile(distDir, n => n.includes('rnnoise') && !n.includes('simd') && n.endsWith('.wasm'));

    if (!workletPath || (!wasmSimdPath && !wasmStdPath)) {
        throw new Error('RNNoise assets not found in dist folder.');
    }

    if (!window._rnnoiseWorkletRegistered) {
        const workletCode = fs.readFileSync(workletPath, 'utf8');
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        await audioCtx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);
        window._rnnoiseWorkletRegistered = true;
    }

    let wasmBinary;
    try {
        const buf = fs.readFileSync(wasmSimdPath || wasmStdPath);
        wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e) {
        wasmBinary = await loadRnnoise({
            url: wasmStdPath,
            simdUrl: wasmSimdPath || wasmStdPath
        });
    }

    return new RnnoiseWorkletNode(audioCtx, {
        maxChannels: 1,
        wasmBinary: wasmBinary
    });
};

window.rebuildMicPipeline = async function() {
    if (!window.audioCtx) window.initAudioCtx();
    window._micGeneration = (window._micGeneration || 0) + 1;
    const myGen = window._micGeneration;
    const micId = localStorage.getItem('appAudioIn');

    const useEchoCancel = localStorage.getItem('appEchoCancel') === 'true';
    const useAiSuppression = localStorage.getItem('appAiNoise') !== 'false';

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
    });

    const baseAudioCfg = {
        echoCancellation: useEchoCancel,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        sampleSize: 16,
        channelCount: 1,
        latency: 0.01
    };

    let rawStream;
    try {
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: micId ? { ...baseAudioCfg, deviceId: { exact: micId } } : baseAudioCfg
        });
    } catch (e) {
        rawStream = await navigator.mediaDevices.getUserMedia({
            audio: micId ? { ...baseAudioCfg, deviceId: { ideal: micId } } : true
        });
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

    if (useAiSuppression) {
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
    analyser.fftSize = 1024;
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

    const bridgeProcessor = window.audioCtx.createScriptProcessor(2048, 1, 1);
    const bridgeMute = window.audioCtx.createGain();
    bridgeMute.gain.value = 0;
    makeupGain.connect(bridgeProcessor);
    bridgeProcessor.connect(bridgeMute);
    bridgeMute.connect(window.audioCtx.destination);

    let isGateOpen = false;
    let lastOpenTime = 0;
    let consecutiveVoiceFrames = 0;
    const holdTimeMs = 240;

    bridgeProcessor.onaudioprocess = (ev) => {
        if (myGen !== window._micGeneration || window.isMuted || !isGateOpen) return;
        if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;

        const peerIds = Object.keys(window.peerNames || {});
        if (peerIds.length === 0) return;

        const needsBridge = peerIds.some(uid => {
            const pc = window.peers[uid];
            return !pc || (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed');
        });
        if (!needsBridge) return;

        const input = ev.inputBuffer.getChannelData(0);
        const outLen = Math.floor(input.length / 2);
        const int16 = new Int16Array(outLen);
        for (let i = 0, j = 0; i < outLen; i++, j += 2) {
            const s = Math.max(-1, Math.min(1, (input[j] + input[j + 1]) * 0.5));
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
            sr: Math.round(window.audioCtx.sampleRate / 2),
            d: btoa(binary)
        }));
    };

    const oldMicTrack = window.localMicStream?.getAudioTracks()[0];
    const newTrack = destination.stream.getAudioTracks()[0];
    newTrack.enabled = !window.isMuted;
    if ('contentHint' in newTrack) newTrack.contentHint = 'speech';

    Object.values(window.peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track === oldMicTrack);
        if (sender) {
            sender.replaceTrack(newTrack);
            window.boostAudioSenderBitrate(sender);
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

    (function processGate() {
        if (myGen !== window._micGeneration || !window.localMicStream) return;

        analyser.getFloatTimeDomainData(timeArray);
        analyser.getFloatFrequencyData(freqArray);

        let sum = 0;
        for (let i = 0; i < timeArray.length; i++) {
            sum += timeArray[i] * timeArray[i];
        }
        const rms = Math.sqrt(sum / timeArray.length);

        let vocalDbSum = 0;
        for (let b = 2; b <= 19; b++) vocalDbSum += freqArray[b];
        const vocalAvgDb = vocalDbSum / 18;

        let clackDbSum = 0;
        for (let b = 53; b <= 160; b++) clackDbSum += freqArray[b];
        const clackAvgDb = clackDbSum / 108;

        const isVocalSpectrum = (vocalAvgDb - clackAvgDb) > 6.0;

        const slider = document.getElementById('noise-gate-slider');
        const openThreshold = slider ? Math.max(0.003, parseFloat(slider.value)) : 0.008;
        const closeThreshold = openThreshold * 0.45;
        const now = performance.now();

        if (!isGateOpen) {
            if (rms > openThreshold && isVocalSpectrum) {
                consecutiveVoiceFrames++;
                if (consecutiveVoiceFrames >= 2) {
                    isGateOpen = true;
                    lastOpenTime = now;
                    gateGain.gain.setTargetAtTime(1.0, window.audioCtx.currentTime, 0.006);
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

        requestAnimationFrame(processGate);
    })();

    return destination.stream;
};

// Builds a continuous-stream NLMS Echo Subtractor + Dynamic Vocal-Pocket EQ for Screen Share
window.buildCleanScreenAudioPipeline = function(capturedStream) {
    if (!window.audioCtx) window.initAudioCtx();

    // Cleanup any previous screen share audio nodes
    ['_scrSource', '_scrSplitter', '_scrMerger', '_scrCanceller', '_scrVocalPocketEQ', '_scrGain'].forEach(k => {
        try { window[k]?.disconnect(); } catch (e) {}
    });

    const scrSource = window.audioCtx.createMediaStreamSource(capturedStream);
    const scrSplitter = window.audioCtx.createChannelSplitter(2);
    const scrMerger = window.audioCtx.createChannelMerger(4);

    scrSource.connect(scrSplitter);
    scrSplitter.connect(scrMerger, 0, 0); // Ch 0: Screen Left
    scrSplitter.connect(scrMerger, 1, 1); // Ch 1: Screen Right

    // Ch 2: Exact reference of all friends' voices currently playing on this PC
    if (window.voiceCancelRefNode) {
        window.voiceCancelRefNode.connect(scrMerger, 0, 2);
    }

    // 4-input, 2-output NLMS adaptive subtractor
    const cancellerNode = window.audioCtx.createScriptProcessor(2048, 4, 2);
    const RING_SIZE = 16384;
    const RING_MASK = RING_SIZE - 1;
    const refRing = new Float32Array(RING_SIZE);
    let writePos = 0;

    const FILTER_LEN = 48;
    const wL = new Float32Array(FILTER_LEN);
    const wR = new Float32Array(FILTER_LEN);
    let lockedDelay = 1440; // ~30ms initial WASAPI loopback estimate
    let bestCorr = 0.15;
    let frameCount = 0;

    cancellerNode.onaudioprocess = (e) => {
        const inL = e.inputBuffer.getChannelData(0);
        const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
        const inRef = e.inputBuffer.getChannelData(2);
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        const N = inL.length;

        let refEnergy = 0;
        for (let i = 0; i < N; i++) {
            refRing[(writePos + i) & RING_MASK] = inRef[i];
            refEnergy += inRef[i] * inRef[i];
        }
        const refRms = Math.sqrt(refEnergy / N);

        // Coarse Delay Finder: locks onto the exact Windows loopback delay when a friend speaks
        frameCount++;
        if (refRms > 0.008 && (frameCount % 3 === 0)) {
            let maxC = 0;
            let bestD = lockedDelay;
            let scrE = 1e-6;
            for (let i = 0; i < N; i += 8) scrE += inL[i] * inL[i];

            for (let d = 240; d <= 5760; d += 16) {
                let c = 0;
                let rE = 1e-6;
                for (let i = 0; i < N; i += 8) {
                    const r = refRing[(writePos + i - d) & RING_MASK];
                    c += inL[i] * r;
                    rE += r * r;
                }
                const normC = Math.abs(c) / Math.sqrt(scrE * rE);
                if (normC > maxC) {
                    maxC = normC;
                    bestD = d;
                }
            }
            if (maxC > 0.22 && maxC >= bestCorr * 0.85) {
                bestCorr = maxC;
                lockedDelay = Math.max(0, bestD - 12);
            }
        }

        // Sample-by-sample 48-Tap NLMS Phase Subtractor
        for (let i = 0; i < N; i++) {
            const baseIdx = (writePos + i - lockedDelay) & RING_MASK;
            let echoL = 0;
            let echoR = 0;
            let norm = 1e-5;

            for (let k = 0; k < FILTER_LEN; k++) {
                const x = refRing[(baseIdx - k) & RING_MASK];
                echoL += wL[k] * x;
                echoR += wR[k] * x;
                norm += x * x;
            }

            const errL = Math.max(-1, Math.min(1, inL[i] - echoL));
            const errR = Math.max(-1, Math.min(1, inR[i] - echoR));

            if (refRms > 0.003) {
                const muL = (0.12 * errL) / norm;
                const muR = (0.12 * errR) / norm;
                for (let k = 0; k < FILTER_LEN; k++) {
                    const x = refRing[(baseIdx - k) & RING_MASK];
                    wL[k] = wL[k] * 0.9998 + muL * x;
                    wR[k] = wR[k] * 0.9998 + muR * x;
                }
            }

            outL[i] = errL;
            outR[i] = errR;
        }

        writePos = (writePos + N) & RING_MASK;
    };

    // Dynamic Vocal-Pocket EQ: gently dips 650Hz midrange when a friend speaks (NEVER cuts off stream!)
    const vocalPocketEQ = window.audioCtx.createBiquadFilter();
    vocalPocketEQ.type = 'peaking';
    vocalPocketEQ.frequency.setValueAtTime(650, window.audioCtx.currentTime);
    vocalPocketEQ.Q.setValueAtTime(0.85, window.audioCtx.currentTime);
    vocalPocketEQ.gain.setValueAtTime(0, window.audioCtx.currentTime);

    const scrGain = window.audioCtx.createGain();
    scrGain.gain.setValueAtTime(1.0, window.audioCtx.currentTime);

    const scrDest = window.audioCtx.createMediaStreamDestination();

    scrMerger.connect(cancellerNode);
    cancellerNode.connect(vocalPocketEQ);
    vocalPocketEQ.connect(scrGain);
    scrGain.connect(scrDest);

    window._scrSource = scrSource;
    window._scrSplitter = scrSplitter;
    window._scrMerger = scrMerger;
    window._scrCanceller = cancellerNode;
    window._scrVocalPocketEQ = vocalPocketEQ;
    window._scrGain = scrGain;

    window._screenShareDuckingActive = true;
    (function updateVocalPocket() {
        if (!window._screenShareDuckingActive || !window.localScreenStream) return;
        const now = window.audioCtx.currentTime;
        if (window.isAnyFriendSpeaking()) {
            // Carves a subtle vocal pocket at 650Hz (-8.5dB) and keeps stream playing at 85% volume
            vocalPocketEQ.gain.setTargetAtTime(-8.5, now, 0.015);
            scrGain.gain.setTargetAtTime(0.85, now, 0.015);
        } else {
            vocalPocketEQ.gain.setTargetAtTime(0.0, now, 0.08);
            scrGain.gain.setTargetAtTime(1.0, now, 0.08);
        }
        requestAnimationFrame(updateVocalPocket);
    })();

    return scrDest.stream.getAudioTracks()[0];
};

window.addLocalTracksSafely = function(pc) {
    if (!window.audioCtx) window.initAudioCtx();
    const sentTracks = pc.getSenders().map(s => s.track).filter(Boolean);
    const streams = [window.localMicStream, window.localScreenStream, window.localCamStream, window.soundboardDest?.stream].filter(Boolean);
    
    streams.forEach(stream => {
        stream.getTracks().forEach(track => {
            if (!sentTracks.includes(track)) {
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
            sdp: window.enhanceOpusSDP(pc.localDescription.sdp)
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
        if (statusEl) {
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
                    // Mutes raw element and routes through WebAudio so 0-200% volume & NLMS reference bus stay 100% synced
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

        let pc = window.peers[data.userId];
        if (!pc) pc = window.createPeerConnection(data.userId);

        if (window.localMicStream || window.localCamStream || window.localScreenStream) {
            window.addLocalTracksSafely(pc);
            if (pc.signalingState === 'stable') {
                await window.sendOfferSafely(pc, data.userId, false);
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
                sdp: window.enhanceOpusSDP(pc.localDescription.sdp)
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

document.addEventListener('click', async (e) => {
    if (e.target.closest('#join-voice-btn')) {
        let micSuccess = false;
        try {
            await window.rebuildMicPipeline();
            if (window.addChatLine) window.addChatLine('System', '🎙️ Ultra-HD 256kbps Broadcast Pipeline + Krisp RNNoise ativo.', 'system');
            micSuccess = true;

            const statusEl = document.getElementById('voice-status');
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.color = '#10b981';
                statusEl.innerText = 'Call: Ultra-HD Connected 🟢';
            }

            await new Promise(r => setTimeout(r, 100)); 
            window.renegotiatePeers();
        } catch (err) {
            if (window.addChatLine) window.addChatLine('System', '⚠️ Error: No microphone found or permission denied by hardware.', 'system');
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
            window._screenShareDuckingActive = false;
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
            localVideo.style.display = 'none'; localVideo.srcObject = null;
            window.renegotiatePeers();
            return;
        }
        
        try {
            const screenConfig = { 
                video: { 
                    cursor: "always",
                    frameRate: { ideal: 60, max: 60 },
                    width: { ideal: 1920, max: 2560 },
                    height: { ideal: 1080, max: 1440 }
                }, 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    restrictOwnAudio: true,
                    sampleRate: 48000,
                    channelCount: 2
                } 
            };

            let capturedStream;
            try {
                capturedStream = await navigator.mediaDevices.getDisplayMedia(screenConfig);
            } catch(err1) {
                screenConfig.audio = false;
                capturedStream = await navigator.mediaDevices.getDisplayMedia(screenConfig);
            }

            window.rawScreenStream = capturedStream;

            if (capturedStream.getAudioTracks().length > 0) {
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