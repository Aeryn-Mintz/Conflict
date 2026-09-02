// ==========================================
// CHAT ENGINE
// ==========================================
window.addChatLine = function(author, text, isSystem = false) {
    const chatMessagesEl = document.getElementById('chat-messages'); if(!chatMessagesEl) return;
    const line = document.createElement('div'); line.className = isSystem ? 'chat-line chat-system' : 'chat-line';
    let safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--accent-main); font-weight: 900;">$1</strong>');
    if (isSystem) line.innerHTML = safeText; else line.innerHTML = `<span class="chat-author">${author}:</span> <span>${safeText}</span>`;
    chatMessagesEl.appendChild(line); chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
};

document.getElementById('chat-send-btn')?.addEventListener('click', () => {
    const chatInput = document.getElementById('chat-input');
    const text = chatInput ? chatInput.value.trim() : ''; 
    if (!text) return;
    
    if (chatInput) chatInput.value = ''; 
    const name = document.getElementById('display-username')?.textContent || 'You';
    
    window.addChatLine(name, text); 
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: name, text: text }));
    }
});

document.getElementById('chat-input')?.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') document.getElementById('chat-send-btn').click(); 
});