'use strict';
/**
 * RohanKar Launcher — main.js
 * Session 5: Auto-updater added (electron-updater + GitHub releases).
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { execFile, spawn } = require('child_process');

// ─── Paths ───────────────────────────────────────────────────────────────────

const USER_DATA        = app.getPath('userData');
const DEFAULT_GAMES_DIR = path.join(USER_DATA, 'games');
const LEGACY_DB_PATH   = path.join(USER_DATA, 'library.json');
const SETTINGS_PATH    = path.join(USER_DATA, 'settings.json');

[DEFAULT_GAMES_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── SQLite ───────────────────────────────────────────────────────────────────

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(USER_DATA, 'library.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      identifier  TEXT PRIMARY KEY,
      install_dir TEXT,
      exe_path    TEXT,
      category    TEXT,
      playtime_secs INTEGER DEFAULT 0,
      added_at    INTEGER
    );
  `);

  // Migrate: add any columns missing from older DB versions
  const existingCols = db.prepare('PRAGMA table_info(games)').all().map(r => r.name);
  const needed = {
    install_dir:   'TEXT',
    exe_path:      'TEXT',
    category:      'TEXT',
    playtime_secs: 'INTEGER DEFAULT 0',
    added_at:      'INTEGER',
  };
  for (const [col, type] of Object.entries(needed)) {
    if (!existingCols.includes(col)) {
      db.exec(`ALTER TABLE games ADD COLUMN ${col} ${type}`);
      console.log(`DB migration: added column games.${col}`);
    }
  }
} catch (e) {
  console.error('SQLite init failed:', e.message);
  db = null;
}

// ─── Migrate legacy library.json → SQLite ────────────────────────────────────

if (db && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
    const insert = db.prepare(`
      INSERT OR IGNORE INTO games (identifier, install_dir, exe_path, category, playtime_secs, added_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const migrate = db.transaction(() => {
      for (const [id, g] of Object.entries(legacy)) {
        insert.run(id, g.installDir || null, g.exePath || null, g.category || null, g.playtimeSecs || 0, Date.now());
      }
    });
    migrate();
    fs.renameSync(LEGACY_DB_PATH, LEGACY_DB_PATH + '.migrated');
    console.log('Migrated library.json to SQLite');
  } catch (e) {
    console.error('Migration error:', e.message);
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {}
  return {};
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    frame:  false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Window controls ─────────────────────────────────────────────────────────

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('heroes-path', () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'heroes');
  }
  return path.join(__dirname, '../../assets/heroes');
});

// Check if a hero.png exists in the game's install directory
ipcMain.handle('check-game-hero', (_, { installDir }) => {
  if (!installDir) return null;
  const candidates = ['hero.png', 'hero.jpg', 'hero.jpeg', 'hero.webp'];
  for (const name of candidates) {
    const heroPath = path.join(installDir, name);
    if (fs.existsSync(heroPath)) {
      return 'file:///' + heroPath.replace(/\\/g, '/');
    }
  }
  return null;
});

ipcMain.on('open-external', (_, url) => {
  shell.openExternal(url);
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ─── Settings IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('settings-get',  ()      => loadSettings());
ipcMain.handle('settings-save', (_, s)  => { saveSettings(s); return { ok: true }; });
ipcMain.handle('choose-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

// ─── Library IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('library-get', () => {
  if (!db) return {};
  const rows = db.prepare('SELECT * FROM games').all();
  const out  = {};
  for (const r of rows) out[r.identifier] = r;
  return out;
});

ipcMain.handle('library-get-game', (_, { identifier }) => {
  if (!db) return null;
  return db.prepare('SELECT * FROM games WHERE identifier = ?').get(identifier) || null;
});

ipcMain.handle('library-set-category', (_, { identifier, category }) => {
  if (!db) return { ok: false };
  db.prepare('UPDATE games SET category = ? WHERE identifier = ?').run(category, identifier);
  return { ok: true };
});

// ─── Download ─────────────────────────────────────────────────────────────────

const http  = require('http');
const activeDownloads = new Map();

// Fetch archive.org metadata/file list via main process (avoids renderer CSP issues)
ipcMain.handle('fetch-file-list', async (_, { identifier }) => {
  return new Promise((resolve) => {
    const url = `https://archive.org/metadata/${identifier}`;
    https.get(url, { headers: { 'User-Agent': 'RohanKar-Launcher/0.4' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ok: true, files: json.files || [] });
        } catch (e) {
          resolve({ ok: false, error: e.message, files: [] });
        }
      });
    }).on('error', err => resolve({ ok: false, error: err.message, files: [] }));
  });
});

ipcMain.handle('download-start', async (event, { identifier, downloadUrl, fileName }) => {
  const settings    = loadSettings();
  const downloadDir = settings.downloadPath || DEFAULT_GAMES_DIR;
  const destDir     = path.join(downloadDir, identifier);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const destFile = path.join(destDir, fileName);

  return new Promise((resolve) => {
    const doRequest = (url, redirectCount) => {
      if (redirectCount > 10) return resolve({ ok: false, error: 'Too many redirects' });

      // Support both http and https
      const isHttps  = url.startsWith('https');
      const protocol = isHttps ? https : http;

      const req = protocol.get(url, {
        headers: { 'User-Agent': 'RohanKar-Launcher/0.4' },
        timeout: 30000,
      }, (res) => {
        const { statusCode, headers } = res;

        // Follow redirects
        if ((statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) && headers.location) {
          req.destroy();
          res.resume(); // drain response body
          // Resolve relative redirects
          let next = headers.location;
          if (next.startsWith('/')) {
            const base = new URL(url);
            next = `${base.protocol}//${base.host}${next}`;
          }
          doRequest(next, redirectCount + 1);
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          return resolve({ ok: false, error: `HTTP ${statusCode}` });
        }

        const total  = parseInt(headers['content-length'] || '0', 10);
        let received = 0;
        const file   = fs.createWriteStream(destFile);

        activeDownloads.set(identifier, { req, file });

        res.on('data', chunk => {
          received += chunk.length;
          if (total > 0) {
            event.sender.send('download-progress', {
              identifier,
              percent: Math.round(received / total * 100),
            });
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close();
          activeDownloads.delete(identifier);
          resolve({ ok: true, filePath: destFile });
        });

        file.on('error', err => {
          fs.unlink(destFile, () => {});
          activeDownloads.delete(identifier);
          resolve({ ok: false, error: err.message });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      });

      req.on('error', err => {
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: err.message });
      });
    };

    doRequest(downloadUrl, 0);
  });
});

ipcMain.handle('download-cancel', (_, { identifier }) => {
  const dl = activeDownloads.get(identifier);
  if (dl) {
    try { dl.req.destroy(); } catch {}
    try { dl.file.close();  } catch {}
    activeDownloads.delete(identifier);
  }
  return { ok: true };
});

// ─── Extract ──────────────────────────────────────────────────────────────────

ipcMain.handle('extract-archive', async (_, { filePath, identifier }) => {
  const settings   = loadSettings();
  const installDir = settings.installPath || DEFAULT_GAMES_DIR;
  const destDir    = path.join(installDir, identifier);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const ext    = filePath.toLowerCase();
  const sevenZ = 'C:\\Program Files\\7-Zip\\7z.exe';

  // Helper: unblock all files in destDir after extraction
  const unblockAfterExtract = () => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve();
    const ps = `Get-ChildItem -Path '${destDir}' -Recurse | Unblock-File -ErrorAction SilentlyContinue`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], () => resolve());
  });

  if ((ext.endsWith('.zip') || ext.endsWith('.7z') || ext.endsWith('.rar')) && fs.existsSync(sevenZ)) {
    return new Promise((resolve) => {
      execFile(sevenZ, ['x', filePath, `-o${destDir}`, '-y'], async (err) => {
        if (err) return resolve({ ok: false, error: err.message });
        await unblockAfterExtract();
        if (settings.deleteAfterInstall) {
          fs.unlink(filePath, () => {
            try { fs.rmdirSync(path.dirname(filePath)); } catch {}
          });
        }
        resolve({ ok: true, installDir: destDir });
      });
    });
  }

  // fallback: extract-zip for .zip
  if (ext.endsWith('.zip')) {
    try {
      const extractZip = require('extract-zip');
      await extractZip(filePath, { dir: destDir });
      await unblockAfterExtract();
      if (settings.deleteAfterInstall) {
        fs.unlink(filePath, () => {
          try { fs.rmdirSync(path.dirname(filePath)); } catch {}
        });
      }
      return { ok: true, installDir: destDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { ok: false, error: 'Unsupported archive format' };
});

// ─── Find executables in install dir ─────────────────────────────────────────
//
// File structure convention:
//   installDir/          ← e.g. at_20251025\
//     Alien Trilogy\     ← game subfolder (first non-ignored subdir)
//       Launch Alien Trilogy.exe   ← list these
//       DOSBoxPure.exe             ← list these
//       GAME\            ← do NOT recurse into this
//       saves\           ← do NOT recurse into this
//     Extras\            ← ignored (not the game subfolder)
//     hero.png           ← ignored
//     Readme.txt         ← ignored
//
// We return only the .exe files directly inside the game subfolder (depth 1).
// This prevents hundreds of DOSBox/game-internal exes from flooding the picker.

const IGNORED_SUBDIRS = new Set(['extras', 'extra', 'bonus', 'soundtrack', 'manuals', 'manual']);

ipcMain.handle('find-exes', (_, { installDir }) => {
  try {
    const rootEntries = fs.readdirSync(installDir, { withFileTypes: true });

    // Find the game subfolder: first subdir that isn't an ignored folder
    const gameSubdir = rootEntries.find(
      e => e.isDirectory() && !IGNORED_SUBDIRS.has(e.name.toLowerCase())
    );

    // The folder to scan: game subfolder if found, otherwise the install root itself
    const gameDir = gameSubdir
      ? path.join(installDir, gameSubdir.name)
      : installDir;

    // If the game folder contains a 'bin' subfolder, scan that instead.
    // e.g. American McGee's Alice - Remastered\bin\Alice.exe
    const binDir = path.join(gameDir, 'bin');
    const scanDir = fs.existsSync(binDir) && fs.statSync(binDir).isDirectory()
      ? binDir
      : gameDir;

    // Collect .exe files directly in scanDir only (no recursion)
    const results = [];
    for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        results.push(path.join(scanDir, entry.name));
      }
    }
    return results;
  } catch { return []; }
});

// ─── Launch + playtime ────────────────────────────────────────────────────────

// Recursively unblock all .exe and .dll files under a directory.
// Windows marks downloaded files with Zone.Identifier streams which cause EACCES.
function unblockDirectory(dir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve();
    // Use PowerShell to remove the Zone.Identifier alternate data stream from all
    // exe/dll files recursively — this is equivalent to right-click → Unblock
    const ps = `Get-ChildItem -Path '${dir}' -Recurse -Include *.exe,*.dll | Unblock-File -ErrorAction SilentlyContinue`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], (err) => {
      // Errors here are non-fatal — we attempt the launch regardless
      if (err) console.warn('[unblock] PowerShell unblock warning:', err.message);
      resolve();
    });
  });
}

ipcMain.handle('launch-game', (_, { identifier, exePath }) => {
  return new Promise(async (resolve) => {
    if (!fs.existsSync(exePath)) return resolve({ ok: false, error: 'Executable not found: ' + exePath });

    // Unblock the install directory on every launch — covers both freshly installed
    // games and games that were installed before this fix was added.
    const gameRow     = db?.prepare('SELECT install_dir FROM games WHERE identifier = ?').get(identifier);
    const unblockRoot = gameRow?.install_dir || path.dirname(exePath);
    await unblockDirectory(unblockRoot);

    const start   = Date.now();
    const cwd     = path.dirname(exePath);
    let   settled = false;
    const settle  = (val) => { if (!settled) { settled = true; resolve(val); } };

    let proc;
    try {
      proc = execFile(exePath, [], {
        cwd,
        detached: true,
        stdio:    'ignore',
        windowsHide: false,
      });
      proc.unref();
    } catch (e) {
      return settle({ ok: false, error: e.message });
    }

    proc.on('error', err => settle({ ok: false, error: err.message }));

    proc.on('close', () => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (db && elapsed > 5) {
        db.prepare('UPDATE games SET playtime_secs = playtime_secs + ? WHERE identifier = ?')
          .run(elapsed, identifier);
      }
    });

    // Give it 1s to error out; if no error, assume it launched fine
    setTimeout(() => settle({ ok: true }), 1000);
  });
});

// ─── Open game location in Explorer ──────────────────────────────────────────

ipcMain.handle('open-game-location', (_, { installDir }) => {
  try {
    if (!fs.existsSync(installDir)) return { ok: false, error: 'Folder not found' };
    // Use 'explorer' on Windows, 'open' on Mac, 'xdg-open' on Linux
    const cmd = process.platform === 'darwin' ? 'open'
              : process.platform === 'linux'  ? 'xdg-open'
              : 'explorer';
    execFile(cmd, [installDir]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Read readme from install dir ────────────────────────────────────────────

ipcMain.handle('read-readme', (_, { installDir }) => {
  try {
    if (!fs.existsSync(installDir)) return { ok: false, text: null };

    const entries = fs.readdirSync(installDir, { withFileTypes: true });

    // Find a file whose name starts with "readme" (case-insensitive) in the root only
    const readmeEntry = entries.find(e =>
      e.isFile() && /^readme/i.test(e.name) && /\.(txt|md|nfo|doc|rtf|htm|html|1st)$/i.test(e.name)
    ) || entries.find(e =>
      // Also catch extensionless "README" files
      e.isFile() && /^readme$/i.test(e.name)
    );

    if (!readmeEntry) return { ok: true, text: null };

    const filePath = path.join(installDir, readmeEntry.name);
    const raw = fs.readFileSync(filePath, 'latin1'); // latin1 handles old DOS/Windows text files
    return { ok: true, text: raw, fileName: readmeEntry.name };
  } catch (e) {
    return { ok: false, error: e.message, text: null };
  }
});

// ─── Install / Delete ─────────────────────────────────────────────────────────

ipcMain.handle('install-game', (_, { identifier, installDir, exePath }) => {
  if (!db) return { ok: false };
  db.prepare(`
    INSERT OR REPLACE INTO games (identifier, install_dir, exe_path, added_at)
    VALUES (?, ?, ?, ?)
  `).run(identifier, installDir, exePath || null, Date.now());
  return { ok: true };
});

ipcMain.handle('set-exe-path', (_, { identifier, exePath }) => {
  if (!db) return { ok: false };
  db.prepare('UPDATE games SET exe_path = ? WHERE identifier = ?').run(exePath || null, identifier);
  return { ok: true };
});

ipcMain.handle('delete-game', (_, { identifier, installDir }) => {
  try {
    if (installDir && fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
    if (db) db.prepare('DELETE FROM games WHERE identifier = ?').run(identifier);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Auto-updater ────────────────────────────────────────────────────────────
//
// electron-updater checks GitHub releases on launch, downloads in background,
// and sends IPC events to the renderer so the UI can show a non-intrusive bar.
//
// In development (app.isPackaged === false) we skip the update check entirely
// so you don't get errors about missing release files.

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[updater] Dev mode — skipping update check');
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.error('[updater] electron-updater not available:', e.message);
    return;
  }

  autoUpdater.autoDownload         = false; // don't auto-download — GitHub releases don't report progress
  autoUpdater.allowDowngrade        = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update…');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);

    // Fetch release notes from GitHub API
    const releaseUrl = `https://api.github.com/repos/Kilted-Kraken/-RohanKar-Launcher/releases/tags/v${info.version}`;
    const fetchNotes = () => new Promise((resolve) => {
      https.get(releaseUrl, {
        headers: {
          'User-Agent':  'RohanKar-Launcher',
          'Accept':      'application/vnd.github+json',
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json  = JSON.parse(data);
            resolve(json.body || null);   // GitHub release body is markdown
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });

    fetchNotes().then((releaseNotes) => {
      mainWindow?.webContents.send('updater-status', {
        status:       'available',
        version:      info.version,
        releaseNotes: releaseNotes || null,
        releaseDate:  info.releaseDate || null,
      });
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Up to date.');
  });

  // No download-progress or update-downloaded handlers needed —
  // we send users to GitHub to download manually instead.

  autoUpdater.on('error', (err) => {
    const msg = err.message || '';
    // 404 = no GitHub release published yet, not a real error worth surfacing
    if (msg.includes('404')) {
      console.log('[updater] No published release found yet — skipping update check.');
      return;
    }
    console.error('[updater] Error:', msg);
    mainWindow?.webContents.send('updater-status', {
      status:  'error',
      message: msg,
    });
  });

  // Check after the window is ready so the user sees the UI first
  mainWindow?.once('ready-to-show', () => {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
  });

}  

// IPC: renderer asks to download update — always registered, opens GitHub releases page
ipcMain.removeHandler('updater-install');
ipcMain.handle('updater-install', () => {
  shell.openExternal('https://github.com/Kilted-Kraken/-RohanKar-Launcher/releases/latest');
});

// ─── Archive.org reviews ──────────────────────────────────────────────────────

ipcMain.handle('fetch-reviews', async (_, { identifier }) => {
  return new Promise((resolve) => {
    const url = `https://archive.org/metadata/${identifier}/reviews`;
    https.get(url, { headers: { 'User-Agent': 'RohanKar-Launcher/0.4' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json?.result || []);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
});
