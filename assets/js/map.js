/* ==========================================================================
   map.js — ATLAS map engine (Leaflet + CARTO light basemap)
   A real road map: OSM-derived raster tiles with an offline state-outline
   fallback. Markers, clusters, routes and ocean lanes ride on top.
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A;
  const L = w.L;

  const US_BOUNDS = [[24.6, -125.2], [49.5, -66.6]];
  // keyless basemaps, tried in order: Esri street → OSM standard → offline outlines
  const TILE_SOURCES = [
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
      opts: { maxZoom: 19 }
    },
    {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      opts: { maxZoom: 19 }
    }
  ];

  const STATUS_COLOR = {
    '待派': '#F59E0B', '待命': '#8B5CF6', '已派': '#2563EB', '执行中': '#0D9488',
    '已签收': '#16A34A', '异常': '#DC2626'
  };
  const LEVEL_COLOR = { L1: '#2563EB', L2: '#0D9488', L3: '#F59E0B' };

  function arc(a, b, bulge) {
    // curved path between two [lat,lng] points, always taking the short way round
    let bLng = b[1];
    if (bLng - a[1] > 180) bLng -= 360;
    if (bLng - a[1] < -180) bLng += 360;
    const bb = [b[0], bLng];
    const pts = [];
    const n = 40;
    const mlat = (a[0] + bb[0]) / 2, mlng = (a[1] + bb[1]) / 2;
    const dlat = bb[0] - a[0], dlng = bb[1] - a[1];
    const len = Math.sqrt(dlat * dlat + dlng * dlng) || 1;
    const nx = -dlng / len, ny = dlat / len;
    const off = (bulge == null ? 0.18 : bulge) * len;
    const cx = mlat + nx * off, cy = mlng + ny * off;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      pts.push([
        u * u * a[0] + 2 * u * t * cx + t * t * bb[0],
        u * u * a[1] + 2 * u * t * cy + t * t * bb[1]
      ]);
    }
    return pts;
  }

  A.MapEngine = function (host, opts) {
    opts = opts || {};
    const api = {};

    const map = L.map(host, {
      zoomControl: false,
      attributionControl: false,
      center: [38.5, -96],
      zoom: 4,
      minZoom: 2,
      maxZoom: 14,
      zoomSnap: 0,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 110,
      worldCopyJump: true,
      preferCanvas: true,
      inertia: true,
      inertiaDeceleration: 2600
    });

    /* ── basemap (progressive fallback) ────────────────────────────── */
    let srcIndex = 0, tileErrors = 0, tiles = null;
    const fallback = L.layerGroup();

    function mountTiles(i) {
      const src = TILE_SOURCES[i];
      tiles = L.tileLayer(src.url, Object.assign({
        attribution: src.attribution,
        crossOrigin: true,
        detectRetina: false,
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
      }, src.opts || {}));
      tiles.on('tileerror', function () {
        tileErrors++;
        if (tileErrors >= 5) {
          tileErrors = 0;
          map.removeLayer(tiles);
          if (srcIndex + 1 < TILE_SOURCES.length) {
            srcIndex++;
            mountTiles(srcIndex);
          } else {
            showFallback();
            if (opts.onTilesFail) opts.onTilesFail();
          }
        }
      });
      tiles.addTo(map);
      tiles.setZIndex(0);
    }

    function showFallback() {
      const geo = w.US_STATES;
      host.style.background = '#eef2f7';
      if (!geo) return;
      L.geoJSON(geo, {
        style: { color: '#c7d2e0', weight: 1, fillColor: '#f7f9fc', fillOpacity: 1 },
        interactive: false
      }).addTo(fallback);
      fallback.addTo(map);
    }

    mountTiles(0);

    /* ── panes / groups ─────────────────────────────────────────────── */
    const gLanes = L.layerGroup().addTo(map);
    const gRoute = L.layerGroup().addTo(map);
    const gNodes = L.layerGroup().addTo(map);
    const gOrders = L.layerGroup().addTo(map);
    const gPorts = L.layerGroup().addTo(map);

    let data = { orders: [], nodes: [], ocean: [], draft: null };
    let selected = null;
    let zoomHandler = null;

    /* ── markers ────────────────────────────────────────────────────── */
    function dotIcon(size, color, pulse) {
      return L.divIcon({
        className: 'mv-doticon',
        html: '<span class="mv-dotmark' + (pulse ? ' is-pulse' : '') + '" style="--c:' + color + ';width:' + size + 'px;height:' + size + 'px"></span>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
    }

    function nodeIcon(n, isOrigin) {
      const cls = n.kind === 'inv' ? 'is-inv' : 'is-stn';
      return L.divIcon({
        className: 'mv-nodeicon',
        html: '<span class="mv-nodeglow ' + cls + (isOrigin ? ' is-origin' : '') + '"></span>' +
          '<span class="mv-nodelabel ' + cls + (isOrigin ? ' is-origin' : '') + '">' + n.id + '</span>',
        iconSize: [64, 40],
        iconAnchor: [32, 14]
      });
    }

    function clusterIcon(count) {
      const size = count > 24 ? 40 : count > 9 ? 34 : 28;
      return L.divIcon({
        className: 'mv-clustericon',
        html: '<span class="mv-cluster" style="width:' + size + 'px;height:' + size + 'px">' + count + '</span>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });
    }

    function stopIcon(i, late) {
      return L.divIcon({
        className: 'mv-stopicon',
        html: '<span class="mv-stopmark2' + (late ? ' is-late' : '') + '">' + i + '</span>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
    }

    function portIcon(code, name, kind) {
      return L.divIcon({
        className: 'mv-porticon',
        html: '<span class="mv-portdot ' + kind + '"></span><span class="mv-portlab ' + kind + '">' + code +
          (name ? '<i>' + name + '</i>' : '') + '</span>',
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      });
    }

    /* ── render ─────────────────────────────────────────────────────── */
    function clearAll() {
      gLanes.clearLayers(); gRoute.clearLayers(); gNodes.clearLayers();
      gOrders.clearLayers(); gPorts.clearLayers();
    }

    function renderOrders() {
      gOrders.clearLayers();
      const byLevel = data.colorBy === 'level';
      const z = map.getZoom();
      const items = data.orders;
      if (!items.length) return;

      // cluster when zoomed out, individual markers when close in
      const cell = z >= 9 ? 0 : z >= 7 ? 26 : z >= 5 ? 40 : 56;
      let groups;
      if (!cell) {
        groups = items.map(function (o) { return [o]; });
      } else {
        const buckets = new Map();
        items.forEach(function (o) {
          const p = map.project([o.lat, o.lng], z);
          const k = Math.round(p.x / cell) + ':' + Math.round(p.y / cell);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(o);
        });
        groups = Array.from(buckets.values());
      }

      groups.forEach(function (list) {
        if (list.length === 1) {
          const o = list[0];
          const color = byLevel ? LEVEL_COLOR[o.level] : (STATUS_COLOR[o.status] || '#64748B');
          const r = 6 + (o.units - 1) * 1.1;
          const m = L.circleMarker([o.lat, o.lng], {
            radius: r, color: '#fff', weight: 2, opacity: 1,
            fillColor: color, fillOpacity: 1,
            bubblingMouseEvents: true
          });
          m.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            if (opts.onSelect) opts.onSelect('order', o.id);
          });
          m.on('mouseover', function (e) { if (opts.onHover) opts.onHover({ type: 'order', id: o.id, evt: e.originalEvent }); });
          m.on('mouseout', function () { if (opts.onHover) opts.onHover(null); });
          m.addTo(gOrders);
          if (selected && selected.type === 'order' && selected.id === o.id) m.setStyle({ weight: 3, color: '#0F172A' });
        } else {
          let lat = 0, lng = 0;
          list.forEach(function (o) { lat += o.lat; lng += o.lng; });
          lat /= list.length; lng /= list.length;
          const mk = L.marker([lat, lng], { icon: clusterIcon(list.length), keyboard: false });
          mk.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            map.flyTo([lat, lng], Math.min(11, map.getZoom() + 2.2), { duration: 0.55 });
          });
          mk.addTo(gOrders);
        }
      });
    }

    function renderNodes() {
      gNodes.clearLayers();
      const originId = data.draft && data.draft.origin;
      data.nodes.forEach(function (n) {
        const mk = L.marker([n.lat, n.lng], { icon: nodeIcon(n, n.id === originId), zIndexOffset: 500, keyboard: false });
        mk.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          if (opts.onSelect) opts.onSelect('node', n.id);
        });
        mk.on('mouseover', function (e) { if (opts.onHover) opts.onHover({ type: 'node', id: n.id, evt: e.originalEvent }); });
        mk.on('mouseout', function () { if (opts.onHover) opts.onHover(null); });
        mk.addTo(gNodes);
      });
    }

    function renderRoute() {
      gRoute.clearLayers();
      const plan = data.draft && data.draft.plan;
      if (!plan || !plan.legs || !plan.legs.length) return;
      const origin = A.C.nodeById[plan.origin];
      const pts = [[origin.lat, origin.lng]];
      plan.legs.forEach(function (l) { pts.push([l.to.lat, l.to.lng]); });

      L.polyline(pts, { color: '#ffffff', weight: 9, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(gRoute);
      L.polyline(pts, { color: '#2563EB', weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(gRoute);

      plan.legs.forEach(function (l, i) {
        L.marker([l.to.lat, l.to.lng], { icon: stopIcon(i + 1, l.late), zIndexOffset: 600, keyboard: false })
          .addTo(gRoute);
        const hh = String(Math.floor(l.start / 60) % 24).padStart(2, '0') + ':' + String(Math.round(l.start) % 60).padStart(2, '0');
        L.marker([l.to.lat, l.to.lng], {
          interactive: false,
          icon: L.divIcon({ className: 'mv-anchor', html: '', iconSize: [1, 1] })
        }).bindTooltip(hh, {
          permanent: true, direction: 'bottom', className: 'mv-legtip' + (l.late ? ' is-late' : ''), offset: [0, 2]
        }).addTo(gRoute);
      });
    }

    function renderLanes() {
      gLanes.clearLayers();
      gPorts.clearLayers();
      if (!data.ocean || !data.ocean.length) return;
      const seen = {};
      data.ocean.forEach(function (s) {
        const key = s.lane.from + '>' + s.lane.to;
        if (seen[key]) return;
        seen[key] = 1;
        const from = A.C.PORTS[s.lane.from], to = A.C.PORTS[s.lane.to];
        const path = arc([from.lat, from.lng], [to.lat, to.lng], 0.16);
        L.polyline(path, { color: '#0EA5E9', weight: 2, opacity: 0.55, dashArray: '5 7' }).addTo(gLanes);
      });
      const origins = {}, dests = {};
      data.ocean.forEach(function (s) { origins[s.lane.from] = 1; dests[s.lane.to] = 1; });
      Object.keys(origins).forEach(function (code) {
        const p = A.C.PORTS[code];
        L.marker([p.lat, p.lng], { icon: portIcon(code, p.name, 'is-origin'), keyboard: false })
          .on('click', function () { if (opts.onSelect) opts.onSelect('port', code); })
          .addTo(gPorts);
      });
      Object.keys(dests).forEach(function (code) {
        const p = A.C.PORTS[code];
        L.marker([p.lat, p.lng], { icon: portIcon(code, '', 'is-dest'), keyboard: false })
          .on('click', function () { if (opts.onSelect) opts.onSelect('port', code); })
          .addTo(gPorts);
      });
    }

    api.render = function (d) {
      data = d;
      if (zoomHandler == null) {
        zoomHandler = function () { renderOrders(); };
        map.on('zoomend', zoomHandler);
      }
      const lz = (d.state.ui.mapLayers) || {};
      renderNodes();
      renderOrders();
      renderRoute();
      if (lz.lanes !== false) renderLanes(); else { gLanes.clearLayers(); gPorts.clearLayers(); }
      // keep the tile layer on top of nothing else; vectors live above tiles by pane order
    };

    api.select = function (type, id) {
      selected = type ? { type, id } : null;
      renderOrders();
    };

    /* ── camera ─────────────────────────────────────────────────────── */
    api.fitUS = function (animate) {
      const pad = opts.getPadding ? opts.getPadding() : { tl: [16, 16], br: [16, 16] };
      map.fitBounds(L.latLngBounds(US_BOUNDS), {
        paddingTopLeft: pad.tl,
        paddingBottomRight: pad.br,
        animate: !!animate,
        duration: 0.6
      });
    };
    api.focusOn = function (lat, lng, zoom) {
      map.flyTo([lat, lng], Math.min(12, Math.max(zoom || 9, map.getZoom())), { duration: 0.65 });
    };
    api.zoomIn = function () { map.zoomIn(1); };
    api.zoomOut = function () { map.zoomOut(1); };
    api.getZoom = function () { return map.getZoom(); };
    api.invalidate = function () { setTimeout(function () { map.invalidateSize(); }, 60); };
    api.fitRoute = function () {
      const plan = data.draft && data.draft.plan;
      if (!plan || !plan.legs.length) return;
      const origin = A.C.nodeById[plan.origin];
      const b = L.latLngBounds([[origin.lat, origin.lng]]);
      plan.legs.forEach(function (l) { b.extend([l.to.lat, l.to.lng]); });
      map.fitBounds(b, { padding: [90, 90], maxZoom: 11, animate: true });
    };
    api.map = map;
    api.destroy = function () { map.remove(); };

    opts.getPadding && api.fitUS(false);
    return api;
  };
})(window);
