/* ==========================================================================
   view-ocean.js — 海运在途看板（S01→S04 → 入仓）
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A, fmt = A.fmt, dt = A.dt;
  const STAGES = A.C.OCEAN_STAGES;

  function stageIdx(id) { return STAGES.findIndex((s) => s.id === id); }
  function etaOf(s) { return s.actualEta || s.eta; }
  function freeLeft(s, today) { return s.freeDays - dt.diff(etaOf(s), today); }
  function daysTo(s, today) { return dt.diff(today, etaOf(s)); }
  function tone(s, today) {
    const left = freeLeft(s, today);
    if (s.stage === 'REC') return 'ok';
    if (left < 0) return 'crit';
    if (left <= 2) return 'warn';
    return 'ok';
  }

  function kpis(s) {
    const live = s.ocean.filter((x) => x.stage !== 'REC');
    const sea = s.ocean.filter((x) => x.stage === 'S02').reduce((a, x) => a + x.units, 0);
    const demo = live.filter((x) => tone(x, s.today) !== 'ok');
    const missDocs = s.ocean.reduce((a, x) => a + A.oceanDoc(x).missingDue.length, 0);
    const drift = s.ocean.filter((x) => x.actualEta).map((x) => dt.diff(x.eta, x.actualEta));
    const avg = drift.length ? drift.reduce((a, b) => a + b, 0) / drift.length : 0;
    const wait = live.filter((x) => stageIdx(x.stage) >= 2).reduce((a, x) => a + x.units, 0);
    return { live, sea, demo, missDocs, avg, wait, boxes: live.length };
  }

  /* ── kanban card ─────────────────────────────────────────────────── */
  function card(s, t) {
    const lanes = s.lane;
    const d = A.oceanDoc(s);
    const dleft = freeLeft(s, t);
    const sel = (A.app.state.ui.oceanSel === s.id);
    const warn = s.stage === 'REC' ? null
      : dleft < 0 ? { cls: 'crit', txt: '免期超 ' + Math.abs(dleft) + ' 天' }
        : dleft <= 2 ? { cls: '', txt: '免期剩 ' + dleft + ' 天' }
          : d.missingDue.length ? { cls: 'crit', txt: '缺 ' + d.missingDue.length + ' 份到期单证' } : null;
    return '<div class="kcard' + (sel ? ' is-sel' : '') + '" draggable="true" data-id="' + s.id + '">' +
      '<div class="kcard-top"><span class="kcard-id">' + s.id + '</span><span class="sp"></span>' +
      '<span class="tag ' + (s.box === 'LCL' ? 'tag--plain' : s.box === '40HQ' ? 'tag--blue' : 'tag--teal') + '" style="height:16px;padding:0 4px;font-size:9px">' + s.box + '</span></div>' +
      '<div class="kcard-route"><span class="port">' + lanes.from + '</span><span class="arrow">→</span><span class="port">' + lanes.to + '</span>' +
      '<span class="sp"></span><b class="num" style="font-size:10.5px">' + s.units + ' 台</b></div>' +
      '<div class="kcard-meta">' +
      '<span>' + s.vessel.split(' ').slice(0, 2).join(' ') + '</span>' +
      '<span style="margin-left:auto">' + (s.stage === 'REC' ? '已入 ' + fmt.n(s.units) + ' 台' : (daysTo(s, t) >= 0 ? 'ETA ' + dt.mmdd(etaOf(s)) + ' · ' + daysTo(s, t) + 'd' : 'ETA ' + dt.mmdd(etaOf(s)))) + '</span>' +
      '</div>' +
      '<div class="docbar">' + A.C.DOCS.map(function (dd) {
        const on = s.docList[dd.id];
        const overdue = !on && dd.stage <= d.stageIdx;
        return '<i class="' + (on ? 'on' : overdue ? 'miss' : '') + '" title="' + dd.name + '"></i>';
      }).join('') + '</div>' +
      (warn ? '<div class="kcard-warn ' + warn.cls + '">' + warn.txt + '</div>' : '') +
      '</div>';
  }

  /* ── gantt ───────────────────────────────────────────────────────── */
  function gantt(s) {
    const days = 24;
    const start = s.today;
    const ports = Object.keys(A.C.PORTS).filter((p) => !A.C.PORTS[p].cn);
    const rows = ports.map(function (p) {
      const list = s.ocean.filter((x) => x.lane.to === p && x.stage !== 'REC');
      return { p, list };
    }).filter((r) => r.list.length);
    const axis = [];
    for (let i = 0; i < days; i += 3) {
      const d = dt.add(start, i);
      axis.push({ i, d, label: dt.mmdd(d) });
    }
    let html = '<div class="gantt-axis"><div></div><div class="gantt-ticks">' +
      axis.map((a) => '<span style="left:' + (a.i / days * 100) + '%">' + a.label + '</span>').join('') + '</div></div>';
    html += rows.map(function (r) {
      const bars = r.list.map(function (x) {
        const eta = etaOf(x);
        const d0 = dt.diff(start, eta);
        const left = Math.max(0, Math.min(days - 0.5, d0));
        const tone2 = tone(x, s.today);
        return '<div class="gantt-bar ' + (tone2 === 'crit' ? 'crit' : tone2 === 'warn' ? 'warn' : '') + '" ' +
          'style="left:' + (left / days * 100) + '%;width:' + (Math.max(4, x.freeDays) / days * 100) + '%" ' +
          'title="' + x.id + ' · ETA ' + eta + ' · ' + x.units + ' 台 · 免期 ' + x.freeDays + ' 天"></div>';
      }).join('');
      return '<div class="gantt-row"><div style="font-size:10px;color:var(--txt-2);display:flex;align-items:center;gap:5px">' +
        '<span class="mono" style="font-size:9.5px;color:var(--txt-3)">' + r.p + '</span>' + A.C.PORTS[r.p].name.replace(' / ', '/') +
        '</div><div class="gantt-track">' + bars +
        '<div class="gantt-now" style="left:0"></div></div></div>';
    }).join('');
    return '<div class="gantt">' + html + '</div>';
  }

  /* ── drawer ──────────────────────────────────────────────────────── */
  function openDrawer(id) {
    const s = A.app.state;
    const x = s.ocean.find((y) => y.id === id);
    if (!x) return;
    s.ui.oceanSel = id;
    const idx = stageIdx(x.stage);
    const doc = A.oceanDoc(x);
    const left = freeLeft(x, s.today);
    const lane = A.C.LANES.find((l) => l.from === x.lane.from && l.to === x.lane.to) || x.lane;

    const tl = STAGES.map(function (st, i) {
      const done = i < idx, now = i === idx;
      let date = '';
      if (st.id === 'S01') date = x.etd && dt.add(x.etd, -6);
      else if (st.id === 'S02') date = x.etd;
      else if (st.id === 'S03') date = etaOf(x);
      else if (st.id === 'S04') date = (x.actualEta ? dt.add(x.actualEta, 2) : '');
      else date = x.stage === 'REC' ? dt.add(etaOf(x), 3) : '';
      return '<div class="tl-i ' + (done ? 'done' : now ? 'now' : '') + '">' +
        '<div class="t"><b>' + st.id + ' ' + st.name + '</b><span class="d">' + (date || '待定') + '</span></div>' +
        '<div class="d2">' + stageDesc(st.id, x) + '</div></div>';
    }).join('');

    const docs = A.C.DOCS.map(function (d) {
      const on = x.docList[d.id];
      const due = d.stage <= doc.stageIdx;
      const cls = on ? 'on' : due ? 'miss' : '';
      return '<div class="chk-i ' + cls + '" data-doc="' + d.id + '" style="cursor:pointer' + (!on && !due ? ';opacity:.55' : '') + '">' +
        '<span class="bx">✓</span><span class="lbl">' + d.name + '</span>' +
        '<span class="dt">' + (on ? '已回执' : due ? '缺 · 到期' : '待回执') + '</span></div>';
    }).join('');

    const html =
      '<div class="drawer-h"><div style="min-width:0"><h2>' + x.id + '</h2>' +
      '<p>' + x.carrier + ' · ' + x.vessel + ' · ' + x.voyage + '</p></div><span class="sp"></span>' +
      '<button class="icon-btn" data-x="close" aria-label="关闭">✕</button></div>' +
      '<div class="drawer-b">' +
      '<div class="row row--tight">' +
      '<span class="tag tag--blue">' + x.box + ' · ' + x.type + '</span>' +
      '<span class="tag tag--plain">' + x.model + ' ×' + x.units + '</span>' +
      '<span class="tag ' + (tone(x, s.today) === 'ok' ? 'tag--green' : tone(x, s.today) === 'warn' ? 'tag--amber' : 'tag--red') + '">' +
      (left < 0 ? '免期已超 ' + Math.abs(left) + ' 天' : '免期剩 ' + left + ' 天') + '</span>' +
      (doc.missingDue.length ? '<span class="tag tag--red">到期缺 ' + doc.missingDue.length + ' 单证</span>' : '<span class="tag tag--green">到期单证齐</span>') +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div><div class="sec-t">航线</div><div class="kv">' +
      '<dt>起运港</dt><dd>' + A.C.PORTS[x.lane.from].code + ' · ' + A.C.PORTS[x.lane.from].name + '</dd>' +
      '<dt>卸货港</dt><dd>' + A.C.PORTS[x.lane.to].code + ' · ' + A.C.PORTS[x.lane.to].name + '</dd>' +
      '<dt>路径</dt><dd>' + (lane.name || '') + '</dd>' +
      '<dt>海上天数</dt><dd>' + lane.days + ' 天</dd>' +
      '</div></div>' +
      '<div><div class="sec-t">时间</div><div class="kv">' +
      '<dt>开船 ETD</dt><dd>' + x.etd + '</dd>' +
      '<dt>冻结 ETA</dt><dd>' + x.eta + '</dd>' +
      '<dt>最新预测</dt><dd style="color:' + (dt.diff(x.eta, x.freezeEta) ? 'var(--amber)' : 'var(--txt)') + '">' + x.freezeEta + '</dd>' +
      '<dt>实际到港</dt><dd>' + (x.actualEta || '—') + '</dd>' +
      '</div></div></div>' +

      '<div><div class="sec-t">流程 <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">' +
      STAGES[idx].id + ' ' + STAGES[idx].short + '</span></div><div class="tl">' + tl + '</div></div>' +

      '<div><div class="sec-t">单证与回执 <span class="sp"></span>' +
      '<span class="muted" style="text-transform:none;letter-spacing:0">到期 ' + doc.have + '/' + doc.due + ' · 可点选补录</span></div>' +
      '<div class="chk">' + docs + '</div></div>' +

      '<div><div class="sec-t">费用临界</div>' +
      '<div class="kv" style="font-size:11.5px">' +
      '<dt>免箱 / 免仓期</dt><dd>' + x.freeDays + ' 天（自到港日计）</dd>' +
      '<dt>免期到期日</dt><dd style="color:' + (left < 0 ? 'var(--red)' : left <= 2 ? 'var(--amber)' : 'var(--txt)') + '">' + dt.add(etaOf(x), x.freeDays) + '</dd>' +
      '<dt>滞箱费率</dt><dd>' + fmt.usd(x.demurragePerDay) + ' / 天 / 柜</dd>' +
      '<dt>若明日仍未提</dt><dd style="color:' + (left - 1 < 0 ? 'var(--red)' : 'var(--txt)') + '">' + (left - 1 < 0 ? '将产生 ' + fmt.usd(x.demurragePerDay) + '／天' : '仍在免期内') + '</dd>' +
      '<dt>货值（估算）</dt><dd>' + fmt.usd(x.valueUsd) + '</dd>' +
      '</div></div>' +

      '<div style="display:flex;gap:8px;padding:10px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line-soft)">' +
      '<span class="dot dot--' + (doc.missingDue.length ? 'amber' : 'green') + '" style="margin-top:2px"></span>' +
      '<div style="font-size:11px;line-height:1.55;color:var(--txt-2)">' +
      (doc.missingDue.length
        ? '到期缺失：<b>' + doc.missingDueNames.join('、') + '</b>。到港通知不能代替任何放行；缺件时先进异常，不排提柜。'
        : '本环节到期单证齐备。仍须逐项核监管放行、船方放货与场站可提，三项缺一不派车。') +
      '</div></div>' +
      '</div>' +
      '<div class="drawer-f">' +
      (idx > 0 ? '<button class="btn btn--sm btn--ghost" data-x="back">退回 ' + STAGES[idx - 1].id + '</button>' : '') +
      '<span class="sp"></span>' +
      (idx < STAGES.length - 1 ? '<button class="btn btn--prime btn--sm" data-x="next">推进到 ' + STAGES[idx + 1].id + ' · ' + STAGES[idx + 1].short + '</button>'
        : '<button class="btn btn--sm" disabled>已入仓</button>') +
      '</div>';

    A.drawer.open(html, {
      onMount: function (d) {
        d.querySelector('[data-x="close"]').addEventListener('click', function () { A.drawer.close(); markSel(null); });
        const nx = d.querySelector('[data-x="next"]');
        if (nx) nx.addEventListener('click', function () { advance(x.id, 1); });
        const bk = d.querySelector('[data-x="back"]');
        if (bk) bk.addEventListener('click', function () { advance(x.id, -1); });
        d.querySelectorAll('[data-doc]').forEach(function (n) {
          n.addEventListener('click', function () {
            const x2 = A.app.state.ocean.find((y) => y.id === x.id);
            const id2 = n.dataset.doc;
            x2.docList[id2] = !x2.docList[id2];
            x2.missing = A.C.DOCS.filter((dd) => !x2.docList[dd.id]).map((dd) => dd.id);
            x2.docPct = (A.C.DOCS.length - x2.missing.length) / A.C.DOCS.length;
            A.store.set({ ocean: A.app.state.ocean });
            A.drawer.close();
            openDrawer(x.id);
          });
        });
      }
    });
  }

  function stageDesc(id, x) {
    if (id === 'S01') return '核贸易术语、进口人、港口、指定仓与费用；截单截货时点各留回执。';
    if (id === 'S02') return '按 SN 关联件号与实测包装；记录箱封、VGM、ISF 与实际船名航次。';
    if (id === 'S03') return '按提单查到货通知与监管状态；普通提离三项缺一不派车。';
    if (id === 'S04') return '整柜取 EIR 并还空；拼箱凭分单提已拆齐件；仓按 ASN 逐 SN 签收。';
    return '已验合格台进入可用库存；缺损台隔离并交异常负责人。';
  }

  function markSel(id) {
    A.app.state.ui.oceanSel = id;
    A.store.emit();
  }

  function advance(id, dir) {
    const s = A.app.state;
    const x = s.ocean.find((y) => y.id === id);
    if (!x) return;
    const idx = stageIdx(x.stage);
    const ni = idx + dir;
    if (ni < 0 || ni >= STAGES.length) return;
    if (dir > 0) {
      const need = x.stage === 'S03' ? ['arrival', 'release'] : x.stage === 'S04' ? ['asn', 'eir'] : [];
      const missing = need.filter((k) => !x.docList[k]);
      if (missing.length) {
        if (!confirm('缺少：' + missing.map((m) => (A.C.DOCS.find((d) => d.id === m) || {}).name).join('、') +
          '\n\n现实作业中应先补证。仍要强制推进吗？（会记入异常备注）')) return;
        x.note = (x.note ? x.note + '；' : '') + '缺证强制推进 ' + STAGES[ni].id;
      }
      if (x.stage === 'S02' && !x.actualEta) x.actualEta = dt.add(x.freezeEta, 0);
      if (x.stage === 'S03' && !x.docList.eir) x.docList.eir = true;
      if (STAGES[ni].id === 'S04') { x.docList.arrival = true; x.docList.release = true; }
      if (STAGES[ni].id === 'REC') { x.docList.asn = true; x.docList.eir = true; }
    }
    x.stage = STAGES[ni].id;
    x.missing = A.C.DOCS.filter((d) => !x.docList[d.id]).map((d) => d.id);
    x.docPct = (A.C.DOCS.length - x.missing.length) / A.C.DOCS.length;
    A.store.set({ ocean: s.ocean });
    A.toast(x.id + ' → ' + STAGES[ni].id + ' ' + STAGES[ni].short, STAGES[ni].tone === 'green' ? 'green' : 'teal');
    if (A.drawer.isOpen()) { A.drawer.close(); setTimeout(() => openDrawer(id), 260); }
  }

  /* ── view ────────────────────────────────────────────────────────── */
  A.registerView('ocean', {
    title: '海运在途看板',
    sub: 'S01 订舱 → S02 海上 → S03 到港 → S04 提柜 → 入仓交班 · 支持拖拽推进',

    mount: function (host, s) {
      host.innerHTML =
        '<div class="ocean-shell">' +
        '<div class="ocean-bar" id="oceanBar"></div>' +
        '<div class="ocean-kpis" id="oceanKpis"></div>' +
        '<div style="flex:1;min-height:0;display:flex;flex-direction:column">' +
        '<div class="kanban" id="kanban"></div>' +
        '</div>' +
        '<div style="flex:none;padding:0 14px 12px"><div class="card"><div class="card-h" style="padding:8px 12px">' +
        '<h3 style="font-size:11.5px">到港与免期窗口 <span class="k">未来 24 天</span></h3><span class="sp"></span>' +
        '<div class="row row--tight"><span class="legend-row"><i class="sw" style="background:var(--blue)"></i>在免期内</span>' +
        '<span class="legend-row" style="margin-left:8px"><i class="sw" style="background:var(--amber)"></i>≤2 天</span>' +
        '<span class="legend-row" style="margin-left:8px"><i class="sw" style="background:var(--red)"></i>已超期</span></div></div>' +
        '<div class="card-b card-b--tight" id="oceanGantt" style="height:126px;overflow:hidden"></div></div></div>' +
        '</div>';

      const kb = document.getElementById('kanban');
      let dragId = null;
      kb.addEventListener('dragstart', function (e) {
        const c = e.target.closest('.kcard');
        if (!c) return;
        dragId = c.dataset.id;
        c.classList.add('is-drag');
        try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (x) { }
      });
      kb.addEventListener('dragend', function (e) {
        const c = e.target.closest('.kcard');
        if (c) c.classList.remove('is-drag');
        document.querySelectorAll('.kcol').forEach((k) => k.classList.remove('is-over'));
      });
      kb.addEventListener('dragover', function (e) {
        const col = e.target.closest('.kcol');
        if (!col || !dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.kcol').forEach((k) => k.classList.toggle('is-over', k === col));
      });
      kb.addEventListener('drop', function (e) {
        const col = e.target.closest('.kcol');
        if (!col || !dragId) return;
        e.preventDefault();
        const target = col.dataset.stage;
        const st = A.app.state;
        const x = st.ocean.find((y) => y.id === dragId);
        if (!x) return;
        const cur = stageIdx(x.stage), to = stageIdx(target);
        if (to === cur) { col.classList.remove('is-over'); dragId = null; return; }
        if (Math.abs(to - cur) > 1) {
          A.toast('只能逐环节推进；跳过环节会丢失回执', 'red');
        } else {
          advance(dragId, to > cur ? 1 : -1);
        }
        col.classList.remove('is-over');
        dragId = null;
      });
      kb.addEventListener('click', function (e) {
        const c = e.target.closest('.kcard');
        if (!c) return;
        A.app.state.ui.oceanSel = c.dataset.id;
        openDrawer(c.dataset.id);
      });

      const bar = document.getElementById('oceanBar');
      bar.addEventListener('click', function (e) {
        const t = e.target.closest('[data-act]');
        if (!t) return;
        const st = A.app.state;
        if (t.dataset.act === 'stage') { st.ui.oceanFilter = t.dataset.v; A.store.emit(); }
        else if (t.dataset.act === 'missing') { st.ui.oceanMissing = !st.ui.oceanMissing; A.store.emit(); }
        else if (t.dataset.act === 'export') exportCsv(st);
      });
      bar.addEventListener('change', function (e) {
        if (e.target.id === 'oceanPort') { A.app.state.ui.oceanPort = e.target.value; A.store.emit(); }
      });
      bar.addEventListener('input', function (e) {
        if (e.target.id === 'oceanSearch') { A.app.state.ui.oceanQ = e.target.value; A.store.emit(); }
      });
    },

    update: function (s, params) {
      if (params && params.port) s.ui.oceanPort = params.port;
      const st = s.ui;
      const k = kpis(s);

      /* bar */
      const counts = {};
      STAGES.forEach(function (x) { counts[x.id] = s.ocean.filter((y) => y.stage === x.id).length; });
      document.getElementById('oceanBar').innerHTML =
        '<div class="seg">' +
        '<button data-act="stage" data-v="ALL" aria-pressed="' + (st.oceanFilter === 'ALL' || !st.oceanFilter) + '">全部 <span class="n">' + s.ocean.length + '</span></button>' +
        STAGES.map(function (x) {
          return '<button data-act="stage" data-v="' + x.id + '" aria-pressed="' + (st.oceanFilter === x.id) + '">' + x.short + ' <span class="n">' + counts[x.id] + '</span></button>';
        }).join('') + '</div>' +
        '<select class="select" id="oceanPort" style="width:auto">' +
        '<option value="ALL">全部目的港</option>' +
        Object.keys(A.C.PORTS).filter((p) => !A.C.PORTS[p].cn).map(function (p) {
          return '<option value="' + p + '"' + (st.oceanPort === p ? ' selected' : '') + '>' + p + ' · ' + A.C.PORTS[p].name + '</option>';
        }).join('') + '</select>' +
        '<button class="pill' + (st.oceanMissing ? ' is-on' : '') + '" data-act="missing">只看缺单证</button>' +
        '<div class="search" style="margin-left:auto;width:190px"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>' +
        '<input class="input" id="oceanSearch" placeholder="箱号 / 船名" value="' + A.esc(st.oceanQ || '') + '"></div>' +
        '<button class="btn btn--sm" data-act="export">导出 CSV</button>';

      /* kpis */
      document.getElementById('oceanKpis').innerHTML =
        kpi('未入仓航次', k.boxes, '个', 'var(--blue)', '含已到港待提') +
        kpi('海上台数', fmt.n(k.sea), '台', 'var(--teal)', 'S02 在途') +
        kpi('到港待提', fmt.n(k.wait), '台', 'var(--violet)', 'S03 / S04 已靠港') +
        kpi('免期告警', k.demo.length, '航次', k.demo.length ? 'var(--red)' : 'var(--green)', '≤2 天或已超期') +
        kpi('缺项单证', k.missDocs, '份', k.missDocs ? 'var(--amber)' : 'var(--green)', '本环节到期未回执');

      /* columns */
      const q = (st.oceanQ || '').trim().toLowerCase();
      const list = s.ocean.filter(function (x) {
        if (st.oceanFilter && st.oceanFilter !== 'ALL' && x.stage !== st.oceanFilter) return false;
        if (st.oceanPort && st.oceanPort !== 'ALL' && x.lane.to !== st.oceanPort) return false;
        if (st.oceanMissing && !x.missing.length) return false;
        if (q && !(x.id + ' ' + x.vessel + ' ' + x.carrier + ' ' + x.voyage).toLowerCase().includes(q)) return false;
        return true;
      });

      document.getElementById('kanban').innerHTML = STAGES.map(function (stage) {
        const items = list.filter((x) => x.stage === stage.id);
        const unitsSum = items.reduce((a, x) => a + x.units, 0);
        const accent = stage.tone === 'green' ? 'var(--green)' : stage.tone === 'blue' ? 'var(--blue)' : stage.tone === 'amber' ? 'var(--amber)' : stage.tone === 'violet' ? 'var(--violet)' : 'var(--txt-3)';
        return '<div class="kcol" data-stage="' + stage.id + '">' +
          '<div class="kcol-h"><i class="bar" style="background:' + accent + '"></i>' +
          '<b>' + stage.id + ' ' + stage.name + '</b><span class="cnt">' + items.length + ' 票 · ' + unitsSum + ' 台</span></div>' +
          '<div class="kcol-b">' + (items.map((x) => card(x, s.today)).join('') ||
            '<div class="kempty">' + (stage.id === 'REC' ? '尚无入仓批次' : '此环节暂无航次') + '</div>') + '</div></div>';
      }).join('');

      document.getElementById('oceanGantt').innerHTML = gantt(s);
    }
  });

  function kpi(lab, v, unit, color, meta) {
    return '<div class="ocean-kpi"><div class="lab">' + lab + '</div>' +
      '<div class="v" style="color:' + color + '">' + v + '<small>' + unit + '</small></div>' +
      '<div style="font-size:9.5px;color:var(--txt-3)">' + meta + '</div></div>';
  }

  function exportCsv(s) {
    const head = ['航次', '承运人', '船名', '航次号', '箱型', '起运港', '卸货港', '阶段', '开船', '冻结ETA', '实际到港', '免期天数', '免期到期', '台数', '型号', '入仓节点', '缺项单证'];
    const rows = s.ocean.map(function (x) {
      return [x.id, x.carrier, x.vessel, x.voyage, x.box, x.lane.from, x.lane.to, x.stage, x.etd, x.eta,
      x.actualEta || '', x.freeDays, dt.add(etaOf(x), x.freeDays), x.units, x.model, x.nodeId,
      x.missing.map((m) => (A.C.DOCS.find((d) => d.id === m) || {}).name).join(' ')];
    });
    const csv = '\ufeff' + [head].concat(rows).map((r) => r.map(function (c) {
      const v = String(c == null ? '' : c);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'atlas-ocean-' + s.today + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    A.toast('已导出 ' + s.ocean.length + ' 个航次', 'teal');
  }
})(window);
