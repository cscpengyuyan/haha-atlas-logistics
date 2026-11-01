/* ==========================================================================
   view-map.js — 地图调度（macOS 地图式交互）
   左侧毛玻璃结果列表 · 地图直接操作 · 右侧情境检视器 · 底部派车计划条
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt, dt = A.dt;

  const DRIVERS = ['M. Alvarez', 'J. Whitaker', 'R. Patel', 'D. Okafor', 'L. Nguyen', 'C. Ramirez'];
  const PLATES = ['TX-8842-KB', 'TX-2271-QD', 'CA-5510-MR', 'NJ-9930-TX', 'FL-4417-LP'];

  let engine = null;
  let view = null;
  let inspKey = '';
  let lastPlanKey = '';

  /* ── planning maths ──────────────────────────────────────────────── */
  function svcMinutes(o) {
    const base = o.level === 'L1' ? 18 : o.level === 'L2' ? 32 : 55;
    let m = base + (o.units - 1) * base * 0.45;
    if (o.l4) m += 40;
    if (o.l5) m += 65;
    return Math.round(m);
  }
  function driveMinutes(miles) {
    return Math.round((miles / 52) * 60 + Math.floor(miles / 180) * 12);
  }
  function hhmm(min) {
    const m = Math.max(0, Math.round(min));
    return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function toMin(s) { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); }

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
      return (a.window.date + a.window.from).localeCompare(b.window.date + b.window.from);
    });
  }

  function buildPlan(state, originId, stopIds, strategy) {
    const origin = A.C.nodeById[originId];
    if (!origin || !stopIds.length) return null;
    const seq = planStops(originId, stopIds, strategy, state);
    const legs = [];
    let clock = 8 * 60, prev = origin, totalMiles = 0, totalDrive = 0, violations = 0, waitTotal = 0;

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
        window: o.window, late, tight, slack: wTo - (start + svc)
      });
      totalMiles += miles; totalDrive += drive; waitTotal += wait;
      clock = depart; prev = o;
    });

    const stops = [];
    legs.forEach(function (l) {
      const z = l.to.zip;
      let st = stops.find((s) => s.zip === z);
      if (!st) stops.push(st = { zip: z, units: 0, orders: [] });
      st.units += l.to.units;
      st.orders.push(l.to);
    });
    const FIXED = 38, OUT = A.C.RATE.outbound, STOPFEE = A.C.RATE.stop;
    let single = 0, combined = 0;
    seq.forEach(function (o) {
      const q = A.pricing.quote(o, 'B');
      single += q.total + FIXED + OUT * (o.units - 1);
    });
    stops.forEach(function (st) {
      const first = st.orders[0];
      const f = A.pricing.firstPrice('B', first.level, first.l4);
      const e = A.pricing.extraPrice('B', first.level, first.l4);
      const tech = A.sum(st.orders, (o) => (o.l5 ? A.C.ADDONS.L5.fee * o.units : 0));
      st.cost = OUT * st.units + f + e * (st.units - 1) + STOPFEE + tech;
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
      origin: originId, strategy, legs, stops,
      miles: totalMiles, drive: totalDrive, wait: waitTotal, finish: clock,
      violations, single: Math.round(single), combined: Math.round(combined),
      saved: Math.round(single - combined), sameZipSaved: Math.round(sameZipSaved),
      stopIds: seq.map((o) => o.id), units: A.sum(seq, (o) => o.units)
    };
  }

  /* ── small builders ──────────────────────────────────────────────── */
  function levelChip(level) {
    const map = { L1: 'l1', L2: 'l2', L3: 'l3' };
    return '<span class="mv-chip mv-chip--' + map[level] + '">' + level + '</span>';
  }
  function statusDot(status) {
    const map = { '待派': 'orange', '待命': 'purple', '已派': 'blue', '执行中': 'teal', '已签收': 'green', '异常': 'red' };
    return '<i class="mv-dot mv-dot--' + (map[status] || 'gray') + '"></i>';
  }
  function winText(o) {
    const d = dt.diff(A.app.state.today, o.window.date);
    const day = d === 0 ? '今天' : d === 1 ? '明天' : d === -1 ? '昨天' : dt.mmdd(o.window.date);
    return day + ' ' + o.window.from + '–' + o.window.to;
  }
  function money(v) { return '$' + fmt.n(v, 0); }

  /* ── left: result list ───────────────────────────────────────────── */
  function visibleOrders(s) {
    const q = (s.ui.mapQuery || '').trim().toLowerCase();
    const lv = s.ui.mapLevel || 'ALL';
    return s.orders.filter(function (o) {
      if (lv !== 'ALL' && o.level !== lv) return false;
      if (q) {
        const hay = (o.id + ' ' + o.city + ' ' + o.st + ' ' + o.zip + ' ' + o.model).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(function (a, b) {
      const ra = { 异常: 0, 待派: 1, 待命: 2, 执行中: 3, 已派: 4, 已签收: 5 };
      return (ra[a.status] - ra[b.status]) || (a.window.date + a.window.from).localeCompare(b.window.date + b.window.from);
    });
  }

  function renderList(s) {
    const list = visibleOrders(s);
    if (!list.length) {
      return '<div class="mv-empty"><b>没有匹配的订单</b><span>试试清空搜索或切换服务档</span></div>';
    }
    const groups = [
      { key: 'today', name: '今天到期', items: list.filter((o) => o.window.date === s.today) },
      { key: 'tomorrow', name: '明天', items: list.filter((o) => dt.diff(s.today, o.window.date) === 1) },
      { key: 'later', name: '之后', items: list.filter((o) => dt.diff(s.today, o.window.date) > 1) },
      { key: 'past', name: '已过期 / 无需派车', items: list.filter((o) => dt.diff(s.today, o.window.date) < 0) }
    ];
    const selId = s.ui.mapSel;
    return groups.filter((g) => g.items.length).map(function (g) {
      return '<div class="mv-group"><div class="mv-group-h">' + g.name + '<span>' + g.items.length + '</span></div>' +
        g.items.slice(0, 40).map(function (o) {
          const q = A.pricing.quote(o, 'B');
          const inPlan = s.draft.stops.includes(o.id);
          return '<div class="mv-row' + (o.id === selId ? ' is-sel' : '') + (inPlan ? ' is-in' : '') + '" data-act="pick" data-id="' + o.id + '" role="button" tabindex="0">' +
            '<span class="mv-row-dot">' + statusDot(o.status) + '</span>' +
            '<span class="mv-row-main">' +
            '<span class="mv-row-t">' + o.city + '<i>' + o.st + ' ' + o.zip + '</i></span>' +
            '<span class="mv-row-s">' + o.model + ' ×' + o.units + ' · ' + o.level + (o.l4 ? '+L4' : '') + ' · ' + winText(o) + '</span>' +
            '</span>' +
            '<span class="mv-row-end">' + (inPlan ? '<span class="mv-inplan">已选</span>' : '<b>' + money(q ? q.total : 0) + '</b>') +
            (inPlan ? '' : '<span class="mv-quick" data-act="quick-add" data-id="' + o.id + '" title="加入派车计划">' +
              '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></span>') +
            '</span></div>';
        }).join('') + '</div>';
    }).join('');
  }

  /* ── right: contextual inspector ─────────────────────────────────── */
  function renderInspector(s) {
    const o = s.ui.mapSel ? s.orders.find((x) => x.id === s.ui.mapSel) : null;
    const plan = s.draft.plan;
    const mode = o ? 'order' : plan ? 'plan' : 'empty';
    const key = mode + ':' + (o ? o.id + ':' + (plan ? plan.stops.length : 0) : plan ? plan.stopIds.join(',') : '');
    const fresh = key !== inspKey;
    inspKey = key;

    let inner = '';
    if (mode === 'empty') {
      inner = '<div class="mv-insp-empty">' +
        '<svg viewBox="0 0 48 48" width="34" height="34"><path d="M24 8c-6.6 0-12 5.2-12 11.6C12 28 24 40 24 40s12-12 12-20.4C36 13.2 30.6 8 24 8Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="19" r="4" fill="currentColor" opacity=".5"/></svg>' +
        '<b>选择一个订单</b><span>在左侧列表或地图上轻点订单，查看服务档、窗口与三种路径的比价。</span></div>';
    } else if (mode === 'order') {
      const qA = A.pricing.quote(o, 'A'), qB = A.pricing.quote(o, 'B');
      const qC1 = A.pricing.quote(o, 'C1'), qC2 = A.pricing.quote(o, 'C2');
      const inPlan = s.draft.stops.includes(o.id);
      const node = A.C.nodeById[o.nodeId];
      const best = [qA, qB, qC1, qC2].filter((q) => q && q.feasibility !== 'blocked').sort((a, b) => a.total - b.total)[0];
      inner =
        '<div class="mv-insp-h">' +
        '<div class="mv-insp-title"><h2>' + o.city + '</h2><p>' + o.st + ' ' + o.zip + ' · 起运 ' + node.id + '</p></div>' +
        '<button class="mv-round" data-act="close-insp" aria-label="关闭">' +
        '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
        '</div>' +
        '<div class="mv-insp-body">' +
        '<div class="mv-tags">' +
        '<span class="mv-chip">' + o.model + ' ×' + o.units + '</span>' +
        levelChip(o.level) +
        (o.l4 ? '<span class="mv-chip mv-chip--l4">L4</span>' : '') +
        (o.l5 ? '<span class="mv-chip mv-chip--l5">L5</span>' : '') +
        '<span class="mv-chip mv-chip--state">' + statusDot(o.status) + o.status + '</span>' +
        '</div>' +
        '<div class="mv-rows">' +
        kv('交付窗口', winText(o) + (o.hard ? ' · 硬窗' : '')) +
        kv('距起运仓', fmt.n(o.miles) + ' mi') +
        kv('作业时长', svcMinutes(o) + ' 分钟') +
        kv('序列号', o.sns.join(' · ')) +
        '</div>' +
        '<div class="mv-sec"><div class="mv-sec-h">同范围全价</div>' +
        '<div class="mv-prices">' +
        priceCell('A', '卡派 / 自提', qA, best && best.path === 'A') +
        priceCell('B', '直提直送', qB, best && best.path === 'B') +
        priceCell('C1', '经站统包', qC1, best && best.path === 'C1') +
        priceCell('C2', '经站分采', qC2, best && best.path === 'C2') +
        '</div></div>' +
        (qA && qA.feasibility === 'blocked' ? '<p class="mv-note">' + qA.blocker + '</p>' : '') +
        '</div>' +
        '<div class="mv-insp-f">' +
        '<button class="mv-btn" data-act="focus" data-id="' + o.id + '">定位</button>' +
        (inPlan
          ? '<button class="mv-btn mv-btn--warn" data-act="remove-stop" data-id="' + o.id + '">移出计划</button>'
          : '<button class="mv-btn mv-btn--primary" data-act="add-stop" data-id="' + o.id + '">加入派车计划</button>') +
        '</div>';
    } else {
      const bad = plan.violations > 0;
      inner =
        '<div class="mv-insp-h">' +
        '<div class="mv-insp-title"><h2>派车计划</h2><p>' + plan.stops.length + ' 站 · ' + plan.units + ' 台 · 起运 ' + plan.origin + '</p></div>' +
        '<button class="mv-round" data-act="clear-plan" aria-label="清空">' +
        '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>' +
        '</div>' +
        '<div class="mv-insp-body">' +
        '<div class="mv-bignums">' +
        bigNum(fmt.n(plan.miles), 'mi', '总里程') +
        bigNum(fmt.dur(plan.drive), '', '纯行驶') +
        bigNum(hhmm(plan.finish), '', '预计收车') +
        '</div>' +
        '<div class="mv-sec"><div class="mv-sec-h">站序与到场时间</div>' +
        '<div class="mv-legs">' + plan.legs.map(function (l) {
          const st = l.late ? '<span class="mv-pill mv-pill--red">迟到</span>' : l.tight ? '<span class="mv-pill mv-pill--orange">超窗</span>' : l.wait > 0 ? '<span class="mv-pill">等窗</span>' : '<span class="mv-pill mv-pill--green">可签</span>';
          return '<div class="mv-leg">' +
            '<span class="mv-leg-n">' + l.idx + '</span>' +
            '<span class="mv-leg-main"><b>' + l.to.city + '</b><i>' + l.to.zip + ' · ' + l.to.model + '×' + l.to.units + '</i></span>' +
            '<span class="mv-leg-time">' + hhmm(l.start) + '</span>' + st + '</div>';
        }).join('') + '</div></div>' +
        '<div class="mv-sec"><div class="mv-sec-h">成本</div>' +
        '<div class="mv-rows">' +
        kv('分票直送合计', money(plan.single)) +
        kv('合车一趟合计', money(plan.combined)) +
        kv('同址加台节省', money(plan.sameZipSaved)) +
        '</div>' +
        '<div class="mv-save ' + (plan.saved > 0 ? 'is-up' : 'is-down') + '">' +
        '<span>差额</span><b>' + (plan.saved > 0 ? '+' : '') + money(plan.saved) + '</b></div>' +
        '<p class="mv-note">合车只在同址加台与共享车组固定成本上生成差额；跨址的逐站费照付。</p>' +
        '</div>' +
        (bad ? '<div class="mv-warnbox">' + plan.violations + ' 个站点存在窗口冲突，硬窗站点应拆线或改约。</div>' : '') +
        '</div>' +
        '<div class="mv-insp-f">' +
        '<button class="mv-btn" data-act="toggle-strategy">' + (plan.strategy === 'window' ? '按窗口排线' : '按最近邻排线') + '</button>' +
        '<button class="mv-btn mv-btn--primary" data-act="gen-plan">生成派车单</button>' +
        '</div>';
    }

    return '<div class="mv-inspector-inner' + (fresh ? ' is-fresh' : '') + '">' + inner + '</div>';
  }

  function kv(k, v) { return '<div class="mv-kv"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function bigNum(v, unit, label) {
    return '<div class="mv-bignum"><b>' + v + (unit ? '<i>' + unit + '</i>' : '') + '</b><span>' + label + '</span></div>';
  }
  function priceCell(code, name, q, best) {
    const blocked = !q || q.feasibility === 'blocked';
    return '<div class="mv-price' + (blocked ? ' is-blocked' : '') + (best ? ' is-best' : '') + '">' +
      '<span class="mv-price-code">' + code + '</span>' +
      '<span class="mv-price-name">' + name + '</span>' +
      '<b>' + (blocked ? '不可行' : money(q.total)) + '</b>' +
      (best ? '<i class="mv-price-best">最优</i>' : '') +
      '</div>';
  }

  /* ── bottom: plan bar ────────────────────────────────────────────── */
  function renderPlanBar(s) {
    const plan = s.draft.plan;
    if (!plan) return '';
    return '<div class="mv-planbar-in">' +
      '<div class="mv-stops">' + plan.legs.map(function (l, i) {
        return '<button class="mv-stop" data-act="pick" data-id="' + l.to.id + '" style="animation-delay:' + (i * 40) + 'ms">' +
          '<span class="mv-stop-n">' + (i + 1) + '</span>' +
          '<span class="mv-stop-t">' + l.to.city + '<i>' + hhmm(l.start) + '</i></span>' +
          '<span class="mv-stop-x" data-act="remove-stop" data-id="' + l.to.id + '">' +
          '<svg viewBox="0 0 24 24" width="10" height="10"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></span>' +
          '</button>';
      }).join('') + (plan.stops.length < 5 ? '<span class="mv-stop-add">再选最多 ' + (5 - plan.stops.length) + ' 站</span>' : '') + '</div>' +
      '<div class="mv-planbar-mid">' +
      '<b>' + money(plan.combined) + '</b>' +
      '<span>' + fmt.n(plan.miles) + ' mi · ' + fmt.dur(plan.drive) + ' · 收车 ' + hhmm(plan.finish) + '</span>' +
      '</div>' +
      '<div class="mv-planbar-actions">' +
      '<button class="mv-btn mv-btn--sm" data-act="fit-route">看路线</button>' +
      '<button class="mv-btn mv-btn--sm" data-act="open-plan">详情</button>' +
      '<button class="mv-btn mv-btn--primary" data-act="gen-plan">生成派车单</button>' +
      '</div></div>';
  }

  /* ── layers popover ──────────────────────────────────────────────── */
  function renderPopover(s) {
    const lz = s.ui.mapLayers || {};
    const rows = [
      ['lanes', '海运航线'],
      ['zones', '150 mi 覆盖圈'],
      ['pins', '订单点位'],
      ['roads', '路网'],
      ['nodes', '仓库与区域站']
    ];
    return '<div class="mv-pop-h">图层</div>' +
      rows.map(function (r) {
        return '<button class="mv-pop-row" data-act="layer" data-v="' + r[0] + '">' +
          '<span>' + r[1] + '</span>' +
          '<i class="mv-switch' + (lz[r[0]] !== false ? ' is-on' : '') + '"></i></button>';
      }).join('') +
      '<div class="mv-pop-div"></div>' +
      '<button class="mv-pop-row" data-act="color" data-v="status"><span>按状态着色</span><i class="mv-check' + (s.ui.mapColor !== 'level' ? ' is-on' : '') + '"></i></button>' +
      '<button class="mv-pop-row" data-act="color" data-v="level"><span>按服务档着色</span><i class="mv-check' + (s.ui.mapColor === 'level' ? ' is-on' : '') + '"></i></button>' +
      '<div class="mv-pop-div"></div>' +
      '<div class="mv-pop-legend">' +
      '<span><i class="mv-dot mv-dot--orange"></i>待派</span><span><i class="mv-dot mv-dot--blue"></i>已派</span>' +
      '<span><i class="mv-dot mv-dot--green"></i>已签收</span><span><i class="mv-dot mv-dot--red"></i>异常</span>' +
      '</div>';
  }

  /* ── camera framing that respects the floating panels ───────────── */
  function mapPadding() {
    const root = document.querySelector('.mv');
    if (!root) return { tl: [16, 70], br: [16, 100] };
    const W = root.clientWidth, H = root.clientHeight;
    const rr = root.getBoundingClientRect();
    if (W < 900) return { tl: [12, Math.min(230, H * 0.32)], br: [12, Math.min(250, H * 0.36)] };
    const side = document.querySelector('.mv-side');
    const l = side ? side.getBoundingClientRect().right - rr.left + 18 : 20;
    const inspector = document.getElementById('mvInspector');
    const open = inspector && inspector.classList.contains('is-open');
    const r = open ? 366 : 56;
    return { tl: [l, 74], br: [r, 104] };
  }
  function home(animate) {
    if (engine) engine.fitUS(animate);
  }

  /* ── view ────────────────────────────────────────────────────────── */
  A.registerView('map', {
    title: '地图调度',
    sub: '轻点订单加入计划 · 拖动平移 · 双指或滚轮缩放',

    mount: function (host, s) {
      s.ui.mapLevel = s.ui.mapLevel || 'ALL';
      s.ui.mapLayers = s.ui.mapLayers || { lanes: true, zones: false, pins: true, roads: true, nodes: true };

      host.innerHTML =
        '<div class="mv">' +
        '<div class="mv-canvas" id="mvCanvas"></div>' +
        '<div class="mv-topglass">' +
        '<div class="mv-seg" id="mvSeg">' +
        ['ALL', 'L1', 'L2', 'L3'].map(function (k) {
          return '<button data-act="level" data-v="' + k + '"' + (s.ui.mapLevel === k ? ' class="is-on"' : '') + '>' + (k === 'ALL' ? '全部' : k) + '</button>';
        }).join('') + '</div>' +
        '<button class="mv-ctl" data-act="toggle-pop" id="mvPopBtn">' +
        '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>图层</button>' +
        '</div>' +
        '<aside class="mv-side" id="mvSide">' +
        '<div class="mv-side-h">' +
        '<div class="mv-search">' +
        '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<input id="mvSearch" placeholder="搜索订单、城市或 ZIP" autocomplete="off">' +
        '</div>' +
        '</div>' +
        '<div class="mv-list" id="mvList"></div>' +
        '<div class="mv-side-f" id="mvSideF"></div>' +
        '</aside>' +
        '<aside class="mv-inspector" id="mvInspector" aria-live="polite"></aside>' +
        '<div class="mv-planbar" id="mvPlanBar"></div>' +
        '<div class="mv-zoom">' +
        '<button data-act="zoom-in" aria-label="放大"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
        '<span class="mv-zoom-div"></span>' +
        '<button data-act="zoom-out" aria-label="缩小"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
        '</div>' +
        '<button class="mv-home" data-act="home" aria-label="全美视图">' +
        '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 11.2 12 4l8 7.2V20H4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>' +
        '<div class="mv-attrib">底图 © Esri · © OpenStreetMap</div>' +
        '<div class="mv-popover" id="mvPopover" hidden></div>' +
        '</div>';

      engine = A.MapEngine(document.getElementById('mvCanvas'), {
        getPadding: mapPadding,
        onTilesFail: function () {
          A.toast('底图瓦片不可用，已切换到离线示意模式', 'amber');
          document.getElementById('mvCanvas').classList.add('is-offline');
        },
        onSelect: function (type, id) {
          if (type === 'order') {
            s.ui.mapSel = id;
            A.store.emit();
          } else if (type === 'node') {
            if (s.draft.origin !== id) {
              s.draft.origin = id;
              s.draft.stops = s.draft.stops.filter(function (oid) {
                const o = s.orders.find((x) => x.id === oid);
                return o && o.nodeId === id;
              });
              s.draft.plan = s.draft.stops.length ? buildPlan(s, id, s.draft.stops, s.draft.order) : null;
              A.store.emit();
              A.toast('起运仓切换为 ' + id, 'teal');
            }
          } else if (type === 'port') {
            A.router.go('ocean', { port: id });
          } else {
            s.ui.mapSel = null;
            A.store.emit();
          }
        },
        onHover: function (t) {
          if (!t) { A.tip.hide(); return; }
          if (t.type === 'order') {
            const o = s.orders.find((x) => x.id === t.id);
            if (o) A.tip.show('<b>' + o.city + ' ' + o.st + '</b><br>' + o.model + ' ×' + o.units + ' · ' + o.level +
              '<br>' + o.status + ' · ' + winText(o), t.evt.clientX, t.evt.clientY);
          } else if (t.type === 'node') {
            const n = A.C.nodeById[t.id];
            if (n) A.tip.show('<b>' + n.id + '</b> ' + n.name + '<br>' + n.city + ' ' + n.zip, t.evt.clientX, t.evt.clientY);
          }
        }
      });

      const root = host.querySelector('.mv');
      root.addEventListener('click', onClick);
      root.addEventListener('input', function (e) {
        if (e.target.id === 'mvSearch') {
          s.ui.mapQuery = e.target.value;
          document.getElementById('mvList').innerHTML = renderList(s);
          document.getElementById('mvSideF').textContent = visibleOrders(s).length + ' 个结果';
        }
      });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape' && s.ui.mapSel) { s.ui.mapSel = null; A.store.emit(); }
      });

      view = this;
      this._s = s;
      A._mapEngine = engine;   // handy for debugging / automated checks
      engine.invalidate();
      home(false);
    },

    update: function (s, params) {
      if (!engine) return;
      this._s = s;

      if (params && params.o) {
        const o = s.orders.find((x) => x.id === params.o);
        if (o) { s.ui.mapSel = o.id; engine.focusOn(o.lat, o.lng, 10); }
      }

      document.getElementById('mvList').innerHTML = renderList(s);
      document.getElementById('mvSideF').textContent = visibleOrders(s).length + ' 个结果';
      const searchEl = document.getElementById('mvSearch');
      if (searchEl && searchEl.value !== (s.ui.mapQuery || '')) searchEl.value = s.ui.mapQuery || '';

      const insp = document.getElementById('mvInspector');
      insp.innerHTML = renderInspector(s);
      insp.classList.toggle('is-open', !!(s.ui.mapSel || s.draft.plan));

      const bar = document.getElementById('mvPlanBar');
      const planKey = s.draft.plan ? s.draft.plan.stopIds.join(',') : '';
      bar.innerHTML = renderPlanBar(s);
      bar.classList.toggle('is-open', !!s.draft.plan);
      lastPlanKey = planKey;

      const pop = document.getElementById('mvPopover');
      if (!pop.hidden) pop.innerHTML = renderPopover(s);

      document.querySelectorAll('#mvSeg button').forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.v === s.ui.mapLevel);
      });

      const lvl = s.ui.mapLevel || 'ALL';
      const orders = s.orders.filter((o) => lvl === 'ALL' || o.level === lvl);
      engine.render({
        state: s, orders: orders, nodes: A.C.NODES, ocean: s.ocean,
        draft: s.draft, filter: {}, colorBy: s.ui.mapColor || 'status',
        animateIn: !this._painted
      });
      this._painted = true;
      if (s.ui.mapSel) engine.select('order', s.ui.mapSel);
    },

    onResize: function () { home(false); }
  });

  /* ── interactions ────────────────────────────────────────────────── */
  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) {
      const pop = document.getElementById('mvPopover');
      if (!pop.hidden && !e.target.closest('#mvPopover') && !e.target.closest('#mvPopBtn')) pop.hidden = true;
      return;
    }
    const s = view._s, act = t.dataset.act, id = t.dataset.id;
    if (act === 'pick') {
      s.ui.mapSel = id;
      A.store.emit();
    } else if (act === 'level') {
      s.ui.mapLevel = t.dataset.v; A.store.emit();
    } else if (act === 'quick-add') {
      e.stopPropagation();
      addStop(id);
    } else if (act === 'add-stop') {
      addStop(id);
    } else if (act === 'remove-stop') {
      e.stopPropagation();
      removeStop(id);
    } else if (act === 'focus') {
      const o = s.orders.find((x) => x.id === id);
      if (o) engine.focusOn(o.lat, o.lng, 11);
    } else if (act === 'close-insp') {
      s.ui.mapSel = null; A.store.emit();
    } else if (act === 'clear-plan') {
      s.draft.stops = []; s.draft.plan = null; A.store.emit();
    } else if (act === 'toggle-strategy') {
      s.draft.order = s.draft.order === 'window' ? 'nearest' : 'window';
      if (s.draft.stops.length) s.draft.plan = buildPlan(s, s.draft.origin, s.draft.stops, s.draft.order);
      A.store.emit();
    } else if (act === 'gen-plan') {
      genPlan();
    } else if (act === 'open-plan') {
      s.ui.mapSel = null; A.store.emit();
    } else if (act === 'fit-route') {
      engine.fitRoute();
    } else if (act === 'toggle-pop') {
      const pop = document.getElementById('mvPopover');
      pop.hidden = !pop.hidden;
      pop.innerHTML = renderPopover(s);
    } else if (act === 'layer') {
      s.ui.mapLayers[t.dataset.v] = s.ui.mapLayers[t.dataset.v] === false;
      A.store.emit();
    } else if (act === 'color') {
      s.ui.mapColor = t.dataset.v; A.store.emit();
    } else if (act === 'zoom-in') {
      engine.zoomIn();
    } else if (act === 'zoom-out') {
      engine.zoomOut();
    } else if (act === 'home') {
      home(true);
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
    s.ui.mapSel = null;
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
      id, origin: plan.origin, stops: plan.stops.map((x) => x.id),
      legs: plan.legs.map((l) => ({ to: l.to.id, arrive: hhmm(l.arrive), depart: hhmm(l.depart), miles: l.miles })),
      miles: plan.miles, cost: plan.combined, units: plan.units,
      driver: DRIVERS[(s.trucks || []).length % DRIVERS.length],
      plate: PLATES[(s.trucks || []).length % PLATES.length],
      depart: s.today + ' 08:00', status: '已排线'
    };
    s.trucks = s.trucks || [];
    s.trucks.push(truck);
    plan.stopIds.forEach(function (oid) {
      const o = s.orders.find((x) => x.id === oid);
      if (o && (o.status === '待派' || o.status === '待命')) { o.status = '已派'; o.path = 'B'; o.truckId = id; }
    });
    s.draft.stops = []; s.draft.plan = null; s.ui.mapSel = null;
    A.store.set({ trucks: s.trucks, orders: s.orders, draft: s.draft });
    A.toast('已生成派车单 ' + id + ' · ' + truck.stops.length + ' 站 ' + truck.units + ' 台', 'green');
  }
})(window);
