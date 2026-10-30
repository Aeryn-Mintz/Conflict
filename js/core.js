// ==========================================
// CENTRAL NETWORK & STATE ROUTER (core.js)
// Otimizado: Sem AudioContext no Startup e Sem WebRTC Ocioso
// ==========================================

if (typeof require !== 'undefined') { window.ipcRenderer = require('electron').ipcRenderer; }

window.myId = localStorage.getItem('conflictPersistentUid') || Math.random().toString(36).substring(2, 15);
localStorage.setItem('conflictPersistentUid', window.myId);

window.peerNames = {};
window.peerAvatars = {};
window.peerIps = {};
window.peerInCall = {};
window.inVoiceCall = false;
window.myVirtualIp = '10.66.0.x';
window.defaultAvatar = './Banaya.png';
window.partySheets = {};
window.viewingParty = false;
window.isDM = false;
window.viewingRemoteUid = null;

if (window.ipcRenderer) {
    window.ipcRenderer.invoke('get-virtual-ip').then(ip => {
        if (ip) {
            window.myVirtualIp = ip;
            if (window.renderConnectedUsers) window.renderConnectedUsers();
        }
    }).catch(() => {});
}

// 1. WEBSOCKET ROUTER (NETWORK)
let serverUrl = localStorage.getItem('conflictServerUrl');

if (!serverUrl) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    serverUrl = wsProtocol + '//' + window.location.host;
}

window.socket = new WebSocket(serverUrl);
window.hasAnnouncedJoin = false;
window.presenceHeartbeat = null;

window._lastJoinSentAt = 0;
window._networkEnsuredOnce = false;

window.sendJoinPacket = function(force = false) {
    if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (!force && now - window._lastJoinSentAt < 1200) return;
    window._lastJoinSentAt = now;

    const username = document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'User';
    const activeNet = JSON.parse(localStorage.getItem('conflictActiveNetwork') || '{}');

    window.socket.send(JSON.stringify({
        action: 'join',
        userId: window.myId,
        username: username,
        virtualIp: window.myVirtualIp,
        inCall: window.inVoiceCall,
        roomCode: activeNet.code || 'DEFAULT',
        roomName: activeNet.name || `Network #${activeNet.code || 'DEFAULT'}`,
        ts: now
    }));
};

window.announceRoomJoin = async function() {
    if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;

    let activeNet = JSON.parse(localStorage.getItem('conflictActiveNetwork') || '{"code":"DEFAULT","name":"Network"}');
    if (activeNet.name && activeNet.name.includes('|')) {
        const parts = activeNet.name.split('|');
        activeNet.name = parts[0].trim();
        if (parts[1] && (!activeNet.code || activeNet.code === 'DEFAULT')) {
            activeNet.code = parts[1].trim().toUpperCase();
        }
        localStorage.setItem('conflictActiveNetwork', JSON.stringify(activeNet));
    }

    const username = document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'User';

    // IMPORTANTE: Só invoca ensure-network UMA vez por sessão para nunca criar loop infinito com room_ready!
    if (window.ipcRenderer && !window._networkEnsuredOnce) {
        window._networkEnsuredOnce = true;
        try {
            const res = await window.ipcRenderer.invoke('ensure-network', {
                roomCode: activeNet.code || 'DEFAULT',
                roomName: activeNet.name || `Network #${activeNet.code}`,
                hostName: username,
                userId: window.myId
            });
            if (res && res.virtualIp) window.myVirtualIp = res.virtualIp;
        } catch (e) {}
    }

    window.sendJoinPacket(true);

    if (!window.hasAnnouncedJoin) {
        window.hasAnnouncedJoin = true;
        setTimeout(() => window.sendJoinPacket(true), 2000);
        if (window.addChatLine) {
            window.addChatLine('System', `🌐 Connected to Network **${activeNet.name || activeNet.code || 'LAN'}** (Your Static LAN IP: ${window.myVirtualIp}).`, 'system');
        }
        if (window.renderConnectedUsers) window.renderConnectedUsers();

        if (window.presenceHeartbeat) clearInterval(window.presenceHeartbeat);
        window.presenceHeartbeat = setInterval(() => {
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                const currentName = document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'User';
                window.socket.send(JSON.stringify({
                    action: 'presence',
                    targetId: null,
                    userId: window.myId,
                    username: currentName,
                    virtualIp: window.myVirtualIp,
                    inCall: window.inVoiceCall,
                    ts: Date.now()
                }));
            }
        }, 8000);
    }
};

if (window.ipcRenderer) {
    window.ipcRenderer.on('n2n-status', () => {
        if (window.addChatLine) window.addChatLine('System', `🌐 Virtual LAN (${window.myVirtualIp}) active and ready for games!`, 'system');
    });
}

window.socket.onopen = () => {
    window.announceRoomJoin();
};

window.socket.onerror = () => {
    if (window.addChatLine) window.addChatLine('System', '⚠️ Could not connect to signaling server. Features requiring network routing may fail.', 'system');
};

window.socket.onmessage = async (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    if (data.action === 'voice_frame') {
        if (window.handleVoiceFrame) window.handleVoiceFrame(data);
        return;
    }

    if (data.action === 'audio_ack' && data.targetId === window.myId) {
        if (window._peerAckedAudio) window._peerAckedAudio[data.userId] = true;
        return;
    }

    if (data.action === 'video_ack' && data.targetId === window.myId) {
        if (window._peerAckedVideo) window._peerAckedVideo[data.userId] = true;
        return;
    }

    if ((data.action === 'screen_frame' || data.action === 'screen_stop') && data.userId !== window.myId) {
        if (window.handleScreenFrame) window.handleScreenFrame(data);
        if (data.action === 'screen_stop') {
            document.querySelectorAll(`.stream-${data.userId}`).forEach(el => {
                if (el.id && (el.id.startsWith('video-container-') || el.id.startsWith('bridge-screen-container-'))) el.remove();
            });
        }
        return;
    }

    if (data.action === 'room_ready') {
        window.sendJoinPacket(false);
        return;
    }

    if (data.action === 'call_state' && data.userId !== window.myId) {
        const wasInCall = !!window.peerInCall[data.userId];
        const nowInCall = !!data.inCall;
        window.peerInCall[data.userId] = nowInCall;

        if (!nowInCall) {
            if (window._peerAckedAudio) window._peerAckedAudio[data.userId] = false;
            document.querySelectorAll(`.stream-${data.userId}`).forEach(el => {
                if (el.id && (el.id.startsWith('video-container-') || el.id.startsWith('bridge-screen-container-'))) el.remove();
            });
        }

        // Só toca o som e mostra mensagem no chat se o estado realmente mudou!
        if (wasInCall !== nowInCall) {
            if (window.playUiSound) window.playUiSound(nowInCall ? 'join_call' : 'leave_call');
            if (window.addChatLine) {
                const pName = window.peerNames[data.userId] || 'A friend';
                window.addChatLine('System', nowInCall ? `🎙️ **${pName}** joined the Voice Channel.` : `📴 **${pName}** left the Voice Channel.`, 'system');
            }
        }
        if (window.renderConnectedUsers) window.renderConnectedUsers();
        return;
    }
    
    if (data.action === 'join' && data.userId !== window.myId) {
        const isFirstSeen = !window.peerNames[data.userId];
        window.peerNames[data.userId] = data.username || "Guest";
        window.peerAvatars[data.userId] = data.avatar || window.defaultAvatar;
        if (data.virtualIp) window.peerIps[data.userId] = data.virtualIp;
        // Nunca deixa um pacote de join/presence atrasado derrubar quem já está em call (apenas call_state desliga a call!)
        if (data.inCall === true) window.peerInCall[data.userId] = true;
        else if (window.peerInCall[data.userId] === undefined) window.peerInCall[data.userId] = false;
        if (isFirstSeen && window.playUiSound) window.playUiSound('peer_join');
        if (window.renderConnectedUsers) window.renderConnectedUsers();
        
        window.socket.send(JSON.stringify({
            action: 'presence',
            targetId: data.userId,
            userId: window.myId,
            username: document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'Guest',
            virtualIp: window.myVirtualIp,
            inCall: window.inVoiceCall,
            ts: Date.now()
        }));

        if (isFirstSeen && window.ytQueue && window.ytQueue.length > 0 && window.sendFullYtSync) {
            window.sendFullYtSync(data.userId);
        }
        
        if (window.isDM) {
            window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: document.getElementById('rpg-system-select')?.value || 'dnd' }));
            if (window.initiativeList && window.initiativeList.length > 0) window.socket.send(JSON.stringify({ action: 'sync_initiative', list: window.initiativeList, turn: window.initiativeTurn }));
        }
    }
    else if (data.action === 'presence' && (!data.targetId || data.targetId === window.myId)) {
        if (data.userId === window.myId) return;
        const changed = window.peerNames[data.userId] !== (data.username || "Guest") ||
                        window.peerIps[data.userId] !== data.virtualIp ||
                        window.peerInCall[data.userId] !== !!data.inCall;

        window.peerNames[data.userId] = data.username || "Guest";
        window.peerAvatars[data.userId] = data.avatar || window.defaultAvatar;
        if (data.virtualIp) window.peerIps[data.userId] = data.virtualIp;
        // Nunca deixa um pacote de join/presence atrasado derrubar quem já está em call (apenas call_state desliga a call!)
        if (data.inCall === true) window.peerInCall[data.userId] = true;
        else if (window.peerInCall[data.userId] === undefined) window.peerInCall[data.userId] = false;
        if (changed && window.renderConnectedUsers) window.renderConnectedUsers();
    }

    if (['offer', 'answer', 'ice-candidate', 'ice-candidates', 'join', 'presence'].includes(data.action)) {
        if (window.handleWebRTCSignal) window.handleWebRTCSignal(data);
    }

    if (data.action === 'set_campaign_system' && window.applyCampaignSystem) { window.applyCampaignSystem(data.system, false); if(window.addChatLine) window.addChatLine('System', `👑 The DM set the campaign system to **${data.system.toUpperCase()}**.`, 'system'); }
    else if (data.action === 'request_sheets' && window.saveCharacterSheet) window.saveCharacterSheet(document.getElementById('rpg-system-select')?.value || 'dnd');
    else if (data.action === 'sheet_update') { 
        window.partySheets[data.userId] = { username: data.username, system: data.system, charName: data.charName, data: data.data, portrait: data.portrait }; 
        if (window.isDM && window.viewingParty) { if (document.getElementById('party-list-grid') && window.renderPartyList) window.renderPartyList(); if (window.viewingRemoteUid === data.userId && window.renderRemoteSheet) window.renderRemoteSheet(data.userId); } 
    }
    else if (data.action === 'set_map_bg') { if (window.setMapBackground) window.setMapBackground(data.image, data.w, data.h); }
    
    else if (data.action === 'claim_dm') { if(window.addChatLine) window.addChatLine('System', `👑 ${data.username} is now the Dungeon Master.`, 'system'); const dmBtn = document.getElementById('claim-dm-btn'); if (data.userId !== window.myId && dmBtn) { dmBtn.innerText = `👑 DM: ${data.username}`; dmBtn.disabled = true; dmBtn.style.borderColor = "var(--border-color)"; dmBtn.style.color = "var(--text-muted)"; } }
    else if (data.action === 'release_dm') { if(window.addChatLine) window.addChatLine('System', `👑 The Dungeon Master role is now open.`, 'system'); const dmBtn = document.getElementById('claim-dm-btn'); if(dmBtn) { dmBtn.innerText = `👑 Claim DM`; dmBtn.disabled = false; dmBtn.style.borderColor = "#fbbf24"; dmBtn.style.color = "#fbbf24"; } }
    
    else if (data.action === 'chat_message') {
        if (data.userId !== window.myId && window.playUiSound) window.playUiSound('chat_in');
        if (window.addChatLine) window.addChatLine(data.username || 'Guest', data.text || '', data.type || 'normal', data.avatar || window.peerAvatars[data.userId]);
    }
    else if (data.action === 'dice_chat_message') {
        if (data.userId !== window.myId && window.playUiSound) window.playUiSound('chat_in');
        if (window.addChatLine) window.addChatLine(data.username || 'Guest', data.text || '', 'dice', data.avatar || window.peerAvatars[data.userId]);
    }
    else if (data.action === 'dice_roll' && data.userId !== window.myId && window.animateDiceRoll2D) { 
        let mainSide = 20; if (Array.isArray(data.type)) { mainSide = parseInt(data.type[0].replace(/\D/g, '')) || 20; } else if (typeof data.type === 'string') { mainSide = parseInt(data.type.replace(/\D/g, '')) || 20; } 
        window.animateDiceRoll2D(data.results, data.type, data.customClasses); if (data.results.includes(mainSide) && window.triggerFireworks) window.triggerFireworks(); 
    }
    
    else if (data.action === 'add_initiative') { if(window.addInitiativeEntry) window.addInitiativeEntry(data.name, data.roll, data.avatar); }
    else if (data.action === 'sync_initiative') { window.initiativeList = data.list; window.initiativeTurn = data.turn; if(window.renderInitiativeList) window.renderInitiativeList(); }

    else if (data.action === 'token_add' && data.userId !== window.myId && window.placeTokenOnMap) window.placeTokenOnMap(data.token, false);
    else if (data.action === 'token_move' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.left = data.x + 'px'; el.style.top = data.y + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].x = data.x; window.mapAssets[data.tokenId].y = data.y; } } }
    else if (data.action === 'token_resize' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.width = data.w + 'px'; el.style.height = data.h + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].w = data.w; window.mapAssets[data.tokenId].h = data.h; } } }
    else if (data.action === 'token_zindex' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.zIndex = data.z; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].z = data.z; } } }
    else if (data.action === 'token_hide' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el && window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].hidden = data.hidden; if (window.applyVisibility) window.applyVisibility(el, data.hidden); } }
    else if (data.action === 'tokens_clear' && data.userId !== window.myId) { document.getElementById('token-layer').innerHTML = ''; if (window.mapAssets) window.mapAssets = {}; }
    else if (data.action === 'token_remove' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) el.remove(); if(window.mapAssets) delete window.mapAssets[data.tokenId]; }
    else if (data.action === 'canvas_draw' && data.userId !== window.myId && window.remoteDraw) window.remoteDraw(data);
    else if (data.action === 'canvas_clear' && data.userId !== window.myId && window.ctx) window.ctx.clearRect(0, 0, window.mapWidth || 2400, window.mapHeight || 1600);
    
    else if (data.action === 'yt_request_sync' && data.userId !== window.myId) {
        if (isFirstSeen && window.ytQueue && window.ytQueue.length > 0 && window.sendFullYtSync) {
            window.sendFullYtSync(data.userId);
        }
    }
    else if (data.action === 'yt_state' && data.userId !== window.myId) {
        if (window.handleIncomingYtState) window.handleIncomingYtState(data);
    }
    else if (data.action === 'yt_load') {
        window.ytQueue.unshift({ id: data.videoId, title: data.title || `Video (${data.videoId})` });
        if (window.loadAndPlayVideo) window.loadAndPlayVideo(data.videoId, 0, 0, true);
    }
    else if (data.action === 'yt_queue_add') {
        window.ytQueue.push({ id: data.videoId, title: data.title || `Video (${data.videoId})` });
        if (window.currentQueueIndex === -1) {
            window.currentQueueIndex = 0;
            if (window.loadAndPlayVideo) window.loadAndPlayVideo(data.videoId, 0, 0, true);
        } else if (window.renderQueueUI) {
            window.renderQueueUI();
        }
    }
    else if (data.action === 'yt_skip' || data.action === 'yt_jump') {
        const nextIdx = data.action === 'yt_jump' ? data.index : (window.currentQueueIndex + 1);
        if (nextIdx !== window.currentQueueIndex && window.ytQueue[nextIdx]) {
            window.currentQueueIndex = nextIdx;
            if (window.loadAndPlayVideo) window.loadAndPlayVideo(window.ytQueue[nextIdx].id, nextIdx, 0, true);
        }
    }
    else if (data.action === 'yt_pause') {
        if (window.handleIncomingYtState) window.handleIncomingYtState({ ...data, state: 'pause' });
    }
    else if (data.action === 'yt_play') {
        if (window.handleIncomingYtState) window.handleIncomingYtState({ ...data, state: 'play' });
    }
    else if (data.action === 'yt_remove') {
        if (window.removeFromQueue) window.removeFromQueue(data.index, false);
    }
    else if (data.action === 'yt_sync' && (data.targetId === window.myId || !data.targetId)) {
        if (window.applyIncomingYtSync) window.applyIncomingYtSync(data);
    }
};

// 2. UI, SETTINGS & NETWORK SWITCHER ENGINE
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
    titleEl.innerText = `👥 Network Members (${userIds.length + 1})`; 
    
    const myName = document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'You';
    const myAvatar = localStorage.getItem('appAvatar') || window.defaultAvatar;
    const myCallBadge = window.inVoiceCall
        ? `<span style="font-size:10px; color:#10b981; font-weight:bold;">🎙️ In Call</span>`
        : `<span style="font-size:10px; color:var(--text-muted);">🎮 LAN Only</span>`;
    
    const localRow = document.createElement('div');
    localRow.className = 'user-card kokonut-card';
    localRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px;';
    localRow.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <img src="${myAvatar}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:2px solid var(--accent-main);">
            <div>
                <div style="font-size:13px; font-weight:bold; color: var(--accent-main);">${myName} (You) • ${myCallBadge}</div>
                <div style="font-size:10px; font-family:monospace; color:var(--text-muted); cursor:pointer;" onclick="navigator.clipboard.writeText('${window.myVirtualIp}')" title="Click to copy your LAN IP">🌐 ${window.myVirtualIp} 📋</div>
            </div>
        </div>`;
    listEl.appendChild(localRow);

    const activeCallNames = [];
    if (window.inVoiceCall) activeCallNames.push(`${myName} (You)`);

    userIds.forEach(uid => {
        const peerIp = window.peerIps[uid] || '10.66.0.x';
        const isPeerInCall = !!window.peerInCall[uid];
        if (isPeerInCall) activeCallNames.push(window.peerNames[uid]);

        const callBadge = isPeerInCall
            ? `<span style="font-size:10px; color:#10b981; font-weight:bold;">🎙️ In Call</span>`
            : `<span style="font-size:10px; color:var(--text-muted);">🎮 LAN Only</span>`;

        const row = document.createElement('div');
        row.className = 'user-card kokonut-card';
        row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px;';
        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${window.peerAvatars[uid] || window.defaultAvatar}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; border:1px solid ${isPeerInCall ? '#10b981' : 'var(--border-color)'};">
                <div>
                    <div style="font-size:13px; font-weight:bold;">${window.peerNames[uid]} • ${callBadge}</div>
                    <div style="font-size:10px; font-family:monospace; color:#10b981; cursor:pointer;" onclick="navigator.clipboard.writeText('${peerIp}')" title="Click to copy Friend's LAN IP">🌐 ${peerIp} 📋</div>
                </div>
            </div>
            <button class="icon-btn kokonut-btn btn-vol" data-uid="${uid}" style="font-size:16px;" title="Adjust Volume">🔊</button>`;
        listEl.appendChild(row);
    });

    let lobbyBanner = document.getElementById('call-lobby-banner');
    const actionRow = document.querySelector('#video-grid .action-row');
    if (actionRow && !lobbyBanner) {
        lobbyBanner = document.createElement('div');
        lobbyBanner.id = 'call-lobby-banner';
        lobbyBanner.style.cssText = 'font-size:12px; padding:8px 12px; border-radius:6px; background:rgba(0,0,0,0.35); border:1px solid var(--border-color); margin-bottom:10px;';
        actionRow.parentNode.insertBefore(lobbyBanner, actionRow.nextSibling);
    }
    if (lobbyBanner) {
        if (activeCallNames.length === 0) {
            lobbyBanner.innerHTML = `<span style="color:var(--text-muted);">🔇 Voice Channel is empty — LAN is active (${userIds.length + 1} online). Click <strong>Join Call</strong> anytime to talk!</span>`;
        } else {
            lobbyBanner.innerHTML = `<span style="color:#10b981; font-weight:bold;">🎙️ In Voice Channel (${activeCallNames.length}):</span> <span style="color:var(--text-main);">${activeCallNames.join(', ')}</span>`;
        }
    }
};

window.buildSidebarNetworkSwitcher = function() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('network-switcher-box')) return;

    const activeNet = JSON.parse(localStorage.getItem('conflictActiveNetwork') || '{"code":"ROOM","name":"Active Network"}');
    const savedNets = JSON.parse(localStorage.getItem('conflict_networks') || '[]');

    const netSection = document.createElement('div');
    netSection.id = 'network-switcher-box';
    netSection.className = 'sidebar-section';
    netSection.style.cssText = 'border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 10px; transition: opacity 0.2s;';

    let optionsHtml = '';
    savedNets.forEach(n => {
        const sel = (n.code === activeNet.code && n.name === activeNet.name) ? 'selected' : '';
        optionsHtml += `<option value="${n.code}|||${n.name}" ${sel}>🌐 ${n.name} (${n.code})</option>`;
    });

    netSection.innerHTML = `
        <h4 style="margin-bottom:6px;">Active Network</h4>
        <select id="quick-network-select" class="config-select kokonut-select" style="width:100%; margin-bottom:6px; font-weight:bold; font-size:12px; border-color:var(--border-color) !important; box-shadow:none !important; outline:none !important;">
            ${optionsHtml}
        </select>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted); background:rgba(0,0,0,0.35); border:1px solid var(--border-color); padding:6px 8px; border-radius:6px; cursor:pointer;" id="copy-net-code-btn" title="Click to copy Network Name & Code for friends">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Invite: <strong style="color:var(--text-main);">${activeNet.name}</strong> (<span style="color:var(--accent-main); font-family:monospace;">${activeNet.code}</span>)</span>
            <span style="flex-shrink:0; margin-left:6px;">📋 Copy</span>
        </div>
    `;

    const firstSection = sidebar.querySelector('.sidebar-section');
    sidebar.insertBefore(netSection, firstSection);

    document.getElementById('copy-net-code-btn')?.addEventListener('click', (e) => {
        navigator.clipboard.writeText(`${activeNet.name} | ${activeNet.code}`);
        const el = e.currentTarget;
        const old = el.innerHTML;
        el.innerHTML = `<span style="color:#10b981; font-weight:bold;">✓ Copied "${activeNet.name} | ${activeNet.code}"!</span>`;
        setTimeout(() => { el.innerHTML = old; }, 1800);
    });

    document.getElementById('quick-network-select')?.addEventListener('change', (e) => {
        e.target.blur();
        const [newCode, newName] = e.target.value.split('|||');
        const targetNet = savedNets.find(n => n.code === newCode && n.name === newName) || { code: newCode, name: newName };
        if (!targetNet || !window.ipcRenderer) return;
        localStorage.setItem('conflictActiveNetwork', JSON.stringify(targetNet));
        window.ipcRenderer.send('connect-network', {
            roomCode: targetNet.code,
            roomName: targetNet.name,
            hostName: localStorage.getItem('appUsername') || 'Player',
            userId: window.myId
        });
        setTimeout(() => window.location.reload(), 150);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    window.buildSidebarNetworkSwitcher();
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
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioIn  = document.getElementById('audio-in-select');
            const audioOut = document.getElementById('audio-out-select');
            const videoIn  = document.getElementById('video-in-select');
            if (audioIn)  audioIn.innerHTML  = '';
            if (audioOut) audioOut.innerHTML = '';
            if (videoIn)  videoIn.innerHTML  = '';

            devices.forEach(device => {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.text = device.label || `${device.kind} (${device.deviceId.slice(0,5) || 'default'}…)`;
                if (device.kind === 'audioinput' && audioIn)  audioIn.appendChild(opt);
                else if (device.kind === 'audiooutput' && audioOut) audioOut.appendChild(opt);
                else if (device.kind === 'videoinput' && videoIn)   videoIn.appendChild(opt);
            });

            const restore = (el, key) => {
                const saved = localStorage.getItem(key);
                if (el && saved && Array.from(el.options).some(o => o.value === saved)) el.value = saved;
            };
            restore(audioIn, 'appAudioIn');
            restore(audioOut, 'appAudioOut');
            restore(videoIn, 'appVideoIn');
        } catch (e) {
            console.error("loadDevices failed:", e);
        }
    }

    const configView = document.getElementById('config-view');
    document.getElementById('settings-btn')?.addEventListener('click', () => { 
        if (configView) {
            configView.style.display = configView.style.display === 'none' ? 'block' : 'none'; 
            if (configView.style.display === 'block') loadDevices(); 
        }
    });
    document.getElementById('refresh-devices-btn')?.addEventListener('click', loadDevices);

    const startupToggle = document.getElementById('startup-toggle');
    if (startupToggle) {
        startupToggle.checked = localStorage.getItem('appStartup') === 'true';
        startupToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem('appStartup', isEnabled);
            if (window.ipcRenderer) window.ipcRenderer.send('toggle-startup', isEnabled);
        });
    }

    document.getElementById('save-theme-btn')?.addEventListener('click', () => {
        const newName = document.getElementById('username-input')?.value.trim();
        if (newName) {
            const dispName = document.getElementById('display-username');
            if(dispName) dispName.textContent = newName; 
            localStorage.setItem('appUsername', newName);
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                window.socket.send(JSON.stringify({
                    action: 'presence',
                    targetId: null,
                    userId: window.myId,
                    username: newName,
                    virtualIp: window.myVirtualIp,
                    inCall: window.inVoiceCall
                }));
            }
        }

        const audioIn = document.getElementById('audio-in-select')?.value; 
        const audioOut = document.getElementById('audio-out-select')?.value; 
        const videoIn = document.getElementById('video-in-select')?.value;
        if (audioIn) localStorage.setItem('appAudioIn', audioIn); 
        if (audioOut) localStorage.setItem('appAudioOut', audioOut); 
        if (videoIn) localStorage.setItem('appVideoIn', videoIn);
        
        const gateVal = document.getElementById('noise-gate-slider')?.value;
        if (gateVal) localStorage.setItem('appNoiseGate', gateVal);

        const bg = document.getElementById('color-bg')?.value || '#050a06'; 
        const panel = document.getElementById('color-panel')?.value || '#0a140c'; 
        const text = document.getElementById('color-text')?.value || '#e2e8f0'; 
        const accent = document.getElementById('color-accent')?.value || '#10b981';
        
        let r = parseInt(panel.slice(1, 3), 16), g = parseInt(panel.slice(3, 5), 16), b = parseInt(panel.slice(5, 7), 16);
        const glassPanel = `rgba(${r || 10}, ${g || 20}, ${b || 12}, 0.92)`;

        document.documentElement.style.setProperty('--bg-color', bg); 
        document.documentElement.style.setProperty('--panel-bg', glassPanel); 
        document.documentElement.style.setProperty('--text-main', text); 
        document.documentElement.style.setProperty('--accent-main', accent);
        
        localStorage.setItem('themeBg', bg); 
        localStorage.setItem('themePanel', panel);
        localStorage.setItem('themeText', text); 
        localStorage.setItem('themeAccent', accent);

        if (configView) configView.style.display = 'none';

        (async () => {
            if (window.localMicStream && audioIn) {
                try {
                    localStorage.setItem('appAudioIn', audioIn);
                    await window.rebuildMicPipeline();
                    if (window.addChatLine) window.addChatLine('System', '🎙️ Microphone switched (suppression preserved).', 'system');
                } catch (err) {
                    console.warn("Mic rebuild failed:", err);
                }
            }

            if (window.localCamStream && videoIn) {
                try {
                    const oldCamTrack = window.localCamStream.getVideoTracks()[0];
                    const newCam = await navigator.mediaDevices.getUserMedia({
                        video: { deviceId: { ideal: videoIn } }
                    });
                    const newTrack = newCam.getVideoTracks()[0];
                    Object.values(window.peers).forEach(pc => {
                        const sender = pc.getSenders().find(s => s.track === oldCamTrack);
                        if (sender) sender.replaceTrack(newTrack);
                    });
                    window.localCamStream.getTracks().forEach(t => t.stop());
                    window.localCamStream = newCam;
                    const localCam = document.getElementById('local-cam-video');
                    if (localCam) localCam.srcObject = newCam;
                } catch (err) { console.warn("Cam swap failed:", err); }
            }

            if (audioOut) {
                document.querySelectorAll('[id^="audio-"]').forEach(a => {
                    if (typeof a.setSinkId === 'function') a.setSinkId(audioOut).catch(()=>{});
                });
            }
        })();
    });

    document.getElementById('reset-theme-btn')?.addEventListener('click', () => {
        document.documentElement.style.setProperty('--bg-color', '#050a06'); 
        document.documentElement.style.setProperty('--panel-bg', 'rgba(10, 20, 12, 0.92)'); 
        document.documentElement.style.setProperty('--text-main', '#e2e8f0'); 
        document.documentElement.style.setProperty('--accent-main', '#10b981');
        localStorage.removeItem('themeBg'); 
        localStorage.removeItem('themePanel'); 
        localStorage.removeItem('themeText'); 
        localStorage.removeItem('themeAccent');
        
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
            const savedVol = document.getElementById(`vol-${activeVolUid}`)?.value;
            const currentVol = savedVol !== undefined ? parseFloat(savedVol) : 1.0;
            if (uvName) uvName.innerText = `${window.peerNames[activeVolUid]}: ${Math.round(currentVol * 100)}%`;
            if (volSlider) volSlider.value = currentVol;
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
        const uvName = document.getElementById('uv-name');
        if (uvName) uvName.innerText = `${window.peerNames[activeVolUid]}: ${Math.round(vol * 100)}%`;

        if (window.remoteGainNodes && window.remoteGainNodes[activeVolUid] && window.audioCtx) {
            window.remoteGainNodes[activeVolUid].gain.setTargetAtTime(vol, window.audioCtx.currentTime, 0.01);
        }
        if (window.remoteAudioEls && window.remoteAudioEls[activeVolUid]) {
            window.remoteAudioEls[activeVolUid].volume = Math.min(1.0, vol);
        }

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
        window.location.href = 'index.html'; 
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
    
    const savedGate = localStorage.getItem('appNoiseGate');
    const gateSlider = document.getElementById('noise-gate-slider');
    if (savedGate && gateSlider) gateSlider.value = savedGate;

    const savedBg = localStorage.getItem('themeBg') || '#050a06'; 
    const savedPanel = localStorage.getItem('themePanel') || '#0a140c'; 
    const savedText = localStorage.getItem('themeText') || '#e2e8f0'; 
    const savedAccent = localStorage.getItem('themeAccent') || '#10b981'; 

    const bgInp = document.getElementById('color-bg'); if(bgInp) bgInp.value = savedBg;
    const pInp = document.getElementById('color-panel'); if(pInp) pInp.value = savedPanel;
    const tInp = document.getElementById('color-text'); if(tInp) tInp.value = savedText;
    const aInp = document.getElementById('color-accent'); if(aInp) aInp.value = savedAccent;

    let pr = parseInt(savedPanel.slice(1, 3), 16), pg = parseInt(savedPanel.slice(3, 5), 16), pb = parseInt(savedPanel.slice(5, 7), 16);
    const glassPanelInit = `rgba(${pr || 10}, ${pg || 20}, ${pb || 12}, 0.92)`;

    document.documentElement.style.setProperty('--bg-color', savedBg);
    document.documentElement.style.setProperty('--panel-bg', glassPanelInit);
    document.documentElement.style.setProperty('--text-main', savedText);
    document.documentElement.style.setProperty('--accent-main', savedAccent);
});