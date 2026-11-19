# Portal SO Cabang — Desktop Application

Aplikasi desktop Windows untuk Portal SO Cabang, dibangun dengan Electron.

---

## Informasi Proyek

| Item | Detail |
|---|---|
| Nama Aplikasi | Portal SO Cabang |
| App ID | com.putrasejati.portalsocabang |
| Executable | PortalSOCabang.exe |
| Target OS | Windows 10 & Windows 11 (x64) |
| Framework | Electron |
| Installer | NSIS (.exe) |
| GitHub | https://github.com/nadiranafidev/portal-so-cabang |

---

## Prasyarat

- Node.js 18 atau lebih baru
- npm
- Windows 10/11 untuk build

---

## Instalasi

```bash
npm install
```

---

## Menjalankan Aplikasi (Development)

```bash
npm start
```

Tambahkan flag `--dev` untuk mengaktifkan DevTools (F12):

```bash
npx electron . --dev
```

---

## Build Installer

> **Jangan build sebelum semua pengujian selesai.**

```bash
npm run build
```

Output: `dist/Portal-SO-Cabang-Setup.exe`

---

## Publish Update ke GitHub Releases

1. Buat Personal Access Token GitHub dengan scope `repo`.
2. Set environment variable:
   ```
   GH_TOKEN=your_token_here
   ```
3. Naikkan versi di `package.json`.
4. Jalankan:
   ```bash
   npm run build:publish
   ```

---

## Sistem GitHub Remote Config

URL website dimuat dari:

```
https://raw.githubusercontent.com/nadiranafidev/portal-so-cabang/main/config.json
```

Format `config.json`:

```json
{
  "url": "https://portalsocabang5.zite.so/"
}
```

**Urutan prioritas URL:**
1. GitHub `config.json` (online)
2. Cache lokal (tersimpan otomatis)
3. URL default bawaan aplikasi

**Mengubah URL website tanpa build ulang:**
- Edit `config.json` di repository GitHub.
- Commit dan push.
- Aplikasi akan menggunakan URL baru saat dibuka berikutnya.

---

## Sistem Auto Update

- Update diambil dari GitHub Releases secara otomatis saat aplikasi dibuka.
- Pengguna diberi notifikasi dan dapat memilih untuk mengunduh dan memasang.
- Update **tidak memaksa restart** tanpa persetujuan pengguna.
- Data login (session/cookies) dan konfigurasi lokal **tidak dihapus** saat update.

---

## Struktur File

```
Portal-SO-Cabang-Desktop/
├── main.js              # Entry point Electron
├── preload.js           # Preload script (contextIsolation)
├── config.js            # GitHub Remote Config handler
├── updater.js           # Auto update handler
├── loading.html         # Loading screen
├── error.html           # Halaman error koneksi
├── package.json         # Konfigurasi proyek & electron-builder
├── .gitignore
├── README.md
└── assets/
    └── icon.ico         # Ikon aplikasi (ganti sesuai kebutuhan)
```

---

## Mengganti Ikon Aplikasi

1. Siapkan file `icon.ico` (ukuran rekomendasi: 256×256).
2. Ganti file `assets/icon.ico`.
3. Build ulang installer.

---

## Shortcut Keyboard

| Shortcut | Fungsi |
|---|---|
| F5 | Refresh halaman |
| Ctrl+R | Refresh halaman |
| F11 | Toggle fullscreen |
| Escape | Keluar dari fullscreen |
| F12 | DevTools (hanya mode `--dev`) |

---

## Keamanan

- `contextIsolation: true` — halaman website tidak dapat mengakses Node.js
- `nodeIntegration: false` — isolasi penuh
- `webSecurity: true` — kebijakan keamanan web aktif
- Navigasi hanya diizinkan ke domain yang terdaftar di `config.js`
- Link eksternal dibuka di browser sistem, bukan dalam aplikasi

---

## Catatan

- Session login tersimpan secara persisten (tidak hilang saat aplikasi ditutup).
- Google OAuth berjalan dalam popup yang diizinkan (domain googleapis.com).
- Mekanisme autentikasi website tidak dimodifikasi.
