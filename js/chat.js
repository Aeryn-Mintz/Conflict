// ==========================================
// CHAT ENGINE
// ==========================================
window.addChatLine = function(author, text, type = 'normal', avatar = null) {
    if (type === true) type = 'system'; // Retrocompatibilidade para os arquivos de mídia
    const chatMessagesEl = document.getElementById('chat-messages'); if(!chatMessagesEl) return;
    
    const line = document.createElement('div'); 
    line.className = type === 'system' ? 'chat-line chat-system' : 'chat-line user-chat-line';
    line.style.display = 'flex'; 
    line.style.gap = '10px'; 
    line.style.marginBottom = '12px'; 
    line.style.alignItems = 'flex-start';

    let safeText = text;
    // Trava de segurança: apenas mensagens normais de usuários perdem o HTML, dados e sistema fluem limpos
    if (type === 'normal') {
        safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--accent-main); font-weight: 900;">$1</strong>');
    }

    if (type === 'system') {
        line.style.justifyContent = 'center';
        safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--accent-main);">$1</strong>');
        line.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); font-style: italic; background: rgba(0,0,0,0.3); padding: 4px 12px; border-radius: 12px;">${safeText}</div>`;
    } else {
        const imgSrc = avatar || window.defaultAvatar || '';
        line.innerHTML = `
            <img src="${imgSrc}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border-color); flex-shrink: 0; margin-top: 2px;">
            <div style="display: flex; flex-direction: column; width: 100%;">
                <span style="font-size: 12px; font-weight: bold; color: var(--text-muted); margin-bottom: 2px;">${author}</span>
                <span style="font-size: 14px; color: var(--text-main); word-break: break-word; line-height: 1.4;">${safeText}</span>
            </div>
        `;
    }
    
    chatMessagesEl.appendChild(line); 
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
};

document.getElementById('chat-send-btn')?.addEventListener('click', () => {
    const chatInput = document.getElementById('chat-input');
    const text = chatInput ? chatInput.value.trim() : ''; 
    if (!text) return;
    
    if (chatInput) chatInput.value = ''; 
    const name = document.getElementById('display-username')?.textContent || 'You';
    const myAvatar = localStorage.getItem('appAvatar') || window.defaultAvatar;
    
    window.addChatLine(name, text, 'normal', myAvatar); 
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: name, text: text, avatar: myAvatar }));
    }
});

document.getElementById('chat-input')?.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('chat-send-btn').click(); 
    }
});