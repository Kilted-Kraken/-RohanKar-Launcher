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

// Download history: session-persistent record of all downloads
// { identifier, title, status, percent, startedAt, finishedAt }
const downloadHistory = [];

// ─── Controller support detection ─────────────────────────────────────────────
// Matches both "Controller Support: Yes" and "Controller Support - Yes"
const CONTROLLER_RE = /controller\s+support\s*[:\-]\s*yes/i;
function hasControllerSupport(game) {
  const desc = Array.isArray(game.description) ? game.description.join(' ') : (game.description || '');
  const subj = Array.isArray(game.subject)      ? game.subject.join(' ')      : (game.subject      || '');
  return CONTROLLER_RE.test(desc) || CONTROLLER_RE.test(subj);
}

// ─── Steam Deck compatibility detection ───────────────────────────────────────
// Matches "Deck Compatibility: Verified" or "Deck Compatibility - Verified"
const DECK_RE = /deck\s+compatibility\s*[:\-]\s*verified/i;
function hasDeckVerified(game) {
  const desc = Array.isArray(game.description) ? game.description.join(' ') : (game.description || '');
  const subj = Array.isArray(game.subject)      ? game.subject.join(' ')      : (game.subject      || '');
  return DECK_RE.test(desc) || DECK_RE.test(subj);
}

// ─── Widescreen Fix detection ────────────────────────────────────────────────
const WIDESCREEN_RE = /widescreen\s*fix/i;
function hasWidescreenFix(game) {
  const desc = Array.isArray(game.description) ? game.description.join(' ') : (game.description || '');
  const subj = Array.isArray(game.subject)      ? game.subject.join(' ')      : (game.subject      || '');
  return WIDESCREEN_RE.test(desc) || WIDESCREEN_RE.test(subj);
}

// ─── FOV detection ────────────────────────────────────────────────────────────
const FOV_RE = /\bfov\b/i;
function hasFOV(game) {
  const desc = Array.isArray(game.description) ? game.description.join(' ') : (game.description || '');
  const subj = Array.isArray(game.subject)      ? game.subject.join(' ')      : (game.subject      || '');
  return FOV_RE.test(desc) || FOV_RE.test(subj);
}

const SVG_WIDESCREEN = `<svg viewBox="6 15 52 34" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M53 23.3 Q52.65 19 48 19 L16 19 Q11.35 19 11.05 23.3 L8 26.2 8 24 Q8 16 16 16 L48 16 Q56 16 56 24 L56 26.2 53 23.3 M56.5 30.85 Q57 31.3 57 32 57 32.65 56.5 33.15 L49.85 39.55 Q49.35 40 48.65 40 47.95 40 47.5 39.55 47 39.05 47 38.4 L47 34 36.6 34 35.55 35.55 Q34.1 37 32 37 29.95 37 28.5 35.55 27.8 34.85 27.45 34 L17 34 17 38.4 Q17 39.05 16.5 39.55 16.05 40 15.35 40 14.65 40 14.15 39.55 L7.5 33.15 Q7 32.65 7 32 7 31.3 7.5 30.85 L14.15 24.45 Q14.65 24 15.35 24 16.05 24 16.5 24.45 17 24.9 17 25.6 L17 30 27.4 30 Q27.8 29.15 28.5 28.45 29.95 27 32 27 34.1 27 35.55 28.45 L36.6 30 47 30 47 25.6 Q47 24.9 47.5 24.45 47.95 24 48.65 24 49.35 24 49.85 24.45 L56.5 30.85 M56 37.8 L56 40 Q56 48 48 48 L16 48 Q8 48 8 40 L8 37.8 11.05 40.75 Q11.35 45 16 45 L48 45 Q52.65 45 53 40.75 L56 37.8"/></svg>`;

const SVG_FOV = `<svg viewBox="7 12 50 40" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M30.85 13.5 Q31.3 13 32 13 32.65 13 33.15 13.5 L39.55 20.15 Q40 20.65 40 21.35 40 22.05 39.55 22.5 L39.5 22.55 Q39 23 38.4 23 L34 23 34 27.4 35.55 28.45 Q37 29.9 37 32 37 34.05 35.55 35.5 L34 36.6 34 41 38.4 41 Q39.05 41 39.55 41.5 L39.9 42 40 42.65 Q40 43.35 39.55 43.85 L33.15 50.5 Q32.65 51 32 51 31.3 51 30.85 50.5 L24.45 43.85 Q24 43.35 24 42.65 24 42.3 24.15 42 L24.45 41.5 Q24.9 41 25.6 41 L30 41 30 36.6 Q29.15 36.2 28.45 35.5 27 34.05 27 32 27 29.9 28.45 28.45 29.15 27.75 30 27.4 L30 23 25.6 23 24.5 22.55 24.45 22.5 Q24 22.05 24 21.35 24 20.65 24.45 20.15 L30.85 13.5 M43 42 Q42.8 40.45 41.7 39.4 40.35 38.05 38.65 38 L38.4 38 37.3 38 37.7 37.6 Q40 35.3 40 32 40 28.65 37.7 26.3 L37.65 26.3 37.3 26 38.4 26 38.65 26 Q40.35 25.95 41.7 24.6 L42.7 23.1 Q46.1 23.8 49.45 24.95 L45.55 42 43 42 M42.85 20.1 L41.8 18.15 41.7 18.05 40.3 16.6 Q47.2 17.6 54.05 20.2 55.1 20.6 55.6 21.6 56.2 22.55 55.9 23.65 L51.25 44 Q50.85 45.2 49.85 46.25 48.1 47.95 45.75 48 L39.75 48 41.7 45.95 41.8 45.85 42.4 45 45.75 45 Q46.85 44.95 47.7 44.2 L47.75 44.1 48.4 43.15 53 23.05 53 23 52.95 23 Q47.9 21.05 42.85 20.1 M23.7 16.6 L22.3 18.05 22.25 18.15 Q21.45 19 21.2 20.1 16.1 21.05 11.05 23 L11.05 23.05 15.65 43.15 16.25 44.1 16.35 44.2 Q17.2 44.95 18.35 45 L21.65 45 22.25 45.85 22.3 45.95 24.3 48 18.25 48 Q15.9 47.95 14.15 46.25 13.15 45.2 12.75 44 L8.1 23.65 Q7.8 22.55 8.4 21.6 8.9 20.6 9.95 20.2 16.8 17.6 23.7 16.6 M21.35 23.1 Q21.65 23.9 22.25 24.5 23.55 26 25.6 26 L26.7 26 26.35 26.3 Q24 28.65 24 32 24 35.25 26.3 37.55 L26.35 37.6 26.8 38 25.6 38 Q23.55 38 22.25 39.5 21.2 40.55 21.05 42 L18.45 42 14.55 24.95 Q17.95 23.8 21.35 23.1"/></svg>`;

const SVG_DECK = `<svg viewBox="8 8 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M51 24 L50.75 23.3 Q50.45 23 50 23 49.6 23 49.3 23.3 49 23.6 49 24 49 24.45 49.3 24.7 49.6 25 50 25 L50.75 24.7 51 24 M12 20 L52 20 Q56 20 56 24 L56 36 Q56 44 48 44 L16 44 Q8 44 8 36 L8 24 Q8 20 12 20 M12.95 30.7 Q11 30.7 11 32.65 L11 34.75 Q11 36.7 12.95 36.7 L15.05 36.7 Q17 36.7 17 34.75 L17 32.65 Q17 30.7 15.05 30.7 L12.95 30.7 M13 23 L13 25 11 25 11 27 13 27 13 29 15 29 15 27 17 27 17 25 15 25 15 23 13 23 M21 23 Q19 23 19 25 L19 39 Q19 41 21 41 L43 41 Q45 41 45 39 L45 25 Q45 23 43 23 L21 23 M49 26 L48.75 25.3 Q48.45 25 48 25 47.6 25 47.3 25.3 47 25.6 47 26 47 26.45 47.3 26.7 L48 27 48.75 26.7 49 26 M48.95 30.7 Q47 30.7 47 32.65 L47 34.75 Q47 36.7 48.95 36.7 L51.05 36.7 Q53 36.7 53 34.75 L53 32.65 Q53 30.7 51.05 30.7 L48.95 30.7 M51 28 L50.75 27.3 Q50.45 27 50 27 49.6 27 49.3 27.3 49 27.6 49 28 49 28.45 49.3 28.7 49.6 29 50 29 L50.75 28.7 51 28 M53 26 L52.75 25.3 Q52.45 25 52 25 51.6 25 51.3 25.3 51 25.6 51 26 51 26.45 51.3 26.7 51.6 27 52 27 L52.75 26.7 53 26"/></svg>`;

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
  document.getElementById('btn-add-to-steam').addEventListener('click', onAddToSteam);
  document.getElementById('btn-add-to-steam').addEventListener('click', onAddToSteam);

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

  document.getElementById('btn-downloads').addEventListener('click', openDownloadsModal);
  document.getElementById('btn-close-downloads').addEventListener('click', closeDownloadsModal);
  document.getElementById('btn-clear-download-history').addEventListener('click', () => {
    // Remove only completed/errored entries
    const keep = downloadHistory.filter(e => e.status === 'downloading' || e.status === 'extracting');
    downloadHistory.length = 0;
    keep.forEach(e => downloadHistory.push(e));
    renderDownloadsModal();
  });
  document.getElementById('downloads-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('downloads-modal')) closeDownloadsModal();
  });

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

  // Scan for pre-existing installs
  document.getElementById('btn-scan-games').addEventListener('click', onScanForGames);

  // Download progress
  window.electronAPI.onDownloadProgress(({ identifier, percent }) => {
    // Strictly ignore if not in queue or not actively downloading
    const entry = downloadQueue.get(identifier);
    if (!entry || entry.status !== 'downloading') return;
    dqSet(identifier, { percent });
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
      // Re-query after re-render so we have a live reference
      const freshCards = [...libraryGrid.querySelectorAll('.game-card')];
      gpScrollCardIntoView(freshCards[nextIdx]);
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
  gpModalFocusIdx = 0;
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

async function onScanForGames() {
  const resultEl = document.getElementById('scan-result');
  const btn      = document.getElementById('btn-scan-games');
  if (!allGames.length) {
    resultEl.textContent = 'Games not loaded yet — try again in a moment.';
    resultEl.className   = 'none';
    return;
  }

  // Determine scan directory: use install path from settings, then download path, then default
  const s       = await window.electronAPI.getSettings();
  const scanDir = s.installPath || s.downloadPath || null;
  if (!scanDir) {
    resultEl.textContent = 'Set an Install Folder in settings first.';
    resultEl.className   = 'none';
    return;
  }

  btn.disabled     = true;
  btn.textContent  = '⏳ Scanning…';
  resultEl.textContent = '';
  resultEl.className   = '';

  const knownIdentifiers = allGames.map(g => g.identifier);

  // Build title → identifier map for matching folders named after game titles
  // (e.g. "Zoo Tycoon - Complete Collection" downloaded directly from archive.org)
  const titleMap = {};
  for (const game of allGames) {
    const t = Array.isArray(game.title) ? game.title[0] : game.title;
    if (t && String(t).trim()) titleMap[String(t).trim()] = game.identifier;
  }

  const result = await window.electronAPI.scanForGames({ scanDir, knownIdentifiers, titleMap });

  btn.disabled    = false;
  btn.textContent = '🔍 Scan Install Folder';

  if (!result.found.length) {
    resultEl.textContent = 'No new games found.';
    resultEl.className   = 'none';
    return;
  }

  // Refresh library so the UI reflects the newly registered games
  library = await window.electronAPI.getLibrary();
  renderLibraryGrid();
  renderHomeStats();

  resultEl.textContent = `✓ Found ${result.found.length} game${result.found.length !== 1 ? 's' : ''}!`;
  resultEl.className   = '';
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

    const libEntry  = library[game.identifier];
    const isFav      = !!libEntry?.is_favorite;
    const hasCtrl    = hasControllerSupport(game);
    const hasDeck    = hasDeckVerified(game);
    const hasWide    = hasWidescreenFix(game);
    const hasFov     = hasFOV(game);
    const installed  = !!libEntry?.install_dir;

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

    if (hasWide) {
      const wideBadge = document.createElement('span');
      wideBadge.className = 'card-badge widescreen-fix';
      wideBadge.title     = 'Widescreen Fix';
      wideBadge.innerHTML = SVG_WIDESCREEN;
      badgeStrip.appendChild(wideBadge);
    }
    if (hasFov) {
      const fovBadge = document.createElement('span');
      fovBadge.className = 'card-badge fov';
      fovBadge.title     = 'FOV Support';
      fovBadge.innerHTML = SVG_FOV;
      badgeStrip.appendChild(fovBadge);
    }
    if (hasDeck) {
      const deckBadge = document.createElement('span');
      deckBadge.className = 'card-badge deck-verified';
      deckBadge.title     = 'Steam Deck Verified';
      deckBadge.innerHTML = SVG_DECK;
      badgeStrip.appendChild(deckBadge);
    }
    if (hasCtrl) {
      const ctrlBadge = document.createElement('span');
      ctrlBadge.className = 'card-badge controller';
      ctrlBadge.title     = 'Controller Support';
      ctrlBadge.innerHTML = `<svg viewBox="8 8 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M29 32.5 Q29 31.05 28 30 27 29 25.5 29 L24.55 29.15 Q23.7 29.35 23.05 30 22 31.05 22 32.5 22 33.95 23.05 35 L24.55 35.9 25.5 36 Q27 36 28 35 29 33.95 29 32.5 M39 32 Q39 30.75 38.15 29.85 37.3 29 36 29 34.75 29 33.9 29.85 33 30.75 33 32 33 33.25 33.9 34.15 34.75 35 36 35 37.3 35 38.15 34.15 39 33.25 39 32 M41 25 Q41 24.15 40.4 23.55 39.85 23 39 23 38.15 23 37.6 23.55 37 24.15 37 25 37 25.8 37.6 26.4 38.15 27 39 27 39.85 27 40.4 26.4 41 25.8 41 25 M34 20 Q34 19.15 33.45 18.55 32.85 18 32 18 31.15 18 30.6 18.55 30 19.15 30 20 30 20.85 30.6 21.45 31.15 22 32 22 32.85 22 33.45 21.45 34 20.85 34 20 M24 23.5 Q24 22.05 23 21 22 20 20.5 20 19.05 20 18.05 21 17 22.05 17 23.5 17 24.95 18.05 26 19.05 27 20.5 27 22 27 23 26 24 24.95 24 23.5 M45 29 Q45 28.15 44.4 27.55 43.85 27 43 27 42.15 27 41.6 27.55 41 28.15 41 29 41 29.8 41.6 30.4 42.15 31 43 31 43.85 31 44.4 30.4 45 29.8 45 29 M49 25 Q49 24.15 48.4 23.55 47.85 23 47 23 46.15 23 45.6 23.55 45 24.15 45 25 45 25.8 45.6 26.4 46.15 27 47 27 47.85 27 48.4 26.4 49 25.8 49 25 M45 21 Q45 20.15 44.4 19.55 43.85 19 43 19 42.15 19 41.6 19.55 41 20.15 41 21 41 21.8 41.6 22.4 42.15 23 43 23 43.85 23 44.4 22.4 45 21.8 45 21 M23.6 38.65 Q22.1 38.65 20.9 39.6 20.15 40.15 19.5 41.1 L17.45 43.75 Q14.65 47.25 12.7 48 9.55 47.55 8.25 43.95 7.95 42.5 8 40.75 8.1 38 9.1 34.5 L9.35 33.55 Q10.2 30.3 11.35 27 L12.1 25 13.35 21.9 14.35 19.6 15.3 18.6 15.45 18.35 15.85 17.65 Q17.55 15.4 21.55 15 L23.5 15 24.25 15.85 39.7 15.85 40.5 15 42.45 15 Q46.45 15.4 48.1 17.65 L48.55 18.35 48.65 18.6 49.65 19.6 50.65 21.9 51.95 25 52.65 27 54.65 33.55 54.9 34.5 Q55.9 38 56 40.75 56.05 42.5 55.75 43.95 54.45 47.55 51.25 48 49.35 47.25 46.5 43.75 L44.5 41.1 43.1 39.6 Q41.9 38.65 40.4 38.65 L23.6 38.65"/></svg>`;
      badgeStrip.appendChild(ctrlBadge);
    }
    if (isFav) {
      const fav = document.createElement('span');
      fav.className = 'card-fav';
      fav.innerHTML = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M26.9 2.6 L33.3 13.1 45.3 15.9 Q46.5 16.3 47.2 17.3 48 18.2 48 19.4 47.9 20.6 47.1 21.6 L39.1 31 40.1 43.2 Q40.2 44.5 39.5 45.4 38.8 46.5 37.6 46.8 L35.3 46.7 24 42 12.6 46.7 10.3 46.8 Q9.1 46.5 8.4 45.4 7.7 44.5 7.8 43.2 L8.8 31 0.8 21.6 Q0 20.6 0 19.4 -0.1 18.2 0.7 17.3 1.4 16.3 2.6 15.9 L14.6 13.1 21 2.6 Q21.7 1.6 22.8 1.2 24 0.8 25.1 1.2 26.3 1.6 26.9 2.6"/></svg>`;
      badgeStrip.appendChild(fav);
    }

    if (hasWide || hasFov || hasDeck || hasCtrl || isFav) textCol.appendChild(badgeStrip);
    textCol.appendChild(label);

    card.appendChild(textCol);
    card.addEventListener('click', () => showDetailView(game));
    libraryGrid.appendChild(card);
  });
}

// ─── Download queue UI (toast panel removed — downloads modal handles display) ─
function renderDownloadQueue() { /* no-op — toast panel removed */ }

function dqSet(identifier, fields) {
  const existing = downloadQueue.get(identifier) || {};
  const updated  = { ...existing, ...fields };
  downloadQueue.set(identifier, updated);
  renderDownloadQueue();
  // Sync to history
  syncToHistory(identifier, updated);
  updateDownloadsButton();
}

function dqDone(identifier) {
  dqSet(identifier, { status: 'done', percent: 100, finishedAt: Date.now() });
  setTimeout(() => {
    downloadQueue.delete(identifier);
    renderDownloadQueue();
    updateDownloadsButton();
  }, 3000);
}

function syncToHistory(identifier, entry) {
  const idx = downloadHistory.findIndex(h => h.identifier === identifier);
  const record = {
    identifier,
    title:      entry.title || identifier,
    status:     entry.status,
    percent:    entry.percent ?? 0,
    startedAt:  entry.startedAt || Date.now(),
    finishedAt: entry.finishedAt || null,
  };
  if (idx >= 0) downloadHistory[idx] = record;
  else          downloadHistory.unshift(record);
  // If downloads modal is open, update progress bars in-place rather than
  // re-rendering the whole modal (re-rendering destroys cancel button listeners)
  if (!document.getElementById('downloads-modal').classList.contains('hidden')) {
    updateDownloadsModalProgress(identifier, entry);
  }
}

// Update just the progress/status of an active item without destroying the DOM
function updateDownloadsModalProgress(identifier, entry) {
  const activeList = document.getElementById('downloads-active-list');
  if (!activeList) return;
  // Find the existing item row for this identifier
  const item = activeList.querySelector(`[data-identifier="${CSS.escape(identifier)}"]`);
  if (!item) {
    // Item not rendered yet — do a full re-render (e.g. new download started)
    renderDownloadsModal();
    return;
  }
  // Update bar width
  const bar = item.querySelector('.dm-bar');
  if (bar) bar.style.width = `${entry.percent ?? 0}%`;
  // Update meta text
  const meta = item.querySelector('.dm-meta');
  if (meta && entry.status !== 'extracting') meta.textContent = `${entry.percent ?? 0}%`;
  else if (meta && entry.status === 'extracting') meta.textContent = 'Extracting…';
  // Update status label
  const status = item.querySelector('.dm-status');
  if (status) status.textContent = entry.status === 'extracting' ? 'Extracting' : `${entry.percent ?? 0}%`;
}

function updateDownloadsButton() {
  const btn    = document.getElementById('btn-downloads');
  const active = [...downloadQueue.values()].filter(
    e => e.status === 'downloading' || e.status === 'extracting'
  );
  // Remove old badge
  btn.querySelector('.dl-badge')?.remove();
  if (active.length > 0) {
    btn.classList.add('has-active');
    const badge = document.createElement('span');
    badge.className   = 'dl-badge';
    badge.textContent = active.length;
    btn.appendChild(badge);
  } else {
    btn.classList.remove('has-active');
  }
}

function openDownloadsModal() {
  gpModalFocusIdx = 0;
  renderDownloadsModal();
  document.getElementById('downloads-modal').classList.remove('hidden');
}

function closeDownloadsModal() {
  document.getElementById('downloads-modal').classList.add('hidden');
}

function renderDownloadsModal() {
  // ─ Active section ─
  const activeSection = document.getElementById('downloads-active-section');
  const activeList    = document.getElementById('downloads-active-list');
  const active = [...downloadQueue.values()].filter(
    e => e.status === 'downloading' || e.status === 'extracting'
  );

  if (active.length === 0) {
    activeSection.classList.add('hidden');
  } else {
    activeSection.classList.remove('hidden');
    activeList.innerHTML = '';
    active.forEach(entry => {
      activeList.appendChild(makeDmItem(entry, true));
    });
  }

  // ─ History section ─
  const historyList  = document.getElementById('downloads-history-list');
  const countEl      = document.getElementById('downloads-history-count');
  const history = downloadHistory.filter(
    e => e.status !== 'downloading' && e.status !== 'extracting'
  );

  countEl.textContent = history.length ? `(${history.length})` : '';
  historyList.innerHTML = '';

  if (!history.length) {
    historyList.innerHTML = '<div class="dm-empty">No downloads this session yet.</div>';
    return;
  }
  history.forEach(entry => {
    historyList.appendChild(makeDmItem(entry, false));
  });
}

function makeDmItem(entry, isActive) {
  const game = allGames.find(g => g.identifier === entry.identifier);
  const item = document.createElement('div');
  item.className = 'dm-item'
    + (entry.status === 'done'  ? ' done'  : '')
    + (entry.status === 'error' ? ' error' : '')
    + (isActive                 ? ' active': '');
  item.dataset.identifier = entry.identifier;

  // Thumbnail
  const thumb = document.createElement('img');
  thumb.className = 'dm-thumb';
  thumb.alt       = entry.title;
  if (game) applyThumb(thumb, entry.identifier);
  else      thumb.style.opacity = '0.3';

  // Info column
  const info = document.createElement('div');
  info.className = 'dm-info';

  const title = document.createElement('div');
  title.className   = 'dm-title';
  title.textContent = entry.title;

  const meta = document.createElement('div');
  meta.className = 'dm-meta';

  if (isActive) {
    const statusText = entry.status === 'extracting' ? 'Extracting…' : `${entry.percent ?? 0}%`;
    meta.textContent = statusText;
  } else {
    const when = entry.finishedAt
      ? new Date(entry.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const statusLabel = entry.status === 'done' ? '✓ Installed' : '✕ Failed';
    meta.innerHTML = `<span>${statusLabel}</span>${when ? `<span>${when}</span>` : ''}`;
  }

  const barWrap = document.createElement('div');
  barWrap.className = 'dm-bar-wrap';
  const bar = document.createElement('div');
  bar.className = 'dm-bar';
  bar.style.width = isActive
    ? `${entry.percent ?? 0}%`
    : entry.status === 'done' ? '100%' : `${entry.percent ?? 0}%`;
  barWrap.appendChild(bar);

  info.appendChild(title);
  info.appendChild(meta);
  if (isActive || entry.status === 'error') info.appendChild(barWrap);

  // Status label
  const status = document.createElement('span');
  status.className = 'dm-status';
  if (isActive) {
    status.textContent = entry.status === 'extracting' ? 'Extracting' : `${entry.percent ?? 0}%`;
  } else {
    status.textContent = entry.status === 'done' ? 'Done' : 'Error';
  }

  item.appendChild(thumb);
  item.appendChild(info);
  item.appendChild(status);

  // Cancel button for active
  if (isActive) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'dm-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.title       = 'Cancel download';
    cancelBtn.addEventListener('click', async () => {
      const id = entry.identifier;
      console.log('[cancel-modal] clicked, id=', id, 'queue has:', downloadQueue.has(id), 'queue size:', downloadQueue.size);
      // Delete from queue FIRST — before the IPC round-trip — so the
      // onDownload async flow sees it's gone the moment downloadStart resolves
      downloadQueue.delete(id);
      const hi = downloadHistory.findIndex(h => h.identifier === id);
      if (hi >= 0) {
        downloadHistory[hi].status     = 'error';
        downloadHistory[hi].finishedAt = Date.now();
      }
      renderDownloadQueue();
      renderDownloadsModal();
      updateDownloadsButton();
      if (selectedGame?.identifier === id) {
        progressWrap.classList.add('hidden');
        refreshButtonStates();
      }
      renderLibraryGrid();
      // Send cancel signal AFTER cleaning up state
      await window.electronAPI.downloadCancel({ identifier: id });
    });
    item.appendChild(cancelBtn);
  } else if (game) {
    // View button for history items
    const viewBtn = document.createElement('button');
    viewBtn.className   = 'dm-view';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => {
      closeDownloadsModal();
      showDetailView(game);
    });
    item.appendChild(viewBtn);
  }

  return item;
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

  // Build detail panel badges
  const deckSupport  = hasDeckVerified(game);
  const ctrlSupport  = hasControllerSupport(game);
  const wideSupport  = hasWidescreenFix(game);
  const fovSupport   = hasFOV(game);
  const detailBadges = [];
  if (ctrlSupport) detailBadges.push('<span class="controller-badge"><svg viewBox="8 8 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor" style="width:14px;height:14px;flex-shrink:0"><path d="M29 32.5 Q29 31.05 28 30 27 29 25.5 29 L24.55 29.15 Q23.7 29.35 23.05 30 22 31.05 22 32.5 22 33.95 23.05 35 L24.55 35.9 25.5 36 Q27 36 28 35 29 33.95 29 32.5 M39 32 Q39 30.75 38.15 29.85 37.3 29 36 29 34.75 29 33.9 29.85 33 30.75 33 32 33 33.25 33.9 34.15 34.75 35 36 35 37.3 35 38.15 34.15 39 33.25 39 32 M41 25 Q41 24.15 40.4 23.55 39.85 23 39 23 38.15 23 37.6 23.55 37 24.15 37 25 37 25.8 37.6 26.4 38.15 27 39 27 39.85 27 40.4 26.4 41 25.8 41 25 M34 20 Q34 19.15 33.45 18.55 32.85 18 32 18 31.15 18 30.6 18.55 30 19.15 30 20 30 20.85 30.6 21.45 31.15 22 32 22 32.85 22 33.45 21.45 34 20.85 34 20 M24 23.5 Q24 22.05 23 21 22 20 20.5 20 19.05 20 18.05 21 17 22.05 17 23.5 17 24.95 18.05 26 19.05 27 20.5 27 22 27 23 26 24 24.95 24 23.5 M45 29 Q45 28.15 44.4 27.55 43.85 27 43 27 42.15 27 41.6 27.55 41 28.15 41 29 41 29.8 41.6 30.4 42.15 31 43 31 43.85 31 44.4 30.4 45 29.8 45 29 M49 25 Q49 24.15 48.4 23.55 47.85 23 47 23 46.15 23 45.6 23.55 45 24.15 45 25 45 25.8 45.6 26.4 46.15 27 47 27 47.85 27 48.4 26.4 49 25.8 49 25 M45 21 Q45 20.15 44.4 19.55 43.85 19 43 19 42.15 19 41.6 19.55 41 20.15 41 21 41 21.8 41.6 22.4 42.15 23 43 23 43.85 23 44.4 22.4 45 21.8 45 21 M23.6 38.65 Q22.1 38.65 20.9 39.6 20.15 40.15 19.5 41.1 L17.45 43.75 Q14.65 47.25 12.7 48 9.55 47.55 8.25 43.95 7.95 42.5 8 40.75 8.1 38 9.1 34.5 L9.35 33.55 Q10.2 30.3 11.35 27 L12.1 25 13.35 21.9 14.35 19.6 15.3 18.6 15.45 18.35 15.85 17.65 Q17.55 15.4 21.55 15 L23.5 15 24.25 15.85 39.7 15.85 40.5 15 42.45 15 Q46.45 15.4 48.1 17.65 L48.55 18.35 48.65 18.6 49.65 19.6 50.65 21.9 51.95 25 52.65 27 54.65 33.55 54.9 34.5 Q55.9 38 56 40.75 56.05 42.5 55.75 43.95 54.45 47.55 51.25 48 49.35 47.25 46.5 43.75 L44.5 41.1 43.1 39.6 Q41.9 38.65 40.4 38.65 L23.6 38.65"/></svg> Controller Support</span>');
  if (deckSupport)  detailBadges.push('<span class="deck-badge">'       + SVG_DECK.replace('><path',       ' style="width:14px;height:14px;flex-shrink:0"><path') + ' Deck Verified</span>');
  if (wideSupport)   detailBadges.push('<span class="widescreen-badge">' + SVG_WIDESCREEN.replace('><path', ' style="width:14px;height:14px;flex-shrink:0"><path') + ' Widescreen Fix</span>');
  if (fovSupport)    detailBadges.push('<span class="fov-badge">'        + SVG_FOV.replace('><path',       ' style="width:14px;height:14px;flex-shrink:0"><path') + ' FOV</span>');
  detailExtra.innerHTML = detailBadges.join('') || '';

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
    renderCollectionChips(null);
    return;
  }

  if (btnFavorite) {
    btnFavorite.classList.remove('hidden');
    updateFavoriteButton();
  }

  if (btnAddToCollection) btnAddToCollection.classList.remove('hidden');
  renderCollectionChips(selectedGame.identifier);

  const lib = library[selectedGame.identifier];
  const installed = !!(lib?.install_dir);
  // Disable download if installed OR if this game is in the download queue
  btnDownload.disabled = installed || downloadQueue.has(selectedGame.identifier);
  btnLaunch.disabled   = !installed;
  btnDelete.disabled   = !installed;
  if (installed) {
    btnOpenLocation.classList.remove('hidden');
    document.getElementById('btn-add-to-steam')?.classList.remove('hidden');
  } else {
    btnOpenLocation.classList.add('hidden');
    document.getElementById('btn-add-to-steam')?.classList.add('hidden');
  }
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

  // Prevent double-queuing the whole collection
  if (downloadQueue.has(identifier)) return;

  let archives;
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

    archives = files.filter(f =>
      /\.(zip|7z|rar)$/i.test(f.name) ||
      (/\.exe$/i.test(f.name) && !files.some(ff => /\.(zip|7z|rar)$/i.test(ff.name)))
    );
    if (!archives.length) { alert('No downloadable file found for this game.'); return; }
  } catch (e) {
    alert('Failed to fetch file list: ' + e.message);
    return;
  }

  // If there's only one archive, download it directly (existing behaviour)
  if (archives.length === 1) {
    await startSingleDownload(identifier, getTitle(selectedGame), archives[0]);
    return;
  }

  // Multiple archives — show picker modal
  const selected = await showArchivePicker(identifier, archives);
  if (!selected || !selected.length) return;

  // Queue each selected archive as an independent download
  for (const file of selected) {
    // Use identifier:basename as the queue key so each file is tracked separately
    const baseName  = file.name.replace(/\.[^.]+$/, ''); // strip extension for display
    const queueKey  = `${identifier}:${file.name}`;
    startSingleDownload(queueKey, baseName, file, identifier);
  }
}

// Shows a modal listing multiple archive files with checkboxes.
// Returns an array of selected file objects, or empty array if cancelled.
function showArchivePicker(identifier, archives) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'exe-picker-overlay';

    const modal = document.createElement('div');
    modal.className = 'exe-picker-modal';
    modal.style.maxWidth = '480px';

    const header = document.createElement('div');
    header.className = 'exe-picker-header';
    header.innerHTML = `
      <h3>Multiple Games in this Collection</h3>
      <p>Select which games you want to install:</p>
    `;

    const list = document.createElement('ul');
    list.className = 'exe-picker-list archive-picker-list';

    archives.forEach(file => {
      const li = document.createElement('li');
      li.className = 'archive-picker-item';

      const label = document.createElement('label');
      label.className = 'archive-picker-label';

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = true; // default all selected
      cb.dataset.filename = file.name;

      const nameSpan = document.createElement('span');
      nameSpan.className   = 'archive-picker-name';
      nameSpan.textContent = file.name.replace(/\.[^.]+$/, ''); // strip extension

      const sizeSpan = document.createElement('span');
      sizeSpan.className   = 'archive-picker-size';
      sizeSpan.textContent = file.size ? formatSize(file.size) : '';

      label.appendChild(cb);
      label.appendChild(nameSpan);
      label.appendChild(sizeSpan);
      li.appendChild(label);
      list.appendChild(li);
    });

    // Select all / none controls
    const selRow = document.createElement('div');
    selRow.className = 'archive-picker-selrow';
    const selAll  = document.createElement('button');
    selAll.className   = 'archive-picker-selall';
    selAll.textContent = 'Select All';
    selAll.addEventListener('click', () => {
      list.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = true);
    });
    const selNone = document.createElement('button');
    selNone.className   = 'archive-picker-selall';
    selNone.textContent = 'Select None';
    selNone.addEventListener('click', () => {
      list.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
    });
    selRow.appendChild(selAll);
    selRow.appendChild(selNone);

    const footer = document.createElement('div');
    footer.className = 'exe-picker-footer';
    const btnRow = document.createElement('div');
    btnRow.className = 'exe-picker-btn-row';

    const installBtn = document.createElement('button');
    installBtn.className   = 'exe-picker-launch';
    installBtn.textContent = 'Install Selected';
    installBtn.addEventListener('click', () => {
      const checked = [...list.querySelectorAll('input[type=checkbox]')]
        .filter(c => c.checked)
        .map(c => archives.find(f => f.name === c.dataset.filename))
        .filter(Boolean);
      cleanup();
      resolve(checked);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'exe-picker-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { cleanup(); resolve([]); });

    btnRow.appendChild(installBtn);
    btnRow.appendChild(cancelBtn);
    footer.appendChild(btnRow);

    modal.appendChild(header);
    modal.appendChild(selRow);
    modal.appendChild(list);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve([]); }
    });

    function cleanup() { document.body.removeChild(overlay); }
  });
}

// Downloads, extracts, and installs a single archive file.
// queueKey   — key used in downloadQueue (identifier for single games, identifier:filename for collections)
// title      — display name shown in Downloads Modal
// file       — { name, size } from archive.org file list
// parentId   — for collection items, the archive.org identifier (used for install_dir naming)
//              When set, this game extracts into a subfolder inside the parent's install dir,
//              and the parent identifier is registered as the installed entry (not the individual game).
async function startSingleDownload(queueKey, title, file, parentId) {
  const identifier = parentId || queueKey;
  if (downloadQueue.has(queueKey)) return;

  const encodedName = file.name.split('/').map(encodeURIComponent).join('/');
  const fileUrl     = `https://archive.org/download/${identifier}/${encodedName}`;

  dqSet(queueKey, { identifier: queueKey, title, percent: 0, status: 'downloading', startedAt: Date.now() });

  // Only show inline progress bar for single-game installs (not collection items)
  const isPrimary = !parentId;
  if (isPrimary) {
    btnDownload.disabled = true;
    progressWrap.classList.remove('hidden');
    progressBar.style.width  = '0%';
    progressText.textContent = '0%';
  }

  const result = await window.electronAPI.downloadStart({
    identifier: queueKey,
    downloadUrl: fileUrl,
    fileName:    file.name,
  });

  if (!downloadQueue.has(queueKey)) {
    if (isPrimary) { progressWrap.classList.add('hidden'); refreshButtonStates(); }
    return;
  }

  if (!result.ok) {
    dqSet(queueKey, { status: 'error', finishedAt: Date.now() });
    setTimeout(() => { downloadQueue.delete(queueKey); updateDownloadsButton(); }, 4000);
    if (isPrimary) { progressWrap.classList.add('hidden'); refreshButtonStates(); }
    return;
  }

  dqSet(queueKey, { status: 'extracting', percent: 100 });
  if (isPrimary) {
    progressBar.style.width  = '100%';
    progressText.textContent = '100%';
  }

  // Collection items: extract into a named subfolder inside the parent identifier's
  // install directory. e.g. ni-ghts-into-dreams_202511/Crazy Taxi/
  // Single games: extract into the identifier folder as normal.
  const extractResult = await window.electronAPI.extractArchive({
    filePath:    result.filePath,
    identifier:  identifier,           // always the archive.org identifier for the parent dir
    subFolder:   parentId ? title : null, // subfolder name = game title for collection items
  });

  if (isPrimary) progressWrap.classList.add('hidden');

  if (!extractResult.ok) {
    dqSet(queueKey, { status: 'error' });
    setTimeout(() => { downloadQueue.delete(queueKey); }, 4000);
    return;
  }

  // For both single games and collection items, register the parent identifier
  // pointing to the parent install dir. findExesInDir will recurse into subfolders
  // to find all executables across all games in the collection.
  const parentInstallDir = extractResult.parentInstallDir || extractResult.installDir;
  const exePaths = await window.electronAPI.findExes({ installDir: parentInstallDir });
  const exePath  = exePaths.length === 1 ? exePaths[0] : null;

  await window.electronAPI.installGame({
    identifier: identifier,
    installDir: parentInstallDir,
    exePath,
  });

  library = await window.electronAPI.getLibrary();
  dqDone(queueKey);

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
  // Delete from queue first so progress events can't re-insert it
  downloadQueue.delete(identifier);
  const hi = downloadHistory.findIndex(h => h.identifier === identifier);
  if (hi >= 0) { downloadHistory[hi].status = 'error'; downloadHistory[hi].finishedAt = Date.now(); }
  renderDownloadQueue();
  updateDownloadsButton();
  progressWrap.classList.add('hidden');
  refreshButtonStates();
  await window.electronAPI.downloadCancel({ identifier });
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

    // Detect if this is a multi-game collection (any path contains _GAME_)
    const isCollection = exePaths.some(p => p.includes('_GAME_'));
    header.innerHTML = isCollection
      ? `<h3>Select a Game to Launch</h3><p>This is a collection — choose which game to play:</p>`
      : `<h3>Select Executable</h3><p>Multiple executables found. Choose one to launch:</p>`;

    const list = document.createElement('ul');
    list.className = 'exe-picker-list';

    if (isCollection) {
      // Group exes by their _GAME_ parent folder
      // e.g. .../ni-ghts-into-dreams_202511/_GAME_Crazy Taxi/CrazyTaxi.exe
      const groups = {}; // gameName → [exePath, ...]
      exePaths.forEach(p => {
        const match = p.match(/_GAME_([^\\/]+)[\\/]/);
        const gameName = match ? match[1] : 'Unknown';
        if (!groups[gameName]) groups[gameName] = [];
        groups[gameName].push(p);
      });

      Object.entries(groups).forEach(([gameName, paths]) => {
        // Group header
        const groupHeader = document.createElement('li');
        groupHeader.className = 'exe-picker-group-header';
        groupHeader.textContent = gameName; // clean name, no _GAME_ prefix
        list.appendChild(groupHeader);

        // Exe rows within this group
        paths.forEach(p => {
          // Extract the path after the _GAME_<name> folder segment.
          // e.g. C:\Games\_GAME_Crazy Taxi\subdir\Crazy Taxi.exe  →  subdir\Crazy Taxi.exe
          // e.g. C:\Games\_GAME_Crazy Taxi\Crazy Taxi.exe         →  Crazy Taxi.exe
          const gameMarker = '_GAME_' + gameName;
          const markerIdx  = p.indexOf(gameMarker);
          const rel = markerIdx !== -1
            ? p.slice(markerIdx + gameMarker.length).replace(/^[\\/]/, '')
            : p.split(/[\\/]/).pop();

          const li = document.createElement('li');
          li.className = 'exe-picker-game-item';
          li.textContent = rel;
          li.title = p;
          li.addEventListener('click', () => {
            list.querySelectorAll('li.exe-picker-game-item, li:not(.exe-picker-group-header)').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
            selectedExe = p;
            launchBtn.disabled = false;
          });
          list.appendChild(li);
        });
      });
    } else {
      // Standard single-game exe list
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
    }
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
  const lib = library[selectedGame.identifier];
  const installDir = lib?.install_dir || null;
  if (!confirm(`Delete ${getTitle(selectedGame)}? This will remove all game files from disk. This cannot be undone.`)) return;
  const result = await window.electronAPI.deleteGame({
    identifier: selectedGame.identifier,
    installDir,
  });
  if (!result.ok) {
    alert('Delete failed: ' + (result.error || 'Unknown error'));
    return;
  }
  library = await window.electronAPI.getLibrary();
  refreshButtonStates();
  renderLibraryGrid();
  renderHomeStats();
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

const SVG_FAVORITE = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M26.9 2.6 L33.3 13.1 45.3 15.9 Q46.5 16.3 47.2 17.3 48 18.2 48 19.4 47.9 20.6 47.1 21.6 L39.1 31 40.1 43.2 Q40.2 44.5 39.5 45.4 38.8 46.5 37.6 46.8 L35.3 46.7 24 42 12.6 46.7 10.3 46.8 Q9.1 46.5 8.4 45.4 7.7 44.5 7.8 43.2 L8.8 31 0.8 21.6 Q0 20.6 0 19.4 -0.1 18.2 0.7 17.3 1.4 16.3 2.6 15.9 L14.6 13.1 21 2.6 Q21.7 1.6 22.8 1.2 24 0.8 25.1 1.2 26.3 1.6 26.9 2.6"/></svg>`;

function updateFavoriteButton() {
  const btn = document.getElementById('btn-favorite');
  if (!btn || !selectedGame) return;
  const isFav = !!library[selectedGame.identifier]?.is_favorite;
  btn.innerHTML = SVG_FAVORITE;
  if (isFav) btn.classList.add('is-favorite');
  else       btn.classList.remove('is-favorite');
}

function renderCollectionChips(identifier) {
  const container = document.getElementById('detail-collection-chips');
  if (!container) return;
  container.innerHTML = '';
  if (!identifier) return;
  const memberOf = collections.filter(c => c.games.includes(identifier));
  memberOf.forEach(c => {
    const chip = document.createElement('span');
    chip.className   = 'detail-collection-chip';
    chip.textContent = c.name;
    if (c.color) {
      chip.style.borderColor = c.color;
      chip.style.color       = c.color;
    }
    container.appendChild(chip);
  });
}

// ─── Notes ────────────────────────────────────────────────────────────────────
// ─── Add to Steam ──────────────────────────────────────────────────────────────────────────────

async function onAddToSteam() {
  if (!selectedGame) return;
  const lib = library[selectedGame.identifier];
  if (!lib?.install_dir) return;

  // Always find all exes and show the picker — even if there's only one,
  // so the user knows exactly which exe is being added to Steam.
  const exes = await window.electronAPI.findExes({ installDir: lib.install_dir });
  if (!exes.length) {
    alert('Cannot add to Steam: no executable found in the install folder.');
    return;
  }

  const picked = await showSteamExePicker(exes, lib.install_dir);
  if (!picked) return; // user cancelled

  const btn = document.getElementById('btn-add-to-steam');
  btn.disabled = true;
  btn.title = 'Adding to Steam…';

  try {
    // StartDir must be the folder containing the exe, not the root install dir
    const startDir = picked.substring(0, picked.lastIndexOf('\\'));
    const result = await window.electronAPI.addToSteam({
      appName:  getTitle(selectedGame),
      exePath:  picked,
      startDir: startDir,
    });

    if (!result.ok) {
      alert(`Failed to add to Steam:\n${result.error}`);
      btn.disabled = false;
      btn.title = 'Add to Steam library';
      return;
    }

    if (result.alreadyAdded) {
      btn.classList.add('steam-added');
      btn.title = '✓ Already in Steam';
      setTimeout(() => {
        btn.classList.remove('steam-added');
        btn.disabled = false;
        btn.title = 'Add to Steam library';
      }, 2500);
    } else {
      btn.classList.add('steam-added');
      btn.title = '✓ Added to Steam!';
      setTimeout(() => {
        alert('✓ Added to Steam!\n\nRestart Steam for the shortcut to appear under Non-Steam Games.');
        btn.classList.remove('steam-added');
        btn.disabled = false;
        btn.title = 'Add to Steam library';
      }, 400);
    }
  } catch (e) {
    alert('Error adding to Steam: ' + e.message);
    btn.disabled = false;
    btn.title = 'Add to Steam library';
  }
}

// Shows a modal listing all found executables so the user can choose
// which one gets added as the Steam shortcut. Returns the chosen path or null.
function showSteamExePicker(exePaths, installDir) {
  return new Promise((resolve) => {
    let selectedExe = null;

    const overlay = document.createElement('div');
    overlay.className = 'exe-picker-overlay';

    const modal = document.createElement('div');
    modal.className = 'exe-picker-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'exe-picker-header';
    header.innerHTML = `
      <h3>Add to Steam</h3>
      <p>Choose which executable Steam should launch for this game:</p>
    `;

    // Exe list
    const list = document.createElement('ul');
    list.className = 'exe-picker-list';

    // Detect collection layout (paths containing _GAME_)
    const isCollection = exePaths.some(p => p.includes('_GAME_'));

    if (isCollection) {
      // Group by _GAME_ subfolder, same as the launch picker
      const groups = {};
      exePaths.forEach(p => {
        const match = p.match(/_GAME_([^\\/]+)[\\/]/);
        const gameName = match ? match[1] : 'Unknown';
        if (!groups[gameName]) groups[gameName] = [];
        groups[gameName].push(p);
      });

      Object.entries(groups).forEach(([gameName, paths]) => {
        const groupHeader = document.createElement('li');
        groupHeader.className = 'exe-picker-group-header';
        groupHeader.textContent = gameName;
        list.appendChild(groupHeader);

        paths.forEach(p => {
          const gameMarker = '_GAME_' + gameName;
          const markerIdx  = p.indexOf(gameMarker);
          const rel = markerIdx !== -1
            ? p.slice(markerIdx + gameMarker.length).replace(/^[\\/]/, '')
            : p.split(/[\\/]/).pop();

          const li = document.createElement('li');
          li.className = 'exe-picker-game-item';
          li.textContent = rel;
          li.title = p;
          li.addEventListener('click', () => {
            list.querySelectorAll('li.exe-picker-game-item').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
            selectedExe = p;
            addBtn.disabled = false;
          });
          list.appendChild(li);
        });
      });
    } else {
      exePaths.forEach(p => {
        const rel = p.startsWith(installDir)
          ? p.slice(installDir.length).replace(/^[\\/]/, '')
          : p.split(/[\\/]/).pop();

        const li = document.createElement('li');
        li.textContent = rel;
        li.title = p;
        li.addEventListener('click', () => {
          list.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
          li.classList.add('selected');
          selectedExe = p;
          addBtn.disabled = false;
        });
        list.appendChild(li);

        // Auto-select if only one exe
        if (exePaths.length === 1) {
          li.classList.add('selected');
          selectedExe = p;
        }
      });
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'exe-picker-footer';

    const btnRow = document.createElement('div');
    btnRow.className = 'exe-picker-btn-row';

    const addBtn = document.createElement('button');
    addBtn.className   = 'exe-picker-launch';
    addBtn.textContent = 'Add to Steam';
    addBtn.disabled    = exePaths.length !== 1; // pre-enabled only when auto-selected
    addBtn.addEventListener('click', () => {
      if (!selectedExe) return;
      cleanup();
      resolve(selectedExe);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'exe-picker-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null); });

    btnRow.appendChild(addBtn);
    btnRow.appendChild(cancelBtn);
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
  gpModalFocusIdx = 0;
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
    // Color swatch — native color picker
    const colorInput = document.createElement('input');
    colorInput.type  = 'color';
    colorInput.className = 'collection-color-input';
    colorInput.value = c.color || '#888899';
    colorInput.title = 'Pick a colour for this collection';
    // Only mark as explicitly coloured once the user has interacted
    if (!c.color) colorInput.dataset.unset = 'true';
    colorInput.addEventListener('change', async () => {
      delete colorInput.dataset.unset;
      await window.electronAPI.setCollectionColor({ id: c.id, color: colorInput.value });
      collections = await window.electronAPI.getCollections();
      renderCollectionFilter();
      renderCollectionChips(selectedGame?.identifier || null);
    });

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
    li.appendChild(colorInput);
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
      renderCollectionChips(selectedGame?.identifier || null);
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
  gpFocus = 'sidebar-games';
  gpClearDetailHighlight();
  gpClearMenuHighlight();
  document.getElementById('home-view').classList.remove('hidden');
  document.getElementById('detail-panel').classList.add('hidden');
  document.getElementById('hero').style.display = 'none';
  document.getElementById('btn-home').classList.add('active');
  renderHomeScreen();
}

function showDetailView(game) {
  currentView = 'detail';
  // Reset detail focus index when switching games so it never goes out of bounds
  gpDetailFocusIdx = 0;
  gpClearDetailHighlight();
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

// ─── Gamepad / Controller Support ───────────────────────────────────────────
//
// Uses the standard Gamepad API (navigator.getGamepads()) polled via rAF.
// Button indices follow the W3C Standard Gamepad layout (Xbox / PS controllers).
//
// Button map:
//   0  = A / Cross        → Confirm / Launch / Select item
//   1  = B / Circle       → Back / Cancel / Go Home
//   2  = X / Square       → Install (Download)
//   3  = Y / Triangle     → Toggle Favourite
//   4  = LB / L1          → Previous detail tab
//   5  = RB / R1          → Next detail tab
//   8  = Select / Share   → Open Settings
//   9  = Start / Options  → Open Downloads modal
//   12 = D-pad Up         → Navigate sidebar up
//   13 = D-pad Down       → Navigate sidebar down
//   14 = D-pad Left       → (reserved)
//   15 = D-pad Right      → (reserved)
//   Axis 1 (Left stick Y) → Navigate sidebar (with auto-repeat)

const GP = {
  // Timing
  REPEAT_DELAY:    400,   // ms before auto-repeat starts
  REPEAT_INTERVAL: 120,   // ms between repeated nav steps
  STICK_DEADZONE:  0.35,  // ignore stick values below this

  // Mouse mode
  MOUSE_SPEED:   12,      // pixels per frame at full stick deflection
  mouseMode:     false,
  mouseX:        0,
  mouseY:        0,

  // State
  connected:     false,
  prevButtons:   {},      // buttonIndex → bool (was pressed last frame)
  repeatTimers:  {},      // buttonIndex → { started, last }
  rafId:         null,
  hintVisible:   false,
};

// Button index constants
const BTN_A      = 0;
const BTN_B      = 1;
const BTN_X      = 2;
const BTN_Y      = 3;
const BTN_LB     = 4;
const BTN_RB     = 5;
const BTN_SELECT = 8;
const BTN_START  = 9;
const BTN_L3     = 10; // Left stick click — toggles mouse mode
const BTN_UP     = 12;
const BTN_DOWN   = 13;
const BTN_LT     = 6;  // Left trigger  — sidebar: up to menu zone
const BTN_RT     = 7;  // Right trigger — sidebar: down to games zone
const BTN_LEFT   = 14; // D-pad left  — cycle detail buttons left / exit detail
const BTN_RIGHT  = 15; // D-pad right — cycle detail buttons right / enter detail

// Focus context
// 'sidebar-menu'  = top controls (search, sort, filters, bottom buttons)
// 'sidebar-games' = game list cards
// 'detail'        = action buttons on the detail panel
let gpFocus = 'sidebar-games';

// ── Sidebar menu zone ─────────────────────────────────────────────────────────
// All focusable items in sidebar-top, in order
function gpGetMenuItems() {
  return [
    document.getElementById('btn-home'),
    document.getElementById('search-input'),
    document.getElementById('sort-filter'),
    document.getElementById('btn-filter-all'),
    document.getElementById('btn-filter-favorites'),
    document.getElementById('collection-filter'),
    document.getElementById('btn-manage-collections'),
    document.getElementById('btn-downloads'),
    document.getElementById('btn-settings'),
    document.getElementById('btn-about'),
  ].filter(el => el && getComputedStyle(el).display !== 'none');
}

let gpMenuIdx = 0; // which sidebar menu item is focused

// ── Detail panel action buttons ───────────────────────────────────────────────
function gpGetDetailButtons() {
  const candidates = [
    document.getElementById('btn-launch'),
    document.getElementById('btn-download'),
    document.getElementById('btn-delete'),
    document.getElementById('btn-favorite'),
    document.getElementById('btn-add-to-collection'),
    document.getElementById('btn-open-location'),
  ];
  return candidates.filter(b => {
    if (!b) return false;
    if (b.disabled) return false;
    if (b.classList.contains('hidden')) return false;
    if (getComputedStyle(b).display === 'none') return false;
    return true;
  });
}

let gpDetailFocusIdx = 0;

// ── Generic modal focusable items ─────────────────────────────────────────────
function gpGetModalFocusables(modalEl) {
  // Query only true interactive elements — checkboxes inside .add-coll-item
  // and .collection-item rows are included directly; the container rows themselves
  // are excluded so we never highlight the whole label box.
  return [...modalEl.querySelectorAll(
    'button:not(:disabled):not(.hidden), ' +
    'input[type="checkbox"]:not(:disabled), ' +
    'input[type="text"]:not(:disabled), ' +
    'input[type="color"]:not(:disabled), ' +
    'select:not(:disabled), ' +
    'textarea:not(:disabled)'
  )].filter(el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  });
}

let gpModalFocusIdx = 0;

function gpInit() {
  window.addEventListener('gamepadconnected', (e) => {
    console.log('[gamepad] connected:', e.gamepad.id);
    GP.connected = true;
    gpShowHint(true);
    if (!GP.rafId) GP.rafId = requestAnimationFrame(gpPoll);
  });
  window.addEventListener('gamepaddisconnected', () => {
    console.log('[gamepad] disconnected');
    GP.connected = false;
    GP.prevButtons = {};
    GP.repeatTimers = {};
    gpShowHint(false);
  });
}

function gpShowHint(visible) {
  GP.hintVisible = visible;
  const bar = document.getElementById('gamepad-hint-bar');
  if (!bar) return;
  if (visible) {
    bar.classList.remove('hidden');
    gpUpdateHint();
  } else {
    bar.classList.add('hidden');
  }
}

function gpUpdateHint() {
  const bar = document.getElementById('gamepad-hint-bar');
  if (!bar || !GP.hintVisible) return;

  // Pick hints based on current context
  const anyModal = document.querySelector(
    '.exe-picker-overlay, #downloads-modal:not(.hidden), #settings-modal:not(.hidden), ' +
    '#about-modal:not(.hidden), #collections-modal:not(.hidden), #add-collection-modal:not(.hidden)'
  );

  let hints = [];
  if (GP.mouseMode) {
    hints = [
      { btn: 'LS', label: 'Move cursor' },
      { btn: 'A',  label: 'Click' },
      { btn: 'B',  label: 'Exit mouse mode' },
    ];
  } else if (anyModal) {
    hints = [
      { btn: 'A', label: 'Confirm' },
      { btn: 'B', label: 'Cancel / Close' },
      { btn: '↕', label: 'Navigate' },
    ];
  } else if (gpFocus === 'sidebar-menu') {
    hints = [
      { btn: '↕',  label: 'Navigate' },
      { btn: 'A',  label: 'Select / Type' },
      { btn: 'RT', label: 'Game list' },
      { btn: 'B',  label: 'Back' },
    ];
  } else if (currentView === 'detail') {
    const lib = selectedGame ? library[selectedGame.identifier] : null;
    const installed = !!lib?.install_dir;
    if (gpFocus === 'detail') {
      hints = [
        { btn: 'A',     label: 'Select' },
        { btn: '↔',     label: 'Move' },
        { btn: 'B',     label: 'Back' },
        { btn: 'LB RB', label: 'Tabs' },
      ];
    } else {
      hints = [
        { btn: '↕',     label: 'Browse' },
        { btn: '→',     label: 'Actions' },
        installed ? { btn: 'A', label: 'Launch' } : { btn: 'X', label: 'Install' },
        { btn: 'B',     label: 'Home' },
        { btn: 'LB RB', label: 'Tabs' },
      ];
    }
  } else {
    hints = [
      { btn: 'LT',  label: 'Menu' },
      { btn: '↕',   label: 'Browse' },
      { btn: 'A',   label: 'Select' },
    ];
  }

  bar.innerHTML = hints.map(h =>
    `<span class="gp-hint"><span class="gp-btn">${h.btn}</span>${h.label}</span>`
  ).join('');
}

function gpPoll(timestamp) {
  if (!GP.connected) return;
  GP.rafId = requestAnimationFrame(gpPoll);

  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...gamepads].find(g => g && g.connected);
  if (!gp) return;

  // ── Process buttons ────────────────────────────────────────────────────────
  gp.buttons.forEach((btn, idx) => {
    const pressed = btn.pressed;
    const wasPrev = !!GP.prevButtons[idx];

    if (pressed && !wasPrev) {
      // Fresh press
      GP.repeatTimers[idx] = { started: timestamp, last: timestamp };
      gpHandleButton(idx, true);
    } else if (pressed && wasPrev) {
      // Auto-repeat for navigation buttons only
      if (idx === BTN_UP || idx === BTN_DOWN) {
        const t = GP.repeatTimers[idx];
        if (t) {
          const sinceStart = timestamp - t.started;
          const sinceLast  = timestamp - t.last;
          if (sinceStart > GP.REPEAT_DELAY && sinceLast > GP.REPEAT_INTERVAL) {
            t.last = timestamp;
            gpHandleButton(idx, false); // false = repeat, not fresh
          }
        }
      }
    } else if (!pressed && wasPrev) {
      // Released
      delete GP.repeatTimers[idx];
    }

    GP.prevButtons[idx] = pressed;
  });

  // ── Mouse mode: left stick (axes 0,1) moves cursor ────────────────────────
  if (GP.mouseMode) {
    const lsX = gp.axes[0] || 0;
    const lsY = gp.axes[1] || 0;
    if (Math.abs(lsX) > GP.STICK_DEADZONE || Math.abs(lsY) > GP.STICK_DEADZONE) {
      // Apply deadzone scaling so movement is proportional to stick deflection
      const scaleX = Math.sign(lsX) * Math.max(0, Math.abs(lsX) - GP.STICK_DEADZONE) / (1 - GP.STICK_DEADZONE);
      const scaleY = Math.sign(lsY) * Math.max(0, Math.abs(lsY) - GP.STICK_DEADZONE) / (1 - GP.STICK_DEADZONE);
      GP.mouseX = Math.max(0, Math.min(window.innerWidth,  GP.mouseX + scaleX * GP.MOUSE_SPEED));
      GP.mouseY = Math.max(0, Math.min(window.innerHeight, GP.mouseY + scaleY * GP.MOUSE_SPEED));
      gpMoveCursor(GP.mouseX, GP.mouseY);
    }
    return; // skip stick-nav when in mouse mode
  }

  // ── Left stick Y axis → up/down navigation ─────────────────────────────────
  const axisY    = gp.axes[1] || 0;
  const stickIdx = 100;
  if (Math.abs(axisY) > GP.STICK_DEADZONE) {
    const dir = axisY > 0 ? BTN_DOWN : BTN_UP;
    const t = GP.repeatTimers[stickIdx];
    if (!t) {
      GP.repeatTimers[stickIdx] = { started: timestamp, last: timestamp };
      gpHandleButton(dir, true);
    } else {
      const sinceStart = timestamp - t.started;
      const sinceLast  = timestamp - t.last;
      if (sinceStart > GP.REPEAT_DELAY && sinceLast > GP.REPEAT_INTERVAL) {
        t.last = timestamp;
        gpHandleButton(dir, false);
      }
    }
  } else {
    delete GP.repeatTimers[stickIdx];
  }

  // ── Left stick X axis → cycle detail buttons or enter/exit detail focus ───
  const axisX     = gp.axes[0] || 0;
  const stickXIdx = 101;
  if (Math.abs(axisX) > GP.STICK_DEADZONE) {
    const dir = axisX > 0 ? BTN_RIGHT : BTN_LEFT;
    const t = GP.repeatTimers[stickXIdx];
    if (!t) {
      GP.repeatTimers[stickXIdx] = { started: timestamp, last: timestamp };
      gpHandleButton(dir, true);
    } else {
      const sinceStart = timestamp - t.started;
      const sinceLast  = timestamp - t.last;
      if (sinceStart > GP.REPEAT_DELAY && sinceLast > GP.REPEAT_INTERVAL * 2) {
        t.last = timestamp;
        gpHandleButton(dir, true);
      }
    }
  } else {
    delete GP.repeatTimers[stickXIdx];
  }

  // ── LT (btn 6) = focus sidebar | RT (btn 7) = focus detail panel ────────
  // On Xbox/standard controllers, LT = button index 6, RT = button index 7.
  // These are already handled in the button loop above via gpHandleButton,
  // but we need specific constants for them to route to panel switching.
  // BTN_LT and BTN_RT are handled in the button loop as fresh presses.
}

function gpHandleButton(idx, isFresh) {
  // Only act on fresh presses for non-nav buttons
  if (!isFresh && idx !== BTN_UP && idx !== BTN_DOWN && idx !== BTN_LEFT && idx !== BTN_RIGHT) return;

  // ── OSK intercept ────────────────────────────────────────────────────────────────
  if (gpHandleOSK(idx, isFresh)) return;

  // ── Mouse mode intercept ──────────────────────────────────────────────────
  if (GP.mouseMode && isFresh) {
    if (idx === BTN_A) {
      gpMouseClick(GP.mouseX, GP.mouseY);
      return;
    }
    if (idx === BTN_B) {
      gpToggleMouseMode(); // B exits mouse mode
      return;
    }
    if (idx === BTN_L3) {
      gpToggleMouseMode(); // L3 also toggles off
      return;
    }
    // All other buttons passthrough while in mouse mode
    return;
  }

  // ── Modal context ──────────────────────────────────────────────────────────
  // exe/archive picker overlay
  const exeOverlay = document.querySelector('.exe-picker-overlay');
  if (exeOverlay) {
    if (isFresh) gpHandleModal_ExePicker(idx, exeOverlay);
    return;
  }

  // Generic modal handler — handles downloads, settings, collections, add-collection
  const openModal = [
    { el: document.getElementById('downloads-modal'),       close: closeDownloadsModal },
    { el: document.getElementById('settings-modal'),        close: closeSettings },
    { el: document.getElementById('about-modal'),           close: closeAbout },
    { el: document.getElementById('collections-modal'),     close: closeCollectionsModal },
    { el: document.getElementById('add-collection-modal'), close: closeAddCollectionModal },
  ].find(m => m.el && !m.el.classList.contains('hidden'));

  if (openModal) {
    if (!isFresh && idx !== BTN_UP && idx !== BTN_DOWN && idx !== BTN_LEFT && idx !== BTN_RIGHT) return;
    const focusables = gpGetModalFocusables(openModal.el);
    const len = Math.max(focusables.length, 1);

    switch (idx) {
      case BTN_UP:
      case BTN_LEFT:
        gpModalFocusIdx = (gpModalFocusIdx - 1 + len) % len;
        gpHighlightModalItem(focusables);
        break;
      case BTN_DOWN:
      case BTN_RIGHT:
        gpModalFocusIdx = (gpModalFocusIdx + 1) % len;
        gpHighlightModalItem(focusables);
        break;
      case BTN_A: {
        if (!isFresh) break;
        const item = focusables[gpModalFocusIdx];
        if (!item) break;
        if (item.tagName === 'INPUT' && item.type === 'checkbox') {
          item.click();
        } else if (item.tagName === 'INPUT' && item.type !== 'checkbox') {
          gpOpenOSK(item);
        } else if (item.tagName === 'TEXTAREA') {
          gpOpenOSK(item);
        } else if (item.tagName === 'SELECT') {
          item.selectedIndex = (item.selectedIndex + 1) % item.options.length;
          item.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          item.click();
        }
        break;
      }
      case BTN_B:
        if (isFresh) openModal.close();
        break;
    }
    return;
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  switch (idx) {

    // ── LT / RT: toggle between sidebar menu zone and games zone ──────────
    case BTN_LT:
      if (isFresh) {
        if (gpFocus === 'sidebar-games') {
          // Move up to menu
          gpClearDetailHighlight();
          gpClearMenuHighlight();
          gpFocus = 'sidebar-menu';
          gpMenuIdx = 0;
          gpHighlightMenuItem();
        } else if (gpFocus === 'sidebar-menu') {
          // Move down to games
          gpClearMenuHighlight();
          gpFocus = 'sidebar-games';
        }
        gpUpdateHint();
      }
      break;

    case BTN_RT:
      if (isFresh) {
        if (gpFocus === 'sidebar-games') {
          // Move up to menu
          gpClearDetailHighlight();
          gpClearMenuHighlight();
          gpFocus = 'sidebar-menu';
          gpMenuIdx = 0;
          gpHighlightMenuItem();
        } else if (gpFocus === 'sidebar-menu') {
          // Move down to games
          gpClearMenuHighlight();
          gpFocus = 'sidebar-games';
        }
        gpUpdateHint();
      }
      break;

    // ── Up/Down: navigate current zone ─────────────────────────────
    case BTN_UP:
    case BTN_DOWN: {
      const navDir = idx === BTN_DOWN ? 1 : -1;
      if (gpFocus === 'sidebar-menu') {
        gpNavigateMenu(navDir);
      } else {
        gpNavigateSidebar(navDir);
      }
      break;
    }

    // ── Left/Right: navigate menu zone OR cycle detail buttons ──────────
    case BTN_RIGHT:
      if (isFresh) {
        if (gpFocus === 'sidebar-menu') {
          gpNavigateMenu(1);
        } else if (gpFocus === 'detail') {
          gpNavigateDetailButtons(1);
        } else if (currentView === 'detail') {
          // Enter detail focus from sidebar-games
          gpClearMenuHighlight();
          gpFocus = 'detail';
          gpDetailFocusIdx = 0;
          gpHighlightDetailButton();
        }
      }
      break;

    case BTN_LEFT:
      if (isFresh) {
        if (gpFocus === 'sidebar-menu') {
          gpNavigateMenu(-1);
        } else if (gpFocus === 'detail') {
          if (gpDetailFocusIdx > 0) {
            gpNavigateDetailButtons(-1);
          } else {
            gpFocus = 'sidebar-games';
            gpClearDetailHighlight();
          }
        }
      }
      break;

    // ── A: confirm ──────────────────────────────────────────────────
    case BTN_A:
      if (isFresh) {
        if (gpFocus === 'detail' && currentView === 'detail') {
          const btns = gpGetDetailButtons();
          btns[gpDetailFocusIdx]?.click();
        } else if (gpFocus === 'sidebar-menu') {
          const items = gpGetMenuItems();
          const item = items[gpMenuIdx];
          if (!item) break;
          // Text inputs — open on-screen keyboard
          if (item.tagName === 'INPUT' && item.type !== 'checkbox') {
            gpOpenOSK(item);
          } else if (item.tagName === 'SELECT') {
            // Cycle through select options
            item.selectedIndex = (item.selectedIndex + 1) % item.options.length;
            item.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            item.click();
          }
        } else if (currentView === 'detail') {
          const lib = selectedGame ? library[selectedGame.identifier] : null;
          if (lib?.install_dir) onLaunch();
          else if (!btnDownload.disabled) onDownload();
        } else if (currentView === 'home') {
          const first = libraryGrid.querySelector('.game-card');
          if (first) first.click();
        }
      }
      break;

    // ── B: back / go home ──────────────────────────────────────────
    case BTN_B:
      if (isFresh) {
        if (gpFocus === 'detail') {
          gpFocus = 'sidebar-games';
          gpClearDetailHighlight();
        } else if (gpFocus === 'sidebar-menu') {
          gpClearMenuHighlight();
          gpFocus = 'sidebar-games';
        } else if (currentView === 'detail') {
          showHomeView();
        }
      }
      break;

    // ── X: install ─────────────────────────────────────────────────
    case BTN_X:
      if (isFresh && currentView === 'detail' && !btnDownload.disabled) onDownload();
      break;

    // ── Y: favourite ────────────────────────────────────────────────
    case BTN_Y:
      if (isFresh && currentView === 'detail') onToggleFavorite();
      break;

    // ── LB/RB: cycle tabs ─────────────────────────────────────────────
    case BTN_LB:
      if (isFresh && currentView === 'detail') gpCycleTab(-1);
      break;

    case BTN_RB:
      if (isFresh && currentView === 'detail') gpCycleTab(1);
      break;

    case BTN_SELECT:
      if (isFresh) openSettings();
      break;

    case BTN_L3:
      if (isFresh) gpToggleMouseMode();
      break;

    case BTN_START:
      if (isFresh) openDownloadsModal();
      break;
  }

  gpUpdateHint();
}

// ── Sidebar menu zone helpers ────────────────────────────────────────────────
function gpHighlightMenuItem() {
  gpClearMenuHighlight();
  const items = gpGetMenuItems();
  if (!items.length) return;
  gpMenuIdx = Math.min(gpMenuIdx, items.length - 1);
  items[gpMenuIdx]?.classList.add('gp-focused');
}

function gpClearMenuHighlight() {
  // Only remove from sidebar menu items, not detail buttons
  gpGetMenuItems().forEach(el => el.classList.remove('gp-focused'));
}

function gpNavigateMenu(dir) {
  const items = gpGetMenuItems();
  if (!items.length) return;
  gpMenuIdx = (gpMenuIdx + dir + items.length) % items.length;
  gpHighlightMenuItem();
}

// ── On-Screen Keyboard (OSK) ────────────────────────────────────────────────────────────────
const OSK_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0','-'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m',',','.'],
  ['SHIFT', 'SPACE', 'BKSP', 'DONE'],
];

let oskTargetInput = null;  // the input element the OSK is typing into
let oskShift      = false;
let oskRow        = 0;
let oskCol        = 0;
let oskActive     = false;

function gpOpenOSK(inputEl) {
  if (document.getElementById('gp-osk')) return; // already open
  oskTargetInput = inputEl;
  oskShift       = false;
  oskRow         = 0;
  oskCol         = 0;
  oskActive      = true;

  const overlay = document.createElement('div');
  overlay.id = 'gp-osk';

  const label = document.createElement('div');
  label.id = 'gp-osk-label';
  label.textContent = inputEl.placeholder || 'Enter text';
  overlay.appendChild(label);

  const preview = document.createElement('div');
  preview.id = 'gp-osk-preview';
  preview.textContent = inputEl.value || '';
  overlay.appendChild(preview);

  const keyboard = document.createElement('div');
  keyboard.id = 'gp-osk-keyboard';
  overlay.appendChild(keyboard);

  document.body.appendChild(overlay);
  oskRenderKeys();
}

function gpCloseOSK() {
  document.getElementById('gp-osk')?.remove();
  oskActive      = false;
  oskTargetInput = null;
}

function oskRenderKeys() {
  const keyboard = document.getElementById('gp-osk-keyboard');
  if (!keyboard) return;
  keyboard.innerHTML = '';

  OSK_ROWS.forEach((row, r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'osk-row';
    row.forEach((key, c) => {
      const btn = document.createElement('button');
      btn.className = 'osk-key';
      if (key === 'SHIFT') btn.className += oskShift ? ' osk-key-wide osk-shifted' : ' osk-key-wide';
      else if (key === 'SPACE') btn.className += ' osk-key-space';
      else if (key === 'BKSP') btn.className += ' osk-key-wide';
      else if (key === 'DONE') btn.className += ' osk-key-wide osk-key-done';

      if (r === oskRow && c === oskCol) btn.classList.add('osk-active');

      btn.textContent = key === 'SPACE' ? '␣ Space' :
                        key === 'BKSP'  ? '⌫' :
                        key === 'DONE'  ? '✓ Done' :
                        key === 'SHIFT' ? (oskShift ? '⇧ SHIFT' : '⇧ shift') :
                        oskShift ? key.toUpperCase() : key;

      btn.addEventListener('click', () => oskHandleKey(key));
      rowEl.appendChild(btn);
    });
    keyboard.appendChild(rowEl);
  });
}

function oskHandleKey(key) {
  if (!oskTargetInput) return;

  if (key === 'DONE') {
    // Commit and close
    oskTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
    oskTargetInput.dispatchEvent(new Event('change', { bubbles: true }));
    gpCloseOSK();
    return;
  }

  if (key === 'BKSP') {
    oskTargetInput.value = oskTargetInput.value.slice(0, -1);
  } else if (key === 'SHIFT') {
    oskShift = !oskShift;
    oskRenderKeys();
    return;
  } else if (key === 'SPACE') {
    oskTargetInput.value += ' ';
  } else {
    oskTargetInput.value += oskShift ? key.toUpperCase() : key;
    if (oskShift) { oskShift = false; } // auto un-shift after one char
  }

  // Update preview
  const preview = document.getElementById('gp-osk-preview');
  if (preview) preview.textContent = oskTargetInput.value || '';

  oskRenderKeys();
  // Fire input event so search/filter updates in real time
  oskTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function oskNavigate(dr, dc) {
  const maxRow = OSK_ROWS.length - 1;
  oskRow = Math.max(0, Math.min(maxRow, oskRow + dr));
  const maxCol = OSK_ROWS[oskRow].length - 1;
  oskCol = Math.max(0, Math.min(maxCol, oskCol + dc));
  oskRenderKeys();
}

// Intercept gamepad input when OSK is open
function gpHandleOSK(idx, isFresh) {
  if (!isFresh && idx !== BTN_UP && idx !== BTN_DOWN && idx !== BTN_LEFT && idx !== BTN_RIGHT) return false;
  if (!oskActive || !document.getElementById('gp-osk')) return false;

  switch (idx) {
    case BTN_UP:    oskNavigate(-1, 0); break;
    case BTN_DOWN:  oskNavigate(1, 0);  break;
    case BTN_LEFT:  oskNavigate(0, -1); break;
    case BTN_RIGHT: oskNavigate(0, 1);  break;
    case BTN_A:
      if (isFresh) {
        const row = OSK_ROWS[oskRow];
        if (row) oskHandleKey(row[oskCol]);
      }
      break;
    case BTN_B:
      if (isFresh) {
        // B = backspace
        oskHandleKey('BKSP');
      }
      break;
    case BTN_Y:
      if (isFresh) oskHandleKey('SHIFT');
      break;
    case BTN_X:
      if (isFresh) oskHandleKey('SPACE');
      break;
    case BTN_START:
      if (isFresh) oskHandleKey('DONE');
      break;
  }
  return true; // consumed by OSK
}

function gpHighlightModalItem(focusables) {
  // Clear highlights from all focusables and their parent rows
  focusables.forEach(el => {
    el.classList.remove('gp-focused');
    el.closest('.add-coll-item, .collection-item')?.classList.remove('gp-row-focused');
  });
  // Also sweep any stale row highlights not covered above
  document.querySelectorAll('.gp-row-focused').forEach(el => el.classList.remove('gp-row-focused'));

  if (!focusables.length) return;
  gpModalFocusIdx = Math.min(gpModalFocusIdx, focusables.length - 1);
  const target = focusables[gpModalFocusIdx];
  if (!target) return;

  target.classList.add('gp-focused');
  // If the focused element is inside a collection row, highlight the row too
  // so the user can see which collection they're on — but only the checkbox gets the ring
  target.closest('.add-coll-item, .collection-item')?.classList.add('gp-row-focused');
  target.scrollIntoView({ block: 'nearest' });
}

// Highlight/unhighlight the currently focused detail button
function gpHighlightDetailButton() {
  gpClearDetailHighlight();
  const btns = gpGetDetailButtons();
  if (!btns.length) return;
  gpDetailFocusIdx = Math.min(gpDetailFocusIdx, btns.length - 1);
  btns[gpDetailFocusIdx]?.classList.add('gp-focused');
}

function gpClearDetailHighlight() {
  document.querySelectorAll('.gp-focused').forEach(el => el.classList.remove('gp-focused'));
}

function gpNavigateDetailButtons(dir) {
  const btns = gpGetDetailButtons();
  if (!btns.length) return;
  gpDetailFocusIdx = (gpDetailFocusIdx + dir + btns.length) % btns.length;
  gpHighlightDetailButton();
}

// ── Mouse Mode ────────────────────────────────────────────────────────────────
function gpToggleMouseMode() {
  GP.mouseMode = !GP.mouseMode;

  if (GP.mouseMode) {
    // Centre cursor on screen when entering mouse mode
    GP.mouseX = window.innerWidth  / 2;
    GP.mouseY = window.innerHeight / 2;
    gpCreateCursor();
    gpMoveCursor(GP.mouseX, GP.mouseY);
    document.body.classList.add('gp-mouse-mode');
  } else {
    gpDestroyCursor();
    document.body.classList.remove('gp-mouse-mode');
  }
  gpUpdateHint();
}

function gpCreateCursor() {
  if (document.getElementById('gp-cursor')) return;
  const el = document.createElement('div');
  el.id = 'gp-cursor';
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 0 L4 17 L8 13 L11 20 L13 19 L10 12 L15 12 Z"/>
    </svg>
  `;
  document.body.appendChild(el);
}

function gpDestroyCursor() {
  document.getElementById('gp-cursor')?.remove();
}

function gpMoveCursor(x, y) {
  const el = document.getElementById('gp-cursor');
  if (!el) return;
  el.style.transform = `translate(${x}px, ${y}px)`;
}

function gpMouseClick(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return;
  // Simulate a real mouse click so all event listeners fire
  el.dispatchEvent(new MouseEvent('click', {
    bubbles:    true,
    cancelable: true,
    clientX:    x,
    clientY:    y,
    view:       window,
  }));
}

function gpNavigateSidebar(dir) {
  // dir: +1 = down, -1 = up
  const cards = [...libraryGrid.querySelectorAll('.game-card')];
  if (!cards.length) return;

  const currentIdx = cards.findIndex(c => c.classList.contains('selected'));
  let nextIdx;

  if (currentIdx === -1) {
    nextIdx = dir > 0 ? 0 : cards.length - 1;
  } else if (dir > 0) {
    nextIdx = currentIdx < cards.length - 1 ? currentIdx + 1 : 0;
  } else {
    nextIdx = currentIdx > 0 ? currentIdx - 1 : cards.length - 1;
  }

  const sorted = getSortedGames(allGames);
  const targetGame = sorted[nextIdx];
  if (targetGame) {
    showDetailView(targetGame);
    // Query the card AFTER showDetailView re-renders the grid
    // so we have a live DOM reference, not a stale one
    const freshCards = [...libraryGrid.querySelectorAll('.game-card')];
    gpScrollCardIntoView(freshCards[nextIdx]);
  }
  gpUpdateHint();
}

// Scrolls a card into view within the #library-grid scroll container.
// Uses getBoundingClientRect() for reliable relative positioning regardless
// of CSS positioning on parent elements.
function gpScrollCardIntoView(card) {
  if (!card) return;
  const grid    = libraryGrid;
  const padding = 8;

  const gridRect = grid.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  // Position of card top/bottom relative to the visible grid area
  const relTop = cardRect.top - gridRect.top;
  const relBot = cardRect.bottom - gridRect.top;

  if (relTop < padding) {
    // Card is above the visible area — scroll up
    grid.scrollTop += relTop - padding;
  } else if (relBot > grid.clientHeight - padding) {
    // Card is below the visible area — scroll down
    grid.scrollTop += relBot - grid.clientHeight + padding;
  }
}

function gpCycleTab(dir) {
  // dir: +1 = next, -1 = previous
  const tabs = [...document.querySelectorAll('.tab-btn')];
  if (!tabs.length) return;
  const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
  let nextIdx = activeIdx + dir;
  if (nextIdx < 0) nextIdx = tabs.length - 1;
  if (nextIdx >= tabs.length) nextIdx = 0;
  tabs[nextIdx]?.click();
}

function gpHandleModal_ExePicker(idx, overlay) {
  const list     = overlay.querySelector('.exe-picker-list');
  const items    = list ? [...list.querySelectorAll('li:not(.exe-picker-group-header)')] : [];
  const selected = items.findIndex(li => li.classList.contains('selected'));

  switch (idx) {
    case BTN_UP:
    case BTN_DOWN: {
      if (!items.length) return;
      let next;
      if (idx === BTN_UP) {
        next = selected > 0 ? selected - 1 : items.length - 1;
      } else {
        next = selected < items.length - 1 ? selected + 1 : 0;
      }
      items[next]?.click();
      items[next]?.scrollIntoView({ block: 'nearest' });
      break;
    }
    case BTN_A: {
      // Click the launch/confirm button
      const confirmBtn = overlay.querySelector('.exe-picker-launch');
      if (confirmBtn && !confirmBtn.disabled) confirmBtn.click();
      break;
    }
    case BTN_B: {
      const cancelBtn = overlay.querySelector('.exe-picker-cancel');
      if (cancelBtn) cancelBtn.click();
      break;
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();
  gpInit();
});
