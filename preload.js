/**
 * preload.js
 * Script preload yang berjalan di konteks renderer dengan akses terbatas.
 * contextIsolation: true memastikan halaman website tidak dapat mengakses Node.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Ekspos API terbatas ke renderer melalui contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Kirim event ke main process
   * @param {string} channel
   * @param  {...any} args
   */
  send: (channel, ...args) => {
    const allowedChannels = ['app-ready', 'page-loaded', 'page-error'];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  /**
   * Terima event dari main process
   * @param {string} channel
   * @param {Function} callback
   */
  on: (channel, callback) => {
    const allowedChannels = ['update-status', 'config-url'];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  }
});

// Konfirmasi preload dimuat
console.log('[Preload] Preload script dimuat. contextIsolation aktif.');
