const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
let db;
let win;

const DB_NAME = 'airdrop.db';

function dbPath() {
  return path.join(app.getPath('userData'), DB_NAME);
}

function openDb() {
  db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

const DEFAULT_CATEGORIES = ['Testnet', 'Mainnet', 'Retrodrop', 'Node', 'DeFi', 'Social', 'Waitlist', 'AI', 'Telegram Bot', 'Daily Checkin', 'Memecoin', 'NFT'];
const DEFAULT_NETWORKS = ['Ethereum', 'Solana', 'Arbitrum', 'Optimism', 'Base', 'BSC', 'Polygon', 'Avalanche', 'Sui', 'Aptos', 'Bitcoin', 'Cosmos'];
const DEFAULT_RANKS = ['S', 'A', 'B', 'C', 'D'];
const DEFAULT_STATUSES = ['Ongoing', 'TGE', 'Completed', 'Eligible', 'Ineligible'];
const DEFAULT_PLATFORMS = ['X', 'Desktop', 'App', 'Extension'];
const DEFAULT_WALLET_APPS = ['MetaMask', 'OKX Wallet', 'Phantom', 'Rabby', 'Keplr', 'Binance'];

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
}

// Accepts "username", "@username", "https://x.com/username",
// "https://twitter.com/username?x=1", and double-pasted mangled variants
// like "https://x.com/https://x.com/AaronnoShuvo" -> "AaronnoShuvo".
function parseXUsername(v) {
  let s = (v || '').toString().trim();
  if (!s) return '';
  s = s.split(/[?#]/)[0];
  s = s.replace(/\/+$/, '');
  s = s.replace(/^[@:\s]+/, '');
  // take the LAST domain/username segment so doubled-pasted links resolve to the real handle
  const hits = s.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})/gi);
  if (hits && hits.length) {
    const m = hits[hits.length - 1].match(/\/([A-Za-z0-9_]{1,15})$/);
    if (m) return m[1];
  }
  // bare handle
  s = s.replace(/^.*\//, '');
  s = s.replace(/^[@:]+/, '');
  s = s.replace(/[^A-Za-z0-9_]/g, '');
  return s.slice(0, 15);
}

function parseCats(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [String(raw)];
  } catch { return [String(raw)]; }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      website TEXT DEFAULT '',
      x_account TEXT DEFAULT '',
      category TEXT DEFAULT '',
      network TEXT DEFAULT '',
      note TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      done INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      rank TEXT DEFAULT '',
      cost TEXT DEFAULT '',
      chains TEXT DEFAULT '[]',
      status TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      wallet_app TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      label TEXT DEFAULT '',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      label TEXT DEFAULT '',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS x_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      deadline TEXT DEFAULT '',
      done INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // additive migrations for existing installs
  if (!hasColumn('projects', 'icon')) db.exec('ALTER TABLE projects ADD COLUMN icon TEXT DEFAULT ""');
  if (!hasColumn('tasks', 'deadline')) db.exec('ALTER TABLE tasks ADD COLUMN deadline TEXT DEFAULT ""');
  if (!hasColumn('tasks', 'url')) db.exec('ALTER TABLE tasks ADD COLUMN url TEXT DEFAULT ""');
  for (const col of ['rank', 'cost', 'chains', 'status', 'platform', 'wallet_app']) {
    if (!hasColumn('projects', col)) db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT DEFAULT ""`);
  }
  // category single string -> JSON array
  db.exec(`UPDATE projects SET category = '[]' WHERE category IS NULL OR category = ''`);
  db.exec(`UPDATE projects SET category = '[' || category || ']' WHERE category <> '[]' AND json_valid(category) = 0`);
  // seed lists (new defaults without "Other")
  const has = (k) => db.prepare('SELECT 1 FROM config WHERE key = ?').get(k);
  const ins = db.prepare('INSERT INTO config(key, value) VALUES(?, ?)');
  if (!has('categories')) ins.run('categories', JSON.stringify(DEFAULT_CATEGORIES));
  if (!has('networks')) ins.run('networks', JSON.stringify(DEFAULT_NETWORKS));
  if (!has('walletLabels')) ins.run('walletLabels', JSON.stringify(['MetaMask', 'Phantom', 'Rabby', 'Keplr', 'OKX', 'Binance']));
  if (!has('ranks')) ins.run('ranks', JSON.stringify(DEFAULT_RANKS));
  if (!has('statuses')) ins.run('statuses', JSON.stringify(DEFAULT_STATUSES));
  if (!has('platforms')) ins.run('platforms', JSON.stringify(DEFAULT_PLATFORMS));
  if (!has('walletApps')) ins.run('walletApps', JSON.stringify(DEFAULT_WALLET_APPS));
  // chains reuse the networks list

  // v2 list refresh: drop "Other", ensure new defaults exist (idempotent)
  const mergeList = (key, defaults, drop = ['Other']) => {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    if (!row) return;
    let arr;
    try { arr = JSON.parse(row.value); } catch { return; }
    if (!Array.isArray(arr)) return;
    let changed = false;
    for (const d of drop) { const i = arr.indexOf(d); if (i >= 0) { arr.splice(i, 1); changed = true; } }
    for (const d of defaults) { if (!arr.includes(d)) { arr.push(d); changed = true; } }
    if (changed) db.prepare('UPDATE config SET value = ? WHERE key = ?').run(JSON.stringify(arr), key);
  };
  mergeList('categories', DEFAULT_CATEGORIES, ['Other', 'Airdrop', 'Quest']);
  mergeList('statuses', DEFAULT_STATUSES, []);
  mergeList('platforms', DEFAULT_PLATFORMS, []);
  mergeList('walletApps', DEFAULT_WALLET_APPS, []);
}

// all option lists that are user-editable chip groups (delete support in the UI)
const EDITABLE_OPTION_KEYS = ['categories', 'networks', 'statuses', 'platforms', 'walletApps', 'walletLabels', 'ranks'];
// which project column each option list writes into (used by the delete handler)
const OPTION_TO_COLUMN = {
  categories: 'category', networks: 'network', statuses: 'status',
  platforms: 'platform', walletApps: 'wallet_app', walletLabels: null, ranks: 'rank'
};
// built-in defaults are protected from deletion so the app always has a sane baseline
const PROTECTED_OPTIONS = {
  categories: [], networks: [], statuses: [], walletApps: [],
  ranks: ['S', 'A', 'B', 'C', 'D'],
  platforms: ['X', 'Desktop', 'App', 'Extension']
};

function loadOptions() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* skip malformed */ }
  }
  return out;
}

function getProjectFull(id) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return null;
  p.category = parseCats(p.category);
  p.network = parseCats(p.network);
  p.chains = parseCats(p.chains);
  p.platform = parseCats(p.platform);
  p.links = db.prepare('SELECT * FROM links WHERE project_id = ? ORDER BY id').all(id);
  p.wallets = db.prepare('SELECT * FROM wallets WHERE project_id = ? ORDER BY id').all(id);
  p.x_accounts = db.prepare('SELECT * FROM x_accounts WHERE project_id = ? ORDER BY id').all(id);
  p.emails = db.prepare('SELECT * FROM emails WHERE project_id = ? ORDER BY id').all(id);
  p.tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(id);
  return p;
}

function getAllProjects() {
  const rows = db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY id ASC').all();
  const stmt = {
    tasks: db.prepare('SELECT id, text, deadline, done, url FROM tasks WHERE project_id = ? ORDER BY id'),
    wallets: db.prepare('SELECT address, label FROM wallets WHERE project_id = ? ORDER BY id'),
    x: db.prepare('SELECT username FROM x_accounts WHERE project_id = ? ORDER BY id'),
    mail: db.prepare('SELECT email FROM emails WHERE project_id = ? ORDER BY id'),
    links: db.prepare('SELECT url, label FROM links WHERE project_id = ? ORDER BY id')
  };
  return rows.map(p => {
    p.category = parseCats(p.category);
    p.network = parseCats(p.network);
    p.chains = parseCats(p.chains);
    p.platform = parseCats(p.platform);
    p.tasks = stmt.tasks.all(p.id);
    p.wallets = stmt.wallets.all(p.id);
    p.x_accounts = stmt.x.all(p.id);
    p.emails = stmt.mail.all(p.id);
    p.links = stmt.links.all(p.id);
    p.task_total = p.tasks.length;
    p.task_done = p.tasks.filter(t => t.done).length;
    return p;
  });
}

// ---------- IPC ----------
ipcMain.handle('db:options', () => loadOptions());

// how many projects reference an option value (renderer confirms before deleting)
ipcMain.handle('db:option:usage', (_e, key, value) => {
  const col = OPTION_TO_COLUMN[key];
  if (!col) return 0;
  const rows = db.prepare(`SELECT ${col} AS v FROM projects WHERE archived = 0`).all();
  let used = 0;
  for (const r of rows) for (const v of parseCats(r.v)) if (v === value) used++;
  return used;
});

ipcMain.handle('db:option:delete', (_e, key, value) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  let arr = [];
  try { arr = row ? JSON.parse(row.value) : []; } catch { arr = []; }
  if (!Array.isArray(arr) || !arr.includes(value)) return { ok: false, error: 'not in list' };
  const prot = PROTECTED_OPTIONS[key] || [];
  if (prot.includes(value)) return { ok: false, error: 'protected', message: `"${value}" is a built-in default and cannot be deleted` };

  const col = OPTION_TO_COLUMN[key];
  db.transaction(() => {
    db.prepare('UPDATE config SET value = ? WHERE key = ?').run(JSON.stringify(arr.filter(v => v !== value)), key);
    if (col) {
      // strip the value from every project that referenced it
      const rows = db.prepare(`SELECT id, ${col} AS v FROM projects`).all();
      const upd = db.prepare(`UPDATE projects SET ${col} = ?, updated_at = ? WHERE id = ?`);
      const now = new Date().toISOString();
      for (const r of rows) {
        const filtered = parseCats(r.v).filter(v => v !== value);
        // single-value columns stay a plain string; array columns stay JSON
        const next = (col === 'status' || col === 'rank' || col === 'cost' || col === 'wallet_app')
          ? (filtered[0] || '')
          : JSON.stringify(filtered);
        upd.run(next, now, r.id);
      }
    }
  })();
  return { ok: true, options: loadOptions() };
});

ipcMain.handle('db:option:add', (_e, key, value) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  let arr = [];
  try { arr = row ? JSON.parse(row.value) : []; } catch { arr = []; }
  if (!arr.includes(value)) arr.push(value);
  db.prepare('INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(arr));
  return loadOptions();
});

ipcMain.handle('db:option:set', (_e, key, arr) => {
  if (!Array.isArray(arr)) return loadOptions();
  db.prepare('INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(arr));
  return loadOptions();
});

ipcMain.handle('db:projects', () => getAllProjects());
ipcMain.handle('db:project:get', (_e, id) => getProjectFull(id));

ipcMain.handle('db:deadlines', () => db.prepare(
  `SELECT t.id, t.text, t.deadline, t.done, p.id AS pid, p.name AS pname, p.icon AS picon
   FROM tasks t JOIN projects p ON p.id = t.project_id
   WHERE t.deadline <> '' AND p.archived = 0
   ORDER BY t.deadline ASC, t.id ASC`
).all());

ipcMain.handle('db:project:save', (_e, data) => {
  const now = new Date().toISOString();
  let id = data.id ? Number(data.id) : null;
  const clean = (s) => (s || '').toString().trim();

  const cats = Array.isArray(data.category) ? data.category.filter(Boolean) : [];
  // network and platform are JSON arrays now (multi-select); chains column is deprecated
  const nets = Array.isArray(data.network) ? data.network.filter(Boolean)
    : (data.network ? [String(data.network)] : []);
  const plats = Array.isArray(data.platform) ? data.platform.filter(Boolean)
    : (data.platform ? [String(data.platform)] : []);
  const xMain = parseXUsername(data.x_account);
  const icon = clean(data.icon) || null;

  const extra = [
    clean(data.rank),
    clean(data.cost),
    '[]',
    clean(data.status),
    JSON.stringify(plats),
    clean(data.wallet_app),
  ];

  if (id) {
    db.prepare(
      `UPDATE projects SET name = ?, website = ?, x_account = ?, category = ?, network = ?, note = ?, icon = ?, done = ?, rank = ?, cost = ?, chains = ?, status = ?, platform = ?, wallet_app = ?, updated_at = ? WHERE id = ?`
    ).run(clean(data.name), clean(data.website), xMain, JSON.stringify(cats), JSON.stringify(nets), clean(data.note), icon, data.done ? 1 : 0, ...extra, now, id);
  } else {
    const res = db.prepare(
      `INSERT INTO projects (name, website, x_account, category, network, note, icon, done, rank, cost, chains, status, platform, wallet_app, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(clean(data.name), clean(data.website), xMain, JSON.stringify(cats), JSON.stringify(nets), clean(data.note), icon, data.done ? 1 : 0, ...extra, now);
    id = Number(res.lastInsertRowid);
  }

  db.prepare('DELETE FROM links WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM wallets WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM x_accounts WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM emails WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id);

  for (const l of (data.links || [])) {
    const url = clean(l && l.url);
    if (!url) continue;
    db.prepare('INSERT INTO links (project_id, url, label) VALUES (?,?,?)').run(id, url, clean(l.label));
  }
  for (const w of (data.wallets || [])) {
    const addr = clean(typeof w === 'string' ? w : w.address);
    if (!addr) continue;
    db.prepare('INSERT INTO wallets (project_id, address, label) VALUES (?,?,?)').run(id, addr, clean(typeof w === 'string' ? '' : w.label));
  }
  for (const x of (data.x_accounts || [])) {
    const u = parseXUsername(x);
    if (!u) continue;
    db.prepare('INSERT INTO x_accounts (project_id, username) VALUES (?,?)').run(id, u);
  }
  for (const m of (data.emails || [])) {
    const em = clean(m);
    if (!em) continue;
    db.prepare('INSERT INTO emails (project_id, email) VALUES (?,?)').run(id, em);
  }
  for (const t of (data.tasks || [])) {
    const txt = clean(t && t.text);
    if (!txt) continue;
    let dl = clean(t && t.deadline);
    if (dl && !/^\d{4}-\d{2}-\d{2}$/.test(dl)) dl = '';
    const turl = clean(t && t.url);
    db.prepare('INSERT INTO tasks (project_id, text, deadline, done, url) VALUES (?,?,?,?,?)').run(id, txt, dl, t.done ? 1 : 0, turl);
  }
  db.prepare("DELETE FROM tasks WHERE text = ''").run();
  db.prepare("DELETE FROM wallets WHERE address = ''").run();
  db.prepare("DELETE FROM x_accounts WHERE username = ''").run();
  db.prepare("DELETE FROM emails WHERE email = ''").run();
  db.prepare("DELETE FROM links WHERE url = ''").run();

  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, id);
  return getProjectFull(id);
});

ipcMain.handle('db:project:delete', (_e, id) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(Number(id));
  return true;
});

ipcMain.handle('db:project:toggle', (_e, id, done) => {
  db.prepare('UPDATE projects SET done = ?, updated_at = ? WHERE id = ?').run(done ? 1 : 0, new Date().toISOString(), Number(id));
  return getProjectFull(Number(id));
});

ipcMain.handle('db:task:toggle', (_e, projectId, taskId, done) => {
  db.prepare('UPDATE tasks SET done = ? WHERE id = ? AND project_id = ?').run(done ? 1 : 0, Number(taskId), Number(projectId));
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), Number(projectId));
  return getProjectFull(Number(projectId));
});

ipcMain.handle('db:stats', () => {
  const rows = db.prepare('SELECT category, network, rank, done FROM projects WHERE archived = 0').all();
  const total = rows.length;
  const done = rows.filter(r => r.done).length;
  const catCount = {};
  for (const r of rows) for (const c of parseCats(r.category)) catCount[c] = (catCount[c] || 0) + 1;
  const categories = Object.entries(catCount).map(([k, c]) => ({ k, c })).sort((a, b) => b.c - a.c);
  const netCount = {};
  for (const r of rows) for (const c of parseCats(r.network)) netCount[c] = (netCount[c] || 0) + 1;
  const networks = Object.entries(netCount).map(([k, c]) => ({ k, c })).sort((a, b) => b.c - a.c);
  // rank counts, always in S..D order
  const rankOrder = ['S', 'A', 'B', 'C', 'D'];
  const rankCount = {};
  for (const r of rows) { const v = (r.rank || '').trim(); if (v) rankCount[v] = (rankCount[v] || 0) + 1; }
  const ranks = rankOrder.filter(r => rankCount[r]).map(k => ({ k, c: rankCount[k] }));
  return { total, done, networks, categories, ranks };
});

// ---------- settings (locale + theme, stored locally in the config table) ----------
const VALID_THEMES = ['dark', 'light'];
const VALID_SKINS = ['base', 'paper', 'aurora', 'crt'];
const VALID_LOCALES = ['en', 'id'];
const VALID_BG = ['none', 'aurora', 'nebula', 'ember', 'forest', 'custom'];
const BG_DEFAULT = 'aurora';

// plain string table (functions cannot cross IPC); the renderer pluralizes
const STRINGS = {
  en: {
    appSubtitle: 'I promise to diligently farm airdrops again.',
    search: 'Search projects, wallets, tasks',
    showPending: 'Show pending only',
    todayLabel: '{v}',
    newProject: 'New project', editProject: 'Edit project',
    allNetworks: 'All networks', allCategories: 'All categories', allRanks: 'All ranks',
    network: 'Network', category: 'Category', rank: 'Rank',
    projects: 'Projects', done: 'Done', dailyProgress: 'Daily progress',
    noProjects: 'No projects yet',
    noProjectsHint: 'Add the first airdrop you are farming. Everything is stored locally in this app, nothing leaves your machine.',
    noMatches: 'No matches',
    noMatchesHint: 'Nothing matches the current search or filter. Clear them to see all projects.',
    clearFilters: 'Clear filters', addProject: 'Add project',
    tasks: 'tasks', markedDone: 'Marked done',
    website: 'Website', links: 'Links', identities: 'Identities', note: 'Note', status: 'Status',
    taskProgress: 'Task progress', taskDoneOf: '{a} of {b} tasks done',
    noTasks: 'No tasks recorded.',
    edit: 'Edit', delete: 'Delete project', cancel: 'Cancel', create: 'Create', saveChanges: 'Save changes',
    deleteConfirm: 'Delete {n} and all its data? This cannot be undone.',
    nameRequired: 'Project name is required',
    created: 'Created', lastEdited: 'Last edited',
    add: 'Add',
    cost: 'Cost', platform: 'Platform', walletApp: 'Wallet app',
    additionalLinks: 'Additional links', wallets: 'Wallets', xAccounts: 'X accounts', emails: 'Emails',
    tasksSection: 'Tasks',
    backup: 'Backup', restore: 'Restore',
    confirmDeleteOption: '"{v}" is used by {n} projects. Delete it anyway? The value will be removed from those projects.'
  },
  id: {
    appSubtitle: 'Saya berjanji akan rajin garap erdrop lagi.',
    search: 'Cari project, wallet, task',
    showPending: 'Tampilkan yang belum selesai',
    todayLabel: '{v}',
    newProject: 'Project baru', editProject: 'Edit project',
    allNetworks: 'Semua network', allCategories: 'Semua kategori', allRanks: 'Semua rank',
    network: 'Network', category: 'Kategori', rank: 'Rank',
    projects: 'Project', done: 'Selesai', dailyProgress: 'Progress harian',
    noProjects: 'Belum ada project',
    noProjectsHint: 'Tambahkan airdrop pertama yang sedang kamu kerjakan. Semua disimpan lokal di app ini, tidak ada yang keluar dari perangkatmu.',
    noMatches: 'Tidak ada hasil',
    noMatchesHint: 'Tidak ada yang cocok dengan pencarian atau filter saat ini. Hapus filter untuk melihat semua project.',
    clearFilters: 'Hapus filter', addProject: 'Tambah project',
    tasks: 'task', markedDone: 'Ditandai selesai',
    website: 'Website', links: 'Link', identities: 'Identitas', note: 'Catatan', status: 'Status',
    taskProgress: 'Progress task', taskDoneOf: '{a} dari {b} task selesai',
    noTasks: 'Belum ada task.',
    edit: 'Edit', delete: 'Hapus project', cancel: 'Batal', create: 'Buat', saveChanges: 'Simpan perubahan',
    deleteConfirm: 'Hapus {n} dan semua datanya? Ini tidak bisa dibatalkan.',
    nameRequired: 'Nama project wajib diisi',
    created: 'Dibuat', lastEdited: 'Terakhir diubah',
    add: 'Tambah',
    cost: 'Cost', platform: 'Platform', walletApp: 'Wallet app',
    additionalLinks: 'Link tambahan', wallets: 'Wallet', xAccounts: 'Akun X', emails: 'Email',
    tasksSection: 'Task',
    backup: 'Backup', restore: 'Restore',
    confirmDeleteOption: '"{v}" dipakai di {n} project. Tetap hapus? Nilainya akan dihapus dari project-project tersebut.'
  }
};

function loadSettings() {
  const get = (k, fallback) => {
    const r = db.prepare('SELECT value FROM config WHERE key = ?').get(k);
    return r ? r.value : fallback;
  };
  const theme = VALID_THEMES.includes(get('theme', 'dark')) ? get('theme', 'dark') : 'dark';
  const locale = VALID_LOCALES.includes(get('locale', 'en')) ? get('locale', 'en') : 'en';
  const skin = VALID_SKINS.includes(get('skin', 'base')) ? get('skin', 'base') : 'base';
  let bg = get('bgPreset', BG_DEFAULT);
  if (!VALID_BG.includes(bg)) bg = BG_DEFAULT;
  const bgCustom = get('bgCustom', '');
  return { theme, locale, skin, bgPreset: bg, bgCustom };
}

ipcMain.handle('db:settings:get', () => loadSettings());
ipcMain.handle('db:settings:set', (_e, patch) => {
  const cur = loadSettings();
  const next = { ...cur };
  if (VALID_THEMES.includes(patch.theme)) next.theme = patch.theme;
  if (VALID_LOCALES.includes(patch.locale)) next.locale = patch.locale;
  if (VALID_SKINS.includes(patch.skin)) next.skin = patch.skin;
  if (VALID_BG.includes(patch.bgPreset)) next.bgPreset = patch.bgPreset;
  if (typeof patch.bgCustom === 'string') next.bgCustom = patch.bgCustom;
  const ins = db.prepare('INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  ins.run('theme', next.theme);
  ins.run('locale', next.locale);
  ins.run('skin', next.skin);
  ins.run('bgPreset', next.bgPreset);
  ins.run('bgCustom', next.bgCustom);
  return next;
});

// pick a custom background image (copied into userData so it stays put)
ipcMain.handle('dialog:pickBg', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a background image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const src = res.filePaths[0];
  const dir = path.join(app.getPath('userData'), 'icons');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = (path.extname(src).toLowerCase() || '.png');
  const dst = path.join(dir, 'bg-' + Date.now() + ext);
  try { fs.copyFileSync(src, dst); } catch (err) { return { error: String(err.message || err) }; }
  return dst;
});
ipcMain.handle('db:t', () => JSON.parse(JSON.stringify(STRINGS)));

ipcMain.handle('dialog:pickIcon', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a project icon',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const src = res.filePaths[0];
  const dir = path.join(app.getPath('userData'), 'icons');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = (path.extname(src).toLowerCase() || '.png');
  const dst = path.join(dir, 'icon-' + Date.now() + ext);
  try { fs.copyFileSync(src, dst); } catch (err) { return { error: String(err.message || err) }; }
  return dst;
});

ipcMain.handle('db:project:icon', (_e, id, iconPath) => {
  db.prepare('UPDATE projects SET icon = ?, updated_at = ? WHERE id = ?').run(iconPath || null, new Date().toISOString(), Number(id));
  return getProjectFull(Number(id));
});

ipcMain.handle('db:backup', async () => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Backup database',
    defaultPath: `airdrop-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'Database', extensions: ['db'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    db.close();
    fs.copyFileSync(dbPath(), res.filePath);
    openDb();
    return { ok: true, path: res.filePath };
  } catch (err) {
    try { openDb(); } catch { /* ignore */ }
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('db:restore', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Restore database',
    properties: ['openFile'],
    filters: [{ name: 'Database', extensions: ['db'] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    db.close();
    const dst = dbPath();
    const src = res.filePaths[0];
    const tmp = dst + '.incoming';
    fs.copyFileSync(src, tmp);
    const probe = new Database(tmp, { readonly: true });
    probe.close();
    if (fs.existsSync(dst)) fs.unlinkSync(dst);
    fs.renameSync(tmp, dst);
    openDb();
    migrate();
    return { ok: true, path: src };
  } catch (err) {
    try { openDb(); } catch { /* ignore */ }
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });

ipcMain.handle('shell:open', async (_e, url) => {
  const u = (url || '').trim();
  if (!u) return false;
  const target = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  await shell.openExternal(target);
  return true;
});

ipcMain.handle('shell:x', async (_e, username) => {
  const name = parseXUsername(username);
  if (!name) return false;
  await shell.openExternal(`https://x.com/${name}`);
  return true;
});

ipcMain.handle('parse:x', (_e, v) => parseXUsername(v));

// ---------- Window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0d0f12',
    title: 'SlaveDrop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  openDb();
  migrate();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
