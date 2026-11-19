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
const PARTITION    = 'persist:portalsocabang';

// Timeout maksimal menunggu website (ms). Jika lewat, window tetap ditampilkan.
const LOAD_SHOW_TIMEOUT = 15000;

// ─────────────────────────────────────────────
// State global
// ─────────────────────────────────────────────

let mainWindow   = null;
let webView      = null;
let currentUrl   = null;
let isFullscreen = false;
let windowShown  = false; // flag agar show() hanya dipanggil sekali

// ─────────────────────────────────────────────
// Utilitas navigasi
// ─────────────────────────────────────────────

/**
 * Domain yang boleh dibuka di dalam aplikasi (navigasi internal).
 * Ini termasuk domain OAuth Google agar popup / redirect bisa berjalan.
 */
function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol === 'file:')  return false;
    if (parsed.protocol === 'about:') return true;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

    return ALLOWED_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith('.' + d)
    );
  } catch {
    return false;
  }
}

/**
 * Buka URL di browser sistem — hanya untuk URL eksternal yang benar-benar
 * tidak perlu dikembalikan ke aplikasi.
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
// Session & user-agent
// ─────────────────────────────────────────────

/**
 * Siapkan session persisten dan terapkan user-agent Chrome murni.
 *
 * PENTING — Google OAuth:
 * Google memblokir OAuth jika user-agent mengandung string yang
 * mengidentifikasi aplikasi sebagai embedded webview (misalnya "Electron",
 * nama app custom, atau "wv").
 * Solusi: gunakan UA Chrome standar TANPA tambahan nama aplikasi.
 * Electron 31 menggunakan Chromium 124; kita sesuaikan versi Chrome di UA.
 */
function getAppSession() {
  const appSession = session.fromPartition(PARTITION);

  // UA Chrome standar Windows — tidak mengandung "Electron" atau nama app.
  // Ini adalah UA yang dikirimkan browser Chrome biasa pada Windows 10/11.
  const chromeUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36';

  appSession.setUserAgent(chromeUA);

  // Izinkan permission yang wajar; tolak yang berbahaya.
  appSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['notifications', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  // Jangan blokir koneksi ke domain manapun — biarkan webSecurity yang menjaga.
  // (Tidak diperlukan network interception di sini.)

  return appSession;
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
    show: false,                  // ditampilkan setelah loading selesai
    title: 'Portal SO Cabang',
    backgroundColor: '#0f1117',   // sama dengan warna loading screen
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
      partition: PARTITION
    },
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  // Muat loading screen di window utama (tidak ada window loading terpisah)
  mainWindow.loadFile('loading.html', { query: { v: APP_VERSION } });

  mainWindow.once('ready-to-show', () => {
    // Tampilkan window dengan loading screen segera
    mainWindow.show();
    windowShown = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    webView    = null;
  });

  return mainWindow;
}

// ─────────────────────────────────────────────
// BrowserView — memuat website
// ─────────────────────────────────────────────

/**
 * Tampilkan main window (panggil sekali saja).
 * Menutup loading screen dengan menswap BrowserView ke depan.
 */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!windowShown) {
    mainWindow.show();
    windowShown = true;
  }
}

/**
 * Pasang BrowserView (konten website) dan tampilkan window utama.
 * Loading screen langsung tertimpa oleh BrowserView begitu siap.
 */
function attachWebView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setBrowserView(view);

  function updateBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [w, h] = mainWindow.getContentSize();
    view.setBounds({ x: 0, y: 0, width: w, height: h });
  }

  updateBounds();
  mainWindow.on('resize', updateBounds);
}

/**
 * Buat BrowserView untuk memuat website dengan session persisten.
 * BrowserView berjalan di proses renderer terpisah sehingga website
 * tidak mendapat akses Node.js sama sekali.
 *
 * @param {string} url
 * @param {Electron.Session} appSession
 */
function loadWebsite(url, appSession) {
  if (!mainWindow) return;

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      session: appSession
      // Tidak menyertakan preload di sini karena preload untuk website
      // dapat mengganggu framework JS di dalam website.
    }
  });

  webView = view;

  // ── Navigasi handler ─────────────────────────────────────────────────

  view.webContents.on('will-navigate', (event, navUrl) => {
    if (!isAllowedNavigation(navUrl)) {
      event.preventDefault();
      console.log('[Main] Blokir navigasi eksternal:', navUrl);
      openExternal(navUrl);
    }
    // Izinkan semua navigasi ke domain yang disetujui — termasuk
    // callback OAuth yang kembali ke portalsocabang5.zite.so dengan
    // query string ?code=... maupun redirect ke accounts.google.com.
  });

  /**
   * setWindowOpenHandler menangani window.open() dari dalam website.
   *
   * Untuk Google OAuth:
   * - Jika website menggunakan popup (window.open ke accounts.google.com),
   *   kita buka sebagai BrowserWindow baru yang berbagi session yang sama.
   * - Pastikan popup dapat menulis cookies ke session persisten yang sama
   *   sehingga setelah OAuth selesai, website utama bisa membaca cookie login.
   *
   * CATATAN: Google OAuth popup harus menggunakan session yang sama agar
   * cookies yang diterima setelah login tersedia untuk website utama.
   */
  view.webContents.setWindowOpenHandler(({ url: newUrl, frameName }) => {
    console.log('[Main] window.open dipanggil:', newUrl);

    if (isAllowedNavigation(newUrl)) {
      // Buka sebagai BrowserWindow baru dengan session persisten yang SAMA.
      // Gunakan 'default-frame' atau frameName agar bisa direferensikan.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          minWidth: 400,
          minHeight: 500,
          title: 'Login – Portal SO Cabang',
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          icon: path.join(__dirname, 'assets', 'icon.ico'),
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            // ── Kunci: session yang sama ──
            partition: PARTITION
          }
        }
      };
    }

    // URL di luar domain yang diizinkan → buka di browser sistem
    openExternal(newUrl);
    return { action: 'deny' };
  });

  // ── Loading events ─────────────────────────────────────────────────

  view.webContents.on('did-start-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('Memuat… – Portal SO Cabang');
    }
  });

  view.webContents.on('did-finish-load', () => {
    const loadedUrl = view.webContents.getURL();
    console.log('[Main] Halaman dimuat:', loadedUrl);

    if (mainWindow && !mainWindow.isDestroyed()) {
      const title = view.webContents.getTitle();
      mainWindow.setTitle(title ? `${title} – Portal SO Cabang` : 'Portal SO Cabang');
    }

    // Pasang BrowserView dan tampilkan window (menggantikan loading screen)
    attachWebView(view);
    showMainWindow();
  });

  view.webContents.on('page-title-updated', (_event, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title ? `${title} – Portal SO Cabang` : 'Portal SO Cabang');
    }
  });

  // ── Error handler ─────────────────────────────────────────────────

  view.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      // -3 = ERR_ABORTED — terjadi saat redirect, bukan error nyata
      if (errorCode === -3) return;

      console.error(
        `[Main] Gagal memuat: ${errorDescription} (${errorCode}) | ${validatedURL}`
      );

      // Lepaskan BrowserView agar halaman error bisa dimuat di mainWindow
      mainWindow.setBrowserView(null);

      const encodedUrl = encodeURIComponent(validatedURL || url);
      mainWindow.loadFile('error.html', {
        query: { url: encodedUrl, v: APP_VERSION }
      });

      showMainWindow();
    }
  );

  // ── Muat URL ─────────────────────────────────────────────────────

  // UA sudah diset di level session (getAppSession()).
  // Tidak perlu set UA di sini lagi — konsistensi terjaga di seluruh request.
  console.log('[Main] Memuat URL:', url);
  view.webContents.loadURL(url);
}

// ─────────────────────────────────────────────
// Shortcut Keyboard
// ─────────────────────────────────────────────

function registerShortcuts() {
  // F5 — Refresh
  globalShortcut.register('F5', () => {
    if (webView && !webView.webContents.isDestroyed()) {
      webView.webContents.reload();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  // Ctrl+R — Refresh
  globalShortcut.register('CommandOrControl+R', () => {
    if (webView && !webView.webContents.isDestroyed()) {
      webView.webContents.reload();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  // F11 — Toggle Fullscreen
  globalShortcut.register('F11', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    isFullscreen = !isFullscreen;
    mainWindow.setFullScreen(isFullscreen);
  });

  // Escape — Keluar fullscreen
  globalShortcut.register('Escape', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      isFullscreen = false;
      mainWindow.setFullScreen(false);
    }
  });

  // F12 — DevTools (hanya mode dev)
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    globalShortcut.register('F12', () => {
      if (webView && !webView.webContents.isDestroyed()) {
        webView.webContents.toggleDevTools();
      }
    });
    console.log('[Main] DevTools (F12) aktif — mode development.');
  }

  console.log('[Main] Shortcut keyboard terdaftar.');
}

// ─────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log('[Main] Aplikasi dimulai. Versi:', APP_VERSION);

  // Siapkan session & user-agent
  const appSession = getAppSession();

  // Buat window (menampilkan loading screen di dalamnya)
  createMainWindow();

  // Fallback: jika website tidak kunjung load dalam LOAD_SHOW_TIMEOUT,
  // pastikan window tetap ditampilkan agar aplikasi tidak freeze.
  setTimeout(() => {
    if (!windowShown) {
      console.warn('[Main] Timeout loading — paksa tampilkan window.');
      showMainWindow();
    }
  }, LOAD_SHOW_TIMEOUT);

  // Ambil URL website (GitHub → cache → default)
  currentUrl = await getWebsiteUrl();
  console.log('[Main] URL website:', currentUrl);

  // Muat website
  loadWebsite(currentUrl, appSession);

  // Daftarkan shortcuts
  registerShortcuts();

  // Inisialisasi updater (hanya production)
  initUpdater(mainWindow);

  setTimeout(() => {
    if (process.env.NODE_ENV !== 'development' && !process.argv.includes('--dev')) {
      checkForUpdates();
    }
  }, 5000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  console.log('[Main] Shortcut dibersihkan.');
});

// ─────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────

ipcMain.on('app-ready',   ()           => console.log('[Main] IPC: app-ready'));
ipcMain.on('page-loaded', ()           => console.log('[Main] IPC: page-loaded'));
ipcMain.on('page-error',  (_, info)    => console.error('[Main] IPC: page-error', info));
