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

window.defaultAvatar = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='50' height='50'%3E%3Crect width='50' height='50' fill='%231a1a1a'/%3E%3Ctext x='50%25' y='50%25' fill='%2310b981' font-family='sans-serif' font-size='12' dy='.3em' text-anchor='middle'%3EUser%3C/text%3E%3C/svg%3E";
window.myId = Math.random().toString(36).substring(2, 10); 
window.socket = null; window.isDM = false; window.partySheets = {};
window.activeCharId = null; window.viewingParty = false; window.viewingRemoteUid = null;
window.cropMode = 'avatar'; window.serverUrl = localStorage.getItem('conflictServerUrl') || 'ws://localhost:8080';
window.reconnectAttempts = 0; window.reconnectTimer = null;
window.audioCtx = null; window.soundboardDest = null; window.soundboardTrack = null;
window.peers = {}; window.peerNames = {}; window.peerAvatars = {}; window.iceCandidateQueue = {};
window.localMicStream = null; window.localScreenStream = null; window.localCamStream = null;

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
            if(typeof anime !== 'undefined') anime({ targets: element, left: snappedLeft, top: snappedTop, scale: 1, duration: 400, easing: 'easeOutElastic(1, .6)' });
        };
        document.onmousemove = (e) => {
            e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px"; element.style.left = (element.offsetLeft - pos1) + "px";
        };
        document.querySelectorAll('.floating-panel').forEach(p => p.style.zIndex = 50); element.style.zIndex = 51;
        if(typeof anime !== 'undefined') anime({ targets: element, scale: 1.02, duration: 200, easing: 'easeOutElastic(1, .8)' });
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
        if(typeof anime !== 'undefined') anime({ targets: `#${tabId}-view`, opacity: [0, 1], translateY: [20, 0], duration: 400, easing: 'easeOutQuart' });
        if (tabId === 'rpg' && window.initCanvas) window.initCanvas(); 
    });
});

// --- SOCKET LOGIC ---
function connectSocket() {
    window.socket = new WebSocket(window.serverUrl);
    
    window.saveConnectedRoom = function(ip) {
        let history = JSON.parse(localStorage.getItem('conflictRecentRooms') || '[]');
        if (!history.includes(ip) && ip !== 'localhost') {
            history.unshift(ip); localStorage.setItem('conflictRecentRooms', JSON.stringify(history.slice(0, 5))); 
        }
    };
    
    const urlIP = window.serverUrl.replace('ws://', '').replace('wss://', '').split(':')[0].split('/')[0];
    window.saveConnectedRoom(urlIP);

    window.socket.onopen = () => {
        window.reconnectAttempts = 0; clearTimeout(window.reconnectTimer);
        const joinBtn = document.getElementById('join-voice-btn');
        if (joinBtn && !window.localMicStream) { joinBtn.disabled = false; joinBtn.innerText = window.conflictTranslations ? window.conflictTranslations[localStorage.getItem('conflictLang') || 'en']?.joinCall || "🎙️ Join Call" : "🎙️ Join Call"; }
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
                if(window.addRemoteUserCard) window.addRemoteUserCard(data.userId, window.peerNames[data.userId], window.peerAvatars[data.userId]);
                let pc = window.peers[data.userId] || (window.createPeerConnection ? window.createPeerConnection(data.userId) : null);
                if(pc && window.addLocalTracksSafely) window.addLocalTracksSafely(pc);
                if(pc) {
                    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
                    window.socket.send(JSON.stringify({ action: 'offer', userId: window.myId, targetId: data.userId, username: document.getElementById('display-username').textContent, avatar: localStorage.getItem('appAvatar') || null, offer: offer }));
                }
                if (window.isDM) window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: document.getElementById('rpg-system-select').value }));
            }
            else if (data.action === 'remove_video') {
                const vid1 = document.getElementById(`video-container-${data.streamId}`); if (vid1) vid1.remove();
                const vid2 = document.getElementById(`video-container-${data.trackId}`); if (vid2) vid2.remove();
            }
            else if (data.action === 'set_campaign_system' && window.applyCampaignSystem) { window.applyCampaignSystem(data.system, false); if(window.addChatLine) window.addChatLine('System', `👑 The DM set the campaign system to **${data.system.toUpperCase()}**.`, true); }
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
                if (window.isDM && window.viewingParty) { if (document.getElementById('party-list-grid') && window.renderPartyList) window.renderPartyList(); if (window.viewingRemoteUid === data.userId && window.renderRemoteSheet) window.renderRemoteSheet(data.userId); }
            }
            else if (data.action === 'offer' && data.targetId === window.myId) {
                if (data.username) window.peerNames[data.userId] = data.username;
                if (data.avatar) window.peerAvatars[data.userId] = data.avatar;
                if(window.addRemoteUserCard) window.addRemoteUserCard(data.userId, window.peerNames[data.userId], window.peerAvatars[data.userId]);
                let pc = window.peers[data.userId] || (window.createPeerConnection ? window.createPeerConnection(data.userId) : null);
                if(pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                    if (window.iceCandidateQueue[data.userId]) { while (window.iceCandidateQueue[data.userId].length > 0) await pc.addIceCandidate(window.iceCandidateQueue[data.userId].shift()); }
                    if(window.addLocalTracksSafely) window.addLocalTracksSafely(pc); 
                    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
                    window.socket.send(JSON.stringify({ action: 'answer', userId: window.myId, targetId: data.userId, answer: answer }));
                }
            }
            else if (data.action === 'set_map_bg') { if (window.setMapBackground) window.setMapBackground(data.image, data.w, data.h); }
            else if (data.action === 'claim_dm') {
                if(window.addChatLine) window.addChatLine('System', `👑 ${data.username} is now the Dungeon Master.`, true);
                const dmBtn = document.getElementById('claim-dm-btn');
                if (data.userId !== window.myId && dmBtn) { dmBtn.innerText = `👑 DM: ${data.username}`; dmBtn.disabled = true; dmBtn.style.borderColor = "var(--border-color)"; dmBtn.style.color = "var(--text-muted)"; }
            }
            else if (data.action === 'release_dm') {
                if(window.addChatLine) window.addChatLine('System', `👑 The Dungeon Master role is now open.`, true);
                const dmBtn = document.getElementById('claim-dm-btn'); if(dmBtn) { dmBtn.innerText = `👑 Claim DM`; dmBtn.disabled = false; dmBtn.style.borderColor = "#fbbf24"; dmBtn.style.color = "#fbbf24"; }
            }
            else if (data.action === 'answer' && data.targetId === window.myId && window.peers[data.userId]) await window.peers[data.userId].setRemoteDescription(new RTCSessionDescription(data.answer));
            else if (data.action === 'ice-candidate' && data.targetId === window.myId && window.peers[data.userId]) {
                const pc = window.peers[data.userId]; const candidate = new RTCIceCandidate(data.candidate);
                if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(candidate);
                else { if (!window.iceCandidateQueue[data.userId]) window.iceCandidateQueue[data.userId] = []; window.iceCandidateQueue[data.userId].push(candidate); }
            }
            else if (data.action === 'chat_message') { if(window.addChatLine) window.addChatLine(data.username || 'Guest', data.text || ''); }
            else if (data.action === 'dice_roll' && data.userId !== window.myId && window.animateDiceRoll2D) {
                const sides = parseInt(data.type[0]?.replace(/^\d+d/, '') || data.type.replace(/^\d+d/, '')) || 20;
                window.animateDiceRoll2D(data.results, data.type, data.customClasses); 
                if (data.results.includes(sides) && window.triggerFireworks) window.triggerFireworks();
            }
            else if (data.action === 'token_add' && data.userId !== window.myId && window.placeTokenOnMap) window.placeTokenOnMap(data.token, false);
            else if (data.action === 'token_move' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.left = data.x + 'px'; el.style.top = data.y + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].x = data.x; window.mapAssets[data.tokenId].y = data.y; } } }
            else if (data.action === 'token_resize' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.width = data.w + 'px'; el.style.height = data.h + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].w = data.w; window.mapAssets[data.tokenId].h = data.h; } } }
            else if (data.action === 'token_zindex' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.zIndex = data.z; if(window.mapAssets && window.mapAssets[data.tokenId]) window.mapAssets[data.tokenId].z = data.z; } }
            else if (data.action === 'token_hide' && data.userId !== window.myId) { 
                const el = document.getElementById('map-token-' + data.tokenId); 
                if (el && window.mapAssets && window.mapAssets[data.tokenId]) { 
                    window.mapAssets[data.tokenId].hidden = data.hidden; 
                    if (window.applyVisibility) window.applyVisibility(el, data.hidden); 
                } 
            }
            else if (data.action === 'tokens_clear' && data.userId !== window.myId) { document.getElementById('token-layer').innerHTML = ''; if (window.mapAssets) window.mapAssets = {}; }
            else if (data.action === 'token_remove' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) el.remove(); if(window.mapAssets) delete window.mapAssets[data.tokenId]; }
            else if (data.action === 'canvas_draw' && data.userId !== window.myId && window.remoteDraw) window.remoteDraw(data);
            else if (data.action === 'canvas_clear' && data.userId !== window.myId && window.ctx) window.ctx.clearRect(0, 0, 8000, 8000);
            else if (data.action === 'yt_load') { window.ytQueue.unshift({ id: data.videoId }); if(window.loadAndPlayVideo) window.loadAndPlayVideo(data.videoId, 0); if(window.addChatLine) window.addChatLine('System', `▶️ Playing new YouTube Video`, true); }
            else if (data.action === 'yt_queue_add') { window.ytQueue.push({ id: data.videoId }); if(window.renderQueueUI) window.renderQueueUI(); if(window.addChatLine) window.addChatLine('System', `➕ A user added a video to the queue`, true); }
            else if (data.action === 'yt_skip' || data.action === 'yt_jump') { window.currentQueueIndex = data.action === 'yt_jump' ? data.index : window.currentQueueIndex + 1; if (window.ytQueue[window.currentQueueIndex] && window.loadAndPlayVideo) window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); }
            else if (data.action === 'yt_pause') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PAUSED) window.ytPlayer.pauseVideo(); }
            else if (data.action === 'yt_play') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) window.ytPlayer.playVideo(); }
            else if (data.action === 'sound_played' && data.userId !== window.myId) { if(window.addChatLine) window.addChatLine('System', `🔊 Sound played: ${data.soundName}`, true); }
        } catch (e) {}
    };
}
connectSocket();
setInterval(() => { if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'keep_alive' })); }, 10000);

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
        if(typeof anime !== 'undefined') anime({ targets: configView, opacity: [0, 1], translateY: [20, 0], scale: [0.95, 1], duration: 400, easing: 'easeOutQuart' });
    } else {
        if(typeof anime !== 'undefined') anime({ targets: configView, opacity: [1, 0], translateY: [0, 20], scale: [1, 0.95], duration: 200, easing: 'easeInQuart', complete: () => configView.style.display = 'none' });
    }
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
    if (window.populateDevices) window.populateDevices();
};
if (window.ipcRenderer) {
    const startupToggle = document.getElementById('startup-toggle');
    if (startupToggle) {
        startupToggle.checked = localStorage.getItem('conflictStartup') === 'true';
        startupToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked; localStorage.setItem('conflictStartup', isChecked); window.ipcRenderer.send('toggle-startup', isChecked);
        });
    }
}