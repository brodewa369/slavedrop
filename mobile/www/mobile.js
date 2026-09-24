// mobile.js — mobile-specific UI overrides for SlaveDrop
// Loaded before app.js

(function() {
  // Mobile overrides: force calendar collapsed by default.
  // (Was an inline <script> in index.html — CSP script-src 'self' blocks inline
  // scripts in Android WebView, so it moved here.)
  try { localStorage.setItem('airdrop.calCollapsed', '1'); } catch (e) { /* storage blocked */ }
  // Click calendar title to toggle collapsed
  document.addEventListener('click', (e) => {
    const title = e.target.closest('.cal-title');
    if (!title) return;
    const strip = document.querySelector('.cal-strip');
    if (!strip) return;
    strip.classList.toggle('collapsed');
    if (window.state) {
      window.state.calCollapsed = strip.classList.contains('collapsed');
    }
    e.stopPropagation();
  });
})();

/* ============================================================
   Round 6 — long-press a tag chip in add/edit project to open
   the delete choice (the corner ✕ is gone — miscap-tap prone).
   Short tap keeps its normal select/deselect behaviour.
   ============================================================ */
(() => {
  const HOLD_MS = 480;
  const MOVE_TOL = 10;
  let timer = null, menu = null, holdFired = false;
  let sx = 0, sy = 0;

  const cancelHold = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };

  const showMenu = (wrap) => {
    closeMenu();
    holdFired = true;
    const val = wrap.dataset.val || '';
    menu = document.createElement('div');
    menu.className = 'hold-menu';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hold-item danger';
    del.textContent = 'Delete tag "' + val + '"';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'hold-item cancel';
    cancel.textContent = 'Cancel';
    menu.append(del, cancel);
    document.body.appendChild(menu);

    const r = wrap.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // runs the exact same delete flow as the old ✕ (usage confirm + toast)
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      const x = wrap.querySelector('.chip-x');
      if (x) x.click();
    });
    cancel.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); });
  };

  document.addEventListener('pointerdown', (e) => {
    if (menu && e.target.closest && e.target.closest('.hold-menu')) return; // menu taps
    closeMenu();
    const wrap = e.target.closest && e.target.closest('.chip-wrap');
    if (!wrap) { cancelHold(); holdFired = false; return; }
    sx = e.clientX; sy = e.clientY;
    holdFired = false;
    cancelHold();
    timer = setTimeout(() => { timer = null; showMenu(wrap); }, HOLD_MS);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (timer && (Math.abs(e.clientX - sx) > MOVE_TOL || Math.abs(e.clientY - sy) > MOVE_TOL)) cancelHold();
  }, true);
  document.addEventListener('pointerup', cancelHold, true);
  document.addEventListener('pointercancel', cancelHold, true);

  // a hold must not also fire the chip's select/deselect click
  document.addEventListener('click', (e) => {
    if (holdFired) { holdFired = false; e.stopPropagation(); e.preventDefault(); }
  }, true);

  // long-press on a tag should not pop the system context/selection menu
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('.chip-wrap')) e.preventDefault();
  });

  window.__holdMenu = { isOpen: () => !!menu, close: closeMenu };
})();

