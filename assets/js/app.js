/* ==========================================================================
   app.js — boot, navigation, router, sim clock, theme
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A;
  const seed = A.buildSeed();
  const state = A.store.init(seed);

  const NAV = [
    { sec: '作业' },
    { id: 'overview', name: '指挥总览', icon: 'M4 13h5v7H4zM10 4h5v16h-5zM16 9h4v11h-4z', badge: 'queue' },
    { id: 'map', name: '地图调度', icon: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z', badge: 'dispatch', dot: true },
    { id: 'ocean', name: '海运在途', icon: 'M3 14l9-4 9 4-9 4zM5 14v5h14v-5M12 3v7', badge: 'ocean' },
    { id: 'routing', name: '路径与比价', icon: 'M5 19V7m0 0 4 4m-4-4-4 4M19 5v12m0 0 4-4m-4 4-4-4' },
    { sec: '风控' },
    { id: 'ops', name: '异常与返修', icon: 'M12 3 2 20h20L12 3Zm0 5v6m0 3v.6', badge: 'exceptions' },
    { id: 'settlement', name: '结算复盘', icon: 'M4 5h16v14H4zM8 9h8M8 13h5M8 17h8' },
    { sec: '依据' },
    { id: 'runbook', name: '作业手册', icon: 'M5 4h9l5 5v11H5zM14 4v5h5' }
  ];

  const ICONS = {};
  NAV.forEach(function (n) { if (n.icon) ICONS[n.id] = n.icon; });

  function svgIcon(d, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 15) + '" height="' + (size || 15) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  }

  /* ── theme ────────────────────────────────────────────────────────── */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('.ico-moon').hidden = t === 'light';
    document.querySelector('.ico-sun').hidden = t !== 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#eef2f7' : '#070b12');
  }

  /* ── badges ───────────────────────────────────────────────────────── */
  function badges(s) {
    const q = s.orders.filter((o) => o.status === '待派' || o.status === '待命').length;
    const ex = (s.exceptions || []).filter((e) => e.status !== '已关闭').length;
    const oc = (s.ocean || []).filter(function (x) {
      const d = A.dt.diff(s.today, x.eta);
      return (x.stage === 'S03' || x.stage === 'S04') && (d <= 1 || A.oceanDoc(x).missingDue.length > 0);
    }).length;
    return { queue: { n: q, tone: 'amber' }, dispatch: { n: s.draft && s.draft.stops.length ? s.draft.stops.length : 0, tone: 'amber' }, exceptions: { n: ex, tone: '' }, ocean: { n: oc, tone: '' } };
  }

  function renderNav() {
    const nav = document.getElementById('railNav');
    const b = badges(state);
    nav.innerHTML = NAV.map(function (n) {
      if (n.sec) return '<div class="rail-sec">' + n.sec + '</div>';
      const bd = n.badge && b[n.badge] && b[n.badge].n ? '<em class="nav-badge" data-tone="' + b[n.badge].tone + '">' + b[n.badge].n + '</em>' : '';
      return '<a class="nav-item" href="#/' + n.id + '" data-nav="' + n.id + '">' +
        svgIcon(n.icon) + '<span>' + n.name + '</span>' + bd + '</a>';
    }).join('');
  }

  /* ── router ───────────────────────────────────────────────────────── */
  let current = null;
  function show(name, params) {
    const def = A.views[name] || A.views.overview;
    name = def.name;
    current = name;
    document.querySelectorAll('.view').forEach(function (v) {
      const on = v.dataset.view === name;
      v.hidden = !on;
      if (on) { v.style.animation = 'none'; void v.offsetWidth; v.style.animation = ''; }
    });
    document.getElementById('viewTitle').textContent = def.title || '';
    document.getElementById('viewSub').textContent = typeof def.sub === 'function' ? def.sub(state) : (def.sub || '');
    document.querySelectorAll('.nav-item').forEach(function (a) {
      a.classList.toggle('is-on', a.dataset.nav === name);
    });
    document.getElementById('rail').classList.remove('is-open');
    if (!def._mounted) {
      const host = document.querySelector('.view[data-view="' + name + '"]');
      def.mount(host, state);
      def._mounted = true;
    }
    if (def.update) def.update(state, params || {});
    renderNav();
  }

  function onRoute() {
    const r = A.router.parse();
    show(r.name, r.params);
  }

  /* ── sim clock ────────────────────────────────────────────────────── */
  let timer = null;
  function paintClock() {
    const el = document.getElementById('clockDate');
    const day = document.getElementById('clockDay');
    el.textContent = state.today;
    day.textContent = A.dt.weekday(state.today) + ' · 达拉斯 10:00';
    document.getElementById('btnPlay').setAttribute('aria-pressed', timer ? 'true' : 'false');
    document.querySelector('.ico-play').hidden = !!timer;
    document.querySelector('.ico-pause').hidden = !timer;
  }
  function advance(n) {
    state.today = A.dt.add(state.today, n || 1);
    A.store.set({}, { silent: false });
    paintClock();
    A.toast('推演时钟推进到 ' + state.today + ' · ' + A.dt.weekday(state.today), 'amber');
  }
  function togglePlay() {
    if (timer) { clearInterval(timer); timer = null; A.toast('推演已暂停', 'amber'); }
    else {
      timer = setInterval(function () { advance(1); }, 1500);
      A.toast('推演中：每 1.5 秒推进一天', 'teal');
    }
    paintClock();
  }

  /* ── boot ─────────────────────────────────────────────────────────── */
  function boot() {
    applyTheme(state.theme === 'light' ? 'light' : 'dark');
    document.getElementById('app').hidden = false;
    renderNav();
    paintClock();

    window.addEventListener('hashchange', onRoute);
    if (!location.hash) location.replace('#/overview');
    onRoute();

    document.getElementById('btnTheme').addEventListener('click', function () {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme(state.theme);
      A.store.set({}, { silent: false });
    });
    document.getElementById('btnAdvance').addEventListener('click', function () { advance(1); });
    document.getElementById('btnPlay').addEventListener('click', togglePlay);
    document.getElementById('btnReset').addEventListener('click', function () {
      if (confirm('恢复初始演示数据？当前所有改动（派车、推进、勾选）将被清除。')) A.store.reset();
    });
    document.getElementById('btnRail').addEventListener('click', function () {
      document.getElementById('rail').classList.toggle('is-open');
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input,textarea,select')) return;
      const idx = ['overview', 'map', 'ocean', 'routing', 'ops', 'settlement', 'runbook'];
      if (/^[1-7]$/.test(e.key)) location.hash = '#/' + idx[Number(e.key) - 1];
      if (e.key === '/' ) { const s = document.querySelector('.search .input'); if (s && s.offsetParent) { e.preventDefault(); s.focus(); } }
      if (e.key === 'Escape') { const d = document.getElementById('drawer'); if (d.classList.contains('is-open')) A.drawer.close(); }
    });

    A.store.subscribe(function () {
      renderNav();
      paintClock();
      const def = A.views[current];
      if (def && def.update) def.update(state, A.router.parse().params);
    });

    let rt = null;
    window.addEventListener('resize', A.debounce(function () {
      const def = A.views[current];
      if (def && def.onResize) def.onResize(state);
    }, 160));

    setTimeout(function () {
      const b = document.getElementById('boot');
      b.classList.add('is-done');
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 600);
    }, 380);
  }

  A.app = {
    get state() { return state; },
    go: A.router.go,
    refresh: function () { A.store.emit(); },
    setToday: function (d) { state.today = d; A.store.set({}); }
  };

  /* global drawer helper */
  A.drawer = {
    open(html, opts) {
      const d = document.getElementById('drawer');
      d.innerHTML = html;
      d.hidden = false;
      requestAnimationFrame(function () { d.classList.add('is-open'); });
      d.setAttribute('aria-hidden', 'false');
      if (opts && opts.onMount) opts.onMount(d);
    },
    close() {
      const d = document.getElementById('drawer');
      d.classList.remove('is-open');
      d.setAttribute('aria-hidden', 'true');
      setTimeout(function () { if (!d.classList.contains('is-open')) { d.hidden = true; d.innerHTML = ''; } }, 320);
    },
    isOpen() { return document.getElementById('drawer').classList.contains('is-open'); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
