/* ==========================================================================
   view-overview.js — 指挥总览
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt, dt = A.dt;

  function stats(s) {
    const open = s.orders.filter((o) => o.status === '待派' || o.status === '待命');
    const dueSoon = open.filter((o) => dt.diff(s.today, o.window.date) <= 2 && dt.diff(s.today, o.window.date) >= 0);
    const late = open.filter((o) => dt.diff(s.today, o.window.date) < 0);
    const seaUnits = s.ocean.filter((x) => x.stage === 'S02' || x.stage === 'S03').reduce((a, x) => a + x.units, 0);
    const boxes = s.ocean.filter((x) => x.stage !== 'REC').length;
    const demo = s.ocean.filter(function (x) {
      if (x.stage === 'REC' || x.stage === 'S01' || x.stage === 'S02') return false;
      const eta = x.actualEta || x.eta;
      const days = dt.diff(s.today, eta);
      return days >= -(x.freeDays) && days <= 2;
    });
    const exc = (s.exceptions || []).filter((e) => e.status !== '已关闭');
    const inTransitUnits = s.orders.filter((o) => o.status === '已派' || o.status === '执行中').reduce((a, o) => a + o.units, 0);
    const done = s.orders.filter((o) => o.status === '已签收');
    const cost = done.length ? A.sum(done, (o) => o.agreed || o.quoteBase) / A.sum(done, (o) => o.units) : null;
    return { open, dueSoon, late, seaUnits, boxes, demo, exc, inTransitUnits, done, cost };
  }

  function spark7(s) {
    const days = Array.from({ length: 8 }, (_, i) => dt.add(s.today, i));
    const oceanDay = days.map((d) => s.ocean.filter((x) => x.stage !== 'REC' && dt.diff(x.eta, d) === 0).length);
    const winDay = days.map((d) => s.orders.filter((o) => o.window.date === d && (o.status === '待派' || o.status === '待命' || o.status === '已派')).length);
    return days.map(function (d, i) {
      return {
        d, ocean: oceanDay[i], win: winDay[i],
        isToday: d === s.today
      };
    });
  }

  A.registerView('overview', {
    title: '指挥总览',
    sub: function (s) { return '截至 ' + dt.md(s.today) + ' · 演示数据 · 达拉斯试点口径'; },

    mount: function (host) {
      host.innerHTML = '<div class="wrap" id="ovRoot"></div>';
      A.delegate(host, 'click', '[data-go]', function (e, t) {
        A.router.go(t.dataset.go, t.dataset.params ? JSON.parse(t.dataset.params) : null);
      });
    },

    update: function (s) {
      const st = stats(s);
      const root = document.getElementById('ovRoot');
      if (!root) return;

      const hero = '' +
        '<div class="card" style="overflow:hidden;position:relative">' +
        '<div style="position:absolute;inset:0;background:radial-gradient(720px 200px at 12% -30%, rgba(245,165,36,.16), transparent 70%);pointer-events:none"></div>' +
        '<div class="card-b" style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:22px;align-items:center;padding:18px 20px">' +
        '<div>' +
        '<div class="eyebrow">HAHA ATLAS · 美国大件设备 · 海运 + 末端一体化</div>' +
        '<h2 style="font-size:21px;line-height:1.35;font-weight:700;letter-spacing:-.015em;margin:7px 0 6px">' +
        '先把已售设备按客户买下的服务送到约定位置，再用每一站的实际动作和最终账单判断哪段值得改。</h2>' +
        '<p class="hint" style="max-width:74ch">今天是 <b class="num">' + s.today + '</b>（' + dt.weekday(s.today) + '）。' +
        '当前 <b style="color:var(--amber)">' + st.open.length + '</b> 票待派或待命，其中 <b style="color:var(--red)">' + st.late.length + '</b> 票已过期望窗；' +
        '海上有 <b>' + st.boxes + '</b> 个航次、<b>' + fmt.n(st.seaUnits) + '</b> 台在途；在途陆运 <b>' + st.inTransitUnits + '</b> 台。</p>' +
        '<div class="row" style="margin-top:11px">' +
        '<button class="btn btn--prime" data-go="map">打开地图调度</button>' +
        '<button class="btn" data-go="ocean">查看海运看板</button>' +
        '<button class="btn btn--ghost" data-go="routing">比价与换线判定</button>' +
        '</div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' +
        miniStat('待派 / 待命', st.open.length, '票', 'var(--amber)') +
        miniStat('到港免期告警', st.demo.length, '航次', st.demo.length ? 'var(--red)' : 'var(--green)') +
        miniStat('未结异常', st.exc.length, '单', st.exc.length ? 'var(--red)' : 'var(--green)') +
        miniStat('已签收', st.done.length, '票', 'var(--teal)') +
        '</div></div></div>';

      const statCards = '<div class="stat-grid" style="margin-top:14px">' +
        stat('今日到期窗口', st.dueSoon.length, '票', 'amber', '未来 48 小时内须到场', true) +
        stat('海上在途', fmt.n(st.seaUnits), '台', 'blue', st.boxes + ' 个航次未入仓') +
        stat('在途陆运', st.inTransitUnits, '台', 'teal', '已派或执行中') +
        stat('单台成功成本', st.cost ? fmt.usd(st.cost) : '—', '', 'violet', '已签收样本 ' + st.done.length + ' 票') +
        stat('基线原窗准时', fmt.pct(s.baseline.ontime), '', 'amber', '演示基线 · 非实测声明') +
        '</div>';

      /* network load */
      const byNode = A.C.NODES.map(function (n) {
        const list = s.orders.filter((o) => o.nodeId === n.id);
        return { k: n.id, v: list.length, t: list.length + ' 票 · ' + A.sum(list, (o) => o.units) + ' 台', c: n.kind === 'inv' ? 'var(--amber)' : 'var(--violet)' };
      }).sort((a, b) => b.v - a.v);

      const week = spark7(s);
      const maxBar = Math.max(1, ...week.map((x) => x.ocean + x.win));
      const bars = week.map(function (x) {
        const total = x.ocean + x.win;
        return '<div style="display:grid;grid-template-rows:1fr auto;gap:5px;align-items:end;min-width:0;cursor:default" title="' + x.d + '：到港 ' + x.ocean + ' · 窗口 ' + x.win + '">' +
          '<div style="display:flex;flex-direction:column;justify-content:flex-end;gap:2px;height:112px">' +
          (x.ocean ? '<i style="height:' + (x.ocean / maxBar * 100) + '%;background:var(--blue);border-radius:3px 3px 0 0;min-height:3px" title="到港 ' + x.ocean + '"></i>' : '') +
          (x.win ? '<i style="height:' + (x.win / maxBar * 100) + '%;background:var(--amber);border-radius:3px 3px 0 0;min-height:3px;opacity:.85" title="窗口 ' + x.win + '"></i>' : '') +
          (!total ? '<i style="height:2px;background:var(--panel-3);border-radius:2px"></i>' : '') +
          '</div>' +
          '<div style="text-align:center;font-size:9.5px;color:' + (x.isToday ? 'var(--amber)' : 'var(--txt-3)') + ';font-variant-numeric:tabular-nums">' + (x.isToday ? '今天' : dt.mmdd(x.d)) + '</div>' +
          '</div>';
      }).join('');

      /* exceptions */
      const excRows = st.exc.slice(0, 5).map(function (e) {
        const o = s.orders.find((x) => x.id === e.orderId);
        const t = A.C.EXC_TYPES.find((x) => x.id === e.type);
        const over = e.ageH > e.sla * 2;
        return '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-soft)">' +
          '<span class="dot" style="background:' + (over ? 'var(--red)' : 'var(--amber)') + ';margin:0"></span>' +
          '<div style="min-width:0"><div style="font-size:11.8px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + t.name + ' · ' + (o ? o.city + ' ' + o.zip : e.orderId) + '</div>' +
          '<div style="font-size:10.5px;color:var(--txt-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + e.note + '</div></div>' +
          '<div style="text-align:right"><div class="num" style="font-size:11px;color:' + (over ? 'var(--red)' : 'var(--txt-2)') + '">' + e.ageH + 'h</div>' +
          '<div style="font-size:9.5px;color:var(--txt-3)">SLA ' + e.sla + 'h</div></div></div>';
      }).join('') || '<div class="empty"><b>没有未结异常</b><span>保持现状即可</span></div>';

      /* queue table */
      const queue = st.open.slice().sort((a, b) => a.window.date.localeCompare(b.window.date)).slice(0, 7);
      const qRows = queue.map(function (o) {
        const q = A.pricing.quote(o, 'B');
        const late = dt.diff(s.today, o.window.date) < 0;
        return '<tr data-go="map" data-params=\'' + JSON.stringify({ o: o.id }) + '\' style="cursor:pointer">' +
          '<td class="mono" style="font-size:10.8px">' + o.id + '</td>' +
          '<td><b>' + o.city + '</b> <span class="muted">' + o.st + ' ' + o.zip + '</span></td>' +
          '<td>' + o.model + ' ×' + o.units + '</td>' +
          '<td>' + A.C.LEVELS[o.level].code + (o.l4 ? '<span class="tag tag--violet" style="margin-left:4px;height:16px;padding:0 4px;font-size:9px">L4</span>' : '') + (o.l5 ? '<span class="tag tag--teal" style="margin-left:3px;height:16px;padding:0 4px;font-size:9px">L5</span>' : '') + '</td>' +
          '<td class="num' + (late ? '' : '') + '" style="color:' + (late ? 'var(--red)' : 'var(--txt-2)') + '">' + dt.mmdd(o.window.date) + ' ' + o.window.from + (o.hard ? ' <span class="tag tag--red" style="height:15px;padding:0 4px;font-size:9px">硬窗</span>' : '') + '</td>' +
          '<td class="r num">' + fmt.usd(q.total) + '</td>' +
          '</tr>';
      }).join('');

      root.innerHTML = hero + statCards +
        '<div class="grid g-23" style="margin-top:14px">' +
        '<div class="grid" style="gap:14px">' +
        '<div class="card"><div class="card-h"><h3>未来 7 天到港与窗口密度</h3><span class="sp"></span>' +
        '<div class="row row--tight"><span class="legend-row"><i class="sw" style="background:var(--blue)"></i>到港</span>' +
        '<span class="legend-row" style="margin-left:10px"><i class="sw" style="background:var(--amber)"></i>交付窗口</span></div></div>' +
        '<div class="card-b"><div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;align-items:end">' + bars + '</div>' +
        '<p class="hint" style="margin-top:10px">到港日与交付窗口重叠的日期，是需要提前排车组与短存位的时段。免期以到港日为第 0 天起算。</p></div></div>' +
        '<div class="card"><div class="card-h"><h3>网络负载 <span class="k">按节点</span></h3><span class="sp"></span><button class="btn btn--sm btn--ghost" data-go="map">地图查看</button></div>' +
        '<div class="card-b">' + A.charts.bars(byNode.slice(0, 8), { labelW: 58 }) + '</div></div>' +
        '</div>' +
        '<div class="grid" style="gap:14px">' +
        '<div class="card"><div class="card-h"><h3>需要现在处理</h3><span class="sp"></span>' +
        '<span class="tag ' + (st.exc.length ? 'tag--red' : 'tag--green') + '">' + st.exc.length + ' 未结</span></div>' +
        '<div class="card-b card-b--tight">' + excRows + '</div>' +
        '<div class="card-b" style="padding-top:0"><button class="btn btn--sm" style="width:100%" data-go="ops">进入异常台</button></div></div>' +
        '<div class="card"><div class="card-h"><h3>服务档构成</h3></div><div class="card-b" style="display:flex;gap:14px;align-items:center">' +
        A.charts.donut([
          { v: s.orders.filter((o) => o.level === 'L1').length, c: 'var(--blue)' },
          { v: s.orders.filter((o) => o.level === 'L2').length, c: 'var(--teal)' },
          { v: s.orders.filter((o) => o.level === 'L3').length, c: 'var(--amber)' }
        ], { size: 118, thick: 12, center: s.orders.length, label: '总票数' }) +
        '<div style="display:grid;gap:7px;font-size:11.5px">' +
        legendDot('var(--blue)', 'L1 基础交接', s.orders.filter((o) => o.level === 'L1').length) +
        legendDot('var(--teal)', 'L2 入口交付', s.orders.filter((o) => o.level === 'L2').length) +
        legendDot('var(--amber)', 'L3 室内机位', s.orders.filter((o) => o.level === 'L3').length) +
        '</div></div></div>' +
        '</div></div>' +
        '<div class="card" style="margin-top:14px"><div class="card-h"><h3>今日队列 <span class="k">按窗口排序</span></h3><span class="sp"></span>' +
        '<span class="hint">点击一行进入地图定位</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>单号</th><th>目的地</th><th>设备</th><th>服务档</th><th>窗口</th><th class="r">B 直送全价</th></tr></thead>' +
        '<tbody>' + (qRows || '<tr><td colspan="6"><div class="empty"><b>队列已清空</b></div></td></tr>') + '</tbody></table></div></div>' +
        '<p class="hint" style="margin-top:12px;text-align:center">全部为演示数据。费率、服务档与作业码参照 V12 方案与公开区域报价整理，不代表任何一方的实际报价或承诺。</p>';
    },

    onResize: function () { }
  });

  function thisDayToday(s) { return s.today; }
  function stat(lab, val, unit, tone, meta, hot) {
    const map = { amber: 'var(--amber-soft)', blue: 'var(--blue-soft)', teal: 'var(--teal-soft)', violet: 'var(--violet-soft)', red: 'var(--red-soft)' };
    return '<div class="stat" style="--accent:' + map[tone] + '">' +
      '<div class="lab"><span class="dot dot--' + tone + '"></span>' + lab + '</div>' +
      '<div class="val">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="meta">' + meta + '</div></div>';
  }
  function miniStat(lab, val, unit, color) {
    return '<div style="padding:9px 11px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line-soft)">' +
      '<div style="font-size:10px;color:var(--txt-3)">' + lab + '</div>' +
      '<div class="num" style="font-size:17px;font-weight:700;color:' + color + ';line-height:1.3">' + val + '<small style="font-size:10px;color:var(--txt-3);font-weight:600;margin-left:2px">' + unit + '</small></div></div>';
  }
  function legendDot(color, label, n) {
    return '<div style="display:flex;align-items:center;gap:7px"><i class="sw" style="background:' + color + '"></i>' +
      '<span style="color:var(--txt-2)">' + label + '</span><b class="num sp" style="text-align:right">' + n + '</b></div>';
  }
})(window);
