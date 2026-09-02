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
        // ORIGEM RESTAURADA: Sem falsificação, evitamos o Erro 500 do postMessage
        playerVars: { autoplay: 1, origin: window.location.origin }, 
        events: {
            onReady: () => { if (window.pendingYtVideoId) { window.loadAndPlayVideo(window.pendingYtVideoId); window.pendingYtVideoId = null; } },
            onStateChange: (event) => { if (event.data === YT.PlayerState.ENDED) window.playNextInQueue(); },
            onError: () => { if(window.addChatLine) window.addChatLine('System', "⚠️ That video can't be played here.", true); window.playNextInQueue(); }
        }
    });
};
window.loadAndPlayVideo = function(videoId, index = -1) {
    if (!videoId) return;
    document.getElementById('yt-wrapper').style.display = 'block'; if (index !== -1) window.currentQueueIndex = index;
    if (window.ytPlayer && typeof window.ytPlayer.loadVideoById === 'function') window.ytPlayer.loadVideoById(videoId); else window.pendingYtVideoId = videoId;
    window.renderQueueUI();
};
window.queueVideo = function(videoId, broadcast = true) {
    if (!videoId) return;
    window.ytQueue.push({ id: videoId, title: `Video (${videoId})` });
    if (window.currentQueueIndex === -1) window.playNextInQueue(); else window.renderQueueUI();
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_queue_add', videoId: videoId }));
};
window.playNextInQueue = function() { if (window.ytQueue.length === 0) return; window.currentQueueIndex++; if (window.currentQueueIndex >= window.ytQueue.length) window.currentQueueIndex = 0; window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex); };
window.renderQueueUI = function() {
    const listEl = document.getElementById('yt-queue-list'); const countEl = document.getElementById('queue-count');
    if (!listEl) return;
    listEl.innerHTML = ''; countEl.innerText = `${window.ytQueue.length} items`;
    window.ytQueue.forEach((item, index) => {
        const row = document.createElement('div'); row.className = index === window.currentQueueIndex ? 'yt-queue-item active-queue-item' : 'yt-queue-item';
        row.innerHTML = `<span>${index + 1}. ${item.id}</span><div class="yt-queue-controls"><button class="yt-queue-btn" onclick="window.jumpToQueue(${index})" title="Play Now">▶️</button><button class="yt-queue-btn" onclick="window.removeFromQueue(${index})" title="Remove">✕</button></div>`;
        listEl.appendChild(row);
    });
};
window.jumpToQueue = function(index) { window.currentQueueIndex = index; window.loadAndPlayVideo(window.ytQueue[index].id, index); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_jump', index: index })); };
window.removeFromQueue = function(index) { window.ytQueue.splice(index, 1); if (index === window.currentQueueIndex) window.playNextInQueue(); else if (index < window.currentQueueIndex) window.currentQueueIndex--; window.renderQueueUI(); };

document.getElementById('yt-queue-add-btn')?.addEventListener('click', () => { const vidId = extractYouTubeId(document.getElementById('yt-url-input').value); if (vidId) { window.queueVideo(vidId, true); document.getElementById('yt-url-input').value = ''; if(window.addChatLine) window.addChatLine('System', `➕ Added video to queue`, true); } else alert("Invalid Link!"); });
document.getElementById('yt-play-btn')?.addEventListener('click', () => { const vidId = extractYouTubeId(document.getElementById('yt-url-input').value); if (vidId) { window.ytQueue.unshift({ id: vidId, title: `Video (${vidId})` }); window.loadAndPlayVideo(vidId, 0); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_load', videoId: vidId })); document.getElementById('yt-url-input').value = ''; } else alert("Invalid Link!"); });
document.getElementById('yt-skip-btn')?.addEventListener('click', () => { window.playNextInQueue(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_skip' })); });
document.getElementById('toggle-queue-btn')?.addEventListener('click', () => { const drawer = document.getElementById('yt-queue-drawer'); drawer.style.display = drawer.style.display === 'flex' ? 'none' : 'flex'; });
document.getElementById('yt-playpause-btn')?.addEventListener('click', () => { if (!window.ytPlayer || typeof window.ytPlayer.getPlayerState !== 'function') return; if (window.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) { window.ytPlayer.pauseVideo(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_pause' })); } else { window.ytPlayer.playVideo(); if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'yt_play' })); } });

document.getElementById('toggle-yt-view')?.addEventListener('click', () => { 
    const wrapper = document.getElementById('yt-wrapper'); 
    wrapper.style.display = (wrapper.style.display === 'none' || wrapper.style.display === '') ? 'block' : 'none'; 
});

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
                source.connect(gainNode); 
                gainNode.connect(window.audioCtx.destination); 
                gainNode.connect(window.soundboardDest); 
            }
            effectAudio.play();
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'sound_played', userId: window.myId, soundName: btn.textContent }));
        };
        document.getElementById('soundboard-buttons').appendChild(btn);
    };
});