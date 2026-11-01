/* ==========================================================================
   map.js — ATLAS map engine (Apple-Maps-inspired)
   Albers-projected CONUS. Momentum panning, pinch zoom, animated routes.
   No external tiles: the basemap ships with the site as pre-projected SVG.
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A;
  const G = w.ATLAS_GEO;
  const NS = 'http://www.w3.org/2000/svg';
  const RAD = Math.PI / 180;

  /* ── projection (mirrors tools/build_geo.py) ──────────────────────── */
  const PR = G.proj;
  const R = 6378137.0;
  const LAT1 = PR.lat1 * RAD, LAT2 = PR.lat2 * RAD, LAT0 = PR.lat0 * RAD, LON0 = PR.lon0 * RAD;
  const N = (Math.sin(LAT1) + Math.sin(LAT2)) / 2;
  const CC = Math.cos(LAT1) ** 2 + 2 * N * Math.sin(LAT1);
  const RHO0 = R * Math.sqrt(CC - 2 * N * Math.sin(LAT0)) / N;

  function albers(lon, lat) {
    const lat_r = lat * RAD, lon_r = lon * RAD;
    const rho = R * Math.sqrt(CC - 2 * N * Math.sin(lat_r)) / N;
    const theta = N * (lon_r - LON0);
    return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
  }
  function proj(lon, lat) {
    const p = albers(lon, lat);
    return [(p[0] - PR.minx) * PR.scale + PR.pad, (PR.maxy - p[1]) * PR.scale + PR.pad];
  }
  function latY(lat) { return proj(PR.lon0, lat)[1]; }
  function milesToUnits(miles, lat) {
    const dl = miles / (69.172 * Math.cos((lat || 38) * RAD));
    const a = proj(PR.lon0, lat || 38), b = proj(PR.lon0 - dl, lat || 38);
    return Math.abs(a[0] - b[0]);
  }

  const VB = { x: -128, y: -12, w: G.vb[2] + 128 + 14, h: G.vb[3] + 24 };
  const GUTTER_X = -158;
  // home camera keeps the whole CONUS to the right of the floating sidebar
  const HOME = { k: 1.02, tx: -46, ty: -4 };

  const STATUS_COLOR = {
    '待派': 'var(--mv-orange)', '待命': 'var(--mv-purple)', '已派': 'var(--mv-blue)',
    '执行中': 'var(--mv-teal)', '已签收': 'var(--mv-green)', '异常': 'var(--mv-red)'
  };
  const LEVEL_COLOR = { L1: 'var(--mv-blue)', L2: 'var(--mv-teal)', L3: 'var(--mv-orange)' };

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function txt(tag, attrs, s) { const n = el(tag, attrs); n.textContent = s; return n; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /* ── engine ───────────────────────────────────────────────────────── */
  A.MapEngine = function (host, opts) {
    opts = opts || {};
    const api = {};
    const svg = el('svg', {
      class: 'mv-svg', viewBox: [VB.x, VB.y, VB.w, VB.h].join(' '),
      preserveAspectRatio: 'xMidYMid meet', role: 'img',
      'aria-label': '美国大件设备物流网络地图'
    });

    /* gradients + filters */
    const defs = el('defs');
    const glow = el('radialGradient', { id: 'mvGlow', cx: '46%', cy: '46%', r: '58%' });
    glow.appendChild(el('stop', { offset: '0', 'stop-color': '#2b6fd6', 'stop-opacity': '.16' }));
    glow.appendChild(el('stop', { offset: '1', 'stop-color': '#2b6fd6', 'stop-opacity': '0' }));
    defs.appendChild(glow);

    const landShadow = el('filter', { id: 'mvLandShadow', x: '-10%', y: '-10%', width: '120%', height: '120%' });
    landShadow.appendChild(el('feDropShadow', { dx: '0', dy: '2', stdDeviation: '4', 'flood-color': '#000', 'flood-opacity': '.45' }));
    defs.appendChild(landShadow);

    const pinShadow = el('filter', { id: 'mvPinShadow', x: '-120%', y: '-120%', width: '340%', height: '340%' });
    pinShadow.appendChild(el('feDropShadow', { dx: '0', dy: '1', stdDeviation: '1.1', 'flood-color': '#000', 'flood-opacity': '.6' }));
    defs.appendChild(pinShadow);

    const markerShadow = el('filter', { id: 'mvMarkShadow', x: '-80%', y: '-80%', width: '260%', height: '260%' });
    markerShadow.appendChild(el('feDropShadow', { dx: '0', dy: '1.4', stdDeviation: '1.8', 'flood-color': '#000', 'flood-opacity': '.55' }));
    defs.appendChild(markerShadow);

    const routeGrad = el('linearGradient', { id: 'mvRoute', x1: '0', y1: '0', x2: '1', y2: '0' });
    routeGrad.appendChild(el('stop', { offset: '0', 'stop-color': '#5aa9ff' }));
    routeGrad.appendChild(el('stop', { offset: '1', 'stop-color': '#0a84ff' }));
    defs.appendChild(routeGrad);
    svg.appendChild(defs);

    const vb = el('g', { class: 'mv-vp' });
    const layers = {};
    ['water', 'land', 'roads', 'stateLab', 'zones', 'lanes', 'gutter', 'routes', 'pins', 'nodes', 'routeLab'].forEach(function (k) {
      layers[k] = el('g', { class: 'mv-layer mv-layer--' + k });
      vb.appendChild(layers[k]);
    });
    svg.appendChild(vb);

    /* ── static base ───────────────────────────────────────────────── */
    layers.water.appendChild(el('rect', {
      x: VB.x - 400, y: VB.y - 400, width: VB.w + 800, height: VB.h + 800,
      fill: 'var(--mv-water)'
    }));
    layers.water.appendChild(el('rect', {
      x: VB.x - 400, y: VB.y - 400, width: VB.w + 800, height: VB.h + 800,
      fill: 'url(#mvGlow)'
    }));

    const grat = el('g', { class: 'mv-grat' });
    for (let lon = -130; lon <= -60; lon += 10) {
      const a = proj(lon, 24), b = proj(lon, 50);
      grat.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
    for (let lat = 25; lat <= 50; lat += 5) {
      const a = proj(-126, lat), b = proj(-66, lat);
      grat.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
    layers.water.appendChild(grat);

    const landG = el('g', { filter: 'url(#mvLandShadow)' });
    G.states.forEach(function (s) {
      landG.appendChild(el('path', { d: s.d, class: 'mv-land', 'data-st': s.a }));
    });
    layers.land.appendChild(landG);

    // roads are drawn in three tiers, each with a dark casing so they read on the land fill
    const roadPaths = {};
    ['other', 'us', 'inter'].forEach(function (k) {
      if (!G.roads[k]) return;
      const c = el('path', { d: G.roads[k], class: 'mv-road-case mv-road-case--' + k });
      const f = el('path', { d: G.roads[k], class: 'mv-road mv-road--' + k });
      layers.roads.appendChild(c);
      layers.roads.appendChild(f);
      roadPaths[k] = { c: c, f: f };
    });

    G.states.forEach(function (s) {
      if (!s.a || s.a === 'DC') return;
      layers.stateLab.appendChild(txt('text', { x: s.x, y: s.y, class: 'mv-statelab' }, s.a));
    });

    // city dots + labels for the major metros (major tier always visible)
    const cityMajor = el('g', { class: 'mv-cities mv-cities--major' });
    const cityMinor = el('g', { class: 'mv-cities mv-cities--minor' });
    (G.places || []).slice(0, 26).forEach(function (p, i) {
      const g = el('g', { transform: 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')' });
      g.appendChild(el('circle', { r: 1.5, class: 'mv-citydot' }));
      g.appendChild(txt('text', { x: 3.4, y: 2, class: 'mv-citylab' }, p.n));
      (i < 8 ? cityMajor : cityMinor).appendChild(g);
    });
    layers.stateLab.appendChild(cityMinor);
    layers.stateLab.appendChild(cityMajor);

    host.appendChild(svg);

    /* ── view transform + motion ────────────────────────────────────── */
    const view = Object.assign({}, HOME);
    const MIN_K = 0.85, MAX_K = 18;
    let raf = null;

    function apply() {
      // hard guard: a bad camera value must never blank the map
      if (!isFinite(view.k) || view.k <= 0) view.k = HOME.k;
      if (view.k < MIN_K) view.k = MIN_K;
      if (view.k > MAX_K) view.k = MAX_K;
      if (!isFinite(view.tx)) view.tx = HOME.tx;
      if (!isFinite(view.ty)) view.ty = HOME.ty;
      vb.setAttribute('transform', 'translate(' + view.tx.toFixed(2) + ' ' + view.ty.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
      const k = view.k;
      layers.stateLab.style.opacity = k < 2.4 ? Math.max(0, (2.4 - k) / 0.7) : 0;
      cityMinor.style.opacity = k >= 1.9 ? Math.min(1, (k - 1.9) * 1.6) : 0;
      layers.roads.style.opacity = 1;

      // road hierarchy: widths and emphasis follow the zoom level
      const w = {
        inter: k < 1.3 ? 1.15 : k < 2.2 ? 1.55 : k < 4 ? 2.0 : 2.6,
        us: k < 1.3 ? 0.85 : k < 2.2 ? 1.05 : k < 4 ? 1.4 : 1.8,
        other: k < 1.3 ? 0.6 : k < 2.2 ? 0.75 : k < 4 ? 1.05 : 1.35
      };
      const op = {
        inter: 1,
        us: k < 1.3 ? 0.92 : 1,
        other: k < 1.3 ? 0.62 : k < 2.2 ? 0.82 : 1
      };
      Object.keys(roadPaths).forEach(function (key) {
        const rp = roadPaths[key];
        if (!rp) return;
        rp.f.style.strokeWidth = w[key].toFixed(2) + 'px';
        rp.f.style.opacity = op[key];
        rp.c.style.strokeWidth = (w[key] + (key === 'inter' ? 1.5 : 1.15)).toFixed(2) + 'px';
        rp.c.style.opacity = op[key] * 0.9;
      });

      // labels & badges stay a constant on-screen size
      const s = (1 / k).toFixed(3);
      for (let i = 0; i < kpts.length; i++) kpts[i].setAttribute('transform', 'scale(' + s + ')');
      if (opts.onView) opts.onView({ zoom: k });
    }
    let kpts = [];
    function refreshKpts() { kpts = Array.prototype.slice.call(vb.querySelectorAll('.mv-kpt')); }

    function clampPan() {
      // the allowed translate grows with the zoom level, otherwise a zoomed-in
      // view cannot be centred on anything away from the middle of the country
      const lim = VB.w * Math.max(1, view.k) * 0.82;
      view.tx = clamp(view.tx, -lim, lim);
      view.ty = clamp(view.ty, -lim * 0.72, lim * 0.72);
    }

    function toBase(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const m = svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      const p = pt.matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }

    /* animated camera — timer driven so it also runs where rAF is throttled */
    let camAnim = null;
    function stopCam() { if (camAnim) { clearTimeout(camAnim); camAnim = null; } }
    function animateView(end, ms) {
      stopCam();
      const s = { k: view.k, tx: view.tx, ty: view.ty };
      const t0 = (w.performance || Date).now(), dur = ms || 420;
      function step() {
        const t = Math.min(1, ((w.performance || Date).now() - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        view.k = s.k + (end.k - s.k) * e;
        view.tx = s.tx + (end.tx - s.tx) * e;
        view.ty = s.ty + (end.ty - s.ty) * e;
        clampPan(); apply();
        camAnim = t < 1 ? setTimeout(step, 16) : null;
      }
      step();
    }

    function zoomAt(factor, basePt, animate) {
      const target = clamp(view.k * factor, MIN_K, MAX_K);
      const p = basePt || { x: VB.x + VB.w / 2, y: VB.y + VB.h / 2 };
      const cx = (p.x - view.tx) / view.k, cy = (p.y - view.ty) / view.k;
      const end = { k: target, tx: p.x - cx * target, ty: p.y - cy * target };
      if (animate) { animateView(end, 300); return; }
      stopCam();
      Object.assign(view, end);
      clampPan(); apply();
    }

    /* ── pointer handling: drag with momentum, pinch ────────────────── */
    const pointers = new Map();
    let drag = null, lastMove = 0, pinch = null;
    let vel = { x: 0, y: 0 };
    let momentum = null;

    function stopMomentum() { if (momentum) { cancelAnimationFrame(momentum); momentum = null; } }

    function startMomentum() {
      stopMomentum();
      const step = function () {
        vel.x *= 0.93; vel.y *= 0.93;
        if (Math.abs(vel.x) < 0.05 && Math.abs(vel.y) < 0.05) { momentum = null; return; }
        view.tx += vel.x; view.ty += vel.y;
        clampPan(); apply();
        momentum = requestAnimationFrame(step);
      };
      momentum = requestAnimationFrame(step);
    }

    svg.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      stopMomentum();
      try { svg.setPointerCapture(e.pointerId); } catch (err) { }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), sx: e.clientX, sy: e.clientY };
        svg.classList.add('is-panning');
        vel = { x: 0, y: 0 };
      } else if (pointers.size === 2) {
        const p = Array.from(pointers.values());
        pinch = {
          dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
          k: view.k,
          mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }
        };
        drag = null;
      }
    });

    svg.addEventListener('pointermove', function (e) {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && pointers.size >= 2) {
        const p = Array.from(pointers.values());
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (pinch.dist > 0) {
          const f = d / pinch.dist;
          const base = toBase({ clientX: pinch.mid.x, clientY: pinch.mid.y });
          const cx = (base.x - view.tx) / view.k, cy = (base.y - view.ty) / view.k;
          view.k = clamp(pinch.k * f, MIN_K, MAX_K);
          view.tx = base.x - cx * view.k;
          view.ty = base.y - cy * view.k;
          clampPan(); apply();
        }
        return;
      }

      if (drag) {
        const r = svg.getBoundingClientRect();
        const sx = VB.w / r.width, sy = VB.h / r.height;
        const dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sy;
        const now = performance.now();
        const dt = Math.max(8, now - drag.t);
        vel.x = vel.x * 0.55 + (dx / dt * 16) * 0.45;
        vel.y = vel.y * 0.55 + (dy / dt * 16) * 0.45;
        drag.t = now;
        drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
        view.tx += dx; view.ty += dy;
        drag.x = e.clientX; drag.y = e.clientY;
        clampPan(); apply();
        return;
      }

      const t = e.target.closest('[data-type]');
      if (t) hover(t.dataset.type, t.dataset.id, e);
      else if (api._hovering) { api._hovering = false; if (opts.onHover) opts.onHover(null); }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) { if (pointers.size === 0) svg.classList.remove('is-panning'); return; }
      svg.classList.remove('is-panning');
      const quick = drag.moved < 6;
      const speed = Math.hypot(vel.x, vel.y);
      drag = null;
      if (quick) {
        const t = e.target.closest('[data-type]');
        if (t) { select(t.dataset.type, t.dataset.id); if (opts.onSelect) opts.onSelect(t.dataset.type, t.dataset.id); }
        else if (opts.onSelect) opts.onSelect(null, null);
      } else if (speed > 1.2) {
        startMomentum();
      }
    }
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', function (e) { pointers.delete(e.pointerId); drag = null; pinch = null; svg.classList.remove('is-panning'); });

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0022));
      zoomAt(f, toBase(e), false);
    }, { passive: false });

    svg.addEventListener('dblclick', function (e) { zoomAt(1.8, toBase(e), true); });

    function hover(type, id, e) {
      api._hovering = true;
      if (opts.onHover) opts.onHover({ type, id, evt: e });
    }

    /* ── marks ──────────────────────────────────────────────────────── */
    let sel = null;
    function select(type, id) {
      sel = type ? { type, id } : null;
      Array.from(svg.querySelectorAll('.is-sel')).forEach(function (n) { n.classList.remove('is-sel'); });
      if (!type) return;
      const n = svg.querySelector('[data-type="' + type + '"][data-id="' + id + '"]');
      if (n) n.classList.add('is-sel');
    }
    api.select = select;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

    let planKey = '';

    api.render = function (d) {
      const state = d.state;
      const lz = state.ui.mapLayers || {};

      /* ocean feeder */
      clear(layers.gutter); clear(layers.lanes);
      if (lz.lanes !== false && d.ocean && d.ocean.length) {
        const gx = GUTTER_X;
        layers.gutter.appendChild(el('line', {
          x1: -18, y1: latY(21), x2: -18, y2: latY(43),
          class: 'mv-shore'
        }));
        layers.gutter.appendChild(txt('text', {
          x: gx - 30, y: latY(42), class: 'mv-gutter-label',
          transform: 'rotate(-90 ' + (gx - 30) + ' ' + latY(42) + ')'
        }, '中国起运港'));

        const groups = {};
        d.ocean.forEach(function (s) {
          const k = s.lane.from + '>' + s.lane.to;
          (groups[k] = groups[k] || []).push(s);
        });
        Object.keys(groups).forEach(function (key) {
          const s = groups[key][0];
          const from = A.C.PORTS[s.lane.from], to = A.C.PORTS[s.lane.to];
          const fy = latY(from.lat) + (s.lane.from === 'NGB' ? 7 : s.lane.from === 'YTN' ? 15 : s.lane.from === 'TAO' ? -7 : 0);
          const txp = proj(to.lng, to.lat);
          const pacific = to.code === 'LGB' || to.code === 'SEA';
          let path;
          if (pacific) {
            const mx = (gx + txp[0]) / 2;
            path = 'M' + gx + ' ' + fy + ' Q' + mx + ' ' + (fy - 26) + ' ' + txp[0].toFixed(1) + ' ' + txp[1].toFixed(1);
          } else {
            const by = VB.y + VB.h - 22;
            path = 'M' + gx + ' ' + fy +
              ' Q' + (gx - 10) + ' ' + (fy + 60) + ' ' + (gx + 18) + ' ' + (by - 30) +
              ' Q' + (gx + 60) + ' ' + by + ' ' + (gx + 160) + ' ' + by +
              ' L' + (txp[0] - 120) + ' ' + by +
              ' Q' + (txp[0] - 20) + ' ' + by + ' ' + txp[0].toFixed(1) + ' ' + (by - 34) +
              ' Q' + txp[0].toFixed(1) + ' ' + (by - 46) + ' ' + txp[0].toFixed(1) + ' ' + (txp[1] + 4).toFixed(1);
          }
          layers.lanes.appendChild(el('path', { d: path, class: 'mv-lane-glow' }));
          layers.lanes.appendChild(el('path', { d: path, class: 'mv-lane' }));
        });
        layers.gutter.appendChild(txt('text', {
          x: 396, y: VB.y + VB.h - 8, class: 'mv-gutter-note'
        }, '经巴拿马 · 示意'));

        const seen = {};
        d.ocean.forEach(function (s) { seen[s.lane.from] = true; });
        Object.keys(seen).forEach(function (code) {
          const p = A.C.PORTS[code];
          const g = el('g', {
            class: 'mv-port', 'data-type': 'port', 'data-id': code,
            transform: 'translate(' + GUTTER_X + ',' + latY(p.lat).toFixed(1) + ')'
          });
          const kp = el('g', { class: 'mv-kpt' });
          kp.appendChild(el('circle', { r: 3.4, class: 'mv-port-dot' }));
          kp.appendChild(txt('text', { x: 8, y: 2.6, class: 'mv-port-code' }, p.code));
          kp.appendChild(txt('text', { x: 8, y: 10.4, class: 'mv-port-name' }, p.name));
          g.appendChild(kp);
          layers.gutter.appendChild(g);
        });
        const destSeen = {};
        d.ocean.forEach(function (s) { destSeen[s.lane.to] = true; });
        Object.keys(destSeen).forEach(function (code) {
          const p = A.C.PORTS[code];
          const xy = proj(p.lng, p.lat);
          const g = el('g', {
            class: 'mv-port', 'data-type': 'port', 'data-id': code,
            transform: 'translate(' + xy[0].toFixed(1) + ',' + xy[1].toFixed(1) + ')'
          });
          const kp = el('g', { class: 'mv-kpt' });
          kp.appendChild(el('circle', { r: 2.8, class: 'mv-port-dot' }));
          kp.appendChild(txt('text', { x: -5, y: -5, class: 'mv-port-code', 'text-anchor': 'end' }, p.code));
          g.appendChild(kp);
          layers.nodes.appendChild(g);
        });
      }

      /* coverage rings */
      clear(layers.zones);
      if (lz.zones) {
        d.nodes.forEach(function (n) {
          const xy = proj(n.lng, n.lat);
          layers.zones.appendChild(el('circle', {
            cx: xy[0], cy: xy[1], r: milesToUnits(150, n.lat), class: 'mv-zone'
          }));
        });
      }

      /* planned route */
      clear(layers.routes); clear(layers.routeLab);
      const plan = d.draft && d.draft.plan;
      const newKey = plan ? plan.stops.join(',') + '|' + plan.origin : '';
      const animateRoute = newKey !== planKey && !!newKey;
      planKey = newKey;

      if (plan && plan.legs && plan.legs.length) {
        const pts = [];
        const origin = A.C.nodeById[plan.origin];
        pts.push(proj(origin.lng, origin.lat));
        plan.legs.forEach(function (l) { pts.push(proj(l.to.lng, l.to.lat)); });
        const dpath = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');

        const halo = el('path', { d: dpath, class: 'mv-route-halo' });
        const line = el('path', { d: dpath, class: 'mv-route' });
        const dash = el('path', { d: dpath, class: 'mv-route-dash' });
        if (animateRoute) {
          const total = line.getTotalLength ? line.getTotalLength() : 0;
          // measure after insertion for a proper draw-in
          requestAnimationFrame(function () {
            try {
              const L = line.getTotalLength();
              line.style.strokeDasharray = L;
              line.style.strokeDashoffset = L;
              line.style.transition = 'stroke-dashoffset .62s cubic-bezier(.32,.72,0,1)';
              requestAnimationFrame(function () { line.style.strokeDashoffset = '0'; });
            } catch (e) { }
          });
        }
        layers.routes.appendChild(halo);
        layers.routes.appendChild(line);
        layers.routes.appendChild(dash);

        plan.legs.forEach(function (l, i) {
          const p = proj(l.to.lng, l.to.lat);
          const g = el('g', { class: 'mv-stopmark', transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')' });
          const anim = el('g', { class: 'mv-stopanim' });
          if (animateRoute) anim.style.animation = 'mvDrop .42s cubic-bezier(.34,1.4,.64,1) ' + (0.06 + i * 0.07) + 's both';
          const kp = el('g', { class: 'mv-kpt' });
          kp.appendChild(el('circle', { r: 5.6, class: 'mv-stopmark-bg' }));
          kp.appendChild(txt('text', { y: 2.1, class: 'mv-stopmark-n' }, String(i + 1)));
          kp.appendChild(txt('text', { y: -8.4, class: 'mv-stopmark-time' }, l.late ? '迟到' : l.window.from));
          anim.appendChild(kp);
          g.appendChild(anim);
          layers.routeLab.appendChild(g);
        });
      }

      /* order pins */
      clear(layers.pins);
      if (lz.pins !== false) {
        const byLevel = d.colorBy === 'level';
        // orders that share a rooftop would hide each other — fan them out slightly
        const clusters = {};
        d.orders.forEach(function (o) {
          const key = o.lat.toFixed(3) + ',' + o.lng.toFixed(3);
          (clusters[key] = clusters[key] || []).push(o);
        });
        const offset = {};
        Object.keys(clusters).forEach(function (key) {
          const list = clusters[key];
          if (list.length < 2) return;
          const r = 1.35 * Math.sqrt(list.length - 1);
          list.forEach(function (o, i) {
            const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
            offset[o.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
          });
        });
        d.orders.forEach(function (o, i) {
          const p = proj(o.lng, o.lat);
          const off = offset[o.id] || { x: 0, y: 0 };
          const col = byLevel ? LEVEL_COLOR[o.level] : (STATUS_COLOR[o.status] || 'var(--mv-label-3)');
          const r = 3.5 + (o.units - 1) * 0.6;
          const g = el('g', {
            class: 'mv-pin', transform: 'translate(' + (p[0] + off.x).toFixed(1) + ',' + (p[1] + off.y).toFixed(1) + ')',
            'data-type': 'order', 'data-id': o.id
          });
          const inner = el('g', { class: 'mv-pin-in' });
          if (d.animateIn) inner.style.animation = 'mvPinIn .36s cubic-bezier(.34,1.3,.64,1) ' + Math.min(0.45, i * 0.005) + 's both';
          inner.appendChild(el('circle', { class: 'mv-pin-hit', r: 7.5 }));
          if (o.status === '异常') inner.appendChild(el('circle', { class: 'mv-pin-halo', r: r + 3.2 }));
          inner.appendChild(el('circle', { class: 'mv-pin-dot', r: r, fill: col }));
          g.appendChild(inner);
          layers.pins.appendChild(g);
        });
      }

      /* nodes */
      clear(layers.nodes);
      if (lz.nodes !== false) {
        d.nodes.forEach(function (n) {
          const p = proj(n.lng, n.lat);
          const isInv = n.kind === 'inv';
          const isOrigin = d.draft && d.draft.origin === n.id;
          const g = el('g', {
            class: 'mv-node' + (isOrigin ? ' is-origin' : ''),
            transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')',
            'data-type': 'node', 'data-id': n.id
          });
          g.appendChild(el('circle', { r: 11, class: 'mv-node-hit' }));
          g.appendChild(el('circle', { r: isInv ? 6.2 : 4.8, class: 'mv-node-ring' }));
          g.appendChild(el('circle', { r: isInv ? 3.6 : 2.8, class: 'mv-node-core' }));
          g.appendChild(el('circle', { r: isInv ? 6.2 : 4.8, class: 'mv-node-pulse' }));
          const label = el('g', { class: 'mv-kpt mv-nodelab' });
          label.appendChild(el('rect', {
            x: -(n.id.length * 2.5 + 7), y: isInv ? 11 : 9.4, width: n.id.length * 5 + 14,
            height: 11, rx: 5.5, class: 'mv-nodelab-bg'
          }));
          label.appendChild(txt('text', { y: isInv ? 19 : 17.4, class: 'mv-nodelab-t', 'text-anchor': 'middle' }, n.id));
          g.appendChild(label);
          layers.nodes.appendChild(g);
        });
      }

      refreshKpts();
      apply();
      if (sel) select(sel.type, sel.id);
    };

    /* ── camera ─────────────────────────────────────────────────────── */
    api.focusOn = function (lon, lat, k, animate) {
      const p = proj(lon, lat);
      const target = clamp(k || 4, MIN_K, MAX_K);
      // keep the point inside the visible band, not the raw canvas centre
      const cx = VB.x + VB.w * 0.56, cy = VB.y + VB.h * 0.5;
      const end = { k: target, tx: cx - p[0] * target, ty: cy - p[1] * target };
      stopMomentum();
      if (animate === false) { stopCam(); Object.assign(view, end); clampPan(); apply(); return; }
      animateView(end, 480);
    };
    api.fitWindow = function (animate) {
      const r = svg.getBoundingClientRect();
      api.fitRect({ l: 8, t: 8, r: r.width - 8, b: r.height - 8 }, animate);
    };
    /**
     * Frame the CONUS bounding box inside a rectangle of the stage (CSS px).
     * Keeps the country clear of the floating panels instead of centring on the
     * whole canvas.
     */
    const BOX = { x0: 6, y0: 6, x1: 994, y1: 618 };
    api.fitRect = function (rect, animate) {
      const r = svg.getBoundingClientRect();
      const W = r.width, H = r.height;
      if (!W || !H) return;
      const S = Math.min(W / VB.w, H / VB.h);
      const pad = 12;
      const kx = (rect.r - rect.l - pad) / (S * (BOX.x1 - BOX.x0));
      const ky = (rect.b - rect.t - pad) / (S * (BOX.y1 - BOX.y0));
      const k = clamp(Math.min(kx, ky), MIN_K, MAX_K);
      const cx = (rect.l + rect.r) / 2, cy = (rect.t + rect.b) / 2;
      const tx = (cx - W / 2) / S + VB.x + VB.w / 2 - k * (BOX.x0 + BOX.x1) / 2;
      const ty = (cy - H / 2) / S + VB.y + VB.h / 2 - k * (BOX.y0 + BOX.y1) / 2;
      const end = { k, tx, ty };
      stopMomentum();
      if (!animate) { stopCam(); Object.assign(view, end); apply(); return; }
      animateView(end, 460);
    };
    api.zoomIn = function () { zoomAt(1.55, null, true); };
    api.zoomOut = function () { zoomAt(0.64, null, true); };
    api.getZoom = function () { return view.k; };
    api.proj = proj;
    api.view = view;
    api.destroy = function () { if (svg.parentNode) svg.parentNode.removeChild(svg); };

    apply();
    return api;
  };

  A.MAP_PROJ = { proj: proj, latY: latY, milesToUnits: milesToUnits };
})(window);
