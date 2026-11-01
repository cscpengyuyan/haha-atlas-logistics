/* ==========================================================================
   view-routing.js — 路径与比价（A / B / C1 / C2）+ 换线判定
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt;

  function defaultCfg(s) {
    return s.ui.route || (s.ui.route = {
      nodeId: 'DAL', areaIdx: 2, model: 'M03', units: 2, level: 'L3', l4: false, l5: true
    });
  }

  function synth(cfg, s) {
    const area = A.C.AREAS[cfg.areaIdx];
    const node = A.C.nodeById[cfg.nodeId];
    const [nodeId, city, st, zip, lat, lng] = area;
    return {
      id: 'RFQ-' + node.id + '-' + zip, nodeId: node.id, city, st, zip, lat, lng,
      model: cfg.model, units: cfg.units, level: cfg.level, l4: cfg.l4, l5: cfg.l5,
      miles: Math.round(A.geo.roadMiles(node, { lat, lng })),
      window: { date: s.today, from: '10:00', to: '13:00' }, hard: false,
      status: '待派', sns: []
    };
  }

  A.registerView('routing', {
    title: '路径与比价',
    sub: '同一票、同一终点、同窗口下的 A / B / C1 / C2 全价对比与换线判定',

    mount: function (host) {
      host.innerHTML = '<div class="wrap" id="rtRoot"></div>';
      const root = document.getElementById('rtRoot');
      root.addEventListener('change', function (e) {
        const t = e.target.closest('[data-cfg]');
        if (!t) return;
        const s = A.app.state, cfg = defaultCfg(s);
        const k = t.dataset.cfg;
        cfg[k] = k === 'units' || k === 'areaIdx' ? Number(t.value) : t.value;
        if (k === 'nodeId') {
          const first = A.C.AREAS.findIndex((a) => a[0] === cfg.nodeId);
          const cur = A.C.AREAS[cfg.areaIdx];
          if (!cur || cur[0] !== cfg.nodeId) cfg.areaIdx = first >= 0 ? first : 0;
        }
        A.store.emit();
      });
      root.addEventListener('click', function (e) {
        const t = e.target.closest('[data-flag],[data-preset]');
        if (!t) return;
        const s = A.app.state, cfg = defaultCfg(s);
        if (t.dataset.flag) { cfg[t.dataset.flag] = !cfg[t.dataset.flag]; A.store.emit(); }
        if (t.dataset.preset === 'dfw') {
          cfg.nodeId = 'DAL'; cfg.areaIdx = 13; cfg.model = 'M03'; cfg.units = 2;
          cfg.level = 'L3'; cfg.l4 = false; cfg.l5 = true; A.store.emit();
          A.toast('已载入 DFW-Q01 样单参数', 'teal');
        }
        if (t.dataset.preset === 'stairs') {
          cfg.nodeId = 'NJE'; cfg.areaIdx = 32; cfg.model = 'M06'; cfg.units = 1;
          cfg.level = 'L3'; cfg.l4 = true; cfg.l5 = false; A.store.emit();
          A.toast('已载入复杂通道样例（楼梯 + 最高型号）', 'amber');
        }
      });
    },

    update: function (s) {
      const cfg = defaultCfg(s);
      const root = document.getElementById('rtRoot');
      if (!root) return;
      const o = synth(cfg, s);
      const qs = A.pricing.feasiblePaths(o);
      const best = qs.filter((x) => x.q.feasibility !== 'blocked').sort((a, b) => a.q.total - b.q.total)[0];
      const baseline = qs.find((x) => x.path === 'A' && x.q.feasibility !== 'blocked') || qs.find((x) => x.q.feasibility !== 'blocked');
      const m = A.C.MODELS[cfg.model];

      const areaOpts = A.C.AREAS.map(function (a, i) {
        if (a[0] !== cfg.nodeId) return '';
        return '<option value="' + i + '"' + (i === cfg.areaIdx ? ' selected' : '') + '>' + a[1] + ', ' + a[2] + ' ' + a[3] + '</option>';
      }).join('');

      const paramCard =
        '<div class="card"><div class="card-h"><h3>询价参数 <span class="k">同版发给主备</span></h3><span class="sp"></span>' +
        '<button class="btn btn--sm btn--ghost" data-preset="dfw">DFW-Q01 样单</button></div>' +
        '<div class="card-b"><div class="grid g-2" style="gap:10px">' +
        field('起运仓', '<select class="select" data-cfg="nodeId">' + A.C.NODES.map(function (n) {
          return '<option value="' + n.id + '"' + (n.id === cfg.nodeId ? ' selected' : '') + '>' + n.id + ' · ' + n.name + '</option>';
        }).join('') + '</select>') +
        field('最终地址（区域样点）', '<select class="select" data-cfg="areaIdx">' + areaOpts + '</select>') +
        field('型号', '<select class="select" data-cfg="model">' + Object.keys(A.C.MODELS).map(function (k) {
          return '<option value="' + k + '"' + (k === cfg.model ? ' selected' : '') + '>' + k + ' · ' + A.C.MODELS[k].name + ' · ' + A.C.MODELS[k].hin + ' in</option>';
        }).join('') + '</select>') +
        field('台数', '<input class="input" type="number" min="1" max="6" value="' + cfg.units + '" data-cfg="units" style="width:100%">') +
        field('服务档', '<select class="select" data-cfg="level">' + Object.keys(A.C.LEVELS).map(function (k) {
          return '<option value="' + k + '"' + (k === cfg.level ? ' selected' : '') + '>' + k + ' · ' + A.C.LEVELS[k].name + '（' + A.C.LEVELS[k].short + '）</option>';
        }).join('') + '</select>') +
        field('叠加动作', '<div class="row row--tight">' +
          '<button class="pill' + (cfg.l4 ? ' is-on' : '') + '" data-flag="l4">+L4 特殊通道</button>' +
          '<button class="pill' + (cfg.l5 ? ' is-on' : '') + '" data-flag="l5">+L5 技术启用</button></div>') +
        '</div>' +
        '<div class="divide"></div>' +
        '<div class="row" style="gap:14px;font-size:11.5px">' +
        '<span>里程 <b class="num">' + fmt.n(o.miles) + ' mi</b></span>' +
        '<span>尺寸 <b class="num">' + m.l + '×' + m.w + '×' + m.h + ' cm</b></span>' +
        '<span>带托高 <b class="num" style="color:' + (m.over84 ? 'var(--red)' : 'var(--txt)') + '">' + m.hin + ' in</b></span>' +
        '<span>毛重 <b class="num">' + m.kg + ' kg</b></span>' +
        '</div>' +
        '<p class="hint" style="margin-top:9px">' + m.note + '。' +
        (m.over84 ? '<b style="color:var(--red)">带托高度已超 84 英寸，普通零担产品会拒收。</b>' : '仍需核实际外廓、车门与尾板。') +
        '</p></div></div>';

      const pathCards = '<div class="grid g-4" style="gap:10px">' + qs.map(function (x) {
        const p = A.C.PATHS[x.path], q = x.q;
        const isBest = best && best.path === x.path;
        const blocked = q.feasibility === 'blocked';
        return '<div class="card" style="' + (isBest ? 'border-color:rgba(245,165,36,.55);box-shadow:0 0 0 1px rgba(245,165,36,.25), var(--shadow)' : '') + (blocked ? ';opacity:.62' : '') + '">' +
          '<div class="card-h" style="padding:9px 11px">' +
          '<h3 style="font-size:11.5px;white-space:nowrap"><span class="tag tag--' + p.tone + '" style="height:17px">' + x.path + '</span>' + (p.short || p.name) + '</h3>' +
          '<span class="sp"></span>' + (isBest ? '<span class="tag tag--amber">最优</span>' : '') + '</div>' +
          '<div class="card-b card-b--tight">' +
          '<div class="num" style="font-size:22px;font-weight:700;letter-spacing:-.02em' + (blocked ? ';color:var(--txt-3)' : '') + '">' + (blocked ? '不可行' : fmt.usd(q.total)) + '</div>' +
          '<div style="font-size:10px;color:var(--txt-3);margin-bottom:8px">' + (blocked ? q.blocker : '含已购动作与已知增项') + '</div>' +
          (blocked ? '' : '<table class="tbl" style="font-size:10.5px"><tbody>' + q.lines.map(function (l) {
            return '<tr><td style="padding:4px 0;border:0;color:var(--txt-2)">' + l.k + '</td>' +
              '<td class="r num" style="padding:4px 0;border:0">' + fmt.usd(l.amt) + '</td></tr>';
          }).join('') + '</tbody></table>') +
          '</div></div>';
      }).join('') + '</div>';

      const verdict = (function () {
        if (!best) return '';
        const diff = (baseline ? baseline.q.total : best.q.total) - best.q.total;
        return '<div class="card"><div class="card-b" style="display:flex;gap:13px;align-items:flex-start">' +
          '<span class="dot dot--' + (diff > 0 ? 'green' : 'amber') + '" style="margin-top:6px"></span>' +
          '<div><div style="font-size:12.5px;font-weight:650;margin-bottom:3px">' +
          (diff > 0
            ? '按当前参数，' + best.path + '（' + A.C.PATHS[best.path].name + '）比 ' + baseline.path + ' 省 ' + fmt.usd(diff) + '／' + cfg.units + ' 台。'
            : '按当前参数，' + best.path + ' 已是最低可行全价。') + '</div>' +
          '<p class="hint">换线还要同时满足：同范围、同窗口、扣除全部增量费用后净额 &gt; 0，且不突破任一原承诺。少做一步换来的低价不算节省。</p>' +
          '<div class="row row--tight" style="margin-top:7px">' +
          '<span class="tag tag--plain">原窗 ' + o.window.from + '–' + o.window.to + ' 同</span>' +
          '<span class="tag tag--plain">终点同</span>' +
          '<span class="tag ' + (o.level === 'L3' ? 'tag--amber' : 'tag--plain') + '">服务 ' + A.C.LEVELS[o.level].code + (cfg.l4 ? '+L4' : '') + (cfg.l5 ? '+L5' : '') + '</span>' +
          '<span class="tag tag--plain">' + o.miles + ' mi</span></div></div></div></div>';
      })();

      /* DFW reference */
      const dfw = [
        ['原仓出库＋干线', '15×2 = 30；干线含在配送', '15×2 = 30；运输含在直提', '15×2 = 30；原仓到站另 120／票'],
        ['入站、临存、出站', '无', '无', '收发 22×2 = 44；短存 3／台日×2台×2日 = 12'],
        ['L3 首台＋同址加台', '365＋145 = 510', '310＋100 = 410', '225＋85 = 310（站至最终机位）'],
        ['停车与启用', '停车 20／站；T5 60×2 = 120', '停车 20；T5 120', '停车 20；T5 120'],
        ['同服务全程预算', '680', '580', '656'],
        ['对基线改善', '基线', '−100', '−24']
      ];
      const dfwTable = '<div class="card"><div class="card-h"><h3>DFW-Q01 两台同址比价 <span class="k">模拟美元</span></h3><span class="sp"></span>' +
        '<span class="hint">结论：选 B 直提 580，较可执行原路径少 100</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>费用与依据</th>' +
        '<th>可执行原路线</th><th>主供甲：B 直提</th><th>备选乙：C2 经站</th></tr></thead><tbody>' +
        dfw.map(function (r, i) {
          return '<tr' + (i === 4 ? ' style="font-weight:650"' : '') + '><td>' + r[0] + '</td>' +
            '<td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="num">' + r[3] + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="card-b" style="padding-top:10px"><p class="hint">三方均已确认相同原窗口、相同 L3 动作。乙的 310 仅是二程小计，不能单独与 A 的全程价比较。中选后只向甲发委托，售后另向 T5 服务商发两台的 L5 技术单。</p></div></div>';

      /* service menu */
      const menu = '<div class="card"><div class="card-h"><h3>服务菜单 <span class="k">L1–L5</span></h3><span class="sp"></span>' +
        '<span class="hint">下单时只选一个 L1–L3，L4/L5 按已购动作叠加</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>代码</th><th>确切交付边界</th><th>下单时须核</th><th class="r">相对基数</th></tr></thead><tbody>' +
        Object.keys(A.C.LEVELS).map(function (k) {
          const l = A.C.LEVELS[k];
          return '<tr><td><span class="tag tag--amber">' + k + '</span> <b>' + l.name + '</b></td><td class="sub">' + l.reach + '</td>' +
            '<td class="muted" style="font-size:11px">' + l.need + '</td><td class="r num">×' + l.factor.toFixed(2) + '</td></tr>';
        }).join('') +
        Object.keys(A.C.ADDONS).map(function (k) {
          const a = A.C.ADDONS[k];
          return '<tr><td><span class="tag tag--' + (k === 'L4' ? 'violet' : 'teal') + '">' + k + '</span> <b>' + a.name + '</b></td>' +
            '<td class="sub">' + a.note + '</td><td class="muted" style="font-size:11px">须书面接受工具、人数、工法与专项价</td>' +
            '<td class="r num">+$' + a.fee + '／台</td></tr>';
        }).join('') + '</tbody></table></div></div>';

      /* carrier limits */
      const lim = A.C.RATE.carrierLimits;
      const modelRows = Object.keys(A.C.MODELS).map(function (k) {
        const mm = A.C.MODELS[k];
        const fed = mm.hin > lim.fedexFreightDirect.maxH;
        const estes = mm.hin > lim.estes.maxH;
        return '<tr><td><b>' + k + '</b> <span class="muted">' + mm.name + '</span></td>' +
          '<td class="num">' + mm.l + '×' + mm.w + '×' + mm.h + '</td>' +
          '<td class="num">' + mm.hin + '</td><td class="num">' + mm.kg + '</td>' +
          '<td class="num">' + mm.cuft + '</td><td class="num">' + mm.per40 + '</td>' +
          '<td><span class="tag ' + (fed ? 'tag--red' : 'tag--green') + '">' + (fed ? 'FedEx 超高' : 'FedEx 尺寸过筛') + '</span> ' +
          '<span class="tag ' + (estes ? 'tag--red' : 'tag--plain') + '">' + (estes ? 'Estes 超高' : 'Estes 过筛') + '</span></td>' +
          '<td class="muted" style="font-size:10.5px">' + mm.note + '</td></tr>';
      }).join('');

      const modelTable = '<div class="card"><div class="card-h"><h3>七型号与承运初筛</h3><span class="sp"></span>' +
        '<span class="hint">84 in = 213.36 cm，M04 与纸面上限只差 1.36 cm</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>型号</th><th>带托长×宽×高（cm）</th><th class="r">高（in）</th><th class="r">毛重（kg）</th>' +
        '<th class="r">体积 ft³</th><th class="r">40HQ 参考位</th><th>零担产品初筛</th><th>提货或进门前必须核</th></tr></thead><tbody>' +
        modelRows + '</tbody></table></div>' +
        '<div class="card-b" style="padding-top:10px"><p class="hint">FedEx Freight Direct 标准单件限高 75 in，七款带托均超过；Estes Front Door 限 60×48×84 in、1,500 lb。' +
        '尺寸过筛只说明可进询价，不表示承运人会拆托、清运或搬进指定机位。</p></div></div>';

      root.innerHTML = '<div class="grid g-32" style="align-items:start">' + paramCard +
        '<div class="stack">' + pathCards + verdict + '</div></div>' +
        '<div style="margin-top:14px" class="stack">' + dfwTable + menu + modelTable + '</div>' +
        '<p class="hint" style="margin-top:12px;text-align:center">费率卡为演示用内部口径，锚定 V12 方案 DFW-Q01 样单与公开区域报价；实际派单前须取得对本票机型、现场、人员工具、全价与排期的书面接受。</p>';
    }
  });

  function field(label, inner) {
    return '<label style="display:grid;gap:5px"><span style="font-size:10.5px;color:var(--txt-3);letter-spacing:.04em">' + label + '</span>' + inner + '</label>';
  }
})(window);
