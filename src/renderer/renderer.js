'use strict';
/**
 * RohanKar Launcher — renderer.js
 * Session 5: Auto-updater UI added.
 */

// ─── Archive.org API ──────────────────────────────────────────────────────────

const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php';
const UPLOADER       = 'rohanjackson071@gmail.com';

// ─── State ────────────────────────────────────────────────────────────────────

let allGames      = [];
let library       = {};
let selectedGame  = null;
let sortOrder     = 'az'; // default: A→Z
let fileListCache = {};   // identifier → { files, size }
let installedFirst = false; // setting: always show installed titles first

// ─── DOM refs ────────────────────────────────────────────────

// Update bar
const updateBar        = document.getElementById('update-bar');
const updateMsg        = document.getElementById('update-msg');
const btnUpdateInstall = document.getElementById('btn-update-install');
const btnUpdateDismiss = document.getElementById('btn-update-dismiss');

// About modal
const aboutModal           = document.getElementById('about-modal');
const aboutVersion         = document.getElementById('about-version');
const btnAbout             = document.getElementById('btn-about');
const btnCloseAbout        = document.getElementById('btn-close-about');
const btnCloseAboutFooter  = document.getElementById('btn-close-about-footer');

// Changelog modal
const changelogModal   = document.getElementById('changelog-modal');
const changelogHeading = document.getElementById('changelog-heading');
const changelogBadge   = document.getElementById('changelog-version-badge');
const changelogDate    = document.getElementById('changelog-date');
const changelogBody    = document.getElementById('changelog-body');
const btnCloseChangelog    = document.getElementById('btn-close-changelog');
const btnChangelogInstall  = document.getElementById('btn-changelog-install');
const btnChangelogClose    = document.getElementById('btn-changelog-close');

const btnMinimize             = document.getElementById('btn-minimize');
const btnMaximize             = document.getElementById('btn-maximize');
const btnClose                = document.getElementById('btn-close');
const searchInput             = document.getElementById('search-input');
const libraryGrid             = document.getElementById('library-grid');
const heroEl                  = document.getElementById('hero');
const heroImage               = document.getElementById('hero-image');
const heroLocal               = document.getElementById('hero-local');
const heroTitle               = document.getElementById('hero-title');
const detailPanel             = document.getElementById('detail-panel');
const detailCover             = document.getElementById('detail-cover');
const detailTitle             = document.getElementById('detail-title');
const detailMeta              = document.getElementById('detail-meta');
const detailExtra             = document.getElementById('detail-extra');
const detailRating            = document.getElementById('detail-rating');
const detailPlaytime          = document.getElementById('detail-playtime');
const detailDescArchive       = document.getElementById('detail-desc-archive');
const detailDescExtra         = document.getElementById('detail-desc-igdb');
const descSeparator           = document.getElementById('desc-separator');
const sortFilter              = document.getElementById('sort-filter');
const btnDownload             = document.getElementById('btn-download');
const btnLaunch               = document.getElementById('btn-launch');
const btnDelete               = document.getElementById('btn-delete');
const btnOpenLocation         = document.getElementById('btn-open-location');
const btnClearDefault         = document.getElementById('btn-clear-default');
const progressWrap            = document.getElementById('progress-wrap');
const progressBar             = document.getElementById('progress-bar');
const progressText            = document.getElementById('progress-text');
const btnCancelDownload       = document.getElementById('btn-cancel-download');
const readmeContent           = document.getElementById('readme-content');
const readmeEmpty             = document.getElementById('readme-empty');
const reviewsList             = document.getElementById('reviews-list');
const reviewsEmpty            = document.getElementById('reviews-empty');
const reviewsLoading          = document.getElementById('reviews-loading');
const tabButtons              = document.querySelectorAll('.tab-btn');
const tabPanels               = document.querySelectorAll('.tab-panel');
const settingsBtn             = document.getElementById('btn-settings');
const settingsModal           = document.getElementById('settings-modal');
const settingsCloseBtn        = document.getElementById('btn-close-settings');
const downloadPathInput       = document.getElementById('setting-download-path');
const installPathInput        = document.getElementById('setting-install-path');
const deleteAfterInstallCheck = document.getElementById('setting-delete-after-install');
const installedFirstCheck     = document.getElementById('setting-installed-first');
const btnChooseDownload       = document.getElementById('btn-choose-download');
const btnChooseInstall        = document.getElementById('btn-choose-install');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTitle(game) {
  const t = Array.isArray(game.title) ? game.title[0] : game.title;
  return (t && String(t).trim()) || game.identifier?.replace(/-/g, ' ') || 'Unknown';
}

function getThumb(game) {
  return `https://archive.org/services/img/${game.identifier}`;
}

// Local hero image path — returns a file:// URL if a bundled hero exists for
// this identifier, otherwise returns null so we fall back to the archive.org thumb.
function getLocalHero(identifier) {
  // In a packaged app, __dirname points inside the asar — use process.resourcesPath.
  // In dev, fall back to relative path from renderer.
  try {
    const base = window._heroBasePath; // set once on init
    if (!base) return null;
    return `${base}/${identifier}.png`;
  } catch { return null; }
}

function truncate(str, max) {
  const s = Array.isArray(str) ? str[0] : str;
  if (!s) return '';
  const text = String(s);
  return text.length <= max ? text : text.slice(0, max).trimEnd() + '…';
}

// ─── Markdown-lite renderer (for changelog body) ─────────────────────────────
// Converts a small subset of GitHub-flavoured markdown to safe HTML.
// No external library needed — we only need what release notes actually use.
function markdownToHtml(md) {
  if (!md) return '<p class="changelog-no-notes">No release notes provided.</p>';

  // Escape HTML entities first
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Unordered list items
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> blocks in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // Line breaks → paragraphs (split on double newline)
  html = html
    .split(/\n{2,}/)
    .map(block => {
      block = block.trim();
      if (!block) return '';
      // Don't wrap block-level elements in <p>
      if (/^<(h[1-3]|ul|li|hr|p)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

// ─── Changelog modal ────────────────────────────────────────────────────────

let pendingUpdateInfo = null; // { version, releaseNotes, releaseDate, isReady }

function openChangelog() {
  if (!changelogModal || !pendingUpdateInfo) return;

  const { version, releaseNotes, releaseDate, isReady } = pendingUpdateInfo;

  changelogBadge.textContent = `v${version}`;

  if (releaseDate) {
    const d = new Date(releaseDate);
    changelogDate.textContent = `Released ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
    changelogDate.style.display = 'block';
  } else {
    changelogDate.style.display = 'none';
  }

  changelogBody.innerHTML = markdownToHtml(releaseNotes);

  // Show "Restart & Update" only when download is ready
  if (isReady) btnChangelogInstall.classList.remove('hidden');
  else         btnChangelogInstall.classList.add('hidden');

  changelogModal.classList.remove('hidden');
}

function closeChangelog() {
  changelogModal?.classList.add('hidden');
}

// ─── About modal ────────────────────────────────────────────────────────────

async function openAbout() {
  if (!aboutModal) return;
  // Populate version lazily on first open
  if (!aboutVersion.textContent) {
    const v = await window.electronAPI.getAppVersion();
    aboutVersion.textContent = `Version ${v}`;
  }
  aboutModal.classList.remove('hidden');
}

function closeAbout() {
  aboutModal?.classList.add('hidden');
}

function formatPlaytime(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m played`;
  return `${m}m played`;
}

function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return null;
  const b = Number(bytes);
  if (b >= 1_000_000_000) return (b / 1_000_000_000).toFixed(2) + ' GB';
  return (b / 1_000_000).toFixed(1) + ' MB';
}

function setHeroImage(src) {
  // Fallback mode: blurred background image (archive.org thumb or no image)
  heroEl.classList.remove('has-local-hero');
  heroLocal.classList.add('hidden');
  heroLocal.src = '';
  heroImage.style.backgroundImage = src ? `url("${src}")` : 'none';
}

function setHeroLocal(src) {
  // Local hero mode: real img tag, full dimensions, no blur
  heroEl.classList.add('has-local-hero');
  heroImage.style.backgroundImage = 'none';
  heroLocal.src = src;
  heroLocal.classList.remove('hidden');
}

function setDetailCover(src) {
  if (src) {
    detailCover.src = src;
    detailCover.classList.remove('hidden');
  } else {
    detailCover.classList.add('hidden');
  }
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

function getSortedGames(games) {
  const query = searchInput.value.toLowerCase().trim();
  let filtered = query
    ? games.filter(g => getTitle(g).toLowerCase().includes(query))
    : [...games];

  switch (sortOrder) {
    case 'az':
      filtered.sort((a, b) => getTitle(a).localeCompare(getTitle(b)));
      break;
    case 'za':
      filtered.sort((a, b) => getTitle(b).localeCompare(getTitle(a)));
      break;
    case 'date-archived':
      // addeddate = when the item was uploaded to archive.org (e.g. "2024-10-25 12:00:00")
      filtered.sort((a, b) => new Date(b.addeddate || 0) - new Date(a.addeddate || 0));
      break;
    case 'date-published':
      // date = the game's original release year (e.g. "1996")
      filtered.sort((a, b) => {
        const ya = parseInt(a.date) || 0;
        const yb = parseInt(b.date) || 0;
        return yb - ya;
      });
      break;
    case 'developer': {
      const getDev = g => {
        const s = Array.isArray(g.subject) ? g.subject[0] : (g.subject || '');
        return String(s).toLowerCase();
      };
      filtered.sort((a, b) => getDev(a).localeCompare(getDev(b)));
      break;
    }
  }

  // Installed First modifier — applied on top of any sort order
  if (installedFirst) {
    filtered.sort((a, b) => {
      const ai = library[a.identifier]?.install_dir ? 1 : 0;
      const bi = library[b.identifier]?.install_dir ? 1 : 0;
      return bi - ai; // keep relative order within each group (stable sort)
    });
  }

  return filtered;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Window controls
  btnMinimize.addEventListener('click', () => window.electronAPI.windowMinimize());
  btnMaximize.addEventListener('click', () => window.electronAPI.windowMaximize());
  btnClose.addEventListener('click',    () => window.electronAPI.windowClose());

  // Search
  searchInput.addEventListener('input', () => renderLibraryGrid());

  // Sort filter
  sortFilter.addEventListener('change', () => {
    sortOrder = sortFilter.value;
    renderLibraryGrid();
  });

  // Tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById('tab-' + btn.dataset.tab);
      if (target) target.classList.add('active');

      // Lazy-load reviews on tab click
      if (btn.dataset.tab === 'reviews' && selectedGame) {
        loadReviews(selectedGame.identifier);
      }
      // Reload readme on tab click if installed
      if (btn.dataset.tab === 'readme' && selectedGame) {
        const lib = library[selectedGame.identifier];
        if (lib?.install_dir) loadReadme(lib.install_dir);
        else if (readmeEmpty) readmeEmpty.style.display = 'block';
      }
    });
  });

  // Download / launch / delete / open location
  btnDownload.addEventListener('click', onDownload);
  btnLaunch.addEventListener('click',   onLaunch);
  btnDelete.addEventListener('click',   onDelete);
  btnOpenLocation.addEventListener('click', onOpenLocation);
  btnClearDefault.addEventListener('click', onClearDefault);
  btnCancelDownload.addEventListener('click', onCancelDownload);

  // Load installedFirst setting on startup
  const initSettings = await window.electronAPI.getSettings();
  installedFirst = !!initSettings.installedFirst;

  // Resolve local heroes folder path once (works in both dev and packaged)
  try {
    const heroesDir = await window.electronAPI.getHeroesPath();
    window._heroBasePath = 'file:///' + heroesDir.replace(/\\/g, '/');
  } catch {
    window._heroBasePath = null;
  }

  // Settings & About
  settingsBtn.addEventListener('click', openSettings);
  btnAbout.addEventListener('click', openAbout);
  btnCloseAbout.addEventListener('click', closeAbout);
  btnCloseAboutFooter.addEventListener('click', closeAbout);
  aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) closeAbout(); });
  document.querySelectorAll('#about-links a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(a.href);
    });
  });
  settingsCloseBtn.addEventListener('click', closeSettings);
  btnChooseDownload.addEventListener('click', async () => {
    const p = await window.electronAPI.chooseFolder();
    if (p) downloadPathInput.value = p;
  });
  btnChooseInstall.addEventListener('click', async () => {
    const p = await window.electronAPI.chooseFolder();
    if (p) installPathInput.value = p;
  });
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Download progress
  window.electronAPI.onDownloadProgress(({ identifier, percent }) => {
    if (selectedGame?.identifier === identifier) {
      progressBar.style.width  = percent + '%';
      progressText.textContent = percent + '%';
    }
  });

  // ─── Auto-updater notifications
  window.electronAPI.onUpdaterStatus((data) => {
    if (!updateBar) return;
    updateBar.classList.remove('error');
    btnUpdateInstall.classList.add('hidden');

    // Build the "View Release Notes" button (reuse or create)
    let btnNotes = document.getElementById('btn-update-notes');
    if (!btnNotes) {
      btnNotes = document.createElement('button');
      btnNotes.id        = 'btn-update-notes';
      btnNotes.textContent = 'Release Notes';
      btnNotes.addEventListener('click', openChangelog);
      // Insert before the install button
      document.getElementById('update-actions').insertBefore(btnNotes, btnUpdateInstall);
    }

    switch (data.status) {
      case 'available':
        pendingUpdateInfo = {
          version:      data.version,
          releaseNotes: data.releaseNotes || null,
          releaseDate:  data.releaseDate  || null,
          isReady:      true,
        };
        updateMsg.textContent = `✨ Update v${data.version} available`;
        btnNotes.classList.remove('hidden');
        btnUpdateInstall.classList.remove('hidden');
        updateBar.classList.remove('hidden');
        break;

      case 'error': {
        // Suppress 404 errors — means no release exists yet on GitHub (pre-launch builds)
        const is404 = data.message && data.message.includes('404');
        if (!is404) {
          updateBar.classList.add('error');
          updateMsg.textContent = `Update error: ${data.message}`;
          btnNotes.classList.add('hidden');
          updateBar.classList.remove('hidden');
        }
        break;
      }
    }
  });

  btnUpdateInstall.addEventListener('click', () => {
    window.electronAPI.updaterInstall();
  });

  btnUpdateDismiss.addEventListener('click', () => {
    updateBar.classList.add('hidden');
  });

  // Changelog modal wiring
  btnCloseChangelog.addEventListener('click',   closeChangelog);
  btnChangelogClose.addEventListener('click',   closeChangelog);
  btnChangelogInstall.addEventListener('click', () => {
    closeChangelog();
    window.electronAPI.updaterInstall();
  });
  changelogModal.addEventListener('click', (e) => {
    if (e.target === changelogModal) closeChangelog();
  });

  await fetchGames();
}

// ─── Settings modal ───────────────────────────────────────────────────────────

async function openSettings() {
  const s = await window.electronAPI.getSettings();
  downloadPathInput.value           = s.downloadPath || '';
  installPathInput.value            = s.installPath  || '';
  deleteAfterInstallCheck.checked   = !!s.deleteAfterInstall;
  installedFirstCheck.checked       = !!s.installedFirst;
  settingsModal.classList.remove('hidden');
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

async function saveSettings() {
  await window.electronAPI.saveSettings({
    downloadPath:       downloadPathInput.value.trim(),
    installPath:        installPathInput.value.trim(),
    deleteAfterInstall: deleteAfterInstallCheck.checked,
    installedFirst:     installedFirstCheck.checked,
  });
  // Apply installedFirst live
  installedFirst = installedFirstCheck.checked;
  renderLibraryGrid();
  closeSettings();
}

// ─── Fetch games from archive.org ─────────────────────────────────────────────

async function fetchGames() {
  libraryGrid.innerHTML = '<p class="loading-msg">Loading games…</p>';
  try {
    // Fetch up to 500 at once — archive.org's start-offset pagination is unreliable
    const params = new URLSearchParams({
      q:      `uploader:${UPLOADER} mediatype:software`,
      fl:     'identifier,title,description,date,addeddate,downloads,subject',
      rows:   '500',
      start:  '0',
      output: 'json',
    });
    const res  = await fetch(`${ARCHIVE_SEARCH}?${params}`);
    const json = await res.json();
    const docs = json?.response?.docs || [];

    // Deduplicate by identifier (safety net)
    const seen = new Set();
    allGames = docs.filter(g => {
      if (seen.has(g.identifier)) return false;
      seen.add(g.identifier);
      return true;
    });

    library = await window.electronAPI.getLibrary();
    renderLibraryGrid();
  } catch (e) {
    libraryGrid.innerHTML = `<p class="loading-msg error">Failed to load games: ${e.message}</p>`;
  }
}

// ─── Library grid ─────────────────────────────────────────────────────────────

function renderLibraryGrid() {
  const sorted = getSortedGames(allGames);

  libraryGrid.innerHTML = '';

  if (!sorted.length) {
    libraryGrid.innerHTML = '<p class="loading-msg">No games found.</p>';
    return;
  }

  sorted.forEach(game => {
    const card  = document.createElement('div');
    card.className = 'game-card';
    if (selectedGame?.identifier === game.identifier) card.classList.add('selected');

    const libEntry = library[game.identifier];
    const thumb    = getThumb(game);

    const img = document.createElement('img');
    img.className = 'game-thumb';
    img.src   = thumb;
    img.alt   = getTitle(game);
    img.loading = 'lazy';

    const label = document.createElement('span');
    label.className   = 'card-label';
    label.textContent = getTitle(game);

    if (libEntry?.install_dir) {
      const badge = document.createElement('span');
      badge.className   = 'card-badge installed';
      badge.textContent = 'Installed';
      card.appendChild(badge);
    }

    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener('click', () => selectGame(game));
    libraryGrid.appendChild(card);
  });
}

// ─── Select game ─────────────────────────────────────────────────────────────

async function selectGame(game) {
  selectedGame = game;
  renderLibraryGrid();

  const title       = getTitle(game);
  const rawDesc     = Array.isArray(game.description) ? game.description[0] : game.description;
  const desc        = rawDesc ? String(rawDesc) : '';
  const thumbUrl    = getThumb(game);
  const localHero   = getLocalHero(game.identifier);

  // Hero priority:
  // 1. hero.png in the game's install folder (packaged by the uploader)
  // 2. Bundled hero in assets/heroes/{identifier}.png
  // 3. Blurred archive.org thumbnail fallback
  const libEntry    = library[game.identifier];
  const installDir  = libEntry?.install_dir || null;
  const gameHeroUrl = installDir
    ? await window.electronAPI.checkGameHero({ installDir })
    : null;

  if (gameHeroUrl) {
    setHeroLocal(gameHeroUrl);
  } else if (localHero) {
    const testImg = new Image();
    testImg.onload  = () => setHeroLocal(localHero);
    testImg.onerror = () => setHeroImage(thumbUrl);
    testImg.src = localHero;
  } else {
    setHeroImage(thumbUrl);
  }
  heroTitle.textContent = title;

  // detail cover always uses archive.org thumbnail
  setDetailCover(thumbUrl);
  detailTitle.textContent = title;

  const date      = game.date ? new Date(game.date).getFullYear() : '-';
  const downloads = game.downloads ? Number(game.downloads).toLocaleString() : '-';
  detailMeta.innerHTML =
    `<span>Year: <strong>${date}</strong></span>` +
    `<span>Downloads: <strong>${downloads}</strong></span>` +
    `<span id="detail-size"></span>`;

  // Fetch file list in background to show size (inline only, not on button)
  btnDownload.textContent = 'Install';
  const updateSize = (sizeStr) => {
    if (!sizeStr || selectedGame?.identifier !== game.identifier) return;
    const s = document.getElementById('detail-size');
    if (s) s.innerHTML = `Size: <strong>${sizeStr}</strong>`;
  };
  if (fileListCache[game.identifier]) {
    updateSize(fileListCache[game.identifier].size);
  } else {
    window.electronAPI.fetchFileList({ identifier: game.identifier }).then(result => {
      if (!result.ok || !result.files.length) return;
      const preferred = result.files.find(f => /\.zip$/i.test(f.name))
                     || result.files.find(f => /\.7z$/i.test(f.name))
                     || result.files.find(f => /\.rar$/i.test(f.name))
                     || result.files.find(f => /\.exe$/i.test(f.name));
      const sizeStr = preferred?.size ? formatSize(preferred.size) : null;
      fileListCache[game.identifier] = { files: result.files, size: sizeStr };
      updateSize(sizeStr);
    }).catch(() => {});
  }

  detailExtra.textContent = '';
  detailRating.classList.add('hidden');
  detailDescArchive.textContent = desc;
  detailDescExtra.textContent   = '';
  detailDescExtra.classList.add('hidden');
  descSeparator.classList.add('hidden');

  // playtime
  const libEntryPt = libEntry;
  if (libEntryPt?.playtime_secs) {
    detailPlaytime.textContent = formatPlaytime(libEntryPt.playtime_secs);
    detailPlaytime.classList.remove('hidden');
  } else {
    detailPlaytime.classList.add('hidden');
  }

  // readme — clear
  if (readmeContent)  readmeContent.textContent = '';
  if (readmeEmpty)    readmeEmpty.style.display  = 'none';

  // reviews — clear
  reviewsList.innerHTML = '';
  reviewsEmpty.style.display   = 'none';
  reviewsLoading.style.display = 'none';

  refreshButtonStates();
  resetProgressUI();

  // Load readme if installed
  if (libEntryPt?.install_dir) loadReadme(libEntryPt.install_dir);

  // show detail panel
  detailPanel.classList.remove('hidden');
}

// ─── Readme ───────────────────────────────────────────────────────────────────

async function loadReadme(installDir) {
  if (!readmeContent || !readmeEmpty) return;
  readmeContent.textContent = '';
  readmeEmpty.style.display = 'none';

  try {
    const result = await window.electronAPI.readReadme({ installDir });
    if (!result.ok || !result.text) {
      readmeEmpty.style.display = 'block';
      return;
    }
    readmeContent.textContent = result.text;
  } catch {
    readmeEmpty.style.display = 'block';
  }
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

async function loadReviews(identifier) {
  if (reviewsList.dataset.loaded === identifier) return;
  reviewsList.innerHTML        = '';
  reviewsLoading.style.display = 'block';
  reviewsEmpty.style.display   = 'none';

  try {
    const reviews = await window.electronAPI.fetchReviews({ identifier });
    reviewsLoading.style.display = 'none';

    if (!reviews.length) {
      reviewsEmpty.style.display = 'block';
      return;
    }
    reviews.forEach(r => {
      const div   = document.createElement('div');
      div.className = 'review-item';
      div.innerHTML = `
        <div class="review-header">
          <span class="review-author">${r.reviewer || 'Anonymous'}</span>
          <span class="review-stars">${'★'.repeat(r.stars || 0)}${'☆'.repeat(5 - (r.stars || 0))}</span>
          <span class="review-date">${r.reviewdate ? new Date(r.reviewdate).toLocaleDateString() : ''}</span>
        </div>
        <p class="review-body">${r.reviewbody || ''}</p>
      `;
      reviewsList.appendChild(div);
    });
    reviewsList.dataset.loaded = identifier;
  } catch {
    reviewsLoading.style.display = 'none';
    reviewsEmpty.style.display   = 'block';
  }
}

// ─── Button states ────────────────────────────────────────────────────────────

async function refreshButtonStates() {
  if (!selectedGame) {
    btnDownload.disabled = true;
    btnLaunch.disabled   = true;
    btnDelete.disabled   = true;
    btnOpenLocation.classList.add('hidden');
    btnClearDefault.classList.add('hidden');
    return;
  }
  const lib = library[selectedGame.identifier];
  const installed = !!(lib?.install_dir);
  btnDownload.disabled = installed;
  btnLaunch.disabled   = !installed;
  btnDelete.disabled   = !installed;
  if (installed) btnOpenLocation.classList.remove('hidden');
  else           btnOpenLocation.classList.add('hidden');
  // Show Clear Default only when a default exe is stored AND multiple exes exist
  // (single-exe games have nothing to "clear" — there's only one choice)
  if (installed && lib?.exe_path) {
    const exePaths = await window.electronAPI.findExes({ installDir: lib.install_dir });
    if (exePaths.length > 1) btnClearDefault.classList.remove('hidden');
    else                     btnClearDefault.classList.add('hidden');
  } else {
    btnClearDefault.classList.add('hidden');
  }
}

async function onClearDefault() {
  if (!selectedGame) return;
  await window.electronAPI.setExePath({ identifier: selectedGame.identifier, exePath: null });
  library = await window.electronAPI.getLibrary();
  refreshButtonStates();
}

async function onOpenLocation() {
  if (!selectedGame) return;
  const lib = library[selectedGame.identifier];
  if (!lib?.install_dir) return;
  await window.electronAPI.openGameLocation({ installDir: lib.install_dir });
}

function resetProgressUI() {
  progressWrap.classList.add('hidden');
  progressBar.style.width  = '0%';
  progressText.textContent = '0%';
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function onDownload() {
  if (!selectedGame) return;

  const identifier = selectedGame.identifier;

  // Use cached file list if available, otherwise fetch now
  let fileUrl, fileName;
  try {
    let files;
    if (fileListCache[identifier]?.files) {
      files = fileListCache[identifier].files;
    } else {
      const result = await window.electronAPI.fetchFileList({ identifier });
      if (!result.ok || !result.files.length) {
        alert('Failed to fetch file list: ' + (result.error || 'No files found'));
        return;
      }
      files = result.files;
      fileListCache[identifier] = { files, size: null };
    }

    const preferred = files.find(f => /\.zip$/i.test(f.name))
                   || files.find(f => /\.7z$/i.test(f.name))
                   || files.find(f => /\.rar$/i.test(f.name))
                   || files.find(f => /\.exe$/i.test(f.name));

    if (!preferred) { alert('No downloadable file found for this game.'); return; }

    fileName = preferred.name;
    // Encode each path segment individually — don't encode the slashes
    const encodedName = preferred.name.split('/').map(encodeURIComponent).join('/');
    fileUrl  = `https://archive.org/download/${identifier}/${encodedName}`;
  } catch (e) {
    alert('Failed to fetch file list: ' + e.message);
    return;
  }

  progressWrap.classList.remove('hidden');
  progressBar.style.width  = '0%';
  progressText.textContent = '0%';
  btnDownload.disabled = true;

  const result = await window.electronAPI.downloadStart({ identifier, downloadUrl: fileUrl, fileName });

  if (!result.ok) {
    alert('Download failed: ' + result.error);
    progressWrap.classList.add('hidden');
    refreshButtonStates();
    return;
  }

  progressBar.style.width  = '100%';
  progressText.textContent = '100%';

  // Extract
  const extractResult = await window.electronAPI.extractArchive({ filePath: result.filePath, identifier });
  progressWrap.classList.add('hidden');

  if (!extractResult.ok) {
    alert('Extraction failed: ' + extractResult.error);
    return;
  }

  // Find exes via main process (no fs/path in renderer)
  const exePaths = await window.electronAPI.findExes({ installDir: extractResult.installDir });
  // Only pre-store exe_path if there's exactly one exe — no choice needed, no default to clear.
  // With multiple exes, leave exe_path null so the picker runs on first launch.
  const exePath  = exePaths.length === 1 ? exePaths[0] : null;

  await window.electronAPI.installGame({
    identifier,
    installDir: extractResult.installDir,
    exePath,
  });

  library = await window.electronAPI.getLibrary();
  btnDownload.textContent = 'Install';
  refreshButtonStates();
  renderLibraryGrid();
  // Load readme now that the game is installed
  const installed = library[identifier];
  if (installed?.install_dir) loadReadme(installed.install_dir);
}

async function onCancelDownload() {
  if (!selectedGame) return;
  await window.electronAPI.downloadCancel({ identifier: selectedGame.identifier });
  progressWrap.classList.add('hidden');
  refreshButtonStates();
}

// ─── Launch ───────────────────────────────────────────────────────────────────

async function onLaunch() {
  if (!selectedGame) return;
  const lib = library[selectedGame.identifier];
  if (!lib?.install_dir) return;

  // If a default exe is stored, launch it directly
  if (lib.exe_path) {
    const result = await window.electronAPI.launchGame({
      identifier: selectedGame.identifier,
      exePath:    lib.exe_path,
    });
    if (!result.ok) alert('Failed to launch: ' + result.error);
    return;
  }

  // Find all exes in the install directory
  const exePaths = await window.electronAPI.findExes({ installDir: lib.install_dir });

  if (!exePaths.length) {
    alert('No executable found. Try re-installing the game.');
    return;
  }

  // Single exe — launch directly, no picker
  if (exePaths.length === 1) {
    const result = await window.electronAPI.launchGame({
      identifier: selectedGame.identifier,
      exePath:    exePaths[0],
    });
    if (!result.ok) alert('Failed to launch: ' + result.error);
    return;
  }

  // Multiple exes — show picker
  const picked = await showExePicker(exePaths, lib.install_dir, selectedGame.identifier);
  if (!picked) return; // user cancelled

  const result = await window.electronAPI.launchGame({
    identifier: selectedGame.identifier,
    exePath:    picked,
  });
  if (!result.ok) alert('Failed to launch: ' + result.error);
}

function showExePicker(exePaths, installDir, identifier) {
  return new Promise((resolve) => {
    let selectedExe = null;

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'exe-picker-overlay';

    // Modal
    const modal = document.createElement('div');
    modal.className = 'exe-picker-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'exe-picker-header';
    header.innerHTML = `<h3>Select Executable</h3><p>Multiple executables found. Choose one to launch:</p>`;

    // List
    const list = document.createElement('ul');
    list.className = 'exe-picker-list';

    exePaths.forEach(p => {
      const li  = document.createElement('li');
      const rel = p.startsWith(installDir) ? p.slice(installDir.length).replace(/^[\\/]/, '') : p;
      li.textContent = rel;
      li.title = p;
      li.addEventListener('click', () => {
        list.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
        li.classList.add('selected');
        selectedExe = p;
        launchBtn.disabled = false;
      });
      list.appendChild(li);
    });

    // Footer row: checkbox left, buttons right
    const footer = document.createElement('div');
    footer.className = 'exe-picker-footer';

    const defaultWrap = document.createElement('label');
    defaultWrap.className = 'exe-picker-default-label';
    const defaultCheck = document.createElement('input');
    defaultCheck.type = 'checkbox';
    defaultWrap.appendChild(defaultCheck);
    defaultWrap.appendChild(document.createTextNode(' Set as default'));

    const btnRow = document.createElement('div');
    btnRow.className = 'exe-picker-btn-row';

    const launchBtn = document.createElement('button');
    launchBtn.className   = 'exe-picker-launch';
    launchBtn.textContent = 'Launch';
    launchBtn.disabled    = true;
    launchBtn.addEventListener('click', async () => {
      if (!selectedExe) return;
      if (defaultCheck.checked && identifier) {
        await window.electronAPI.setExePath({ identifier, exePath: selectedExe });
        library = await window.electronAPI.getLibrary();
        refreshButtonStates();
      }
      cleanup();
      resolve(selectedExe);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'exe-picker-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });

    btnRow.appendChild(launchBtn);
    btnRow.appendChild(cancelBtn);
    footer.appendChild(defaultWrap);
    footer.appendChild(btnRow);

    modal.appendChild(header);
    modal.appendChild(list);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });

    function cleanup() { document.body.removeChild(overlay); }
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function onDelete() {
  if (!selectedGame) return;
  if (!confirm(`Delete ${getTitle(selectedGame)}? This cannot be undone.`)) return;

  const lib = library[selectedGame.identifier];
  await window.electronAPI.deleteGame({
    identifier: selectedGame.identifier,
    installDir: lib?.install_dir,
  });

  library = await window.electronAPI.getLibrary();
  refreshButtonStates();
  renderLibraryGrid();
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
