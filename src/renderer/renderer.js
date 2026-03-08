const { ipcRenderer } = require('electron');

let allGames = [];
let selectedGame = null;

document.getElementById('btn-minimize').addEventListener('click', () => ipcRenderer.send('minimize-window'));
document.getElementById('btn-maximize').addEventListener('click', () => ipcRenderer.send('maximize-window'));
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.send('close-window'));

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

document.getElementById('search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderGameList(allGames.filter(g => g.title && g.title.toLowerCase().includes(q)));
});

async function loadGames() {
  console.log('Requesting games...');
  const games = await ipcRenderer.invoke('fetch-games');
  console.log('Received games:', games.length);
  allGames = games.filter(g => g.title);
  allGames.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  console.log('Rendering', allGames.length, 'games');
  renderGameList(allGames);
}

function renderGameList(games) {
  console.log('renderGameList called with', games.length, 'games');
  const list = document.getElementById('game-list');
  if (!list) { console.error('game-list element not found'); return; }
  if (!games.length) {
    list.innerHTML = '<div class="loading-msg">No games found.</div>';
    return;
  }
  list.innerHTML = games.map(g => `
    <div class="game-item" data-id="${g.identifier}">
      <div class="game-thumb-placeholder">🎮</div>
      <div class="game-item-info">
        <div class="game-item-title">${g.title}</div>
        <div class="game-item-year">${g.year || 'Unknown Year'}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.game-item').forEach(item => {
    item.addEventListener('click', () => selectGame(item.dataset.id));
  });

  games.forEach(g => loadThumbnail(g.identifier));
}

function loadThumbnail(identifier) {
  const img = new Image();
  img.className = 'game-thumb';
  img.src = 'https://archive.org/services/img/' + identifier;
  img.alt = '';
  img.onload = () => {
    const placeholder = document.querySelector('.game-item[data-id="' + identifier + '"] .game-thumb-placeholder');
    if (placeholder) placeholder.replaceWith(img);
  };
}

async function selectGame(identifier) {
  selectedGame = allGames.find(g => g.identifier === identifier);
  if (!selectedGame) return;

  document.querySelectorAll('.game-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === identifier);
  });

  document.getElementById('hero-title').textContent = selectedGame.title;
  document.getElementById('hero-meta').textContent =
    [selectedGame.year, formatSize(selectedGame.item_size)].filter(Boolean).join('  •  ');

  const heroImg = document.getElementById('hero-img');
  heroImg.src = 'https://archive.org/services/img/' + identifier;
  heroImg.onerror = () => { heroImg.src = ''; };

  document.getElementById('detail-title').textContent = selectedGame.title;
  document.getElementById('detail-year').innerHTML = '<span>Year</span> ' + (selectedGame.year || '—');
  document.getElementById('detail-size').innerHTML = '<span>Size</span> ' + (formatSize(selectedGame.item_size) || '—');
  document.getElementById('detail-downloads').innerHTML = '<span>Downloads</span> ' + (selectedGame.downloads ? selectedGame.downloads.toLocaleString() : '—');
  document.getElementById('detail-desc').textContent =
    selectedGame.description ? stripHtml(selectedGame.description).slice(0, 400) : 'No description available.';

  const cover = document.getElementById('detail-cover');
  cover.src = 'https://archive.org/services/img/' + identifier;
  cover.onerror = () => { cover.src = ''; };

  document.getElementById('btn-download').disabled = false;

  document.getElementById('welcome-msg').style.display = 'none';
  document.getElementById('content-area').innerHTML =
    '<p style="color:var(--text-dim);font-size:12px;line-height:1.7;">' +
    (selectedGame.description ? stripHtml(selectedGame.description) : 'No additional information available.') +
    '</p>';
}

function formatSize(bytes) {
  if (!bytes) return null;
  const gb = bytes / 1e9;
  if (gb >= 1) return gb.toFixed(1) + ' GB';
  return (bytes / 1e6).toFixed(0) + ' MB';
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

loadGames();
