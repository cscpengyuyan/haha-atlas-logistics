/* ==========================================================================
   map.js — ATLAS map engine
   Albers-projected CONUS, pan/zoom, layered marks, ocean feeder lanes.
   No external tile service: the basemap ships with the site.
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
  // y for a latitude on the central meridian (used by the ocean gutter)
  function latY(lat) { return proj(PR.lon0, lat)[1]; }
  function milesToUnits(miles, lat) {
    const dl = miles / (69.172 * Math.cos((lat || 38) * RAD));
    const a = proj(PR.lon0, lat || 38), b = proj(PR.lon0 - dl, lat || 38);
    return Math.abs(a[0] - b[0]);
  }

  const VB = { x: -128, y: -12, w: G.vb[2] + 128 + 14, h: G.vb[3] + 24 };
  const GUTTER_X = -86;

  const COLORS = {
    '待派': 'var(--amber)', '待命': 'var(--violet)', '已派': 'var(--blue)',
    '执行中': 'var(--teal)', '已签收': 'var(--green)', '异常': 'var(--red)'
  };
  const LEVEL_COLORS = { L1: '#5b8def', L2: '#2dd4bf', L3: '#f5a524' };

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function txt(tag, attrs, s) { const n = el(tag, attrs); n.textContent = s; return n; }

  /* ── engine ───────────────────────────────────────────────────────── */
  A.MapEngine = function (host, opts) {
    opts = opts || {};
    const api = {};
    const svg = el('svg', {
      class: 'map-svg', viewBox: [VB.x, VB.y, VB.w, VB.h].join(' '),
      preserveAspectRatio: 'xMidYMid meet', role: 'img',
      'aria-label': '美国大件设备物流网络地图：仓库、区域站、订单点位与派车路线'
    });

    const vb = el('g', { id: 'vp' });
    const layers = {};
    ['grat', 'land', 'roads', 'stateLab', 'zones', 'lanes', 'gutter', 'routes', 'pins', 'nodes', 'routeLab'].forEach(function (k) {
      layers[k] = el('g', { class: 'mp-layer mp-layer--' + k });
      vb.appendChild(layers[k]);
    });
    svg.appendChild(vb);

    /* base map */
    const grat = el('g');
    for (let lon = -130; lon <= -60; lon += 10) {
      const a = proj(lon, 24), b = proj(lon, 50);
      grat.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
    for (let lat = 25; lat <= 50; lat += 5) {
      const a = proj(-126, lat), b = proj(-66, lat);
      grat.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
    }
    grat.setAttribute('class', 'mp-grat');
    layers.grat.appendChild(grat);

    G.states.forEach(function (s) {
      layers.land.appendChild(el('path', { d: s.d, class: 'mp-land', 'data-st': s.a }));
    });
    const roads = { other: 'mp-road mp-road--other', us: 'mp-road mp-road--us', inter: 'mp-road mp-road--inter' };
    Object.keys(roads).forEach(function (k) {
      if (!G.roads[k]) return;
      layers.roads.appendChild(el('path', { d: G.roads[k], class: roads[k] }));
    });

    G.states.forEach(function (s) {
      if (!s.a || s.a === 'DC') return;
      layers.stateLab.appendChild(txt('text', { x: s.x, y: s.y, class: 'mp-state-label' }, s.a));
    });

    host.appendChild(svg);

    /* ── view transform ─────────────────────────────────────────────── */
    const view = { k: 1.1, tx: -14, ty: -8 };
    const MIN_K = 0.82, MAX_K = 16;
    function apply() {
      vb.setAttribute('transform', 'translate(' + view.tx.toFixed(2) + ' ' + view.ty.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
      const k = view.k;
      layers.stateLab.style.opacity = k > 1.55 ? Math.min(1, (k - 1.55) * 1.6) : 0;
      layers.roads.style.opacity = k > 0.95 ? 1 : 0.7;
    }
    function toBase(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const m = svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      const p = pt.matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }
    function zoomAt(factor, basePt) {
      const p = basePt || { x: VB.x + VB.w / 2, y: VB.y + VB.h / 2 };
      const k2 = A.clamp(view.k * factor, MIN_K, MAX_K);
      const cx = (p.x - view.tx) / view.k, cy = (p.y - view.ty) / view.k;
      view.k = k2;
      view.tx = p.x - cx * k2;
      view.ty = p.y - cy * k2;
      clampPan();
      apply();
      if (opts.onZoom) opts.onZoom(view.k);
    }
    function clampPan() {
      const lim = VB.w * 0.72;
      view.tx = A.clamp(view.tx, -lim, lim);
      view.ty = A.clamp(view.ty, -lim * 0.62, lim * 0.62);
    }

    /* pointer interactions */
    let drag = null;
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      svg.classList.add('is-panning');
    });
    svg.addEventListener('pointermove', function (e) {
      if (drag) {
        const r = svg.getBoundingClientRect();
        const sx = VB.w / r.width, sy = VB.h / r.height;
        const dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sy;
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
    function endDrag(e) {
      if (!drag) return;
      svg.classList.remove('is-panning');
      const quick = drag.moved < 5;
      drag = null;
      if (quick) {
        const t = e.target.closest('[data-type]');
        if (t) { select(t.dataset.type, t.dataset.id); if (opts.onSelect) opts.onSelect(t.dataset.type, t.dataset.id); }
        else if (opts.onSelect) opts.onSelect(null, null);
      }
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', function () { drag = null; svg.classList.remove('is-panning'); });

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      zoomAt(f, toBase(e));
    }, { passive: false });

    svg.addEventListener('dblclick', function (e) { zoomAt(1.7, toBase(e)); });

    function hover(type, id, e) {
      api._hovering = true;
      if (opts.onHover) opts.onHover({ type, id, evt: e });
    }

    /* ── marks ──────────────────────────────────────────────────────── */
    let sel = null;
    function select(type, id) {
      sel = type ? { type, id } : null;
      Array.from(svg.querySelectorAll('.mp-pin.is-sel,.mp-node.is-sel')).forEach(function (n) { n.classList.remove('is-sel'); });
      if (!type) return;
      const n = svg.querySelector('[data-type="' + type + '"][data-id="' + id + '"]');
      if (n) n.classList.add('is-sel');
    }
    api.select = select;

    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

    api.render = function (d) {
      const state = d.state;
      const layersOn = state.ui.mapLayers || {};
      const filter = d.filter || {};

      /* ocean gutter + lanes */
      clear(layers.gutter);
      clear(layers.lanes);
      if (layersOn.lanes !== false) {
        const gx = GUTTER_X;
        layers.gutter.appendChild(el('line', {
          x1: -16, y1: latY(20), x2: -16, y2: latY(44),
          stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: .8
        }));
        layers.gutter.appendChild(txt('text', {
          x: gx - 26, y: latY(42) - 10, fill: 'var(--txt-3)', 'font-size': 8.5,
          'letter-spacing': '.14em', transform: 'rotate(-90 ' + (gx - 26) + ' ' + (latY(42) - 10) + ')'
        }, '中国起运港 · POL'));

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
            // via Panama: down the gutter, across the bottom, up to the Atlantic / Gulf port
            const by = VB.y + VB.h - 22;
            path = 'M' + gx + ' ' + fy +
              ' Q' + (gx - 10) + ' ' + (fy + 60) + ' ' + (gx + 18) + ' ' + (by - 30) +
              ' Q' + (gx + 60) + ' ' + by + ' ' + (gx + 160) + ' ' + by +
              ' L' + (txp[0] - 120) + ' ' + by +
              ' Q' + (txp[0] - 20) + ' ' + by + ' ' + txp[0].toFixed(1) + ' ' + (by - 34) +
              ' Q' + txp[0].toFixed(1) + ' ' + (by - 46) + ' ' + txp[0].toFixed(1) + ' ' + (txp[1] + 4).toFixed(1);
          }
          layers.lanes.appendChild(el('path', { d: path, class: 'mp-lane-glow' }));
          layers.lanes.appendChild(el('path', { d: path, class: 'mp-lane', style: 'animation-delay:' + (Math.random() * -18).toFixed(1) + 's' }));
        });
        if (Object.keys(groups).some(function (k) { return !/LGB|SEA/.test(k.split('>')[1]); })) {
          layers.gutter.appendChild(txt('text', {
            x: 396, y: VB.y + VB.h - 8, fill: 'var(--txt-3)', 'font-size': 8, 'letter-spacing': '.1em'
          }, '经巴拿马 · 示意图'));
        }

        // origin ports (China side, schematic gutter column)
        const seen = {};
        d.ocean.forEach(function (s) { seen[s.lane.from] = true; });
        Object.keys(seen).forEach(function (code) {
          const p = A.C.PORTS[code];
          const y = latY(p.lat);
          const g = el('g', { class: 'mp-node', 'data-type': 'port', 'data-id': code, transform: 'translate(' + GUTTER_X + ',' + y.toFixed(1) + ')' });
          g.appendChild(el('circle', { r: 6, fill: 'none', stroke: 'var(--teal)', 'stroke-width': 1, opacity: .45 }));
          g.appendChild(el('circle', { r: 2.6, fill: 'var(--teal)' }));
          g.appendChild(txt('text', { x: 10, y: 3, fill: 'var(--txt-2)', 'font-size': 8.5, 'font-weight': 600 }, p.code));
          g.appendChild(txt('text', { x: 10, y: 12, fill: 'var(--txt-3)', 'font-size': 7 }, p.name));
          layers.gutter.appendChild(g);
        });
        // destination ports
        const destSeen = {};
        d.ocean.forEach(function (s) { destSeen[s.lane.to] = true; });
        Object.keys(destSeen).forEach(function (code) {
          const p = A.C.PORTS[code];
          const xy = proj(p.lng, p.lat);
          const g = el('g', { class: 'mp-node', 'data-type': 'port', 'data-id': code, transform: 'translate(' + xy[0].toFixed(1) + ',' + xy[1].toFixed(1) + ')' });
          g.appendChild(el('circle', { r: 4.5, fill: 'none', stroke: 'var(--teal)', 'stroke-width': 1.2, opacity: .55 }));
          g.appendChild(el('circle', { r: 2.2, fill: 'var(--teal)' }));
          g.appendChild(txt('text', { x: -6, y: -6, fill: 'var(--teal)', 'font-size': 7.5, 'font-weight': 700, 'text-anchor': 'end' }, p.code));
          layers.nodes.appendChild(g);
        });
      }

      /* coverage zones */
      clear(layers.zones);
      if (layersOn.zones) {
        d.nodes.forEach(function (n) {
          const xy = proj(n.lng, n.lat);
          const r = milesToUnits(150, n.lat);
          layers.zones.appendChild(el('circle', { cx: xy[0], cy: xy[1], r: r, class: 'mp-ringzone' }));
        });
      }

      /* planned route */
      clear(layers.routes);
      clear(layers.routeLab);
      const plan = d.draft && d.draft.plan;
      if (plan && plan.legs && plan.legs.length) {
        const pts = [];
        const origin = A.C.nodeById[plan.origin];
        pts.push(proj(origin.lng, origin.lat));
        plan.legs.forEach(function (l) { pts.push(proj(l.to.lng, l.to.lat)); });
        const dpath = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
        layers.routes.appendChild(el('path', { d: dpath, class: 'mp-route-halo' }));
        layers.routes.appendChild(el('path', { d: dpath, class: 'mp-route' }));
        plan.legs.forEach(function (l, i) {
          const p = proj(l.to.lng, l.to.lat);
          const g = el('g', { transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')' });
          g.appendChild(el('circle', { r: 6.4, fill: 'var(--amber)', stroke: '#070b12', 'stroke-width': 1.4, opacity: .95 }));
          g.appendChild(txt('text', { y: 2.4, 'text-anchor': 'middle', 'font-size': 6.6, 'font-weight': 800, fill: '#221503' }, String(i + 1)));
          layers.routeLab.appendChild(g);
        });
      }

      /* order pins */
      clear(layers.pins);
      if (layersOn.pins !== false) {
        const byLevel = d.colorBy === 'level';
        d.orders.forEach(function (o) {
          const p = proj(o.lng, o.lat);
          const col = byLevel ? LEVEL_COLORS[o.level] : (COLORS[o.status] || 'var(--txt-3)');
          const r = 2.9 + (o.units - 1) * 0.7;
          const g = el('g', {
            class: 'mp-pin', transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')',
            'data-type': 'order', 'data-id': o.id
          });
          g.appendChild(el('circle', { class: 'hit', r: 7.5 }));
          if (o.status === '异常') {
            g.appendChild(el('circle', { r: r + 2.2, fill: 'none', stroke: 'var(--red)', 'stroke-width': .9, opacity: .8 }));
          }
          g.appendChild(el('circle', { class: 'dot', r: r, fill: col }));
          layers.pins.appendChild(g);
        });
      }

      /* warehouse + station nodes */
      clear(layers.nodes);
      if (layersOn.nodes !== false) {
        d.nodes.forEach(function (n) {
          if (filter.node && filter.node !== n.id) return;
          const p = proj(n.lng, n.lat);
          const g = el('g', { class: 'mp-node', transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')', 'data-type': 'node', 'data-id': n.id });
          const isInv = n.kind === 'inv';
          g.appendChild(el('circle', { class: 'ring', r: isInv ? 9.5 : 7.5, stroke: isInv ? 'var(--amber)' : 'var(--violet)' }));
          g.appendChild(el('circle', { r: isInv ? 4.2 : 3.2, fill: isInv ? 'var(--amber)' : 'var(--violet)' }));
          g.appendChild(el('circle', { class: 'core', r: isInv ? 4.2 : 3.2, fill: 'none' }));
          g.appendChild(txt('text', {
            x: 0, y: isInv ? 17 : 14.5, 'text-anchor': 'middle', 'font-size': 6.4,
            'font-weight': 700, fill: 'var(--txt-2)', 'paint-order': 'stroke',
            stroke: 'var(--bg)', 'stroke-width': 2.2, 'stroke-linejoin': 'round'
          }, n.id));
          if (n.pilot) {
            g.appendChild(txt('text', { x: 0, y: -13, 'text-anchor': 'middle', 'font-size': 5.8, fill: 'var(--amber)', 'letter-spacing': '.08em', 'font-weight': 700 }, 'PILOT'));
          }
          layers.nodes.appendChild(g);
        });
      }

      if (sel) select(sel.type, sel.id);
    };

    /* ── camera helpers ─────────────────────────────────────────────── */
    api.focusOn = function (lon, lat, k) {
      const p = proj(lon, lat);
      view.k = A.clamp(k || 4, MIN_K, MAX_K);
      view.tx = VB.x + VB.w / 2 - p[0] * view.k;
      view.ty = VB.y + VB.h / 2 - p[1] * view.k;
      clampPan(); apply();
    };
    api.fitWindow = function () {
      view.k = 1.1; view.tx = -14; view.ty = -8; apply();
    };
    api.fitBounds = function (pts, pad) {
      if (!pts.length) return api.fitWindow();
      const xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      const minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
      const miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
      const bw = Math.max(60, maxx - minx), bh = Math.max(60, maxy - miny);
      const k = A.clamp(Math.min(VB.w / (bw + (pad || 120)), VB.h / (bh + (pad || 120))), MIN_K, 7);
      view.k = k;
      view.tx = VB.x + VB.w / 2 - ((minx + maxx) / 2) * k;
      view.ty = VB.y + VB.h / 2 - ((miny + maxy) / 2) * k;
      clampPan(); apply();
    };
    api.zoom = function (f) { zoomAt(f); };
    api.proj = proj;
    api.view = view;
    api.destroy = function () { if (svg.parentNode) svg.parentNode.removeChild(svg); };

    apply();
    return api;
  };

  A.MAP_PROJ = { proj: proj, latY: latY, milesToUnits: milesToUnits };
})(window);
