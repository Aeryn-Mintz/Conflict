const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

function setupUpdater() {
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox({
            type: 'info',
            title: 'Atualização Disponível',
            message: 'Uma nova versão do Conflict foi baixada! Reiniciar o app para instalar?',
            buttons: ['Reiniciar e Instalar', 'Mais Tarde']
        }).then((result) => {
            if (result.response === 0) autoUpdater.quitAndInstall();
        });
    });
}
module.exports = { setupUpdater };
