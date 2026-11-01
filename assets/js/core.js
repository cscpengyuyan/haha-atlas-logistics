/* ==========================================================================
   core.js — namespace, formatting, date/geo math, DOM helpers, store, router
   ========================================================================== */
(function (w) {
  'use strict';
  const A = (w.A = w.A || {});
  A.views = {};

  /* ── tiny DOM ─────────────────────────────────────────────────────── */
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(function (k) {
      if (k == null || k === false) return;
      node.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
    return node;
  }
  function sel(s, root) { return (root || document).querySelector(s); }
  function selAll(s, root) { return Array.from((root || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function svg(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) {
      if (attrs[k] == null) continue;
      n.setAttribute(k, attrs[k]);
    }
    return n;
  }
  function delegate(root, type, selector, fn) {
    root.addEventListener(type, function (e) {
      const t = e.target.closest(selector);
      if (t && root.contains(t)) fn(e, t);
    });
  }

  /* ── format ───────────────────────────────────────────────────────── */
  const fmt = {
    n(v, d) {
      if (v == null || isNaN(v)) return '—';
      return Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 0 : d });
    },
    usd(v, d) {
      if (v == null || isNaN(v)) return '—';
      const s = Math.abs(v) < 0.005 ? 0 : Math.round(v * 100) / 100;
      return '$' + Number(s).toLocaleString('en-US', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d });
    },
    usd2(v) { return fmt.usd(v, 2); },
    pct(v, d) {
      if (v == null || isNaN(v)) return '—';
      return (v * 100).toFixed(d == null ? 1 : d) + '%';
    },
    kg(v) { return fmt.n(v, v % 1 ? 1 : 0) + ' kg'; },
    lb(v) { return fmt.n(v, 0) + ' lb'; },
    mi(v) { return fmt.n(v, 0) + ' mi'; },
    hhmm(mins) {
      if (mins == null || isNaN(mins)) return '—';
      const m = Math.max(0, Math.round(mins));
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    },
    dur(mins) {
      const m = Math.max(0, Math.round(mins));
      if (m < 60) return m + ' 分';
      const h = Math.floor(m / 60), r = m % 60;
      return h + ' 时' + (r ? ' ' + r + ' 分' : '');
    },
    sign(v) { return v > 0 ? '+' : v < 0 ? '−' : ''; },
    cuft(v) { return fmt.n(v, 0) + ' ft³'; }
  };

  /* ── dates (date-only strings, noon UTC to dodge DST edges) ───────── */
  const dt = {
    parse(s) {
      if (s instanceof Date) return new Date(s.getTime());
      if (!s) return null;
      const p = String(s).split('-').map(Number);
      return new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1, 12, 0, 0));
    },
    key(d) {
      const x = d instanceof Date ? d : dt.parse(d);
      return x.toISOString().slice(0, 10);
    },
    add(s, days) {
      const d = dt.parse(s);
      d.setUTCDate(d.getUTCDate() + days);
      return dt.key(d);
    },
    diff(a, b) { // b - a in whole days
      return Math.round((dt.parse(b) - dt.parse(a)) / 864e5);
    },
    mmdd(s) { const p = String(s).split('-'); return p[1] + '/' + p[2]; },
    md(s) { const p = String(s).split('-'); return Number(p[1]) + '月' + Number(p[2]) + '日'; },
    weekday(s) {
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.parse(s).getUTCDay()];
    },
    iso(s) { return s ? String(s).replace(/-/g, '') : ''; }
  };

  /* ── geo ──────────────────────────────────────────────────────────── */
  const GEO = {
    R_MI: 3958.7613,
    haversine(a, b) {
      const toR = Math.PI / 180;
      const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
      const la1 = a.lat * toR, la2 = b.lat * toR;
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
      return 2 * GEO.R_MI * Math.asin(Math.min(1, Math.sqrt(x)));
    },
    // road-network distance estimate: great-circle × circuity factor
    roadMiles(a, b) {
      const gc = GEO.haversine(a, b);
      // short hauls are relatively less direct than long interstate runs
      const f = gc < 40 ? 1.34 : gc < 160 ? 1.27 : gc < 600 ? 1.2 : 1.16;
      return Math.max(4, gc * f);
    }
  };

  /* ── seeded RNG (mulberry32) ──────────────────────────────────────── */
  function rng(seed) {
    let a = seed >>> 0;
    const r = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.int = (min, max) => Math.floor(r() * (max - min + 1)) + min;
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    r.float = (min, max) => r() * (max - min) + min;
    return r;
  }

  /* ── store ────────────────────────────────────────────────────────── */
  const LS_KEY = 'haha.atlas.v1';
  const store = {
    state: null,
    subs: [],
    _t: null,
    init(initial) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
      this.state = saved && saved.__seed === A.SEED_VERSION ? saved.data : initial;
      this.state.ui = this.state.ui || {};
      return this.state;
    },
    set(patch, opts) {
      const s = this.state;
      if (typeof patch === 'function') patch(s); else Object.assign(s, patch);
      if (!opts || opts.persist !== false) this.save();
      if (!opts || opts.silent !== true) this.emit();
      return s;
    },
    save() {
      if (A.noPersist) return;
      clearTimeout(this._t);
      const self = this;
      this._t = setTimeout(function () {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ __seed: A.SEED_VERSION, data: self._snapshot() }));
        } catch (e) { /* quota — ignore */ }
      }, 350);
    },
    _snapshot() {
      const s = this.state;
      return {
        today: s.today, theme: s.theme, orders: s.orders, ocean: s.ocean,
        trucks: s.trucks, draft: s.draft, ui: s.ui, log: s.log.slice(-40)
      };
    },
    reset() {
      try { localStorage.removeItem(LS_KEY); } catch (e) { }
      location.reload();
    },
    subscribe(fn) { this.subs.push(fn); },
    emit() { this.subs.forEach((f) => { try { f(this.state); } catch (e) { console.error(e); } }); }
  };

  /* ── router ───────────────────────────────────────────────────────── */
  const router = {
    current: null,
    go(name, params) {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      location.hash = '#/' + name + q;
    },
    parse() {
      const h = (location.hash || '#/overview').replace(/^#\/?/, '');
      const [path, qs] = h.split('?');
      const params = {};
      new URLSearchParams(qs || '').forEach((v, k) => (params[k] = v));
      return { name: (path || 'overview').split('/')[0], params };
    }
  };

  /* ── toast / tooltip ──────────────────────────────────────────────── */
  function toast(msg, tone) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = el('div', { class: 'toast' }, [
      el('span', { class: 'dot dot--' + (tone || 'teal') }),
      el('span', { text: msg })
    ]);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2600);
  }

  const tip = {
    node: null,
    show(html, x, y) {
      const n = document.getElementById('tip');
      if (!n) return;
      n.innerHTML = html;
      n.hidden = false;
      const r = n.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > innerHeight - 8) top = y - r.height - 14;
      n.style.left = Math.max(6, left) + 'px';
      n.style.top = Math.max(6, top) + 'px';
    },
    hide() { const n = document.getElementById('tip'); if (n) n.hidden = true; }
  };

  /* ── misc ─────────────────────────────────────────────────────────── */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function sum(arr, f) { return arr.reduce((a, x) => a + (f ? f(x) : x), 0); }
  function groupBy(arr, f) {
    const m = new Map();
    arr.forEach((x) => { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); });
    return m;
  }
  function uid(p) { return (p || 'id') + '-' + Math.random().toString(36).slice(2, 8); }
  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms || 180); };
  }

  Object.assign(A, {
    el, sel, selAll, esc, svg, delegate, fmt, dt, geo: GEO, rng,
    store, router, toast, tip, clamp, sum, groupBy, uid, debounce,
    registerView(name, def) { A.views[name] = Object.assign({ name }, def); }
  });
})(window);
