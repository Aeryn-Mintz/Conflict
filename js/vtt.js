window.canvas = null; window.ctx = null;
window.isDrawing = false; window.lastX = 0; window.lastY = 0;
window.activeToken = null; window.resizingToken = null;
window.isPanning = false; 
window.startPanX = 0; window.startPanY = 0; 
window.startCamX = 0; window.startCamY = 0;
window.cameraX = 0; window.cameraY = 0;
window.currentZoom = 1.0; 
window.currentTool = 'selector'; 
window.strokeColor = '#10b981'; window.strokeWidth = 2;
window.mapWidth = 8000; window.mapHeight = 8000;

window.mapAssets = {};
window.activeMapBg = null;

window.selectedTokens = new Set();
window.initialSelectedTokens = new Set();
window.isBoxSelecting = false;
window.selectionStartX = 0; window.selectionStartY = 0;
window.selectionBoxEl = null;
window.dragOffsets = new Map();

window.saveMapState = function() {
    if (window.isDM && window.fs && window.mapSavePath) {
        const state = { img: window.activeMapBg, w: window.mapWidth, h: window.mapHeight, assets: window.mapAssets };
        try { window.fs.writeFileSync(window.mapSavePath, JSON.stringify(state), 'utf-8'); } catch(e){}
    }
};

window.applyVisibility = function(el, isHidden) {
    if (isHidden) el.classList.add('is-hidden'); else el.classList.remove('is-hidden');
};

window.clearSelection = function() {
    window.selectedTokens.forEach(el => el.classList.remove('selected'));
    window.selectedTokens.clear();
};

window.updateCamera = function() {
    const mapLayer = document.getElementById('vtt-map-layer');
    const scrollArea = document.getElementById('vtt-scroll-area');
    if (!mapLayer || !scrollArea) return;
    
    scrollArea.style.overflow = 'hidden';
    const viewW = scrollArea.clientWidth; const viewH = scrollArea.clientHeight;
    const maxW = window.mapWidth * window.currentZoom; const maxH = window.mapHeight * window.currentZoom;

    if (maxW < viewW) window.cameraX = (viewW - maxW) / 2;
    else window.cameraX = Math.max(viewW - maxW, Math.min(0, window.cameraX));

    if (maxH < viewH) window.cameraY = (viewH - maxH) / 2;
    else window.cameraY = Math.max(viewH - maxH, Math.min(0, window.cameraY));

    mapLayer.style.transform = `translate(${window.cameraX}px, ${window.cameraY}px) scale(${window.currentZoom})`;
    mapLayer.style.transformOrigin = "0 0";
};

if (window.vttWheelHandler) document.removeEventListener('wheel', window.vttWheelHandler);
window.vttWheelHandler = (e) => {
    const cropModal = document.getElementById('crop-modal');
    if (cropModal && cropModal.style.display !== 'none') return; 

    const scrollArea = document.getElementById('vtt-scroll-area');
    if (scrollArea && scrollArea.contains(e.target)) {
        e.preventDefault(); 
        const zoomStep = 0.1; const oldZoom = window.currentZoom;
        if (e.deltaY < 0) window.currentZoom = Math.min(3.0, window.currentZoom + zoomStep);
        else window.currentZoom = Math.max(0.1, window.currentZoom - zoomStep);
        
        const rect = scrollArea.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
        window.cameraX = mouseX - (mouseX - window.cameraX) * (window.currentZoom / oldZoom);
        window.cameraY = mouseY - (mouseY - window.cameraY) * (window.currentZoom / oldZoom);
        window.updateCamera();
    }
};
document.addEventListener('wheel', window.vttWheelHandler, { passive: false }); 

if (window.vttMousedownHandler) document.removeEventListener('mousedown', window.vttMousedownHandler);
window.vttMousedownHandler = (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area');
    if (e.button === 1 && scrollArea && scrollArea.contains(e.target)) { 
        window.isPanning = true; window.startPanX = e.clientX; window.startPanY = e.clientY;
        window.startCamX = window.cameraX; window.startCamY = window.cameraY;
        scrollArea.style.cursor = 'grabbing'; e.preventDefault(); 
    }
};
document.addEventListener('mousedown', window.vttMousedownHandler);

if (window.vttMousemoveHandler) document.removeEventListener('mousemove', window.vttMousemoveHandler);
window.vttMousemoveHandler = (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area'); 
    const mapLayer = document.getElementById('vtt-map-layer');
    
    if (window.isPanning && scrollArea) { 
        window.cameraX = window.startCamX + (e.clientX - window.startPanX); window.cameraY = window.startCamY + (e.clientY - window.startPanY); 
        window.updateCamera(); return;
    }
    
    if (window.resizingToken) {
        const dx = (e.clientX - window.startResizeX) / window.currentZoom;
        const newW = Math.max(20, window.startResizeW + dx * 2);
        const newH = newW / window.startResizeAspect;
        window.resizingToken.style.width = newW + 'px'; window.resizingToken.style.height = newH + 'px';
        const tokenId = window.resizingToken.id.replace('map-token-', '');
        if (window.mapAssets[tokenId]) { window.mapAssets[tokenId].w = newW; window.mapAssets[tokenId].h = newH; window.saveMapState(); }
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'token_resize', userId: window.myId, tokenId: tokenId, w: newW, h: newH }));
        return; 
    }
    
    if (window.isBoxSelecting && window.selectionBoxEl) {
        const [currentX, currentY] = getMousePosition(e);
        const x = Math.min(window.selectionStartX, currentX); const y = Math.min(window.selectionStartY, currentY);
        const w = Math.abs(currentX - window.selectionStartX); const h = Math.abs(currentY - window.selectionStartY);
        
        window.selectionBoxEl.style.left = x + 'px'; window.selectionBoxEl.style.top = y + 'px';
        window.selectionBoxEl.style.width = w + 'px'; window.selectionBoxEl.style.height = h + 'px';
        
        const boxRect = { left: x, top: y, right: x + w, bottom: y + h };
        
        document.querySelectorAll('.asset-item').forEach(el => {
            const ex = parseFloat(el.style.left) || 0; const ey = parseFloat(el.style.top) || 0;
            if (ex >= boxRect.left && ex <= boxRect.right && ey >= boxRect.top && ey <= boxRect.bottom) {
                window.selectedTokens.add(el); el.classList.add('selected');
            } else {
                if (!window.initialSelectedTokens.has(el)) { window.selectedTokens.delete(el); el.classList.remove('selected'); }
            }
        });
        return;
    }

    if (window.activeToken && mapLayer && window.canvas) {
        const dx = (e.clientX - window.startDragX) / window.currentZoom;
        const dy = (e.clientY - window.startDragY) / window.currentZoom;

        window.selectedTokens.forEach(token => {
            const offset = window.dragOffsets.get(token);
            if (!offset) return;

            let targetX = offset.startX + dx; let targetY = offset.startY + dy;
            if (e.shiftKey) { targetX = Math.floor(targetX / 50) * 50 + 25; targetY = Math.floor(targetY / 50) * 50 + 25; }

            targetX = Math.max(0, Math.min(window.mapWidth, targetX)); targetY = Math.max(0, Math.min(window.mapHeight, targetY));

            token.style.left = targetX + 'px'; token.style.top = targetY + 'px';
            const tokenId = token.id.replace('map-token-', '');
            if (window.mapAssets[tokenId]) { window.mapAssets[tokenId].x = targetX; window.mapAssets[tokenId].y = targetY; }

            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'token_move', userId: window.myId, tokenId: tokenId, x: targetX, y: targetY }));
        });
        window.saveMapState();
    }
};
document.addEventListener('mousemove', window.vttMousemoveHandler);

if (window.vttMouseupHandler) document.removeEventListener('mouseup', window.vttMouseupHandler);
window.vttMouseupHandler = (e) => {
    const scrollArea = document.getElementById('vtt-scroll-area');
    if (e.button === 1 && scrollArea) { window.isPanning = false; scrollArea.style.cursor = 'default'; }
    if (window.isBoxSelecting) { window.isBoxSelecting = false; if (window.selectionBoxEl) window.selectionBoxEl.style.display = 'none'; }
    window.activeToken = null; window.resizingToken = null; window.dragOffsets.clear();
};
document.addEventListener('mouseup', window.vttMouseupHandler);

window.placeTokenOnMap = function(asset, broadcast = true) {
    const layer = document.getElementById('token-layer');
    if (!layer) return;

    // NOVO: DM Spawna itens invisíveis por padrão
    if (broadcast && window.isDM && asset.hidden === undefined) {
        asset.hidden = true;
    }

    let el = document.getElementById('map-token-' + asset.id);
    if (!el) {
        el = document.createElement('div'); el.id = 'map-token-' + asset.id; el.className = 'asset-item';
        el.style.zIndex = asset.z || 10; 
        
        const img = document.createElement('img'); img.src = asset.src; img.className = 'asset-img'; img.draggable = false;
        el.appendChild(img);

        const resizeHandle = document.createElement('div'); resizeHandle.className = 'asset-resize-handle'; resizeHandle.title = "Drag to resize";
        el.appendChild(resizeHandle);
        layer.appendChild(el);

        if (asset.x === undefined || asset.y === undefined) {
            const scrollArea = document.getElementById('vtt-scroll-area'); const viewW = scrollArea.clientWidth; const viewH = scrollArea.clientHeight;
            asset.x = ((viewW / 2) - window.cameraX) / window.currentZoom; asset.y = ((viewH / 2) - window.cameraY) / window.currentZoom;
            asset.w = 100; asset.h = 100; 
        }

        el.style.left = asset.x + 'px'; el.style.top = asset.y + 'px';
        if (asset.w) el.style.width = asset.w + 'px'; if (asset.h) el.style.height = asset.h + 'px';
        
        window.mapAssets[asset.id] = asset; window.saveMapState(); window.applyVisibility(el, asset.hidden);

        // --- SISTEMA DE RIGHT-CLICK (Context Menu) ---
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            
            let ctxMenu = document.getElementById('asset-context-menu');
            if (!ctxMenu) {
                ctxMenu = document.createElement('div');
                ctxMenu.id = 'asset-context-menu';
                ctxMenu.className = 'panel glass-panel';
                ctxMenu.style.position = 'fixed';
                ctxMenu.style.display = 'none';
                ctxMenu.style.flexDirection = 'column';
                ctxMenu.style.gap = '8px';
                ctxMenu.style.zIndex = '99999';
                ctxMenu.style.padding = '12px';
                ctxMenu.style.minWidth = '160px';
                document.body.appendChild(ctxMenu);

                document.addEventListener('click', (ev) => {
                    if (ctxMenu && !ctxMenu.contains(ev.target)) ctxMenu.style.display = 'none';
                });
                document.addEventListener('wheel', () => { if (ctxMenu) ctxMenu.style.display = 'none'; });
            }

            ctxMenu.innerHTML = '';
            const getTargets = () => window.selectedTokens.has(el) ? Array.from(window.selectedTokens) : [el];
            const currentAssetData = window.mapAssets[asset.id];

            // APENAS O DM PODE ESCONDER/REVELAR ITENS
            if (window.isDM) {
                const visBtn = document.createElement('button');
                visBtn.className = 'secondary-btn kokonut-btn';
                visBtn.innerHTML = currentAssetData.hidden ? '👁️ Reveal to Players' : '🙈 Hide from Players';
                visBtn.onclick = () => {
                    const newState = !currentAssetData.hidden; 
                    getTargets().forEach(t => {
                        const tId = t.id.replace('map-token-', '');
                        if (window.mapAssets[tId]) window.mapAssets[tId].hidden = newState;
                        window.applyVisibility(t, newState);
                        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                            window.socket.send(JSON.stringify({ action: 'token_hide', userId: window.myId, tokenId: tId, hidden: newState }));
                        }
                    });
                    window.saveMapState();
                    ctxMenu.style.display = 'none';
                };
                ctxMenu.appendChild(visBtn);
            }

            const adjustLayer = (delta) => {
                getTargets().forEach(t => {
                    const currentZ = parseInt(t.style.zIndex) || 10; t.style.zIndex = Math.max(1, currentZ + delta);
                    const tId = t.id.replace('map-token-', '');
                    if (window.mapAssets[tId]) window.mapAssets[tId].z = t.style.zIndex;
                    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'token_zindex', userId: window.myId, tokenId: tId, z: t.style.zIndex }));
                });
                window.saveMapState();
                ctxMenu.style.display = 'none';
            };

            const upBtn = document.createElement('button'); upBtn.className = 'secondary-btn kokonut-btn'; upBtn.innerHTML = '⬆️ Bring Forward';
            upBtn.onclick = () => adjustLayer(1);
            ctxMenu.appendChild(upBtn);

            const downBtn = document.createElement('button'); downBtn.className = 'secondary-btn kokonut-btn'; downBtn.innerHTML = '⬇️ Send Backward';
            downBtn.onclick = () => adjustLayer(-1);
            ctxMenu.appendChild(downBtn);

            const delBtn = document.createElement('button'); delBtn.className = 'outline-btn kokonut-btn'; 
            delBtn.style.color = 'var(--accent-alert)'; delBtn.style.borderColor = 'var(--accent-alert)'; delBtn.innerHTML = '✕ Delete Asset';
            delBtn.onclick = () => {
                getTargets().forEach(t => {
                    const tId = t.id.replace('map-token-', ''); t.remove(); delete window.mapAssets[tId];
                    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'token_remove', userId: window.myId, tokenId: tId }));
                });
                window.selectedTokens.clear(); window.saveMapState();
                ctxMenu.style.display = 'none';
            };
            ctxMenu.appendChild(delBtn);

            ctxMenu.style.left = e.clientX + 'px';
            ctxMenu.style.top = e.clientY + 'px';
            ctxMenu.style.display = 'flex';
        });

        // --- MOUSE DOWN DRAG LOGIC ---
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (window.currentTool !== 'selector') return; 

            if (e.target === resizeHandle) {
                window.resizingToken = el; window.startResizeW = el.offsetWidth; window.startResizeH = el.offsetHeight;
                window.startResizeAspect = window.startResizeW / window.startResizeH; window.startResizeX = e.clientX; e.stopPropagation();
            } else {
                if (e.shiftKey) {
                    if (window.selectedTokens.has(el)) { window.selectedTokens.delete(el); el.classList.remove('selected'); } 
                    else { window.selectedTokens.add(el); el.classList.add('selected'); }
                } else {
                    if (!window.selectedTokens.has(el)) { window.clearSelection(); window.selectedTokens.add(el); el.classList.add('selected'); }
                }
                window.activeToken = el; window.startDragX = e.clientX; window.startDragY = e.clientY; window.dragOffsets.clear();
                window.selectedTokens.forEach(t => { window.dragOffsets.set(t, { startX: parseFloat(t.style.left) || 0, startY: parseFloat(t.style.top) || 0 }); });
                e.stopPropagation();
            }
        });
    } else {
        if (asset.x !== undefined) el.style.left = asset.x + 'px'; if (asset.y !== undefined) el.style.top = asset.y + 'px';
        if (asset.w !== undefined) el.style.width = asset.w + 'px'; if (asset.h !== undefined) el.style.height = asset.h + 'px';
        if (asset.z !== undefined) el.style.zIndex = asset.z;
        window.applyVisibility(el, asset.hidden); window.mapAssets[asset.id] = asset;
    }
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'token_add', userId: window.myId, token: asset }));
};

window.setMapBackground = function(bgData, w, h) {
    const mapL = document.getElementById('vtt-map-layer'); const c1 = window.canvas || document.getElementById('shared-canvas');
    if (mapL && c1) {
        if (w && h) {
            window.mapWidth = w; window.mapHeight = h; mapL.style.width = w + 'px'; mapL.style.height = h + 'px';
            c1.width = w; c1.height = h; 
            window.updateCamera(); 
        }
        window.activeMapBg = bgData; window.saveMapState();
        mapL.style.backgroundImage = `url(${bgData})`; mapL.style.backgroundSize = '100% 100%'; mapL.style.backgroundPosition = 'top left';
    }
};

window.initCanvas = function() {
    window.canvas = document.getElementById('shared-canvas');
    if (!window.canvas) return;
    window.ctx = window.canvas.getContext('2d'); 
    
    if (!window.canvas.dataset.initialized) {
        window.canvas.width = window.mapWidth; window.canvas.height = window.mapHeight; 
        
        const mapLayer = document.getElementById('vtt-map-layer');
        if (mapLayer) {
            mapLayer.style.width = window.mapWidth + 'px'; mapLayer.style.height = window.mapHeight + 'px';
            mapLayer.addEventListener('mousedown', startDrawing); mapLayer.addEventListener('mousemove', draw);
            mapLayer.addEventListener('mouseup', stopDrawing); mapLayer.addEventListener('mouseout', stopDrawing);
        }
        window.addEventListener('resize', window.updateCamera);
        setTimeout(window.updateCamera, 100); 
        window.canvas.dataset.initialized = "true";
    }
    
    const dmControls = document.getElementById('dm-controls');
    if (dmControls && !document.getElementById('scenes-manager-btn')) {
        const btn = document.createElement('button'); btn.id = 'scenes-manager-btn'; btn.className = 'secondary-btn kokonut-btn';
        btn.innerHTML = '📁 Scenes'; btn.onclick = window.openSceneManager; dmControls.appendChild(btn);
    }
    window.setTool('selector');
};

window.openSceneManager = function() {
    let modal = document.getElementById('scene-manager-modal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'scene-manager-modal'; modal.className = 'scene-manager-modal'; document.body.appendChild(modal); }
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    if (modal.style.display === 'flex') window.renderScenesList();
};

window.renderScenesList = function() {
    const modal = document.getElementById('scene-manager-modal'); const scenes = JSON.parse(localStorage.getItem('conflict_scenes') || '[]');
    modal.innerHTML = `
        <h3 style="margin:0; font-size:16px;">Saved Scenes</h3>
        <div style="display:flex; gap:8px;">
            <input type="text" id="new-scene-name" class="kokonut-input" placeholder="Scene Name..." style="flex-grow:1; padding:6px; font-size:12px;">
            <button class="primary-btn kokonut-btn" onclick="window.saveSceneToVault()" style="padding:6px 10px; font-size:12px;">Save</button>
        </div>
        <div style="max-height: 200px; overflow-y: auto; display:flex; flex-direction:column; gap:6px; margin-top:10px;" id="scene-list-content"></div>
    `;
    const list = document.getElementById('scene-list-content');
    if (scenes.length === 0) list.innerHTML = '<span style="color:var(--text-muted); font-size:11px;">No scenes saved yet.</span>';
    
    scenes.forEach((sc, i) => {
        const item = document.createElement('div'); item.className = 'scene-item';
        item.innerHTML = `
            <span style="font-size:12px; font-weight:bold; color:var(--text-main);">${sc.name}</span>
            <div style="display:flex; gap:6px;">
                <button class="secondary-btn kokonut-btn" onclick="window.loadSceneFromVault(${i})" style="padding:4px 8px; font-size:11px;">Load</button>
                <button class="outline-btn kokonut-btn" onclick="window.deleteSceneFromVault(${i})" style="padding:4px 8px; font-size:11px; color:var(--accent-alert); border-color:var(--accent-alert);">✕</button>
            </div>
        `;
        list.appendChild(item);
    });
};

window.saveSceneToVault = function() {
    const name = document.getElementById('new-scene-name').value.trim() || 'Untitled Scene'; const scenes = JSON.parse(localStorage.getItem('conflict_scenes') || '[]');
    scenes.push({ name: name, img: window.activeMapBg, w: window.mapWidth, h: window.mapHeight, assets: window.mapAssets });
    localStorage.setItem('conflict_scenes', JSON.stringify(scenes)); window.renderScenesList();
};

window.deleteSceneFromVault = function(i) {
    const scenes = JSON.parse(localStorage.getItem('conflict_scenes') || '[]'); scenes.splice(i, 1); localStorage.setItem('conflict_scenes', JSON.stringify(scenes)); window.renderScenesList();
};

window.loadSceneFromVault = function(i) {
    const scenes = JSON.parse(localStorage.getItem('conflict_scenes') || '[]'); const sc = scenes[i]; if(!sc) return;
    document.getElementById('token-layer').innerHTML = ''; window.mapAssets = {};
    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'tokens_clear', userId: window.myId}));
    
    window.setMapBackground(sc.img, sc.w, sc.h);
    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: sc.img, w: sc.w, h: sc.h}));
    
    if (sc.assets) { Object.values(sc.assets).forEach(asset => window.placeTokenOnMap(asset, true)); }
    if (window.addChatLine) window.addChatLine('System', `🗺️ Loaded Scene: **${sc.name}**`, true);
    document.getElementById('scene-manager-modal').style.display = 'none';
};

window.setTool = function(tool) {
    window.currentTool = tool; 
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tool + '-tool')?.classList.add('active');
    if (window.ctx) window.ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    
    const mapLayer = document.getElementById('vtt-map-layer');
    if (mapLayer) {
        if (tool === 'selector') mapLayer.style.cursor = 'default';
        else if (tool === 'pen' || tool === 'eraser') mapLayer.style.cursor = 'crosshair';
    }
}

function getMousePosition(e) {
    const mapLayer = document.getElementById('vtt-map-layer'); const rect = mapLayer.getBoundingClientRect();
    return [(e.clientX - rect.left) / window.currentZoom, (e.clientY - rect.top) / window.currentZoom];
}

function startDrawing(e) {
    if (window.currentTool === 'selector') {
        if (e.button === 0 && !e.target.closest('.asset-item') && e.target.tagName !== 'BUTTON') {
            if (!e.shiftKey) window.clearSelection();
            window.initialSelectedTokens = new Set(window.selectedTokens); window.isBoxSelecting = true;
            if (!window.selectionBoxEl) {
                window.selectionBoxEl = document.createElement('div'); window.selectionBoxEl.className = 'selection-box';
                document.getElementById('vtt-map-layer').appendChild(window.selectionBoxEl);
            }
            const [mx, my] = getMousePosition(e); window.selectionStartX = mx; window.selectionStartY = my;
            window.selectionBoxEl.style.left = mx + 'px'; window.selectionBoxEl.style.top = my + 'px';
            window.selectionBoxEl.style.width = '0px'; window.selectionBoxEl.style.height = '0px'; window.selectionBoxEl.style.display = 'block';
        }
        return;
    }
    if (e.button !== 0 || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || window.activeToken || window.resizingToken) return; 
    window.isDrawing = true; [window.lastX, window.lastY] = getMousePosition(e); draw({ clientX: e.clientX + 0.1, clientY: e.clientY }); 
}

window.remoteDraw = function(data) {
    if (window.ctx) { window.ctx.beginPath(); window.ctx.moveTo(data.x0, data.y0); window.ctx.lineTo(data.x1, data.y1); window.ctx.strokeStyle = data.color; window.ctx.lineWidth = data.width; window.ctx.stroke(); }
};

function draw(e) {
    if (!window.isDrawing || !window.ctx) return; const [currentX, currentY] = getMousePosition(e);
    window.ctx.beginPath(); window.ctx.moveTo(window.lastX, window.lastY); window.ctx.lineTo(currentX, currentY); window.ctx.strokeStyle = window.strokeColor; window.ctx.lineWidth = window.strokeWidth; window.ctx.stroke();
    if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'canvas_draw', userId: window.myId, x0: window.lastX, y0: window.lastY, x1: currentX, y1: currentY, color: window.strokeColor, width: window.strokeWidth }));
    
    [window.lastX, window.lastY] = [currentX, currentY];
}

function stopDrawing() {
    if (window.isDrawing && window.ctx) { window.ctx.stroke(); window.ctx.beginPath(); }
    window.isDrawing = false;
}

if (window.vttChangeHandler) document.removeEventListener('change', window.vttChangeHandler);
window.vttChangeHandler = (e) => {
    if (e.target.id === 'stroke-color') { window.strokeColor = e.target.value; if (window.ctx) window.ctx.strokeStyle = window.strokeColor; }
    if (e.target.id === 'stroke-width') { window.strokeWidth = parseInt(e.target.value); if (window.ctx) { window.ctx.lineWidth = window.strokeWidth; window.ctx.lineCap = 'round'; window.ctx.lineJoin = 'round'; } }
    if (e.target.id === 'map-file-input') {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const bgData = event.target.result; const img = new Image();
            img.onload = () => {
                if (window.setMapBackground) window.setMapBackground(bgData, img.width, img.height);
                if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: bgData, w: img.width, h: img.height}));
            };
            img.src = bgData;
        };
        reader.readAsDataURL(file);
    }
    if (e.target.id === 'token-upload') {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const asset = { id: window.myId + '-' + Math.random().toString(36).substring(2, 9), name: file.name.split('.')[0], src: ev.target.result, type: 'token', ownerId: window.myId };
            const tokenLibrary = document.getElementById('token-library'); if (!tokenLibrary) return;
            const tokenEl = document.createElement('div'); tokenEl.className = 'token-item';
            tokenEl.innerHTML = `<img src="${asset.src}" alt="${asset.name}" class="token-preview"><div class="token-name">${asset.name}</div>`;
            tokenEl.onclick = () => window.placeTokenOnMap(asset, true);
            tokenLibrary.appendChild(tokenEl);
        };
        reader.readAsDataURL(file);
    }
};
document.addEventListener('change', window.vttChangeHandler);

if (window.vttClickHandler) document.removeEventListener('click', window.vttClickHandler);
window.vttClickHandler = (e) => {
    if (e.target.closest('#selector-tool')) { window.setTool('selector'); return; }
    if (e.target.closest('#pen-tool')) { window.setTool('pen'); return; }
    if (e.target.closest('#eraser-tool')) { window.setTool('eraser'); return; }
    
    if (e.target.closest('#clear-canvas-btn')) {
        if (confirm('Clear the ink?')) {
            if (window.ctx) window.ctx.clearRect(0, 0, window.canvas.width, window.canvas.height);
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'canvas_clear', userId: window.myId}));
        }
        return;
    }
    if (e.target.closest('#toggle-tokens-btn')) {
        const panel = document.getElementById('floating-token-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; return;
    }
    const claimDmBtn = e.target.closest('#claim-dm-btn');
    if (claimDmBtn) {
        window.isDM = !window.isDM;
        const btn = document.getElementById('claim-dm-btn'); const controls = document.getElementById('dm-controls'); const sysSelect = document.getElementById('rpg-system-select'); const tabDm = document.getElementById('tab-dm-btn'); const viewPartyBtn = document.getElementById('view-party-btn'); const dmForceSys = document.getElementById('dm-force-system'); const currentName = document.getElementById('display-username')?.textContent || 'DM'; 
        
        if (window.isDM) {
            document.body.classList.add('dm-mode');
            if (btn) { btn.innerText = "👑 Release DM"; btn.style.background = "#fbbf24"; btn.style.color = "#000"; }
            if (controls) controls.style.display = "flex"; if (tabDm) tabDm.style.display = 'inline-block'; if (viewPartyBtn) viewPartyBtn.style.display = 'inline-block'; if (dmForceSys) dmForceSys.style.display = 'inline-block'; 
            if (window.socket && window.socket.readyState === WebSocket.OPEN) {
                if (sysSelect) window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: sysSelect.value }));
                window.socket.send(JSON.stringify({ action: 'request_sheets' })); window.socket.send(JSON.stringify({ action: 'claim_dm', userId: window.myId, username: currentName }));
            }
            if (window.fs && window.mapSavePath && window.fs.existsSync(window.mapSavePath)) {
                const restoreBtn = document.getElementById('restore-map-btn'); if (restoreBtn) restoreBtn.style.display = "block";
            }
        } else {
            document.body.classList.remove('dm-mode');
            if (btn) { btn.innerText = "👑 Claim DM"; btn.style.background = "transparent"; btn.style.color = "#fbbf24"; }
            if (controls) controls.style.display = "none"; if (tabDm) tabDm.style.display = 'none'; if (viewPartyBtn) viewPartyBtn.style.display = 'none'; if (window.viewingParty && viewPartyBtn) viewPartyBtn.click();
            if (typeof window.setTool === 'function') window.setTool('selector'); 
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'release_dm', userId: window.myId, username: currentName }));
        }
        return;
    }
    if (e.target.closest('#restore-map-btn')) {
        if (window.fs && window.mapSavePath && window.fs.existsSync(window.mapSavePath)) {
            try {
                const savedData = window.fs.readFileSync(window.mapSavePath, 'utf-8');
                let parsed = JSON.parse(savedData);
                document.getElementById('token-layer').innerHTML = ''; window.mapAssets = {};
                if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'tokens_clear', userId: window.myId}));
                window.setMapBackground(parsed.img, parsed.w, parsed.h);
                if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: parsed.img, w: parsed.w, h: parsed.h}));
                if (parsed.assets) Object.values(parsed.assets).forEach(asset => window.placeTokenOnMap(asset, true));
                if (window.addChatLine) window.addChatLine('System', "🗺️ Saved State restored from hard drive.", true);
            } catch (error) {}
        }
        return;
    }
    if (e.target.closest('#map-upload-btn')) { document.getElementById('map-file-input')?.click(); return; }
    if (e.target.closest('#add-token-btn')) { document.getElementById('token-upload')?.click(); return; }
};
document.addEventListener('click', window.vttClickHandler);