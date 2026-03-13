'use strict';
/**
 * RohanKar Launcher — renderer.js
 * Session 11: Visual + UX polish pass.
 * - Skeleton loading cards
 * - Card hover lift + installed left accent
 * - Home banner auto-rotation (crossfade every 18s)
 * - Rajdhani font (applied via CSS/HTML)
 * - Cover hover zoom (CSS)
 * - Playtime label on Recently Played cards
 * - Keyboard nav (arrow keys + Enter in sidebar, Escape to home)
 * - Search clear button
 * - Download queue toast panel (multi-download support)
 */

// ─── Archive.org API ──────────────────────────────────────────────────────────

const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php';
const UPLOADER       = 'rohanjackson071@gmail.com';

// ─── State ────────────────────────────────────────────────────────────────────

let allGames      = [];
let library       = {};
let collections   = [];
let selectedGame  = null;
let sortOrder     = 'az';
let fileListCache = {};
let installedFirst     = false;
let showInstalledBadge = true;  // setting: show vertical installed label on cards
let activeFilter       = 'all';
let activeCollection   = '';

// Download queue: identifier → { identifier, title, percent, status }
// status: 'downloading' | 'extracting' | 'done' | 'error'
const downloadQueue = new Map();

// ─── Controller support detection ─────────────────────────────────────────────
const CONTROLLER_RE = /controller\s+support\s*:\s*yes/i;
function hasControllerSupport(game) {
  const desc = Array.isArray(game.description) ? game.description.join(' ') : (game.description || '');
  const subj = Array.isArray(game.subject)      ? game.subject.join(' ')      : (game.subject      || '');
  return CONTROLLER_RE.test(desc) || CONTROLLER_RE.test(subj);
}

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
const installedFirstCheck         = document.getElementById('setting-installed-first');
const showInstalledBadgeCheck     = document.getElementById('setting-show-installed-badge');
const btnChooseDownload       = document.getElementById('btn-choose-download');
const btnChooseInstall        = document.getElementById('btn-choose-install');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTitle(game) {
  const t = Array.isArray(game.title) ? game.title[0] : game.title;
  return (t && String(t).trim()) || game.identifier?.replace(/-/g, ' ') || 'Unknown';
}

function getThumb(game) {
  return `https://archive.org/services/img/${game.identifier}`;
}

const thumbUrlCache = {};

async function resolveThumb(identifier) {
  if (thumbUrlCache[identifier]) return thumbUrlCache[identifier];
  try {
    const url = await window.electronAPI.getThumb({ identifier });
    thumbUrlCache[identifier] = url;
    return url;
  } catch {
    return `https://archive.org/services/img/${identifier}`;
  }
}

function applyThumb(imgEl, identifier) {
  imgEl.src = thumbUrlCache[identifier] || `https://archive.org/services/img/${identifier}`;
  resolveThumb(identifier).then(url => { if (imgEl.src !== url) imgEl.src = url; });
}

function getLocalHero(identifier) {
  try {
    const base = window._heroBasePath;
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

function formatPlaytime(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPlaytimeLong(secs) {
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
  heroEl.classList.remove('has-local-hero');
  heroLocal.classList.add('hidden');
  heroLocal.src = '';
  heroImage.style.backgroundImage = src ? `url("${src}")` : 'none';
}

function setHeroLocal(src) {
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

// ─── Markdown-lite renderer ───────────────────────────────────────────────────
function markdownToHtml(md) {
  if (!md) return '<p class="changelog-no-notes">No release notes provided.</p>';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html
    .split(/\n{2,}/)
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (/^<(h[1-3]|ul|li|hr|p)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return html;
}

// ─── Changelog modal ──────────────────────────────────────────────────────────
let pendingUpdateInfo = null;

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
  if (isReady) btnChangelogInstall.classList.remove('hidden');
  else         btnChangelogInstall.classList.add('hidden');
  changelogModal.classList.remove('hidden');
}

function closeChangelog() {
  changelogModal?.classList.add('hidden');
}

// ─── About modal ──────────────────────────────────────────────────────────────
async function openAbout() {
  if (!aboutModal) return;
  if (!aboutVersion.textContent) {
    const v = await window.electronAPI.getAppVersion();
    aboutVersion.textContent = `Version ${v}`;
  }
  aboutModal.classList.remove('hidden');
}

function closeAbout() {
  aboutModal?.classList.add('hidden');
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────
function getSortedGames(games) {
  const query = searchInput.value.toLowerCase().trim();
  let filtered = query
    ? games.filter(g => getTitle(g).toLowerCase().includes(query))
    : [...games];

  if (activeFilter === 'favorites') {
    filtered = filtered.filter(g => library[g.identifier]?.is_favorite);
  }

  if (activeCollection) {
    const col = collections.find(c => String(c.id) === String(activeCollection));
    if (col) {
      const set = new Set(col.games);
      filtered = filtered.filter(g => set.has(g.identifier));
    }
  }

  switch (sortOrder) {
    case 'az':
      filtered.sort((a, b) => getTitle(a).localeCompare(getTitle(b)));
      break;
    case 'za':
      filtered.sort((a, b) => getTitle(b).localeCompare(getTitle(a)));
      break;
    case 'date-archived':
      filtered.sort((a, b) => new Date(b.addeddate || 0) - new Date(a.addeddate || 0));
      break;
    case 'date-published':
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

  if (installedFirst) {
    filtered.sort((a, b) => {
      const ai = library[a.identifier]?.install_dir ? 1 : 0;
      const bi = library[b.identifier]?.install_dir ? 1 : 0;
      return bi - ai;
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

  // Search + clear button
  searchInput.addEventListener('input', () => {
    renderLibraryGrid();
    updateSearchClear();
  });
  const btnSearchClear = document.getElementById('btn-search-clear');
  if (btnSearchClear) {
    btnSearchClear.addEventListener('click', () => {
      searchInput.value = '';
      renderLibraryGrid();
      updateSearchClear();
      searchInput.focus();
    });
  }

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
      if (btn.dataset.tab === 'reviews' && selectedGame) {
        loadReviews(selectedGame.identifier);
      }
      if (btn.dataset.tab === 'readme' && selectedGame) {
        const lib = library[selectedGame.identifier];
        if (lib?.install_dir) loadReadme(lib.install_dir);
        else if (readmeEmpty) readmeEmpty.style.display = 'block';
      }
    });
  });

  // Keyboard navigation in sidebar
  document.addEventListener('keydown', onGlobalKeydown);

  // Download / launch / delete / open location
  btnDownload.addEventListener('click', onDownload);
  btnLaunch.addEventListener('click',   onLaunch);
  btnDelete.addEventListener('click',   onDelete);
  btnOpenLocation.addEventListener('click', onOpenLocation);
  btnClearDefault.addEventListener('click', onClearDefault);
  btnCancelDownload.addEventListener('click', onCancelDownload);

  // Favorites / collections filter pills
  document.getElementById('btn-filter-all').addEventListener('click', () => {
    activeFilter = 'all';
    activeCollection = '';
    document.getElementById('btn-filter-all').classList.add('active');
    document.getElementById('btn-filter-favorites').classList.remove('active');
    document.getElementById('collection-filter').value = '';
    renderLibraryGrid();
  });
  document.getElementById('btn-filter-favorites').addEventListener('click', () => {
    activeFilter = 'favorites';
    activeCollection = '';
    document.getElementById('btn-filter-favorites').classList.add('active');
    document.getElementById('btn-filter-all').classList.remove('active');
    document.getElementById('collection-filter').value = '';
    renderLibraryGrid();
  });
  document.getElementById('collection-filter').addEventListener('change', (e) => {
    activeCollection = e.target.value;
    if (activeCollection) {
      activeFilter = 'all';
      document.getElementById('btn-filter-all').classList.add('active');
      document.getElementById('btn-filter-favorites').classList.remove('active');
    }
    renderLibraryGrid();
  });

  // Manage collections modal
  document.getElementById('btn-manage-collections').addEventListener('click', openCollectionsModal);
  document.getElementById('btn-close-collections').addEventListener('click', closeCollectionsModal);
  document.getElementById('btn-close-collections-footer').addEventListener('click', closeCollectionsModal);
  document.getElementById('collections-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('collections-modal')) closeCollectionsModal();
  });
  document.getElementById('btn-create-collection').addEventListener('click', onCreateCollection);
  document.getElementById('new-collection-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onCreateCollection();
  });

  document.getElementById('btn-favorite').addEventListener('click', onToggleFavorite);
  document.getElementById('btn-add-to-collection').addEventListener('click', onAddToCollection);
  document.getElementById('btn-close-add-collection').addEventListener('click', closeAddCollectionModal);
  document.getElementById('btn-close-add-collection-footer').addEventListener('click', closeAddCollectionModal);
  document.getElementById('add-collection-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-collection-modal')) closeAddCollectionModal();
  });

  document.getElementById('btn-save-notes').addEventListener('click', onSaveNotes);

  const initSettings = await window.electronAPI.getSettings();
  installedFirst     = !!initSettings.installedFirst;
  showInstalledBadge = initSettings.showInstalledBadge !== false; // default true
  applyInstalledBadgeSetting();

  try {
    const heroesDir = await window.electronAPI.getHeroesPath();
    window._heroBasePath = 'file:///' + heroesDir.replace(/\\/g, '/');
  } catch {
    window._heroBasePath = null;
  }

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

  // Download progress — update both inline bar and queue panel
  window.electronAPI.onDownloadProgress(({ identifier, percent }) => {
    if (downloadQueue.has(identifier)) {
      dqSet(identifier, { percent });
    }
    if (selectedGame?.identifier === identifier) {
      progressBar.style.width  = percent + '%';
      progressText.textContent = percent + '%';
    }
  });

  // Auto-updater
  window.electronAPI.onUpdaterStatus((data) => {
    if (!updateBar) return;
    updateBar.classList.remove('error');
    btnUpdateInstall.classList.add('hidden');
    let btnNotes = document.getElementById('btn-update-notes');
    if (!btnNotes) {
      btnNotes = document.createElement('button');
      btnNotes.id          = 'btn-update-notes';
      btnNotes.textContent = 'Release Notes';
      btnNotes.addEventListener('click', openChangelog);
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

  btnUpdateInstall.addEventListener('click', () => window.electronAPI.updaterInstall());
  btnUpdateDismiss.addEventListener('click', () => updateBar.classList.add('hidden'));
  btnCloseChangelog.addEventListener('click',   closeChangelog);
  btnChangelogClose.addEventListener('click',   closeChangelog);
  btnChangelogInstall.addEventListener('click', () => {
    closeChangelog();
    window.electronAPI.updaterInstall();
  });
  changelogModal.addEventListener('click', (e) => {
    if (e.target === changelogModal) closeChangelog();
  });

  // Home button
  document.getElementById('btn-home').addEventListener('click', showHomeView);

  // Reroll button
  document.getElementById('home-btn-reroll').addEventListener('click', () => {
    homeRandomGame = null;
    renderHomeRandomPick(true);
  });

  collections = await window.electronAPI.getCollections();
  renderCollectionFilter();

  await fetchGames();
}

// ─── Keyboard navigation ───────────────────────────────────────────────────────
function onGlobalKeydown(e) {
  // Ignore if any modal is open or user is typing in an input/textarea
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const anyModalOpen = document.querySelector(
    '#settings-modal:not(.hidden), #about-modal:not(.hidden), #changelog-modal:not(.hidden), #collections-modal:not(.hidden), #add-collection-modal:not(.hidden)'
  );
  if (anyModalOpen) return;

  if (e.key === 'Escape') {
    if (currentView === 'detail') showHomeView();
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const cards = [...libraryGrid.querySelectorAll('.game-card')];
    if (!cards.length) return;
    const currentIdx = cards.findIndex(c => c.classList.contains('selected'));
    let nextIdx;
    if (e.key === 'ArrowDown') {
      nextIdx = currentIdx < cards.length - 1 ? currentIdx + 1 : 0;
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : cards.length - 1;
    }
    const sorted = getSortedGames(allGames);
    const targetGame = sorted[nextIdx];
    if (targetGame) {
      showDetailView(targetGame);
      // Scroll the card into view
      cards[nextIdx]?.scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  if (e.key === 'Enter' && currentView === 'home') {
    // Enter on home: do nothing — let banner handle it
    return;
  }
}

// ─── Search clear button ──────────────────────────────────────────────────────
function updateSearchClear() {
  const btn = document.getElementById('btn-search-clear');
  if (!btn) return;
  if (searchInput.value.length > 0) btn.classList.add('visible');
  else btn.classList.remove('visible');
}

// ─── Settings modal ───────────────────────────────────────────────────────────
async function openSettings() {
  const s = await window.electronAPI.getSettings();
  downloadPathInput.value           = s.downloadPath || '';
  installPathInput.value            = s.installPath  || '';
  deleteAfterInstallCheck.checked   = !!s.deleteAfterInstall;
  installedFirstCheck.checked       = !!s.installedFirst;
  showInstalledBadgeCheck.checked   = s.showInstalledBadge !== false;
  settingsModal.classList.remove('hidden');
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

async function saveSettings() {
  await window.electronAPI.saveSettings({
    downloadPath:        downloadPathInput.value.trim(),
    installPath:         installPathInput.value.trim(),
    deleteAfterInstall:  deleteAfterInstallCheck.checked,
    installedFirst:      installedFirstCheck.checked,
    showInstalledBadge:  showInstalledBadgeCheck.checked,
  });
  installedFirst     = installedFirstCheck.checked;
  showInstalledBadge = showInstalledBadgeCheck.checked;
  applyInstalledBadgeSetting();
  renderLibraryGrid();
  closeSettings();
}

function applyInstalledBadgeSetting() {
  if (showInstalledBadge) libraryGrid.classList.remove('hide-installed-badge');
  else                    libraryGrid.classList.add('hide-installed-badge');
}

// ─── Fetch games from archive.org ─────────────────────────────────────────────
async function fetchGames() {
  renderSkeletonCards(8);
  try {
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

    const seen = new Set();
    allGames = docs.filter(g => {
      if (seen.has(g.identifier)) return false;
      seen.add(g.identifier);
      return true;
    });

    library = await window.electronAPI.getLibrary();
    renderLibraryGrid();
    showHomeView();
  } catch (e) {
    libraryGrid.innerHTML = `<p class="loading-msg error">Failed to load games: ${e.message}</p>`;
  }
}

function renderSkeletonCards(count) {
  libraryGrid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = `
      <div class="skeleton-thumb"></div>
      <div class="skeleton-text-col">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line badge"></div>
      </div>
    `;
    libraryGrid.appendChild(card);
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
    const isFav    = !!libEntry?.is_favorite;
    const hasCtrl  = hasControllerSupport(game);
    const installed = !!libEntry?.install_dir;

    if (installed) card.classList.add('is-installed');

    const img = document.createElement('img');
    img.className = 'game-thumb';
    img.alt       = getTitle(game);
    img.loading   = 'lazy';
    applyThumb(img, game.identifier);

    const label = document.createElement('span');
    label.className   = 'card-label';
    label.textContent = getTitle(game);

    // Vertical "Installed" label sits between the left accent bar and the thumb
    if (installed) {
      const installedLabel = document.createElement('span');
      installedLabel.className   = 'card-installed-label';
      installedLabel.textContent = 'Installed';
      card.appendChild(installedLabel);
    }

    card.appendChild(img);

    const textCol = document.createElement('div');
    textCol.className = 'card-text-col';

    const badgeStrip = document.createElement('div');
    badgeStrip.className = 'card-badges';

    if (hasCtrl) {
      const ctrlBadge = document.createElement('span');
      ctrlBadge.className   = 'card-badge controller';
      ctrlBadge.textContent = '🎮';
      ctrlBadge.title       = 'Controller Support';
      badgeStrip.appendChild(ctrlBadge);
    }
    if (isFav) {
      const fav = document.createElement('span');
      fav.className   = 'card-fav';
      fav.textContent = '★';
      badgeStrip.appendChild(fav);
    }

    if (hasCtrl || isFav) textCol.appendChild(badgeStrip);
    textCol.appendChild(label);

    card.appendChild(textCol);
    card.addEventListener('click', () => showDetailView(game));
    libraryGrid.appendChild(card);
  });
}

// ─── Download queue UI ────────────────────────────────────────────────────────
function renderDownloadQueue() {
  const panel = document.getElementById('download-queue');
  if (!panel) return;
  panel.innerHTML = '';

  for (const [identifier, entry] of downloadQueue) {
    const item = document.createElement('div');
    item.className = 'dq-item'
      + (entry.status === 'done'       ? ' done'       : '')
      + (entry.status === 'error'      ? ' error'      : '')
      + (entry.status === 'extracting' ? ' extracting' : '');
    item.id = `dq-${identifier}`;

    const statusText =
      entry.status === 'downloading' ? `${entry.percent}%` :
      entry.status === 'extracting'  ? 'Extracting…'       :
      entry.status === 'done'        ? '✓ Done'            : 'Error';

    const header = document.createElement('div');
    header.className = 'dq-header';

    const titleEl = document.createElement('span');
    titleEl.className   = 'dq-title';
    titleEl.textContent = entry.title;

    const statusEl = document.createElement('span');
    statusEl.className   = 'dq-status';
    statusEl.textContent = statusText;

    header.appendChild(titleEl);
    header.appendChild(statusEl);

    // Cancel button only during download
    if (entry.status === 'downloading') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className   = 'dq-cancel';
      cancelBtn.textContent = '✕';
      cancelBtn.title       = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        await window.electronAPI.downloadCancel({ identifier });
        downloadQueue.delete(identifier);
        renderDownloadQueue();
        library = await window.electronAPI.getLibrary();
        if (selectedGame?.identifier === identifier) refreshButtonStates();
        renderLibraryGrid();
      });
      header.appendChild(cancelBtn);
    }

    const barBg = document.createElement('div');
    barBg.className = 'dq-bar-bg';
    const bar = document.createElement('div');
    bar.className = 'dq-bar';
    bar.style.width = (entry.status === 'done' || entry.status === 'extracting') ? '100%' : `${entry.percent}%`;
    barBg.appendChild(bar);

    item.appendChild(header);
    item.appendChild(barBg);
    panel.appendChild(item);
  }
}

function dqSet(identifier, fields) {
  const existing = downloadQueue.get(identifier) || {};
  downloadQueue.set(identifier, { ...existing, ...fields });
  renderDownloadQueue();
}

function dqDone(identifier) {
  dqSet(identifier, { status: 'done', percent: 100 });
  setTimeout(() => {
    downloadQueue.delete(identifier);
    renderDownloadQueue();
  }, 3000);
}

// ─── Select game ──────────────────────────────────────────────────────────────
async function selectGame(game) {
  selectedGame = game;
  renderLibraryGrid();

  const title     = getTitle(game);
  const rawDesc   = Array.isArray(game.description) ? game.description[0] : game.description;
  const desc      = rawDesc ? String(rawDesc) : '';
  const thumbUrl  = getThumb(game);
  const localHero = getLocalHero(game.identifier);

  const libEntry   = library[game.identifier];
  const installDir = libEntry?.install_dir || null;
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

  resolveThumb(game.identifier).then(url => setDetailCover(url));
  setDetailCover(thumbUrl);
  detailTitle.textContent = title;

  const date      = game.date ? new Date(game.date).getFullYear() : '-';
  const downloads = game.downloads ? Number(game.downloads).toLocaleString() : '-';
  detailMeta.innerHTML =
    `<span>Year: <strong>${date}</strong></span>` +
    `<span>Downloads: <strong>${downloads}</strong></span>` +
    `<span id="detail-size"></span>`;

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

  const libEntryPt = libEntry;
  if (libEntryPt?.playtime_secs) {
    detailPlaytime.textContent = formatPlaytimeLong(libEntryPt.playtime_secs);
    detailPlaytime.classList.remove('hidden');
  } else {
    detailPlaytime.classList.add('hidden');
  }

  const ctrlSupport = hasControllerSupport(game);
  if (ctrlSupport) {
    detailExtra.innerHTML = '<span class="controller-badge">🎮 Controller Support</span>';
  } else {
    detailExtra.textContent = '';
  }

  loadNotesForGame(game.identifier);

  if (readmeContent)  readmeContent.textContent = '';
  if (readmeEmpty)    readmeEmpty.style.display  = 'none';

  reviewsList.innerHTML = '';
  reviewsList.dataset.loaded   = '';
  reviewsEmpty.style.display   = 'none';
  reviewsLoading.style.display = 'none';

  refreshButtonStates();
  resetProgressUI();

  if (libEntryPt?.install_dir) loadReadme(libEntryPt.install_dir);

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

// ─── Reviews ──────────────────────────────────────────────────────────────────
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
  const btnFavorite        = document.getElementById('btn-favorite');
  const btnAddToCollection = document.getElementById('btn-add-to-collection');

  if (!selectedGame) {
    btnDownload.disabled = true;
    btnLaunch.disabled   = true;
    btnDelete.disabled   = true;
    btnOpenLocation.classList.add('hidden');
    btnClearDefault.classList.add('hidden');
    btnFavorite?.classList.add('hidden');
    btnAddToCollection?.classList.add('hidden');
    return;
  }

  if (btnFavorite) {
    btnFavorite.classList.remove('hidden');
    updateFavoriteButton();
  }
  if (btnAddToCollection) btnAddToCollection.classList.remove('hidden');

  const lib = library[selectedGame.identifier];
  const installed = !!(lib?.install_dir);
  // Disable download if installed OR if this game is in the download queue
  btnDownload.disabled = installed || downloadQueue.has(selectedGame.identifier);
  btnLaunch.disabled   = !installed;
  btnDelete.disabled   = !installed;
  if (installed) btnOpenLocation.classList.remove('hidden');
  else           btnOpenLocation.classList.add('hidden');
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
  const title      = getTitle(selectedGame);

  // Prevent double-queuing
  if (downloadQueue.has(identifier)) return;

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
    const encodedName = preferred.name.split('/').map(encodeURIComponent).join('/');
    fileUrl  = `https://archive.org/download/${identifier}/${encodedName}`;
  } catch (e) {
    alert('Failed to fetch file list: ' + e.message);
    return;
  }

  // Add to queue
  dqSet(identifier, { identifier, title, percent: 0, status: 'downloading' });
  btnDownload.disabled = true;

  // Keep inline progress bar for the currently-viewed game
  progressWrap.classList.remove('hidden');
  progressBar.style.width  = '0%';
  progressText.textContent = '0%';

  const result = await window.electronAPI.downloadStart({ identifier, downloadUrl: fileUrl, fileName });

  if (!result.ok) {
    dqSet(identifier, { status: 'error' });
    setTimeout(() => { downloadQueue.delete(identifier); renderDownloadQueue(); }, 4000);
    progressWrap.classList.add('hidden');
    refreshButtonStates();
    return;
  }

  dqSet(identifier, { status: 'extracting', percent: 100 });
  progressBar.style.width  = '100%';
  progressText.textContent = '100%';

  const extractResult = await window.electronAPI.extractArchive({ filePath: result.filePath, identifier });
  progressWrap.classList.add('hidden');

  if (!extractResult.ok) {
    dqSet(identifier, { status: 'error' });
    setTimeout(() => { downloadQueue.delete(identifier); renderDownloadQueue(); }, 4000);
    return;
  }

  const exePaths = await window.electronAPI.findExes({ installDir: extractResult.installDir });
  const exePath  = exePaths.length === 1 ? exePaths[0] : null;

  await window.electronAPI.installGame({ identifier, installDir: extractResult.installDir, exePath });

  library = await window.electronAPI.getLibrary();
  dqDone(identifier);
  btnDownload.textContent = 'Install';
  if (selectedGame?.identifier === identifier) {
    refreshButtonStates();
    const installed = library[identifier];
    if (installed?.install_dir) loadReadme(installed.install_dir);
  }
  renderLibraryGrid();
}

async function onCancelDownload() {
  if (!selectedGame) return;
  const identifier = selectedGame.identifier;
  await window.electronAPI.downloadCancel({ identifier });
  downloadQueue.delete(identifier);
  renderDownloadQueue();
  progressWrap.classList.add('hidden');
  refreshButtonStates();
}

// ─── Launch ───────────────────────────────────────────────────────────────────
async function onLaunch() {
  if (!selectedGame) return;
  const lib = library[selectedGame.identifier];
  if (!lib?.install_dir) return;

  if (lib.exe_path) {
    const result = await window.electronAPI.launchGame({
      identifier: selectedGame.identifier,
      exePath:    lib.exe_path,
    });
    if (!result.ok) alert('Failed to launch: ' + result.error);
    return;
  }

  const exePaths = await window.electronAPI.findExes({ installDir: lib.install_dir });
  if (!exePaths.length) {
    alert('No executable found. Try re-installing the game.');
    return;
  }
  if (exePaths.length === 1) {
    const result = await window.electronAPI.launchGame({
      identifier: selectedGame.identifier,
      exePath:    exePaths[0],
    });
    if (!result.ok) alert('Failed to launch: ' + result.error);
    return;
  }
  const picked = await showExePicker(exePaths, lib.install_dir, selectedGame.identifier);
  if (!picked) return;
  const result = await window.electronAPI.launchGame({
    identifier: selectedGame.identifier,
    exePath:    picked,
  });
  if (!result.ok) alert('Failed to launch: ' + result.error);
}

function showExePicker(exePaths, installDir, identifier) {
  return new Promise((resolve) => {
    let selectedExe = null;
    const overlay = document.createElement('div');
    overlay.className = 'exe-picker-overlay';
    const modal = document.createElement('div');
    modal.className = 'exe-picker-modal';
    const header = document.createElement('div');
    header.className = 'exe-picker-header';
    header.innerHTML = `<h3>Select Executable</h3><p>Multiple executables found. Choose one to launch:</p>`;
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

// ─── Favorites ────────────────────────────────────────────────────────────────
async function onToggleFavorite() {
  if (!selectedGame) return;
  const lib    = library[selectedGame.identifier];
  const newVal = lib?.is_favorite ? 0 : 1;
  await window.electronAPI.setFavorite({ identifier: selectedGame.identifier, isFavorite: !!newVal });
  library = await window.electronAPI.getLibrary();
  updateFavoriteButton();
  renderLibraryGrid();
}

function updateFavoriteButton() {
  const btn = document.getElementById('btn-favorite');
  if (!btn || !selectedGame) return;
  const isFav = !!library[selectedGame.identifier]?.is_favorite;
  btn.textContent = isFav ? '★' : '☆';
  if (isFav) btn.classList.add('is-favorite');
  else       btn.classList.remove('is-favorite');
}

// ─── Notes ────────────────────────────────────────────────────────────────────
async function onSaveNotes() {
  if (!selectedGame) return;
  const notesInput = document.getElementById('notes-input');
  const indicator  = document.getElementById('notes-saved-indicator');
  await window.electronAPI.setNotes({ identifier: selectedGame.identifier, notes: notesInput.value });
  library = await window.electronAPI.getLibrary();
  indicator.textContent = '✓ Saved';
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 2000);
}

function loadNotesForGame(identifier) {
  const notesInput = document.getElementById('notes-input');
  const indicator  = document.getElementById('notes-saved-indicator');
  if (!notesInput) return;
  notesInput.value      = library[identifier]?.notes || '';
  indicator.textContent = '';
  indicator.classList.remove('show');
}

// ─── Collections ──────────────────────────────────────────────────────────────
function renderCollectionFilter() {
  const sel = document.getElementById('collection-filter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Collections</option>';
  collections.forEach(c => {
    const opt = document.createElement('option');
    opt.value       = c.id;
    opt.textContent = c.name + (c.games.length ? ` (${c.games.length})` : '');
    sel.appendChild(opt);
  });
  sel.value = prev;
}

function openCollectionsModal() {
  renderCollectionsList();
  document.getElementById('collections-modal').classList.remove('hidden');
}

function closeCollectionsModal() {
  document.getElementById('collections-modal').classList.add('hidden');
}

function renderCollectionsList() {
  const list = document.getElementById('collections-list');
  list.innerHTML = '';
  if (!collections.length) {
    list.innerHTML = '<li style="padding:12px;color:var(--text-dim);font-size:13px;">No collections yet. Create one above.</li>';
    return;
  }
  collections.forEach(c => {
    const li = document.createElement('li');
    li.className = 'collection-item';
    const nameSpan  = document.createElement('span');
    nameSpan.className   = 'collection-name';
    nameSpan.textContent = c.name;
    const countSpan = document.createElement('span');
    countSpan.className   = 'collection-count';
    countSpan.textContent = `${c.games.length} game${c.games.length !== 1 ? 's' : ''}`;
    const renameBtn = document.createElement('button');
    renameBtn.className   = 'collection-rename-btn';
    renameBtn.textContent = '✏ Rename';
    renameBtn.addEventListener('click', async () => {
      const newName = prompt(`Rename "${c.name}" to:`, c.name);
      if (!newName || newName.trim() === c.name) return;
      await window.electronAPI.renameCollection({ id: c.id, name: newName });
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter();
      renderCollectionsList();
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className   = 'collection-delete-btn';
    deleteBtn.textContent = '🗑 Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete collection "${c.name}"? This will not delete the games.`)) return;
      await window.electronAPI.deleteCollection({ id: c.id });
      if (String(activeCollection) === String(c.id)) { activeCollection = ''; }
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter();
      renderCollectionsList();
      renderLibraryGrid();
    });
    li.appendChild(nameSpan);
    li.appendChild(countSpan);
    li.appendChild(renameBtn);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });
}

async function onCreateCollection() {
  const input = document.getElementById('new-collection-input');
  const name  = input.value.trim();
  if (!name) return;
  const result = await window.electronAPI.createCollection({ name });
  if (!result.ok) { alert('Could not create collection: ' + (result.error || 'name already exists')); return; }
  input.value = '';
  collections = await window.electronAPI.getCollections();
  renderCollectionFilter();
  renderCollectionsList();
}

async function onAddToCollection() {
  if (!selectedGame || !collections.length) {
    if (!collections.length) alert('Create a collection first using the ⊞ button in the sidebar.');
    return;
  }
  const modal = document.getElementById('add-collection-modal');
  const list  = document.getElementById('add-collection-list');
  const label = document.getElementById('add-collection-game-name');
  label.textContent = getTitle(selectedGame);
  list.innerHTML = '';
  for (const c of collections) {
    const isInCol = c.games.includes(selectedGame.identifier);
    const li = document.createElement('li');
    li.className = 'add-coll-item';
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = isInCol;
    const span = document.createElement('span');
    span.textContent = c.name;
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        await window.electronAPI.addGameToCollection({ collectionId: c.id, identifier: selectedGame.identifier });
      } else {
        await window.electronAPI.removeGameFromCollection({ collectionId: c.id, identifier: selectedGame.identifier });
      }
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter();
      if (activeCollection) renderLibraryGrid();
    });
    li.addEventListener('click', (e) => { if (e.target !== cb) cb.click(); });
    li.appendChild(cb);
    li.appendChild(span);
    list.appendChild(li);
  }
  modal.classList.remove('hidden');
}

function closeAddCollectionModal() {
  document.getElementById('add-collection-modal').classList.add('hidden');
}

// ─── Home screen ──────────────────────────────────────────────────────────────
let currentView      = 'home';
let homeFeaturedGame = null;
let homeRandomGame   = null;
let bannerRotateTimer = null;

function showHomeView() {
  currentView = 'home';
  document.getElementById('home-view').classList.remove('hidden');
  document.getElementById('detail-panel').classList.add('hidden');
  document.getElementById('hero').style.display = 'none';
  document.getElementById('btn-home').classList.add('active');
  renderHomeScreen();
}

function showDetailView(game) {
  currentView = 'detail';
  document.getElementById('home-view').classList.add('hidden');
  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('hero').style.display = '';
  document.getElementById('btn-home').classList.remove('active');
  selectGame(game);
}

function renderHomeScreen() {
  renderHomeBanner();
  renderHomeStats();
  renderHomeRecentRow();
  renderHomePlayedRow();
  renderHomeRandomPick();
  startBannerRotation();
}

// ── Banner ─────────────────────────────────────────────────────────────────────
function renderHomeBanner(game) {
  if (!allGames.length) return;
  if (!game) {
    if (!homeFeaturedGame) {
      homeFeaturedGame = allGames[Math.floor(Math.random() * allGames.length)];
    }
    game = homeFeaturedGame;
  }
  const title = getTitle(game);
  document.getElementById('home-banner-title').textContent = title;

  const localHero   = getLocalHero(game.identifier);
  const bannerBg    = document.getElementById('home-banner-bg');
  const bannerLocal = document.getElementById('home-banner-local');

  if (localHero) {
    const testImg = new Image();
    testImg.onload = () => {
      bannerLocal.src = localHero;
      bannerLocal.classList.remove('hidden');
      bannerBg.style.backgroundImage = 'none';
    };
    testImg.onerror = () => {
      bannerLocal.classList.add('hidden');
      bannerBg.style.backgroundImage = `url("${getThumb(game)}")`;
    };
    testImg.src = localHero;
  } else {
    bannerLocal.classList.add('hidden');
    bannerBg.style.backgroundImage = `url("${getThumb(game)}")`;
  }

  const btnView = document.getElementById('home-banner-btn');
  const newBtn  = btnView.cloneNode(true);
  btnView.parentNode.replaceChild(newBtn, btnView);
  newBtn.addEventListener('click', (e) => { e.stopPropagation(); showDetailView(game); });
  document.getElementById('home-banner').onclick = () => showDetailView(game);
}

// Banner crossfade rotation every 18 seconds
function startBannerRotation() {
  if (bannerRotateTimer) clearInterval(bannerRotateTimer);
  bannerRotateTimer = setInterval(() => {
    if (currentView !== 'home' || allGames.length < 2) return;
    let next;
    do { next = allGames[Math.floor(Math.random() * allGames.length)]; }
    while (next.identifier === homeFeaturedGame?.identifier && allGames.length > 1);
    crossfadeBanner(next);
  }, 18000);
}

function crossfadeBanner(game) {
  const bg1 = document.getElementById('home-banner-bg');
  const bg2 = document.getElementById('home-banner-bg2');
  if (!bg2) { homeFeaturedGame = game; renderHomeBanner(game); return; }

  const newUrl = `url("${getThumb(game)}")`;
  bg2.style.backgroundImage = newUrl;
  bg2.style.opacity = '0';

  // Force reflow so transition fires
  void bg2.offsetWidth;

  bg2.style.opacity = '1';
  bg1.style.opacity = '0';

  setTimeout(() => {
    bg1.style.backgroundImage = newUrl;
    bg1.style.opacity = '1';
    bg2.style.opacity = '0';
    homeFeaturedGame = game;
    document.getElementById('home-banner-title').textContent = getTitle(game);
    // Re-wire click to new game
    const btnView = document.getElementById('home-banner-btn');
    const newBtn  = btnView.cloneNode(true);
    btnView.parentNode.replaceChild(newBtn, btnView);
    newBtn.addEventListener('click', (e) => { e.stopPropagation(); showDetailView(game); });
    document.getElementById('home-banner').onclick = () => showDetailView(game);
  }, 650);
}

// ── Stats strip ────────────────────────────────────────────────────────────────
function renderHomeStats() {
  const libEntries = Object.values(library);
  const installed  = libEntries.filter(e => e.install_dir).length;
  const favorites  = libEntries.filter(e => e.is_favorite).length;
  document.getElementById('stat-total').textContent       = allGames.length || '—';
  document.getElementById('stat-installed').textContent   = installed;
  document.getElementById('stat-favorites').textContent   = favorites;
  document.getElementById('stat-collections').textContent = collections.length;
}

// ── Recently Added row ─────────────────────────────────────────────────────────
function renderHomeRecentRow() {
  const row = document.getElementById('home-row-recent');
  row.innerHTML = '';
  const recent = [...allGames]
    .filter(g => g.addeddate)
    .sort((a, b) => new Date(b.addeddate) - new Date(a.addeddate))
    .slice(0, 20);
  if (!recent.length) {
    row.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">No data available.</span>';
    return;
  }
  recent.forEach(game => row.appendChild(makeHomeGameCard(game, 'date')));
}

// ── Recently Played row ────────────────────────────────────────────────────────
function renderHomePlayedRow() {
  const section = document.getElementById('home-section-played');
  const row     = document.getElementById('home-row-played');
  row.innerHTML = '';

  const played = Object.entries(library)
    .filter(([, e]) => e.playtime_secs > 0)
    .sort(([, a], [, b]) => (b.last_played_at || 0) - (a.last_played_at || 0))
    .slice(0, 20)
    .map(([id]) => allGames.find(g => g.identifier === id))
    .filter(Boolean);

  if (!played.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  played.forEach(game => row.appendChild(makeHomeGameCard(game, 'playtime')));
}

// ── Home game card builder ─────────────────────────────────────────────────────
// mode: 'date' | 'playtime' | null
function makeHomeGameCard(game, mode) {
  const card = document.createElement('div');
  card.className = 'home-game-card';

  const imgWrap = document.createElement('div');
  imgWrap.style.overflow = 'hidden';
  imgWrap.style.borderRadius = '5px';
  imgWrap.style.flexShrink = '0';

  const img = document.createElement('img');
  img.className = 'home-game-thumb';
  img.alt       = getTitle(game);
  img.loading   = 'lazy';
  applyThumb(img, game.identifier);

  imgWrap.appendChild(img);

  const label = document.createElement('span');
  label.className   = 'home-game-label';
  label.textContent = getTitle(game);

  card.appendChild(imgWrap);
  card.appendChild(label);

  if (mode === 'date' && game.addeddate) {
    const dateEl = document.createElement('span');
    dateEl.className   = 'home-game-date';
    const d = new Date(game.addeddate);
    dateEl.textContent = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    card.appendChild(dateEl);
  } else if (mode === 'playtime') {
    const lib = library[game.identifier];
    if (lib?.playtime_secs) {
      const ptEl = document.createElement('span');
      ptEl.className = 'home-game-playtime';
      ptEl.innerHTML = `⏱ ${formatPlaytime(lib.playtime_secs)}`;
      card.appendChild(ptEl);
    }
  }

  card.addEventListener('click', () => showDetailView(game));
  return card;
}

// ── Random Pick ────────────────────────────────────────────────────────────────
function pickRandomGame() {
  const installed = allGames.filter(g => library[g.identifier]?.install_dir);
  const unplayed  = installed.filter(g => !library[g.identifier]?.playtime_secs);
  const pool = unplayed.length ? unplayed : installed.length ? installed : allGames;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function renderHomeRandomPick(forceNew) {
  const section = document.getElementById('home-section-random');
  const wrap    = document.getElementById('home-random-card');
  wrap.innerHTML = '';

  if (forceNew || !homeRandomGame) homeRandomGame = pickRandomGame();
  const game = homeRandomGame;

  if (!game) { section.style.display = 'none'; return; }
  section.style.display = '';

  const libEntry  = library[game.identifier];
  const installed = !!libEntry?.install_dir;
  const title     = getTitle(game);
  const year      = game.date ? new Date(game.date).getFullYear() : null;

  const card = document.createElement('div');
  card.className = 'random-pick';

  const img = document.createElement('img');
  img.className = 'random-pick-thumb';
  img.alt       = title;
  applyThumb(img, game.identifier);

  const info = document.createElement('div');
  info.className = 'random-pick-info';

  const titleEl = document.createElement('div');
  titleEl.className   = 'random-pick-title';
  titleEl.textContent = title;

  const metaEl = document.createElement('div');
  metaEl.className   = 'random-pick-meta';
  metaEl.textContent = year || '';

  info.appendChild(titleEl);
  if (year) info.appendChild(metaEl);

  if (installed) {
    const badge = document.createElement('span');
    badge.className   = 'random-pick-installed';
    badge.textContent = 'Installed';
    info.appendChild(badge);
  }

  const actionBtn = document.createElement('button');
  actionBtn.className   = 'random-pick-launch';
  if (installed) {
    actionBtn.textContent = '▶ Launch';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDetailView(game);
      setTimeout(() => onLaunch(), 100);
    });
  } else {
    actionBtn.textContent = 'View Game';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDetailView(game);
    });
  }

  card.appendChild(img);
  card.appendChild(info);
  card.appendChild(actionBtn);
  card.addEventListener('click', () => showDetailView(game));
  wrap.appendChild(card);
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
