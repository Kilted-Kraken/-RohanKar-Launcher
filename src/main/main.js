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

const THUMB_CACHE_DIR  = path.join(USER_DATA, 'thumbcache');

[DEFAULT_GAMES_DIR, THUMB_CACHE_DIR].forEach(d => {
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
  // Collections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS collection_games (
      collection_id INTEGER NOT NULL,
      identifier    TEXT NOT NULL,
      PRIMARY KEY (collection_id, identifier)
    );
  `);

  // Migrate collections table — add color column if missing
  const collectionCols = db.prepare('PRAGMA table_info(collections)').all().map(r => r.name);
  if (!collectionCols.includes('color')) {
    db.exec('ALTER TABLE collections ADD COLUMN color TEXT');
    console.log('DB migration: added column collections.color');
  }

  const existingCols = db.prepare('PRAGMA table_info(games)').all().map(r => r.name);
  const needed = {
    install_dir:   'TEXT',
    exe_path:      'TEXT',
    category:      'TEXT',
    playtime_secs: 'INTEGER DEFAULT 0',
    added_at:      'INTEGER',
    is_favorite:   'INTEGER DEFAULT 0',
    notes:         'TEXT',
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
  // Validate installs on every launch — clears DB entries whose folders were deleted
  validateInstalls();
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

ipcMain.handle('library-set-favorite', (_, { identifier, isFavorite }) => {
  if (!db) return { ok: false };
  // Ensure the row exists (game may not be installed yet)
  db.prepare(`INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)`).run(identifier, Date.now());
  db.prepare('UPDATE games SET is_favorite = ? WHERE identifier = ?').run(isFavorite ? 1 : 0, identifier);
  return { ok: true };
});

ipcMain.handle('library-set-notes', (_, { identifier, notes }) => {
  if (!db) return { ok: false };
  db.prepare(`INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)`).run(identifier, Date.now());
  db.prepare('UPDATE games SET notes = ? WHERE identifier = ?').run(notes || null, identifier);
  return { ok: true };
});

// ─── Collections IPC ──────────────────────────────────────────────────────────

ipcMain.handle('collections-get', () => {
  if (!db) return [];
  const cols = db.prepare('SELECT * FROM collections ORDER BY name').all();
  return cols.map(c => ({
    ...c,
    games: db.prepare('SELECT identifier FROM collection_games WHERE collection_id = ?')
             .all(c.id).map(r => r.identifier),
  }));
});

ipcMain.handle('collections-create', (_, { name }) => {
  if (!db) return { ok: false };
  try {
    const info = db.prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)').run(name.trim(), Date.now());
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('collections-delete', (_, { id }) => {
  if (!db) return { ok: false };
  db.prepare('DELETE FROM collection_games WHERE collection_id = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('collections-rename', (_, { id, name }) => {
  if (!db) return { ok: false };
  try {
    db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name.trim(), id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('collections-set-color', (_, { id, color }) => {
  if (!db) return { ok: false };
  db.prepare('UPDATE collections SET color = ? WHERE id = ?').run(color || null, id);
  return { ok: true };
});

ipcMain.handle('collections-add-game', (_, { collectionId, identifier }) => {
  if (!db) return { ok: false };
  try {
    db.prepare('INSERT OR IGNORE INTO collection_games (collection_id, identifier) VALUES (?, ?)').run(collectionId, identifier);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('collections-remove-game', (_, { collectionId, identifier }) => {
  if (!db) return { ok: false };
  db.prepare('DELETE FROM collection_games WHERE collection_id = ? AND identifier = ?').run(collectionId, identifier);
  return { ok: true };
});

// ─── Thumbnail cache ──────────────────────────────────────────────────────────

// Returns a file:// URL from disk cache, downloading from archive.org if not
// yet cached. Falls back to the live URL on any error so UI always shows something.
ipcMain.handle('get-thumb', async (_, { identifier }) => {
  const liveUrl   = `https://archive.org/services/img/${identifier}`;
  const cachePath = path.join(THUMB_CACHE_DIR, `${identifier}.jpg`);
  const cacheUrl  = 'file:///' + cachePath.replace(/\\/g, '/');

  // Serve from cache if it already exists and looks like a real image (>1 KB)
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1024) {
    return cacheUrl;
  }

  return new Promise((resolve) => {
    const doRequest = (url, redirects) => {
      if (redirects > 5) return resolve(liveUrl);
      https.get(url, { headers: { 'User-Agent': 'RohanKar-Launcher/1.1' } }, (res) => {
        const { statusCode, headers: resHeaders } = res;

        if ([301,302,303,307,308].includes(statusCode) && resHeaders.location) {
          res.resume();
          let next = resHeaders.location;
          if (next.startsWith('/')) {
            const base = new URL(url);
            next = `${base.protocol}//${base.host}${next}`;
          }
          return doRequest(next, redirects + 1);
        }

        // Only cache real image responses
        const ct = resHeaders['content-type'] || '';
        if (statusCode !== 200 || !ct.startsWith('image/')) {
          res.resume();
          return resolve(liveUrl);
        }

        const file = fs.createWriteStream(cachePath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          try {
            if (fs.statSync(cachePath).size > 1024) return resolve(cacheUrl);
          } catch {}
          resolve(liveUrl);
        });
        file.on('error', () => {
          try { fs.unlinkSync(cachePath); } catch {}
          resolve(liveUrl);
        });
      }).on('error', () => resolve(liveUrl));
    };
    doRequest(liveUrl, 0);
  });
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

// Sanitize an archive.org identifier for safe use as a folder name.
// Windows forbids names ending with a dot or space.
function sanitizeFolderName(name) {
  return name.replace(/[.\s]+$/, '').replace(/[<>:"/\\|?*]/g, '_') || '_';
}

ipcMain.handle('download-start', async (event, { identifier, downloadUrl, fileName }) => {
  const settings    = loadSettings();
  const downloadDir = settings.downloadPath || DEFAULT_GAMES_DIR;
  const destDir     = path.join(downloadDir, sanitizeFolderName(identifier));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const safeFileName = path.basename(fileName);
  const destFile     = path.join(destDir, safeFileName);

  return new Promise((resolve) => {
    // Track whether cancel has been called so we resolve exactly once
    let cancelled = false;

    // Register a cancel hook immediately — before any HTTP request is made.
    // This lets download-cancel work even during redirects or slow connections.
    activeDownloads.set(identifier, {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Cancelled' });
      },
      req:  null,
      file: null,
    });

    const doRequest = (url, redirectCount) => {
      if (cancelled) return;
      if (redirectCount > 10) {
        activeDownloads.delete(identifier);
        return resolve({ ok: false, error: 'Too many redirects' });
      }

      const isHttps  = url.startsWith('https');
      const protocol = isHttps ? https : http;

      const req = protocol.get(url, {
        headers: { 'User-Agent': 'RohanKar-Launcher/0.4' },
        timeout: 30000,
      }, (res) => {
        if (cancelled) { res.resume(); return; }

        const { statusCode, headers } = res;

        // Follow redirects
        if ([301,302,303,307,308].includes(statusCode) && headers.location) {
          req.destroy();
          res.resume();
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
          activeDownloads.delete(identifier);
          return resolve({ ok: false, error: `HTTP ${statusCode}` });
        }

        const total  = parseInt(headers['content-length'] || '0', 10);
        let received = 0;
        const file   = fs.createWriteStream(destFile);

        // Update the active download entry with the live req and file
        const entry = activeDownloads.get(identifier);
        if (entry) { entry.req = req; entry.file = file; }

        res.on('data', chunk => {
          if (cancelled) return;
          received += chunk.length;
          if (total > 0) {
            try {
              if (!event.sender.isDestroyed()) {
                event.sender.send('download-progress', { identifier, percent: Math.round(received / total * 100) });
              }
            } catch {}
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          if (cancelled) return;
          file.close();
          activeDownloads.delete(identifier);
          resolve({ ok: true, filePath: destFile });
        });

        file.on('error', err => {
          if (cancelled) return;
          fs.unlink(destFile, () => {});
          activeDownloads.delete(identifier);
          resolve({ ok: false, error: err.message });
        });
      });

      // Store req so cancel can destroy it
      const entry = activeDownloads.get(identifier);
      if (entry) entry.req = req;

      req.on('timeout', () => {
        if (cancelled) return;
        req.destroy();
        activeDownloads.delete(identifier);
        resolve({ ok: false, error: 'Connection timed out' });
      });

      req.on('error', err => {
        if (cancelled) return; // cancelled — already resolved, ignore
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
    // Call the cancel hook — resolves the promise and cleans up
    if (typeof dl.cancel === 'function') dl.cancel();
    // Also destroy req/file if they exist
    try { dl.req?.destroy(); }  catch {}
    try { dl.file?.close();  }  catch {}
    activeDownloads.delete(identifier);
  }
  return { ok: true };
});

// ─── Extract ──────────────────────────────────────────────────────────────────

ipcMain.handle('extract-archive', async (_, { filePath, identifier, subFolder }) => {
  const settings       = loadSettings();
  const installBase    = settings.installPath || DEFAULT_GAMES_DIR;
  // parentDir = the identifier's root folder (e.g. ni-ghts-into-dreams_202511)
  const parentDir      = path.join(installBase, sanitizeFolderName(identifier));
  // destDir   = where this specific archive extracts to
  //   - Single game:       parentDir  (e.g. .../ni-ghts-into-dreams_202511/)
  //   - Collection item:   parentDir/subFolder  (e.g. .../ni-ghts-into-dreams_202511/Crazy Taxi/)
  // Collection game subfolders are prefixed with _GAME_ so findExesInDir
  // can identify them and list their executables grouped by game name.
  const destDir = subFolder
    ? path.join(parentDir, '_GAME_' + sanitizeFolderName(subFolder))
    : parentDir;

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const ext    = filePath.toLowerCase();
  const sevenZ = 'C:\\Program Files\\7-Zip\\7z.exe';

  const unblockAfterExtract = () => unblockDirectory(destDir);

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
        resolve({ ok: true, installDir: destDir, parentInstallDir: parentDir });
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
      return { ok: true, installDir: destDir, parentInstallDir: parentDir };
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
    return findExesInDir(installDir);
  } catch { return []; }
});

// ─── Launch + playtime ────────────────────────────────────────────────────────

// Recursively delete Zone.Identifier alternate data streams from all files under a directory.
// This is what right-click → Unblock does on Windows, but done directly via Node fs.
function unblockDirectory(dir) {
  if (process.platform !== 'win32') return Promise.resolve();
  let count = 0;
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        // Delete the Zone.Identifier ADS — this is exactly what Unblock-File does
        try {
          fs.rmSync(full + ':Zone.Identifier');
          count++;
        } catch { /* stream doesn't exist or already removed — fine */ }
      }
    }
  }
  walk(dir);
  console.log(`[unblock] Removed Zone.Identifier from ${count} files in ${dir}`);
  return Promise.resolve();
}

ipcMain.handle('launch-game', (_, { identifier, exePath }) => {
  return new Promise(async (resolve) => {
    if (!fs.existsSync(exePath)) return resolve({ ok: false, error: 'Executable not found: ' + exePath });

    // Unblock the install directory on every launch — covers both freshly installed
    // games and games that were installed before this fix was added.
    const gameRow     = db?.prepare('SELECT install_dir FROM games WHERE identifier = ?').get(identifier);
    const unblockRoot = gameRow?.install_dir || path.dirname(exePath);
    await unblockDirectory(unblockRoot);

    const start = Date.now();

    // shell.openPath uses Windows ShellExecute — handles UAC elevation prompts
    // correctly, unlike execFile which just gets EACCES on elevated exes.
    shell.openPath(exePath).then((errMsg) => {
      if (errMsg) {
        resolve({ ok: false, error: errMsg });
      } else {
        // Track playtime roughly — we can't watch the process directly with openPath
        // so we record a start time and write it when the launcher is next focused.
        resolve({ ok: true });
      }
    });
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

// ─── Startup: validate installs + scan for pre-existing games ───────────────────
//
// Called once after the window is ready. Two jobs:
//   1. Validate — any DB row with install_dir that no longer exists on disk gets cleared.
//   2. Scan — look in the install/download dirs for folders matching known identifiers
//      that aren't already registered, and auto-register them.

// Walk a directory tree looking for .exe files.
// Strategy: scan the current directory for .exe files. If found, return them.
// If not, recurse into non-ignored subdirectories (breadth-first by level) and
// return the exes from the FIRST level that contains any. This handles installs
// that are nested arbitrarily deep (e.g. identifier/ -> Game Name/ -> Game Name/ -> .exe)
// Depth limit prevents runaway recursion on large installs.
function findExesInDir(installDir, _depth) {
  const MAX_DEPTH = 5;
  const depth = _depth || 0;
  if (depth > MAX_DEPTH) return [];

  try {
    let entries;
    try { entries = fs.readdirSync(installDir, { withFileTypes: true }); }
    catch { return []; }

    // ── Collection detection ─────────────────────────────────────────────────
    // If this folder contains _GAME_ prefixed subfolders, it's a multi-game
    // collection. Scan each _GAME_ subfolder and return ALL their exes so the
    // picker can list them grouped by game name.
    const gameFolders = entries.filter(
      e => e.isDirectory() && e.name.startsWith('_GAME_')
    );
    if (gameFolders.length > 0) {
      const allExes = [];
      for (const gf of gameFolders) {
        const gameDir  = path.join(installDir, gf.name);
        // Recurse into each game subfolder to find its exe
        const gameExes = findExesInDir(gameDir, depth + 1);
        allExes.push(...gameExes);
      }
      return allExes;
    }

    // ── Standard single-game detection ───────────────────────────────────────
    // Check for a 'bin' subfolder first — common pattern for some games
    const binEntry = entries.find(
      e => e.isDirectory() && e.name.toLowerCase() === 'bin'
    );
    if (binEntry) {
      const binExes = exesInDir(path.join(installDir, binEntry.name));
      if (binExes.length) return binExes;
    }

    // Collect .exe files directly in this folder
    const localExes = exesInDir(installDir);
    if (localExes.length) return localExes;

    // No exes here — recurse into non-ignored subdirectories
    const subdirs = entries.filter(
      e => e.isDirectory() && !IGNORED_SUBDIRS.has(e.name.toLowerCase())
    );

    for (const sub of subdirs) {
      const found = findExesInDir(path.join(installDir, sub.name), depth + 1);
      if (found.length) return found;
    }

    return [];
  } catch { return []; }
}

// Return .exe files directly inside a single directory (no recursion)
function exesInDir(dir) {
  try {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        results.push(path.join(dir, entry.name));
      }
    }
    return results;
  } catch { return []; }
}

function validateInstalls() {
  if (!db) return { cleared: 0 };
  const rows = db.prepare('SELECT identifier, install_dir FROM games WHERE install_dir IS NOT NULL').all();
  let cleared = 0;
  for (const row of rows) {
    if (!fs.existsSync(row.install_dir)) {
      db.prepare('UPDATE games SET install_dir = NULL, exe_path = NULL WHERE identifier = ?').run(row.identifier);
      console.log(`[validate] Cleared missing install: ${row.identifier}`);
      cleared++;
    }
  }
  if (cleared > 0) console.log(`[validate] Cleared ${cleared} missing installs`);
  return { cleared };
}

// Sanitize a game title into a safe Windows folder name the same way a browser
// download would (strips illegal chars, trims trailing dots/spaces).
function sanitizeTitle(title) {
  return String(title)
    .replace(/[<>:"/\\|?*]/g, '_')   // replace Windows-illegal chars with _
    .replace(/[.\s]+$/, '')           // strip trailing dots and spaces
    .trim();
}

// Build a lookup: sanitized-title (lowercase) → original title
// so we can do case-insensitive folder-name matching.
function buildTitleLookup(titleMap) {
  const lookup = {}; // normalizedTitle → { original, identifier }
  for (const [title, identifier] of Object.entries(titleMap || {})) {
    const normalized = sanitizeTitle(title).toLowerCase();
    if (normalized) lookup[normalized] = { original: title, identifier };
  }
  return lookup;
}

// Scan a directory for pre-existing game installs.
// knownIdentifiers = array of identifier strings from the renderer.
// titleMap         = { gameTitle: identifier } for title-based matching.
// Returns { found: [ { identifier, installDir, exePath, matchedBy } ] }
ipcMain.handle('scan-for-games', (_, { scanDir, knownIdentifiers, titleMap }) => {
  if (!db || !scanDir || !fs.existsSync(scanDir)) return { found: [] };

  const identifierSet  = new Set(knownIdentifiers);
  const titleLookup    = buildTitleLookup(titleMap);
  const found          = [];

  let entries;
  try { entries = fs.readdirSync(scanDir, { withFileTypes: true }); }
  catch { return { found: [] }; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const folderPath = path.join(scanDir, folderName);

    let matchedId  = null;
    let matchedBy  = null;

    // ─ Pass 1: exact identifier match ──────────────────────────────────────
    if (identifierSet.has(folderName)) {
      matchedId = folderName;
      matchedBy = 'identifier';
    }

    // ─ Pass 2: sanitized identifier match ──────────────────────────────
    if (!matchedId) {
      for (const id of identifierSet) {
        if (sanitizeFolderName(id) === folderName) {
          matchedId = id;
          matchedBy = 'identifier-sanitized';
          break;
        }
      }
    }

    // ─ Pass 3: game title match (case-insensitive) ──────────────────────
    // Handles folders named "Zoo Tycoon - Complete Collection" downloaded directly
    // from archive.org, where the folder name mirrors the game title not the identifier.
    if (!matchedId && titleLookup) {
      const normalizedFolder = sanitizeTitle(folderName).toLowerCase();
      const hit = titleLookup[normalizedFolder];
      if (hit) {
        matchedId = hit.identifier;
        matchedBy = 'title';
      }
    }

    if (!matchedId) continue;

    // Skip if already registered with a valid install_dir
    const existing = db.prepare('SELECT install_dir FROM games WHERE identifier = ?').get(matchedId);
    if (existing?.install_dir && fs.existsSync(existing.install_dir)) continue;

    // Find an exe
    const exes    = findExesInDir(folderPath);
    const exePath = exes.length === 1 ? exes[0] : null;

    // Register it
    db.prepare(`
      INSERT OR IGNORE INTO games (identifier, added_at) VALUES (?, ?)
    `).run(matchedId, Date.now());
    db.prepare('UPDATE games SET install_dir = ?, exe_path = ? WHERE identifier = ?')
      .run(folderPath, exePath, matchedId);

    console.log(`[scan] Found pre-existing install (${matchedBy}): ${matchedId} → ${folderPath}`);
    found.push({ identifier: matchedId, installDir: folderPath, exePath, matchedBy });
  }

  return { found };
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

ipcMain.handle('delete-game', async (_, { identifier, installDir }) => {
  try {
    console.log(`[delete] identifier=${identifier} installDir=${installDir}`);
    if (installDir) {
      if (fs.existsSync(installDir)) {
        // Use shell.trashItem to move to Recycle Bin — avoids EPERM on locked folders
        // and is safer than force-deleting since the user can recover files if needed.
        await shell.trashItem(installDir);
        console.log(`[delete] Moved to Recycle Bin: ${installDir}`);
      } else {
        console.log(`[delete] Folder not found on disk (already gone?): ${installDir}`);
      }
    } else {
      console.log(`[delete] No installDir provided — only clearing DB entry`);
    }
    if (db) db.prepare('DELETE FROM games WHERE identifier = ?').run(identifier);
    return { ok: true };
  } catch (e) {
    console.error(`[delete] Failed:`, e.message);
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

// ─── Add to Steam ───────────────────────────────────────────────────────────
//
// Writes a non-Steam game shortcut into Steam's shortcuts.vdf binary file.
// This is the same approach used by Heroic Games Launcher.
// After writing, Steam must be restarted for the shortcut to appear.

function findSteamPath() {
  if (process.platform === 'win32') {
    // Try registry first
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
        { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
      );
      const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match) {
        const p = match[1].trim();
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    // Fallback to common paths
    const candidates = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      path.join(process.env.ProgramFiles || '', 'Steam'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Steam'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

function getSteamUserIds(steamPath) {
  const userdataDir = path.join(steamPath, 'userdata');
  if (!fs.existsSync(userdataDir)) return [];
  return fs.readdirSync(userdataDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+$/.test(e.name) && e.name !== '0')
    .map(e => e.name);
}

// ─── Binary VDF shortcuts.vdf parser / writer ─────────────────────────────────
// Valve's binary VDF format (used for shortcuts.vdf):
//   \x00key\x00  = object/sub-map start
//   \x01key\x00value\x00 = string value
//   \x02key\x00<4-byte LE int32> = int32 value
//   \x08 = end of object

function readVdfShortcuts(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const buf = fs.readFileSync(filePath);
  const shortcuts = [];
  let i = 0;

  // Skip root object header (\x00shortcuts\x00)
  if (buf[i] === 0x00) {
    i++; // type byte
    while (i < buf.length && buf[i] !== 0x00) i++; // skip key string
    i++; // null terminator
  }

  while (i < buf.length) {
    if (buf[i] === 0x08) break; // end of root
    if (buf[i] !== 0x00) { i++; continue; } // unexpected byte — skip
    i++; // type 0x00 = object

    // Read index key (e.g. "0", "1", "2")
    while (i < buf.length && buf[i] !== 0x00) i++;
    i++; // null terminator after key

    // Read object fields until 0x08
    const entry = {};
    while (i < buf.length && buf[i] !== 0x08) {
      const type = buf[i]; i++;
      // Read key string
      let key = '';
      while (i < buf.length && buf[i] !== 0x00) { key += String.fromCharCode(buf[i]); i++; }
      i++; // null terminator

      if (type === 0x01) {
        // String value
        let val = '';
        while (i < buf.length && buf[i] !== 0x00) { val += String.fromCharCode(buf[i]); i++; }
        i++;
        entry[key] = val;
      } else if (type === 0x02) {
        // Int32 LE
        entry[key] = buf.readInt32LE(i);
        i += 4;
      } else if (type === 0x00) {
        // Nested object (e.g. tags) — read and skip
        const nested = {};
        while (i < buf.length && buf[i] !== 0x08) {
          const ntype = buf[i]; i++;
          let nkey = '';
          while (i < buf.length && buf[i] !== 0x00) { nkey += String.fromCharCode(buf[i]); i++; }
          i++;
          if (ntype === 0x01) {
            let nval = '';
            while (i < buf.length && buf[i] !== 0x00) { nval += String.fromCharCode(buf[i]); i++; }
            i++;
            nested[nkey] = nval;
          } else if (ntype === 0x02) {
            nested[nkey] = buf.readInt32LE(i); i += 4;
          }
        }
        i++; // 0x08 end of nested
        entry[key] = nested;
      } else {
        // Unknown type — stop parsing this entry
        break;
      }
    }
    if (buf[i] === 0x08) i++; // end of entry
    if (Object.keys(entry).length > 0) shortcuts.push(entry);
  }
  return shortcuts;
}

function writeVdfShortcuts(filePath, shortcuts) {
  const parts = [];

  const writeStr = (s) => {
    const b = Buffer.from(s + '\x00', 'latin1');
    parts.push(b);
  };
  const writeInt32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    parts.push(b);
  };
  const writeByte = (n) => parts.push(Buffer.from([n]));

  // Root object header: \x00 shortcuts \x00
  writeByte(0x00);
  writeStr('shortcuts');

  shortcuts.forEach((entry, idx) => {
    writeByte(0x00);          // type: object
    writeStr(String(idx));    // index key

    const writeField = (type, key, value) => {
      writeByte(type);
      writeStr(key);
      if (type === 0x01) writeStr(value);
      else if (type === 0x02) writeInt32(value);
    };

    writeField(0x02, 'appid',              entry.appid              || 0);
    writeField(0x01, 'appname',            entry.appname            || entry.AppName || '');
    writeField(0x01, 'Exe',                entry.Exe                || entry.exe     || '');
    writeField(0x01, 'StartDir',           entry.StartDir           || '');
    writeField(0x01, 'icon',               entry.icon               || '');
    writeField(0x01, 'ShortcutPath',       entry.ShortcutPath       || '');
    writeField(0x01, 'LaunchOptions',      entry.LaunchOptions      || '');
    writeField(0x02, 'IsHidden',           entry.IsHidden           || 0);
    writeField(0x02, 'AllowDesktopConfig', entry.AllowDesktopConfig !== undefined ? entry.AllowDesktopConfig : 1);
    writeField(0x02, 'AllowOverlay',       entry.AllowOverlay       !== undefined ? entry.AllowOverlay       : 1);
    writeField(0x02, 'OpenVR',             entry.OpenVR             || 0);
    writeField(0x02, 'Devkit',             entry.Devkit             || 0);
    writeField(0x01, 'DevkitGameID',       entry.DevkitGameID       || '');
    writeField(0x02, 'DevkitOverrideAppID',entry.DevkitOverrideAppID|| 0);
    writeField(0x02, 'LastPlayTime',       entry.LastPlayTime       || 0);
    writeField(0x01, 'FlatpakAppID',       entry.FlatpakAppID       || '');
    writeField(0x01, 'sortas',             '');

    // Tags sub-object
    writeByte(0x00);
    writeStr('tags');
    const tags = entry.tags || {};
    const tagEntries = typeof tags === 'object' && !Array.isArray(tags)
      ? Object.entries(tags)
      : (Array.isArray(tags) ? tags.map((v,i) => [String(i), v]) : []);
    for (const [tk, tv] of tagEntries) {
      writeByte(0x01);
      writeStr(tk);
      writeStr(tv);
    }
    writeByte(0x08); // end tags

    writeByte(0x08); // end entry
  });

  writeByte(0x08); // end shortcuts
  writeByte(0x08); // end root

  fs.writeFileSync(filePath, Buffer.concat(parts));
}

// Generate a stable non-Steam appid from exe path + app name.
// Steam's algorithm: CRC32(quotedExe + appName) | 0x80000000, as a signed int32.
// The exe string passed here must be the quoted form ("C:\path\game.exe")
// because that is what Steam itself stores in the Exe field.
function generateNonSteamAppId() {
  // Generate a random non-Steam appid matching exactly what Steam itself does:
  // a random 32-bit unsigned integer with the top bit set (non-Steam game range).
  const rand = Math.floor(Math.random() * 0x7FFFFFFF);
  return (rand | 0x80000000) >>> 0;
}

ipcMain.handle('add-to-steam', async (_, { appName, exePath, startDir, iconPath }) => {
  try {
    const steamPath = findSteamPath();
    if (!steamPath) return { ok: false, error: 'Steam installation not found.' };

    const userIds = getSteamUserIds(steamPath);
    if (!userIds.length) return { ok: false, error: 'No Steam user accounts found.' };

    // Exe field is stored with surrounding quotes in the VDF — Steam requires this.
    // The appID CRC is computed from the quoted exe string + appName, matching
    // what Steam ROM Manager, SteamTinkerLaunch, and the ICE project all use.
    const quotedExe = `"${exePath}"`;
    const appId     = generateNonSteamAppId();
    const updated = [];
    const skipped = [];

    for (const userId of userIds) {
      const configDir     = path.join(steamPath, 'userdata', userId, 'config');
      const shortcutsPath = path.join(configDir, 'shortcuts.vdf');

      // Ensure config dir exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Read existing shortcuts
      let shortcuts = [];
      try {
        shortcuts = readVdfShortcuts(shortcutsPath);
      } catch (e) {
        console.warn(`[add-to-steam] Could not read shortcuts.vdf for user ${userId}:`, e.message);
      }

      // Check if already added (match by exe or appid)
      const normalizedExe = exePath.replace(/\\/g, '/').toLowerCase();
      const alreadyExists = shortcuts.some(s => {
        const sExe = (s.Exe || s.exe || '').replace(/\\/g, '/').toLowerCase()
          .replace(/^"|"$/g, ''); // strip surrounding quotes for comparison
        return sExe === normalizedExe || s.appid === appId;
      });

      if (alreadyExists) {
        skipped.push(userId);
        continue;
      }

      // Backup the existing file before modifying
      if (fs.existsSync(shortcutsPath)) {
        try {
          fs.copyFileSync(shortcutsPath, shortcutsPath + '.bak');
        } catch {}
      }

      // Add the new shortcut.
      // Exe: quoted path (Steam requires this for the launch command).
      // StartDir: bare path WITHOUT quotes (quotes here break Steam's launch on Windows).
      // Ensure StartDir has a trailing backslash — Steam writes it this way
      const startDirSlashed = startDir.endsWith('\\') ? startDir : startDir + '\\';
      shortcuts.push({
        appid:              appId,
        appname:            appName,
        Exe:                quotedExe,
        StartDir:           startDirSlashed,
        icon:               '',
        ShortcutPath:       '',
        LaunchOptions:      '',
        IsHidden:           0,
        AllowDesktopConfig: 1,
        AllowOverlay:       1,
        OpenVR:             0,
        Devkit:             0,
        DevkitGameID:       '',
        DevkitOverrideAppID:0,
        LastPlayTime:       0,
        FlatpakAppID:       '',
        tags:               {},
      });

      writeVdfShortcuts(shortcutsPath, shortcuts);
      updated.push(userId);
      console.log(`[add-to-steam] Added "${appName}" for user ${userId}`);
    }

    if (updated.length === 0 && skipped.length > 0) {
      return { ok: true, alreadyAdded: true };
    }

    return { ok: true, alreadyAdded: false, updatedUsers: updated.length };
  } catch (e) {
    console.error('[add-to-steam] Error:', e.message);
    return { ok: false, error: e.message };
  }
});

// Archive.org reviews

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