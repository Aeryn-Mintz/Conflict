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
window.peerNames = {}; 
window.peerAvatars = {};

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

window.renderConnectedUsers = function() {
    const list = document.getElementById('connected-users-list');
    if (!list) return;
    list.innerHTML = '';
    
    const myName = localStorage.getItem('appUsername') || 'You';
    const myAvatar = localStorage.getItem('appAvatar') || window.defaultAvatar;
    
    const createCard = (uid, name, avatar, isMe) => {
        const card = document.createElement('div');
        card.className = 'user-card kokonut-card';
        card.style = 'padding: 8px; width: auto; min-width: unset; display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer;';
        card.innerHTML = `
            <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--accent-main);">
            <span style="font-size: 13px; font-weight: bold; color: var(--text-main);">${name} ${isMe ? '<span style="color:var(--text-muted); font-size: 11px;">(You)</span>' : ''}</span>
        `;
        
        if (!isMe) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                const menu = document.getElementById('user-volume-context-menu');
                const slider = document.getElementById('uv-slider');
                const nameLabel = document.getElementById('uv-name');

                nameLabel.textContent = `${name}'s Volume`;
                
                const audioTracks = document.querySelectorAll(`audio.stream-${uid}`);
                slider.value = audioTracks.length > 0 ? audioTracks[0].volume : 0.8;

                slider.oninput = (ev) => {
                    const val = parseFloat(ev.target.value);
                    document.querySelectorAll(`.stream-${uid}`).forEach(el => {
                        if (typeof el.volume !== 'undefined') el.volume = val;
                    });
                };

                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                menu.style.display = 'flex';
            });
        }
        return card;
    };
    
    list.appendChild(createCard(window.myId, myName, myAvatar, true));
    
    Object.keys(window.peerNames).forEach(uid => {
        list.appendChild(createCard(uid, window.peerNames[uid] || 'Guest', window.peerAvatars[uid] || window.defaultAvatar, false));
    });
};

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

function connectSocket() {
    window.socket = new WebSocket(window.serverUrl);
    
    window.saveConnectedRoom = function(ip) {
        let history = JSON.parse(localStorage.getItem('conflictRecentRooms') || '[]');
        if (!history.includes(ip) && ip !== 'localhost') { history.unshift(ip); localStorage.setItem('conflictRecentRooms', JSON.stringify(history.slice(0, 5))); }
    };
    
    const urlIP = window.serverUrl.replace('ws://', '').replace('wss://', '').split(':')[0].split('/')[0];
    window.saveConnectedRoom(urlIP);

    window.socket.onopen = () => {
        window.reconnectAttempts = 0; clearTimeout(window.reconnectTimer);
        const chatInput = document.getElementById('chat-input');
        if(chatInput) { chatInput.disabled = false; chatInput.placeholder = '🟢 Connected!'; }
        if (window.saveCharacterSheet && document.getElementById('rpg-system-select')) window.saveCharacterSheet(document.getElementById('rpg-system-select').value);
        
        // Announce self to room on initial connection
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ 
                action: 'join', 
                userId: window.myId, 
                username: document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'Guest', 
                avatar: localStorage.getItem('appAvatar') || window.defaultAvatar 
            }));
        }
        window.renderConnectedUsers();
    };
    
    window.socket.onclose = (event) => {
        window.reconnectAttempts++; const delaySec = Math.min(30, Math.pow(2, window.reconnectAttempts));
        const chatInput = document.getElementById('chat-input');
        if(chatInput) { chatInput.placeholder = `🟡 Connection lost. Retrying in ${delaySec}s...`; chatInput.disabled = true; }
        window.reconnectTimer = setTimeout(connectSocket, delaySec * 1000);
    };

    window.socket.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // WebRTC media routing
            if (['join', 'offer', 'answer', 'ice-candidate', 'remove_video'].includes(data.action)) {
                if (window.handleWebRTCSignal) window.handleWebRTCSignal(data);
            }

            // NEWCOMER JOINED: Save their info AND reply with our own presence
            if (data.action === 'join' && data.userId !== window.myId) {
                window.peerNames[data.userId] = data.username || "Guest"; 
                window.peerAvatars[data.userId] = data.avatar || window.defaultAvatar;
                window.renderConnectedUsers();

                // Reply specifically to the newcomer so they see us in their list
                if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                    window.socket.send(JSON.stringify({
                        action: 'presence',
                        targetId: data.userId,
                        userId: window.myId,
                        username: document.getElementById('display-username')?.textContent || localStorage.getItem('appUsername') || 'Guest',
                        avatar: localStorage.getItem('appAvatar') || window.defaultAvatar
                    }));
                }

                if (window.isDM) window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: document.getElementById('rpg-system-select').value }));
            }
            // PRESENCE ACK: Received existing user data
            else if (data.action === 'presence' && (data.targetId === window.myId || !data.targetId)) {
                window.peerNames[data.userId] = data.username || "Guest";
                window.peerAvatars[data.userId] = data.avatar || window.defaultAvatar;
                window.renderConnectedUsers();
            }
            // PEER LEFT: Cleanly remove them from the list and DOM
            else if (data.action === 'leave') {
                delete window.peerNames[data.userId];
                delete window.peerAvatars[data.userId];
                if (window.peers && window.peers[data.userId]) {
                    window.peers[data.userId].close();
                    delete window.peers[data.userId];
                }
                document.querySelectorAll(`.stream-${data.userId}`).forEach(el => el.remove());
                window.renderConnectedUsers();
            }
            else if (data.action === 'profile_update' && data.userId !== window.myId) {
                window.peerNames[data.userId] = data.username;
                window.peerAvatars[data.userId] = data.avatar;
                window.renderConnectedUsers();
            }

            // VTT, RPG, and Chat actions
            else if (data.action === 'set_campaign_system' && window.applyCampaignSystem) { window.applyCampaignSystem(data.system, false); if(window.addChatLine) window.addChatLine('System', `👑 The DM set the campaign system to **${data.system.toUpperCase()}**.`, true); }
            else if (data.action === 'toggle_fog' && data.userId !== window.myId) { const fog = document.getElementById('fog-canvas'); if (fog) { fog.style.display = data.enabled ? 'block' : 'none'; if (data.enabled && window.fogCtx) { window.fogCtx.fillStyle = '#000000'; window.fogCtx.fillRect(0, 0, fog.width, fog.height); } } }
            else if (data.action === 'fog_reveal' && data.userId !== window.myId && window.fogCtx) { window.fogCtx.globalCompositeOperation = 'destination-out'; window.fogCtx.beginPath(); window.fogCtx.moveTo(data.x0, data.y0); window.fogCtx.lineTo(data.x1, data.y1); window.fogCtx.lineWidth = data.width; window.fogCtx.lineCap = 'round'; window.fogCtx.lineJoin = 'round'; window.fogCtx.stroke(); window.fogCtx.globalCompositeOperation = 'source-over'; }
            else if (data.action === 'request_sheets' && window.saveCharacterSheet) window.saveCharacterSheet(document.getElementById('rpg-system-select').value);
            else if (data.action === 'sheet_update') { window.partySheets[data.userId] = { username: data.username, system: data.system, charName: data.charName, data: data.data, portrait: data.portrait }; if (window.isDM && window.viewingParty) { if (document.getElementById('party-list-grid') && window.renderPartyList) window.renderPartyList(); if (window.viewingRemoteUid === data.userId && window.renderRemoteSheet) window.renderRemoteSheet(data.userId); } }
            else if (data.action === 'set_map_bg') { if (window.setMapBackground) window.setMapBackground(data.image, data.w, data.h); }
            else if (data.action === 'claim_dm') { if(window.addChatLine) window.addChatLine('System', `👑 ${data.username} is now the Dungeon Master.`, true); const dmBtn = document.getElementById('claim-dm-btn'); if (data.userId !== window.myId && dmBtn) { dmBtn.innerText = `👑 DM: ${data.username}`; dmBtn.disabled = true; dmBtn.style.borderColor = "var(--border-color)"; dmBtn.style.color = "var(--text-muted)"; } }
            else if (data.action === 'release_dm') { if(window.addChatLine) window.addChatLine('System', `👑 The Dungeon Master role is now open.`, true); const dmBtn = document.getElementById('claim-dm-btn'); if(dmBtn) { dmBtn.innerText = `👑 Claim DM`; dmBtn.disabled = false; dmBtn.style.borderColor = "#fbbf24"; dmBtn.style.color = "#fbbf24"; } }
            else if (data.action === 'chat_message') { if(window.addChatLine) window.addChatLine(data.username || 'Guest', data.text || ''); }
            else if (data.action === 'dice_roll' && data.userId !== window.myId && window.animateDiceRoll2D) { let mainSide = 20; if (Array.isArray(data.type)) { mainSide = parseInt(data.type[0].replace(/\D/g, '')) || 20; } else if (typeof data.type === 'string') { mainSide = parseInt(data.type.replace(/\D/g, '')) || 20; } window.animateDiceRoll2D(data.results, data.type, data.customClasses); if (data.results.includes(mainSide) && window.triggerFireworks) window.triggerFireworks(); }
            else if (data.action === 'token_add' && data.userId !== window.myId && window.placeTokenOnMap) window.placeTokenOnMap(data.token, false);
            else if (data.action === 'token_move' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.left = data.x + 'px'; el.style.top = data.y + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].x = data.x; window.mapAssets[data.tokenId].y = data.y; } } }
            else if (data.action === 'token_resize' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.width = data.w + 'px'; el.style.height = data.h + 'px'; if(window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].w = data.w; window.mapAssets[data.tokenId].h = data.h; } } }
            else if (data.action === 'token_zindex' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) { el.style.zIndex = data.z; if(window.mapAssets && window.mapAssets[data.tokenId]) window.mapAssets[data.tokenId].z = data.z; } }
            else if (data.action === 'token_hide' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el && window.mapAssets && window.mapAssets[data.tokenId]) { window.mapAssets[data.tokenId].hidden = data.hidden; if (window.applyVisibility) window.applyVisibility(el, data.hidden); } }
            else if (data.action === 'tokens_clear' && data.userId !== window.myId) { document.getElementById('token-layer').innerHTML = ''; if (window.mapAssets) window.mapAssets = {}; }
            else if (data.action === 'token_remove' && data.userId !== window.myId) { const el = document.getElementById('map-token-' + data.tokenId); if (el) el.remove(); if(window.mapAssets) delete window.mapAssets[data.tokenId]; }
            else if (data.action === 'canvas_draw' && data.userId !== window.myId && window.remoteDraw) window.remoteDraw(data);
            else if (data.action === 'canvas_clear' && data.userId !== window.myId && window.ctx) window.ctx.clearRect(0, 0, 8000, 8000);
            else if (data.action === 'yt_load') { window.ytQueue.unshift({ id: data.videoId }); if(window.loadAndPlayVideo) window.loadAndPlayVideo(data.videoId, 0); }
            else if (data.action === 'yt_queue_add') { window.ytQueue.push({ id: data.videoId }); if(window.renderQueueUI) window.renderQueueUI(); }
            else if (data.action === 'yt_skip' || data.action === 'yt_jump') { window.currentQueueIndex = data.action === 'yt_jump' ? data.index : window.currentQueueIndex + 1; if (window.ytQueue[window.currentQueueIndex] && window.loadAndPlayVideo) window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); }
            else if (data.action === 'yt_pause') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PAUSED) window.ytPlayer.pauseVideo(); }
            else if (data.action === 'yt_play') { if (window.ytPlayer && window.ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) window.ytPlayer.playVideo(); }
        } catch (e) {}
    };
}
connectSocket();
setInterval(() => { if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'keep_alive' })); }, 10000);

// Notify other peers upon window closing
window.addEventListener('beforeunload', () => {
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'leave', userId: window.myId }));
    }
});

window.defaultTheme = { bg: '#050a06', panel: 'rgba(13, 26, 16, 0.75)', text: '#ecfdf5', accent: '#10b981' };

function loadTheme() {
    let savedTheme = JSON.parse(localStorage.getItem('appTheme'));
    if (!savedTheme || !savedTheme.bg) savedTheme = window.defaultTheme;
    
    document.documentElement.style.setProperty('--bg-base', savedTheme.bg); 
    document.documentElement.style.setProperty('--panel-bg', savedTheme.panel); 
    document.documentElement.style.setProperty('--text-main', savedTheme.text); 
    document.documentElement.style.setProperty('--accent-main', savedTheme.accent); 

    const cb = document.getElementById('color-bg'); if(cb) cb.value = savedTheme.bg;
    const cp = document.getElementById('color-panel'); if(cp) cp.value = savedTheme.panel.startsWith('rgba') ? '#0c1a10' : savedTheme.panel; 
    const ct = document.getElementById('color-text'); if(ct) ct.value = savedTheme.text;
    const ca = document.getElementById('color-accent'); if(ca) ca.value = savedTheme.accent;
}
loadTheme();

if (window.coreClickHandler) document.removeEventListener('click', window.coreClickHandler);
window.coreClickHandler = (e) => {
    const contextMenu = document.getElementById('user-volume-context-menu');
    if (contextMenu && !contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
    }
    
    if (e.target.closest('#connected-users-btn')) {
        const panel = document.getElementById('connected-users-panel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
            if (panel.style.display === 'flex') window.renderConnectedUsers();
        }
        return;
    }

    if (e.target.closest('#collapse-vtt-toolbar-btn')) {
        const tb = document.getElementById('vtt-main-toolbar');
        const expandBtn = document.getElementById('expand-vtt-toolbar-btn');
        if (tb && expandBtn) {
            tb.style.opacity = '0';
            tb.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                tb.style.display = 'none';
                expandBtn.style.display = 'block';
            }, 300);
        }
        return;
    }

    if (e.target.closest('#expand-vtt-toolbar-btn')) {
        const tb = document.getElementById('vtt-main-toolbar');
        const expandBtn = document.getElementById('expand-vtt-toolbar-btn');
        if (tb && expandBtn) {
            expandBtn.style.display = 'none';
            tb.style.display = 'flex';
            setTimeout(() => {
                tb.style.opacity = '1';
                tb.style.transform = 'translateY(0)';
            }, 10);
        }
        return;
    }

    if (e.target.closest('#settings-btn')) {
        const configView = document.getElementById('config-view');
        if (!configView) return;
        if (configView.style.display === 'none' || !configView.style.display) {
            configView.style.display = 'flex'; 
            document.querySelectorAll('.floating-panel').forEach(p => p.style.zIndex = 50); 
            configView.style.zIndex = 51;
            if (configView.style.left === '50%') configView.style.left = `calc(50% - 375px)`;
            if(typeof anime !== 'undefined') anime({ targets: configView, opacity: [0, 1], translateY: [20, 0], scale: [0.95, 1], duration: 400, easing: 'easeOutQuart' });
        } else {
            if(typeof anime !== 'undefined') anime({ targets: configView, opacity: [1, 0], translateY: [0, 20], scale: [1, 0.95], duration: 200, easing: 'easeInQuart', complete: () => configView.style.display = 'none' });
            else configView.style.display = 'none';
        }
        return;
    }
    
    if (e.target.closest('#save-theme-btn')) {
        const newTheme = {
            bg: document.getElementById('color-bg').value, 
            panel: document.getElementById('color-panel').value, 
            text: document.getElementById('color-text').value, 
            accent: document.getElementById('color-accent').value 
        };
        const username = document.getElementById('username-input').value.trim();
        localStorage.setItem('appUsername', username);
        localStorage.setItem('appTheme', JSON.stringify(newTheme));

        const audioIn = document.getElementById('audio-in-select');
        if (audioIn) localStorage.setItem('appAudioIn', audioIn.value);

        const audioOut = document.getElementById('audio-out-select');
        if (audioOut) localStorage.setItem('appAudioOut', audioOut.value);

        const videoIn = document.getElementById('video-in-select');
        if (videoIn) localStorage.setItem('appVideoIn', videoIn.value);

        loadTheme(); 
        
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ 
                action: 'profile_update', 
                userId: window.myId, 
                username: username, 
                avatar: localStorage.getItem('appAvatar') || window.defaultAvatar 
            }));
        }
        window.renderConnectedUsers();

        const configView = document.getElementById('config-view');
        if (configView) {
            if(typeof anime !== 'undefined') anime({ targets: configView, opacity: [1, 0], translateY: [0, 20], scale: [1, 0.95], duration: 200, easing: 'easeInQuart', complete: () => configView.style.display = 'none' });
            else configView.style.display = 'none';
        }
        return;
    }
    if (e.target.closest('#reset-theme-btn')) { localStorage.setItem('appTheme', JSON.stringify(window.defaultTheme)); loadTheme(); return; }
    if (e.target.closest('#leave-room-btn')) { 
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'leave', userId: window.myId }));
            window.socket.close(); 
        }
        window.location.href = 'index.html'; 
    }
};
document.addEventListener('click', window.coreClickHandler);

if (window.coreInputHandler) document.removeEventListener('input', window.coreInputHandler);
window.coreInputHandler = (e) => {
    if (e.target.id === 'username-input') { const dUser = document.getElementById('display-username'); if (dUser) dUser.textContent = e.target.value.trim() || 'You'; }
};
document.addEventListener('input', window.coreInputHandler);

function initCore() {
    const savedName = localStorage.getItem('appUsername') || 'You';
    const ui = document.getElementById('username-input'); if(ui) ui.value = savedName === 'You' ? '' : savedName;
    const du = document.getElementById('display-username'); if(du) du.textContent = savedName;
    const savedAvatar = localStorage.getItem('appAvatar');
    if (savedAvatar) { document.getElementById('config-avatar-preview').src = savedAvatar; document.getElementById('user-avatar').src = savedAvatar; }
    if (window.populateDevices) window.populateDevices();

    const isHost = localStorage.getItem('conflictServerUrl') === 'ws://localhost:8080';
    if (isHost) {
        const sidebar = document.querySelector('.sidebar');
        const shareCode = localStorage.getItem('conflictShareCode');
        let radminIp = '127.0.0.1';
        if (window.os) {
            const interfaces = window.os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        if (iface.address.startsWith('26.')) radminIp = iface.address;
                        else if (radminIp === '127.0.0.1') radminIp = iface.address;
                    }
                }
            }
        }
        if (sidebar && !document.querySelector('.room-info-box')) {
            const infoBox = document.createElement('div');
            infoBox.className = "room-info-box";
            infoBox.style = "margin-top: auto; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); border-radius: 8px; text-align: center; margin-bottom: 10px;";
            let html = '';
            if (shareCode) html += `<div style="margin-bottom: 8px;"><span style="font-size: 9px; color: var(--text-muted); text-transform: uppercase;">Global Share Code</span><br><strong style="font-size: 16px; color: var(--accent-main); letter-spacing: 2px; user-select: text;">${shareCode}</strong></div>`;
            html += `<div><span style="font-size: 9px; color: var(--text-muted); text-transform: uppercase;">Direct LAN/Radmin IP</span><br><span style="font-size: 12px; color: var(--text-main); user-select: text;">${radminIp}</span></div>`;
            infoBox.innerHTML = html;
            sidebar.appendChild(infoBox);
        }
    }

    if (window.ipcRenderer) {
        const startupToggle = document.getElementById('startup-toggle');
        if (startupToggle) {
            startupToggle.checked = localStorage.getItem('conflictStartup') === 'true';
            startupToggle.onchange = (e) => { const isChecked = e.target.checked; localStorage.setItem('conflictStartup', isChecked); window.ipcRenderer.send('toggle-startup', isChecked); };
        }
    }
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initCore); } else { initCore(); }