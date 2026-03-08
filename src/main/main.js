const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#0d0f14',
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus(); mainWindow.webContents.openDevTools();
    console.log('Window shown.');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
}

app.whenReady().then(() => {
  console.log('App ready, creating window...');
  createWindow();
  console.log('Window created.');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('close-window', () => mainWindow.close());

ipcMain.handle('fetch-games', async () => {
  try {
    const url = 'https://archive.org/advancedsearch.php?q=uploader%3Arohanjackson071%40gmail.com+mediatype%3Asoftware&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=year&fl%5B%5D=downloads&fl%5B%5D=item_size&rows=200&output=json';
    const response = await axios.get(url);
    console.log('Games fetched:', response.data.response.docs.length);
    return response.data.response.docs;
  } catch (err) {
    console.error('Failed to fetch games:', err.message);
    return [];
  }
});

ipcMain.handle('fetch-game-meta', async (event, identifier) => {
  try {
    const response = await axios.get(`https://archive.org/metadata/${identifier}`);
    return response.data;
  } catch (err) {
    console.error('Failed to fetch metadata:', err.message);
    return null;
  }
});

ipcMain.handle('launch-game', async (event, exePath) => {
  try {
    spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(exePath)
    }).unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  shell.openPath(folderPath);
});
