window.conflictTranslations = {
    'en': {
        'joinCall': '🎙️ Join Call', 'listening': '🎧 Listening', 'mute': '🔇 Mute', 'unmute': '🔈 Unmute',
        'camera': '📷 Camera', 'stopCam': '📷 Stop Cam', 'shareScreen': '💻 Share Screen', 'stopShare': '💻 Stop Share',
        'claimDm': '👑 Claim DM', 'releaseDm': '👑 Release DM', 'chatPlaceholder': 'Message the room...',
        'settings': '⚙️ Settings', 'leaveRoom': '🚪 Leave Room', 'partySheets': '👁️ Party Sheets',
        'myCharacter': '👤 My Character', 'newCharacter': '➕ New Character', 'mapUpload': '🗺️ Upload Map',
        'restoreMap': '♻️ Restore Map', 'addToken': '♟️ Add Token', 'clearCanvas': '🗑️ Clear Ink',
        'enableFog': '🌫️ Enable Fog', 'disableFog': '🌫️ Disable Fog', 'langLabel': 'Language',
        'hostGame': '🏰 Host Game', 'joinGame': '🔗 Join Game', 'scanRooms': '📡 Scan for Rooms',
        'charVault': '🛡️ Character Vault', 'updateCheck': 'Checking for updates...', 'radarScanning': 'Scanning network...'
    },
    'pt-br': {
        'joinCall': '🎙️ Entrar na call', 'listening': '🎧 Ouvindo', 'mute': '🔇 Mutar', 'unmute': '🔈 Desmutar',
        'camera': '📷 Câmera', 'stopCam': '📷 Parar Câm', 'shareScreen': '💻 Compartilhar Tela', 'stopShare': '💻 Parar compartilhamento',
        'claimDm': '👑 Assumir DM', 'releaseDm': '👑 Liberar DM', 'chatPlaceholder': 'Mensagem para a sala...',
        'settings': '⚙️ Configurações', 'leaveRoom': '🚪 Sair da Sala', 'partySheets': '👁️ Fichas da Mesa',
        'myCharacter': '👤 Minha Ficha', 'newCharacter': '➕ Nova Ficha', 'mapUpload': '🗺️ Enviar Mapa',
        'restoreMap': '♻️ Restaurar Mapa', 'addToken': '♟️ Add Token', 'clearCanvas': '🗑️ Limpar Desenho',
        'enableFog': '🌫️ Ativar Névoa', 'disableFog': '🌫️ Desativar Névoa', 'langLabel': 'Idioma',
        'hostGame': '🏰 Hospedar Jogo', 'joinGame': '🔗 Entrar numa Sala', 'scanRooms': '📡 Procurar Salas',
        'charVault': 'Fichas de personagem', 'updateCheck': 'Procurando atualizações...', 'radarScanning': 'Pesquisando na rede...'
    }
};

window.applyLang = function(lang) {
    if (!window.conflictTranslations[lang]) lang = 'en';
    localStorage.setItem('conflictLang', lang); 
    const t = window.conflictTranslations[lang];

    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    const setPlh = (id, txt) => { const el = document.getElementById(id); if (el) el.placeholder = txt; };

    if(document.getElementById('join-voice-btn') && !document.getElementById('join-voice-btn').disabled) setTxt('join-voice-btn', t.joinCall);
    setTxt('mute-mic-btn', window.isMuted ? t.unmute : t.mute);
    setTxt('toggle-cam-btn', window.localCamStream ? t.stopCam : t.camera);
    setTxt('share-screen-btn', window.localScreenStream ? t.stopShare : t.shareScreen);
    setTxt('settings-btn', t.settings); setTxt('leave-room-btn', t.leaveRoom);
    setTxt('claim-dm-btn', window.isDM ? t.releaseDm : t.claimDm);
    setTxt('view-party-btn', window.viewingParty ? t.myCharacter : t.partySheets);
    setTxt('new-char-btn', t.newCharacter); setTxt('map-upload-btn', t.mapUpload);
    setTxt('restore-map-btn', t.restoreMap); setTxt('add-token-btn', t.addToken);
    setTxt('clear-canvas-btn', t.clearCanvas); setTxt('lang-label', t.langLabel);
    
    setTxt('host-game-btn', t.hostGame); setTxt('join-game-btn', t.joinGame);
    setTxt('scan-rooms-btn', t.scanRooms); 
    setTxt('char-vault-title', t.charVault);
    setTxt('tab-vault-btn', t.charVault);
    
    setPlh('chat-input', t.chatPlaceholder);
    const fogBtn = document.getElementById('toggle-fog-btn');
    if (fogBtn) fogBtn.innerText = document.getElementById('fog-canvas')?.style.display === 'none' ? t.enableFog : t.disableFog;
    const selectEl = document.getElementById('language-select');
    if (selectEl) selectEl.value = lang;
};

document.addEventListener('DOMContentLoaded', () => {
    let savedLang = localStorage.getItem('conflictLang');
    if (!savedLang) savedLang = navigator.language.toLowerCase().includes('pt') ? 'pt-br' : 'en';
    window.applyLang(savedLang);
    document.getElementById('language-select')?.addEventListener('change', (e) => window.applyLang(e.target.value));
});
