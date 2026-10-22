// ==========================================
// NOTES & LORE ENGINE (Personal & Party)
// ==========================================

window.notesData = { personal: [], party: [] };
window.currentNoteType = 'personal'; 
window.activeNoteId = null;

// Carrega as notas do HD
function loadNotes() {
    window.notesData.personal = JSON.parse(localStorage.getItem('conflict_notes_personal') || '[]');
    window.notesData.party = JSON.parse(localStorage.getItem('conflict_notes_party') || '[]');
}

// Salva e Sincroniza
function saveNotes() {
    localStorage.setItem('conflict_notes_personal', JSON.stringify(window.notesData.personal));
    localStorage.setItem('conflict_notes_party', JSON.stringify(window.notesData.party));
    
    // Se editamos uma nota da Party, enviamos para todos via WebSocket
    if (window.currentNoteType === 'party' && window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'sync_notes', notes: window.notesData.party }));
    }
}

// Recebendo atualização de notas da Party (Coloque isso também no core.js dentro do socket.onmessage se preferir)
const originalHandleSignal = window.handleWebRTCSignal; // Apenas para injetar no fluxo existente
document.addEventListener('DOMContentLoaded', () => {
    if (window.socket) {
        window.socket.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.action === 'sync_notes') {
                    window.notesData.party = data.notes;
                    localStorage.setItem('conflict_notes_party', JSON.stringify(window.notesData.party));
                    if (window.currentNoteType === 'party') renderNotesList();
                }
            } catch(e) {}
        });
    }
});

function renderFolders() {
    const select = document.getElementById('notes-folder-select');
    if (!select) return;
    const currentList = window.notesData[window.currentNoteType];
    
    // Extrai pastas únicas
    const folders = new Set(['Geral']);
    currentList.forEach(n => { if (n.folder) folders.add(n.folder); });
    
    const prevVal = select.value;
    select.innerHTML = '';
    folders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f; opt.innerText = f;
        select.appendChild(opt);
    });
    
    if (folders.has(prevVal)) select.value = prevVal;
    else select.value = 'Geral';
}

function renderNotesList() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    
    renderFolders();
    const activeFolder = document.getElementById('notes-folder-select').value;
    const currentList = window.notesData[window.currentNoteType].filter(n => (n.folder || 'Geral') === activeFolder);
    
    list.innerHTML = '';
    
    if (currentList.length === 0) {
        list.innerHTML = 'Nenhuma nota nesta pasta.';
        return;
    }

    currentList.forEach(note => {
        const el = document.createElement('div');
        el.className = 'scene-item'; // Aproveita o CSS existente
        el.style.cursor = 'pointer';
        el.style.borderColor = window.activeNoteId === note.id ? 'var(--accent-main)' : 'var(--border-color)';
        
        el.innerHTML = `${note.title || 'Sem Título'}`;
        el.onclick = () => loadNoteIntoEditor(note.id);
        list.appendChild(el);
    });
}

function loadNoteIntoEditor(id) {
    window.activeNoteId = id;
    const note = window.notesData[window.currentNoteType].find(n => n.id === id);
    if (!note) return;

    document.getElementById('note-title-input').value = note.title;
    document.getElementById('note-content-input').value = note.content;
    document.getElementById('delete-note-btn').style.display = 'block';
    renderNotesList(); // Atualiza a borda verde
}

document.addEventListener('click', (e) => {
    // Alternar entre Personal e Party
    if (e.target.id === 'btn-personal-notes') {
        window.currentNoteType = 'personal';
        e.target.classList.replace('secondary-btn', 'primary-btn');
        document.getElementById('btn-party-notes').classList.replace('primary-btn', 'secondary-btn');
        window.activeNoteId = null;
        document.getElementById('note-title-input').value = ''; document.getElementById('note-content-input').value = '';
        renderNotesList();
    }
    else if (e.target.id === 'btn-party-notes') {
        window.currentNoteType = 'party';
        e.target.classList.replace('secondary-btn', 'primary-btn');
        document.getElementById('btn-personal-notes').classList.replace('primary-btn', 'secondary-btn');
        window.activeNoteId = null;
        document.getElementById('note-title-input').value = ''; document.getElementById('note-content-input').value = '';
        renderNotesList();
    }
    
    // Adicionar Pasta
    else if (e.target.id === 'add-folder-btn') {
        const folderName = prompt("Nome da nova pasta:");
        if (folderName && folderName.trim() !== '') {
            const select = document.getElementById('notes-folder-select');
            const opt = document.createElement('option');
            opt.value = folderName; opt.innerText = folderName;
            select.appendChild(opt);
            select.value = folderName;
            renderNotesList();
        }
    }
    
    // Nova Nota
    else if (e.target.id === 'add-note-btn') {
        const newNote = {
            id: Math.random().toString(36).substr(2, 9),
            title: 'Nova Nota',
            content: '',
            folder: document.getElementById('notes-folder-select').value
        };
        window.notesData[window.currentNoteType].unshift(newNote);
        saveNotes();
        loadNoteIntoEditor(newNote.id);
    }
    
    // Salvar Nota Atual
    else if (e.target.id === 'save-note-btn') {
        if (!window.activeNoteId) return;
        const note = window.notesData[window.currentNoteType].find(n => n.id === window.activeNoteId);
        if (note) {
            note.title = document.getElementById('note-title-input').value;
            note.content = document.getElementById('note-content-input').value;
            saveNotes();
            renderNotesList();
            
            const status = document.getElementById('note-save-status');
            status.style.opacity = 1;
            setTimeout(() => status.style.opacity = 0, 2000);
        }
    }
    
    // Deletar Nota
    else if (e.target.id === 'delete-note-btn') {
        if (confirm("Tem certeza que deseja apagar esta anotação?")) {
            window.notesData[window.currentNoteType] = window.notesData[window.currentNoteType].filter(n => n.id !== window.activeNoteId);
            saveNotes();
            window.activeNoteId = null;
            document.getElementById('note-title-input').value = '';
            document.getElementById('note-content-input').value = '';
            e.target.style.display = 'none';
            renderNotesList();
        }
    }
});

// Listener para troca de pastas
document.addEventListener('change', (e) => {
    if (e.target.id === 'notes-folder-select') {
        window.activeNoteId = null;
        document.getElementById('note-title-input').value = ''; document.getElementById('note-content-input').value = '';
        renderNotesList();
    }
});

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    loadNotes();
    setTimeout(renderNotesList, 500); // Dá tempo para o UI renderizar
});