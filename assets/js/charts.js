/* ==========================================================================
   charts.js — dependency-free SVG chart fragments (returned as markup strings)
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt;
  const C = {};

  function pathFrom(vals, w, h, pad) {
    const n = vals.length;
    if (!n) return { d: '', pts: [] };
    const max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    const span = max - min || 1;
    const pts = vals.map(function (v, i) {
      const x = pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return [x, y];
    });
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return { d, pts };
  }

  C.spark = function (vals, opt) {
    opt = opt || {};
    const w = opt.w || 132, h = opt.h || 34, pad = 3;
    const col = opt.color || 'var(--teal)';
    const id = 'sp' + Math.random().toString(36).slice(2, 7);
    const { d, pts } = pathFrom(vals, w, h, pad);
    const area = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (h - pad) + 'Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true" style="overflow:visible">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + col + '" stop-opacity=".28"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + id + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      (opt.dot === false ? '' : '<circle cx="' + pts[pts.length - 1][0].toFixed(1) + '" cy="' + pts[pts.length - 1][1].toFixed(1) + '" r="2.4" fill="' + col + '"/>') +
      '</svg>';
  };

  C.donut = function (segs, opt) {
    opt = opt || {};
    const size = opt.size || 132, th = opt.thick || 13;
    const r = (size - th) / 2, cx = size / 2, cy = size / 2;
    const total = A.sum(segs, (s) => s.v) || 1;
    let a0 = -Math.PI / 2, out = '';
    segs.forEach(function (s) {
      const a1 = a0 + (s.v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      if (s.v > 0) {
        out += '<path d="M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' +
          x1.toFixed(2) + ' ' + y1.toFixed(2) + '" fill="none" stroke="' + s.c + '" stroke-width="' + th + '" stroke-linecap="butt"/>';
      }
      a0 = a1;
    });
    const center = opt.center
      ? '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="21" font-weight="700" fill="var(--txt)" style="font-variant-numeric:tabular-nums">' + opt.center + '</text>' +
        '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="9.5" fill="var(--txt-3)" letter-spacing=".08em">' + (opt.label || '') + '</text>'
      : '';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--panel-3)" stroke-width="' + th + '"/>' +
      out + center + '</svg>';
  };

  C.bars = function (items, opt) {
    opt = opt || {};
    const max = Math.max.apply(null, items.map((i) => i.v)) || 1;
    return '<div class="stack" style="gap:7px">' + items.map(function (i) {
      const pct = Math.max(1.5, (i.v / max) * 100);
      return '<div style="display:grid;grid-template-columns:' + (opt.labelW || 96) + 'px 1fr auto;gap:9px;align-items:center;font-size:11.5px">' +
        '<span style="color:var(--txt-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + i.k + '</span>' +
        '<span style="height:7px;border-radius:4px;background:var(--panel-3);overflow:hidden;position:relative">' +
        '<i style="position:absolute;inset:0 auto 0 0;width:' + pct.toFixed(1) + '%;border-radius:4px;background:' + (i.c || 'var(--amber)') + '"></i></span>' +
        '<b class="num" style="font-size:11px;color:var(--txt)">' + (i.t || i.v) + '</b></div>';
    }).join('') + '</div>';
  };

  C.waterfall = function (items, opt) {
    opt = opt || {};
    const w = opt.w || 760, h = opt.h || 168, padL = 6, padB = 30, padT = 20;
    const steps = items.length;
    const bw = (w - padL * 2) / steps;
    const max = Math.max.apply(null, items.map((d) => Math.abs(d.abs))) || 1;
    const scale = (h - padB - padT) / max;
    let running = 0, out = '', prevX = null, prevY = null;
    const zeroY = h - padB;
    items.forEach(function (d, i) {
      const x = padL + i * bw + bw * 0.16;
      const bwid = bw * 0.68;
      let y, hgt;
      if (d.kind === 'total') {
        y = zeroY - d.abs * scale; hgt = d.abs * scale;
        running = d.abs;
      } else {
        const start = running;
        running += d.abs;
        const top = Math.max(start, running);
        y = zeroY - top * scale; hgt = Math.abs(d.abs) * scale;
      }
      const col = d.kind === 'total' ? 'var(--blue)' : d.kind === 'cut' ? 'var(--green)' : d.kind === 'add' ? 'var(--red)' : 'var(--txt-3)';
      // connector from the previous step's running level
      const levelY = zeroY - (d.kind === 'total' ? Math.max(0, running - d.abs) : Math.max(0, running - d.abs)) * scale;
      if (prevX != null) {
        out += '<line x1="' + prevX.toFixed(1) + '" y1="' + levelY.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + levelY.toFixed(1) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>';
      }
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bwid.toFixed(1) + '" height="' + Math.max(1, hgt).toFixed(1) + '" rx="3" fill="' + col + '" opacity=".9"/>';
      out += '<text x="' + (x + bwid / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="600" fill="var(--txt-2)" style="font-variant-numeric:tabular-nums">' + d.label + '</text>';
      out += '<text x="' + (x + bwid / 2).toFixed(1) + '" y="' + (h - 9) + '" text-anchor="middle" font-size="8.6" fill="var(--txt-3)">' + d.k + '</text>';
      prevX = x + bwid;
      prevY = zeroY - running * scale;
    });
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img">' +
      '<line x1="' + padL + '" y1="' + zeroY + '" x2="' + (w - padL) + '" y2="' + zeroY + '" stroke="var(--line)"/>' + out + '</svg>';
  };

  C.gauge = function (pct, opt) {
    opt = opt || {};
    const size = opt.size || 76, th = opt.thick || 7;
    const r = (size - th) / 2, cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const dash = circ * Math.max(0, Math.min(1, pct));
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--panel-3)" stroke-width="' + th + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + (opt.color || 'var(--teal)') + '" stroke-width="' + th + '" stroke-linecap="round" ' +
      'stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' +
      '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="' + (opt.fs || 15) + '" font-weight="700" fill="var(--txt)" style="font-variant-numeric:tabular-nums">' + (opt.text || Math.round(pct * 100) + '%') + '</text>' +
      '</svg>';
  };

  C.steps = function (n, active, opt) {
    opt = opt || {};
    let out = '';
    for (let i = 0; i < n; i++) {
      const on = i <= active;
      out += '<i style="flex:1;height:3px;border-radius:2px;background:' + (on ? (opt.color || 'var(--teal)') : 'var(--panel-3)') + ';opacity:' + (on ? 1 : .8) + '"></i>';
    }
    return '<div style="display:flex;gap:3px">' + out + '</div>';
  };

  A.charts = C;
})(window);
