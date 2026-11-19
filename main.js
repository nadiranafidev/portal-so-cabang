/**
 * main.js
 * Entry point utama aplikasi Electron Portal SO Cabang.
 */

const {
  app,
  BrowserWindow,
  BrowserView,
  session,
  shell,
  globalShortcut,
  ipcMain,
  Menu
} = require('electron');
const path = require('path');
const { getWebsiteUrl, isValidUrl, ALLOWED_DOMAINS } = require('./config');
const { initUpdater, checkForUpdates } = require('./updater');

// ─────────────────────────────────────────────
// Konstanta
// ─────────────────────────────────────────────

const APP_VERSION = app.getVersion();

// Nonaktifkan hardware acceleration jika ada masalah render (opsional, aktifkan jika perlu)
// app.disableHardwareAcceleration();

// ─────────────────────────────────────────────
// State global
// ─────────────────────────────────────────────

let mainWindow = null;
let webView = null;
let loadingWindow = null;
let currentUrl = null;
let isFullscreen = false;

// ─────────────────────────────────────────────
// Utilitas
// ─────────────────────────────────────────────

/**
 * Periksa apakah URL termasuk domain yang diizinkan untuk navigasi internal.
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    // Izinkan http hanya untuk localhost (development)
    if (parsed.protocol === 'file:') return false;
    if (parsed.protocol === 'about:') return true;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Buka URL di browser default sistem jika bukan domain yang diizinkan.
 * @param {string} url
 */
function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(url);
    }
  } catch {
    console.warn('[Main] URL eksternal tidak valid:', url);
  }
}

// ─────────────────────────────────────────────
// Loading Window
// ─────────────────────────────────────────────

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    transparent: false,
    resizable: false,
    skipTaskbar: false,
    center: true,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  loadingWindow.loadFile('loading.html', {
    query: { v: APP_VERSION }
  });

  loadingWindow.once('ready-to-show', () => {
    loadingWindow.show();
  });
}

// ─────────────────────────────────────────────
// Main Window
// ─────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Portal SO Cabang',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      preload: path.join(__dirname, 'preload.js'),
      // Gunakan session persisten agar login tersimpan
      partition: 'persist:portalsocabang'
    },
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  // Hapus menu bar bawaan Electron
  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  // Muat halaman loading sementara
  mainWindow.loadFile('loading.html', {
    query: { v: APP_VERSION }
  });

  // ── Event: window siap ditampilkan ──
  mainWindow.once('ready-to-show', () => {
    // Jangan tampilkan dulu, tunggu website selesai dimuat
  });

  // ── Event: window ditutup ──
  mainWindow.on('closed', () => {
    mainWindow = null;
    webView = null;
  });

  return mainWindow;
}

// ─────────────────────────────────────────────
// WebContentsView / BrowserView untuk website
// ─────────────────────────────────────────────

/**
 * Buat dan pasang BrowserView untuk memuat website.
 * BrowserView memastikan website tidak mendapat akses Node.js.
 * @param {string} url
 */
function loadWebsite(url) {
  if (!mainWindow) return;

  // Gunakan session persisten yang sama
  const persistSession = session.fromPartition('persist:portalsocabang');

  // Konfigurasi permission handler
  persistSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['notifications', 'clipboard-read'];
    callback(allowedPermissions.includes(permission));
  });

  // Buat BrowserView
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      session: persistSession,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setBrowserView(view);
  webView = view;

  // Sesuaikan bounds BrowserView dengan ukuran window
  function updateViewBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  }

  updateViewBounds();
  mainWindow.on('resize', updateViewBounds);

  // ── Navigasi handler ──
  view.webContents.on('will-navigate', (event, navUrl) => {
    if (!isAllowedNavigation(navUrl)) {
      event.preventDefault();
      openExternal(navUrl);
      console.log('[Main] Navigasi eksternal dibuka di browser:', navUrl);
    }
  });

  view.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    if (isAllowedNavigation(newUrl)) {
      // Izinkan popup untuk OAuth
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 650,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            session: persistSession
          }
        }
      };
    }
    openExternal(newUrl);
    return { action: 'deny' };
  });

  // ── Loading events ──
  view.webContents.on('did-start-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('Memuat... – Portal SO Cabang');
    }
  });

  view.webContents.on('did-finish-load', () => {
    console.log('[Main] Halaman selesai dimuat:', view.webContents.getURL());

    if (mainWindow && !mainWindow.isDestroyed()) {
      const pageTitle = view.webContents.getTitle();
      mainWindow.setTitle(
        pageTitle ? `${pageTitle} – Portal SO Cabang` : 'Portal SO Cabang'
      );

      // Tampilkan main window dan tutup loading window
      if (!mainWindow.isVisible()) {
        mainWindow.show();
        if (loadingWindow && !loadingWindow.isDestroyed()) {
          setTimeout(() => {
            if (loadingWindow && !loadingWindow.isDestroyed()) {
              loadingWindow.close();
              loadingWindow = null;
            }
          }, 400);
        }
      }
    }
  });

  view.webContents.on('page-title-updated', (event, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title ? `${title} – Portal SO Cabang` : 'Portal SO Cabang');
    }
  });

  // ── Error handler ──
  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // Abaikan error navigasi yang dibatalkan (misalnya redirect)
    if (errorCode === -3) return;

    console.error(`[Main] Gagal memuat: ${errorDescription} (${errorCode}) | URL: ${validatedURL}`);

    // Tampilkan halaman error
    const encodedUrl = encodeURIComponent(validatedURL || url);
    mainWindow.loadFile('error.html', {
      query: { url: encodedUrl, v: APP_VERSION }
    });

    // Pastikan main window ditampilkan
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        loadingWindow.close();
        loadingWindow = null;
      }
    }
  });

  // ── Muat URL website ──
  console.log('[Main] Memuat URL:', url);
  view.webContents.loadURL(url, {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PortalSOCabang/' +
      APP_VERSION
  });
}

// ─────────────────────────────────────────────
// Shortcut Keyboard
// ─────────────────────────────────────────────

function registerShortcuts() {
  // F5 - Refresh
  globalShortcut.register('F5', () => {
    if (webView && !webView.webContents.isDestroyed()) {
      webView.webContents.reload();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  // Ctrl+R - Refresh
  globalShortcut.register('CommandOrControl+R', () => {
    if (webView && !webView.webContents.isDestroyed()) {
      webView.webContents.reload();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  // F11 - Toggle Fullscreen
  globalShortcut.register('F11', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    isFullscreen = !isFullscreen;
    mainWindow.setFullScreen(isFullscreen);
  });

  // Escape - Keluar dari fullscreen
  globalShortcut.register('Escape', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      isFullscreen = false;
      mainWindow.setFullScreen(false);
    }
  });

  // F12 - DevTools (hanya mode development)
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    globalShortcut.register('F12', () => {
      if (webView && !webView.webContents.isDestroyed()) {
        webView.webContents.toggleDevTools();
      }
    });
  }

  console.log('[Main] Shortcut keyboard terdaftar.');
}

// ─────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log('[Main] Aplikasi dimulai. Versi:', APP_VERSION);

  // Tampilkan loading window
  createLoadingWindow();

  // Buat main window
  createMainWindow();

  // Ambil URL website (GitHub → cache → default)
  currentUrl = await getWebsiteUrl();
  console.log('[Main] URL website yang akan dimuat:', currentUrl);

  // Muat website
  loadWebsite(currentUrl);

  // Daftarkan shortcut keyboard
  registerShortcuts();

  // Inisialisasi updater
  initUpdater(mainWindow);

  // Periksa update setelah 5 detik agar tidak mengganggu startup
  setTimeout(() => {
    // Hanya periksa update jika bukan mode development
    if (process.env.NODE_ENV !== 'development' && !process.argv.includes('--dev')) {
      checkForUpdates();
    }
  }, 5000);
});

// Tutup aplikasi saat semua window ditutup (kecuali macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Bersihkan shortcut saat keluar
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  console.log('[Main] Aplikasi ditutup. Shortcut dibersihkan.');
});

// ─────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────

ipcMain.on('app-ready', () => {
  console.log('[Main] IPC: app-ready diterima');
});

ipcMain.on('page-loaded', () => {
  console.log('[Main] IPC: page-loaded diterima');
});

ipcMain.on('page-error', (event, errorInfo) => {
  console.error('[Main] IPC: page-error diterima:', errorInfo);
});
