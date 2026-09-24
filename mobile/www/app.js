/* ============================================================
   Airdrop Tracker - app logic (vanilla JS, no framework)
   ============================================================ */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s ?? '').trim();

const state = {
  projects: [],
  deadlines: [],
  options: { categories: [], networks: [], walletLabels: [] },
  filter: { q: '', network: '', category: '', rank: '', todoOnly: false },
  calCursor: null,
  calCollapsed: true,  // mobile default: collapsed
  compact: false,
  selectedDate: null,  // currently selected date in calendar (for toggle)
  detailId: null,
  editing: null,
  t: {},        // active locale strings
  locale: 'en',
  theme: 'dark',
  skin: 'base',       // base | paper | aurora | crt
  bgPreset: 'aurora', // none | aurora | nebula | ember | forest | custom
  bgCustom: ''        // file:// path to user image (bgPreset=custom)
};

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = iso(TODAY);
const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// UI fallbacks in case the config row is missing
const DEFAULT_RANKS_UI = ['S', 'A', 'B', 'C', 'D'];
const DEFAULT_STATUSES_UI = ['Ongoing', 'TGE', 'Completed', 'Eligible', 'Ineligible'];
const DEFAULT_PLATFORMS_UI = ['X', 'Desktop', 'App', 'Extension'];
const DEFAULT_WALLET_APPS_UI = ['MetaMask', 'OKX Wallet', 'Phantom', 'Rabby', 'Keplr', 'Binance'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ---------- toast ----------
function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.innerHTML = skinIcons(`<i class="ph ${isErr ? 'ph-warning-circle' : 'ph-check-circle'}"></i><span>${esc(msg)}</span>`);
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 2600);
}

// ---------- data ----------
async function refresh() {
  const [projects, options, stats, deadlines, settings, strings] = await Promise.all([
    window.api.projects(),
    window.api.options(),
    window.api.stats(),
    window.api.deadlines(),
    window.api.settingsGet(),
    window.api.strings()
  ]);
  state.projects = projects || [];
  state.options = options || { categories: [], networks: [], walletLabels: [] };
  state.deadlines = deadlines || [];
  if (settings) {
    state.theme = settings.theme; state.locale = settings.locale;
    state.skin = settings.skin || 'base';
    state.bgPreset = settings.bgPreset || 'aurora';
    state.bgCustom = settings.bgCustom || '';
  }
  state.t = (strings && strings[state.locale]) ? strings[state.locale] : (strings ? strings.en : {});
  applyTheme();
  applySkin();
  renderStaticLabels();
  renderDaily(stats);
  renderFilterDropdowns(stats);
  // calendar sits at the top of the dashboard, projects below it — one page
  renderCalendar();
  renderGrid();
  if (state.detailId) renderDetail();
}

// ---------- theme ----------
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('html').dataset.theme = state.theme;
}

// ---------- skin (theme packs) ----------
// icon name -> symbol id per skin; base = original Phosphor set
const ICONS = {
  'warning-circle':  {base:'i-ph-check-circle',   paper:'i-iconoir-warning-triangle-outline', aurora:'i-lucide-alert-circle',  crt:'i-lucide-alert-circle'},
  'check-circle':    {base:'i-ph-check-circle',   paper:'i-iconoir-check',          aurora:'i-lucide-check-circle',  crt:'i-lucide-check-circle'},
  'funnel':          {base:'i-ph-funnel',        paper:'i-ph-funnel',              aurora:'i-ph-funnel',            crt:'i-ph-funnel'},
  'caret-down':      {base:'i-ph-caret-down',    paper:'i-ph-caret-down',          aurora:'i-ph-caret-down',        crt:'i-ph-caret-down'},
  'caret-up':        {base:'i-ph-caret-up',      paper:'i-ph-caret-up',            aurora:'i-ph-caret-up',          crt:'i-ph-caret-up'},
  'caret-left':      {base:'i-ph-caret-left',    paper:'i-ph-caret-left',          aurora:'i-ph-caret-left',        crt:'i-ph-caret-left'},
  'caret-right':     {base:'i-ph-caret-right',   paper:'i-ph-caret-right',         aurora:'i-ph-caret-right',       crt:'i-ph-caret-right'},
  'image':           {base:'i-ph-image',         paper:'i-ph-image',               aurora:'i-ph-image',             crt:'i-ph-image'},
  'rocket-launch':   {base:'i-ph-list',           paper:'i-iconoir-feather',        aurora:'i-lucide-feather',       crt:'i-lucide-feather'},
  'plus':            {base:'i-ph-plus',           paper:'i-iconoir-plus',           aurora:'i-lucide-plus',          crt:'i-lucide-plus'},
  'magnifying-glass':{base:'i-ph-magnifying-glass',paper:'i-ph-magnifying-glass',   aurora:'i-ph-magnifying-glass',  crt:'i-ph-magnifying-glass'},
  'wallet':          {base:'i-ph-wallet',         paper:'i-ph-wallet',              aurora:'i-ph-wallet',            crt:'i-ph-wallet'},
  'globe':           {base:'i-ph-globe',          paper:'i-ph-globe',               aurora:'i-ph-globe',             crt:'i-ph-globe'},
  'x-logo':          {base:'i-ph-x-logo',         paper:'i-ph-x-logo',              aurora:'i-ph-x-logo',            crt:'i-ph-x-logo'},
  'arrow-square-out':{base:'i-ph-arrow-square-out', paper:'i-ph-arrow-square-out',  aurora:'i-ph-arrow-square-out',  crt:'i-ph-arrow-square-out'},
  'dots-three-vertical': {base:'i-ph-dots-three-vertical', paper:'i-iconoir-more-vert', aurora:'i-lucide-more-vertical', crt:'i-lucide-more-vertical'},
  'clock':           {base:'i-ph-clock',         paper:'i-ph-clock',               aurora:'i-ph-clock',             crt:'i-ph-clock'},
  'copy':            {base:'i-lucide-copy',       paper:'i-iconoir-copy',           aurora:'i-lucide-copy',          crt:'i-lucide-copy'},
  'x':               {base:'i-ph-x',              paper:'i-iconoir-x',         aurora:'i-lucide-x',             crt:'i-lucide-x'},
  'pencil-simple':   {base:'i-ph-pencil-simple',  paper:'i-iconoir-pencil',            aurora:'i-lucide-pencil',        crt:'i-lucide-pencil'},
  'upload-simple':   {base:'i-lucide-upload',     paper:'i-iconoir-upload',         aurora:'i-lucide-upload',        crt:'i-lucide-upload'},
  'eraser':          {base:'i-lucide-pen-tool',   paper:'i-iconoir-pencil',            aurora:'i-lucide-pen-tool',      crt:'i-lucide-pen-tool'},
  'check':           {base:'i-lucide-check',      paper:'i-iconoir-check',          aurora:'i-lucide-check',         crt:'i-lucide-check'},
  'list':            {base:'i-ph-list',           paper:'i-iconoir-list',           aurora:'i-lucide-list',          crt:'i-lucide-list'},
  'squares-four':    {base:'i-ph-squares-four',   paper:'i-iconoir-layout-grid',      aurora:'i-lucide-layout-grid',   crt:'i-lucide-layout-grid'},
  'rows':            {base:'i-ph-list',           paper:'i-iconoir-list',           aurora:'i-lucide-list',          crt:'i-lucide-list'},
  'sun':             {base:'i-ph-sun',            paper:'i-iconoir-sun-light',      aurora:'i-lucide-sun',           crt:'i-lucide-sun'},
  'moon':            {base:'i-ph-moon',           paper:'i-iconoir-half-moon',      aurora:'i-lucide-moon',          crt:'i-lucide-moon'},
  'trash':           {base:'i-ph-trash',          paper:'i-iconoir-trash',          aurora:'i-lucide-trash',         crt:'i-lucide-trash'},
  'download-simple': {base:'i-lucide-download',   paper:'i-iconoir-download',       aurora:'i-lucide-download',      crt:'i-lucide-download'},
  'timer':           {base:'i-lucide-timer',      paper:'i-iconoir-timer',          aurora:'i-lucide-timer',         crt:'i-lucide-timer'},
  'calendar-blank':  {base:'i-ph-calendar-blank', paper:'i-iconoir-calendar',       aurora:'i-lucide-calendar',      crt:'i-lucide-calendar'}
};

// sprite ids do not always map 1:1 onto phosphor glyph names (e.g. lucide
// "search" ↔ phosphor "magnifying-glass"). Without this, re-skinning back to
// Default produces ph-search which is not in the font and renders 0×0.
const PH_ALIAS = {
  search: 'magnifying-glass',
  filter: 'funnel',
  'arrow-left': 'caret-left',
  'arrow-right': 'caret-right',
  'arrow-up': 'caret-up',
  'arrow-down': 'caret-down',
  'chevron-down': 'caret-down',
  'chevron-up': 'caret-up',
  journal: 'notebook',
  'terminal-simple': 'terminal',
  'mountain-snow': 'mountains',
};

// map phosphor glyph -> svg icon element for the active skin.
// The svg carries data-icon (the canonical phosphor name) so reskinDom can
// swap it back/forth without guessing from the sprite id (several phosphor
// names share one sprite symbol).
// Canonical (Default) glyph set is Phosphor font for every skin. ICONS map
// entries that point at i-ph-* render as <i> in ALL skins — the Default icon
// stays Default. Other entries still use the svg sprite per skin.
const DEFAULTER = new Set(Object.keys(ICONS).filter(n => ICONS[n].base.startsWith('i-ph-')));

function icon(name) {
  if (state.skin === 'base' || DEFAULTER.has(name))
    return `<i class="ph ph-${PH_ALIAS[name] || name}" data-icon="${name}"></i>`;
  const id = (ICONS[name] && ICONS[name][state.skin]) || `i-lucide-${name}`;
  return `<svg class="si" data-icon="${name}" aria-hidden="true" viewBox="0 0 24 24" width="15" height="15"><use href="#${id}"/></svg>`;
}

function applySkin() {
  document.documentElement.dataset.skin = state.skin;
  document.documentElement.dataset.bg = state.skin === 'aurora' ? state.bgPreset : 'none';
  document.body.dataset.skin = state.skin;
  document.documentElement.style.setProperty('--bg-img', state.bgCustom && state.skin === 'aurora' ? `url("${state.bgCustom.startsWith('data:') ? state.bgCustom : 'file://' + state.bgCustom}")` : 'none');
  reskinDom();
  renderBgRow();
  syncHeaderMenu();
}

// swap all <i class="ph ph-x"> in a freshly-rendered html string for svg icons
function skinIcons(html) {
  if (state.skin === 'base') return html;
  return html.replace(/<i class="ph(?: ph-([a-z0-9-]+))?"?\s*(?:style="[^"]*")?\s*(?:data-icon="[^"]*")?\s*><\/i>/g,
    (m, n) => n ? icon(n) : m);
}

// re-skin icons already in the DOM (static header/calendar/menu markup).
// Two-way: svg -> phosphor <i> for base, phosphor <i> -> svg for other skins.
// The svg-based skins carry the icon name on the <use> href (#i-...-name); the
// phosphor set carries it on the class (ph ph-name). Both directions must be
// handled or switching back to Default leaves svg icons from the previous skin
// stuck in the header/calendar/search/card-menu until the app is restarted.
function reskinDom() {
  // Theme-picker swatches keep their own icon in every skin — each preview
  // must stay recognizable, so they are never re-skinned.
  const pickable = el => !el.closest('.skin-btn');
  // svg -> phosphor <i> (back to Default) — use the canonical name on data-icon
  document.querySelectorAll('svg.si[data-icon]').forEach(el => {
    if (state.skin === 'base' && pickable(el)) el.outerHTML = icon(el.dataset.icon);
  });
  // phosphor <i> -> svg (other skins)
  document.querySelectorAll('i.ph[data-icon]').forEach(el => {
    if (state.skin !== 'base' && pickable(el)) el.outerHTML = icon(el.dataset.icon);
  });
  // legacy icons without data-icon (pre-existing DOM): fall back to sprite-id matching
  document.querySelectorAll('svg.si:not([data-icon])').forEach(el => {
    const id = el.querySelector('use')?.getAttribute('href') || '';
    const m = id.match(/^#?i-(?:lucide|iconoir|ph)-(.+)$/);
    if (m && state.skin === 'base' && pickable(el)) el.outerHTML = icon(m[1]);
  });
  document.querySelectorAll('i.ph:not([data-icon])').forEach(el => {
    const n = [...el.classList].find(c => c.startsWith('ph-'))?.slice(3);
    if (n && state.skin !== 'base' && pickable(el)) el.outerHTML = icon(n);
  });
}

// ---------- locale ----------
// strings come as plain templates like "{a} of {b} tasks done"; fill them in here
const t = (key, ...vals) => {
  let v = state.t[key] ?? key;
  if (typeof v === 'string') {
    // positional: {0}, {1} ... and named: {a}, {b}, {n}, {v}
    v = v.replace(/\{(\w)\}/g, (_, k) => {
      const named = { a: vals[0], b: vals[1], n: vals[0], v: vals[0] };
      return (named[k] !== undefined ? String(named[k]) : `{${k}}`);
    });
  }
  return v;
};

function matches(p) {
  const f = state.filter;
  if (f.network && !(p.network || []).includes(f.network)) return false;
  if (f.category && !(p.category || []).includes(f.category)) return false;
  if (f.rank && p.rank !== f.rank) return false;
  if (f.todoOnly && p.done) return false;
  const q = f.q.toLowerCase();
  if (!q) return true;
  const parts = [p.name, p.website, p.x_account, p.note, p.rank, p.status, p.cost, p.wallet_app,
    ...(p.category || []), ...(p.network || []), ...(p.platform || []), ...(p.chains || [])];
  for (const t of (p.tasks || [])) parts.push(t.text);
  for (const w of (p.wallets || [])) parts.push(w.address, w.label || '');
  for (const x of (p.x_accounts || [])) parts.push(x.username);
  for (const e of (p.emails || [])) parts.push(e.email);
  for (const l of (p.links || [])) parts.push(l.url, l.label || '');
  return parts.join(' ').toLowerCase().includes(q);
}

// ---------- sidebar ----------
function allTasksDone(p) {
  if (p.done) return true;
  if (!p.task_total) return false;
  return p.task_done >= p.task_total;
}

function rankTone(r) {
  return { S: 'rank-s', A: 'rank-a', B: 'rank-b', C: 'rank-c', D: 'rank-d' }[r] || 'rank-none';
}

// ---------- daily progress strip (was sidebar stats) ----------
function renderDaily(stats) {
  if (!stats) return;
  // daily progress = done projects / total projects (all cards, including 0-task ones)
  const totalProjects = stats.total || 0;
  const doneProjects = stats.done || 0;
  const pct = totalProjects ? Math.round((doneProjects / totalProjects) * 100) : 0;
  $('#daily-strip').innerHTML = `
    <span class="d-label">${t('dailyProgress')}</span>
    <span class="d-counts">${doneProjects}/${totalProjects} ${t('projects')}</span>
    <span class="d-pct mono">${pct}%</span>
    <div class="bar d-bar"><i style="width:${pct}%"></i></div>`;
}

// ---------- filter dropdowns (network / rank / category) ----------
// one shared renderer: trigger shows the active value, popover lists every
// option with counts; selecting closes the popover and refreshes.
const FILTER_DD = [
  { id: 'net', key: 'network', allLabel: () => t('allNetworks'), label: () => t('network'), items: s => s.networks, fmt: v => v },
  { id: 'rank', key: 'rank', allLabel: () => t('allRanks'), label: () => t('rank'), items: s => s.ranks, fmt: v => 'Rank ' + v },
  { id: 'cat', key: 'category', allLabel: () => t('allCategories'), label: () => t('category'), items: s => s.categories, fmt: v => v },
];

function renderFilterDropdowns(stats) {
  if (!stats) return;
  for (const dd of FILTER_DD) {
    const btn = $('#dd-' + dd.id + '-btn');
    const pop = $('#dd-' + dd.id + '-pop');
    if (!btn || !pop) continue;
    const cur = state.filter[dd.key];
    btn.innerHTML = skinIcons(`<i class="ph ph-funnel"></i> ${cur ? esc(dd.fmt(cur)) : esc(dd.allLabel())} <i class="ph ph-caret-down" style="font-size:11px"></i>`);
    btn.classList.toggle('on', !!cur);
    pop.innerHTML = [{ k: '', c: stats.total }, ...(dd.items(stats) || [])]
      .map(o => `<button type="button" class="dd-item ${cur === o.k ? 'on' : ''}" data-ddk="${esc(dd.key)}" data-val="${esc(o.k)}">${o.k ? esc(dd.fmt(o.k)) : esc(dd.allLabel())}<span class="n">${o.c}</span></button>`).join('');
    $$('.dd-item', pop).forEach(b => b.onclick = () => {
      state.filter[dd.key] = b.dataset.val;
      pop.hidden = true;
      refresh();
    });
  }
}

// ---------- icons ----------
function iconHtml(p, big = false) {
  if (p.icon) {
    return `<img class="picon" src="${esc(p.icon).replace(/"/g, '')}" alt="" onerror="this.style.display='none'">`;
  }
  return `<span class="picon-empty"><i class="ph ph-image"></i></span>`;
}

// ---------- project cards (grid; .compact = single-line rows) ----------
function renderGrid() {
  // stable order: creation order (id) first, then rank S → D as a secondary tiebreak.
  // Toggling done must never reshuffle the cards the user is looking at.
  const rankOrder = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  const list = state.projects.filter(matches).slice().sort((a, b) => {
    const ra = rankOrder[a.rank] ?? 99, rb = rankOrder[b.rank] ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  const grid = $('#grid');
  grid.classList.toggle('compact', state.compact);

  if (!state.projects.length) {
    grid.innerHTML = skinIcons(`
      <div class="empty">
        <div class="glyph"><i class="ph ph-rocket-launch"></i></div>
        <h3>${t('noProjects')}</h3>
        <p>${t('noProjectsHint')}</p>
        <button class="btn btn-primary" data-hook="add"><i class="ph ph-plus"></i> ${t('addProject')}</button>
      </div>`);
    return;
  }

  if (!list.length) {
    grid.innerHTML = skinIcons(`
      <div class="empty">
        <div class="glyph"><i class="ph ph-magnifying-glass"></i></div>
        <h3>${t('noMatches')}</h3>
        <p>${t('noProjectsHint')}</p>
        <button class="btn" data-hook="clear">${t('clearFilters')}</button>
      </div>`);
    return;
  }

  grid.innerHTML = skinIcons(list.map(cardHtml).join(''));
  wireCards();
}

function cardHtml(p) {
  const tags = [];
  if (p.rank) tags.push(`<span class="tag rank-tag ${rankTone(p.rank)}">Rank ${esc(p.rank)}</span>`);
  if (p.status) tags.push(`<span class="tag status-tag">${esc(p.status)}</span>`);
  for (const c of (p.category || [])) tags.push(`<span class="tag cat-tag">${esc(c)}</span>`);
  if (p.cost) tags.push(`<span class="tag cost-tag">${esc(p.cost)}</span>`);
  for (const c of (p.network || [])) tags.push(`<span class="tag chain-tag">${esc(c)}</span>`);
  for (const c of (p.platform || [])) tags.push(`<span class="tag pf-tag">${esc(c)}</span>`);
  if (p.wallet_app) tags.push(`<span class="tag pf-tag"><i class="ph ph-wallet"></i> ${esc(p.wallet_app)}</span>`);

  const links = [];
  if (p.website) links.push(`<button class="link-btn" data-act="web"><i class="ph ph-globe"></i> Website</button>`);
  if (p.x_account) links.push(`<button class="link-btn" data-act="x"><i class="ph ph-x-logo"></i> ${esc(p.x_account)}</button>`);

  const identRows = [];
  if (p.wallets?.length) identRows.push(`<div class="ident-row"><span class="k">Wallets</span><span class="v" title="${esc(p.wallets.map(w => w.address).join(', '))}">${esc(shorten(p.wallets.map(w => w.address).join(', '), 48))}</span></div>`);
  if (p.x_accounts?.length) identRows.push(`<div class="ident-row"><span class="k">X</span><span class="v">@${esc(p.x_accounts.map(x => x.username).join(' @'))}</span></div>`);
  if (p.emails?.length) identRows.push(`<div class="ident-row"><span class="k">Email</span><span class="v">${esc(p.emails.map(e => e.email).join(', '))}</span></div>`);

  const taskRows = (p.tasks || []).map(t2 => `
    <label class="task-row ${t2.done ? 'done' : ''}">
      <input type="checkbox" class="cbx" data-tid="${t2.id}" ${t2.done ? 'checked' : ''}>
      <span>${esc(t2.text)}</span>
      ${t2.url ? `<button class="task-link" data-act="tasklink" data-url="${esc(t2.url)}" title="Open ${esc(t2.url)}"><i class="ph ph-arrow-square-out"></i></button>` : ''}
      ${dlBadge(t2)}
    </label>`).join('');

  const pp = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;

  return `
  <div class="card ${allTasksDone(p) ? 'done' : ''}" data-id="${p.id}">
    <div class="card-top">
      ${iconHtml(p)}
      <h3 class="card-title ${allTasksDone(p) ? 'done-text' : ''}">${esc(p.name)}</h3>
      <div class="card-menu">
        <button class="btn btn-ghost btn-icon" data-act="menu" title="More"><i class="ph ph-dots-three-vertical"></i></button>
      </div>
    </div>
    <div class="card-meta">${tags.join('')}</div>
    <div class="card-links">${links.join('')}</div>
    <div class="card-ident">${identRows.join('')}</div>
    <div class="card-tasks">${taskRows}</div>
    <div class="card-foot">
      <label class="cbx-daily" title="Check all tasks done">
        <input type="checkbox" class="cbx cbx-daily" data-tid="0" ${(p.tasks && p.tasks.length > 0) ? (p.tasks.every(t => t.done) ? 'checked' : '') : (p.done ? 'checked' : '')}>
      </label>
      <span class="spacer"></span>
      <span class="task-count">${p.task_done}/${p.task_total} ${t('tasks')}</span>
      <span class="mini-bar" title="${pp}% of tasks done"><i style="width:${pp}%"></i></span>
    </div>
  </div>`;
}

function wireCards() {
  $$('#grid .card').forEach(card => {
    const id = Number(card.dataset.id);
    const p = state.projects.find(x => x.id === id);

    // open the detail panel only when the title row itself is clicked — the
    // rest of the card must not be a giant click target competing with the
    // checkbox and other controls.
    const head = $('.card-top', card);
    if (head) head.addEventListener('click', (e) => {
      if (e.target.closest('button, input, label, a, .card-menu')) return;
      openDetail(id);
    });

    // task toggles
    $$('input.cbx', card).forEach(cb => cb.onchange = async (e) => {
      if (cb.classList.contains('cbx-daily')) {
        // Daily checkbox = toggle project done (all cards including 0-task)
        await window.api.toggleProject(id, e.target.checked);
      } else if (cb.classList.contains('cbx-done')) {
        // Detail panel done checkbox = toggle project done flag
        await window.api.toggleProject(id, e.target.checked);
      } else {
        // Regular task checkbox = toggle single task
        await window.api.toggleTask(id, Number(cb.dataset.tid), e.target.checked);
      }
      refresh();
    });

    // actions: website/x links, task links, 3-dot menu
    $$('[data-act]', card).forEach(btn => btn.onclick = (e) => {
      if (btn.dataset.act === 'menu') return;
      if (btn.dataset.act === 'tasklink') { e.preventDefault(); e.stopPropagation(); return window.api.openUrl(btn.dataset.url); }
      e.stopPropagation();
      cardAction(btn.dataset.act, p);
    });

    // 3-dot menu: one shared dropdown that lives in <body> permanently, so
    // re-rendering the grid (e.g. after a checkbox toggle) can never orphan it.
    const menuBtn = $('[data-act="menu"]', card);
    if (menuBtn) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        const pop = $('#card-menu');
        if (pop.dataset.open === '1') return closeCardMenu();
        pop.dataset.open = '1';
        pop.dataset.pid = String(id);
        pop.hidden = false;
        positionMenu(menuBtn, pop);
        pop.onclick = (ev2) => ev2.stopPropagation();
      };
    }
  });
}

// close open card menu when clicking elsewhere
document.addEventListener('click', () => {
  closeCardMenu();
  $$('.dd-pop').forEach(p => p.hidden = true);
});

// position the shared menu under (or above) its trigger, flipping when there
// isn't room, and clamping to the viewport edges.
function positionMenu(btn, pop) {
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = r.right - pw;
  let top = r.bottom + 6;
  // flip up when there's no room below
  if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;
  // clamp horizontally and vertically so the menu is never off-screen
  if (left < 8) left = 8;
  if (left + pw > vw - 8) left = vw - pw - 8;
  if (top < 8) top = 8;
  if (top + ph > vh - 8) top = vh - ph - 8;
  pop.style.left = left + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}

function closeCardMenu() {
  const pop = $('#card-menu');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  delete pop.dataset.open;
  delete pop.dataset.pid;
  pop.style.left = '';
  pop.style.top = '';
}

// shared menu actions — bound once, resolve the project from dataset.pid
$$('#card-menu .menu-item').forEach(b => b.onclick = (e) => {
  e.stopPropagation();
  const pid = Number($('#card-menu').dataset.pid);
  const p = state.projects.find(x => x.id === pid);
  closeCardMenu();
  if (p) cardAction(b.dataset.mact, p);
});

// CSP-safe global event delegation for data-hook buttons
// (inline onclick is blocked by script-src 'self')
document.addEventListener('click', (e) => {
  // single-value copy chips in the detail panel
  const cp = e.target.closest('[data-copy]');
  if (cp) { e.stopPropagation(); const [kind, idx] = cp.dataset.copy.split(':'); return window.copyOne(kind, Number(idx)); }

  const btn = e.target.closest('[data-hook]');
  if (!btn) return;
  const h = btn.dataset.hook;
  if (h === 'add') openDrawer(null);
  else if (h === 'clear') window.clearFilters();
  else if (h === 'link' || h === 'openLink') window.api.openUrl(btn.dataset.url);
  else if (h === 'closeDetail') closeDetail();
  else if (h === 'editProject') openDrawer(Number(btn.dataset.id));
  else if (h === 'copyKind') window.copyKind(btn.dataset.kind);
  else if (h === 'closeDrawer') closeDrawer();
});

function dlBadge(t) {
  if (!t.deadline) return '';
  const overdue = !t.done && t.deadline < todayISO;
  const soon = !t.done && !overdue && t.deadline <= iso(new Date(TODAY.getTime() + 3 * 864e5));
  return `<span class="dl-badge ${overdue ? 'overdue' : soon ? 'soon' : ''}"><i class="ph ph-clock"></i> Deadline ${esc(t.deadline)}</span>`;
}

// "2026-09-20T16:15:52.525Z" or "2026-09-20 16:15:24" -> "Sep 20"
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.endsWith('Z') ? s : s.replace(' ', 'T'));
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// full long-form date for the detail panel: "20 September 2026"
// follows the active locale (id-ID / en-US); month is always spelled out.
function fmtFullDate(s) {
  if (!s) return '';
  const d = new Date(s.endsWith('Z') ? s : s.replace(' ', 'T'));
  if (isNaN(d)) return '';
  return d.toLocaleDateString(state.locale === 'id' ? 'id-ID' : 'en-US',
    { day: 'numeric', month: 'long', year: 'numeric' });
}

function ident(kind, label, value) {
  return `<div class="ident-row"><span class="k">${label}</span>
    <span class="v" title="${esc(value)}">${esc(shorten(value, 40))}</span>
    <button class="copy-btn" data-act="copy:${kind}" title="Copy"><i class="ph ph-copy"></i></button></div>`;
}
function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

async function cardAction(act, p) {
  if (act === 'web') return window.api.openUrl(p.website);
  if (act === 'tasklink') return window.api.openUrl(p._taskUrl);
  if (act === 'x') return window.api.openX(p.x_account);
  if (act === 'detail') return openDetail(p.id);
  if (act === 'edit') return openDrawer(p.id);
  if (act === 'icon') {
    const r = await window.api.pickIcon();
    if (!r) return;
    if (r.error) return toast(`Could not import image: ${r.error}`, true);
    await window.api.setIcon(p.id, r);
    toast('Icon updated');
    return refresh();
  }
  if (act === 'del') {
    if (!confirm(t('deleteConfirm', p.name))) return;
    await window.api.deleteProject(p.id);
    if (state.detailId === p.id) closeDetail();
    toast(`${p.name} deleted`);
    return refresh();
  }
  if (act.startsWith('copy:')) {
    const kind = act.split(':')[1];
    const map = {
      wallets: (p.wallets || []).map(w => w.address).join('\n'),
      x: (p.x_accounts || []).map(x => x.username).join('\n'),
      mail: (p.emails || []).map(e => e.email).join('\n')
    };
    window.api.copy(map[kind] || '');
    return toast('Copied to clipboard');
  }
}

window.clearFilters = function () {
  state.filter = { q: '', network: '', category: '', rank: '', todoOnly: false };
  $('#search').value = '';
  $('#filter-todo').classList.remove('on');
  refresh();
};

// ---------- calendar ----------
function renderCalendar() {
  const cur = state.calCursor || new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  state.calCursor = cur;
  $('#cal-title').textContent = `${MON[cur.getMonth()]} ${cur.getFullYear()}`;

  // collapse toggle (persisted in localStorage) hides the day grid only —
  // the deadline list below stays visible
  const strip = $('#cal-strip');
  const tBtn = $('#cal-toggle');
  strip.classList.toggle('collapsed', state.calCollapsed);
  tBtn.innerHTML = skinIcons(`<i class="ph ${state.calCollapsed ? 'ph-caret-up' : 'ph-caret-down'}"></i>`);
  tBtn.title = state.calCollapsed ? 'Expand calendar' : 'Collapse calendar';

  const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
  const startPad = first.getDay();
  const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const lastPad = 6 - new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDay();

  const byDate = {};
  for (const d of state.deadlines) (byDate[d.deadline] ||= []).push(d);

  // Build full month grid with dots
  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<div class="cal-cell pad"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const items = byDate[ds] || [];
    const hasDone = items.some(x => x.done);
    const hasPending = items.some(x => !x.done);
    const dotColor = hasDone && hasPending ? 'mix' : hasDone ? 'done' : hasPending ? 'pending' : '';
    cells += `<div class="cal-cell ${ds === todayISO ? 'today' : ''} ${items.length ? 'has-tasks' : ''}" data-date="${ds}">
      <span class="dnum">${d}</span>
      ${items.length ? `<span class="task-dot ${dotColor}"></span>` : ''}
    </div>`;
  }
  for (let i = 0; i < lastPad; i++) cells += '<div class="cal-cell pad"></div>';
  $('#cal').innerHTML = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('') + cells;

  // Deadline summary: this week only
  const weekStart = new Date(TODAY);
  weekStart.setDate(TODAY.getDate() - TODAY.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekDeadlines = state.deadlines.filter(d => {
    const dd = new Date(d.deadline + 'T00:00:00');
    return dd >= weekStart && dd <= weekEnd;
  });
  $('#cal-list').innerHTML = `<h4>${weekDeadlines.length} DEADLINES THIS WEEK</h4>` +
    (weekDeadlines.length ? weekDeadlines.map(d => `<div class="dl-row ${!d.done && d.deadline < todayISO ? 'overdue' : ''}" data-open="${d.pid}">
      <span class="when">${esc(d.deadline)}</span>
      <span class="who">${esc(d.pname)}</span>
      <span class="what">${esc(d.text)}${d.done ? ' (done)' : ''}</span>
    </div>`).join('') : '<p style="color:var(--fg-3);font-size:13px;margin:0">No deadlines this week. Add a task with a deadline in any project.</p>');

  $$('.cal-strip [data-open]').forEach(el => el.onclick = () => openDetail(Number(el.dataset.open)));
  $$('.cal-cell.has-tasks').forEach(el => {
    el.onclick = () => showDayTasks(el.dataset.date);
  });
}

// Show tasks for a specific day in an expandable section (toggleable)
function showDayTasks(dateStr) {
  // Toggle: if clicking the same date, close it
  if (state.selectedDate === dateStr) {
    state.selectedDate = null;
    const existing = $('#cal-day-detail');
    if (existing) existing.remove();
    // Remove selected class from all cells
    $$('.cal-cell.selected').forEach(c => c.classList.remove('selected'));
    return;
  }
  // Otherwise open new date
  state.selectedDate = dateStr;
  $$('.cal-cell.selected').forEach(c => c.classList.remove('selected'));
  const cell = $(`.cal-cell[data-date="${dateStr}"]`);
  if (cell) cell.classList.add('selected');
  
  const items = state.deadlines.filter(d => d.deadline === dateStr);
  if (!items.length) return;
  const existing = $('#cal-day-detail');
  if (existing) existing.remove();
  const sec = document.createElement('div');
  sec.id = 'cal-day-detail';
  sec.innerHTML = `<div class="day-detail">
    <h4>${new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
    ${items.map(d => `<div class="dl-row ${d.done ? 'done' : ''}" data-open="${d.projectId}">
      <span class="who">${esc(d.projectName)}</span>
      <span class="what">${esc(d.text)}</span>
    </div>`).join('')}
  </div>`;
  $('#cal-list').before(sec);
  $$('#cal-day-detail [data-open]').forEach(el => el.onclick = () => openDetail(Number(el.dataset.open)));
}

// ---------- header hamburger menu (language / theme / backup / restore) ----------
function syncHeaderMenu() {
  $$('[data-locale]').forEach(b => b.classList.toggle('on', b.dataset.locale === state.locale));
  const th = $('#m-theme');
  if (th) {
    th.title = state.theme === 'dark' ? 'Switch to light' : 'Switch to dark';
    th.innerHTML = skinIcons(`<i class="ph ${state.theme === 'dark' ? 'ph-sun' : 'ph-moon'}"></i>`);
  }
  $$('[data-skin]').forEach(b => b.classList.toggle('on', b.dataset.skin === state.skin));
  const bgRow = $('#m-bg-row');
  if (bgRow && !bgRow.hidden) {   // only populated while skin is aurora
    $$('[data-bg]', bgRow).forEach(b => {
      const on = b.dataset.bg === state.bgPreset || (b.dataset.bg === 'custom' && state.bgPreset === 'custom' && !!state.bgCustom);
      b.classList.toggle('on', on);
    });
  }
}

// ---------- detail panel ----------
function openDetail(id) {
  state.detailId = id;
  renderDetail();
  $('#detail').classList.add('on');
  $('#detail').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
}
function closeDetail() {
  state.detailId = null;
  $('#detail').classList.remove('on');
  $('#detail').setAttribute('aria-hidden', 'true');
  if (!$('#drawer').classList.contains('on') && !$('#detail').classList.contains('on')) $('#scrim').classList.remove('on');
}
function renderDetail() {
  const p = state.projects.find(x => x.id === state.detailId);
  if (!p) return closeDetail();
  const links = (p.links || []).filter(l => l.url);
  const d = $('#detail');

  const secLinks = links.length ? `<div class="sec"><h4>Links</h4>
    <div class="chip-row">${links.map(l => `
      <button class="chip copy-chip" data-hook="openLink" data-url="${esc(l.url)}" title="${esc(l.url)}">${esc(l.label || shorten(l.url, 28))}</button>`).join('')}
    </div></div>` : '';

  const pNets = (p.network || []).length ? p.network : (p.chains || []);
  const pp = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0;

  d.innerHTML = skinIcons(`
    <div class="drawer-head">
      <button class="btn btn-ghost btn-icon" data-hook="closeDetail"><i class="ph ph-x"></i></button>
      ${iconHtml(p)}
      <h2>${esc(p.name)}</h2>
      <button class="btn btn-sm" data-hook="editProject" data-id="${p.id}"><i class="ph ph-pencil-simple"></i> ${t('edit')}</button>
    </div>
    <div class="drawer-body">
      <div class="sec">
        <h4>${t('status')}</h4>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--fg-1)">
            <input type="checkbox" class="cbx" id="d-done" ${p.done ? 'checked' : ''}> ${t('markedDone')}
          </label>
          ${p.rank ? `<span class="tag rank-tag ${rankTone(p.rank)}">Rank ${esc(p.rank)}</span>` : ''}
          ${p.status ? `<span class="tag status-tag">${esc(p.status)}</span>` : ''}
          ${p.cost ? `<span class="tag cost-tag">${esc(p.cost)}</span>` : ''}
          ${(p.platform || []).map(v => `<span class="tag pf-tag">${esc(v)}</span>`).join('')}
          ${p.wallet_app ? `<span class="tag pf-tag">${esc(p.wallet_app)}</span>` : ''}
        </div>
        ${pNets.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${pNets.map(c => `<span class="tag chain-tag">${esc(c)}</span>`).join('')}</div>` : ''}
        <div class="detail-dates">
          <span>${t('created')} ${esc(fmtFullDate(p.created_at))}</span>
          <span>${t('lastEdited')} ${esc(fmtFullDate(p.updated_at))}</span>
        </div>
      </div>

      <div class="sec">
        <h4>${t('taskProgress')}</h4>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--fg-2);margin-bottom:6px">
          <span>${t('taskDoneOf', p.task_done, p.task_total)}</span>
          <b class="mono">${pp}%</b>
        </div>
        <div class="bar"><i style="width:${pp}%"></i></div>
      </div>

      ${secLinks}

      <div class="sec"><h4>${t('identities')}</h4>
        ${identList('Wallets', p.wallets?.map(w => `${w.label ? w.label + ': ' : ''}${w.address}`), 'wallets')}
        ${identList('X accounts', p.x_accounts?.map(x => '@' + x.username), 'x')}
        ${identList('Emails', p.emails?.map(e => e.email), 'mail')}
      </div>

      <div class="sec"><h4>${t('tasks')}</h4>
        ${(p.tasks || []).length ? p.tasks.map(t2 => `
          <label class="task-row ${t2.done ? 'done' : ''}">
            <input type="checkbox" class="cbx" data-tid="${t2.id}" ${t2.done ? 'checked' : ''}>
            <span>${esc(t2.text)}</span>
            ${t2.url ? `<button class="task-link" data-url="${esc(t2.url)}" title="Open ${esc(t2.url)}"><i class="ph ph-arrow-square-out"></i></button>` : ''}
            ${dlBadge(t2)}
          </label>`).join('') : `<p style="margin:0;color:var(--fg-3);font-size:13px">${t('noTasks')}</p>`}
      </div>

      ${p.note ? `<div class="sec"><h4>${t('note')}</h4><div class="note-box">${esc(p.note)}</div></div>` : ''}
    </div>`);

  const doneCb = $('#d-done');
  if (doneCb) doneCb.onchange = async (e) => {
    await window.api.toggleProject(p.id, e.target.checked);
    toast(e.target.checked ? `${p.name} marked done` : `${p.name} reopened`);
    refresh();
  };
  $$('#detail .task-row .cbx').forEach(cb => cb.onchange = async (e) => {
    await window.api.toggleTask(p.id, Number(cb.dataset.tid), e.target.checked);
    refresh();
  });
  $$('#detail .task-link').forEach(b => b.onclick = () => window.api.openUrl(b.dataset.url));
}

function identList(label, arr, kind) {
  if (!arr || !arr.length) return '';
  return `<div class="sec" style="gap:6px">
    <span style="font-size:11px;color:var(--fg-3);text-transform:uppercase;letter-spacing:.05em;font-weight:600">${label}</span>
    <div class="chip-row">${arr.map((v, i) => `
      <button class="chip copy-chip mono" data-copy="${kind}:${i}" title="Click to copy">${esc(v)}</button>`).join('')}
    </div>
  </div>`;
}

// copy a single identity value from a detail-panel chip, with brief feedback
window.copyOne = function (kind, index) {
  const p = state.projects.find(x => x.id === state.detailId);
  if (!p) return;
  const vals = {
    wallets: (p.wallets || []).map(w => `${w.label ? w.label + ': ' : ''}${w.address}`),
    x: (p.x_accounts || []).map(x => '@' + x.username),
    mail: (p.emails || []).map(e => e.email)
  }[kind] || [];
  const v = vals[index];
  if (v === undefined) return;
  window.api.copy(v);
  const btn = document.querySelector(`[data-copy="${kind}:${index}"]`);
  if (btn) {
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1100);
  }
};
window.copyKind = function (kind) {
  const p = state.projects.find(x => x.id === state.detailId);
  if (!p) return;
  const map = {
    wallets: (p.wallets || []).map(w => w.address).join('\n'),
    x: (p.x_accounts || []).map(x => x.username).join('\n'),
    mail: (p.emails || []).map(e => e.email).join('\n')
  };
  window.api.copy(map[kind] || '');
  toast('Copied to clipboard');
};

window.closeDetail = closeDetail;

// ---------- drawer (add/edit) ----------
window.openDrawer = async function (id = null) {
  state.editing = id;
  const isNew = !id;
  const p = isNew ? blankProject() : await window.api.getProject(id);
  if (!p) return toast('Project not found', true);

  closeDetail();
  const d = $('#drawer');
  d.innerHTML = skinIcons(drawerHtml(p, isNew));
  d.classList.add('on');
  d.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
  wireDrawer(p, isNew);
};

function blankProject() {
  return { name: '', website: '', x_account: '', category: [], network: '', note: '', icon: '',
    rank: '', cost: '', chains: [], status: '', platform: '', wallet_app: '',
    links: [], wallets: [], x_accounts: [], emails: [], tasks: [] };
}

function drawerHtml(p, isNew) {
  const cats = Array.isArray(p.category) ? p.category : (p.category ? [p.category] : []);
  const nets = Array.isArray(p.network) ? p.network : (p.network ? [p.network] : []);
  const plats = Array.isArray(p.platform) ? p.platform : (p.platform ? [p.platform] : []);

  return `
    <div class="drawer-head">
      <button class="btn btn-ghost btn-icon" data-hook="closeDrawer"><i class="ph ph-x"></i></button>
      <h2>${isNew ? t('newProject') : t('editProject')}</h2>
    </div>
    <div class="drawer-body">
      <div class="icon-pick">
        <span id="d-icon-preview">${iconHtml(p)}</span>
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-size:11px;color:var(--fg-3);text-transform:uppercase;letter-spacing:.05em;font-weight:600">Project icon</span>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-sm" id="d-icon-pick"><i class="ph ph-upload-simple"></i> Choose image</button>
            ${p.icon ? `<button type="button" class="btn btn-sm btn-ghost" id="d-icon-clear"><i class="ph ph-eraser"></i> Remove</button>` : ''}
          </div>
        </div>
      </div>

      <label class="field"><span>Project name *</span><input class="input" id="f-name" value="${esc(p.name)}" placeholder="e.g. Hyperliquid"></label>

      <div class="f-row">
        <label class="field"><span>Website</span><input class="input" id="f-website" value="${esc(p.website)}" placeholder="https://"></label>
        <label class="field"><span>Main X account</span><input class="input" id="f-x" value="${esc(p.x_account)}" placeholder="@username or https://x.com/username"></label>
      </div>

      <label class="field"><span>${t('category')}</span>
        <div class="cat-chips" id="f-cats">
          ${state.options.categories.map(c => chipHtml('cat', c, cats.includes(c))).join('')}
        </div>
        <div class="cat-add">
          <input class="input" id="f-cat-new" placeholder="${state.locale === 'id' ? 'Tambah kategori baru' : 'Add a new category'}" style="flex:1">
          <button type="button" class="btn btn-sm" id="f-cat-add"><i class="ph ph-plus"></i> ${t('add')}</button>
        </div>
      </label>

      <label class="field"><span>${t('network')}</span>
        <div class="cat-chips" id="f-nets">
          ${state.options.networks.map(n => chipHtml('net', n, nets.includes(n))).join('')}
        </div>
        <div class="cat-add">
          <input class="input" id="f-net-new" placeholder="${state.locale === 'id' ? 'Tambah network baru' : 'Add a new network'}" style="flex:1">
          <button type="button" class="btn btn-sm" id="f-net-add"><i class="ph ph-plus"></i> ${t('add')}</button>
        </div>
      </label>

      <div class="f-row">
        <label class="field"><span>${t('rank')}</span>
          <div class="cat-chips" id="f-ranks">
            ${(state.options.ranks || DEFAULT_RANKS_UI).map(r => chipHtml('rank', r, p.rank === r)).join('')}
          </div>
        </label>
        <label class="field"><span>${t('status')}</span>
          <div class="cat-chips" id="f-statuses">
            ${(state.options.statuses || DEFAULT_STATUSES_UI).map(s => chipHtml('status', s, p.status === s)).join('')}
          </div>
          <div class="cat-add">
            <input class="input" id="f-status-new" placeholder="${state.locale === 'id' ? 'Tambah status baru' : 'Add a new status'}" style="flex:1">
            <button type="button" class="btn btn-sm" id="f-status-add"><i class="ph ph-plus"></i> ${t('add')}</button>
          </div>
        </label>
      </div>

      <div class="f-row">
        <label class="field"><span>${t('cost')}</span>
          <div class="cat-chips" id="f-costs">
            ${['Free', 'Paid'].map(c => chipHtml('cost', c, p.cost === c)).join('')}
          </div>
          <input class="input" id="f-cost-custom" placeholder="${state.locale === 'id' ? 'atau jumlah sendiri, lalu Enter' : 'or custom amount, then Enter'}" value="${esc(p.cost && !['Free','Paid'].includes(p.cost) ? p.cost : '')}" style="max-width:170px;margin-top:8px">
          ${p.cost && !['Free','Paid'].includes(p.cost) ? `<span class="cost-current">${state.locale === 'id' ? 'Sekarang' : 'Current'}: <b class="mono">${esc(p.cost)}</b></span>` : ''}
        </label>
        <label class="field"><span>${t('platform')}</span>
          <div class="cat-chips" id="f-platforms">
            ${(state.options.platforms || DEFAULT_PLATFORMS_UI).map(v => chipHtml('platform', v, plats.includes(v))).join('')}
          </div>
          <div class="cat-add">
            <input class="input" id="f-platform-new" placeholder="${state.locale === 'id' ? 'Tambah platform baru' : 'Add a new platform'}" style="flex:1">
            <button type="button" class="btn btn-sm" id="f-platform-add"><i class="ph ph-plus"></i> ${t('add')}</button>
          </div>
        </label>
      </div>

      <label class="field"><span>${t('walletApp')}</span>
        <div class="cat-chips" id="f-wallet-apps">
          ${(state.options.walletApps || DEFAULT_WALLET_APPS_UI).map(v => chipHtml('wapp', v, p.wallet_app === v)).join('')}
        </div>
        <div class="cat-add">
          <input class="input" id="f-wapp-new" placeholder="${state.locale === 'id' ? 'Tambah wallet app' : 'Add a new wallet app'}" style="flex:1">
          <button type="button" class="btn btn-sm" id="f-wapp-add"><i class="ph ph-plus"></i> ${t('add')}</button>
        </div>
      </label>

      <div class="sec"><h4>${t('additionalLinks')}</h4>
        <div class="multi" id="m-links"></div>
      </div>

      <div class="sec"><h4>${t('wallets')}</h4>
        <div class="multi" id="m-wallets"></div>
      </div>

      <div class="f-row">
        <div class="sec"><h4>${t('xAccounts')}</h4><div class="multi" id="m-x"></div></div>
        <div class="sec"><h4>${t('emails')}</h4><div class="multi" id="m-mails"></div></div>
      </div>

      <div class="sec"><h4>${t('tasksSection')}</h4>
        <div class="multi" id="m-tasks"></div>
      </div>

      <label class="field"><span>${t('note')}</span><textarea class="textarea" id="f-note" placeholder="${state.locale === 'id' ? 'Apa saja yang perlu diingat tentang project ini' : 'Anything to remember about this project'}">${esc(p.note)}</textarea></label>
    </div>
    <div class="drawer-foot">
      ${isNew ? '' : `<button class="btn btn-danger" id="d-del"><i class="ph ph-trash"></i> ${t('delete')}</button>`}
      <span style="flex:1"></span>
      <button class="btn" data-hook="closeDrawer">${t('cancel')}</button>
      <button class="btn btn-primary" id="d-save"><i class="ph ph-check"></i> ${isNew ? t('create') : t('saveChanges')}</button>
    </div>`;
}

// one shared chip renderer + deleter for every option list in the drawer.
// data-kind maps to the config key; hover reveals an ✕ that removes the value.
function chipHtml(kind, value, on) {
  return `<span class="chip-wrap" data-kind="${esc(kind)}" data-val="${esc(value)}">
    <button type="button" class="cat-chip ${on ? 'on' : ''}" data-${esc(kind)}="${esc(value)}">${esc(value)}</button>
    <button type="button" class="chip-x" data-del="${esc(kind)}" data-val="${esc(value)}" title="Delete &quot;${esc(value)}&quot; from the list"><i class="ph ph-x"></i></button>
  </span>`;
}

const CHIP_CONFIG_KEY = { cat: 'categories', net: 'networks', rank: 'ranks', status: 'statuses', cost: null, platform: 'platforms', wapp: 'walletApps' };

function wireDrawer(p, isNew) {
  // selection state; mirrors the arrays drawerHtml renders (scope-safe: do not
  // rely on drawerHtml's locals, wireDrawer is a separate function)
  const cats = Array.isArray(p.category) ? p.category : (p.category ? [p.category] : []);

  // icon picker
  let iconPath = p.icon || '';
  const drawPreview = () => { $('#d-icon-preview').innerHTML = iconPath
    ? `<img class="picon" src="${esc(iconPath)}" alt="">`
    : `<span class="picon-empty"><i class="ph ph-image"></i></span>`; };
  $('#d-icon-pick').onclick = async () => {
    const r = await window.api.pickIcon();
    if (!r) return;
    if (r.error) return toast(`Could not import image: ${r.error}`, true);
    iconPath = r;
    drawPreview();
  };
  const clr = $('#d-icon-clear');
  if (clr) clr.onclick = () => { iconPath = ''; drawPreview(); };

  // ---- one wiring system for every chip group ----
  // single-select kinds keep a string; multi-select kinds keep a Set
  const sel = {
    cat: new Set(cats),
    net: new Set(Array.isArray(p.network) ? p.network : (p.network ? [p.network] : [])),
    rank: p.rank || '',
    status: p.status || '',
    cost: p.cost || '',
    platform: new Set(Array.isArray(p.platform) ? p.platform : (p.platform ? [p.platform] : [])),
    wapp: p.wallet_app || ''
  };
  const MULTI = { cat: 1, net: 1, platform: 1 };
  const HOST = { cat: '#f-cats', net: '#f-nets', rank: '#f-ranks', status: '#f-statuses', cost: '#f-costs', platform: '#f-platforms', wapp: '#f-wallet-apps' };
  const CONFIG = CHIP_CONFIG_KEY;
  const NEWFIELD = { cat: '#f-cat-new', net: '#f-net-new', status: '#f-status-new', platform: '#f-platform-new', wapp: '#f-wapp-new' };
  const ADDBTN = { cat: '#f-cat-add', net: '#f-net-add', status: '#f-status-add', platform: '#f-platform-add', wapp: '#f-wapp-add' };
  const NEWLABEL = { cat: 'category', net: 'network', status: 'status', platform: 'platform', wapp: 'wallet app' };

  for (const kind in HOST) {
    const host = $(HOST[kind]);
    if (!host) continue;
    // click a chip = toggle selection
    $$('.cat-chip', host).forEach(b => b.onclick = () => {
      const v = b.dataset[kind];
      if (MULTI[kind]) {
        if (sel[kind].has(v)) { sel[kind].delete(v); b.classList.remove('on'); }
        else { sel[kind].add(v); b.classList.add('on'); }
      } else {
        sel[kind] = v;
        $$('.cat-chip', host).forEach(x => x.classList.toggle('on', x === b));
      }
    });
    // hover ✕ = delete this value from the option list entirely
    $$('.chip-x', host).forEach(x => x.onclick = async (e) => {
      e.stopPropagation();
      const v = x.dataset.val;
      const key = CONFIG[kind];
      if (!key) return;
      // first clear it from the current selection so the project does not keep it
      if (MULTI[kind]) sel[kind].delete(v);
      else if (sel[kind] === v) sel[kind] = '';
      const used = await window.api.optionUsage(key, v);
      if (used > 0 && !confirm(t('confirmDeleteOption', v, used))) return;
      const res = await window.api.deleteOption(key, v);
      if (res && res.error === 'protected') return toast(res.message, true);
      if (res && res.error) return toast(`Could not delete: ${res.error}`, true);
      if (res && res.options) state.options = res.options;
      toast(`"${v}" deleted`);
      const wrap = x.closest('.chip-wrap');
      if (wrap) wrap.remove();
    });
    // "Add new..." row: type a value, add it to the list and select it
    const addBtn = $(ADDBTN[kind]);
    if (addBtn) addBtn.onclick = async () => {
      const inp = $(NEWFIELD[kind]);
      const v = clean(inp.value);
      if (!v) return toast(`Type a ${NEWLABEL[kind]} name first`, true);
      const key = CONFIG[kind];
      if (key && !state.options[key].includes(v)) {
        await window.api.addOption(key, v);
        state.options[key].push(v);
      }
      const chip = document.createElement('span');
      chip.className = 'chip-wrap';
      chip.dataset.kind = kind;
      chip.dataset.val = v;
      chip.innerHTML = `<button type="button" class="cat-chip on" data-${kind}="${esc(v)}">${esc(v)}</button>
        <button type="button" class="chip-x" data-del="${kind}" data-val="${esc(v)}" title="Delete &quot;${esc(v)}&quot;"><i class="ph ph-x"></i></button>`;
      host.appendChild(chip);
      const btn = chip.querySelector('.cat-chip');
      btn.onclick = () => {
        if (MULTI[kind]) {
          if (sel[kind].has(v)) { sel[kind].delete(v); btn.classList.remove('on'); }
          else { sel[kind].add(v); btn.classList.add('on'); }
        } else {
          sel[kind] = v;
          $$('.cat-chip', host).forEach(x => x.classList.toggle('on', x === btn));
        }
      };
      chip.querySelector('.chip-x').onclick = async (e) => {
        e.stopPropagation();
        if (MULTI[kind]) sel[kind].delete(v);
        else if (sel[kind] === v) sel[kind] = '';
        const used = await window.api.optionUsage(key, v);
        if (used > 0 && !confirm(t('confirmDeleteOption', v, used))) return;
        const res2 = await window.api.deleteOption(key, v);
        if (res2 && res2.error === 'protected') return toast(res2.message, true);
        if (res2 && res2.options) state.options = res2.options;
        toast(`"${v}" deleted`);
        chip.remove();
      };
      if (MULTI[kind]) sel[kind].add(v);
      else sel[kind] = v;
      $$('.cat-chip', host).forEach(x => { if (!MULTI[kind] && x !== btn) x.classList.remove('on'); });
      inp.value = '';
      toast(`${NEWLABEL[kind]} "${v}" added`);
    };
  }

  // cost: also allow a custom amount — typing one wins over the chips
  const costInp = $('#f-cost-custom');
  if (costInp) {
    costInp.oninput = () => {
      sel.cost = clean(costInp.value);
      $$('#f-costs .cat-chip').forEach(x => x.classList.remove('on'));
    };
    costInp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); costInp.blur(); toast(`Cost set to ${sel.cost}`); }
    };
  }

  // multi-item rows
  const mk = {
    links: (v = {}) => ({ url: v.url || '', label: v.label || '' }),
    wallets: (v = {}) => ({ address: v.address || '', label: v.label || '' }),
    x: (v = '') => String(v || ''),
    mails: (v = '') => String(v || ''),
    tasks: (v = {}) => ({ text: v.text || '', deadline: v.deadline || '', done: v.done || false, url: v.url || '' })
  };

  const rows = {
    links: (p.links || []).map(mk.links),
    wallets: (p.wallets || []).map(mk.wallets),
    x: (p.x_accounts || []).map(v => v.username),
    mails: (p.emails || []).map(m => m.email || ''),
    tasks: (p.tasks || []).map(mk.tasks)
  };

  const rowHtml = {
    links: (r, i) => `<input class="input" data-k="url" data-i="${i}" placeholder="https://" value="${esc(r.url)}">
      <input class="input" data-k="label" data-i="${i}" placeholder="Label (optional)" value="${esc(r.label)}">
      <button type="button" class="btn btn-ghost btn-icon" data-rm="${i}"><i class="ph ph-x"></i></button>`,
    wallets: (r, i) => `<input class="input mono" data-k="address" data-i="${i}" placeholder="0x..." value="${esc(r.address)}">
      <input class="input" data-k="label" data-i="${i}" placeholder="Label (free text)" value="${esc(r.label)}" style="max-width:130px">
      <button type="button" class="btn btn-ghost btn-icon" data-rm="${i}"><i class="ph ph-x"></i></button>`,
    x: (r, i) => `<input class="input" data-i="${i}" placeholder="username or https://x.com/username" value="${esc(r)}">
      <button type="button" class="btn btn-ghost btn-icon" data-rm="${i}"><i class="ph ph-x"></i></button>`,
    mails: (r, i) => `<input class="input" data-i="${i}" placeholder="name@mail.com" value="${esc(r)}">
      <button type="button" class="btn btn-ghost btn-icon" data-rm="${i}"><i class="ph ph-x"></i></button>`,
    tasks: (r, i) => `<input class="input" data-k="text" data-i="${i}" placeholder="Task description" value="${esc(r.text)}" style="flex:2.2">
      <input type="date" class="input task-deadline" data-k="deadline" data-i="${i}" value="${esc(r.deadline || '')}" title="Deadline">
      <input class="input" data-k="url" data-i="${i}" placeholder="Task link (optional)" value="${esc(r.url || '')}" title="Link to open while doing this task">
      <button type="button" class="btn btn-ghost btn-icon" data-rm="${i}"><i class="ph ph-x"></i></button>`
  };

  const containers = { links: '#m-links', wallets: '#m-wallets', x: '#m-x', mails: '#m-mails', tasks: '#m-tasks' };
  const addLabel = { links: 'Add link', wallets: 'Add wallet', x: 'Add X account', mails: 'Add email', tasks: 'Add task' };

  const drawAll = () => {
    for (const key in containers) {
      const host = $(containers[key]);
      const extra = key === 'tasks'
        ? `<button type="button" class="multi-add alt" data-add-dl="tasks"><i class="ph ph-clock-countdown"></i> Add deadline task</button>`
        : '';
      host.innerHTML = rows[key].map((r, i) => `<div class="multi-row">${rowHtml[key](r, i)}</div>`).join('') +
        `<button type="button" class="multi-add" data-add="${key}"><i class="ph ph-plus"></i> ${addLabel[key]}</button>` + extra;

      $$('[data-rm]', host).forEach(b => b.onclick = () => { rows[key].splice(Number(b.dataset.rm), 1); drawAll(); });
      const addBtn = $('[data-add]', host);
      if (addBtn) addBtn.onclick = () => {
        if (key === 'links') rows.links.push(mk.links());
        else if (key === 'wallets') rows.wallets.push(mk.wallets());
        else if (key === 'tasks') rows.tasks.push(mk.tasks());
        else rows[key].push('');
        drawAll();
      };
      const dlBtn = $('[data-add-dl]', host);
      if (dlBtn) dlBtn.onclick = () => {
        const t = mk.tasks();
        t.deadline = iso(new Date(TODAY.getTime()));
        rows.tasks.push(t);
        drawAll();
        // focus the new deadline input so the user can pick a date right away
        const inputs = $$('#m-tasks .task-deadline');
        if (inputs.length) inputs[inputs.length - 1].focus();
      };
      $$('[data-i]', host).forEach(el => {
        const i = Number(el.dataset.i);
        const k = el.dataset.k;
        if (el.type === 'checkbox') el.onchange = () => { rows[key][i][k] = el.checked; };
        else if (el.type === 'date') el.onchange = () => { rows[key][i][k] = el.value; };
        else el.oninput = () => {
          if (k) { if (!rows[key][i]) rows[key][i] = {}; rows[key][i][k] = el.value; }
          else rows[key][i] = el.value;
        };
      });
    }
  };
  drawAll();

  // save
  $('#d-save').onclick = async () => {
    const name = clean(document.getElementById('f-name').value);
    if (!name) return toast(t('nameRequired'), true);

    const data = {
      id: isNew ? null : p.id,
      name,
      website: document.getElementById('f-website').value,
      x_account: document.getElementById('f-x').value,
      category: [...sel.cat],
      network: [...sel.net],
      note: document.getElementById('f-note').value,
      icon: iconPath,
      done: isNew ? false : !!p.done,
      rank: sel.rank,
      cost: sel.cost,
      status: sel.status,
      platform: [...sel.platform],
      wallet_app: sel.wapp,
      links: rows.links.filter(r => clean(r.url)),
      wallets: rows.wallets.filter(r => clean(r.address)),
      x_accounts: rows.x.filter(r => clean(r)),
      emails: rows.mails.filter(r => clean(r)),
      tasks: rows.tasks.filter(r => clean(r.text)).map(t2 => ({ text: clean(t2.text), deadline: t2.deadline || '', done: !!t2.done, url: clean(t2.url || '') }))
    };
    const saved = await window.api.saveProject(data);
    toast(isNew ? `${name} created` : `${name} saved`);
    closeDrawer();
    await refresh();
    if (saved && isNew) openDetail(saved.id);
  };

  const delBtn = $('#d-del');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(t('deleteConfirm', p.name))) return;
    await window.api.deleteProject(p.id);
    toast(`${p.name} deleted`);
    closeDrawer();
    refresh();
  };
}

window.closeDrawer = function () {
  $('#drawer').classList.remove('on');
  $('#drawer').setAttribute('aria-hidden', 'true');
  if (!$('#detail').classList.contains('on') && !$('#drawer').classList.contains('on')) $('#scrim').classList.remove('on');
};

// ---------- wiring ----------
$('#search').addEventListener('input', (e) => { state.filter.q = e.target.value; renderGrid(); });
$('#filter-todo').addEventListener('click', (e) => {
  state.filter.todoOnly = !state.filter.todoOnly;
  e.currentTarget.classList.toggle('on', state.filter.todoOnly);
  renderGrid();
});
$('#btn-add').onclick = () => openDrawer();

// compact view toggle: full cards ⇄ single-line rows (persisted)
$('#filter-compact').addEventListener('click', (e) => {
  state.compact = !state.compact;
  e.currentTarget.classList.toggle('on', state.compact);
  try { localStorage.setItem('airdrop.compact', state.compact ? '1' : '0'); } catch { /* storage blocked */ }
  renderGrid();
  $('#filter-compact').innerHTML = skinIcons(`<i class="ph ph-${state.compact ? 'rows' : 'squares-four'}"></i>`);
});
try { const c2 = localStorage.getItem('airdrop.compact'); if (c2 === '1') { state.compact = true; $('#filter-compact').classList.add('on'); } } catch { /* no storage */ }

// filter dropdown triggers: click toggles the popover (global click closes it)
for (const dd of FILTER_DD) {
  const btn = $('#dd-' + dd.id + '-btn');
  const pop = $('#dd-' + dd.id + '-pop');
  if (!btn || !pop) continue;
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = !pop.hidden;
    $$('.dd-pop').forEach(p => p.hidden = true);
    pop.hidden = open;
  };
  pop.onclick = (e) => e.stopPropagation();
}

// hamburger menu: open/close + language + theme + backup + restore
$('#btn-menu').onclick = (e) => {
  e.stopPropagation();
  const pop = $('#menu-pop');
  pop.hidden = !pop.hidden;
  if (!pop.hidden) syncHeaderMenu();
};
$('#menu-pop').onclick = (e) => e.stopPropagation();
$$('[data-locale]').forEach(b => b.onclick = async () => {
  await window.api.settingsSet({ locale: b.dataset.locale });
  toast(b.dataset.locale === 'id' ? 'Bahasa: Indonesia' : 'Language: English');
  await refresh();
});
$('#m-theme').onclick = async () => {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  await window.api.settingsSet({ theme: next });
  toast(next === 'dark' ? 'Dark mode' : 'Light mode');
  await refresh();
};

// skin switcher: icon 1 = base (default), 2 = paper ledger, 3 = liquid aurora, 4 = terminal crt
$$('[data-skin]').forEach(b => b.onclick = async () => {
  const sk = b.dataset.skin;
  if (sk === state.skin) return;
  await window.api.settingsSet({ skin: sk });
  state.skin = sk;
  applySkin();
  renderStaticLabels();
  renderCalendar();
  renderFilterDropdowns();
  renderGrid();
  if (state.detailId) renderDetail();
  toast({ base: 'Default theme', paper: 'Paper Ledger', aurora: 'Liquid Aurora', crt: 'Terminal CRT' }[sk] || sk);
});

// background chooser (aurora-only feature; the section is only rendered into
// the menu panel while that skin is active, and bgPreset/bgCustom persist in
// settings so returning to Aurora restores the user's earlier choice)
function renderBgRow() {
  const row = $('#m-bg-row');
  if (!row) return;
  // not aurora → the section is not rendered (empty container, hidden)
  if (state.skin !== 'aurora') { row.innerHTML = ''; row.hidden = true; return; }
  // aurora → (re)build the swatches; returning to Aurora restores the
  // user's persisted bgPreset/bgCustom without resetting them
  row.innerHTML = `
    <span class="menu-label">Background</span>
    <div class="bg-chooser" id="m-bg">
      <button type="button" class="bg-swatch" data-bg="none" title="None"></button>
      <button type="button" class="bg-swatch" data-bg="aurora" title="Aurora"></button>
      <button type="button" class="bg-swatch" data-bg="nebula" title="Nebula"></button>
      <button type="button" class="bg-swatch" data-bg="ember" title="Ember"></button>
      <button type="button" class="bg-swatch" data-bg="forest" title="Forest"></button>
      <button type="button" class="bg-swatch bg-custom" data-bg="custom" title="Custom image"><svg class="si"><use href="#i-iconoir-upload"/></svg></button>
    </div>`;
  row.hidden = false;
  $$('[data-bg]', row).forEach(b => b.onclick = async () => {
    const bg = b.dataset.bg;
    if (bg === 'custom') {
      const picked = await window.api.pickBg();
      if (picked && !picked.error) {
        state.bgPreset = 'custom';
        state.bgCustom = picked;
        await window.api.settingsSet({ bgPreset: 'custom', bgCustom: picked });
        applySkin();
        toast('Background set to your image');
      } else if (picked && picked.error) toast(picked.error, true);
      return;
    }
    state.bgPreset = bg;
    await window.api.settingsSet({ bgPreset: bg });
    applySkin();
  });
}

// calendar collapse (persisted) + navigation
$('#cal-toggle').onclick = () => {
  state.calCollapsed = !state.calCollapsed;
  try { localStorage.setItem('airdrop.calCollapsed', state.calCollapsed ? '1' : '0'); } catch { /* storage blocked */ }
  renderCalendar();
};
// Mobile-first: default collapsed. Only override to expanded if explicitly '0' was saved.
try { const c = localStorage.getItem('airdrop.calCollapsed'); if (c === '0') state.calCollapsed = false; } catch { /* no storage */ }

$('#cal-prev').onclick = () => { const c = state.calCursor; state.calCursor = new Date(c.getFullYear(), c.getMonth() - 1, 1); renderCalendar(); };
$('#cal-next').onclick = () => { const c = state.calCursor; state.calCursor = new Date(c.getFullYear(), c.getMonth() + 1, 1); renderCalendar(); };
$('#cal-today').onclick = () => { state.calCursor = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1); renderCalendar(); };

async function doBackup() {
  const r = await window.api.backup();
  if (r.ok) toast(`Backup saved to ${r.path}`);
  else if (r.error) toast(`Backup failed: ${r.error}`, true);
}
async function doRestore() {
  const r = await window.api.restore();
  if (r.ok) { toast(`Restored from ${r.path}`); state.detailId = null; closeDetail(); await refresh(); }
  else if (r.error) toast(`Restore failed: ${r.error}`, true);
}
$('#m-backup').onclick = doBackup;
$('#m-restore').onclick = doRestore;

// static labels are refreshed after load (they depend on the active locale)
function renderStaticLabels() {
  $('#brand-sub').textContent = t('appSubtitle');
  $('#search').placeholder = t('search');
  $('#filter-todo').textContent = t('showPending');
  $('#btn-add').innerHTML = skinIcons(`<i class="ph ph-plus"></i>`);
  // today button: live date, formatted per active locale
  $('#cal-today').textContent = new Date().toLocaleDateString(
    state.locale === 'id' ? 'id-ID' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
  );
  // compact toggle icon reflects the active mode
  $('#filter-compact').innerHTML = skinIcons(`<i class="ph ph-${state.compact ? 'rows' : 'squares-four'}"></i>`);
  $('#m-backup').innerHTML = skinIcons(`<i class="ph ph-download-simple"></i> ${t('backup')}`);
  $('#m-restore').innerHTML = skinIcons(`<i class="ph ph-upload-simple"></i> ${t('restore')}`);
  syncHeaderMenu();
}

$('#scrim').onclick = () => {
  closeDetail();
  closeDrawer();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDetail(); closeDrawer(); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault(); $('#search').focus();
  }
});

// ---------- boot ----------
(async function boot() {
  try {
    await refresh();
  } catch (err) {
    $('#grid').innerHTML = `<div class="empty"><div class="glyph"><i class="ph ph-warning-circle"></i></div><h3>Could not load</h3><p>${esc(String(err))}</p></div>`;
  }
})();
