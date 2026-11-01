/* ==========================================================================
   view-map.js — 地图调度：点位、筛选、派车计划与窗口可行性
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt, dt = A.dt;

  const STATUSES = ['待派', '待命', '已派', '执行中', '已签收', '异常'];
  const DRIVERS = ['M. Alvarez', 'J. Whitaker', 'R. Patel', 'D. Okafor', 'L. Nguyen', 'C. Ramirez'];
  const PLATES = ['TX-8842-KB', 'TX-2271-QD', 'CA-5510-MR', 'NJ-9930-TX', 'FL-4417-LP'];

  let engine = null;
  let view = null;

  /* ── helpers ─────────────────────────────────────────────────────── */
  function svcMinutes(o) {
    const base = o.level === 'L1' ? 18 : o.level === 'L2' ? 32 : 55;
    let m = base + (o.units - 1) * base * 0.45;
    if (o.l4) m += 40;
    if (o.l5) m += 65;
    return Math.round(m);
  }
  function driveMinutes(miles) {
    // conservative first-pass: 52 mph average on interstate + 12 min per 180 miles for rest/scale
    return Math.round((miles / 52) * 60 + Math.floor(miles / 180) * 12);
  }
  function hhmm(min) {
    const m = Math.max(0, Math.round(min));
    return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function toMin(hhmmStr) {
    const [h, m] = String(hhmmStr).split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function planStops(originId, picks, strategy, state) {
    const origin = A.C.nodeById[originId];
    const pts = picks.map(function (id) { return state.orders.find((o) => o.id === id); }).filter(Boolean);
    if (strategy === 'nearest') {
      const rest = pts.slice(), seq = [];
      let cur = origin;
      while (rest.length) {
        let bi = 0, bd = Infinity;
        rest.forEach(function (o, i) {
          const d = A.geo.roadMiles(cur, o);
          if (d < bd) { bd = d; bi = i; }
        });
        seq.push(rest.splice(bi, 1)[0]);
        cur = seq[seq.length - 1];
      }
      return seq;
    }
    return pts.slice().sort(function (a, b) {
      const ka = a.window.date + ' ' + a.window.from, kb = b.window.date + ' ' + b.window.from;
      return ka.localeCompare(kb);
    });
  }

  function buildPlan(state, originId, stopIds, strategy) {
    const origin = A.C.nodeById[originId];
    if (!origin || !stopIds.length) return null;
    const seq = planStops(originId, stopIds, strategy, state);
    const legs = [];
    let clock = 8 * 60;           // 仓口可放货时刻（演示：08:00）
    let prev = origin, totalMiles = 0, totalDrive = 0, violations = 0, waitTotal = 0;

    seq.forEach(function (o, i) {
      const miles = Math.round(A.geo.roadMiles(prev, o));
      const drive = driveMinutes(miles);
      const arrive = clock + drive;
      const wFrom = toMin(o.window.from), wTo = toMin(o.window.to);
      let wait = 0, start = arrive;
      if (arrive < wFrom) { wait = wFrom - arrive; start = wFrom; }
      const svc = svcMinutes(o);
      const depart = start + svc;
      const late = start > wTo;
      const tight = !late && depart > wTo;
      if (late || tight) violations++;
      legs.push({
        idx: i + 1, order: o, from: i === 0 ? origin : seq[i - 1], to: o,
        miles, drive, arrive, start, depart, wait, svc,
        window: o.window, late, tight,
        slack: wTo - (start + svc)
      });
      totalMiles += miles; totalDrive += drive; waitTotal += wait;
      clock = depart;
      prev = o;
    });

    /* cost model: shared fixed cost + per-stop first unit + same-zip add-on */
    const stops = [];
    legs.forEach(function (l) {
      const z = l.to.zip;
      let st = stops.find((s) => s.zip === z);
      if (!st) stops.push(st = { zip: z, units: 0, orders: [], mileage: 0 });
      st.units += l.to.units;
      st.orders.push(l.to);
      st.mileage += l.miles;
    });
    const FIXED = 38, OUT = A.C.RATE.outbound, STOPFEE = A.C.RATE.stop;
    let single = 0, combined = 0;
    const lines = [];
    seq.forEach(function (o) {
      const q = A.pricing.quote(o, 'B');
      single += q.total + FIXED + OUT * (o.units - 1); // each trip repeats the fixed dispatch cost
    });
    stops.forEach(function (st) {
      const first = st.orders[0];
      const f = A.pricing.firstPrice('B', first.level, first.l4);
      const e = A.pricing.extraPrice('B', first.level, first.l4);
      const tech = A.sum(st.orders, (o) => (o.l5 ? A.C.ADDONS.L5.fee * o.units : 0));
      st.cost = OUT * st.units + f + e * (st.units - 1) + STOPFEE + tech;
      lines.push({
        zip: st.zip, city: first.city, units: st.units,
        first: f, extra: e, extraCount: st.units - 1, stop: STOPFEE,
        out: OUT * st.units, tech, total: st.cost,
        level: first.level, orders: st.orders
      });
      combined += st.cost;
    });
    combined += FIXED;

    const sameZipSaved = stops.reduce(function (a, st) {
      if (st.units < 2) return a;
      const f = A.pricing.firstPrice('B', st.orders[0].level, st.orders[0].l4);
      const e = A.pricing.extraPrice('B', st.orders[0].level, st.orders[0].l4);
      return a + (f - e) * (st.units - 1);
    }, 0);

    return {
      origin: originId, strategy, legs, lines,
      miles: totalMiles, drive: totalDrive, wait: waitTotal,
      finish: clock, violations,
      single: Math.round(single), combined: Math.round(combined),
      saved: Math.round(single - combined), sameZipSaved: Math.round(sameZipSaved),
      stops: seq.map((o) => o.id),
      units: A.sum(seq, (o) => o.units)
    };
  }

  /* ── dock renderers ──────────────────────────────────────────────── */
  function renderTabs(s, tab) {
    const tabs = [['plan', '派车计划'], ['orders', '订单池'], ['nodes', '节点']];
    return '<div class="dock-tabs">' + tabs.map(function (t) {
      return '<button data-act="tab" data-tab="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] +
        (t[0] === 'plan' && s.draft.stops.length ? ' <span class="tag tag--amber" style="height:15px;padding:0 4px;font-size:9px">' + s.draft.stops.length + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function renderPlanTab(s) {
    const origin = A.C.nodeById[s.draft.origin];
    const plan = s.draft.plan;
    const candidates = s.orders.filter(function (o) {
      return o.nodeId === s.draft.origin && (o.status === '待派' || o.status === '待命') && !s.draft.stops.includes(o.id);
    }).sort(function (a, b) { return (a.window.date + a.window.from).localeCompare(b.window.date + b.window.from); });

    let out = '';

    /* origin */
    out += '<div><div class="sec-t">起运仓<span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">' + (origin ? origin.city + ' ' + origin.zip : '') + '</span></div>' +
      '<select class="select" data-act="origin" style="width:100%">' +
      A.C.NODES.map(function (n) {
        const kind = n.kind === 'inv' ? '库存仓' : '区域站';
        return '<option value="' + n.id + '"' + (n.id === s.draft.origin ? ' selected' : '') + '>' + n.id + ' · ' + n.name + '（' + kind + '）</option>';
      }).join('') + '</select></div>';

    /* selected stops */
    if (s.draft.stops.length) {
      out += '<div><div class="sec-t">已选站点<span class="sp"></span><button class="btn btn--sm btn--ghost" data-act="clear-plan">清空</button></div>' +
        '<div class="stack" style="gap:6px">' + s.draft.stops.map(function (id, i) {
          const o = s.orders.find((x) => x.id === id);
          if (!o) return '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line-soft)">' +
            '<b class="num" style="width:15px;height:15px;border-radius:4px;background:var(--amber);color:#221503;display:grid;place-items:center;font-size:9.5px">' + (i + 1) + '</b>' +
            '<div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + o.city + ' ' + o.zip + '</div>' +
            '<div style="font-size:10px;color:var(--txt-3)">' + o.model + ' ×' + o.units + ' · ' + o.level + ' · ' + dt.mmdd(o.window.date) + ' ' + o.window.from + '</div></div>' +
            '<button class="icon-btn" style="width:22px;height:22px" data-act="remove-stop" data-id="' + o.id + '" aria-label="移除">✕</button></div>';
        }).join('') + '</div></div>';

      /* strategy */
      out += '<div class="row" style="gap:6px"><span class="muted" style="font-size:10.5px">站序</span>' +
        '<div class="seg"><button data-act="strategy" data-v="window" aria-pressed="' + (s.draft.order === 'window') + '">按窗口</button>' +
        '<button data-act="strategy" data-v="nearest" aria-pressed="' + (s.draft.order === 'nearest') + '">最近邻</button></div>' +
        '<span class="sp"></span><span class="hint">最多 5 站</span></div>';
    }

    /* result */
    if (plan) {
      const bad = plan.violations > 0;
      out += '<div class="card" style="background:var(--panel-2)"><div class="card-h" style="padding:9px 11px"><h3 style="font-size:11.5px">线路核算</h3><span class="sp"></span>' +
        '<span class="tag ' + (bad ? 'tag--red' : 'tag--green') + '">' + (bad ? plan.violations + ' 站窗口冲突' : '窗口可行') + '</span></div>' +
        '<div class="card-b card-b--tight">' +
        '<div class="row" style="gap:14px;margin-bottom:9px">' +
        numBlock(fmt.n(plan.miles) + ' mi', '总里程') +
        numBlock(fmt.dur(plan.drive), '纯行驶') +
        numBlock(fmt.dur(plan.wait), '窗口等待') +
        numBlock(hhmm(plan.finish), '预计收车') +
        '</div>' +
        '<table class="tbl" style="font-size:11px"><thead><tr><th>#</th><th>到达</th><th>窗口</th><th class="r">里程</th><th>状态</th></tr></thead><tbody>' +
        plan.legs.map(function (l) {
          const st = l.late ? '<span class="tag tag--red">迟到</span>' : l.tight ? '<span class="tag tag--amber">超窗</span>' : l.wait > 0 ? '<span class="tag tag--plain">等窗</span>' : '<span class="tag tag--green">可签</span>';
          return '<tr><td class="num">' + l.idx + '</td><td class="num">' + hhmm(l.arrive) + '</td>' +
            '<td class="num muted">' + l.window.from + '–' + l.window.to + '</td>' +
            '<td class="r num">' + l.miles + '</td><td>' + st + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="divide"></div>' +
        '<div class="kv" style="font-size:11px">' +
        '<dt>分票直送合计</dt><dd>' + fmt.usd(plan.single) + '</dd>' +
        '<dt>合车一趟合计</dt><dd style="color:var(--teal)">' + fmt.usd(plan.combined) + '</dd>' +
        '<dt>其中同址加台省</dt><dd>' + fmt.usd(plan.sameZipSaved) + '</dd>' +
        '<dt style="font-weight:650;color:var(--txt)">差额</dt><dd style="font-weight:700;color:' + (plan.saved > 0 ? 'var(--teal)' : 'var(--red)') + '">' + (plan.saved > 0 ? '+' : '') + fmt.usd(plan.saved) + '</dd>' +
        '</div>' +
        '<p class="hint" style="margin-top:8px">合车只在同址加台与共享车组固定成本上生成差额；跨址的逐站费照付，不能拿两辆专车价当基线。</p>' +
        '</div></div>';
      if (bad) {
        out += '<div style="display:flex;gap:8px;padding:9px 10px;border-radius:8px;background:var(--red-soft);border:1px solid rgba(255,107,107,.28)">' +
          '<span class="dot dot--red"></span><div style="font-size:11px;line-height:1.5">存在超窗站点：硬窗站点应拆线或改约；软窗须先取得客户书面同意，且不破原承诺。</div></div>';
      }
      out += '<button class="btn btn--prime" style="width:100%;height:34px" data-act="gen-plan">生成派车单 · ' + plan.stops.length + ' 站 ' + plan.units + ' 台</button>';
    } else {
      out += '<div class="empty"><b>还没有选站</b><span>从下方候选订单中点选，最多 5 站</span></div>';
    }

    /* candidates */
    out += '<div><div class="sec-t">候选订单 <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">' + candidates.length + ' 票</span></div>' +
      '<div class="stack" style="gap:6px">' + (candidates.slice(0, 14).map(function (o) {
        const late = dt.diff(s.today, o.window.date) < 0;
        return '<button data-act="pick-order" data-id="' + o.id + '" style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line-soft);text-align:left;width:100%">' +
          '<span style="width:15px;height:15px;border-radius:4px;border:1.5px dashed var(--line);display:grid;place-items:center;font-size:9px;color:var(--txt-3)">+</span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:560">' + o.city + ' <span class="muted">' + o.zip + '</span>' +
          (o.hard ? ' <span class="tag tag--red" style="height:14px;padding:0 3px;font-size:8.5px">硬</span>' : '') + '</div>' +
          '<div style="font-size:10px;color:' + (late ? 'var(--red)' : 'var(--txt-3)') + '">' + o.model + ' ×' + o.units + ' · ' + A.C.LEVELS[o.level].code + (o.l4 ? '+L4' : '') + ' · ' + dt.mmdd(o.window.date) + ' ' + o.window.from + '–' + o.window.to + '</div></div>' +
          '<span class="num" style="font-size:10.5px;color:var(--txt-3)">' + o.miles + 'mi</span></button>';
      }).join('') || '<div class="empty"><b>该仓没有待派订单</b><span>换一个起运仓或推进时钟</span></div>') + '</div></div>';

    /* dispatched trucks */
    const trucks = (s.trucks || []).filter((t) => t.origin === s.draft.origin);
    if (trucks.length) {
      out += '<div><div class="sec-t">本仓已排线 <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">' + trucks.length + '</span></div>' +
        trucks.map(function (t) {
          return '<button data-act="load-truck" data-id="' + t.id + '" style="width:100%;text-align:left;padding:8px 9px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line-soft);margin-bottom:5px">' +
            '<div style="display:flex;align-items:center;gap:7px"><b class="mono" style="font-size:10.5px">' + t.id + '</b><span class="sp"></span><span class="tag tag--teal">' + t.stops.length + ' 站</span></div>' +
            '<div style="font-size:10.5px;color:var(--txt-3);margin-top:2px">' + t.driver + ' · ' + t.plate + ' · 08:00 发车 · ' + fmt.n(t.miles) + ' mi</div></button>';
        }).join('') + '</div>';
    }
    return out;
  }

  function renderOrdersTab(s, selId) {
    const list = s.orders.slice().sort(function (a, b) {
      const rank = { 异常: 0, 待派: 1, 待命: 2, 执行中: 3, 已派: 4, 已签收: 5 };
      return (rank[a.status] - rank[b.status]) || (a.window.date + a.window.from).localeCompare(b.window.date + b.window.from);
    });
    return '<div class="row" style="gap:6px"><div class="search" style="flex:1"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>' +
      '<input class="input" id="mapOrderSearch" placeholder="搜单号 / 城市 / ZIP"></div></div>' +
      '<div class="stack" style="gap:5px" id="mapOrderList">' + list.map(function (o) {
        const sel = o.id === selId;
        return '<button data-act="sel-order" data-id="' + o.id + '" style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:7px 9px;border-radius:7px;background:' + (sel ? 'var(--amber-soft)' : 'var(--panel-2)') + ';border:1px solid ' + (sel ? 'rgba(245,165,36,.4)' : 'var(--line-soft)') + ';text-align:left;width:100%">' +
          '<div style="min-width:0"><div style="font-size:11.5px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + o.city + ' <span class="muted">' + o.st + ' ' + o.zip + '</span></div>' +
          '<div style="font-size:10px;color:var(--txt-3)">' + o.id + ' · ' + o.model + '×' + o.units + ' · ' + A.C.LEVELS[o.level].code + '</div></div>' +
          '<span class="tag tag--' + statusTone(o.status) + '" style="align-self:center">' + o.status + '</span></button>';
      }).join('') + '</div>';
  }

  function renderNodesTab(s) {
    return '<div class="stack" style="gap:8px">' + A.C.NODES.map(function (n) {
      const list = s.orders.filter((o) => o.nodeId === n.id);
      const open = list.filter((o) => o.status === '待派' || o.status === '待命').length;
      const inv = A.sum(list.filter((o) => o.status !== '已签收'), (o) => o.units);
      return '<div class="card" style="background:var(--panel-2)"><div class="card-b card-b--tight">' +
        '<div style="display:flex;align-items:center;gap:7px"><b style="font-size:12px">' + n.id + '</b>' +
        '<span class="tag ' + (n.kind === 'inv' ? 'tag--amber' : 'tag--violet') + '">' + (n.kind === 'inv' ? '库存仓' : '区域站') + '</span>' +
        '<span class="sp"></span><span class="muted" style="font-size:10px">' + n.city + ' ' + n.zip + '</span></div>' +
        '<div style="font-size:10.5px;color:var(--txt-3);margin-top:4px">' + n.caps.join(' · ') + '</div>' +
        '<div class="row" style="gap:12px;margin-top:7px">' +
        numBlock(list.length, '票') + numBlock(open, '待派') + numBlock(inv, '台') +
        numBlock(n.kind === 'inv' ? '自有' : 'LXD / LongRoad', '承接') +
        '</div></div></div>';
    }).join('') + '</div>';
  }

  function statusTone(st) {
    return st === '异常' ? 'red' : st === '已签收' ? 'green' : st === '执行中' ? 'teal' : st === '已派' ? 'blue' : st === '待命' ? 'violet' : 'amber';
  }
  function numBlock(v, k) {
    return '<div style="line-height:1.2"><div class="num" style="font-size:14px;font-weight:700">' + v + '</div><div style="font-size:9.5px;color:var(--txt-3)">' + k + '</div></div>';
  }

  /* floating selection card */
  function renderSelCard(s) {
    const sel = s.ui.sel;
    if (!sel || sel.type !== 'order') return '';
    const o = s.orders.find((x) => x.id === sel.id);
    if (!o) return '';
    const node = A.C.nodeById[o.nodeId];
    const qB = A.pricing.quote(o, 'B');
    const qC = A.pricing.quote(o, 'C2');
    const qA = A.pricing.quote(o, 'A');
    const inPlan = s.draft.stops.includes(o.id);
    return '<div class="map-panel" style="position:absolute;left:12px;top:58px;width:268px;padding:11px 12px;display:grid;gap:9px">' +
      '<div style="display:flex;align-items:flex-start;gap:8px">' +
      '<div><div class="mono" style="font-size:10px;color:var(--txt-3)">' + o.id + '</div>' +
      '<div style="font-size:13px;font-weight:680;line-height:1.25;margin-top:1px">' + o.city + ' ' + o.st + ' ' + o.zip + '</div>' +
      '<div style="font-size:10.5px;color:var(--txt-3)">起运 ' + node.id + ' · ' + fmt.n(o.miles) + ' mi</div></div>' +
      '<span class="sp"></span><button class="icon-btn" style="width:22px;height:22px" data-act="close-sel">✕</button></div>' +
      '<div class="row row--tight">' +
      '<span class="tag tag--plain">' + o.model + ' ×' + o.units + '</span>' +
      '<span class="tag tag--amber">' + A.C.LEVELS[o.level].code + ' ' + A.C.LEVELS[o.level].short + '</span>' +
      (o.l4 ? '<span class="tag tag--violet">L4</span>' : '') + (o.l5 ? '<span class="tag tag--teal">L5</span>' : '') +
      '<span class="tag tag--' + statusTone(o.status) + '">' + o.status + '</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;font-size:10.5px">' +
      priceCell('A', qA) + priceCell('B', qB) + priceCell('C2', qC) + '</div>' +
      '<div style="font-size:10.5px;color:var(--txt-3)">窗口 ' + dt.mmdd(o.window.date) + ' ' + o.window.from + '–' + o.window.to + (o.hard ? ' · <b style="color:var(--red)">硬窗</b>' : ' · 软窗') + ' · 作业 ' + svcMinutes(o) + ' 分</div>' +
      '<div class="row" style="gap:6px">' +
      (inPlan ? '<button class="btn btn--sm" style="flex:1" data-act="remove-stop" data-id="' + o.id + '">移出计划</button>'
        : '<button class="btn btn--prime btn--sm" style="flex:1" data-act="add-stop" data-id="' + o.id + '">加入派车计划</button>') +
      '<button class="btn btn--sm btn--ghost" data-act="focus" data-id="' + o.id + '">放大</button></div></div>';
  }
  function priceCell(p, q) {
    return '<div style="padding:5px 6px;border-radius:6px;background:var(--panel-2);border:1px solid var(--line-soft)' + (q && q.feasibility === 'blocked' ? ';opacity:.6' : '') + '">' +
      '<div style="font-size:9.5px;color:var(--txt-3)">' + p + '</div><div class="num" style="font-weight:650">' + (q ? fmt.usd(q.total) : '—') + '</div></div>';
  }

  /* ── view ────────────────────────────────────────────────────────── */
  A.registerView('map', {
    title: '地图调度',
    sub: '点位、站序与窗口可行性 · 点击订单加入派车计划',
    flush: true,

    mount: function (host, s) {
      host.innerHTML =
        '<div class="map-shell">' +
        '<div class="map-stage" id="mapStage">' +
        '<div id="mapSvgHost" style="position:absolute;inset:0"></div>' +
        '<div id="mapSel"></div>' +
        '<div class="map-top">' +
        '<div class="map-panel map-filters">' +
        '<div class="seg" id="mapLevelSeg">' +
        '<button data-act="level" data-v="ALL" aria-pressed="' + (s.ui.mapLevel === 'ALL') + '">全部</button>' +
        '<button data-act="level" data-v="L1" aria-pressed="' + (s.ui.mapLevel === 'L1') + '">L1</button>' +
        '<button data-act="level" data-v="L2" aria-pressed="' + (s.ui.mapLevel === 'L2') + '">L2</button>' +
        '<button data-act="level" data-v="L3" aria-pressed="' + (s.ui.mapLevel === 'L3') + '">L3</button>' +
        '</div>' +
        '<div class="seg" id="mapColorSeg">' +
        '<button data-act="color" data-v="status" aria-pressed="' + (s.ui.mapColor !== 'level') + '">按状态</button>' +
        '<button data-act="color" data-v="level" aria-pressed="' + (s.ui.mapColor === 'level') + '">按服务档</button>' +
        '</div>' +
        '<span style="width:1px;height:20px;background:var(--line)"></span>' +
        '<button class="pill' + (s.ui.mapLayers.lanes !== false ? ' is-on' : '') + '" data-act="layer" data-v="lanes">海运航线</button>' +
        '<button class="pill' + (s.ui.mapLayers.zones ? ' is-on' : '') + '" data-act="layer" data-v="zones">150 mi 圈</button>' +
        '<button class="pill' + (s.ui.mapLayers.pins !== false ? ' is-on' : '') + '" data-act="layer" data-v="pins">订单点</button>' +
        '<button class="pill' + (s.ui.mapLayers.roads !== false ? ' is-on' : '') + '" data-act="layer" data-v="roads">路网</button>' +
        '</div></div>' +
        '<div class="map-legend map-panel" id="mapLegend"></div>' +
        '<div class="map-zoom map-panel">' +
        '<button data-act="zoom" data-v="in" aria-label="放大">+</button>' +
        '<button data-act="zoom" data-v="out" aria-label="缩小">−</button>' +
        '<button data-act="zoom" data-v="fit" aria-label="复位" style="font-size:11px">⤢</button>' +
        '</div>' +
        '<div class="map-hint">滚轮缩放 · 拖动平移 · 双击放大 · 点击点位看详情</div>' +
        '</div>' +
        '<div class="dock" id="mapDock">' +
        '<div class="dock-h"><h2>调度台</h2><span class="sp"></span><span class="hint" id="dockCount"></span></div>' +
        '<div id="dockTabs"></div><div class="dock-b" id="dockBody"></div><div class="dock-f" id="dockFoot"></div>' +
        '</div></div>';

      engine = A.MapEngine(document.getElementById('mapSvgHost'), {
        onSelect: function (type, id) {
          if (type === 'order') {
            s.ui.sel = { type: 'order', id: id };
            s.ui.dockTab = 'orders';
            A.store.emit();
          } else if (type === 'node') {
            s.draft.origin = id;
            s.draft.plan = s.draft.stops.length ? buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order) : null;
            A.store.emit();
            A.toast('起运仓切换为 ' + id, 'teal');
          } else if (type === 'port') {
            A.router.go('ocean', { port: id });
          } else {
            s.ui.sel = null;
            A.store.emit();
          }
        },
        onHover: function (t) {
          if (!t) { A.tip.hide(); return; }
          if (t.type === 'order') {
            const o = s.orders.find((x) => x.id === t.id);
            if (o) A.tip.show('<b>' + o.city + ' ' + o.zip + '</b><br>' + o.model + ' ×' + o.units + ' · ' + A.C.LEVELS[o.level].code +
              '<br>' + o.status + ' · ' + dt.mmdd(o.window.date) + ' ' + o.window.from, t.evt.clientX, t.evt.clientY);
          } else if (t.type === 'node') {
            const n = A.C.nodeById[t.id];
            if (n) A.tip.show('<b>' + n.id + ' ' + n.name + '</b><br>' + n.city + ' ' + n.zip + '<br>' + n.caps.join(' · '), t.evt.clientX, t.evt.clientY);
          } else if (t.type === 'port') {
            const p = A.C.PORTS[t.id];
            if (p) A.tip.show('<b>' + p.code + ' ' + p.name + '</b><br>' + p.en, t.evt.clientX, t.evt.clientY);
          }
        }
      });

      const dock = document.getElementById('mapDock');
      dock.addEventListener('click', onDockClick);
      dock.addEventListener('change', onDockChange);
      host.addEventListener('click', function (e) {
        const t = e.target.closest('[data-act]');
        if (t) onStageClick(e, t);
      });
      document.getElementById('dockBody').addEventListener('input', function (e) {
        if (e.target.id === 'mapOrderSearch') filterOrderList(e.target.value);
      });

      view = this;
      this._s = s;
    },

    update: function (s, params) {
      if (!engine) return;
      this._s = s;
      if (params && params.o) {
        const o = s.orders.find((x) => x.id === params.o);
        if (o) { s.ui.sel = { type: 'order', id: o.id }; s.ui.dockTab = 'orders'; engine.focusOn(o.lng, o.lat, 4.2); }
      }

      const tab = s.ui.dockTab || 'plan';
      document.getElementById('dockTabs').innerHTML = renderTabs(s, tab);
      const body = document.getElementById('dockBody');
      const scrollTop = body.scrollTop;
      body.innerHTML = tab === 'plan' ? renderPlanTab(s) : tab === 'orders' ? renderOrdersTab(s, s.ui.sel && s.ui.sel.id) : renderNodesTab(s);
      body.scrollTop = scrollTop;

      const open = s.orders.filter((o) => o.status === '待派' || o.status === '待命').length;
      document.getElementById('dockCount').textContent = '待派 ' + open + ' · 在途 ' + s.orders.filter((o) => o.status === '已派' || o.status === '执行中').length;
      document.getElementById('dockFoot').innerHTML =
        '<button class="btn btn--sm btn--ghost" style="flex:1" data-act="zoom" data-v="fit">全美视图</button>' +
        '<button class="btn btn--sm" style="flex:1" data-act="focus-origin">定位起运仓</button>';

      document.getElementById('mapSel').innerHTML = renderSelCard(s);

      /* legend */
      const byLevel = s.ui.mapColor === 'level';
      const items = byLevel
        ? [['var(--blue)', 'L1 基础交接'], ['var(--teal)', 'L2 入口交付'], ['var(--amber)', 'L3 室内机位']]
        : [['var(--amber)', '待派'], ['var(--violet)', '待命 / 已锁货'], ['var(--blue)', '已派'], ['var(--teal)', '执行中'], ['var(--green)', '已签收'], ['var(--red)', '异常']];
      document.getElementById('mapLegend').innerHTML =
        '<div style="font-size:9.5px;letter-spacing:.12em;color:var(--txt-3);text-transform:uppercase;margin-bottom:1px">图例</div>' +
        items.map(function (i) { return '<div class="li"><i class="sw" style="background:' + i[0] + '"></i>' + i[1] + '</div>'; }).join('') +
        '<div class="li" style="margin-top:3px;padding-top:5px;border-top:1px solid var(--line-soft)"><i class="sw" style="background:var(--amber);border-radius:50%"></i>库存仓</div>' +
        '<div class="li"><i class="sw" style="background:var(--violet);border-radius:50%"></i>区域站</div>' +
        '<div class="li"><i class="sw" style="background:var(--teal);border-radius:50%"></i>港口</div>';

      const lvl = s.ui.mapLevel || 'ALL';
      const orders = s.orders.filter((o) => lvl === 'ALL' || o.level === lvl);
      engine.render({
        state: s, orders: orders, nodes: A.C.NODES, ocean: s.ocean,
        draft: s.draft, filter: {}, colorBy: s.ui.mapColor || 'status'
      });
      if (s.ui.sel && s.ui.sel.id) engine.select('order', s.ui.sel.id);
    },

    onResize: function () { }
  });

  /* ── handlers ────────────────────────────────────────────────────── */
  function onStageClick(e, t) {
    const s = view._s, act = t.dataset.act;
    if (act === 'level') { s.ui.mapLevel = t.dataset.v; A.store.emit(); }
    else if (act === 'color') { s.ui.mapColor = t.dataset.v; A.store.emit(); }
    else if (act === 'layer') {
      const k = t.dataset.v;
      s.ui.mapLayers = s.ui.mapLayers || {};
      s.ui.mapLayers[k] = s.ui.mapLayers[k] === false ? true : false;
      A.store.emit();
    } else if (act === 'zoom') {
      if (t.dataset.v === 'fit') engine.fitWindow();
      else engine.zoom(t.dataset.v === 'in' ? 1.5 : 0.66);
    } else if (act === 'close-sel') { s.ui.sel = null; A.store.emit(); }
    else if (act === 'add-stop') { addStop(t.dataset.id); }
    else if (act === 'remove-stop') { removeStop(t.dataset.id); }
    else if (act === 'focus') {
      const o = s.orders.find((x) => x.id === t.dataset.id);
      if (o) engine.focusOn(o.lng, o.lat, 4.5);
    } else if (act === 'focus-origin') {
      const n = A.C.nodeById[s.draft.origin];
      if (n) engine.focusOn(n.lng, n.lat, 3.4);
    }
  }

  function onDockClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const s = view._s, act = t.dataset.act, id = t.dataset.id;
    if (act === 'tab') { s.ui.dockTab = t.dataset.tab; A.store.emit(); }
    else if (act === 'pick-order' || act === 'add-stop') { addStop(id); }
    else if (act === 'remove-stop') { removeStop(id); }
    else if (act === 'clear-plan') {
      s.draft.stops = []; s.draft.plan = null; A.store.emit();
    } else if (act === 'strategy') {
      s.draft.order = t.dataset.v;
      if (s.draft.stops.length) s.draft.plan = buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order);
      A.store.emit();
    } else if (act === 'gen-plan') {
      genPlan();
    } else if (act === 'sel-order') {
      const o = s.orders.find((x) => x.id === id);
      s.ui.sel = { type: 'order', id };
      A.store.emit();
      if (o) engine.focusOn(o.lng, o.lat, Math.max(4, engine.view.k));
    } else if (act === 'load-truck') {
      const tr = (s.trucks || []).find((x) => x.id === id);
      if (tr) {
        s.draft.origin = tr.origin; s.draft.stops = tr.stops.slice();
        s.draft.plan = buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order);
        A.store.emit();
        A.toast('已载入派车单 ' + id, 'teal');
      }
    } else if (act === 'zoom') {
      if (t.dataset.v === 'fit') engine.fitWindow();
      else engine.zoom(t.dataset.v === 'in' ? 1.5 : 0.66);
    } else if (act === 'focus-origin') {
      const n = A.C.nodeById[s.draft.origin];
      if (n) engine.focusOn(n.lng, n.lat, 3.4);
    }
  }

  function onDockChange(e) {
    const s = view._s;
    if (e.target.dataset.act === 'origin') {
      s.draft.origin = e.target.value;
      s.draft.stops = s.draft.stops.filter(function (id) {
        const o = s.orders.find((x) => x.id === id);
        return o && o.nodeId === s.draft.origin;
      });
      s.draft.plan = s.draft.stops.length ? buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order) : null;
      const n = A.C.nodeById[s.draft.origin];
      if (n) engine.focusOn(n.lng, n.lat, 3.2);
      A.store.emit();
    }
  }

  function addStop(id) {
    const s = view._s;
    if (s.draft.stops.includes(id)) return;
    if (s.draft.stops.length >= 5) { A.toast('一趟最多 5 站，先移除或改线', 'red'); return; }
    const o = s.orders.find((x) => x.id === id);
    if (!o) return;
    if (o.nodeId !== s.draft.origin) {
      s.draft.origin = o.nodeId;
      s.draft.stops = [];
      A.toast('起运仓已切换为 ' + o.nodeId, 'amber');
    }
    s.draft.stops.push(id);
    s.draft.plan = buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order);
    s.ui.dockTab = 'plan';
    A.store.emit();
  }
  function removeStop(id) {
    const s = view._s;
    s.draft.stops = s.draft.stops.filter((x) => x !== id);
    s.draft.plan = s.draft.stops.length ? buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order) : null;
    A.store.emit();
  }

  function genPlan() {
    const s = view._s, plan = s.draft.plan;
    if (!plan) return;
    if (plan.violations > 0 && !confirm('计划中有 ' + plan.violations + ' 个站点存在窗口冲突。\n硬窗站点应先拆线或改约；确认要按当前计划生成派车单吗？')) return;
    const id = 'TR-' + String(2400 + (s.trucks || []).length + 1);
    const truck = {
      id, origin: plan.origin, stops: plan.stops.slice(),
      legs: plan.legs.map((l) => ({ to: l.to.id, arrive: hhmm(l.arrive), depart: hhmm(l.depart), miles: l.miles })),
      miles: plan.miles, cost: plan.combined, units: plan.units,
      driver: DRIVERS[(s.trucks || []).length % DRIVERS.length],
      plate: PLATES[(s.trucks || []).length % PLATES.length],
      depart: s.today + ' 08:00',
      status: '已排线'
    };
    s.trucks = s.trucks || [];
    s.trucks.push(truck);
    plan.stops.forEach(function (oid) {
      const o = s.orders.find((x) => x.id === oid);
      if (o && (o.status === '待派' || o.status === '待命')) { o.status = '已派'; o.path = 'B'; o.agreed = null; o.truckId = id; }
    });
    s.draft.stops = []; s.draft.plan = null; s.ui.sel = null;
    A.store.set({ trucks: s.trucks, orders: s.orders, draft: s.draft });
    A.toast('已生成派车单 ' + id + ' · ' + truck.stops.length + ' 站 ' + truck.units + ' 台 · ' + fmt.usd(truck.cost), 'teal');
  }

  function filterOrderList(q) {
    q = (q || '').trim().toLowerCase();
    document.querySelectorAll('#mapOrderList > button').forEach(function (b) {
      const txt = b.textContent.toLowerCase();
      b.style.display = !q || txt.includes(q) ? '' : 'none';
    });
  }
})(window);
