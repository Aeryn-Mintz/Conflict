// ==========================================
// AUDIO & VIDEO ENGINE (WebRTC)
// ==========================================
window.addLocalTracksSafely = function(pc) {
    const sentTracks = pc.getSenders().map(s => s.track).filter(Boolean); const tracksToAdd = [];
    if (window.localMicStream) tracksToAdd.push(...window.localMicStream.getTracks());
    if (window.localScreenStream) tracksToAdd.push(...window.localScreenStream.getTracks());
    if (window.localCamStream) tracksToAdd.push(...window.localCamStream.getTracks());
    if (window.soundboardTrack) tracksToAdd.push(window.soundboardTrack);
    tracksToAdd.forEach(track => { if (!sentTracks.includes(track)) pc.addTrack(track, window.localMicStream || window.localScreenStream || window.localCamStream || window.soundboardDest.stream); });
};

window.createPeerConnection = function(remoteUserId) {
    const pc = new RTCPeerConnection(window.rtcConfig); window.peers[remoteUserId] = pc;
    pc.onicecandidate = (event) => { if (event.candidate && window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'ice-candidate', userId: window.myId, targetId: remoteUserId, candidate: event.candidate })); };
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
                if(window.addRemoteUserCard) window.addRemoteUserCard(remoteUserId, window.peerNames[remoteUserId] || "Guest", window.peerAvatars[remoteUserId]);
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
};

window.addRemoteUserCard = function(userId, username, avatarDataUrl) {
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
};

window.isMuted = false;
window.populateDevices = async function() {
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
};

document.getElementById('refresh-devices-btn')?.addEventListener('click', window.populateDevices);

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

    Object.values(window.peers).forEach(pc => window.addLocalTracksSafely(pc));
    const currentName = document.getElementById('display-username').textContent;
    if(window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'join', userId: window.myId, username: currentName, avatar: localStorage.getItem('appAvatar') || null }));
    
    document.getElementById('join-voice-btn').disabled = true; document.getElementById('join-voice-btn').innerText = micSuccess ? "🎙️ Connected" : "🎧 Listening";
    if (micSuccess) document.getElementById('mute-mic-btn').disabled = false;
});

document.getElementById('mute-mic-btn')?.addEventListener('click', (e) => {
    if (window.localMicStream) {
        window.isMuted = !window.isMuted; window.localMicStream.getAudioTracks()[0].enabled = !window.isMuted;
        const t = window.conflictTranslations ? window.conflictTranslations[localStorage.getItem('conflictLang') || 'en'] : null;
        e.target.innerText = window.isMuted ? (t?.unmute || "🔈 Unmute") : (t?.mute || "🔇 Mute"); 
        e.target.style.color = window.isMuted ? "var(--accent-alert)" : "var(--text-main)"; e.target.style.borderColor = window.isMuted ? "var(--accent-alert)" : "var(--border-color)";
    }
});

document.getElementById('toggle-cam-btn')?.addEventListener('click', async (e) => {
    const btn = e.target; const localCam = document.getElementById('local-cam-video');
    if (window.localCamStream) {
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'remove_video', streamId: window.localCamStream.id, trackId: window.localCamStream.getVideoTracks()[0]?.id }));
        window.localCamStream.getTracks().forEach(t => { t.stop(); Object.values(window.peers).forEach(pc => { const sender = pc.getSenders().find(s => s.track === t); if (sender) pc.removeTrack(sender); }); });
        localCam.style.display = 'none'; localCam.srcObject = null; window.localCamStream = null;
        btn.innerText = "📷 Camera"; btn.classList.replace('primary-btn', 'secondary-btn');
        for (const [remoteUserId, pc] of Object.entries(window.peers)) {
            try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (err) {}
        }
    } else {
        try {
            const camId = localStorage.getItem('appVideoIn'); const constraints = camId ? { video: { deviceId: { exact: camId } } } : { video: true };
            window.localCamStream = await navigator.mediaDevices.getUserMedia(constraints);
            localCam.style.display = 'block'; localCam.srcObject = window.localCamStream;
            btn.innerText = "📷 Stop Cam"; btn.classList.replace('secondary-btn', 'primary-btn');
            for (const [remoteUserId, pc] of Object.entries(window.peers)) {
                window.addLocalTracksSafely(pc);
                try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (err) {}
            }
        } catch (err) { alert("Could not start camera!"); }
    }
});

document.getElementById('share-screen-btn')?.addEventListener('click', async (e) => {
    const shareScreenBtn = e.target; const localVideo = document.getElementById('local-screen-video'); 
    if (window.localScreenStream) {
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'remove_video', streamId: window.localScreenStream.id, trackId: window.localScreenStream.getVideoTracks()[0]?.id }));
        window.localScreenStream.getTracks().forEach(t => t.stop());
        if (window.localScreenStream.getVideoTracks().length > 0) window.localScreenStream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
        return;
    }
    try {
        window.localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
        shareScreenBtn.innerText = "💻 Stop Share"; shareScreenBtn.classList.replace('secondary-btn', 'primary-btn');
        localVideo.style.display = 'block'; localVideo.srcObject = window.localScreenStream; localVideo.controls = true; 
        for (const [remoteUserId, pc] of Object.entries(window.peers)) {
            window.addLocalTracksSafely(pc);
            try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (err) {}
        }
        window.localScreenStream.getVideoTracks()[0].onended = async () => {
            localVideo.style.display = 'none'; localVideo.srcObject = null;
            shareScreenBtn.innerText = "💻 Share Screen"; shareScreenBtn.classList.replace('primary-btn', 'secondary-btn');
            for (const [remoteUserId, pc] of Object.entries(window.peers)) {
                pc.getSenders().forEach(sender => { if (sender.track && sender.track.kind === 'video' && !window.localCamStream?.getTracks().includes(sender.track)) pc.removeTrack(sender); });
                try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: remoteUserId, offer: offer })); } catch (e) {}
            }
            window.localScreenStream = null;
        };
    } catch (error) {}
});

if (window.ipcRenderer) {
    window.ipcRenderer.on('show-screen-picker', (event, sources) => {
        const modal = document.getElementById('screen-picker-modal'); const overlay = document.getElementById('modal-overlay'); const grid = document.getElementById('screen-picker-grid');
        if(!modal || !overlay || !grid) return;
        grid.innerHTML = '';
        sources.forEach(source => {
            const item = document.createElement('div'); item.className = 'screen-option'; item.innerHTML = `<img src="${source.thumbnailDataUrl}" alt="${source.name}"><span>${source.name}</span>`;
            item.onclick = () => { window.ipcRenderer.send('screen-picker-result', source.id); modal.style.display = 'none'; overlay.style.display = 'none'; };
            grid.appendChild(item);
        });
        modal.style.display = 'flex'; overlay.style.display = 'block';
    });
}
document.getElementById('cancel-screen-picker')?.addEventListener('click', () => { if(window.ipcRenderer) window.ipcRenderer.send('screen-picker-result', null); const modal = document.getElementById('screen-picker-modal'); const overlay = document.getElementById('modal-overlay'); if(modal) modal.style.display = 'none'; if(overlay) overlay.style.display = 'none'; });