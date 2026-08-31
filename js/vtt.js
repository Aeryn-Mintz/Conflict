window.canvas = null; window.ctx = null;
let fogCanvas = null, fogCtx = null;
let isDrawing = false, lastX = 0, lastY = 0;
window.activeToken = null;

let isPanning = false, startPanX = 0, startPanY = 0, startScrollLeft = 0, startScrollTop = 0;
window.currentZoom = 1.0;

const scrollArea = document.getElementById('vtt-scroll-area');
const mapLayer = document.getElementById('vtt-map-layer');

scrollArea?.addEventListener('wheel', (e) => {
    e.preventDefault(); 
    const zoomStep = 0.1;
    if (e.deltaY < 0) window.currentZoom = Math.min(3.0, window.currentZoom + zoomStep);
    else window.currentZoom = Math.max(0.3, window.currentZoom - zoomStep);
    mapLayer.style.transform = `scale(${window.currentZoom})`;
    mapLayer.style.transformOrigin = "0 0";
}, { passive: false }); 

scrollArea?.addEventListener('mousedown', (e) => {
    if (e.button === 1) { 
        isPanning = true; startPanX = e.clientX; startPanY = e.clientY;
        startScrollLeft = scrollArea.scrollLeft; startScrollTop = scrollArea.scrollTop;
        scrollArea.style.cursor = 'grabbing'; e.preventDefault(); 
    }
});
window.addEventListener('mousemove', (e) => {
    if (isPanning && scrollArea) { scrollArea.scrollLeft = startScrollLeft - (e.clientX - startPanX); scrollArea.scrollTop = startScrollTop - (e.clientY - startPanY); }
    if (!window.activeToken || !mapLayer || !window.canvas || isPanning) return;

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
    if (e.button === 1 && scrollArea) { isPanning = false; scrollArea.style.cursor = 'grab'; }
    window.activeToken = null; 
});

window.initCanvas = function() {
    window.canvas = document.getElementById('shared-canvas');
    fogCanvas = document.getElementById('fog-canvas');
    if (!window.canvas || !fogCanvas) return;
    window.ctx = window.canvas.getContext('2d'); fogCtx = fogCanvas.getContext('2d');
    
    if (!window.canvas.dataset.initialized) {
        window.canvas.width = 3000; window.canvas.height = 3000;
        fogCanvas.width = 3000; fogCanvas.height = 3000;
        
        mapLayer.addEventListener('mousedown', startDrawing);
        mapLayer.addEventListener('mousemove', draw);
        mapLayer.addEventListener('mouseup', stopDrawing);
        mapLayer.addEventListener('mouseout', stopDrawing);
        
        document.getElementById('pen-tool').addEventListener('click', () => setTool('pen'));
        document.getElementById('eraser-tool').addEventListener('click', () => setTool('eraser'));
        document.getElementById('fog-brush-tool').addEventListener('click', () => setTool('fog-brush'));
        document.getElementById('clear-canvas-btn').addEventListener('click', () => {
            if (confirm('Clear the ink?')) {
                window.ctx.clearRect(0, 0, window.canvas.width, window.canvas.height);
                if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'canvas_clear', userId: window.myId}));
            }
        });
        window.canvas.dataset.initialized = "true";
    }
};

let currentTool = 'pen';
let strokeColor = '#10b981';
let strokeWidth = 2;

document.getElementById('stroke-color')?.addEventListener('change', (e) => { strokeColor = e.target.value; if (window.ctx) window.ctx.strokeStyle = strokeColor; });
document.getElementById('stroke-width')?.addEventListener('input', (e) => { strokeWidth = parseInt(e.target.value); if (window.ctx) { window.ctx.lineWidth = strokeWidth; window.ctx.lineCap = 'round'; window.ctx.lineJoin = 'round'; } });

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tool + '-tool').classList.add('active');
    if (window.ctx) window.ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
}

function getMousePosition(e) {
    const rect = window.canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) / window.currentZoom, (e.clientY - rect.top) / window.currentZoom];
}

function startDrawing(e) {
    if (e.button !== 0 || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || window.activeToken) return; 
    isDrawing = true; [lastX, lastY] = getMousePosition(e);
}

window.remoteDraw = function(data) {
    if (window.ctx) {
        window.ctx.beginPath(); window.ctx.moveTo(data.x0, data.y0); window.ctx.lineTo(data.x1, data.y1);
        window.ctx.strokeStyle = data.color; window.ctx.lineWidth = data.width; window.ctx.stroke();
    }
};

function draw(e) {
    if (!isDrawing || currentTool === 'fog-brush' || !window.ctx) return;
    const [currentX, currentY] = getMousePosition(e);
    window.ctx.beginPath(); window.ctx.moveTo(lastX, lastY); window.ctx.lineTo(currentX, currentY);
    window.ctx.strokeStyle = strokeColor; window.ctx.lineWidth = strokeWidth; window.ctx.stroke();
    
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'canvas_draw', userId: window.myId, x0: lastX, y0: lastY, x1: currentX, y1: currentY, color: strokeColor, width: strokeWidth }));
    }
    [lastX, lastY] = [currentX, currentY];
}

function stopDrawing() {
    if (isDrawing && window.ctx && currentTool !== 'fog-brush') { window.ctx.stroke(); window.ctx.beginPath(); }
    isDrawing = false;
}

// -- TOKENS & DM TOOLS --
document.getElementById('toggle-tokens-btn')?.addEventListener('click', () => {
    const panel = document.getElementById('floating-token-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('claim-dm-btn')?.addEventListener('click', (e) => {
    window.isDM = !window.isDM;
    const btn = e.target;
    const controls = document.getElementById('dm-controls');
    const fogBrush = document.getElementById('fog-brush-tool');
    const sysSelect = document.getElementById('rpg-system-select');
    const currentName = document.getElementById('display-username').textContent;
    
    if (window.isDM) {
        btn.innerText = "👑 Release DM"; btn.style.background = "#fbbf24"; btn.style.color = "#000";
        controls.style.display = "flex"; fogBrush.style.display = "block";
        document.getElementById('tab-dm-btn').style.display = 'inline-block';
        
        sysSelect.disabled = false; sysSelect.title = "Select active campaign system";
        document.getElementById('view-party-btn').style.display = 'inline-block';
        document.getElementById('dm-force-system').style.display = 'inline-block';
        
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: sysSelect.value }));
            window.socket.send(JSON.stringify({ action: 'request_sheets' }));
            window.socket.send(JSON.stringify({ action: 'claim_dm', userId: window.myId, username: currentName }));
        }
        if (window.fs && window.fs.existsSync(window.mapSavePath)) document.getElementById('restore-map-btn').style.display = "block";
    } else {
        btn.innerText = "👑 Claim DM"; btn.style.background = "transparent"; btn.style.color = "#fbbf24";
        controls.style.display = "none"; fogBrush.style.display = "none";
        document.getElementById('tab-dm-btn').style.display = 'none';
        
        sysSelect.disabled = true; sysSelect.title = "Only the DM can change the campaign system";
        document.getElementById('view-party-btn').style.display = 'none';
        if (window.viewingParty) document.getElementById('view-party-btn').click(); 
        
        setTool('pen'); 
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({ action: 'release_dm', userId: window.myId, username: currentName }));
    }
});

document.getElementById('restore-map-btn')?.addEventListener('click', () => {
    if (window.fs && window.fs.existsSync(window.mapSavePath)) {
        try {
            const savedMap = window.fs.readFileSync(window.mapSavePath, 'utf-8');
            mapLayer.style.backgroundImage = `url(${savedMap})`;
            if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: savedMap}));
            window.addChatLine('System', "🗺️ Map restored from hard drive.", true);
        } catch (error) {}
    }
});

document.getElementById('map-upload-btn')?.addEventListener('click', () => document.getElementById('map-file-input').click());
document.getElementById('map-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const bgData = event.target.result;
        mapLayer.style.backgroundImage = `url(${bgData})`;
        try { window.fs.writeFileSync(window.mapSavePath, bgData, 'utf-8'); document.getElementById('restore-map-btn').style.display = "block"; } catch (error) {}
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'set_map_bg', image: bgData}));
    };
    reader.readAsDataURL(file);
});

document.getElementById('toggle-fog-btn')?.addEventListener('click', (e) => {
    const fog = document.getElementById('fog-canvas');
    if (fog.style.display !== 'none') {
        fog.style.display = 'none'; e.target.innerText = "🌫️ Enable Fog";
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'toggle_fog', enabled: false}));
    } else {
        fog.style.display = 'block'; fogCtx.fillStyle = '#000000'; fogCtx.fillRect(0, 0, fog.width, fog.height); e.target.innerText = "🌫️ Disable Fog";
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'toggle_fog', enabled: true}));
    }
});

window.placeTokenOnMap = function(asset, broadcast = true) {
    if (document.getElementById('map-token-' + asset.id)) return;
    const t = document.createElement('div');
    t.id = 'map-token-' + asset.id; t.className = 'map-token'; t.dataset.ownerId = asset.ownerId || '';
    
    const mapRect = mapLayer.getBoundingClientRect(); const scrollRect = scrollArea.getBoundingClientRect();
    let startX = Math.floor(((scrollRect.left + scrollRect.width / 2 - mapRect.left) / window.currentZoom) / 50) * 50 + 25;
    let startY = Math.floor(((scrollRect.top + scrollRect.height / 2 - mapRect.top) / window.currentZoom) / 50) * 50 + 25;
    
    t.style.left = (asset.x || startX) + 'px'; t.style.top = (asset.y || startY) + 'px'; t.style.backgroundImage = `url(${asset.src})`;

    const delBtn = document.createElement('div'); delBtn.className = 'token-delete'; delBtn.innerHTML = '✕';
    delBtn.onclick = (e) => {
        e.stopPropagation(); t.remove();
        if (window.socket && window.socket.readyState === WebSocket.OPEN) window.socket.send(JSON.stringify({action: 'token_remove', userId: window.myId, tokenId: asset.id}));
    };
    t.appendChild(delBtn);
    
    t.addEventListener('mousedown', (e) => { 
        if (e.target === delBtn) return; 
        if (t.dataset.ownerId && t.dataset.ownerId !== window.myId && !window.isDM) return;
        window.activeToken = t; 
    });

    document.getElementById('token-layer').appendChild(t);
    if (broadcast && window.socket && window.socket.readyState === WebSocket.OPEN) {
        asset.x = startX; asset.y = startY;
        window.socket.send(JSON.stringify({ action: 'token_add', userId: window.myId, token: asset }));
    }
};

document.getElementById('add-token-btn')?.addEventListener('click', () => document.getElementById('token-upload').click());
document.getElementById('token-upload')?.addEventListener('change', (event) => {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const asset = { id: window.myId + '-' + Math.random().toString(36).substring(2, 9), name: file.name.split('.')[0], src: e.target.result, type: 'token', ownerId: window.myId };
        const tokenLibrary = document.getElementById('token-library');
        const tokenEl = document.createElement('div'); tokenEl.className = 'token-item';
        tokenEl.innerHTML = `<img src="${asset.src}" alt="${asset.name}" class="token-preview"><div class="token-name">${asset.name}</div>`;
        tokenEl.onclick = () => window.placeTokenOnMap(asset, true);
        tokenLibrary.appendChild(tokenEl);
    };
    reader.readAsDataURL(file);
});

// -- DICE ENGINE --
window.triggerFireworks = function() {
    if (typeof confetti !== 'undefined') {
        var duration = 2 * 1000; var end = Date.now() + duration;
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-main').trim() || '#10b981';
        (function frame() {
            confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: [accentColor, '#fbbf24', '#ffffff'] });
            confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: [accentColor, '#fbbf24', '#ffffff'] });
            if (Date.now() < end) requestAnimationFrame(frame);
        }());
    }
};

window.animateDiceRoll2D = function(results, shapeType, customClasses = null) {
    const diceLayer = document.getElementById('dice-layer'); if (!diceLayer) return;
    diceLayer.innerHTML = ''; const sides = parseInt(shapeType.substring(1)) || 20;
    
    results.forEach((result, index) => {
        const dieEl = document.createElement('div'); dieEl.className = `die-2d shape-${shapeType}`;
        if (customClasses && customClasses[index]) dieEl.classList.add(customClasses[index]);
        dieEl.style.setProperty('--tx', `${(Math.random() * 200 - 100) + (index * 60)}px`); dieEl.style.setProperty('--ty', `${(Math.random() * 200 - 100)}px`);
        
        const textSpan = document.createElement('span'); dieEl.appendChild(textSpan); diceLayer.appendChild(dieEl);

        let scrambleInterval = setInterval(() => { textSpan.innerText = Math.floor(Math.random() * sides) + 1; }, 50);
        setTimeout(() => { clearInterval(scrambleInterval); textSpan.innerText = result; }, 1000);
    });
    setTimeout(() => { Array.from(diceLayer.children).forEach(child => { child.style.opacity = '0'; child.style.transform += ' scale(0.5)'; setTimeout(() => child.remove(), 500); }); }, 10000); 
};

window.rollDice = function(type, count = 1) {
    const results = []; const sides = parseInt(type.substring(1));
    const randomBuffer = new Uint32Array(count); window.crypto.getRandomValues(randomBuffer);
    for (let i = 0; i < count; i++) results.push(Math.floor((randomBuffer[i] / (0xffffffff + 1)) * sides) + 1);
    return results;
};

window.executeRollEvent = function(message, results, shapeType, customClasses = null) {
    const currentName = document.getElementById('display-username').textContent;
    window.addChatLine(currentName, message); window.animateDiceRoll2D(results, shapeType, customClasses);
    const sides = parseInt(shapeType.replace(/^\d+d/, '')) || 20;
    if (results.includes(sides)) window.triggerFireworks();
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: currentName, text: message }));
        window.socket.send(JSON.stringify({ action: 'dice_roll', userId: window.myId, results: results, type: shapeType, customClasses: customClasses }));
    }
};
window.updateTabletopRoller = function(system) {
    const container = document.getElementById('dynamic-dice-controls');
    if (!container) return;

    let html = '';

    if (system === 'dnd') {
        html += `
            <select id="tt-skill" class="config-select kokonut-select short-select" style="width:110px; font-size:11px; padding:4px;">
                <option value="str">Strength</option><option value="dex">Dexterity</option><option value="con">Constitution</option><option value="int">Intelligence</option><option value="wis">Wisdom</option><option value="cha">Charisma</option>
                <option disabled>--- Skills ---</option>
                <option value="sk_acro">Acrobatics</option><option value="sk_anim">Animal Handling</option><option value="sk_arca">Arcana</option><option value="sk_athl">Athletics</option><option value="sk_dece">Deception</option><option value="sk_hist">History</option><option value="sk_ins">Insight</option><option value="sk_inti">Intimidation</option><option value="sk_inv">Investigation</option><option value="sk_med">Medicine</option><option value="sk_nat">Nature</option><option value="sk_perc">Perception</option><option value="sk_perf">Performance</option><option value="sk_pers">Persuasion</option><option value="sk_rel">Religion</option><option value="sk_slei">Sleight Hand</option><option value="sk_ste">Stealth</option><option value="sk_surv">Survival</option>
            </select>
            <button id="btn-roll-skill" class="primary-btn kokonut-btn glow-btn" style="padding:4px 10px; font-size:11px;">Roll Check</button>
            <div style="width:1px; height:15px; background:var(--border-color); margin:0 5px;"></div>
            <input type="number" id="tt-count" value="1" min="1" max="10" class="kokonut-input short-input" style="width:35px; padding:4px; text-align:center; font-size:11px;">
            <select id="tt-type" class="config-select kokonut-select short-select" style="width:60px; padding:4px; font-size:11px;">
                <option value="d4">d4</option><option value="d6">d6</option><option value="d8">d8</option><option value="d10">d10</option><option value="d12">d12</option><option value="d20" selected>d20</option><option value="d100">d100</option>
            </select>
            <button id="btn-roll-custom" class="secondary-btn kokonut-btn" style="padding:4px 10px; font-size:11px;">Custom</button>
        `;
    } else if (system === 'daggerheart') {
        html += `
            <select id="tt-skill" class="config-select kokonut-select short-select" style="width:110px; font-size:11px; padding:4px;">
                <option value="agility">Agility</option><option value="strength">Strength</option><option value="finesse">Finesse</option><option value="instinct">Instinct</option><option value="presence">Presence</option><option value="knowledge">Knowledge</option>
            </select>
            <button id="btn-roll-dh" class="primary-btn kokonut-btn glow-btn" style="padding:4px 10px; font-size:11px; background: linear-gradient(90deg, #3b82f6 50%, #eab308 50%); border:none;">Action Roll</button>
        `;
    } else if (system === 'aquelarre') {
        html += `
            <select id="tt-skill" class="config-select kokonut-select short-select" style="width:110px; font-size:11px; padding:4px;">
                <option value="str">Strength</option><option value="agi">Agility</option><option value="dex">Dexterity</option><option value="sta">Stamina</option><option value="per">Perception</option><option value="com">Communication</option><option value="cul">Culture</option>
                <option disabled>--- Skills ---</option>
                <option value="sk_alert">Alertness</option><option value="sk_brawl">Brawl</option><option value="sk_dodge">Dodge</option><option value="sk_emp">Empathy</option><option value="sk_elo">Eloquence</option><option value="sk_list">Listen</option><option value="sk_melee">Melee</option><option value="sk_mem">Memory</option><option value="sk_miss">Missiles</option><option value="sk_ride">Ride</option><option value="sk_stealth">Stealth</option><option value="sk_theo">Theology</option>
            </select>
            <button id="btn-roll-aquelarre" class="primary-btn kokonut-btn glow-btn" style="padding:4px 10px; font-size:11px;">Roll 1d100</button>
        `;
    } else if (system === 'vampire') {
        html += `
            <select id="tt-skill" class="config-select kokonut-select short-select" style="width:110px; font-size:11px; padding:4px;">
                <option value="str">Strength</option><option value="dex">Dexterity</option><option value="sta">Stamina</option><option value="cha">Charisma</option><option value="man">Manipulation</option><option value="com">Composure</option><option value="int">Intelligence</option><option value="wit">Wits</option><option value="res">Resolve</option>
            </select>
            <span style="font-size:11px; color:var(--text-muted);">Pool:</span>
            <input type="number" id="tt-count" value="1" min="1" max="15" class="kokonut-input short-input" style="width:35px; padding:4px; text-align:center; font-size:11px;">
            <button id="btn-roll-vampire" class="primary-btn kokonut-btn glow-btn" style="padding:4px 10px; font-size:11px; background:#ef4444;">Roll d10s</button>
        `;
    } else if (system === 'assimilacao') {
        html += `
            <select id="tt-skill" class="config-select kokonut-select short-select" style="width:110px; font-size:11px; padding:4px;">
                <option value="forca">Força</option><option value="agilidade">Agilidade</option><option value="metabolismo">Metabolismo</option><option value="intelecto">Intelecto</option><option value="raciocinio">Raciocínio</option><option value="percepcao">Percepção</option><option value="carisma">Carisma</option><option value="manipulacao">Manipulação</option><option value="proposito">Propósito</option>
                <option disabled>--- Perícias ---</option>
                <option value="sk_atl">Atletismo</option><option value="sk_fur">Furtividade</option><option value="sk_inv">Investigação</option><option value="sk_lut">Luta</option><option value="sk_med">Medicina</option><option value="sk_mir">Mira</option><option value="sk_sob">Sobrevivência</option><option value="sk_tec">Tecnologia</option>
            </select>
            <button id="btn-roll-assimilacao" class="primary-btn kokonut-btn glow-btn" style="padding:4px 10px; font-size:11px;">Teste (1d20)</button>
        `;
    }
    container.innerHTML = html;
};
document.getElementById('dynamic-dice-controls')?.addEventListener('click', (e) => {
    const sys = document.getElementById('rpg-system-select').value;
    const currentName = document.getElementById('display-username').textContent;

    if (e.target.id === 'btn-roll-custom') {
        const count = parseInt(document.getElementById('tt-count').value) || 1;
        const type = document.getElementById('tt-type').value;
        const results = window.rollDice(type, count);
        const sum = results.reduce((a, b) => a + b, 0);
        window.executeRollEvent(`🎲 **${currentName}** custom roll: [${results.join(', ')}] = **${sum}**`, results, type);
    }
    else if (e.target.id === 'btn-roll-skill') {
        const sel = document.getElementById('tt-skill'); const statName = sel.options[sel.selectedIndex].text;
        const char = window.getActiveCharMod ? window.getActiveCharMod(sys, sel.value) : {val:0, name:currentName};
        const results = window.rollDice('d20', 1); const total = results[0] + char.val; const modStr = char.val >= 0 ? `+${char.val}` : `${char.val}`;
        window.executeRollEvent(`🎲 **${char.name}** rolled **${statName}**: [${results[0]}] ${modStr} = **${total}**`, results, 'd20');
    }
    else if (e.target.id === 'btn-roll-dh') {
        const sel = document.getElementById('tt-skill'); const statName = sel.options[sel.selectedIndex].text;
        const char = window.getActiveCharMod ? window.getActiveCharMod(sys, sel.value) : {val:0, name:currentName};
        const results = window.rollDice('d12', 2); const total = results[0] + results[1] + char.val; const modStr = char.val >= 0 ? `+${char.val}` : `${char.val}`;
        let critText = ""; if (results[0] === results[1]) critText = (results[0] >= 10) ? " — **CRITICAL SUCCESS! 🎉**" : " — **CRITICAL WITH FEAR! ⚠️**";
        window.executeRollEvent(`🎲 **${char.name}** rolled **${statName}** (Daggerheart): <span style="color:#3b82f6">Hope ${results[0]}</span>, <span style="color:#eab308">Fear ${results[1]}</span> ${modStr} = **${total}**${critText}`, results, 'd12', ['dh-hope', 'dh-fear']);
    }
    else if (e.target.id === 'btn-roll-aquelarre') {
        const sel = document.getElementById('tt-skill'); const statName = sel.options[sel.selectedIndex].text;
        const char = window.getActiveCharMod ? window.getActiveCharMod(sys, sel.value) : {val:0, name:currentName};
        const results = window.rollDice('d100', 1);
        window.executeRollEvent(`🎲 **${char.name}** rolled **${statName}** check: **${results[0]}** (Target: ${char.val})`, results, 'd100');
    }
    else if (e.target.id === 'btn-roll-vampire') {
        const sel = document.getElementById('tt-skill'); const statName = sel.options[sel.selectedIndex].text;
        const char = window.getActiveCharMod ? window.getActiveCharMod(sys, sel.value) : {val:0, name:currentName};
        const count = parseInt(document.getElementById('tt-count').value) || 1;
        const results = window.rollDice('d10', count);
        const successes = results.filter(r => r >= 6).length; const crits = results.filter(r => r === 10).length; const finalSucc = successes + (Math.floor(crits / 2) * 2);
        window.executeRollEvent(`🎲 **${char.name}** rolled **${statName}**: [${results.join(', ')}] = **${finalSucc} Successes**`, results, 'd10');
    }
    else if (e.target.id === 'btn-roll-assimilacao') {
        const sel = document.getElementById('tt-skill'); const statName = sel.options[sel.selectedIndex].text;
        const char = window.getActiveCharMod ? window.getActiveCharMod(sys, sel.value) : {val:0, name:currentName};
        const results = window.rollDice('d20', 1); const total = results[0] + char.val; const modStr = char.val >= 0 ? `+${char.val}` : `${char.val}`;
        window.executeRollEvent(`🎲 **${char.name}** testou **${statName}**: [${results[0]}] ${modStr} = **${total}**`, results, 'd20');
    }
});
