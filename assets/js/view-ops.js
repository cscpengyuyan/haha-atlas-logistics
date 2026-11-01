/* ==========================================================================
   view-ops.js — 异常与返修（F06 分诊 / RMA / 维修成本临界）
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt, dt = A.dt;

  function typeOf(id) { return A.C.EXC_TYPES.find((t) => t.id === id) || A.C.EXC_TYPES[0]; }

  A.registerView('ops', {
    title: '异常与返修',
    sub: 'F06 分诊、保管责任、现场维修与整机返修的成本临界',

    mount: function (host) {
      host.innerHTML = '<div class="wrap" id="opsRoot"></div>';
      const root = document.getElementById('opsRoot');
      root.addEventListener('click', function (e) {
        const t = e.target.closest('[data-act]');
        if (!t) return;
        const s = A.app.state;
        if (t.dataset.act === 'filter') { s.ui.excFilter = t.dataset.v; A.store.emit(); }
        if (t.dataset.act === 'row') { openTicket(t.dataset.id); }
        if (t.dataset.act === 'calc') {
          s.ui.repair = s.ui.repair || {};
          s.ui.repair[t.dataset.k] = Number(t.value != null ? t.value : t.dataset.v);
        }
      });
      root.addEventListener('input', function (e) {
        const t = e.target.closest('[data-calc]');
        if (!t) return;
        const s = A.app.state;
        s.ui.repair = s.ui.repair || { miles: 32, hours: 2, ot: false, units: 1 };
        s.ui.repair[t.dataset.calc] = t.type === 'checkbox' ? t.checked : Number(t.value);
        A.store.emit();
      });
    },

    update: function (s) {
      const root = document.getElementById('opsRoot');
      if (!root) return;
      const rep = s.ui.repair || (s.ui.repair = { miles: 32, hours: 2, ot: false, units: 1 });
      const flt = s.ui.excFilter || 'ALL';
      const all = s.exceptions || [];
      const list = all.filter((e) => flt === 'ALL' || e.type === flt);
      const open = all.filter((e) => e.status !== '已关闭');
      const over = open.filter((e) => e.ageH > e.sla);
      const units = open.reduce(function (a, e) {
        const o = s.orders.find((x) => x.id === e.orderId);
        return a + (o ? o.units : 0);
      }, 0);

      const kpiRow = '<div class="stat-grid">' +
        stat('未结异常', open.length, '单', 'red', '含待客户与处理中') +
        stat('超 SLA', over.length, '单', 'amber', '按类型 SLA 计') +
        stat('涉及设备', units, '台', 'violet', '在未结异常中') +
        stat('已关闭', all.length - open.length, '单', 'green', '本演示周期') +
        '</div>';

      const chips = '<div class="row" style="gap:5px">' +
        '<button class="pill' + (flt === 'ALL' ? ' is-on' : '') + '" data-act="filter" data-v="ALL">全部 <span class="n">' + all.length + '</span></button>' +
        A.C.EXC_TYPES.map(function (t) {
          const n = all.filter((e) => e.type === t.id).length;
          return '<button class="pill' + (flt === t.id ? ' is-on' : '') + '" data-act="filter" data-v="' + t.id + '">' + t.name + ' <span class="n">' + n + '</span></button>';
        }).join('') + '</div>';

      const rows = list.map(function (e) {
        const o = s.orders.find((x) => x.id === e.orderId);
        const t = typeOf(e.type);
        const overSla = e.ageH > e.sla;
        return '<tr data-act="row" data-id="' + e.id + '" style="cursor:pointer">' +
          '<td class="mono" style="font-size:10.5px">' + e.id + '</td>' +
          '<td><b>' + t.name + '</b>' + (t.stop ? ' <span class="tag tag--red" style="height:14px;padding:0 3px;font-size:8.5px">先停</span>' : '') + '</td>' +
          '<td class="mono" style="font-size:10.5px">' + e.orderId + '</td>' +
          '<td>' + (o ? o.city + ' ' + o.st : '—') + '</td>' +
          '<td class="muted">' + e.holder + '</td>' +
          '<td>' + e.owner + '</td>' +
          '<td class="num" style="color:' + (overSla ? 'var(--red)' : 'var(--txt-2)') + '">' + e.ageH + 'h / ' + e.sla + 'h</td>' +
          '<td><span class="tag ' + (e.status === '已关闭' ? 'tag--green' : e.status === '待客户' ? 'tag--amber' : 'tag--blue') + '">' + e.status + '</span></td>' +
          '</tr>';
      }).join('');

      /* triage tree */
      const triage = '<div class="card"><div class="card-h"><h3>分诊顺序 <span class="k">F06</span></h3></div>' +
        '<div class="card-b"><div class="stack" style="gap:9px">' +
        tri('1', '先停作业', '危险、货损或错 SN 先停，记录当前保管人与时间戳。', 'red') +
        tri('2', '判定能否安全修复', '可远程、寄件或本地上门恢复 → 就地结案；不适合现场安全维修 → 进 3。', 'amber') +
        tri('3', '需整机返修 → RMA', '先定接收点、包装、双向运费与复测标准；修后复测再复送。', 'violet') +
        tri('4', '商业退货 → 卖方 RMA', '按卖方授权与指定退货仓；仓方回签实收，退款另审。', 'blue') +
        '</div></div></div>';

      /* repair calculator */
      const OT = rep.ot ? 1.5 : 1;
      const onsite = Math.round(A.C.RATE.service.repair.resqCall +
        Math.max(0, rep.hours - 1) * A.C.RATE.service.repair.resqHour * OT +
        Math.max(0, rep.miles - 25) * A.C.RATE.service.repair.perMile);
      const pickup = Math.round(A.C.RATE.service.repair.nodakFirst + Math.max(0, rep.miles - 25) * A.C.RATE.service.repair.perMile);
      const bench = Math.round(Math.max(1, rep.hours) * 105);
      const redeliver = pickup;
      const downtime = Math.round(rep.hours * 0.4 * 100 + 2 * 60); // 停业时间折算（演示）
      const rebuild = pickup + bench + redeliver;

      const calc = '<div class="card"><div class="card-h"><h3>现场上门 vs 搬机返修 <span class="k">成本临界</span></h3></div>' +
        '<div class="card-b"><div class="grid g-3" style="gap:8px">' +
        inputField('单程距离 mi', 'miles', rep.miles) +
        inputField('工时 h（含路时）', 'hours', rep.hours) +
        '<label style="display:grid;gap:5px"><span style="font-size:10.5px;color:var(--txt-3)">时段</span>' +
        '<label style="display:flex;align-items:center;gap:6px;height:30px;font-size:11.5px"><input type="checkbox" data-calc="ot"' + (rep.ot ? ' checked' : '') + '> 非工作时段（1.5×）</label></label>' +
        '</div>' +
        '<div class="divide"></div>' +
        '<div class="grid g-2" style="gap:10px">' +
        cmpCard('现场上门', onsite, ['到场＋首小时 $260', '续时 $130/h × ' + OT.toFixed(1), '超出 25 mi 部分 $3/mi'], onsite <= rebuild) +
        cmpCard('搬机返修', rebuild, ['取机 $150（含 25 mi）', '车间 $105/h × ' + Math.max(1, rep.hours), '复送 $150'], rebuild < onsite) +
        '</div>' +
        '<p class="hint" style="margin-top:9px">停机增量另计：搬机通常多损失约 <b class="num" style="color:var(--amber)">' + fmt.n(downtime) + '</b> 美元的营业时间折算（' + rep.hours + ' h 工时按 40% 营业率 + 拆装包装 2 h）。' +
        '现场方案超过 <b class="num">' + fmt.usd(rebuild) + '</b> 且停机不敏感时，车间更省；反之先授权诊断再决定二访。</p>' +
        '<p class="hint" style="margin-top:6px;color:var(--txt-3)">费率参考 ResQ Dallas / Nodak / ASI 公开条款，仅用于排价与临界判断，不是达拉斯实际报价。</p>' +
        '</div></div>';

      /* holders */
      const holders = {};
      open.forEach(function (e) { holders[e.holder] = (holders[e.holder] || 0) + 1; });
      const holderCard = '<div class="card"><div class="card-h"><h3>设备现在谁手上</h3></div><div class="card-b">' +
        A.charts.bars(Object.keys(holders).map(function (k) { return { k: k, v: holders[k], t: holders[k] + ' 单', c: 'var(--amber)' }; }), { labelW: 108 }) +
        '<p class="hint" style="margin-top:10px">未决且无人保管的设备必须为零。已知货损同步开索赔经办，追责与保护设备并行。</p></div></div>';

      root.innerHTML = kpiRow +
        '<div class="grid g-23" style="margin-top:14px;align-items:start">' +
        '<div class="card"><div class="card-h"><h3>异常台账</h3><span class="sp"></span><span class="hint">点击一行查看处置建议</span></div>' +
        '<div class="card-b card-b--tight" style="padding-bottom:4px">' + chips + '</div>' +
        '<div class="tbl-wrap" style="max-height:420px"><table class="tbl"><thead><tr>' +
        '<th>单号</th><th>类型</th><th>关联订单</th><th>城市</th><th>当前保管人</th><th>责任人</th><th>已开 / SLA</th><th>状态</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="8"><div class="empty"><b>没有符合条件的异常</b></div></td></tr>') + '</tbody></table></div></div>' +
        '<div class="stack">' + triage + holderCard + '</div></div>' +
        '<div style="margin-top:14px">' + calc + '</div>' +
        '<p class="hint" style="margin-top:12px;text-align:center">异常记录为演示样本；真实作业中每条异常须挂到订单号、SN 与具体交接段，并留下保管人、时间戳与照片。</p>';
    }
  });

  function openTicket(id) {
    const s = A.app.state;
    const e = s.exceptions.find((x) => x.id === id);
    if (!e) return;
    const o = s.orders.find((x) => x.id === e.orderId);
    const t = typeOf(e.type);
    const steps = [
      ['发生', e.opened, '已停作业 / 记录保管人：' + e.holder],
      ['已通知', A.dt.add(e.opened, 0), '责任人 ' + e.owner + ' 接手'],
      ['下一步', s.today, e.status === '已关闭' ? '已关闭' : '等待客户或承运方回复']
    ];
    const html = '<div class="drawer-h"><div><h2>' + t.name + '</h2><p>' + e.id + ' · 关联 ' + e.orderId + (o ? ' · ' + o.city + ' ' + o.zip : '') + '</p></div>' +
      '<span class="sp"></span><button class="icon-btn" data-x="close">✕</button></div>' +
      '<div class="drawer-b">' +
      '<div style="display:flex;gap:9px;padding:10px;border-radius:9px;background:var(--red-soft);border:1px solid rgba(255,107,107,.25)">' +
      '<span class="dot dot--red" style="margin-top:3px"></span><div style="font-size:11.5px;line-height:1.55">' + e.note + '</div></div>' +
      '<div class="kv" style="font-size:12px">' +
      '<dt>已开时长</dt><dd style="color:' + (e.ageH > e.sla ? 'var(--red)' : 'var(--txt)') + '">' + e.ageH + ' 小时（SLA ' + e.sla + ' 小时）</dd>' +
      '<dt>当前保管人</dt><dd>' + e.holder + '</dd>' +
      '<dt>责任人</dt><dd>' + e.owner + '</dd>' +
      '<dt>是否先停作业</dt><dd>' + (t.stop ? '是' : '否') + '</dd>' +
      (o ? '<dt>设备</dt><dd>' + o.model + ' ×' + o.units + ' · ' + o.sns.join(' / ') + '</dd>' : '') +
      (o ? '<dt>服务档</dt><dd>' + A.C.LEVELS[o.level].code + (o.l4 ? '+L4' : '') + (o.l5 ? '+L5' : '') + '</dd>' : '') +
      '</div>' +
      '<div><div class="sec-t">处置时间线</div><div class="tl">' + steps.map(function (st, i) {
        return '<div class="tl-i ' + (i === 2 ? 'now' : 'done') + '"><div class="t"><b>' + st[0] + '</b><span class="d">' + st[1] + '</span></div><div class="d2">' + st[2] + '</div></div>';
      }).join('') + '</div></div>' +
      '<div><div class="sec-t">下一步可选</div><div class="stack" style="gap:6px">' +
      opt('改约 / 改址', '保留原服务与窗口，销售留客户书面确认；受影响段撤销旧放货版。') +
      opt('返站保管', '站方回签实收，设备继续由已签收方保管；二程失约不转移保管责任。') +
      opt('派修 / 上门', '先授权诊断，确认料号与费用再派二访；不把整机搬运当默认动作。') +
      opt('整机返修 RMA', '定接收点、包装、双向费用与复测标准，修后复测再复送。') +
      opt('索赔', '货损前后照片、保管人、交接段记录与发票同步，独立于运输跟进。') +
      '</div></div></div>' +
      '<div class="drawer-f"><button class="btn btn--sm btn--ghost" data-x="close2">关闭</button><span class="sp"></span>' +
      (e.status !== '已关闭' ? '<button class="btn btn--prime btn--sm" data-x="done">标记已处置</button>' : '<button class="btn btn--sm" disabled>已关闭</button>') +
      '</div>';
    A.drawer.open(html, {
      onMount: function (d) {
        d.querySelectorAll('[data-x="close"],[data-x="close2"]').forEach((b) => b.addEventListener('click', () => A.drawer.close()));
        const dn = d.querySelector('[data-x="done"]');
        if (dn) dn.addEventListener('click', function () {
          const e2 = A.app.state.exceptions.find((x) => x.id === id);
          e2.status = '已关闭';
          A.store.set({ exceptions: A.app.state.exceptions });
          A.drawer.close();
          A.toast('已关闭 ' + id, 'green');
        });
      }
    });
  }

  function stat(lab, val, unit, tone, meta) {
    const map = { amber: 'var(--amber-soft)', blue: 'var(--blue-soft)', teal: 'var(--teal-soft)', violet: 'var(--violet-soft)', red: 'var(--red-soft)', green: 'var(--green-soft)' };
    return '<div class="stat" style="--accent:' + (map[tone] || 'var(--amber-soft)') + '">' +
      '<div class="lab"><span class="dot dot--' + tone + '"></span>' + lab + '</div>' +
      '<div class="val">' + val + '<small>' + unit + '</small></div><div class="meta">' + meta + '</div></div>';
  }
  function tri(n, title, desc, tone) {
    return '<div style="display:flex;gap:9px"><span style="width:17px;height:17px;flex:none;border-radius:5px;display:grid;place-items:center;font-size:9.5px;font-weight:700;background:var(--' + tone + '-soft);color:var(--' + tone + ')">' + n + '</span>' +
      '<div><div style="font-size:11.5px;font-weight:600">' + title + '</div><div style="font-size:10.5px;color:var(--txt-3);line-height:1.5">' + desc + '</div></div></div>';
  }
  function inputField(label, key, val) {
    return '<label style="display:grid;gap:5px"><span style="font-size:10.5px;color:var(--txt-3)">' + label + '</span>' +
      '<input class="input" type="number" data-calc="' + key + '" value="' + val + '" min="0" step="1"></label>';
  }
  function cmpCard(name, total, lines, win) {
    return '<div style="padding:10px;border-radius:9px;background:var(--panel-2);border:1px solid ' + (win ? 'rgba(45,212,191,.4)' : 'var(--line-soft)') + '">' +
      '<div style="display:flex;align-items:center;gap:6px"><b style="font-size:11.5px">' + name + '</b><span class="sp"></span>' +
      (win ? '<span class="tag tag--teal">更低</span>' : '') + '</div>' +
      '<div class="num" style="font-size:19px;font-weight:700;margin:3px 0 6px">' + fmt.usd(total) + '</div>' +
      '<div style="display:grid;gap:2px;font-size:10.5px;color:var(--txt-3)">' + lines.map((l) => '· ' + l).join('<br>') + '</div></div>';
  }
  function opt(title, desc) {
    return '<div style="padding:8px 10px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line-soft)">' +
      '<div style="font-size:11.5px;font-weight:600">' + title + '</div><div style="font-size:10.5px;color:var(--txt-3);line-height:1.5">' + desc + '</div></div>';
  }
})(window);
