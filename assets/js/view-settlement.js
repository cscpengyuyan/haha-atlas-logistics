/* ==========================================================================
   view-settlement.js — 结算复盘（P4：同批账证齐备）
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt;

  function batchMetrics(b) {
    const units = b.tickets;                       // 演示：一票一台
    const gross = b.baseline - b.actual;           // 报价差
    const net = gross - b.changeOrders + b.credit; // 增项与贷项
    return {
      units, gross, net,
      perUnitBase: b.baseline / units,
      perUnitNew: b.actual / units,
      ontime: b.ontime / b.tickets,
      firstTry: b.firstTry / b.tickets,
      pod: b.pod / b.tickets,
      damageRate: b.damage / units,
      marginPct: b.baseline ? net / b.baseline : 0
    };
  }

  A.registerView('settlement', {
    title: '结算复盘',
    sub: '按批次看原全价、新全费、增项与贷项，只有净额为正且无未解账差才扩大',

    mount: function (host) {
      host.innerHTML = '<div class="wrap" id="stRoot"></div>';
      const root = document.getElementById('stRoot');
      root.addEventListener('click', function (e) {
        const t = e.target.closest('[data-batch]');
        if (!t) return;
        A.app.state.ui.batch = t.dataset.batch;
        A.store.emit();
      });
    },

    update: function (s) {
      const root = document.getElementById('stRoot');
      if (!root) return;
      const batches = s.batches || [];
      const curId = s.ui.batch || batches[0].id;
      const b = batches.find((x) => x.id === curId) || batches[0];
      const m = batchMetrics(b);
      const inv = (s.invoices || []).filter((i) => i.batch === b.id);

      const selector = '<div class="row" style="gap:6px">' + batches.map(function (x) {
        return '<button class="pill' + (x.id === b.id ? ' is-on' : '') + '" data-batch="' + x.id + '">' + x.label +
          ' <span class="n">' + x.tickets + '</span></button>';
      }).join('') + '<span class="sp"></span><span class="hint">批次 ' + b.id + ' · ' + b.city + ' · ' + (b.closed ? '已结算 ' + b.closed : '在结') + '</span></div>';

      const kpis = '<div class="stat-grid">' +
        stat('样本票数', b.tickets, '票', 'blue', '达标线 ≥20 票首派') +
        stat('首派成功', fmt.pct(m.firstTry, 0), '', 'teal', b.firstTry + ' / ' + b.tickets) +
        stat('原窗准时', fmt.pct(m.ontime, 0), '', m.ontime >= s.baseline.ontime ? 'green' : 'red', '基线 ' + fmt.pct(s.baseline.ontime, 1)) +
        stat('单台新全费', fmt.usd(m.perUnitNew), '', 'violet', '原 ' + fmt.usd(m.perUnitBase)) +
        stat('批次净额', fmt.usd(m.net), '', m.net > 0 ? 'green' : 'red', '占原全价 ' + fmt.pct(m.marginPct, 1)) +
        '</div>';

      const wf = A.charts.waterfall([
        { k: '原全价', label: fmt.usd(b.baseline), abs: b.baseline, kind: 'total' },
        { k: '新全费', label: '−' + fmt.usd(b.actual), abs: -b.actual, kind: 'cut' },
        { k: '获批增项', label: '−' + fmt.usd(b.changeOrders), abs: -b.changeOrders, kind: 'add' },
        { k: '贷项 / 赔款', label: '+' + fmt.usd(b.credit), abs: b.credit, kind: 'cut' },
        { k: '净额', label: (m.net > 0 ? '+' : '') + fmt.usd(m.net), abs: m.net, kind: 'total' }
      ], { h: 176 });

      const wfCard = '<div class="card"><div class="card-h"><h3>净额构成</h3><span class="sp"></span>' +
        '<span class="tag ' + (m.net > 0 ? 'tag--green' : 'tag--red') + '">' + (m.net > 0 ? '净额为正' : '净额为负') + '</span></div>' +
        '<div class="card-b">' + wf +
        '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><tbody>' +
        '<tr><td>原方案同范围全价</td><td class="r num">' + fmt.usd(b.baseline) + '</td></tr>' +
        '<tr><td>新路径实际全程费用</td><td class="r num">−' + fmt.usd(b.actual) + '</td></tr>' +
        '<tr><td>获批变更（二次上门、等候、专项）</td><td class="r num">−' + fmt.usd(b.changeOrders) + '</td></tr>' +
        '<tr><td>贷项 / 实获赔款</td><td class="r num">+' + fmt.usd(b.credit) + '</td></tr>' +
        '<tr><td><b>批次净额</b></td><td class="r num" style="color:' + (m.net > 0 ? 'var(--green)' : 'var(--red)') + '"><b>' + (m.net > 0 ? '+' : '') + fmt.usd(m.net) + '</b></td></tr>' +
        '</tbody></table></div></div></div>';

      const gates = A.C.GATES.map(function (g, i) {
        const pass = [b.tickets >= 20, b.pod === b.tickets && b.damage <= 1, m.net > 0 && b.unmatched === 0, false][i];
        return '<div style="display:flex;gap:9px;padding:8px 0;border-bottom:1px solid var(--line-soft)">' +
          '<span class="tag ' + (pass ? 'tag--green' : 'tag--red') + '" style="height:18px">' + (pass ? '通过' : '未达') + '</span>' +
          '<div><div style="font-size:11.5px;font-weight:600">' + g.k + '</div>' +
          '<div style="font-size:10.5px;color:var(--txt-3);line-height:1.5">' + g.line + '</div></div></div>';
      }).join('');

      const gatesCard = '<div class="card"><div class="card-h"><h3>签批门槛 <span class="k">全部满足才可扩大</span></h3></div>' +
        '<div class="card-b card-b--tight">' + gates + '</div></div>';

      const invRows = inv.map(function (i) {
        const bad = i.diff > 0 && i.approved < i.diff;
        return '<tr><td class="mono" style="font-size:10.5px">' + i.id + '</td>' +
          '<td>' + i.vendor + '</td>' +
          '<td class="r num">' + fmt.usd(i.quoted) + '</td>' +
          '<td class="r num">' + fmt.usd(i.billed) + '</td>' +
          '<td class="r num" style="color:' + (i.approved ? 'var(--amber)' : 'var(--txt-3)') + '">' + (i.approved ? fmt.usd(i.approved) : '—') + '</td>' +
          '<td class="r num" style="color:' + (bad ? 'var(--red)' : 'var(--txt-2)') + '">' + (i.diff ? fmt.usd(i.diff) : '—') + '</td>' +
          '<td class="muted" style="font-size:10.5px">' + i.note + '</td>' +
          '<td><span class="tag ' + (i.status === '已核' ? 'tag--green' : i.status === '争议' ? 'tag--red' : 'tag--amber') + '">' + i.status + '</span></td></tr>';
      }).join('');

      const invCard = '<div class="card"><div class="card-h"><h3>账单差异</h3><span class="sp"></span>' +
        '<span class="hint">核报价、批准变更、作业凭证与发票逐行匹配</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>发票</th><th>供应商</th><th class="r">报价</th><th class="r">账单</th>' +
        '<th class="r">已批</th><th class="r">未获批差异</th><th>说明</th><th>状态</th></tr></thead><tbody>' +
        (invRows || '<tr><td colspan="8"><div class="empty"><b>本批次暂无发票</b></div></td></tr>') + '</tbody></table></div>' +
        '<div class="card-b" style="padding-top:10px"><p class="hint">账单大于委托时，采购先核免费等候与加台单位；有新增作业须找当日调度授权。未授权的争议行与无争议付款分开处理。</p></div></div>';

      /* 6-unit example from the plan */
      const six = '<div class="card"><div class="card-h"><h3>合批激励上限 <span class="k">六台同址样例</span></h3></div>' +
        '<div class="card-b"><div class="kv" style="font-size:11.5px">' +
        '<dt>原线全价（6 台 × 520）</dt><dd>3,120</dd>' +
        '<dt>拟用经站全价（干线 900＋6×300＋120）</dt><dd>2,820</dd>' +
        '<dt>激励前差额</dt><dd style="color:var(--teal)">300</dd>' +
        '<dt>共用预算（20% 上限）</dt><dd>60</dd>' +
        '<dt>7 天 SaaS 权益（6×7×0.50）</dt><dd>21</dd>' +
        '<dt>核发人工 ＋ 路线奖</dt><dd>12 ＋ 18</dd>' +
        '<dt>预计保留</dt><dd style="color:var(--teal);font-weight:700">249</dd>' +
        '</div>' +
        '<div class="divide"></div>' +
        '<p class="hint">临界运价：站内与末端 1,800、管理风险 120，干线须低于 <b class="num">6×(520−300)−120 = 1,200</b> 才有激励前差额。<br>' +
        '若客户要 14 天权益（42），加人工 12 与原奖 18 共 72 &gt; 60，须把奖金降到 ≤6 并获供方接受，或另批。已赚权益仍照约兑现。</p>' +
        '</div></div>';

      const rules = '<div class="card"><div class="card-h"><h3>三条口径</h3></div><div class="card-b"><div class="stack" style="gap:8px">' +
        rule('原方案已含的多点折扣不可再减', '拿两辆专车合计价当基线，会误报节省。已含优惠照实保留。', 'amber') +
        rule('未成功不能从分子剔掉', '失败、改派、补送、投诉留在原组；重复进场的车费留在原单。', 'red') +
        rule('新增覆盖单独验收', '原渠道到不了的邮编没有可比价，只报新增可服务范围与履约结果，不与降本批混算。', 'blue') +
        '</div></div></div>';

      root.innerHTML = selector +
        '<div style="margin-top:12px">' + kpis + '</div>' +
        '<div class="grid g-23" style="margin-top:14px;align-items:start">' +
        '<div class="stack">' + wfCard + invCard + '</div>' +
        '<div class="stack">' + gatesCard + six + rules + '</div>' +
        '</div>' +
        '<p class="hint" style="margin-top:12px;text-align:center">批次数字为演示样本，用于展示核算口径；V12 资料尚无可签认的达拉斯实际首派队列与发票，因此不能据此认定整批降本。</p>';
    }
  });

  function stat(lab, val, unit, tone, meta) {
    const map = { amber: 'var(--amber-soft)', blue: 'var(--blue-soft)', teal: 'var(--teal-soft)', violet: 'var(--violet-soft)', red: 'var(--red-soft)', green: 'var(--green-soft)' };
    return '<div class="stat" style="--accent:' + (map[tone] || 'var(--amber-soft)') + '">' +
      '<div class="lab"><span class="dot dot--' + tone + '"></span>' + lab + '</div>' +
      '<div class="val">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</div><div class="meta">' + meta + '</div></div>';
  }
  function rule(title, desc, tone) {
    return '<div style="display:flex;gap:8px"><span class="dot dot--' + tone + '" style="margin-top:4px"></span>' +
      '<div><div style="font-size:11.5px;font-weight:600">' + title + '</div>' +
      '<div style="font-size:10.5px;color:var(--txt-3);line-height:1.5">' + desc + '</div></div></div>';
  }
})(window);
