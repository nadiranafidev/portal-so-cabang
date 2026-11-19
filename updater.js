/**
 * updater.js
 * Mengelola sistem auto update menggunakan electron-updater dan GitHub Releases.
 */

const { autoUpdater } = require('electron-updater');
const { dialog, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Referensi ke window utama
let mainWindowRef = null;

/**
 * Inisialisasi updater.
 * @param {BrowserWindow} mainWindow
 */
function initUpdater(mainWindow) {
  mainWindowRef = mainWindow;

  // Konfigurasi updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Log updater ke console
  autoUpdater.logger = {
    info: (msg) => console.log('[Updater]', msg),
    warn: (msg) => console.warn('[Updater]', msg),
    error: (msg) => console.error('[Updater]', msg),
    debug: (msg) => console.log('[Updater DEBUG]', msg)
  };

  // === Event Handlers ===

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Memeriksa update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update tersedia:', info.version);

    dialog.showMessageBox(mainWindowRef, {
      type: 'info',
      title: 'Update Tersedia',
      message: `Versi baru ${info.version} tersedia.`,
      detail: 'Apakah Anda ingin mengunduh dan memasang update sekarang?',
      buttons: ['Unduh Sekarang', 'Nanti'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(__dirname, 'assets', 'icon.ico')
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    }).catch((err) => {
      console.error('[Updater] Error dialog update available:', err.message);
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] Tidak ada update. Versi saat ini terbaru:', info.version);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.floor(progressObj.percent);
    const speed = (progressObj.bytesPerSecond / 1024).toFixed(1);
    const transferred = (progressObj.transferred / 1024 / 1024).toFixed(1);
    const total = (progressObj.total / 1024 / 1024).toFixed(1);
    console.log(
      `[Updater] Mengunduh: ${percent}% | ${transferred}MB / ${total}MB | ${speed} KB/s`
    );

    // Kirim progres ke renderer jika window tersedia
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.setProgressBar(progressObj.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update berhasil diunduh:', info.version);

    // Reset progress bar
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.setProgressBar(-1);
    }

    dialog.showMessageBox(mainWindowRef, {
      type: 'info',
      title: 'Update Siap Dipasang',
      message: `Update versi ${info.version} siap dipasang.`,
      detail:
        'Aplikasi akan restart untuk memasang update. Data login dan konfigurasi Anda tidak akan terhapus.',
      buttons: ['Restart & Pasang', 'Nanti'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(__dirname, 'assets', 'icon.ico')
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    }).catch((err) => {
      console.error('[Updater] Error dialog update downloaded:', err.message);
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);

    // Reset progress bar jika sedang download
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.setProgressBar(-1);
    }

    // Tampilkan error hanya jika bukan error jaringan biasa
    const isNetworkError =
      err.message.includes('net::') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('ECONNREFUSED');

    if (!isNetworkError) {
      dialog.showMessageBox(mainWindowRef, {
        type: 'warning',
        title: 'Gagal Memeriksa Update',
        message: 'Terjadi kesalahan saat memeriksa update.',
        detail: err.message,
        buttons: ['OK']
      }).catch(() => {});
    }
  });
}

/**
 * Periksa update secara manual.
 * Dipanggil setelah aplikasi sepenuhnya siap.
 */
function checkForUpdates() {
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[Updater] Gagal memulai pemeriksaan update:', err.message);
  }
}

module.exports = {
  initUpdater,
  checkForUpdates
};
