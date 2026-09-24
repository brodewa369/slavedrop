// Standalone Electron shell for SlaveDrop mobile-UI debugging.
// Loads the UNMODIFIED SlaveDrop renderer (../www) with a mock window.api
// backed by a real DB dump. Android viewport emulation is driven via CDP
// (see mdebug.py). The airdrop-tracker source is never touched by this harness.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.CDP_PORT || 9333);
const WIN_W = Number(process.env.WIN_W || 390);
const WIN_H = Number(process.env.WIN_H || 844);

// ---------- mock state ----------
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock-data.json'), 'utf8'));
let projects = JSON.parse(JSON.stringify(seed.projects));
let config = JSON.parse(JSON.stringify(seed.config));
let nextId = Math.max(0, ...projects.map(p => p.id || 0)) + 1;
const settings = {
  theme: 'dark', locale: 'en', skin: '', bgPreset: '', bgCustom: ''
};
const STRINGS = require('./strings.js');

function saveProject(data) {
  const id = data.id || nextId++;
  const cur = projects.find(p => p.id === id);
  const base = cur || { id, done: 0, archived: 0, icon: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const p = Object.assign(base, {
    name: data.name || '', website: data.website || '', x_account: data.x_account || '',
    category: data.category || '', network: data.network || '', note: data.note || '',
    rank: data.rank || '', cost: data.cost || '', status: data.status || '',
    platform: data.platform || '', wallet_app: data.wallet_app || '',
    chains: JSON.stringify(data.chains || []),
    updated_at: new Date().toISOString()
  });
  if (!cur) projects.push(p);
  p.links = (data.links || []).map(l => ({ url: l.url || '', label: l.label || '' }));
  p.wallets = (data.wallets || [])
    .map(w => (typeof w === 'string' ? { address: w, label: '' } : { address: w.address || '', label: w.label || '' }))
    .filter(w => w.address !== '');
  p.x = (data.x || []).map(u => (typeof u === 'string' ? u : u.username || ''));
  p.mail = (data.mail || []).map(e => (typeof e === 'string' ? e : e.email || ''));
  p.tasks = (data.tasks || [])
    .map(t => ({ id: t.id || Math.floor(Math.random() * 1e9), text: t.text || '',
      deadline: t.deadline || '', done: t.done ? 1 : 0, url: t.url || '' }))
    .filter(t => t.text !== '');
  return { id };
}

ipcMain.handle('mock:options', () => {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
});
ipcMain.handle('mock:option:add', (_e, key, value) => {
  const a = JSON.parse(config[key] || '[]');
  if (!a.includes(value)) a.push(value);
  config[key] = JSON.stringify(a);
  return true;
});
ipcMain.handle('mock:option:set', (_e, key, arr) => { config[key] = JSON.stringify(arr || []); return true; });
ipcMain.handle('mock:option:usage', () => ({}));
ipcMain.handle('mock:option:delete', (_e, key, value) => {
  config[key] = JSON.stringify(JSON.parse(config[key] || '[]').filter(v => v !== value));
  return true;
});
ipcMain.handle('mock:settings:get', () => settings);
ipcMain.handle('mock:settings:set', (_e, patch) => { Object.assign(settings, patch); return true; });
ipcMain.handle('mock:t', () => STRINGS);
// Parse JSON strings back to arrays for fields stored as JSON in DB
function parseArrayFields(obj) {
  for (const key of ['category', 'network', 'platform', 'chains']) {
    if (typeof obj[key] === 'string') {
      try { obj[key] = JSON.parse(obj[key]); } catch { obj[key] = obj[key] ? [obj[key]] : []; }
    }
  }
  return obj;
}

// Add task_total/task_done fields to each project
function addTaskStats(p) {
  const tasks = p.tasks || [];
  p.task_total = tasks.length;
  p.task_done = tasks.filter(t => t.done).length;
  return p;
}

ipcMain.handle('mock:projects', () => projects.map(p => addTaskStats(parseArrayFields({
  id: p.id, name: p.name, website: p.website, x_account: p.x_account, category: p.category,
  network: p.network, note: p.note, icon: p.icon, done: p.done, archived: p.archived,
  rank: p.rank, cost: p.cost, chains: p.chains, status: p.status, platform: p.platform,
  wallet_app: p.wallet_app, created_at: p.created_at, updated_at: p.updated_at,
  tasks: (p.tasks || []).map(t => ({ id: t.id, text: t.text, deadline: t.deadline, done: t.done, url: t.url })),
  wallets: (p.wallets || []).map(w => ({ address: w.address, label: w.label })),
  x: (p.x || []).map(u => u), mail: (p.mail || []).map(e => e),
  links: (p.links || []).map(l => ({ url: l.url, label: l.label }))
}))));

ipcMain.handle('mock:project:get', (_e, id) => {
  const p = JSON.parse(JSON.stringify(projects.find(x => x.id === id) || null));
  if (!p) return null;
  return addTaskStats(parseArrayFields(p));
});
ipcMain.handle('mock:project:save', (_e, data) => saveProject(data));
ipcMain.handle('mock:project:delete', (_e, id) => { projects = projects.filter(p => p.id !== id); return true; });
ipcMain.handle('mock:task:toggle', (_e, projectId, taskId, done) => {
  const p = projects.find(x => x.id === projectId);
  const t = p && (p.tasks || []).find(x => x.id === taskId);
  if (t) t.done = done ? 1 : 0;
  return true;
});
ipcMain.handle('mock:task:toggleAll', (_e, projectId, done) => {
  const p = projects.find(x => x.id === projectId);
  if (p) {
    p.done = done ? 1 : 0;
    if (p.tasks) {
      p.tasks.forEach(t => t.done = done ? 1 : 0);
    }
  }
  return true;
});
ipcMain.handle('mock:project:toggle', (_e, id, done) => {
  const p = projects.find(x => x.id === id);
  if (p) {
    p.done = done ? 1 : 0;
    if (p.tasks) {
      p.tasks.forEach(t => t.done = done ? 1 : 0);
    }
  }
  return true;
});
ipcMain.handle('mock:project:icon', (_e, id, iconPath) => {
  const p = projects.find(x => x.id === id);
  if (p) p.icon = iconPath;
  return true;
});
ipcMain.handle('mock:dialog:pickIcon', async () => null); // mobile path = native image picker
ipcMain.handle('mock:dialog:pickBg', async () => null);
ipcMain.handle('mock:deadlines', () => projects.flatMap(p =>
  (p.tasks || []).filter(t => t.deadline)
    .map(t => ({ projectId: p.id, projectName: p.name, id: t.id, text: t.text, deadline: t.deadline, done: !!t.done }))));
ipcMain.handle('mock:stats', () => {
  const all = projects.flatMap(p => p.tasks || []);
  const cats = {}, ranks = {}, nets = {};
  for (const p of projects) {
    const proj = parseArrayFields({...p});
    for (const c of proj.category) cats[c] = (cats[c] || 0) + 1;
    ranks[proj.rank] = (ranks[proj.rank] || 0) + 1;
    for (const n of proj.network) nets[n] = (nets[n] || 0) + 1;
  }
  // Project is counted as done if: explicitly marked done OR all its tasks are done
  const projectIsDone = (p) => p.done || ((p.tasks || []).length > 0 && (p.tasks || []).every(t => t.done));
  const toArr = (obj) => Object.entries(obj).map(([k, c]) => ({ k, c }));
  return {
    total: projects.length,
    done: projects.filter(p => projectIsDone(p)).length,
    tasks: all.length,
    tasksDone: all.filter(t => t.done).length,
    upcoming: all.filter(t => !t.done && t.deadline).length,
    categories: toArr(cats),
    ranks: toArr(ranks),
    networks: toArr(nets)
  };
});
ipcMain.handle('mock:backup', async () => true);
ipcMain.handle('mock:restore', async () => true);
ipcMain.handle('mock:shell:open', async (_e, url) => console.log('[mock] openUrl', url));
ipcMain.handle('mock:shell:x', async (_e, u) => console.log('[mock] openX', u));
ipcMain.handle('mock:parse:x', (_e, v) => String(v || '').trim().replace(/^@/, '')
  .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '').split(/[\/?]/)[0]);
ipcMain.handle('mock:clipboard:write', (_e, text) => { console.log('[mock] clipboard', String(text || '').slice(0, 40)); return true; });

// ---------- window ----------
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: WIN_W, height: WIN_H, frame: true, show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      webSecurity: false // allow file:// loads from mock assets
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  win.on('closed', () => app.quit());
});
