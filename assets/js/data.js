/* ==========================================================================
   data.js — ATLAS business model + deterministic demo dataset
   Rates, service codes and constraints are transcribed from the V12 plan.
   Every order / shipment below is synthetic and generated from a fixed seed.
   ========================================================================== */
(function (w) {
  'use strict';
  const A = w.A;
  A.SEED_VERSION = 'atlas-1.0-r7';

  /* ── 1. 型号 ──────────────────────────────────────────────────────── */
  const CM2IN = 0.393701;
  const MODELS = {
    M01: { id: 'M01', name: '标准双门柜', l: 85, w: 69, h: 206, kg: 112.5, note: '虽较轻，仍须使用适配搬运设备', risk: 'low' },
    M02: { id: 'M02', name: '宽体冷藏柜', l: 84, w: 82, h: 218, kg: 159, note: '车门、货梯和最终入口净高必须逐段核', risk: 'high' },
    M03: { id: 'M03', name: '高箱冷藏柜', l: 97, w: 74, h: 214, kg: 184, note: '带托高度已超过 84 英寸限高', risk: 'high' },
    M04: { id: 'M04', name: '长底座柜', l: 147, w: 80, h: 212, kg: 206, note: '57.9 英寸长底座，尾板有效面积与转角是关键', risk: 'high' },
    M05: { id: 'M05', name: '双仓组合柜', l: 89, w: 81, h: 209, kg: 142, note: '核对拆托位置与工具举升后净空', risk: 'mid' },
    M06: { id: 'M06', name: '深体综合柜', l: 83.5, w: 94, h: 223, kg: 164, note: '最高、包装最深，逐段核车门与货梯', risk: 'high' },
    M07: { id: 'M07', name: '标准单门柜', l: 84, w: 79, h: 207, kg: 126, note: '底托固定与室内搬运路径为主', risk: 'low' }
  };
  Object.values(MODELS).forEach(function (m) {
    m.hin = +(m.h * CM2IN).toFixed(1);
    m.cuft = +((m.l * CM2IN) * (m.w * CM2IN) * (m.h * CM2IN) / 1728).toFixed(1);
    m.lbin = Math.round(m.kg * 2.20462);
    m.over84 = m.hin > 84;
    m.sqm = (m.l / 100) * (m.w / 100);
    // 40HQ floor plan, non-stackable, allowing lashing gaps
    m.per40 = Math.min(26, Math.max(12, Math.floor(28.3 / (m.sqm * 1.34))));
  });

  /* ── 2. 服务档 L1–L5 / 路径 A–C ──────────────────────────────────── */
  const LEVELS = {
    L1: { code: 'L1', name: '基础交接', short: '月台 / 车边', reach: '指定月台、允许卸货区或双方约定地面', need: '谁卸、谁供叉车或尾板、是否留托盘', factor: 0.58 },
    L2: { code: 'L2', name: '入口交付', short: '一道门', reach: '指定楼门、车库或一道门槛', need: '哪道门、跨不跨门槛、停车点距离', factor: 0.78 },
    L3: { code: 'L3', name: '室内机位', short: '机位就位', reach: '指定房间或营业机位', need: '脱托、拆箱、移动、摆位、调平、清运逐项勾选', factor: 1.0 }
  };
  const ADDONS = {
    L4: { code: 'L4', name: '特殊通道', fee: 115, note: '楼梯、台阶、窄转角、地下室等专项搬运' },
    L5: { code: 'L5', name: '技术启用', fee: 60, note: '装配、联网、绑机、支付或功能测试，另开技术工单' }
  };
  const PATHS = {
    A: { code: 'A', name: '自提 / 普通卡派', short: '自提 / 卡派', tone: 'plain', who: '客户车 / 普通货运平台' },
    B: { code: 'B', name: '原仓直提直送', short: '直提直送', tone: 'teal', who: '专业车组（白手套）' },
    C1: { code: 'C1', name: '经站 · 主承统包', short: '经站统包', tone: 'violet', who: '一家主承方覆盖三段' },
    C2: { code: 'C2', name: '经站 · 分段采购', short: '经站分采', tone: 'blue', who: '干线 / 站方 / 二程分别委托' }
  };

  /* ── 3. 费率卡（美元） ────────────────────────────────────────────── */
  const RATE = {
    // 达拉斯 DFW-Q01 样单锚定的三套末端价（L3 单台 / 同址加台）
    route: { first: 365, extra: 145 },   // 现有多点路线，本单作为其中一站
    direct: { first: 310, extra: 100 },   // B 现仓直提新价
    station: { first: 225, extra: 85 },   // C2 站至最终机位（二程）
    outbound: 15,          // 原仓出库 / 台
    stop: 20,              // 停车 / 站
    linehaulMin: 120,      // 原仓到站最低干线
    linehaulPerMile: 1.9,
    stationHandling: 22,   // 收发 / 台
    storagePerUnitDay: 3,  // 站内短存 / 台日
    storageDaysDefault: 2,
    thirdPartyPickup: 50,
    c1Premium: 1.06,       // 统包相对分采的协作溢价
    lxdZone: {
      A: { min: 10, wg: 250, th: 150 }, B: { min: 20, wg: 250, th: 150 },
      C: { min: 30, wg: 250, th: 150 }, D: { min: 45, wg: 300, th: 200 },
      E: { min: 60, wg: 300, th: 200 }, F: { min: 75, wg: 400, th: 250 },
      G: { min: 120, wg: 450, th: 350 }, H: { min: 180, wg: 500, th: 400 },
      I: { min: 240, wg: 550, th: 500 }
    },
    lxd: { receive: 30, inspect: 15, freeDays: 15, perDay: 1, thirdParty: 50, stair: 50 },
    longroad: {
      devan20: { pallet: 250, floor: 500, skid: 300 },
      devan40: { pallet: 350, floor: 700, skid: 500 },
      inbound: 25, palletIn: 10, reworkHour: 50,
      rack: 16, floor: 22, bin: 4.5, setup: 250, shopPerMonth: 25, minMonthly: 500
    },
    service: {
      nasdaq: 0,
      repair: { resqCall: 260, resqHour: 130, otFactor: 1.5, nodakFirst: 150, nodakHalf: true, perMile: 3 },
      selfFleet: { wage: 24.17, burden: 1.25, hours: 6, crew: 2, vehicle: 140, fuel: 40, consumables: 20 }
    },
    carrierLimits: {
      fedexFreightDirect: { maxH: 75, label: 'FedEx Freight Direct 标准单件限高 75 in' },
      estes: { maxH: 84, maxLb: 1500, label: 'Estes Front Door 60×48×84 in / 1,500 lb' },
      odfl: { maxH: 84, label: 'ODFL Inside 限约定位置，尾板/拆箱另购' }
    }
  };

  /* ── 4. 节点（仓与区域站） ───────────────────────────────────────── */
  const NODES = [
    { id: 'DAL', name: 'Dallas 现仓', city: 'Dallas', st: 'TX', zip: '75236', lat: 32.6875, lng: -96.9417, kind: 'inv', pilot: true, caps: ['仓内收发', '白手套直提', '当地配送', '第三方提货'], label: '试点主仓' },
    { id: 'HOU', name: 'Houston 合作仓', city: 'Houston', st: 'TX', zip: '77032', lat: 29.9511, lng: -95.3661, kind: 'inv', caps: ['仓内收发', '白手套直提', '当地配送'], label: '得州东部' },
    { id: 'HAY', name: 'Hayward 合作仓', city: 'Hayward', st: 'CA', zip: '94544', lat: 37.6688, lng: -122.0808, kind: 'inv', caps: ['仓内收发', '白手套直提', '当地配送'], label: '湾区' },
    { id: 'PAR', name: 'Paramount 合作仓', city: 'Paramount', st: 'CA', zip: '90723', lat: 33.8895, lng: -118.1598, kind: 'inv', caps: ['仓内收发', '白手套直提', '当地配送'], label: '洛杉矶港后' },
    { id: 'AUR', name: 'Aurora 合作仓', city: 'Aurora', st: 'IL', zip: '60502', lat: 41.7606, lng: -88.3201, kind: 'inv', caps: ['仓内收发', '白手套直提', '当地配送'], label: '中西部' },
    { id: 'LAK', name: 'Lakeland 合作仓', city: 'Lakeland', st: 'FL', zip: '33801', lat: 28.0395, lng: -81.9498, kind: 'inv', caps: ['仓内收发', '白手套直提', '当地配送'], label: '佛州' },
    { id: 'NJE', name: 'Elizabethport 区域站', city: 'Elizabethport', st: 'NJ', zip: '07206', lat: 40.6501, lng: -74.1907, kind: 'stn', zone: 'C', caps: ['接收', '选检', '短存', '二程'], label: 'LXD 东部' },
    { id: 'MDV', name: 'Rockville 区域站', city: 'Rockville', st: 'MD', zip: '20850', lat: 39.0840, lng: -77.1528, kind: 'stn', zone: 'A', caps: ['接收', '短存', '二程'], label: 'LXD 首都圈' },
    { id: 'FLL', name: 'Fort Lauderdale 区域站', city: 'Fort Lauderdale', st: 'FL', zip: '33309', lat: 26.1224, lng: -80.1373, kind: 'stn', zone: 'B', caps: ['接收', '短存', '二程'], label: 'LXD 佛州' },
    { id: 'FIF', name: 'Fife 区域站', city: 'Fife', st: 'WA', zip: '98424', lat: 47.2393, lng: -122.3571, kind: 'stn', zone: 'G', caps: ['整柜拆柜', '托位', '短存'], label: 'Long Road 西北' }
  ];

  /* ── 5. 港口与海运航线 ───────────────────────────────────────────── */
  const PORTS = {
    SHA: { code: 'SHA', name: '上海', en: 'Shanghai', lat: 31.2304, lng: 121.4737, cn: true },
    NGB: { code: 'NGB', name: '宁波', en: 'Ningbo', lat: 29.8683, lng: 121.5440, cn: true },
    YTN: { code: 'YTN', name: '盐田', en: 'Yantian', lat: 22.5431, lng: 114.0579, cn: true },
    TAO: { code: 'TAO', name: '青岛', en: 'Qingdao', lat: 36.0671, lng: 120.3826, cn: true },
    LGB: { code: 'LGB', name: '洛杉矶 / 长滩', en: 'Los Angeles / Long Beach', lat: 33.7542, lng: -118.2165, cn: false, node: 'PAR' },
    NYC: { code: 'NYC', name: '纽约 / 纽瓦克', en: 'New York / Newark', lat: 40.6676, lng: -74.1503, cn: false, node: 'NJE' },
    SAV: { code: 'SAV', name: '萨凡纳', en: 'Savannah', lat: 32.0809, lng: -81.0912, cn: false, node: 'LAK' },
    HOU: { code: 'HOU', name: '休斯敦', en: 'Houston', lat: 29.7355, lng: -95.2666, cn: false, node: 'HOU' },
    SEA: { code: 'SEA', name: '西雅图 / 塔科马', en: 'Seattle / Tacoma', lat: 47.2640, lng: -122.4110, cn: false, node: 'FIF' }
  };
  const LANES = [
    { from: 'SHA', to: 'LGB', days: 18, name: '跨太平洋 · 美西' },
    { from: 'NGB', to: 'LGB', days: 19, name: '跨太平洋 · 美西' },
    { from: 'YTN', to: 'NYC', days: 34, name: '经巴拿马 · 美东' },
    { from: 'TAO', to: 'SEA', days: 15, name: '北太平洋 · 西北' },
    { from: 'SHA', to: 'SAV', days: 32, name: '经巴拿马 · 东南' },
    { from: 'NGB', to: 'HOU', days: 30, name: '经巴拿马 · 墨西哥湾' }
  ];
  const CARRIERS = ['Matson', 'ONE', 'COSCO', 'Evergreen', 'Maersk', 'CMA CGM', 'Hapag-Lloyd', 'Yang Ming'];
  const VESSELS = ['MATSON WAIKIKI', 'ONE CONTENDER', 'COSCO SHIPPING ROSE', 'EVER GIVEN', 'MAERSK EINDHOVEN',
    'CMA CGM BENJAMIN FRANKLIN', 'HAPAG BERLIN EXPRESS', 'YM WITNESS', 'MATSON KAUAI', 'ONE HARMONY',
    'COSCO TAICANG', 'EVER GENIUS', 'MAERSK SALTORO', 'YM WELLSPRING'];

  /* ── 6. 目的地区域（按节点分群，用于地图铺点与派车） ─────────────── */
  const AREAS = [
    ['DAL', 'Dallas', 'TX', '75201', 32.7767, -96.7970, 9], ['DAL', 'Fort Worth', 'TX', '76102', 32.7555, -97.3308, 45],
    ['DAL', 'Plano', 'TX', '75024', 33.0198, -96.6989, 22], ['DAL', 'Arlington', 'TX', '76011', 32.7357, -97.1081, 27],
    ['DAL', 'Irving', 'TX', '75061', 32.8140, -96.9489, 16], ['DAL', 'Garland', 'TX', '75040', 32.9126, -96.6389, 18],
    ['DAL', 'McKinney', 'TX', '75070', 33.1972, -96.6397, 38], ['DAL', 'Denton', 'TX', '76201', 33.2148, -97.1331, 41],
    ['HOU', 'Houston', 'TX', '77002', 29.7604, -95.3698, 9], ['HOU', 'Sugar Land', 'TX', '77479', 29.6197, -95.6349, 27],
    ['HOU', 'Katy', 'TX', '77449', 29.7858, -95.8244, 33], ['HOU', 'The Woodlands', 'TX', '77380', 30.1658, -95.4615, 28],
    ['HAY', 'Hayward', 'CA', '94544', 37.6688, -122.0808, 4], ['HAY', 'Oakland', 'CA', '94607', 37.8044, -122.2712, 17],
    ['HAY', 'San Jose', 'CA', '95112', 37.3382, -121.8863, 32], ['HAY', 'Fremont', 'CA', '94538', 37.5485, -121.9886, 12],
    ['HAY', 'San Francisco', 'CA', '94107', 37.7749, -122.4194, 28], ['HAY', 'Sacramento', 'CA', '95814', 38.5816, -121.4944, 92],
    ['PAR', 'Los Angeles', 'CA', '90015', 34.0522, -118.2437, 9], ['PAR', 'Long Beach', 'CA', '90802', 33.7701, -118.1937, 11],
    ['PAR', 'Anaheim', 'CA', '92805', 33.8366, -117.9143, 25], ['PAR', 'Irvine', 'CA', '92618', 33.6846, -117.8265, 39],
    ['PAR', 'Riverside', 'CA', '92501', 33.9806, -117.3755, 56], ['PAR', 'San Diego', 'CA', '92101', 32.7157, -117.1611, 118],
    ['AUR', 'Aurora', 'IL', '60502', 41.7606, -88.3201, 4], ['AUR', 'Chicago', 'IL', '60607', 41.8781, -87.6298, 39],
    ['AUR', 'Naperville', 'IL', '60540', 41.7508, -88.1535, 12], ['AUR', 'Schaumburg', 'IL', '60173', 42.0334, -88.0834, 31],
    ['LAK', 'Lakeland', 'FL', '33801', 28.0395, -81.9498, 4], ['LAK', 'Tampa', 'FL', '33602', 27.9506, -82.4572, 34],
    ['LAK', 'Orlando', 'FL', '32801', 28.5383, -81.3792, 56], ['LAK', 'Sarasota', 'FL', '34236', 27.3364, -82.5307, 62],
    ['NJE', 'New York', 'NY', '10001', 40.7506, -73.9972, 6], ['NJE', 'Brooklyn', 'NY', '11201', 40.6925, -73.9903, 13],
    ['NJE', 'Newark', 'NJ', '07102', 40.7357, -74.1724, 5], ['NJE', 'Jersey City', 'NJ', '07302', 40.7178, -74.0431, 8],
    ['NJE', 'Philadelphia', 'PA', '19106', 39.9526, -75.1652, 88], ['NJE', 'Hartford', 'CT', '06103', 41.7658, -72.6734, 122],
    ['NJE', 'Boston', 'MA', '02108', 42.3601, -71.0589, 224],
    ['MDV', 'Rockville', 'MD', '20850', 39.0840, -77.1528, 3], ['MDV', 'Washington', 'DC', '20001', 38.9072, -77.0369, 21],
    ['MDV', 'Baltimore', 'MD', '21201', 39.2904, -76.6122, 41], ['MDV', 'Arlington', 'VA', '22201', 38.8816, -77.0910, 18],
    ['MDV', 'Richmond', 'VA', '23219', 37.5407, -77.4360, 112],
    ['FLL', 'Fort Lauderdale', 'FL', '33309', 26.1224, -80.1373, 4], ['FLL', 'Miami', 'FL', '33130', 25.7617, -80.1918, 28],
    ['FLL', 'Boca Raton', 'FL', '33432', 26.3683, -80.1289, 17], ['FLL', 'West Palm Beach', 'FL', '33401', 26.7153, -80.0534, 39],
    ['FIF', 'Fife', 'WA', '98424', 47.2393, -122.3571, 3], ['FIF', 'Seattle', 'WA', '98101', 47.6062, -122.3321, 27],
    ['FIF', 'Tacoma', 'WA', '98402', 47.2529, -122.4443, 7], ['FIF', 'Bellevue', 'WA', '98004', 47.6101, -122.2015, 33],
    ['FIF', 'Portland', 'OR', '97204', 45.5152, -122.6784, 137]
  ];

  const CITY_LABELS = {
    Dallas: 1, Houston: 1, 'Los Angeles': 1, Chicago: 1, 'New York': 1, Seattle: 1, Atlanta: 1,
    Denver: 1, Phoenix: 1, Miami: 1, Boston: 1, Philadelphia: 1, Detroit: 1, Minneapolis: 1,
    'Salt Lake City': 1, 'Kansas City': 1, Memphis: 1, Nashville: 1, Charlotte: 1, Orlando: 1,
    Tampa: 1, Pittsburgh: 1, Cleveland: 1, 'St. Louis': 1, 'Las Vegas': 1, 'San Antonio': 1,
    Austin: 1, 'Oklahoma City': 1, Omaha: 1, Indianapolis: 1, Columbus: 1, Cincinnati: 1,
    Milwaukee: 1, 'New Orleans': 1, Jacksonville: 1, Raleigh: 1, Baltimore: 1, Portland: 1,
    Sacramento: 1, Fresno: 1, 'El Paso': 1, Tucson: 1, Albuquerque: 1, 'Des Moines': 1
  };

  /* ── 7. 海运文档与阶段 ───────────────────────────────────────────── */
  const OCEAN_STAGES = [
    { id: 'S01', name: '订舱与截单', short: '订舱', tone: 'plain' },
    { id: 'S02', name: '装运与在途', short: '海上', tone: 'blue' },
    { id: 'S03', name: '到港与接运', short: '到港', tone: 'amber' },
    { id: 'S04', name: '提货入仓', short: '提货', tone: 'violet' },
    { id: 'REC', name: '已入仓交班', short: '入仓', tone: 'green' }
  ];
  const DOCS = [
    { id: 'booking', name: '订舱确认', stage: 0 },
    { id: 'packing', name: '装箱清单', stage: 0 },
    { id: 'invoice', name: '商业发票', stage: 0 },
    { id: 'isf', name: 'ISF 10+2 回执', stage: 1 },
    { id: 'vgm', name: 'VGM 核实总重', stage: 1 },
    { id: 'export', name: '出口报关放行', stage: 1 },
    { id: 'bl', name: '提单 B/L', stage: 1 },
    { id: 'arrival', name: '到货通知', stage: 2 },
    { id: 'release', name: '提货放行', stage: 2 },
    { id: 'eir', name: '提柜 EIR / 分单', stage: 3 },
    { id: 'asn', name: '到仓预报 ASN', stage: 3 },
    { id: 'empty', name: '还空 / 底盘回执', stage: 3 }
  ];

  /* ── 8. 岗位与作业码 ─────────────────────────────────────────────── */
  const STEPS = [
    { id: 'F01', name: '承接与定交接点', owner: '销售 / 客服', out: '终点、已购动作、窗口、责任人', gate: 'ZIP / 现场 / 动作超出价卡 → 采购逐票取价' },
    { id: 'F02', name: '锁合格 SN', owner: '库存计划 / 仓管', out: '可发 SN、库位、实测包装', gate: '待检、返修隔离、待件、争议 SN 一律不可锁' },
    { id: 'F03', name: '比同范围全价', owner: '采购 / 调度', out: '主备逐项全价、有效期、承接确认', gate: '缺车组、缺授权站、缺二程 → 退出本票', opts: ['A', 'B', 'C1', 'C2'] },
    { id: 'F04', name: '放货双确认', owner: '仓库 / 承运方', out: '提货码、车牌、窗口、装载边界', gate: '授权或车不符 → 不装、不交码' },
    { id: 'F05', name: '逐台签收回单', owner: '车组 / 订单专员', out: 'SN、终点、动作、照片、签字', gate: '2 小时内回传；失败回执可完整但不计成功交付' },
    { id: 'F06', name: '异常分诊', owner: '调度 / 售后', out: '保管人、停止作业、下一步', gate: '危险 / 货损 / 错 SN → 先停作业' },
    { id: 'F07', name: '技术启用与复测', owner: '售后 / 授权技师', out: '测试项、结果、客户确认', gate: '无 L5 则记“范围外”，不填技术结果' },
    { id: 'F08', name: '核账与关单', owner: '财务', out: '报价、批准变更、凭证、发票逐行匹配', gate: '未收票 / 未核 / 差异未解 → 不签费用达标' }
  ];
  const ROLES = [
    { role: '业务负责人 / 财务授权人', duty: '签城市、服务、预算、付款方与风险敞口', right: '新增固定费、超预算、扩量的最终签批' },
    { role: '销售 / 客户经理', duty: 'F01 分列交接点、后段责任、机型、数量、已购动作与期望窗', right: '授权价卡内报价；超范围报主管' },
    { role: '物流订单专员', duty: '工作时段 2 小时内认领；确认交接点与现场资料齐备', right: '缺项一次退销售，不先锁货' },
    { role: '库存计划 / 收货仓', duty: '按预报逐台扫 SN、拍四面、记库位与货况', right: '只锁已验合格且未被占用的 SN' },
    { role: '采购 / 调度', duty: '发同版询价、归集全价、签发中选委托、安排车组', right: '到截止仍缺全价或档期的候选退出本票' },
    { role: '车组 / 实际承运', duty: '按生效版本作业，回传到离场与实况', right: '进不去先停搬报调度，不临时让客户帮抬' },
    { role: '售后 / 工程', duty: 'F07 分诊、用件、复测、客户确认', right: '仅对已购或获授权的任务派工' },
    { role: '财务', duty: 'F08 核报价、批准变更、凭证与发票', right: '账差未解不签费用达标；签批次结论' }
  ];
  const CYCLES = [
    { id: 'P1', name: '明确启用范围', in: '业务签实名主备、权限、额度', out: '权限与回退办法经业务验收签名', pass: '控制失效即停新配置，保留原获准流程' },
    { id: 'P2', name: '已售订单备单', in: '现场、可发 SN、实测包装、同范围全价、执行方书面接受', out: '窗口双向确认后才排车放行', pass: '缺项退原提交岗' },
    { id: 'P3', name: '取得放货授权', in: '仓库按放货版交 SN', out: '每段接管、实作、时间与 POD 留痕', pass: '机型、包装或委托变化退 P2 重核' },
    { id: 'P4', name: '同批账证齐备', in: '基线、应计、发票与贷项对齐', out: '业务签停止、维持、收紧或扩大', pass: '缺样本或缺账 → 维持原范围，不签实绩' }
  ];
  const KPIS = [
    { id: 'ontime', name: '原窗口准时率', f: '原窗口内到场任务 ÷ 原窗口已到期应到任务', why: '未到场不能算准时；无原窗口另报' },
    { id: 'pod', name: 'POD 完整率', f: '有完整交付或失败凭证的任务 ÷ 应回传凭证任务', why: '缺交计不完整，失败回执可完整' },
    { id: 'damage', name: '货损率', f: '新增运输损伤台数 ÷ 同批实际经手台数', why: '同商同任务同 SN 只计一台' },
    { id: 'billing', name: '账单差异率', f: '有未获批差异的账单行 ÷ 已核账单行', why: '同时列差额，未核行单列' },
    { id: 'complaint', name: '交付投诉率', f: '有投诉的到期任务 ÷ 当月已派且到期任务', why: '同任务去重；拒收未到场不剔除' }
  ];
  const GATES = [
    { k: '样本与可追溯', line: '至少 20 票真实首派；全数结算、全数可还原' },
    { k: '范围与安全', line: '有效放行、已购服务保持、凭证完整率各 100%；未授权危险作业为 0' },
    { k: '同类服务与成本', line: '准时 / 首次成功率不低于现行路线；全成本净额 > 0 且无未解账差' },
    { k: '备选提额', line: '备选连续 10 票完整交付、无责任不明货损；整批达标并经业务与财务批准' }
  ];
  const EXC_TYPES = [
    { id: 'damage', name: '货损 / 外观异常', owner: '调度 + 索赔经办', sla: 4, stop: true },
    { id: 'noshowsign', name: '无人接收 / 拒收', owner: '调度', sla: 2, stop: true },
    { id: 'access', name: '进不去 / 通道不足', owner: '调度 + 销售', sla: 3, stop: true },
    { id: 'window', name: '客户改窗 / 改址', owner: '销售 + 订单专员', sla: 6, stop: false },
    { id: 'tech', name: '技术故障 / 需分诊', owner: '售后', sla: 8, stop: false },
    { id: 'doc', name: '单证缺失 / 错 SN', owner: '订单专员', sla: 3, stop: true },
    { id: 'hold', name: '超期短存 / 待指令', owner: '库存计划', sla: 24, stop: false }
  ];

  /* ── 9. 生成器 ────────────────────────────────────────────────────── */
  const TODAY = '2026-11-01';
  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const modelIds = Object.keys(MODELS);

  function levelFactor(level, l4) {
    return LEVELS[level].factor * (l4 ? 1.18 : 1);
  }
  function firstPrice(path, level, l4) {
    const card = path === 'B' ? RATE.direct : path === 'A' ? RATE.route : RATE.station;
    return Math.round(card.first * levelFactor(level, l4) / 5) * 5;
  }
  function extraPrice(path, level, l4) {
    const card = path === 'B' ? RATE.direct : path === 'A' ? RATE.route : RATE.station;
    return Math.round(card.extra * levelFactor(level, l4) / 5) * 5;
  }

  /**
   * Quote a path for an order-shaped object.
   * Returns null when the path cannot deliver the purchased scope.
   */
  function quote(o, path) {
    const m = MODELS[o.model];
    const units = o.units;
    const lines = [];
    let blocker = null;

    if (path === 'A') {
      if (o.l4) blocker = '楼梯 / 特殊通道：普通卡派不做专项搬运';
      else if (o.level === 'L3') blocker = 'L3 室内机位：普通货运止于月台或入口';
      else if (o.selfPickup) {
        lines.push({ k: '仓内装车（客户车）', amt: 35 * units, note: '客户自带适配车，我方仅装车' });
        lines.push({ k: '提货授权与仓口交接', amt: 0, note: '客户自担后段' });
        return { path, total: 35 * units, lines, blocker: null, feasibility: 'ok' };
      } else {
        lines.push({ k: '原仓出库', amt: RATE.outbound * units });
        lines.push({ k: '普通卡派 ' + (o.level === 'L2' ? '入口档' : '月台档'), amt: Math.round(Math.max(185, o.miles * 0.95)) });
        if (o.level === 'L2') lines.push({ k: '尾板 / 预约', amt: 45, note: '按实际动作另计' });
      }
      const total = A.sum(lines, (l) => l.amt);
      return { path, total, lines, blocker, feasibility: blocker ? 'blocked' : 'ok' };
    }

    if (path === 'B') {
      if (o.level === 'L3' && m.hin > 84) { /* still deliverable by white glove */ }
      lines.push({ k: '原仓出库', amt: RATE.outbound * units });
      const first = firstPrice('B', o.level, o.l4);
      const extra = extraPrice('B', o.level, o.l4);
      lines.push({ k: '直提首台 ' + LEVELS[o.level].code, amt: first, note: '含车组、工具、脱托拆箱、摆位调平清运' });
      if (units > 1) lines.push({ k: '同址加台 ×' + (units - 1), amt: extra * (units - 1) });
      lines.push({ k: '停车 / 站', amt: RATE.stop });
      if (o.l5) lines.push({ k: 'L5 技术启用（另单 T5）', amt: ADDONS.L5.fee * units });
      return { path, total: A.sum(lines, (l) => l.amt), lines, blocker: null, feasibility: 'ok' };
    }

    // C1 / C2 — 经授权站
    const linehaul = Math.round(Math.max(RATE.linehaulMin, o.miles * RATE.linehaulPerMile));
    lines.push({ k: '原仓出库', amt: RATE.outbound * units });
    lines.push({ k: '干线（原仓 → ' + (o.stationId || '授权站') + '）', amt: linehaul, note: 'BOL 收货人为授权站' });
    lines.push({ k: '收发 ' + RATE.stationHandling + ' ×' + units, amt: RATE.stationHandling * units });
    lines.push({ k: '短存 ' + RATE.storageDaysDefault + ' 天', amt: RATE.storagePerUnitDay * units * RATE.storageDaysDefault, note: '免期从站方验收日起算' });
    const sFirst = firstPrice('C2', o.level, o.l4), sExtra = extraPrice('C2', o.level, o.l4);
    lines.push({ k: '二程首台 ' + LEVELS[o.level].code, amt: sFirst, note: '站至最终机位' });
    if (units > 1) lines.push({ k: '二程加台 ×' + (units - 1), amt: sExtra * (units - 1) });
    lines.push({ k: '停车 / 站', amt: RATE.stop });
    if (o.l5) lines.push({ k: 'L5 技术启用（另单 T5）', amt: ADDONS.L5.fee * units });
    let total = A.sum(lines, (l) => l.amt);
    if (path === 'C1') {
      const prem = Math.round(total * (RATE.c1Premium - 1));
      lines.push({ k: '统包协作溢价 6%', amt: prem, note: '一份主委托覆盖三段，异常只找主承方' });
      total += prem;
    }
    return { path, total, lines, blocker: null, feasibility: 'ok' };
  }

  function feasiblePaths(o) {
    return ['A', 'B', 'C1', 'C2'].map((p) => ({ path: p, q: quote(o, p) }));
  }

  /* seeded generation ------------------------------------------------- */
  const rand = A.rng(20261101);
  const orders = [];
  let seq = 1040;

  const levelPicker = function () {
    const r = rand();
    if (r < 0.34) return 'L1';
    if (r < 0.72) return 'L2';
    return 'L3';
  };
  const modelPicker = function () {
    const r = rand();
    if (r < 0.26) return 'M01';
    if (r < 0.44) return 'M07';
    if (r < 0.58) return 'M05';
    if (r < 0.72) return 'M03';
    if (r < 0.84) return 'M04';
    if (r < 0.93) return 'M02';
    return 'M06';
  };

  // Local orders cluster tightly around their origin node; a few are long haul.
  AREAS.forEach(function (area) {
    const [nodeId, city, st, zip, lat, lng,] = area;
    const count = nodeId === 'DAL' ? 5 : nodeId === 'NJE' ? 3 : nodeId === 'PAR' || nodeId === 'HAY' ? 2 : rand.int(1, 2);
    for (let i = 0; i < count; i++) {
      const node = nodeById[nodeId];
      const level = levelPicker();
      const model = modelPicker();
      const units = rand.chance(0.24) ? rand.int(2, 3) : 1;
      const l4 = level === 'L3' && rand.chance(0.16);
      const l5 = rand.chance(0.22);
      const miles = Math.max(6, Math.round(A.geo.roadMiles(node, { lat, lng })));
      const dayOffset = rand.int(0, 16);
      const startH = rand.pick([8, 9, 10, 11, 13, 14, 15]);
      const win = { date: A.dt.add(TODAY, dayOffset), from: pad(startH) + ':00', to: pad(Math.min(19, startH + 3)) + ':00' };
      const st2 = rand();
      let status;
      if (dayOffset <= 1) {
        if (st2 < 0.30) status = '已签收';
        else if (st2 < 0.44) status = '执行中';
        else if (st2 < 0.58) status = '已派';
        else if (st2 < 0.68) status = '异常';
        else status = '待命';
      } else if (dayOffset <= 4) {
        if (st2 < 0.10) status = '已签收';
        else if (st2 < 0.26) status = '已派';
        else if (st2 < 0.38) status = '异常';
        else status = '待命';
      } else {
        if (st2 < 0.08) status = '已派';
        else if (st2 < 0.20) status = '待命';
        else status = '待派';
      }
      const o = {
        id: 'HA' + (++seq),
        nodeId, city, st, zip, lat, lng,
        model, units, level, l4, l5,
        miles,
        window: win,
        hard: rand.chance(0.38),
        status,
        stationId: level === 'L3' || rand.chance(0.5) ? (node.kind === 'stn' ? nodeId : rand.pick(['NJE', 'MDV', 'FLL'])) : null,
        techDone: status === '已签收' && l5 && rand.chance(0.7),
        sns: Array.from({ length: units }, (_, k) => 'HV' + (260000 + seq * 3 + k)),
        quoteBase: 0,
        created: A.dt.add(TODAY, -rand.int(0, 9)),
        note: ''
      };
      const b = quote(o, 'B');
      o.quoteBase = b.total;
      // 已派/执行中/已签收 orders carry the chosen path + agreed price
      o.path = status === '待派' ? null : rand.pick(['B', 'B', 'C1', 'C2', 'A']);
      if (o.path) {
        const q = quote(o, o.path);
        o.agreed = q ? Math.round(q.total * (1 + rand.float(-0.04, 0.05))) : o.quoteBase;
      }
      orders.push(o);
    }
  });

  // a handful of long-haul cross-region orders
  [['DAL', 'New York', 'NY', '10001', 40.7506, -73.9972],
    ['PAR', 'Denver', 'CO', '80202', 39.7392, -104.9903],
    ['NJE', 'Chicago', 'IL', '60607', 41.8781, -87.6298],
    ['HOU', 'Atlanta', 'GA', '30303', 33.7490, -84.3880],
    ['AUR', 'Nashville', 'TN', '37203', 36.1627, -86.7816]].forEach(function (r) {
      const node = nodeById[r[0]];
      const level = levelPicker();
      const units = rand.chance(0.3) ? 2 : 1;
      const o = {
        id: 'HA' + (++seq), nodeId: r[0], city: r[1], st: r[2], zip: r[3], lat: r[4], lng: r[5],
        model: modelPicker(), units, level, l4: false, l5: rand.chance(0.3),
        miles: Math.round(A.geo.roadMiles(node, { lat: r[4], lng: r[5] })),
        window: { date: A.dt.add(TODAY, rand.int(3, 18)), from: '09:00', to: '12:00' },
        hard: rand.chance(0.5), status: rand.pick(['待派', '待派', '已派', '待命']),
        stationId: rand.pick(['NJE', 'MDV', 'FLL', 'FIF']),
        techDone: false, sns: Array.from({ length: units }, (_, k) => 'HV' + (270000 + seq * 3 + k)),
        created: A.dt.add(TODAY, -rand.int(1, 12)), note: '跨区委托'
      };
      o.quoteBase = quote(o, 'B').total;
      o.path = o.status === '已派' ? 'C2' : null;
      if (o.path) o.agreed = Math.round(quote(o, 'C2').total * 1.02);
      orders.push(o);
    });

  /* ── 10. 海运航次 ─────────────────────────────────────────────────── */
  const ocean = [];
  const stagePlan = ['S01', 'S01', 'S02', 'S02', 'S02', 'S02', 'S03', 'S03', 'S03', 'S03', 'S04', 'S04', 'S04', 'REC', 'REC', 'REC'];
  stagePlan.forEach(function (stage, i) {
    const lane = LANES[i % LANES.length];
    const transit = lane.days;
    const model = modelPicker();
    const per = MODELS[model].per40;
    const units = Math.max(6, Math.round(per * rand.float(0.45, 0.98)));
    const box = rand.chance(0.74) ? '40HQ' : (rand.chance(0.5) ? '20GP' : 'LCL');
    // anchor dates: booking is transit + buffer before ETA
    const etaOffset = stage === 'S01' ? rand.int(20, 42) : stage === 'S02' ? rand.int(3, 16) : stage === 'S03' ? rand.int(-2, 2) : rand.int(-9, -3);
    const eta = A.dt.add(TODAY, etaOffset);
    const etd = A.dt.add(eta, -transit);
    const docCount = stage === 'S01' ? 2 : stage === 'S02' ? rand.int(5, 7) : stage === 'S03' ? rand.int(7, 9) : 12;
    const docs = {};
    DOCS.forEach(function (d, k) { docs[d.id] = k < docCount && !(rand.chance(0.07) && k < 8); });
    const s = {
      id: 'AT' + (2620 + i) + '-' + String(i + 1).padStart(2, '0'),
      lane, carrier: CARRIERS[i % CARRIERS.length], vessel: VESSELS[i % VESSELS.length],
      voyage: '26' + (10 + (i % 3)) + (i % 2 ? 'E' : 'W'),
      stage, box, type: box === 'LCL' ? 'LCL' : 'FCL',
      model, units,
      etd, eta,
      freezeEta: A.dt.add(eta, rand.int(-2, 1)),
      actualEta: stage === 'S03' || stage === 'S04' || stage === 'REC' ? A.dt.add(eta, rand.int(-1, 4)) : null,
      freeDays: box === '40HQ' ? 6 : 5,
      docList: docs,
      nodeId: PORTS[lane.to].node,
      consignee: nodeById[PORTS[lane.to].node].city,
      demurragePerDay: box === '40HQ' ? 195 : 135,
      valueUsd: units * rand.int(1400, 2100),
      note: ''
    };
    const miss = DOCS.filter((d) => !docs[d.id]);
    s.missing = miss.map((d) => d.id);
    s.docPct = (DOCS.length - miss.length) / DOCS.length;
    ocean.push(s);
  });

  /* ── 11. 异常与批次 ───────────────────────────────────────────────── */
  const exceptions = [];
  const excSeed = orders.filter((o) => o.status !== '待派').slice(0, 9);
  excSeed.forEach(function (o, i) {
    const t = EXC_TYPES[i % EXC_TYPES.length];
    exceptions.push({
      id: 'EX' + (7100 + i),
      orderId: o.id,
      type: t.id,
      opened: A.dt.add(TODAY, -rand.int(0, 5)),
      owner: t.owner,
      holder: rand.pick(['原仓 DAL', '授权站 NJE', '车组 · 在途', '客户场地', '区域站 FLL']),
      ageH: rand.int(1, 40),
      sla: t.sla,
      status: i % 4 === 0 ? '已关闭' : i % 3 === 0 ? '待客户' : '处理中',
      note: t.id === 'damage' ? '左侧面板凹陷，前后照片已存，货仍由车组保管'
        : t.id === 'noshowsign' ? '到场无人签收，已回站并留次日上午窗口'
          : t.id === 'access' ? '门洞净高比包装低 3 cm，未拆门，等待客户改配'
            : t.id === 'window' ? '客户要求改到周五 09:00–11:00，原窗仍保留'
              : t.id === 'tech' ? '联网后无法绑机，已远程排查，等待现场复测'
                : t.id === 'doc' ? '到仓 SN 与装箱清单不一致，已冻结该台'
                  : '短存第 16 天，等待客户出库指令'
    });
  });

  const batches = [
    {
      id: 'B-DAL-2611A', city: 'Dallas', label: 'DFW 平层机位批 · 第 1 批', opened: '2026-10-06', closed: '2026-10-30',
      tickets: 26, firstTry: 24, ontime: 23, pod: 26, damage: 0,
      baseline: 26 * 512, actual: 26 * 433, changeOrders: 640, credit: 0,
      varianceLines: 3, unmatched: 0, status: '已结算'
    },
    {
      id: 'B-DAL-2611B', city: 'Dallas', label: 'DFW 复杂通道批 · 第 2 批', opened: '2026-10-13', closed: null,
      tickets: 14, firstTry: 12, ontime: 13, pod: 13, damage: 1,
      baseline: 14 * 611, actual: 14 * 548, changeOrders: 980, credit: 120,
      varianceLines: 4, unmatched: 1, status: '在结'
    },
    {
      id: 'B-EAST-2611', city: 'New Jersey', label: 'NJ → 纽约 ZIP 室内批', opened: '2026-10-20', closed: null,
      tickets: 9, firstTry: 8, ontime: 8, pod: 9, damage: 0,
      baseline: 9 * 540, actual: 9 * 512, changeOrders: 210, credit: 0,
      varianceLines: 2, unmatched: 0, status: '在结'
    }
  ];

  const invoices = [
    { id: 'INV-44120', batch: 'B-DAL-2611A', vendor: '主供甲 · 白手套', quoted: 580, billed: 580, approved: 0, diff: 0, note: '与委托一致', status: '已核' },
    { id: 'INV-44121', batch: 'B-DAL-2611A', vendor: '区域站 · LXD', quoted: 300, billed: 345, approved: 0, diff: 45, note: '多计 1 个楼梯段，缺预告', status: '争议' },
    { id: 'INV-44122', batch: 'B-DAL-2611A', vendor: 'T5 技术服务商', quoted: 120, billed: 120, approved: 0, diff: 0, note: '按两台 × 60', status: '已核' },
    { id: 'INV-44130', batch: 'B-DAL-2611B', vendor: '主供甲 · 白手套', quoted: 410, billed: 470, approved: 60, diff: 0, note: '获批二次上门', status: '已核' },
    { id: 'INV-44131', batch: 'B-DAL-2611B', vendor: '本地搬运商', quoted: 220, billed: 275, approved: 0, diff: 55, note: '等候 55 分钟超免费期', status: '待采购买单' },
    { id: 'INV-44132', batch: 'B-DAL-2611B', vendor: '原仓 DAL', quoted: 30, billed: 30, approved: 0, diff: 0, note: '', status: '已核' },
    { id: 'INV-44140', batch: 'B-EAST-2611', vendor: '区域站 · LXD', quoted: 250, billed: 265, approved: 0, diff: 15, note: '选检台数与预报不符', status: '已核' },
    { id: 'INV-44141', batch: 'B-EAST-2611', vendor: '末段车组 · 备选', quoted: 520, billed: 520, approved: 0, diff: 0, note: '', status: '已核' }
  ];

  function pad(n) { return String(n).padStart(2, '0'); }

  /* ── 12. 基线 KPI（演示用，非实测声明） ──────────────────────────── */
  const BASELINE = {
    ontime: 0.918, firstTry: 0.902, pod: 0.972, damage: 0.0128, complaint: 0.021,
    billingVariance: 0.036, history: [0.87, 0.88, 0.9, 0.89, 0.91, 0.9, 0.92, 0.918]
  };

  A.C = {
    MODELS, LEVELS, ADDONS, PATHS, RATE, NODES, PORTS, LANES, CARRIERS, VESSELS,
    AREAS, CITY_LABELS, OCEAN_STAGES, DOCS, STEPS, ROLES, CYCLES, KPIS, GATES,
    EXC_TYPES, TODAY, nodeById, levelFactor, firstPrice, extraPrice, quote, feasiblePaths
  };
  A.pricing = { quote, feasiblePaths, levelFactor, firstPrice, extraPrice };

  /** Docs that should already be on file at the shipment's current stage. */
  A.oceanDoc = function (x) {
    const idx = OCEAN_STAGES.findIndex((s) => s.id === x.stage);
    const due = DOCS.filter((d) => d.stage <= Math.max(0, idx));
    const have = due.filter((d) => x.docList[d.id]);
    const missingDue = due.filter((d) => !x.docList[d.id]);
    return {
      stageIdx: Math.max(0, idx), due: due.length, have: have.length,
      missingDue: missingDue.map((d) => d.id), missingDueNames: missingDue.map((d) => d.name),
      pct: due.length ? have.length / due.length : 1
    };
  };

  A.buildSeed = function () {
    return {
      today: TODAY,
      theme: 'dark',
      orders: JSON.parse(JSON.stringify(orders)),
      ocean: JSON.parse(JSON.stringify(ocean)),
      exceptions: JSON.parse(JSON.stringify(exceptions)),
      batches: JSON.parse(JSON.stringify(batches)),
      invoices: JSON.parse(JSON.stringify(invoices)),
      baseline: BASELINE,
      trucks: [],
      draft: { origin: 'DAL', stops: [], plan: null, order: 'window' },
      ui: { mapLayers: { states: true, roads: true, lanes: true, pins: true, zones: false, nodes: true }, oceanFilter: 'ALL', mapLevel: 'ALL' },
      log: []
    };
  };
})(window);
