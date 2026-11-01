/* ==========================================================================
   view-runbook.js — 作业手册：F 码、岗位、周期、S 码、KPI 定义
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt;

  A.registerView('runbook', {
    title: '作业手册',
    sub: 'F01–F08 作业码、岗位权限、P1–P4 周期、S01–S04 头程交接与 KPI 口径',

    mount: function (host) {
      host.innerHTML = '<div class="wrap" id="rbRoot"></div>';
      const root = document.getElementById('rbRoot');
      root.addEventListener('click', function (e) {
        const t = e.target.closest('[data-step]');
        if (!t) return;
        A.app.state.ui.step = t.dataset.step;
        A.store.emit();
      });
    },

    update: function (s) {
      const root = document.getElementById('rbRoot');
      if (!root) return;
      const cur = s.ui.step || 'F03';
      const steps = A.C.STEPS;
      const step = steps.find((x) => x.id === cur) || steps[0];

      const rail = '<div class="card"><div class="card-h"><h3>履约作业码 <span class="k">F01–F08</span></h3><span class="sp"></span>' +
        '<span class="hint">点击查看输入、凭证与退回条件</span></div>' +
        '<div class="card-b"><div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px">' +
        steps.map(function (x, i) {
          const on = x.id === step.id;
          return '<button data-step="' + x.id + '" style="text-align:left;padding:9px 8px;border-radius:8px;border:1px solid ' + (on ? 'rgba(245,165,36,.5)' : 'var(--line-soft)') + ';background:' + (on ? 'var(--amber-soft)' : 'var(--panel-2)') + '">' +
            '<div class="mono" style="font-size:10px;color:' + (on ? 'var(--amber)' : 'var(--txt-3)') + '">' + x.id + '</div>' +
            '<div style="font-size:11px;font-weight:600;margin-top:2px;line-height:1.3">' + x.name + '</div>' +
            '<div style="font-size:9.5px;color:var(--txt-3);margin-top:3px">' + x.owner + '</div></button>';
        }).join('') + '</div></div></div>';

      const detail = '<div class="card"><div class="card-h"><h3><span class="tag tag--amber">' + step.id + '</span> ' + step.name + '</h3>' +
        '<span class="sp"></span><span class="hint">' + step.owner + '</span></div>' +
        '<div class="card-b"><div class="grid g-3" style="gap:12px">' +
        block('交出什么', step.out, 'teal') +
        block('凭什么放行', step.gate, 'amber') +
        block('路径选项', step.opts ? step.opts.map((p) => p + ' · ' + A.C.PATHS[p].name).join('；') : '按实物流向选 A / B / C1 / C2，服务另按已购 L 档', 'blue') +
        '</div>' +
        '<div class="divide"></div>' +
        '<p class="hint">单号贯穿：订单 → SN → 段号 / 停靠点 → POD → 发票行。每段换手都留时间、货况与双方回执；未完成动作点名接手人。</p>' +
        '</div></div>';

      const roles = '<div class="card"><div class="card-h"><h3>岗位与权限</h3><span class="sp"></span><span class="hint">申请人不得自批</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>岗位</th><th>职责</th><th>可以做什么</th></tr></thead><tbody>' +
        A.C.ROLES.map(function (r) {
          return '<tr><td><b>' + r.role + '</b></td><td class="sub" style="font-size:11px">' + r.duty + '</td>' +
            '<td class="muted" style="font-size:11px">' + r.right + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      const cycles = '<div class="card"><div class="card-h"><h3>启动与验收周期 <span class="k">P1–P4</span></h3><span class="sp"></span>' +
        '<span class="hint">由真实业务事件触发，不按日历换页</span></div>' +
        '<div class="card-b"><div class="stack" style="gap:8px">' + A.C.CYCLES.map(function (c) {
          return '<div style="display:grid;grid-template-columns:38px 1fr;gap:10px;padding:9px 10px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line-soft)">' +
            '<div class="mono" style="font-size:11px;font-weight:700;color:var(--amber)">' + c.id + '</div>' +
            '<div><div style="font-size:11.5px;font-weight:600">' + c.name + '</div>' +
            '<div style="font-size:10.5px;color:var(--txt-3);line-height:1.5;margin-top:2px">进入：' + c.in + '<br>交出：' + c.out + '<br>退回：' + c.pass + '</div></div></div>';
        }).join('') + '</div></div></div>';

      const stageS = '<div class="card"><div class="card-h"><h3>头程 S01–S04 交接</h3><span class="sp"></span><span class="hint">到港通知不能代替任何放行</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>环节</th><th>凭什么继续</th><th>未满足怎么办</th></tr></thead><tbody>' +
        [['S01 订舱', '具名交货地点、指定仓、进口责任人、费用承担与订舱回执', '只报港到港时先补短驳委托与报价'],
          ['S02 装运', 'SN 关联件号与实测包装；箱封、VGM、ISF 与实际航次', '清单与实物不符先更正；换船改港留新旧版本'],
          ['S03 到港', '监管放行、船方放货、场站可提三项齐', '三项缺一暂缓派车；记末个免费日与费期'],
          ['S04 入仓', '取 EIR 并还空；凭分单提已拆齐件；按 ASN 逐 SN 签收', '缺件开异常，受损机隔离，库存只锁已验合格机']]
          .map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td class="sub" style="font-size:11px">' + r[1] + '</td><td class="muted" style="font-size:11px">' + r[2] + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>';

      const kpis = '<div class="card"><div class="card-h"><h3>KPI 口径</h3><span class="sp"></span><span class="hint">每月按供应商、城市、服务档分列</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>指标</th><th>分子 ÷ 分母</th><th>为什么这样算</th></tr></thead><tbody>' +
        A.C.KPIS.map(function (k) {
          return '<tr><td><b>' + k.name + '</b></td><td class="mono" style="font-size:10.5px">' + k.f + '</td><td class="muted" style="font-size:11px">' + k.why + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      const docs = '<div class="card"><div class="card-h"><h3>随单必留凭证</h3></div><div class="card-b">' +
        '<div class="grid g-2" style="gap:9px">' +
        A.C.DOCS.map(function (d) {
          return '<div style="display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line-soft);font-size:11px">' +
            '<span class="tag tag--plain" style="height:16px;padding:0 4px;font-size:9px">S0' + (d.stage + 1) + '</span>' + d.name + '</div>';
        }).join('') + '</div>' +
        '<p class="hint" style="margin-top:10px">保留装箱清单、美国仓实收、设备归还与关税付款凭据。单独记末个免费日及各项费期，临界时先约替代窗口或报批费用。</p>' +
        '</div></div>';

      const swRule = '<div class="card" style="border-color:rgba(245,165,36,.3)"><div class="card-b" style="display:flex;gap:11px">' +
        '<span class="dot dot--amber" style="margin-top:5px"></span><div>' +
        '<div style="font-size:12px;font-weight:650;margin-bottom:3px">换线标准（唯一判据）</div>' +
        '<p class="hint">原方式能履约时，只有同范围、同窗口且扣除全部增量费用后 <b>净额 &gt; 0</b> 才换线；原方式不能履约，则按保履约审批，单列价差。' +
        'A／B／C 是物流路径；L1 基础交接、L2 指定入口、L3 到机位三选一；L4 复杂通道专项、L5 技术启用按已购动作叠加。</p>' +
        '</div></div></div>';

      root.innerHTML = swRule +
        '<div style="margin-top:14px">' + rail + '</div>' +
        '<div style="margin-top:14px">' + detail + '</div>' +
        '<div class="grid g-2" style="margin-top:14px;align-items:start">' + roles + cycles + '</div>' +
        '<div class="grid g-2" style="margin-top:14px;align-items:start">' + stageS + docs + '</div>' +
        '<div style="margin-top:14px">' + kpis + '</div>' +
        '<p class="hint" style="margin-top:12px;text-align:center">本手册按 V12 方案的作业码与口径整理，用于演示系统如何承载同一套流程；实际启用前须由业务、物流、采购与财务分别确认权限与阈值。</p>';
    }
  });

  function block(title, body, tone) {
    return '<div><div class="sec-t" style="margin-bottom:5px"><span class="dot dot--' + tone + '" style="margin:0"></span>' + title + '</div>' +
      '<div style="font-size:11.5px;color:var(--txt-2);line-height:1.6">' + body + '</div></div>';
  }
})(window);
