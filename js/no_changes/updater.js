// ==========================================
// IMMUTABLE MODULE: AUTO-UPDATER UI (js/no_changes/updater.js)
// ==========================================
(function () {
    let ipcRenderer = null;
    try {
        if (typeof require !== 'undefined') {
            ipcRenderer = require('electron').ipcRenderer;
        }
    } catch (e) {}

    if (!ipcRenderer) return;

    function getUpdateStrings() {
        const lang = (localStorage.getItem('conflictLang') || 'en').toLowerCase();
        if (lang === 'pt-br') {
            return {
                found: (v) => `Atualização ${v ? 'v' + v + ' ' : ''}encontrada! Baixando...`,
                downloading: (p) => `Baixando atualização... ${p}%`,
                ready: 'Atualização concluída! Reiniciando o Conflict...'
            };
        }
        return {
            found: (v) => `Update ${v ? 'v' + v + ' ' : ''}found! Downloading...`,
            downloading: (p) => `Downloading update... ${p}%`,
            ready: 'Update complete! Restarting Conflict...'
        };
    }

    function showUpdateOverlay(message, percent) {
        const overlay = document.getElementById('update-overlay');
        const msgEl = document.getElementById('update-msg');
        const barEl = document.getElementById('update-progress-bar');

        if (overlay) overlay.style.display = 'flex';
        if (msgEl && message) msgEl.innerText = message;
        if (barEl && typeof percent === 'number') {
            barEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
    }

    ipcRenderer.removeAllListeners('update_available');
    ipcRenderer.removeAllListeners('download_progress');
    ipcRenderer.removeAllListeners('update_downloaded');

    ipcRenderer.on('update_available', (event, version) => {
        const str = getUpdateStrings();
        showUpdateOverlay(str.found(version), 0);
    });

    ipcRenderer.on('download_progress', (event, percent) => {
        const str = getUpdateStrings();
        const rounded = Math.round(Number(percent) || 0);
        showUpdateOverlay(str.downloading(rounded), rounded);
    });

    ipcRenderer.on('update_downloaded', () => {
        const str = getUpdateStrings();
        showUpdateOverlay(str.ready, 100);
        setTimeout(() => {
            ipcRenderer.send('restart_app');
        }, 2000);
    });
})();