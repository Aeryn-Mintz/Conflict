// ==========================================
// EXTERNAL MEDIA ENGINE (YouTube & Soundboard)
// ==========================================

window.ytPlayer = null; window.pendingYtVideoId = null; window.ytQueue = []; window.currentQueueIndex = -1;
function extractYouTubeId(url) {
    if (!url) return null;
    try {
        const u = new URL(url.trim()); const host = u.hostname.replace(/^www\./, '').replace(/^m\./, ''); let id = null;
        if (host === 'youtu.be') id = u.pathname.split('/')[1];
        else if (host === 'youtube.com' || host === 'music.youtube.com') { if (u.pathname === '/watch') id = u.searchParams.get('v'); else { const match = u.pathname.match(/^\/(embed|shorts|live)\/([^\/]+)/); if (match) id = match[2]; } }
        return (id && /^[A-Za-z0-9_-]{11}$/.test(id)) ? id : null;
    } catch (e) { return null; }
}
window.ytApiTag = document.createElement('script'); window.ytApiTag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(window.ytApiTag);
window.onYouTubeIframeAPIReady = function () {
    window.ytPlayer = new YT.Player('yt-iframe', { 
        height: '100%', width: '100%', 
        playerVars: { autoplay: 1, origin: window.location.origin }, 
        events: {
            onReady: () => { if (window.pendingYtVideoId) { window.loadAndPlayVideo(window.pendingYtVideoId); window.pendingYtVideoId = null; } },
            onStateChange: (event) => { if (event.data === YT.PlayerState.ENDED) window.playNextInQueue(); },
            onError: () => { if(window.addChatLine) window.addChatLine('System', "⚠️ This video is blocked from playing in embedded players by its owner.", 'system'); window.playNextInQueue(); }
        }
    });
};

window.loadAndPlayVideo = function(videoId, index = -1) {
    if (!videoId) return;
    document.getElementById('yt-wrapper').style.display = 'block'; if (index !== -1) window.currentQueueIndex = index;
    if (window.ytPlayer && typeof window.ytPlayer.loadVideoById === 'function') window.ytPlayer.loadVideoById(videoId); else window.pendingYtVideoId = videoId;
    window.renderQueueUI();
};

window.queueVideo = async function(videoId, broadcast = true, title = null) {
    if (!videoId) return;
    let vidTitle = title;
    
    if (!vidTitle) {
        try {
            const res = await fetch(`https://noembed.com/embed?dataType=json&url=https://www.youtube.com/watch?v=${videoId}`);
            const data = await res.json();
            vidTitle = data.title && !data.error ? data.title : `Video (${videoId})`;
        } catch(e) { vidTitle = `Video (${videoId})`; }
    }

    window.ytQueue.push({ id: videoId, title: vidTitle });
    if (window.currentQueueIndex === -1) window.playNextInQueue(); else window.renderQueueUI();
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'yt_queue_add', videoId: videoId, title: vidTitle }));
    }
};

window.playNextInQueue = function() { 
    if (window.ytQueue.length === 0) return; 
    window.currentQueueIndex++; 
    if (window.currentQueueIndex >= window.ytQueue.length) window.currentQueueIndex = 0; 
    window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); 
};

window.renderQueueUI = function() {
    const listEl = document.getElementById('yt-queue-list'); const countEl = document.getElementById('queue-count');
    if (!listEl) return;
    listEl.innerHTML = ''; countEl.innerText = `${window.ytQueue.length} items`;
    
    window.ytQueue.forEach((item, index) => {
        const row = document.createElement('div'); row.className = index === window.currentQueueIndex ? 'yt-queue-item active-queue-item' : 'yt-queue-item';
        row.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; display: inline-block; vertical-align: middle;" title="${item.title}">${index + 1}. ${item.title}</span><div class="yt-queue-controls"><button class="yt-queue-btn" onclick="window.jumpToQueue(${index})" title="Play Now">▶️</button><button class="yt-queue-btn" onclick="window.removeFromQueue(${index}, true)" title="Remove">✕</button></div>`;
        listEl.appendChild(row);
    });

    localStorage.setItem('conflict_yt_recent_queue', JSON.stringify({ queue: window.ytQueue, index: window.currentQueueIndex }));
};

window.jumpToQueue = function(index) { 
    window.currentQueueIndex = index; 
    window.loadAndPlayVideo(window.ytQueue[index].id, index); 
    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_jump', index: index })); 
};

window.removeFromQueue = function(index, broadcast = true) { 
    window.ytQueue.splice(index, 1); 
    if (index === window.currentQueueIndex) window.playNextInQueue(); 
    else if (index < window.currentQueueIndex) window.currentQueueIndex--; 
    
    if (window.ytQueue.length === 0) window.currentQueueIndex = -1;
    
    window.renderQueueUI(); 
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'yt_remove', index: index }));
    }
};

window.saveYtPlaylist = function() {
    const name = prompt("Name this Playlist to save it:");
    if (!name) return;
    const playlists = JSON.parse(localStorage.getItem('conflict_yt_playlists') || '{}');
    playlists[name] = window.ytQueue;
    localStorage.setItem('conflict_yt_playlists', JSON.stringify(playlists));
    if(window.addChatLine) window.addChatLine('System', `💾 Playlist **${name}** saved to your vault!`, 'system');
};

window.loadYtPlaylist = function() {
    const playlists = JSON.parse(localStorage.getItem('conflict_yt_playlists') || '{}');
    const names = Object.keys(playlists);
    if (names.length === 0) return alert("You have no saved playlists.");
    
    const name = prompt("Which playlist do you want to load?\nAvailable: " + names.join(", "));
    if (playlists[name]) {
        window.ytQueue = playlists[name];
        window.currentQueueIndex = -1;
        window.renderQueueUI();
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'yt_sync', queue: window.ytQueue, index: window.currentQueueIndex }));
        }
        if(window.addChatLine) window.addChatLine('System', `📂 Playlist **${name}** loaded and synced to the table!`, 'system');
        window.playNextInQueue();
    } else if (name) alert("Playlist not found.");
};

window.loadRecentQueue = function() {
    const recent = JSON.parse(localStorage.getItem('conflict_yt_recent_queue') || 'null');
    if (!recent || !recent.queue || recent.queue.length === 0) return alert("No recent queue found.");
    
    window.ytQueue = recent.queue;
    window.currentQueueIndex = recent.index;
    window.renderQueueUI();
    
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'yt_sync', queue: window.ytQueue, index: window.currentQueueIndex }));
    }
    
    if (window.currentQueueIndex >= 0 && window.ytQueue[window.currentQueueIndex]) {
        window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex);
    } else {
        window.playNextInQueue();
    }
    if(window.addChatLine) window.addChatLine('System', `🔄 Most recent session queue restored!`, 'system');
};

document.getElementById('yt-queue-add-btn')?.addEventListener('click', () => { const vidId = extractYouTubeId(document.getElementById('yt-url-input').value); if (vidId) { window.queueVideo(vidId, true); document.getElementById('yt-url-input').value = ''; if(window.addChatLine) window.addChatLine('System', `➕ Added video to queue`, 'system'); } else alert("Invalid Link!"); });
document.getElementById('yt-play-btn')?.addEventListener('click', async () => { 
    const vidId = extractYouTubeId(document.getElementById('yt-url-input').value); 
    if (vidId) { 
        let vidTitle = `Video (${vidId})`;
        try {
            const res = await fetch(`https://noembed.com/embed?dataType=json&url=https://www.youtube.com/watch?v=${vidId}`);
            const data = await res.json();
            vidTitle = data.title && !data.error ? data.title : vidTitle;
        } catch(e) {}
        
        window.ytQueue.unshift({ id: vidId, title: vidTitle }); 
        window.loadAndPlayVideo(vidId, 0); 
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_load', videoId: vidId, title: vidTitle })); 
        document.getElementById('yt-url-input').value = ''; 
    } else alert("Invalid Link!"); 
});
document.getElementById('yt-skip-btn')?.addEventListener('click', () => { window.playNextInQueue(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_skip' })); });
document.getElementById('toggle-queue-btn')?.addEventListener('click', () => { const drawer = document.getElementById('drag-yt-queue'); drawer.style.display = (drawer.style.display === 'none' || drawer.style.display === '') ? 'block' : 'none'; });

document.getElementById('yt-playpause-btn')?.addEventListener('click', () => { if (!window.ytPlayer || typeof window.ytPlayer.getPlayerState !== 'function') return; if (window.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) { window.ytPlayer.pauseVideo(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_pause' })); } else { window.ytPlayer.playVideo(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_play' })); } });

document.getElementById('toggle-yt-view')?.addEventListener('click', () => { const wrapper = document.getElementById('yt-wrapper'); wrapper.style.display = (wrapper.style.display === 'none' || wrapper.style.display === '') ? 'block' : 'none'; });

document.getElementById('add-sound-btn')?.addEventListener('click', () => document.getElementById('add-sound-upload').click());
document.getElementById('add-sound-upload')?.addEventListener('change', (event) => {
    const file = event.target.files[0]; if (!file) return;
    const audioUrl = URL.createObjectURL(file); const tempAudio = new Audio(audioUrl);
    tempAudio.onloadedmetadata = () => {
        if (tempAudio.duration > 5) return alert(`Error: Audio must be 5 seconds or less.`);
        const btn = document.createElement('button'); btn.textContent = file.name.split('.')[0]; btn.className = 'secondary-btn';
        btn.onclick = () => {
            if (window.initAudioCtx) window.initAudioCtx(); 
            const effectAudio = new Audio(audioUrl);
            const outId = localStorage.getItem('appAudioOut'); if (outId && typeof effectAudio.setSinkId === 'function') effectAudio.setSinkId(outId).catch(()=>{});
            
            if (window.audioCtx && window.soundboardDest) { 
                const source = window.audioCtx.createMediaElementSource(effectAudio); 
                const gainNode = window.audioCtx.createGain(); 
                gainNode.gain.value = Math.min(parseFloat(document.getElementById('effectsVolumeSlider')?.value || 1), 1); 
                source.connect(gainNode); gainNode.connect(window.audioCtx.destination); gainNode.connect(window.soundboardDest); 
            }
            effectAudio.play();
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'sound_played', userId: window.myId, soundName: btn.textContent }));
        };
        document.getElementById('soundboard-buttons').appendChild(btn);
    };
});
document.getElementById('yt-volume-slider')?.addEventListener('input', (e) => { if (window.ytPlayer && typeof window.ytPlayer.setVolume === 'function') window.ytPlayer.setVolume(e.target.value); });