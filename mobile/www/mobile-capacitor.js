// mobile-capacitor.js — fallback mock API for Capacitor/web (non-Electron)
// Loaded before app.js. Only activates when window.api is undefined.
//
// Contract mirrors Electron main.js (db:* IPC handlers). 2026-09-24 rewrite:
// the previous flat strings() dict made state.t undefined and crashed refresh()
// (device showed "Could not load" + dead chips/drawer/language switch).
(function () {
  if (typeof window.api !== 'undefined') return;  // Electron harness: skip

  const K = 'slavedrop-data-v1';

  // ---------- i18n tables (nested per locale, same shape as main.js STRINGS) ----------
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
      showPending: 'Tampilkan pending',
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

  // ---------- validation tables (mirror main.js) ----------
  const VALID = {
    theme: ['dark', 'light'],
    locale: ['en', 'id'],
    skin: ['base', 'paper', 'aurora', 'crt'],
    bgPreset: ['none', 'aurora', 'nebula', 'ember', 'forest', 'custom']
  };
  const OPTION_TO_COLUMN = {
    categories: 'category', networks: 'network', statuses: 'status',
    platforms: 'platform', walletApps: 'wallet_app', walletLabels: null, ranks: 'rank'
  };
  const PROTECTED_OPTIONS = {
    categories: [], networks: [], statuses: [], walletApps: [],
    ranks: ['S', 'A', 'B', 'C', 'D'],
    platforms: ['X', 'Desktop', 'App', 'Extension']
  };
  const SINGLE_VALUE_COLS = ['status', 'rank', 'cost', 'wallet_app'];

  const seed = () => ({
    config: {
      categories: ['Testnet','Mainnet','Node','DeFi','Social','Waitlist','AI','Telegram Bot','Daily Checkin','Memecoin','NFT','Retrodrop'],
      networks: ['Ethereum','Solana','Arbitrum','Optimism','Base','BSC','Polygon','Avalanche','Sui','Aptos','Bitcoin','Cosmos'],
      ranks: ['S','A','B','C','D'],
      statuses: ['Ongoing','TGE','Completed','Eligible','Ineligible'],
      platforms: ['X','Desktop','App','Extension','Web'],
      walletApps: ['MetaMask','Phantom','Rabby','Keplr','OKX','Binance'],
      theme: 'dark', locale: 'en', skin: 'base', bgPreset: 'aurora', bgCustom: ''
    },
    projects: [
      {
        id: 1, name: 'Demo Project', website: 'https://example.com', x_account: '',
        category: ['Daily Checkin'], network: ['Ethereum'], note: 'Tap tasks below to track daily progress.',
        icon: null, done: 0, archived: 0, rank: 'S', cost: 'Free', chains: [],
        status: 'Ongoing', platform: ['Web'], wallet_app: 'MetaMask',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        links: [{url: 'https://example.com', label: 'web'}],
        wallets: [{address: '0xDemo', label: 'Demo Wallet'}],
        x_accounts: [{username: 'example'}],
        emails: [{email: 'demo@example.com'}],
        tasks: [
          {id: 1, text: 'Checkin harian', deadline: '', done: 0, url: 'https://example.com/checkin'},
          {id: 2, text: 'Swap token', deadline: '', done: 0, url: 'https://example.com/swap'},
          {id: 3, text: 'Deploy contract', deadline: '', done: 0, url: 'https://example.com/deploy'}
        ]
      }
    ]
  });

  let D = JSON.parse(localStorage.getItem(K) || 'null') || seed();
  const save = () => { try { localStorage.setItem(K, JSON.stringify(D)); } catch (e) { console.warn('[CAPACITOR-MOCK] save failed', e); } };

  const uid = () => Date.now() + Math.floor(Math.random() * 1000);

  // migrate legacy shapes written by the first (broken) build on this device
  // (also re-run after a restore, so restored backups normalize the same way)
  const migrate = () => {
    if (!D.config) D.config = seed().config;
    const c = D.config;
    if (!Array.isArray(c.walletApps)) {
      c.walletApps = Array.isArray(c.walletLabels) ? c.walletLabels : seed().config.walletApps;
    }
    delete c.walletLabels;
    for (const p of D.projects || []) {
      if (p.x && !p.x_accounts) {
        p.x_accounts = p.x.map(x => typeof x === 'string' ? { username: x.replace(/^@/, '') } : x);
        delete p.x;
      }
      if (p.mail && !p.emails) {
        p.emails = p.mail.map(m => typeof m === 'string' ? { email: m } : m);
        delete p.mail;
      }
      for (const t of p.tasks || []) if (t.id === undefined) t.id = uid();
      if (typeof p.done === 'boolean') p.done = p.done ? 1 : 0;
    }
    save();
  };
  migrate();

  const parseArrays = (p) => ({
    ...p,
    category: Array.isArray(p.category) ? p.category : JSON.parse(p.category || '[]'),
    network: Array.isArray(p.network) ? p.network : JSON.parse(p.network || '[]'),
    chains: Array.isArray(p.chains) ? p.chains : JSON.parse(p.chains || '[]'),
    platform: Array.isArray(p.platform) ? p.platform : JSON.parse(p.platform || '[]'),
    links: Array.isArray(p.links) ? p.links : JSON.parse(p.links || '[]'),
    wallets: Array.isArray(p.wallets) ? p.wallets : JSON.parse(p.wallets || '[]'),
    x_accounts: Array.isArray(p.x_accounts) ? p.x_accounts : JSON.parse(p.x_accounts || '[]'),
    emails: Array.isArray(p.emails) ? p.emails : JSON.parse(p.emails || '[]'),
    tasks: Array.isArray(p.tasks) ? p.tasks : JSON.parse(p.tasks || '[]')
  });

  const taskStats = (p) => { p.task_total = (p.tasks || []).length; p.task_done = (p.tasks || []).filter(t => t.done).length; return p; };
  const projectIsDone = (p) => p.done || (((p.tasks || []).length > 0) && (p.tasks || []).every(t => t.done));
  const loadOptions = () => JSON.parse(JSON.stringify(D.config));

  // does project field `col` reference option `value`?
  const usesValue = (p, col, value) => {
    if (SINGLE_VALUE_COLS.includes(col)) return (p[col] || '') === value;
    const arr = parseArrays({ ...p })[col];
    return Array.isArray(arr) && arr.includes(value);
  };

  // ---------- file helpers (device: system picker via WebChromeClient) ----------
  // `file` may be injected (tests / programmatic); otherwise open the system
  // picker with a hidden <input type="file">. Requires
  // WebChromeClient.onShowFileChooser in MainActivity — without it the click
  // silently does nothing.
  const pickFile = (accept) => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; inp.remove(); resolve(v); };
    inp.onchange = () => done(inp.files && inp.files[0] ? inp.files[0] : null);
    if ('oncancel' in inp) inp.oncancel = () => done(null);
    document.body.appendChild(inp);
    inp.click();
  });

  const readFileText = (f) => new Promise((resolve, reject) => {
    if (typeof f.text === 'function') { f.text().then(resolve, reject); return; }
    const r = new FileReader();                       // older WebView fallback
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsText(f);
  });

  // downscale + encode via FileReader dataURL (avoids blob:, which CSP img-src
  // does not allow) — keeps localStorage payloads small
  const resizeDataUrl = (file, max, mime, quality) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read image'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL(mime, quality)); }
        catch (e) { reject(new Error('Could not encode image')); }
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });

  // ---------- save-as (backup): AndroidBridge → ACTION_CREATE_DOCUMENT ----------
  // Desktop/browser fallback: <a download> on a data: URL.
  let saveSeq = 0;
  const pendingSaves = {};
  window.__slavedropSaveResult = (seq, ok, name) => {
    const p = pendingSaves[String(seq)];
    if (!p) return;
    delete pendingSaves[String(seq)];
    p(ok ? { ok: true, path: name || 'backup' } : { ok: false });
  };
  const toBase64 = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  };
  const bridgeSave = (name, mime, b64) => new Promise((resolve) => {
    if (!window.AndroidBridge) {
      try {
        const a = document.createElement('a');
        a.href = 'data:' + mime + ';base64,' + b64;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        resolve({ ok: true, path: name });
      } catch (e) { resolve({ ok: false, error: String(e && e.message || e) }); }
      return;
    }
    const seq = String(++saveSeq);
    pendingSaves[seq] = resolve;
    try {
      window.AndroidBridge.saveDocument(seq, name, mime, b64);
    } catch (e) {
      delete pendingSaves[seq];
      resolve({ ok: false, error: String(e && e.message || e) });
      return;
    }
    // user may take a while to pick a folder — generous safety net
    setTimeout(() => {
      if (pendingSaves[seq]) { delete pendingSaves[seq]; resolve({ ok: false }); }
    }, 180000);
  });

  window.api = {
    options: async () => loadOptions(),
    addOption: async (key, value) => {
      if (Array.isArray(D.config[key]) && !D.config[key].includes(value)) D.config[key].push(value);
      save();
      return loadOptions();
    },
    setOption: async (key, arr) => {
      if (Array.isArray(arr)) D.config[key] = arr;
      save();
      return loadOptions();
    },
    optionUsage: async (key, value) => {
      const col = OPTION_TO_COLUMN[key];
      if (!col) return 0;
      let used = 0;
      for (const p of D.projects) if (!p.archived && usesValue(p, col, value)) used++;
      return used;
    },
    deleteOption: async (key, value) => {
      const arr = D.config[key];
      if (!Array.isArray(arr) || !arr.includes(value)) return { ok: false, error: 'not in list' };
      const prot = PROTECTED_OPTIONS[key] || [];
      if (prot.includes(value)) return { ok: false, error: 'protected', message: `"${value}" is a built-in default and cannot be deleted` };
      const col = OPTION_TO_COLUMN[key];
      D.config[key] = arr.filter(v => v !== value);
      if (col) {
        for (const p of D.projects) {
          if (SINGLE_VALUE_COLS.includes(col)) {
            if ((p[col] || '') === value) p[col] = '';
          } else {
            const cur = parseArrays({ ...p })[col] || [];
            const filtered = cur.filter(v => v !== value);
            if (JSON.stringify(filtered) !== JSON.stringify(cur)) p[col] = filtered;
          }
          p.updated_at = new Date().toISOString();
        }
      }
      save();
      return { ok: true, options: loadOptions() };
    },
    settingsGet: async () => ({
      theme: D.config.theme || 'dark',
      locale: D.config.locale || 'en',
      skin: D.config.skin || 'base',
      bgPreset: D.config.bgPreset || 'aurora',
      bgCustom: D.config.bgCustom || ''
    }),
    settingsSet: async (patch) => {
      if (!patch || typeof patch !== 'object') return false;
      for (const k of ['theme', 'locale', 'skin', 'bgPreset']) {
        if (patch[k] !== undefined && VALID[k].includes(patch[k])) D.config[k] = patch[k];
      }
      if (typeof patch.bgCustom === 'string') D.config.bgCustom = patch.bgCustom;
      save();
      return true;
    },
    strings: async () => JSON.parse(JSON.stringify(STRINGS)),
    projects: async () => D.projects.filter(p => !p.archived).map(p => taskStats(parseArrays({ ...p }))),
    getProject: async (id) => { const p = D.projects.find(x => x.id === id); return p ? taskStats(parseArrays({ ...p })) : null; },
    saveProject: async (data) => {
      const now = new Date().toISOString();
      const norm = (d) => ({
        ...d,
        done: d.done ? 1 : 0,
        links: d.links || [], wallets: d.wallets || [],
        x_accounts: d.x_accounts || [], emails: d.emails || [],
        tasks: (d.tasks || []).map(t => ({ id: t.id ?? uid(), text: t.text, deadline: t.deadline || '', done: t.done ? 1 : 0, url: t.url || '' }))
      });
      let saved;
      if (data.id) {
        const i = D.projects.findIndex(p => p.id === data.id);
        saved = norm({ ...(i >= 0 ? D.projects[i] : {}), ...data, updated_at: now });
        if (i >= 0) D.projects[i] = saved;
        else { saved.id = data.id; saved.created_at = now; D.projects.push(saved); }
      } else {
        saved = norm({ ...data, id: uid(), created_at: now, updated_at: now, archived: 0 });
        D.projects.push(saved);
      }
      save();
      return taskStats(parseArrays({ ...saved }));
    },
    deleteProject: async (id) => { D.projects = D.projects.filter(p => p.id !== id); save(); return true; },
    toggleProject: async (id, done) => {
      const p = D.projects.find(x => x.id === id);
      if (p) { p.done = done ? 1 : 0; if (p.tasks) p.tasks.forEach(t => t.done = done ? 1 : 0); p.updated_at = new Date().toISOString(); }
      save(); return true;
    },
    toggleTask: async (projectId, taskId, done) => {
      const p = D.projects.find(x => x.id === projectId);
      const t = p && (p.tasks || []).find(x => x.id === taskId);
      if (t) t.done = done ? 1 : 0;
      save(); return true;
    },
    toggleAllTasks: async (projectId, done) => {
      const p = D.projects.find(x => x.id === projectId);
      if (p) { p.done = done ? 1 : 0; if (p.tasks) p.tasks.forEach(t => t.done = done ? 1 : 0); }
      save(); return true;
    },
    setIcon: async (id, icon) => {
      const p = D.projects.find(x => x.id === id);
      if (p) { p.icon = icon || null; p.updated_at = new Date().toISOString(); save(); }
      return true;
    },
    // optional `file` argument = injected selection (tests); no arg = system picker
    pickIcon: async (file) => {
      try {
        const f = file || await pickFile('image/*');
        if (!f) return null;                          // user cancelled
        return await resizeDataUrl(f, 256, 'image/png');
      } catch (e) { return { error: String(e && e.message || e) }; }
    },
    pickBg: async (file) => {
      try {
        const f = file || await pickFile('image/*');
        if (!f) return null;                          // user cancelled
        return await resizeDataUrl(f, 1600, 'image/jpeg', 0.8);
      } catch (e) { return { error: String(e && e.message || e) }; }
    },
    deadlines: async () => D.projects.filter(p => !p.archived).flatMap(p =>
      (p.tasks || []).filter(t => t.deadline).map(t => ({
        id: t.id, text: t.text, deadline: t.deadline, done: !!t.done,
        pid: p.id, pname: p.name, picon: p.icon || null,
        // aliases kept for any code paths still reading the old names
        projectId: p.id, projectName: p.name
      }))),
    stats: async () => {
      const rows = D.projects.filter(p => !p.archived);
      const cats = {}, nets = {}, ranks = {};
      for (const p of rows) {
        const proj = parseArrays({ ...p });
        for (const c of proj.category) cats[c] = (cats[c] || 0) + 1;
        for (const n of proj.network) nets[n] = (nets[n] || 0) + 1;
        const r = (proj.rank || '').trim();
        if (r) ranks[r] = (ranks[r] || 0) + 1;
      }
      const desc = (obj) => Object.entries(obj).map(([k, c]) => ({ k, c })).sort((a, b) => b.c - a.c);
      const rankOrder = ['S', 'A', 'B', 'C', 'D'];
      return {
        total: rows.length,
        done: rows.filter(p => projectIsDone(p)).length,
        categories: desc(cats),
        networks: desc(nets),
        ranks: rankOrder.filter(r => ranks[r]).map(k => ({ k, c: ranks[k] }))
      };
    },
    // backup: user picks WHERE via the system save picker (SAF
    // ACTION_CREATE_DOCUMENT through AndroidBridge); restore: user picks WHICH
    // FILE via the system open picker. Cancel on either side is silent.
    backup: async () => {
      try {
        const stamp = new Date().toISOString().slice(0, 10);
        return await bridgeSave(`slavedrop-backup-${stamp}.json`, 'application/json',
          toBase64(JSON.stringify(D, null, 2)));
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    },
    restore: async (file) => {
      try {
        const f = file || await pickFile('application/json,.json');
        if (!f) return { ok: false };                 // user cancelled
        const txt = await readFileText(f);
        let parsed;
        try { parsed = JSON.parse(txt); } catch (e) { return { ok: false, error: 'invalid JSON' }; }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)
            || typeof parsed.config !== 'object' || !parsed.config) {
          return { ok: false, error: 'not a SlaveDrop backup' };
        }
        D = { config: { ...seed().config, ...parsed.config }, projects: parsed.projects };
        migrate();
        return { ok: true, path: f.name || 'backup' };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    },
    // On Android the bridge shows the system browser chooser (user picks which
    // browser every time); desktop falls back to window.open / Electron shell.
    openUrl: async (url) => {
      if (!url) return true;
      if (window.AndroidBridge && window.AndroidBridge.openUrl) {
        window.AndroidBridge.openUrl(String(url));
        return true;
      }
      window.open(url, '_blank');
      return true;
    },
    openX: async (u) => { if (u) return await window.api.openUrl('https://x.com/' + u); return true; },
    parseX: async (v) => String(v || '').trim().replace(/^@/, ''),
    copy: async (text) => {
      try { await navigator.clipboard.writeText(String(text || '')); } catch (e) {
        try {
          const ta = document.createElement('textarea');
          ta.value = String(text || ''); document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove();
        } catch (e2) { /* clipboard blocked in WebView without user gesture */ }
      }
      return true;
    }
  };

  console.log('[CAPACITOR-MOCK] API initialized');
})();
