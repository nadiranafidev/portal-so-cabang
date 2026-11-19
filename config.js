/**
 * config.js
 * Mengelola konfigurasi URL website dari GitHub Remote Config.
 *
 * Prioritas:
 *   1. GitHub raw config.json  → gunakan URL terbaru
 *   2. Cache lokal             → fallback jika GitHub tidak bisa diakses
 *   3. URL default bawaan      → fallback akhir jika tidak ada cache
 */

const { app } = require('electron');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

// ─────────────────────────────────────────────
// Konstanta
// ─────────────────────────────────────────────

/** URL default jika semua sumber gagal. */
const DEFAULT_URL = 'https://portalsocabang5.zite.so/';

/** URL raw config.json dari GitHub. */
const GITHUB_CONFIG_URL =
  'https://raw.githubusercontent.com/nadiranafidev/portal-so-cabang/main/config.json';

/** Timeout pengambilan config dari GitHub (ms). */
const FETCH_TIMEOUT = 8000;

/**
 * Domain yang diizinkan sebagai URL HALAMAN UTAMA aplikasi.
 * Daftar ini lebih ketat dari ALLOWED_DOMAINS navigasi — hanya website
 * milik Portal SO Cabang yang boleh dijadikan halaman awal.
 *
 * CATATAN: Domain Google / Fillout / dll. TIDAK termasuk di sini karena
 * URL-URL tersebut bukan halaman utama aplikasi, melainkan bagian dari
 * alur OAuth yang diizinkan navigasinya di main.js.
 */
const ALLOWED_START_DOMAINS = [
  'portalsocabang5.zite.so',
  'portalsocabang.zite.so',
  'zite.so'
];

/**
 * Domain yang diizinkan untuk navigasi di dalam aplikasi.
 * Mencakup seluruh alur OAuth: Zite proxy → Google → Fillout callback → app.
 *
 * Alur yang teridentifikasi dari log:
 *   portalsocabang5.zite.so/auth/login
 *     → server.zite.com        (Zite OAuth proxy — inisiasi)
 *     → accounts.google.com    (halaman login Google)
 *     → server.fillout.com     (Fillout callback proxy)
 *     → portalsocabang5.zite.so/api/auth/callback/google  (kembali ke app)
 */
const ALLOWED_DOMAINS = [
  // Website utama
  'portalsocabang5.zite.so',
  'portalsocabang.zite.so',
  'zite.so',
  // Proxy OAuth platform Zite (inisiasi alur)
  'server.zite.com',
  'zite.com',
  // Proxy OAuth Fillout (menerima callback dari Google)
  'server.fillout.com',
  'fillout.com',
  // Google Sign-In
  'accounts.google.com',
  'accounts.google.co.id',
  'oauth2.googleapis.com',
  'googleapis.com',
  'google.com'
];

// ─────────────────────────────────────────────
// Path cache lokal
// ─────────────────────────────────────────────

function getLocalConfigPath() {
  return path.join(app.getPath('userData'), 'config-cache.json');
}

// ─────────────────────────────────────────────
// Validasi URL
// ─────────────────────────────────────────────

/**
 * Validasi URL yang boleh digunakan sebagai halaman awal aplikasi.
 * Hanya domain website Portal SO Cabang yang diizinkan — bukan domain OAuth.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidStartUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_START_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Alias untuk kompatibilitas — digunakan config.js sendiri dan main.js.
 * Pemanggil eksternal (main.js) menggunakan isValidUrl untuk validasi
 * URL dari sumber eksternal; fungsi ini diarahkan ke isValidStartUrl.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidUrl(url) {
  return isValidStartUrl(url);
}

// ─────────────────────────────────────────────
// Cache lokal
// ─────────────────────────────────────────────

/**
 * Simpan konfigurasi ke cache lokal.
 * Cache hanya berisi { url, savedAt } — tidak menyimpan data sensitif.
 *
 * @param {{ url: string }} config
 */
function saveLocalConfig(config) {
  try {
    const cachePath = getLocalConfigPath();
    const data = {
      url:     config.url,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[Config] Cache lokal tersimpan:', cachePath);
  } catch (err) {
    console.error('[Config] Gagal menyimpan cache lokal:', err.message);
  }
}

/**
 * Baca konfigurasi dari cache lokal.
 *
 * @returns {{ url: string, savedAt?: string } | null}
 */
function loadLocalConfig() {
  try {
    const cachePath = getLocalConfigPath();
    if (!fs.existsSync(cachePath)) return null;

    const raw    = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed.url === 'string' && isValidStartUrl(parsed.url)) {
      console.log('[Config] Cache lokal dimuat:', parsed.url,
        parsed.savedAt ? `(disimpan ${parsed.savedAt})` : '');
      return parsed;
    }

    console.warn('[Config] Cache lokal ada tapi URL tidak valid, diabaikan.');
    return null;
  } catch (err) {
    console.error('[Config] Gagal membaca cache lokal:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Fetch GitHub
// ─────────────────────────────────────────────

/**
 * Ambil config.json dari GitHub dengan timeout dan redirect satu level.
 * Redirect hanya diikuti jika target masih di domain githubusercontent.com
 * atau github.com untuk mencegah open redirect ke domain sembarang.
 *
 * @returns {Promise<{ url: string } | null>}
 */
function fetchGithubConfig() {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.warn('[Config] Timeout — GitHub tidak merespons dalam',
        FETCH_TIMEOUT, 'ms.');
      resolve(null);
    }, FETCH_TIMEOUT);

    function doGet(targetUrl, isRedirect) {
      const proto = targetUrl.startsWith('https') ? https : http;

      const req = proto.get(targetUrl, (res) => {
        // Tangani redirect satu level
        if (!isRedirect && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const location = res.headers.location;
          // Hanya ikuti redirect ke domain GitHub
          const isSafeRedirect =
            location.includes('raw.githubusercontent.com') ||
            location.includes('github.com');
          if (isSafeRedirect) {
            console.log('[Config] Mengikuti redirect ke:', location);
            doGet(location, true);
          } else {
            clearTimeout(timeoutId);
            console.warn('[Config] Redirect ke domain tidak aman, diabaikan:', location);
            resolve(null);
          }
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeoutId);
          req.destroy();
          console.warn('[Config] GitHub HTTP', res.statusCode,
            '— config tidak tersedia.');
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(timeoutId);
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (err) {
            console.error('[Config] Gagal parse JSON dari GitHub:', err.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeoutId);
        console.warn('[Config] Koneksi ke GitHub gagal:', err.message);
        resolve(null);
      });

      req.setTimeout(FETCH_TIMEOUT, () => {
        req.destroy();
        clearTimeout(timeoutId);
        console.warn('[Config] Request ke GitHub timeout.');
        resolve(null);
      });
    }

    doGet(GITHUB_CONFIG_URL, false);
  });
}

// ─────────────────────────────────────────────
// Fungsi utama
// ─────────────────────────────────────────────

/**
 * Dapatkan URL website yang akan dimuat.
 *
 * Urutan prioritas:
 *   1. GitHub config.json (online, valid)   → simpan ke cache, gunakan
 *   2. Cache lokal (offline fallback)       → gunakan langsung
 *   3. URL default                          → terakhir jika semuanya gagal
 *
 * @returns {Promise<string>}
 */
async function getWebsiteUrl() {
  // 1. Coba GitHub
  const githubConfig = await fetchGithubConfig();
  if (githubConfig && typeof githubConfig.url === 'string') {
    if (isValidStartUrl(githubConfig.url)) {
      console.log('[Config] ✓ URL dari GitHub:', githubConfig.url);
      saveLocalConfig(githubConfig);
      return githubConfig.url;
    } else {
      console.warn('[Config] URL dari GitHub tidak lolos validasi domain:',
        githubConfig.url, '— fallback ke cache/default.');
    }
  }

  // 2. Coba cache lokal
  const localConfig = loadLocalConfig();
  if (localConfig) {
    console.log('[Config] ✓ URL dari cache lokal:', localConfig.url);
    return localConfig.url;
  }

  // 3. URL default
  console.log('[Config] ✓ URL default digunakan:', DEFAULT_URL);
  return DEFAULT_URL;
}

// ─────────────────────────────────────────────
// Ekspor
// ─────────────────────────────────────────────

module.exports = {
  getWebsiteUrl,
  isValidUrl,
  isValidStartUrl,
  ALLOWED_DOMAINS,
  ALLOWED_START_DOMAINS,
  DEFAULT_URL
};
