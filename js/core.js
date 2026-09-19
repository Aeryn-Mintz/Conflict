// ==========================================
// CENTRAL NETWORK & STATE ROUTER (core.js)
// ==========================================

if (typeof require !== 'undefined') { window.ipcRenderer = require('electron').ipcRenderer; }

window.myId = Math.random().toString(36).substring(2, 15);
window.peerNames = {};
window.peerAvatars = {};
window.defaultAvatar = './Banaya.png';
window.partySheets = {};
window.viewingParty = false;
window.isDM = false;
window.viewingRemoteUid = null;

// 1. ELECTRON IPC (AUTO-UPDATER)
if (window.ipcRenderer) {
    window.ipcRenderer.on('update_available', () => {
        const overlay = document.getElementById('update-overlay'); if (overlay) overlay.style.display = 'flex';
        const msg = document.getElementById('update-msg'); if (msg) msg.innerText = 'Downloading update...';
    });
    window.ipcRenderer.on('download_progress', (event, percent) => {
        const bar = document.getElementById('update-progress-bar'); if (bar) bar.style.width = percent + '%';
    });
    window.ipcRenderer.on('update_downloaded', () => {
        const msg = document.getElementById('update-msg'); if (msg) msg.innerText = 'Update ready! Restarting in 3 seconds...';
        setTimeout(() => { window.ipcRenderer.send('restart_app'); }, 3000);
    });
}

// 2. WEBSOCKET ROUTER (NETWORK)
let serverUrl = localStorage.getItem('conflictServerUrl');

if (!serverUrl) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    serverUrl = wsProtocol + '//' + window.location.host;
}

window.socket = new WebSocket(serverUrl);

window.socket.onopen = () => {
    const username = document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'User';
    const avatar = localStorage.getItem('appAvatar') || window.defaultAvatar;
    window.socket.send(JSON.stringify({ action: 'join', userId: window.myId, username: username, avatar: avatar }));
    if (window.addChatLine) window.addChatLine('System', 'Connected to the room server.', 'system');
};

window.socket.onerror = () => {
    if (window.addChatLine) window.addChatLine('System', '⚠️ Could not connect to signaling server. Features requiring network routing may fail.', 'system');
};

window.socket.onmessage = async (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    if (['offer', 'answer', 'ice-candidate', 'join'].includes(data.action)) {
        if (window.handleWebRTCSignal) window.handleWebRTCSignal(data);
    }
    
    if (data.action === 'join' && data.userId !== window.myId) {
        window.peerNames[data.userId] = data.username || "Guest";
        window.peerAvatars[data.userId] = data.avatar || window.defaultAvatar;
        if (window.createPeerConnection && !window.peers[data.userId]) window.createPeerConnection(data.userId);
        if (window.renderConnectedUsers) window.renderConnectedUsers();
        
        window.socket.send(JSON.stringify({
            action: 'presence', targetId: data.userId, userId: window.myId,
            username: document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'Guest',
            avatar: localStorage.getItem('appAvatar') || window.defaultAvatar
        }));
        
        if (window.isDM) {
            if (window.ytQueue && window.ytQueue.length > 0) window.socket.send(JSON.stringify({ action: 'yt_sync', targetId: data.userId, queue: window.ytQueue, index: window.currentQueueIndex }));
            window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: document.getElementById('rpg-system-select')?.value || 'dnd' }));
            if (window.initiativeList && window.initiativeList.length > 0) window.socket.send(JSON.stringify({ action: 'sync_initiative', list: window.initiativeList, turn: window.initiativeTurn }));
        }
    }
    else if (data.action === 'presence' && data.targetId === window.myId) {
        window.peerNames[data.userId] = data.username || "Guest";
        window.peerAvatars[data.userId] = data.avatar || window.defaultAvatar;
        if (window.createPeerConnection && !window.peers[data.userId]) window.createPeerConnection(data.userId);
        if (window.renderConnectedUsers) window.renderConnectedUsers();
    }
    
    else if (data.action === 'set_campaign_system' && window.applyCampaignSystem) { window.applyCampaignSystem(data.system, false); if(window.addChatLine) window.addChatLine('System', `👑 The DM set the campaign system to **${data.system.toUpperCase()}**.`, 'system'); }
    else if (data.action === 'request_sheets' && window.saveCharacterSheet) window.saveCharacterSheet(document.getElementById('rpg-system-select')?.value || 'dnd');
    else if (data.action === 'sheet_update') { 
        window.partySheets[data.userId] = { username: data.username, system: data.system, charName: data.charName, data: data.data, portrait: data.portrait }; 
        if (window.isDM && window.viewingParty) { if (document.getElementById('party-list-grid') && window.renderPartyList) window.renderPartyList(); if (window.viewingRemoteUid === data.userId && window.renderRemoteSheet) window.renderRemoteSheet(data.userId); } 
    }
    else if (data.action === 'set_map_bg') { if (window.setMapBackground) window.setMapBackground(data.image, data.w, data.h); }
    
    else if (data.action === 'claim_dm') { if(window.addChatLine) window.addChatLine('System', `👑 ${data.username} is now the Dungeon Master.`, 'system'); const dmBtn = document.getElementById('claim-dm-btn'); if (data.userId !== window.myId && dmBtn) { dmBtn.innerText = `👑 DM: ${data.username}`; dmBtn.disabled = true; dmBtn.style.borderColor = "var(--border-color)"; dmBtn.style.color = "var(--text-muted)"; } }
    else if (data.action === 'release_dm') { if(window.addChatLine) window.addChatLine('System', `👑 The Dungeon Master role is now open.`, 'system'); const dmBtn = document.getElementById('claim-dm-btn'); if(dmBtn) { dmBtn.innerText = `👑 Claim DM`; dmBtn.disabled = false; dmBtn.style.borderColor = "#fbbf24"; dmBtn.style.color = "#fbbf24"; } }
    
    else if (data.action === 'chat_message') { if(window.addChatLine) window.addChatLine(data.username || 'Guest', data.text || '', data.type || 'normal', data.avatar || window.peerAvatars[data.userId]); }
    else if (data.action === 'dice_chat_message') { if(window.addChatLine) window.addChatLine(data.username || 'Guest', data.text || '', 'dice', data.avatar || window.peerAvatars[data.userId]); }
    else if (data.action === 'dice_roll' && data.userId !== window.myId && window.animateDiceRoll2D) { 
        let mainSide = 20; if (Array.isArray(data.type)) { mainSide = parseInt(data.type[0].replace(/\D/g, '')) || 20; } else if (typeof data.type === 'string') { mainSide = parseInt(data.type.replace(/\D/g, '')) || 20; } 
        window.animateDiceRoll2D(data.results, data.type, data.customClasses); if (data.results.includes(mainSide) && window.triggerFireworks) window.triggerFireworks(); 
    }
    
    else if (data.action === 'add_initiative') { if(window.addInitiativeEntry) window.addInitiativeEntry(data.name, data.roll, data.avatar); }
    else if (data.action === 'sync_initiative') { window.initiativeList = data.list; window.initiativeTurn = data.turn; if(window.renderInitiativeList) window.renderInitiativeList(); }

    else if (data.action === 'token_add' && data.userId !== window.myId && window.placeTokenOnMap) window.placeTokenOnMap(data.token, false);
    else if (data.action === 'token_move' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.left = data.x + 'px'; el.style.top = data.y + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].x = data.x; window.mapAssets[data.tokenId].y = data.y; } } }
    else if (data.action === 'token_resize' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.width = data.w + 'px'; el.style.height = data.h + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].w = data.w; window.mapAssets[data.tokenId].h = data.h; } } }
    else if (data.action === 'token_zindex' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.zIndex = data.z; if(window.mapAssets && window.mapAssets[data.tokenId]) window.mapAssets[data.tokenId].z = data.z; } }
    else if (data.action === 'token_hide' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el && window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].hidden = data.hidden; if (window.applyVisibility) window.applyVisibility(el, data.hidden); } }
    else if (data.action === 'tokens_clear' && data.userId !== window.myId) { document.getElementById('token-layer').innerHTML = ''; if (window.mapAssets) window.mapAssets = {}; }
    else if (data.action === 'token_remove' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) el.remove(); if(window.mapAssets) delete window.mapAssets[data.tokenId]; }
    else if (data.action === 'canvas_draw' && data.userId !== window.myId && window.remoteDraw) window.remoteDraw(data);
    else if (data.action === 'canvas_clear' && data.userId !== window.myId && window.ctx) window.ctx.clearRect(0, 0, 8000, 8000);
    
    else if (data.action === 'yt_load') { window.ytQueue.unshift({ id: data.videoId, title: data.title || `Video (${data.videoId})` }); if(window.loadAndPlayVideo) window.loadAndPlayVideo(data.videoId, 0); }
    else if (data.action === 'yt_queue_add') { window.ytQueue.push({ id: data.videoId, title: data.title || `Video (${data.videoId})` }); if(window.renderQueueUI) window.renderQueueUI(); }
    else if (data.action === 'yt_skip' || data.action === 'yt_jump') { window.currentQueueIndex = data.action === 'yt_jump' ? data.index : window.currentQueueIndex + 1; if (window.ytQueue[window.currentQueueIndex] && window.loadAndPlayVideo) window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); }
    else if (data.action === 'yt_pause') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PAUSED) window.ytPlayer.pauseVideo(); }
    else if (data.action === 'yt_play') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) window.ytPlayer.playVideo(); }
    else if (data.action === 'yt_remove') { if (window.removeFromQueue) window.removeFromQueue(data.index, false); }
    else if (data.action === 'yt_sync' && (data.targetId === window.myId || !data.targetId)) { 
        window.ytQueue = data.queue; window.currentQueueIndex = data.index; if (window.renderQueueUI) window.renderQueueUI(); 
        if (window.currentQueueIndex >= 0 && window.ytQueue[window.currentQueueIndex] && window.loadAndPlayVideo) { window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); } 
    }
};

// 3. UI, SETTINGS & HARDWARE ENGINE
window.makeDraggable = function(el) {
    const handle = el.querySelector('.drag-handle'); if (!handle) return;
    let isDragging = false, startX, startY, initialX, initialY;

    handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true; startX = e.clientX; startY = e.clientY;
        initialX = el.offsetLeft; initialY = el.offsetTop;
        document.body.style.userSelect = 'none';
        document.querySelectorAll('.floating-panel').forEach(p => p.style.zIndex = 100);
        el.style.zIndex = 101;
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return; const dx = e.clientX - startX; const dy = e.clientY - startY;
        el.style.left = (initialX + dx) + 'px'; el.style.top = (initialY + dy) + 'px';
    });
    document.addEventListener('mouseup', () => { isDragging = false; document.body.style.userSelect = ''; });
};

window.renderConnectedUsers = function() {
    const listEl = document.getElementById('connected-users-list');
    const titleEl = document.getElementById('connected-users-title');
    if (!listEl || !titleEl) return;
    
    listEl.innerHTML = '';
    const userIds = Object.keys(window.peerNames);
    titleEl.innerText = `👥 Connected Users (${userIds.length + 1})`; 
    
    const myName = document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'You';
    const myAvatar = localStorage.getItem('appAvatar') || window.defaultAvatar;
    
    const localRow = document.createElement('div');
    localRow.className = 'user-card kokonut-card';
    localRow.style.display = 'flex'; localRow.style.justifyContent = 'space-between'; localRow.style.alignItems = 'center'; localRow.style.padding = '8px';
    localRow.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><img src="${myAvatar}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:2px solid var(--accent-main);"><span style="font-size:13px; font-weight:bold; color: var(--accent-main);">${myName} (You)</span></div>`;
    listEl.appendChild(localRow);

    userIds.forEach(uid => {
        const row = document.createElement('div');
        row.className = 'user-card kokonut-card';
        row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center'; row.style.padding = '8px';
        row.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><img src="${window.peerAvatars[uid] || window.defaultAvatar}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:1px solid var(--border-color);"><span style="font-size:13px; font-weight:bold;">${window.peerNames[uid]}</span></div><button class="icon-btn kokonut-btn btn-vol" data-uid="${uid}" style="font-size:16px;" title="Adjust Volume">🔊</button>`;
        listEl.appendChild(row);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { if (window.renderConnectedUsers) window.renderConnectedUsers(); }, 500);
    if (window.makeDraggable) document.querySelectorAll('.floating-panel').forEach(window.makeDraggable);
    
    const tabs = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.content-wrapper');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            views.forEach(v => { v.style.display = 'none'; v.style.opacity = 0; });

            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab') + '-view';
            const targetView = document.getElementById(targetId);
            
            if (targetView) {
                if (targetId === 'main-view') targetView.style.display = 'block';
                else targetView.style.display = 'flex';
                
                setTimeout(() => targetView.style.opacity = 1, 50);
                if (targetId === 'rpg-view' && window.updateCamera) setTimeout(window.updateCamera, 100);
            }
        });
    });

    async function loadDevices() {
        try {
            try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch(e) {}
            try { await navigator.mediaDevices.getUserMedia({ video: true }); } catch(e) {}
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioIn = document.getElementById('audio-in-select'); 
            const audioOut = document.getElementById('audio-out-select'); 
            const videoIn = document.getElementById('video-in-select');
            if(audioIn) audioIn.innerHTML = ''; 
            if(audioOut) audioOut.innerHTML = ''; 
            if(videoIn) videoIn.innerHTML = '';
            
            devices.forEach(device => {
                const opt = document.createElement('option'); 
                opt.value = device.deviceId; 
                opt.text = device.label || `${device.kind} (${device.deviceId.slice(0,5)}...)`;
                if (device.kind === 'audioinput' && audioIn) audioIn.appendChild(opt); 
                else if (device.kind === 'audiooutput' && audioOut) audioOut.appendChild(opt); 
                else if (device.kind === 'videoinput' && videoIn) videoIn.appendChild(opt);
            });
            
            if (audioIn && localStorage.getItem('appAudioIn')) audioIn.value = localStorage.getItem('appAudioIn');
            if (audioOut && localStorage.getItem('appAudioOut')) audioOut.value = localStorage.getItem('appAudioOut');
            if (videoIn && localStorage.getItem('appVideoIn')) videoIn.value = localStorage.getItem('appVideoIn');
        } catch (e) {}
    }

    const configView = document.getElementById('config-view');
    document.getElementById('settings-btn')?.addEventListener('click', () => { 
        if (configView) {
            configView.style.display = configView.style.display === 'none' ? 'block' : 'none'; 
            if (configView.style.display === 'block') loadDevices(); 
        }
    });
    document.getElementById('refresh-devices-btn')?.addEventListener('click', loadDevices);

    // Startup checkbox listener
    const startupToggle = document.getElementById('startup-toggle');
    if (startupToggle) {
        startupToggle.checked = localStorage.getItem('appStartup') === 'true';
        startupToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem('appStartup', isEnabled);
            if (window.ipcRenderer) window.ipcRenderer.send('toggle-startup', isEnabled);
        });
    }

    // --- VIBEY THEME SAVING LOGIC ---
    document.getElementById('save-theme-btn')?.addEventListener('click', () => {
        const newName = document.getElementById('username-input')?.value.trim();
        if (newName) {
            const dispName = document.getElementById('display-username');
            if(dispName) dispName.textContent = newName; 
            localStorage.setItem('appUsername', newName);
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                window.socket.send(JSON.stringify({ action: 'presence', targetId: null, userId: window.myId, username: newName, avatar: localStorage.getItem('appAvatar') }));
            }
        }

        const audioIn = document.getElementById('audio-in-select')?.value; 
        const audioOut = document.getElementById('audio-out-select')?.value; 
        const videoIn = document.getElementById('video-in-select')?.value;
        if (audioIn) localStorage.setItem('appAudioIn', audioIn); 
        if (audioOut) localStorage.setItem('appAudioOut', audioOut); 
        if (videoIn) localStorage.setItem('appVideoIn', videoIn);

        const bg = document.getElementById('color-bg')?.value || '#050a06'; 
        const panel = document.getElementById('color-panel')?.value || '#0a140c'; 
        const text = document.getElementById('color-text')?.value || '#e2e8f0'; 
        const accent = document.getElementById('color-accent')?.value || '#10b981';
        
        // CONVERT SOLID HEX TO TRANSLUCENT GLASS (65% Opacity)
        let r = parseInt(panel.slice(1, 3), 16), g = parseInt(panel.slice(3, 5), 16), b = parseInt(panel.slice(5, 7), 16);
        const glassPanel = `rgba(${r || 10}, ${g || 20}, ${b || 12}, 0.65)`;

        document.documentElement.style.setProperty('--bg-color', bg); 
        document.documentElement.style.setProperty('--panel-bg', glassPanel); 
        document.documentElement.style.setProperty('--text-main', text); 
        document.documentElement.style.setProperty('--accent-main', accent);
        
        localStorage.setItem('themeBg', bg); 
        localStorage.setItem('themePanel', panel); // Save raw hex for the color picker
        localStorage.setItem('themeText', text); 
        localStorage.setItem('themeAccent', accent);

        if (configView) configView.style.display = 'none';
    });

    document.getElementById('reset-theme-btn')?.addEventListener('click', () => {
        document.documentElement.style.setProperty('--bg-color', '#050a06'); 
        document.documentElement.style.setProperty('--panel-bg', 'rgba(10, 20, 12, 0.65)'); 
        document.documentElement.style.setProperty('--text-main', '#e2e8f0'); 
        document.documentElement.style.setProperty('--accent-main', '#10b981');
        localStorage.removeItem('themeBg'); 
        localStorage.removeItem('themePanel'); 
        localStorage.removeItem('themeText'); 
        localStorage.removeItem('themeAccent');
        
        // Reset Inputs visually
        const bgInp = document.getElementById('color-bg'); if(bgInp) bgInp.value = '#050a06'; 
        const pInp = document.getElementById('color-panel'); if(pInp) pInp.value = '#0a140c'; 
        const tInp = document.getElementById('color-text'); if(tInp) tInp.value = '#e2e8f0'; 
        const aInp = document.getElementById('color-accent'); if(aInp) aInp.value = '#10b981';
    });

    const volMenu = document.getElementById('user-volume-context-menu'); 
    const volSlider = document.getElementById('uv-slider'); 
    let activeVolUid = null;

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-vol');
        if (btn) {
            activeVolUid = btn.getAttribute('data-uid'); 
            const uvName = document.getElementById('uv-name');
            if(uvName) uvName.innerText = `Volume: ${window.peerNames[activeVolUid]}`;
            const existingAudio = document.querySelector(`.stream-${activeVolUid}`);
            if(volSlider) volSlider.value = existingAudio ? existingAudio.volume : 0.8;
            const rect = btn.getBoundingClientRect(); 
            if(volMenu) {
                volMenu.style.left = (rect.left - 150) + 'px'; 
                volMenu.style.top = rect.top + 'px'; 
                volMenu.style.display = 'flex';
            }
            e.stopPropagation();
        } else if (volMenu && !volMenu.contains(e.target)) { 
            volMenu.style.display = 'none'; 
        }
    });

    volSlider?.addEventListener('input', (e) => {
        if (!activeVolUid) return; 
        const vol = parseFloat(e.target.value);
        document.querySelectorAll(`.stream-${activeVolUid}`).forEach(media => { media.volume = vol; });
        let hiddenInput = document.getElementById(`vol-${activeVolUid}`);
        if (!hiddenInput) { 
            hiddenInput = document.createElement('input'); 
            hiddenInput.type = 'hidden'; 
            hiddenInput.id = `vol-${activeVolUid}`; 
            document.body.appendChild(hiddenInput); 
        }
        hiddenInput.value = vol;
    });

    document.getElementById('connected-users-btn')?.addEventListener('click', () => { 
        const p = document.getElementById('connected-users-panel'); 
        if (p) {
            p.style.display = p.style.display === 'none' ? 'block' : 'none'; 
            if (p.style.display === 'block' && window.renderConnectedUsers) window.renderConnectedUsers(); 
        }
    });

    document.getElementById('leave-room-btn')?.addEventListener('click', () => { 
        if (confirm('Disconnect from this room?')) window.location.href = 'index.html'; 
    });

    const savedName = localStorage.getItem('appUsername'); 
    if (savedName) { 
        const du = document.getElementById('display-username'); if(du) du.textContent = savedName; 
        const ui = document.getElementById('username-input'); if(ui) ui.value = savedName; 
    }
    const savedAvatar = localStorage.getItem('appAvatar'); 
    if (savedAvatar) { 
        const ua = document.getElementById('user-avatar'); if(ua) ua.src = savedAvatar; 
        const cap = document.getElementById('config-avatar-preview'); if(cap) cap.src = savedAvatar; 
    }

    // --- VIBEY THEME INITIALIZATION ---
    const savedBg = localStorage.getItem('themeBg') || '#050a06'; 
    const savedPanel = localStorage.getItem('themePanel') || '#0a140c'; 
    const savedText = localStorage.getItem('themeText') || '#e2e8f0'; 
    const savedAccent = localStorage.getItem('themeAccent') || '#10b981'; 

    // Update color inputs so saving doesn't overwrite them with black
    const bgInp = document.getElementById('color-bg'); if(bgInp) bgInp.value = savedBg;
    const pInp = document.getElementById('color-panel'); if(pInp) pInp.value = savedPanel;
    const tInp = document.getElementById('color-text'); if(tInp) tInp.value = savedText;
    const aInp = document.getElementById('color-accent'); if(aInp) aInp.value = savedAccent;

    // Apply the glass transparency on boot
    let pr = parseInt(savedPanel.slice(1, 3), 16), pg = parseInt(savedPanel.slice(3, 5), 16), pb = parseInt(savedPanel.slice(5, 7), 16);
    const glassPanelInit = `rgba(${pr || 10}, ${pg || 20}, ${pb || 12}, 0.65)`;

    document.documentElement.style.setProperty('--bg-color', savedBg);
    document.documentElement.style.setProperty('--panel-bg', glassPanelInit);
    document.documentElement.style.setProperty('--text-main', savedText);
    document.documentElement.style.setProperty('--accent-main', savedAccent);
});