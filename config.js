/**
 * config.js
 * Mengelola konfigurasi URL website dari GitHub Remote Config.
 * Prioritas: GitHub config.json → cache lokal → URL default.
 */

const { app } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// URL default jika semua sumber gagal
const DEFAULT_URL = 'https://portalsocabang5.zite.so/';

// URL raw config.json dari GitHub
const GITHUB_CONFIG_URL =
  'https://raw.githubusercontent.com/nadiranafidev/portal-so-cabang/main/config.json';

// Timeout pengambilan config dari GitHub (ms)
const FETCH_TIMEOUT = 8000;

// Daftar domain yang diizinkan
const ALLOWED_DOMAINS = [
  'portalsocabang5.zite.so',
  'portalsocabang.zite.so',
  'zite.so',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'googleapis.com'
];

// Path file cache lokal
function getLocalConfigPath() {
  return path.join(app.getPath('userData'), 'config-cache.json');
}

/**
 * Validasi URL: hanya izinkan https dan domain yang disetujui.
 * @param {string} url
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Simpan konfigurasi ke cache lokal.
 * @param {{ url: string }} config
 */
function saveLocalConfig(config) {
  try {
    const cachePath = getLocalConfigPath();
    fs.writeFileSync(cachePath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Config] Cache lokal tersimpan:', cachePath);
  } catch (err) {
    console.error('[Config] Gagal menyimpan cache lokal:', err.message);
  }
}

/**
 * Baca konfigurasi dari cache lokal.
 * @returns {{ url: string } | null}
 */
function loadLocalConfig() {
  try {
    const cachePath = getLocalConfigPath();
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.url === 'string' && isValidUrl(parsed.url)) {
      console.log('[Config] Cache lokal dimuat:', parsed.url);
      return parsed;
    }
    return null;
  } catch (err) {
    console.error('[Config] Gagal membaca cache lokal:', err.message);
    return null;
  }
}

/**
 * Ambil config.json dari GitHub.
 * @returns {Promise<{ url: string } | null>}
 */
function fetchGithubConfig() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[Config] Timeout mengambil config dari GitHub.');
      resolve(null);
    }, FETCH_TIMEOUT);

    const protocol = GITHUB_CONFIG_URL.startsWith('https') ? https : http;
    const req = protocol.get(GITHUB_CONFIG_URL, (res) => {
      // Ikuti redirect sederhana (1 level)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        const redirectUrl = res.headers.location;
        const rProtocol = redirectUrl.startsWith('https') ? https : http;
        const rReq = rProtocol.get(redirectUrl, (rRes) => {
          let data = '';
          rRes.on('data', (chunk) => { data += chunk; });
          rRes.on('end', () => {
            clearTimeout(timeout);
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch {
              resolve(null);
            }
          });
        });
        rReq.on('error', () => { clearTimeout(timeout); resolve(null); });
        return;
      }

      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        console.warn('[Config] GitHub mengembalikan status:', res.statusCode);
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          console.error('[Config] Gagal parse config JSON:', err.message);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      console.warn('[Config] Gagal mengambil config dari GitHub:', err.message);
      resolve(null);
    });
  });
}

/**
 * Fungsi utama: dapatkan URL website.
 * Urutan: GitHub → cache lokal → default.
 * @returns {Promise<string>}
 */
async function getWebsiteUrl() {
  // 1. Coba ambil dari GitHub
  const githubConfig = await fetchGithubConfig();
  if (
    githubConfig &&
    typeof githubConfig.url === 'string' &&
    isValidUrl(githubConfig.url)
  ) {
    console.log('[Config] URL dari GitHub:', githubConfig.url);
    saveLocalConfig(githubConfig);
    return githubConfig.url;
  }

  // 2. Coba gunakan cache lokal
  const localConfig = loadLocalConfig();
  if (localConfig) {
    console.log('[Config] URL dari cache lokal:', localConfig.url);
    return localConfig.url;
  }

  // 3. Gunakan URL default
  console.log('[Config] URL default digunakan:', DEFAULT_URL);
  return DEFAULT_URL;
}

module.exports = {
  getWebsiteUrl,
  isValidUrl,
  ALLOWED_DOMAINS,
  DEFAULT_URL
};
