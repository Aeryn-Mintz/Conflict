window.canvas = null; 
window.ctx = null;
window.fogCanvas = null; 
window.fogCtx = null;
window.isDrawing = false; 
window.lastX = 0; 
window.lastY = 0;
window.activeToken = null;
window.isPanning = false; 
window.startPanX = 0; 
window.startPanY = 0; 
window.startScrollLeft = 0; 
window.startScrollTop = 0;
window.currentZoom = 1.0;
window.currentTool = 'pen';
window.strokeColor = '#10b981';
window.strokeWidth = 2;

document.addEventListener('wheel', (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area');
    if (scrollArea && scrollArea.contains(e.target)) {
        e.preventDefault(); 
        const zoomStep = 0.1;
        if (e.deltaY < 0) window.currentZoom = Math.min(3.0, window.currentZoom + zoomStep);
        else window.currentZoom = Math.max(0.3, window.currentZoom - zoomStep);
        const mapLayer = document.getElementById('vtt-map-layer');
        if (mapLayer) { mapLayer.style.transform = `scale(${window.currentZoom})`; mapLayer.style.transformOrigin = "0 0"; }
    }
}, { passive: false }); 

document.addEventListener('mousedown', (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area');
    if (e.button === 1 && scrollArea && scrollArea.contains(e.target)) { 
        window.isPanning = true; window.startPanX = e.clientX; window.startPanY = e.clientY;
        window.startScrollLeft = scrollArea.scrollLeft; window.startScrollTop = scrollArea.scrollTop;
        scrollArea.style.cursor = 'grabbing'; e.preventDefault(); 
    }
});

window.addEventListener('mousemove', (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area'); const mapLayer = document.getElementById('vtt-map-layer');
    if (window.isPanning && scrollArea) { 
        scrollArea.scrollLeft = window.startScrollLeft - (e.clientX - window.startPanX); 
        scrollArea.scrollTop = window.startScrollTop - (e.clientY - window.startPanY); 
    }
    if (!window.activeToken || !mapLayer || !window.canvas || window.isPanning) return;

    const rect = mapLayer.getBoundingClientRect(); 
    let mouseX = (e.clientX - rect.left) / window.currentZoom;
    let mouseY = (e.clientY - rect.top) / window.currentZoom;

    let snapX = Math.floor(mouseX / 50) * 50 + 25;
    let snapY = Math.floor(mouseY / 50) * 50 + 25;

    window.activeToken.style.left = Math.max(25, Math.min(window.canvas.width - 25, snapX)) + 'px';
    window.activeToken.style.top = Math.max(25, Math.min(window.canvas.height - 25, snapY)) + 'px';

    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'token_move', userId: window.myId, tokenId: window.activeToken.id.replace('map-token-', ''), x: snapX, y: snapY }));
    }
});

window.addEventListener('mouseup', (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area');
    if (e.button === 1 && scrollArea) { window.isPanning = false; scrollArea.style.cursor = 'grab'; }
    window.activeToken = null; 
});

window.initCanvas = function() {
    window.canvas = document.getElementById('shared-canvas'); window.fogCanvas = document.getElementById('fog-canvas');
    if (!window.canvas || !window.fogCanvas) return;
    window.ctx = window.canvas.getContext('2d'); window.fogCtx = window.fogCanvas.getContext('2d');
    
    if (!window.canvas.dataset.initialized) {
        window.canvas.width = 3000; window.canvas.height = 3000; window.fogCanvas.width = 3000; window.fogCanvas.height = 3000;
        const mapLayer = document.getElementById('vtt-map-layer');
        if (mapLayer) {
            mapLayer.addEventListener('mousedown', startDrawing); mapLayer.addEventListener('mousemove', draw);
            mapLayer.addEventListener('mouseup', stopDrawing); mapLayer.addEventListener('mouseout', stopDrawing);
        }
        window.canvas.dataset.initialized = "true";
    }
};

window.currentTool = 'pen'; window.strokeColor = '#10b981'; window.strokeWidth = 2;

document.addEventListener('change', (e) => {
    if (e.target.id === 'stroke-color') { window.strokeColor = e.target.value; if (window.ctx) window.ctx.strokeStyle = window.strokeColor; }
    if (e.target.id === 'stroke-width') { window.strokeWidth = parseInt(e.target.value); if (window.ctx) { window.ctx.lineWidth = window.strokeWidth; window.ctx.lineCap = 'round'; window.ctx.lineJoin = 'round'; } }
});

window.setTool = function(tool) {
    window.currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tool + '-tool')?.classList.add('active');
    if (window.ctx) window.ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
}

function getMousePosition(e) {
    const rect = window.canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) / window.currentZoom, (e.clientY - rect.top) / window.currentZoom];
}

function startDrawing(e) {
    if (e.button !== 0 || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || window.activeToken) return; 
    window.isDrawing = true; 
    [window.lastX, window.lastY] = getMousePosition(e);
    
    // Força o clique único a registrar um pequeno ponto imediatamente
    draw({ clientX: e.clientX + 0.1, clientY: e.clientY });
}

window.remoteDraw = function(data) {
    if (window.ctx) {
        window.ctx.beginPath(); window.ctx.moveTo(data.x0, data.y0); window.ctx.lineTo(data.x1, data.y1);
        window.ctx.strokeStyle = data.color; window.ctx.lineWidth = data.width; window.ctx.stroke();
    }
};

function draw(e) {
    if (!window.isDrawing || !window.ctx) return;
    const [currentX, currentY] = getMousePosition(e);
    
    if (window.currentTool === 'fog-brush' && window.fogCtx) {
        // Pincel da névoa é 15x mais grosso para limpar o mapa facilmente
        const fogLineWidth = window.strokeWidth * 15; 
        
        window.fogCtx.globalCompositeOperation = 'destination-out';
        window.fogCtx.beginPath();
        window.fogCtx.moveTo(window.lastX, window.lastY);
        window.fogCtx.lineTo(currentX, currentY);
        window.fogCtx.lineWidth = fogLineWidth;
        window.fogCtx.lineCap = 'round';
        window.fogCtx.lineJoin = 'round';
        window.fogCtx.stroke();
        window.fogCtx.globalCompositeOperation = 'source-over'; 
        
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ 
                action: 'fog_reveal', userId: window.myId, 
                x0: window.lastX, y0: window.lastY, 
                x1: currentX, y1: currentY, width: fogLineWidth 
            }));
        }
    } else if (window.currentTool !== 'fog-brush') {
        window.ctx.beginPath(); window.ctx.moveTo(window.lastX, window.lastY); window.ctx.lineTo(currentX, currentY);
        window.ctx.strokeStyle = window.strokeColor; window.ctx.lineWidth = window.strokeWidth; window.ctx.stroke();
        
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'canvas_draw', userId: window.myId, x0: window.lastX, y0: window.lastY, x1: currentX, y1: currentY, color: window.strokeColor, width: window.strokeWidth }));
        }
    }
    [window.lastX, window.lastY] = [currentX, currentY];
}
function stopDrawing() {
    if (window.isDrawing && window.ctx && window.currentTool !== 'fog-brush') { window.ctx.stroke(); window.ctx.beginPath(); }
    window.isDrawing = false;
}

// ==========================================
// BULLETPROOF UI & DM TOOLS (Global Events)
// ==========================================
document.addEventListener('click', (e) => {
    // Canvas Tools
    if (e.target.closest('#pen-tool')) { window.setTool('pen'); return; }
    if (e.target.closest('#eraser-tool')) { window.setTool('eraser'); return; }
    if (e.target.closest('#fog-brush-tool')) { window.setTool('fog-brush'); return; }
    if (e.target.closest('#clear-canvas-btn')) {
        if (confirm('Clear the ink?')) {
            if (window.ctx) window.ctx.clearRect(0, 0, window.canvas.width, window.canvas.height);
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'canvas_clear', userId: window.myId}));
        }
        return;
    }

    if (e.target.closest('#toggle-tokens-btn')) {
        const panel = document.getElementById('floating-token-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        return;
    }

    const claimDmBtn = e.target.closest('#claim-dm-btn');
    if (claimDmBtn) {
        window.isDM = !window.isDM;
        const btn = document.getElementById('claim-dm-btn');
        const controls = document.getElementById('dm-controls');
        const fogBrush = document.getElementById('fog-brush-tool');
        const sysSelect = document.getElementById('rpg-system-select');
        const tabDm = document.getElementById('tab-dm-btn');
        const viewPartyBtn = document.getElementById('view-party-btn');
        const dmForceSys = document.getElementById('dm-force-system');
        const currentName = document.getElementById('display-username')?.textContent || 'DM';
        const fogCanvas = document.getElementById('fog-canvas'); // <-- Seleciona a névoa
        
        if (window.isDM) {
            if (btn) { btn.innerText = "👑 Release DM"; btn.style.background = "#fbbf24"; btn.style.color = "#000"; }
            if (controls) controls.style.display = "flex"; 
            if (fogBrush) fogBrush.style.display = "block";
            if (tabDm) tabDm.style.display = 'inline-block';
            if (viewPartyBtn) viewPartyBtn.style.display = 'inline-block';
            if (dmForceSys) dmForceSys.style.display = 'inline-block';
            if (fogCanvas) fogCanvas.style.opacity = '0.2'; // <-- Deixa translúcido para o DM
            
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                if (sysSelect) window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: sysSelect.value }));
                window.socket.send(JSON.stringify({ action: 'request_sheets' }));
                window.socket.send(JSON.stringify({ action: 'claim_dm', userId: window.myId, username: currentName }));
            }
            if (window.fs && window.mapSavePath && window.fs.existsSync(window.mapSavePath)) {
                const restoreBtn = document.getElementById('restore-map-btn'); if (restoreBtn) restoreBtn.style.display = "block";
            }
        } else {
            if (btn) { btn.innerText = "👑 Claim DM"; btn.style.background = "transparent"; btn.style.color = "#fbbf24"; }
            if (controls) controls.style.display = "none"; 
            if (fogBrush) fogBrush.style.display = "none";
            if (tabDm) tabDm.style.display = 'none';
            if (viewPartyBtn) viewPartyBtn.style.display = 'none';
            if (window.viewingParty && viewPartyBtn) viewPartyBtn.click(); 
            if (fogCanvas) fogCanvas.style.opacity = '1.0'; // <-- Volta ao breu total para jogadores
            if (typeof window.setTool === 'function') window.setTool('pen'); 
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                window.socket.send(JSON.stringify({ action: 'release_dm', userId: window.myId, username: currentName }));
            }
        }
        return;
    }
    if (e.target.closest('#restore-map-btn')) {
        if (window.fs && window.mapSavePath && window.fs.existsSync(window.mapSavePath)) {
            try {
                const savedMap = window.fs.readFileSync(window.mapSavePath, 'utf-8');
                const mapL = document.getElementById('vtt-map-layer'); if (mapL) mapL.style.backgroundImage = `url(${savedMap})`;
                if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: savedMap}));
                if (window.addChatLine) window.addChatLine('System', "🗺️ Map restored from hard drive.", true);
            } catch (error) {}
        }
        return;
    }

    if (e.target.closest('#map-upload-btn')) { document.getElementById('map-file-input')?.click(); return; }
    if (e.target.closest('#add-token-btn')) { document.getElementById('token-upload')?.click(); return; }

    const toggleFogBtn = e.target.closest('#toggle-fog-btn');
    if (toggleFogBtn) {
        const fog = document.getElementById('fog-canvas');
        if (!fog) return;
        if (fog.style.display !== 'none') {
            fog.style.display = 'none'; toggleFogBtn.innerText = "🌫️ Enable Fog";
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'toggle_fog', enabled: false}));
        } else {
            fog.style.display = 'block'; 
            if (window.fogCtx) { window.fogCtx.fillStyle = '#000000'; window.fogCtx.fillRect(0, 0, fog.width, fog.height); }
            toggleFogBtn.innerText = "🌫️ Disable Fog";
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'toggle_fog', enabled: true}));
        }
        return;
    }
});

// File Upload Listeners
document.addEventListener('change', (e) => {
    if (e.target.id === 'map-file-input') {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const bgData = event.target.result;
            const mapL = document.getElementById('vtt-map-layer'); if (mapL) mapL.style.backgroundImage = `url(${bgData})`;
            try { 
                if (window.fs && window.mapSavePath) {
                    window.fs.writeFileSync(window.mapSavePath, bgData, 'utf-8'); 
                    const restoreBtn = document.getElementById('restore-map-btn'); if (restoreBtn) restoreBtn.style.display = "block"; 
                }
            } catch (error) {}
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: bgData}));
        };
        reader.readAsDataURL(file);
    }
    if (e.target.id === 'token-upload') {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const asset = { id: window.myId + '-' + Math.random().toString(36).substring(2, 9), name: file.name.split('.')[0], src: e.target.result, type: 'token', ownerId: window.myId };
            const tokenLibrary = document.getElementById('token-library');
            if (!tokenLibrary) return;
            const tokenEl = document.createElement('div'); tokenEl.className = 'token-item';
            tokenEl.innerHTML = `<img src="${asset.src}" alt="${asset.name}" class="token-preview"><div class="token-name">${asset.name}</div>`;
            tokenEl.onclick = () => window.placeTokenOnMap(asset, true);
            tokenLibrary.appendChild(tokenEl);
        };
        reader.readAsDataURL(file);
    }
});
