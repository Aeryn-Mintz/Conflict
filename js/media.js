// ==========================================
// EXTERNAL MEDIA ENGINE (js/media.js)
// Anti-Loop Synced YouTube Jukebox & Soundboard
// ==========================================

window.ytPlayer = null;
window.ytPlayerReady = false;
window.pendingYtSync = null;
window.ytQueue = [];
window.currentQueueIndex = -1;
window._ytIgnoreEventsUntil = 0;
window._ytLastSyncSentPerPeer = {};

function extractYouTubeId(url) {
    if (!url) return null;
    try {
        const u = new URL(url.trim());
        const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
        let id = null;
        if (host === 'youtu.be') id = u.pathname.split('/')[1];
        else if (host === 'youtube.com' || host === 'music.youtube.com') {
            if (u.pathname === '/watch') id = u.searchParams.get('v');
            else {
                const match = u.pathname.match(/^\/(embed|shorts|live)\/([^\/]+)/);
                if (match) id = match[2];
            }
        }
        return (id && /^[A-Za-z0-9_-]{11}$/.test(id)) ? id : null;
    } catch (e) { return null; }
}

function formatYtTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function lockRemoteYtEvents(durationMs = 2400) {
    window._ytIgnoreEventsUntil = Math.max(window._ytIgnoreEventsUntil || 0, Date.now() + durationMs);
}

function isRemoteYtLocked() {
    return Date.now() < (window._ytIgnoreEventsUntil || 0);
}

window.injectYtSyncBar = function() {
    if (document.getElementById('yt-sync-bar-container')) return;
    const wrapper = document.getElementById('yt-wrapper');
    if (!wrapper || !wrapper.parentNode) return;

    const bar = document.createElement('div');
    bar.id = 'yt-sync-bar-container';
    bar.style.cssText = 'display:flex; flex-direction:column; gap:5px; margin-bottom:10px; padding:8px 10px; background:rgba(0,0,0,0.4); border:1px solid var(--border-color); border-radius:8px;';
    bar.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
            <span id="yt-now-playing-title" style="color:var(--text-main); font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:210px;">No track playing</span>
            <span id="yt-sync-badge" style="color:#10b981; font-size:10px; font-family:monospace;">🟢 SYNCED</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
            <span id="yt-time-current" style="font-size:10px; font-family:monospace; color:var(--text-muted); min-width:32px;">0:00</span>
            <input type="range" id="yt-seek-slider" class="kokonut-slider" min="0" max="100" step="0.5" value="0" style="flex-grow:1; height:5px; cursor:pointer;">
            <span id="yt-time-total" style="font-size:10px; font-family:monospace; color:var(--text-muted); min-width:32px; text-align:right;">0:00</span>
        </div>
    `;
    wrapper.parentNode.insertBefore(bar, wrapper);

    const seekSlider = document.getElementById('yt-seek-slider');
    seekSlider?.addEventListener('mousedown', () => { window._ytUserScrubbing = true; });
    seekSlider?.addEventListener('mouseup', (e) => {
        window._ytUserScrubbing = false;
        if (!window.ytPlayer || typeof window.ytPlayer.getDuration !== 'function') return;
        const duration = window.ytPlayer.getDuration();
        if (duration > 0) {
            const targetTime = (parseFloat(e.target.value) / 100) * duration;
            lockRemoteYtEvents(1800);
            window.ytPlayer.seekTo(targetTime, true);
            window.broadcastYtState('seek', targetTime);
        }
    });
};

window.broadcastYtState = function(stateType, customTime = null) {
    if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;
    if (isRemoteYtLocked() && stateType !== 'seek') return;

    const currentItem = window.ytQueue[window.currentQueueIndex];
    if (!currentItem) return;

    const curTime = customTime !== null
        ? customTime
        : (window.ytPlayer && typeof window.ytPlayer.getCurrentTime === 'function' ? window.ytPlayer.getCurrentTime() : 0);

    window.socket.send(JSON.stringify({
        action: 'yt_state',
        userId: window.myId,
        state: stateType,
        videoId: currentItem.id,
        index: window.currentQueueIndex,
        currentTime: curTime,
        sentAt: Date.now()
    }));
};

window.sendFullYtSync = function(targetUserId = null) {
    if (!window.socket || window.socket.readyState !== WebSocket.OPEN) return;
    if (!window.ytQueue || window.ytQueue.length === 0) return;

    // Rate-limit: impede enviar múltiplos yt_sync seguidos para o mesmo usuário quando ele entra na sala
    if (targetUserId) {
        const lastSent = window._ytLastSyncSentPerPeer[targetUserId] || 0;
        if (Date.now() - lastSent < 4000) return;
        window._ytLastSyncSentPerPeer[targetUserId] = Date.now();
    }

    const pState = (window.ytPlayer && typeof window.ytPlayer.getPlayerState === 'function')
        ? window.ytPlayer.getPlayerState()
        : -1;
    const curTime = (window.ytPlayer && typeof window.ytPlayer.getCurrentTime === 'function')
        ? window.ytPlayer.getCurrentTime()
        : 0;

    window.socket.send(JSON.stringify({
        action: 'yt_sync',
        userId: window.myId,
        targetId: targetUserId,
        queue: window.ytQueue,
        index: window.currentQueueIndex,
        currentTime: curTime,
        isPlaying: pState === 1,
        sentAt: Date.now()
    }));
};

window.applyIncomingYtSync = function(data) {
    if (!data || !Array.isArray(data.queue) || data.queue.length === 0) return;
    window.ytQueue = data.queue;
    window.currentQueueIndex = typeof data.index === 'number' ? data.index : 0;
    window.renderQueueUI();

    if (window.currentQueueIndex < 0 || !window.ytQueue[window.currentQueueIndex]) return;

    const targetVideoId = window.ytQueue[window.currentQueueIndex].id;
    const transitSec = data.sentAt ? Math.max(0, Math.min(3, (Date.now() - data.sentAt) / 1000)) : 0;
    const targetTime = (data.currentTime || 0) + (data.isPlaying ? transitSec : 0);

    if (!window.ytPlayerReady || !window.ytPlayer || typeof window.ytPlayer.loadVideoById !== 'function') {
        window.pendingYtSync = { videoId: targetVideoId, time: targetTime, isPlaying: !!data.isPlaying };
        return;
    }

    // Trava eventos locais por 2.8s para NUNCA criar loop infinito de play/pause/seek com o host!
    lockRemoteYtEvents(2800);
    document.getElementById('yt-wrapper').style.display = 'block';

    const loadedId = (typeof window.ytPlayer.getVideoData === 'function') ? window.ytPlayer.getVideoData()?.video_id : null;
    if (loadedId === targetVideoId) {
        const localTime = typeof window.ytPlayer.getCurrentTime === 'function' ? window.ytPlayer.getCurrentTime() : 0;
        if (Math.abs(localTime - targetTime) > 2.5 && typeof window.ytPlayer.seekTo === 'function') {
            window.ytPlayer.seekTo(targetTime, true);
        }
        if (data.isPlaying) window.ytPlayer.playVideo();
        else window.ytPlayer.pauseVideo();
    } else {
        window.ytPlayer.loadVideoById({ videoId: targetVideoId, startSeconds: targetTime });
        setTimeout(() => {
            lockRemoteYtEvents(1500);
            if (window.ytPlayer && typeof window.ytPlayer.pauseVideo === 'function') {
                if (data.isPlaying) window.ytPlayer.playVideo();
                else window.ytPlayer.pauseVideo();
            }
        }, 700);
    }
};

window.handleIncomingYtState = function(data) {
    if (!data || data.userId === window.myId) return;
    if (!window.ytPlayerReady || !window.ytPlayer) return;

    const transitSec = data.sentAt ? Math.max(0, Math.min(2, (Date.now() - data.sentAt) / 1000)) : 0;
    const expectedTime = (data.currentTime || 0) + (data.state === 'play' ? transitSec : 0);

    // Trava eventos de retorno por 2.4 segundos para impedir ping-pong entre os jogadores!
    lockRemoteYtEvents(2400);

    if (typeof data.index === 'number' && data.index !== window.currentQueueIndex && window.ytQueue[data.index]) {
        window.currentQueueIndex = data.index;
        window.loadAndPlayVideo(window.ytQueue[data.index].id, data.index, expectedTime, true);
    } else {
        const localTime = typeof window.ytPlayer.getCurrentTime === 'function' ? window.ytPlayer.getCurrentTime() : 0;
        if (Math.abs(localTime - expectedTime) > 2.5 && typeof window.ytPlayer.seekTo === 'function') {
            window.ytPlayer.seekTo(expectedTime, true);
        }

        const curState = typeof window.ytPlayer.getPlayerState === 'function' ? window.ytPlayer.getPlayerState() : -1;
        if (data.state === 'pause' && curState !== 2 && typeof window.ytPlayer.pauseVideo === 'function') {
            window.ytPlayer.pauseVideo();
        } else if (data.state === 'play' && curState !== 1 && typeof window.ytPlayer.playVideo === 'function') {
            window.ytPlayer.playVideo();
        }
    }

    const badge = document.getElementById('yt-sync-badge');
    if (badge) {
        badge.innerText = data.state === 'pause' ? '⏸️ PAUSED' : '🟢 SYNCED';
        badge.style.color = data.state === 'pause' ? '#fbbf24' : '#10b981';
    }
};

window.ytApiTag = document.createElement('script');
window.ytApiTag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(window.ytApiTag);

window.onYouTubeIframeAPIReady = function () {
    window.injectYtSyncBar();
    window.ytPlayer = new YT.Player('yt-iframe', { 
        height: '100%',
        width: '100%', 
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, origin: window.location.origin }, 
        events: {
            onReady: () => {
                window.ytPlayerReady = true;
                if (window.pendingYtSync) {
                    const p = window.pendingYtSync;
                    window.pendingYtSync = null;
                    lockRemoteYtEvents(2800);
                    document.getElementById('yt-wrapper').style.display = 'block';
                    window.ytPlayer.loadVideoById({ videoId: p.videoId, startSeconds: p.time });
                    setTimeout(() => {
                        lockRemoteYtEvents(1500);
                        if (!p.isPlaying) window.ytPlayer.pauseVideo();
                    }, 700);
                } else if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                    window.socket.send(JSON.stringify({ action: 'yt_request_sync', userId: window.myId }));
                }
            },
            onStateChange: (event) => {
                if (event.data === YT.PlayerState.ENDED) {
                    if (window.ytQueue.length === 0) return;
                    const nextIdx = (window.currentQueueIndex + 1) >= window.ytQueue.length ? 0 : (window.currentQueueIndex + 1);
                    window.currentQueueIndex = nextIdx;
                    window.loadAndPlayVideo(window.ytQueue[nextIdx].id, nextIdx, 0, true);
                    return;
                }

                // Se estamos aplicando um comando remoto ou carregando vídeo, NUNCA retransmite de volta!
                if (isRemoteYtLocked()) return;

                if (event.data === YT.PlayerState.PLAYING) {
                    const cur = window.ytPlayer.getCurrentTime();
                    window.broadcastYtState('play', cur);
                } else if (event.data === YT.PlayerState.PAUSED) {
                    const cur = window.ytPlayer.getCurrentTime();
                    window.broadcastYtState('pause', cur);
                }
            },
            onError: () => {
                if (window.addChatLine) window.addChatLine('System', "⚠️ This video is blocked from embedded players by its owner.", 'system');
                window.playNextInQueue(false);
            }
        }
    });

    // Atualiza apenas a barra visual (sem o detector de scrub automático que causava loop infinito durante buffering!)
    setInterval(() => {
        if (!window.ytPlayerReady || !window.ytPlayer || typeof window.ytPlayer.getCurrentTime !== 'function') return;
        const cur = window.ytPlayer.getCurrentTime() || 0;
        const dur = window.ytPlayer.getDuration() || 0;

        const curEl = document.getElementById('yt-time-current');
        const totEl = document.getElementById('yt-time-total');
        const slider = document.getElementById('yt-seek-slider');

        if (curEl) curEl.innerText = formatYtTime(cur);
        if (totEl) totEl.innerText = formatYtTime(dur);
        if (slider && !window._ytUserScrubbing && dur > 0) {
            slider.value = (cur / dur) * 100;
        }
    }, 500);
};

window.loadAndPlayVideo = function(videoId, index = -1, startSeconds = 0, isRemote = false) {
    if (!videoId) return;
    window.injectYtSyncBar();
    const wrapper = document.getElementById('yt-wrapper');
    if (wrapper && wrapper.style.display === 'none') {
        wrapper.style.display = 'block';
    }
    if (index !== -1) window.currentQueueIndex = index;

    const nowPlayingEl = document.getElementById('yt-now-playing-title');
    if (nowPlayingEl && window.ytQueue[window.currentQueueIndex]) {
        nowPlayingEl.innerText = `🎵 ${window.ytQueue[window.currentQueueIndex].title}`;
    }

    if (window.ytPlayerReady && window.ytPlayer && typeof window.ytPlayer.loadVideoById === 'function') {
        lockRemoteYtEvents(2500);
        window.ytPlayer.loadVideoById({ videoId: videoId, startSeconds: startSeconds });
    } else {
        window.pendingYtSync = { videoId: videoId, time: startSeconds, isPlaying: true };
    }
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
    if (window.currentQueueIndex === -1) {
        window.currentQueueIndex = 0;
        window.loadAndPlayVideo(videoId, 0, 0, !broadcast);
    } else {
        window.renderQueueUI();
    }

    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'yt_queue_add', videoId: videoId, title: vidTitle }));
    }
};

window.playNextInQueue = function(broadcast = true) { 
    if (window.ytQueue.length === 0) return; 
    window.currentQueueIndex++; 
    if (window.currentQueueIndex >= window.ytQueue.length) window.currentQueueIndex = 0; 
    window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex, 0, !broadcast);
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'yt_jump', index: window.currentQueueIndex }));
    }
};

window.renderQueueUI = function() {
    window.injectYtSyncBar();
    const listEl = document.getElementById('yt-queue-list');
    const countEl = document.getElementById('queue-count');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (countEl) countEl.innerText = `${window.ytQueue.length} items`;

    const nowPlayingEl = document.getElementById('yt-now-playing-title');
    if (nowPlayingEl) {
        nowPlayingEl.innerText = window.ytQueue[window.currentQueueIndex]
            ? `🎵 ${window.ytQueue[window.currentQueueIndex].title}`
            : 'No track playing';
    }
    
    window.ytQueue.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = index === window.currentQueueIndex ? 'yt-queue-item active-queue-item' : 'yt-queue-item';
        row.innerHTML = `<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px; display: inline-block; vertical-align: middle;" title="${item.title}">${index + 1}. ${item.title}</span><div class="yt-queue-controls"><button class="yt-queue-btn" onclick="window.jumpToQueue(${index})" title="Play Now">▶️</button><button class="yt-queue-btn" onclick="window.removeFromQueue(${index}, true)" title="Remove">✕</button></div>`;
        listEl.appendChild(row);
    });

    localStorage.setItem('conflict_yt_recent_queue', JSON.stringify({ queue: window.ytQueue, index: window.currentQueueIndex }));
};

window.jumpToQueue = function(index) { 
    if (!window.ytQueue[index]) return;
    window.currentQueueIndex = index; 
    window.loadAndPlayVideo(window.ytQueue[index].id, index, 0, false); 
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'yt_jump', index: index }));
    }
};

window.removeFromQueue = function(index, broadcast = true) { 
    window.ytQueue.splice(index, 1); 
    if (index === window.currentQueueIndex) window.playNextInQueue(false); 
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
    if (window.addChatLine) window.addChatLine('System', `💾 Playlist **${name}** saved to your vault!`, 'system');
};

window.loadYtPlaylist = function() {
    const playlists = JSON.parse(localStorage.getItem('conflict_yt_playlists') || '{}');
    const names = Object.keys(playlists);
    if (names.length === 0) return;
    
    const name = prompt("Which playlist do you want to load?\nAvailable: " + names.join(", "));
    if (playlists[name]) {
        window.ytQueue = playlists[name];
        window.currentQueueIndex = 0;
        window.renderQueueUI();
        if (window.ytQueue[0]) window.loadAndPlayVideo(window.ytQueue[0].id, 0, 0, false);
        window.sendFullYtSync(null);
        if (window.addChatLine) window.addChatLine('System', `📂 Playlist **${name}** loaded and synced to the room!`, 'system');
    }
};

window.loadRecentQueue = function() {
    const recent = JSON.parse(localStorage.getItem('conflict_yt_recent_queue') || 'null');
    if (!recent || !recent.queue || recent.queue.length === 0) return;
    
    window.ytQueue = recent.queue;
    window.currentQueueIndex = recent.index >= 0 ? recent.index : 0;
    window.renderQueueUI();
    
    if (window.ytQueue[window.currentQueueIndex]) {
        window.loadAndPlayVideo(window.ytQueue[window.currentQueueIndex].id, window.currentQueueIndex, 0, false);
    }
    window.sendFullYtSync(null);
    if (window.addChatLine) window.addChatLine('System', `🔄 Most recent session queue restored & synced!`, 'system');
};

document.getElementById('yt-queue-add-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('yt-url-input');
    const vidId = extractYouTubeId(inp?.value);
    if (vidId) {
        window.queueVideo(vidId, true);
        inp.value = '';
        if (window.addChatLine) window.addChatLine('System', `➕ Added video to queue`, 'system');
    }
});

document.getElementById('yt-play-btn')?.addEventListener('click', async () => { 
    const inp = document.getElementById('yt-url-input');
    const vidId = extractYouTubeId(inp?.value); 
    if (vidId) { 
        let vidTitle = `Video (${vidId})`;
        try {
            const res = await fetch(`https://noembed.com/embed?dataType=json&url=https://www.youtube.com/watch?v=${vidId}`);
            const data = await res.json();
            vidTitle = data.title && !data.error ? data.title : vidTitle;
        } catch(e) {}
        
        window.ytQueue.unshift({ id: vidId, title: vidTitle }); 
        window.loadAndPlayVideo(vidId, 0, 0, false); 
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'yt_load', videoId: vidId, title: vidTitle }));
        }
        inp.value = ''; 
    }
});

document.getElementById('yt-skip-btn')?.addEventListener('click', () => {
    window.playNextInQueue(true);
});

document.getElementById('toggle-queue-btn')?.addEventListener('click', () => {
    const drawer = document.getElementById('drag-yt-queue');
    if (drawer) drawer.style.display = (drawer.style.display === 'none' || drawer.style.display === '') ? 'block' : 'none';
});

document.getElementById('yt-playpause-btn')?.addEventListener('click', () => {
    if (!window.ytPlayer || typeof window.ytPlayer.getPlayerState !== 'function') return;
    const curTime = window.ytPlayer.getCurrentTime() || 0;
    lockRemoteYtEvents(1200);
    if (window.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        window.ytPlayer.pauseVideo();
        window.socket?.send(JSON.stringify({
            action: 'yt_state',
            userId: window.myId,
            state: 'pause',
            videoId: window.ytQueue[window.currentQueueIndex]?.id || null,
            index: window.currentQueueIndex,
            currentTime: curTime,
            sentAt: Date.now()
        }));
    } else {
        window.ytPlayer.playVideo();
        window.socket?.send(JSON.stringify({
            action: 'yt_state',
            userId: window.myId,
            state: 'play',
            videoId: window.ytQueue[window.currentQueueIndex]?.id || null,
            index: window.currentQueueIndex,
            currentTime: curTime,
            sentAt: Date.now()
        }));
    }
});

document.getElementById('toggle-yt-view')?.addEventListener('click', () => {
    const wrapper = document.getElementById('yt-wrapper');
    if (wrapper) wrapper.style.display = (wrapper.style.display === 'none' || wrapper.style.display === '') ? 'block' : 'none';
});

document.getElementById('add-sound-btn')?.addEventListener('click', () => document.getElementById('add-sound-upload')?.click());
document.getElementById('add-sound-upload')?.addEventListener('change', (event) => {
    const file = event.target.files[0]; if (!file) return;
    const audioUrl = URL.createObjectURL(file); const tempAudio = new Audio(audioUrl);
    tempAudio.onloadedmetadata = () => {
        if (tempAudio.duration > 5) return;
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
document.getElementById('yt-volume-slider')?.addEventListener('input', (e) => {
    if (window.ytPlayer && typeof window.ytPlayer.setVolume === 'function') window.ytPlayer.setVolume(e.target.value);
});