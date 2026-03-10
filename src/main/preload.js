'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: ()      => ipcRenderer.send('window-minimize'),
  windowMaximize: ()      => ipcRenderer.send('window-maximize'),
  windowClose:    ()      => ipcRenderer.send('window-close'),

  // Settings
  getSettings:    ()      => ipcRenderer.invoke('settings-get'),
  saveSettings:   (s)     => ipcRenderer.invoke('settings-save', s),
  chooseFolder:   ()      => ipcRenderer.invoke('choose-folder'),

  // Library
  getLibrary:     ()      => ipcRenderer.invoke('library-get'),
  getLibraryGame: (opts)  => ipcRenderer.invoke('library-get-game',    opts),
  setCategory:    (opts)  => ipcRenderer.invoke('library-set-category', opts),
  setFavorite:    (opts)  => ipcRenderer.invoke('library-set-favorite', opts),
  setNotes:       (opts)  => ipcRenderer.invoke('library-set-notes',    opts),

  // Collections
  getCollections:       ()     => ipcRenderer.invoke('collections-get'),
  createCollection:     (opts) => ipcRenderer.invoke('collections-create',     opts),
  deleteCollection:     (opts) => ipcRenderer.invoke('collections-delete',     opts),
  renameCollection:     (opts) => ipcRenderer.invoke('collections-rename',     opts),
  addGameToCollection:  (opts) => ipcRenderer.invoke('collections-add-game',   opts),
  removeGameFromCollection: (opts) => ipcRenderer.invoke('collections-remove-game', opts),

  // Download
  fetchFileList:  (opts)  => ipcRenderer.invoke('fetch-file-list', opts),
  downloadStart:  (opts)  => ipcRenderer.invoke('download-start',  opts),
  downloadCancel: (opts)  => ipcRenderer.invoke('download-cancel', opts),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),

  // Extract / Install / Delete
  extractArchive: (opts)  => ipcRenderer.invoke('extract-archive', opts),
  installGame:    (opts)  => ipcRenderer.invoke('install-game',    opts),
  setExePath:     (opts)  => ipcRenderer.invoke('set-exe-path',    opts),
  deleteGame:     (opts)  => ipcRenderer.invoke('delete-game',     opts),
  findExes:       (opts)  => ipcRenderer.invoke('find-exes',       opts),

  // Launch
  launchGame:     (opts)  => ipcRenderer.invoke('launch-game',         opts),
  openGameLocation: (opts)=> ipcRenderer.invoke('open-game-location',  opts),
  readReadme:     (opts)  => ipcRenderer.invoke('read-readme',         opts),

  // Reviews
  fetchReviews:   (opts)  => ipcRenderer.invoke('fetch-reviews', opts),

  // Auto-updater
  onUpdaterStatus: (cb) => ipcRenderer.on('updater-status', (_, data) => cb(data)),
  updaterInstall:  ()   => ipcRenderer.invoke('updater-install'),

  // App info
  getAppVersion:   () => ipcRenderer.invoke('app-version'),
  getHeroesPath:   () => ipcRenderer.invoke('heroes-path'),
  checkGameHero:   (opts) => ipcRenderer.invoke('check-game-hero', opts),
  openExternal:    (url) => ipcRenderer.send('open-external', url),
});
