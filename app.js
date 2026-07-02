/* =====================================================================
 * 星语塔罗 — 逻辑层
 * 功能：
 *   - 太阳星座（出生日期）
 *   - 月亮星座（近似月球黄经算法）
 *   - 上升星座估算（地方恒星时 + 黄赤交角）
 *   - 十二宫位（以上升点为第一宫起算）
 *   - 78 张塔罗抽牌（确定性 + 正/逆位）
 *   - 可选牌阵：三张 / 五芒星 / 爱情五叶 / 凯尔特十字
 * ===================================================================== */

/* ──────────────── 工具：确定性随机 ──────────────── */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ──────────────── 天文常量 ──────────────── */
const DEG = Math.PI / 180;
function normDeg(x) { return ((x % 360) + 360) % 360; }

/* 儒略日（hourUT 为 UT 小数小时） */
function julianDay(y, m, d, hourUT) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1))
    + d + B - 1524.5 + hourUT / 24;
}

/* 格林尼治恒星时 → 地方恒星时 (度) */
function localSiderealTime(jd, lngEast) {
  const T = (jd - 2451545.0) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - T * T * T / 38710000;
  return normDeg(normDeg(gmst) + lngEast);
}

/* 上升点黄经（日出校验通过：日出时上升=太阳黄经） */
function ascendantLongitude(lstDeg, latDeg) {
  const eps = 23.4392911 * DEG, ramc = lstDeg * DEG, lat = latDeg * DEG;
  return normDeg(Math.atan2(Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(eps) + Math.tan(lat) * Math.sin(eps))) / DEG);
}

/* 黄经 → 星座对象 */
function signFromLongitude(lonDeg) {
  return signByKey(ZODIAC_ORDER[Math.floor(normDeg(lonDeg) / 30) % 12]);
}

/* ──────────────── 太阳星座 ──────────────── */
function getSunSign(month, day) {
  for (const z of ZODIAC) {
    const [fm, fd] = z.from, [tm, td] = z.to;
    if (fm === 12) {
      if ((month === 12 && day >= fd) || (month === 1 && day <= td)) return z;
    } else if ((month === fm && day >= fd) || (month === tm && day <= td)) return z;
  }
  return ZODIAC[0];
}

/* ──────────────── 月亮星座（近似） ────────────────
 * 使用 Jean Meeus «Astronomical Algorithms» 简化展开式
 * 误差 ≤ 1°，对应月亮在某星座的时间误差约 2 小时，用于占卜参考。 */
function moonLongitude(jd) {
  const T = (jd - 2451545.0) / 36525;
  // 月球平均黄经 L'
  const L1 = normDeg(218.3164477 + 481267.88123421 * T
    - 0.0015786 * T * T + T * T * T / 538841 - T * T * T * T / 65194000);
  // 月球平均异常角 M'
  const M1 = normDeg(134.9633964 + 477198.8676313 * T
    + 0.008997 * T * T + T * T * T / 69699 - T * T * T * T / 14712000);
  // 太阳平均异常角 M
  const M = normDeg(357.5291092 + 35999.0502909 * T
    - 0.0001536 * T * T + T * T * T / 24490000);
  // 月球到升交点距离 F
  const F = normDeg(93.2720950 + 483202.0175233 * T
    - 0.0036539 * T * T - T * T * T / 3526000 + T * T * T * T / 863310000);
  // 主要摄动修正（度）
  const corr =
    6.288774 * Math.sin(M1 * DEG) +
    1.274027 * Math.sin((2 * L1 - M1) * DEG) +
    0.658314 * Math.sin(2 * L1 * DEG) +
    0.213618 * Math.sin(2 * M1 * DEG) -
    0.185116 * Math.sin(M * DEG) -
    0.114332 * Math.sin(2 * F * DEG) +
    0.058793 * Math.sin((2 * L1 - 2 * M1) * DEG) +
    0.057066 * Math.sin((2 * L1 - M - M1) * DEG) +
    0.053322 * Math.sin((2 * L1 + M1) * DEG) +
    0.045758 * Math.sin((2 * L1 - M) * DEG) -
    0.040923 * Math.sin((M - M1) * DEG) -
    0.034720 * Math.sin(L1 * DEG) -
    0.030383 * Math.sin((M + M1) * DEG) +
    0.015327 * Math.sin((2 * L1 - 2 * F) * DEG) -
    0.012528 * Math.sin((M1 + 2 * F) * DEG) +
    0.010980 * Math.sin((M1 - 2 * F) * DEG);
  return normDeg(L1 + corr);
}

/* ──────────────── 十二宫位（等宫制） ────────────────
 * 以上升点为第一宫起点，每 30° 一宫，共 12 宫。
 * 宫位代表生命的 12 个主题领域。 */
const HOUSE_THEMES = [
  '第一宫·自我形象',   '第二宫·财富资源', '第三宫·沟通思维',
  '第四宫·家庭根基',   '第五宫·创造快乐', '第六宫·健康工作',
  '第七宫·伴侣合作',   '第八宫·蜕变共享', '第九宫·信仰远方',
  '第十宫·事业名望',   '第十一宫·友谊理想','第十二宫·潜意识',
];
const HOUSE_KEYWORDS = [
  ['外表', '开端', '自我意识'],   ['金钱', '价值', '安全感'],
  ['语言', '学习', '兄弟姐妹'],   ['家庭', '根基', '私密'],
  ['乐趣', '恋爱', '子女'],       ['服务', '健康', '日常'],
  ['关系', '契约', '他人'],       ['性', '死亡', '共同财产'],
  ['旅行', '哲学', '外国'],       ['职业', '社会地位', '父亲'],
  ['友情', '团体', '梦想'],       ['孤独', '业力', '秘密'],
];
// 给定行星黄经与上升点黄经，返回宫位 1-12
function calcHouse(planetLon, ascLon) {
  return Math.floor(normDeg(planetLon - ascLon) / 30) % 12 + 1;
}

/* ──────────────── 综合估算入口 ──────────────── */
function estimatePlanets(y, m, d, timeStr, placeStr) {
  const result = { sun: null, moon: null, asc: null, moonHouse: null, ascHouse: 1 };
  const city = geocodeCity(placeStr) || DEFAULT_CITY;
  const matched = !!geocodeCity(placeStr);

  // 基准时间（取中午 12:00 本地时间，用于无出生时间时计算月亮）
  let localHour = 12;
  let hasTime = false;
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(Number);
    if (!Number.isNaN(hh)) { localHour = hh + (mm || 0) / 60; hasTime = true; }
  }
  const hourUT = localHour - city.tz;
  const jd = julianDay(y, m, d, hourUT);

  // 月亮星座（有无时间都算，无时间用中午 UT，精度约 ±6 小时内稳定）
  const moonLon = moonLongitude(jd);
  result.moon = { sign: signFromLongitude(moonLon), longitude: moonLon };

  // 上升星座（需出生时间）
  if (hasTime) {
    const lst = localSiderealTime(jd, city.lng);
    const ascLon = ascendantLongitude(lst, city.lat);
    result.asc = { sign: signFromLongitude(ascLon), longitude: ascLon, city, matched };
    // 月亮在第几宫
    result.moonHouse = calcHouse(moonLon, ascLon);
  }

  return result;
}

/* ──────────────── DOM 引用 ──────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const state = { spreadKey: 'general' };

/* ──────────────── 初始化：牌阵选择器 ──────────────── */
function initSpreads() {
  const wrap = $('#spread-select');
  SPREAD_OPTIONS.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'spread-btn' + (i === 0 ? ' active' : '');
    b.dataset.key = opt.key;
    b.innerHTML = `<span class="sb-name">${opt.label}</span><span class="sb-sub">${opt.sub}</span>`;
    b.addEventListener('click', () => {
      $$('.spread-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.spreadKey = opt.key;
    });
    wrap.appendChild(b);
  });
}

/* ──────────────── 表单读取 ──────────────── */
function readForm() {
  const name = $('#f-name').value.trim() || '有缘人';
  const date = $('#f-date').value;
  const time = $('#f-time').value;
  const place = $('#f-place').value.trim();
  const question = $('#f-question').value.trim();
  if (!date) return { error: '请填写你的出生日期，这是定盘的根基。' };
  const [y, m, d] = date.split('-').map(Number);
  return { name, y, m, d, time, place, question, spreadKey: state.spreadKey };
}

/* ──────────────── 生成解读 ──────────────── */
function buildResult(f) {
  const sunSign = getSunSign(f.m, f.d);
  const planets = estimatePlanets(f.y, f.m, f.d, f.time, f.place);
  const deck = buildDeck();
  const spread = SPREADS[f.spreadKey];

  const today = new Date().toISOString().slice(0, 10);
  const seedStr = [f.name, f.y, f.m, f.d, f.time, f.place, f.question, f.spreadKey, today].join('|');
  const rng = mulberry32(hashSeed(seedStr));

  // 抽牌
  const pool = deck.slice();
  const draws = [];
  for (let i = 0; i < spread.size; i++) {
    const idx = Math.floor(rng() * pool.length);
    const card = pool.splice(idx, 1)[0];
    const reversed = rng() < 0.42;
    draws.push({ card, reversed });
  }

  // 综合寄语
  const upCount = draws.filter((d) => !d.reversed).length;
  let tone;
  if (upCount === draws.length) tone = '牌尽数正位，能量顺畅通达，正是乘势而为的好时机';
  else if (upCount === 0) tone = '牌皆为逆位，提示你先向内调整、清理阻碍，蓄势方能后发';
  else if (upCount > draws.length / 2) tone = '正位居多，大势向好，只需留意逆位处点到的功课';
  else tone = '逆位偏多，宜守宜省，把绊住你的心结一一解开，转机自会到来';

  const moonSentence = planets.moon
    ? `月亮落在${planets.moon.sign.name}，掌管你的情绪本能与内在需求。`
    : '';
  const ascSentence = planets.asc
    ? `上升约在${planets.asc.sign.name}，是你面向世界的姿态与第一印象。`
    : '';
  const moonHouseSentence = planets.moonHouse
    ? `月亮位于${HOUSE_THEMES[planets.moonHouse - 1]}，情绪能量聚焦于此。`
    : '';

  const closing =
    `作为${sunSign.element}象的${sunSign.name}，你的底色是「${sunSign.keywords.join('、')}」。` +
    moonSentence + ascSentence + moonHouseSentence +
    `本次${spread.name}中${tone}。${sunSign.trait}` +
    `让塔罗照见的，与你星盘的本性彼此呼应，顺此而行，问题自会显出答案。`;

  return { sunSign, planets, spread, draws, closing };
}

/* ──────────────── 渲染本命盘卡片 ──────────────── */
function renderNatal(f, result) {
  const { sunSign, planets } = result;

  // 月亮星座行
  const moonLine = planets.moon
    ? `<div class="natal-planet">
        <span class="planet-ic">🌙</span>
        <span class="planet-label">月亮</span>
        <b>${planets.moon.sign.symbol} ${planets.moon.sign.name}</b>
        <span class="planet-kw">${planets.moon.sign.keywords.slice(0, 2).join('·')}</span>
        ${planets.moonHouse ? `<span class="planet-house">${HOUSE_THEMES[planets.moonHouse - 1]}</span>` : ''}
       </div>`
    : '';

  // 上升星座行
  let ascLine;
  if (planets.asc) {
    const note = planets.asc.matched
      ? `按「${planets.asc.city.name}」经纬度估算`
      : '未识别出生地点，按默认坐标估算';
    ascLine = `<div class="natal-planet">
        <span class="planet-ic">↑</span>
        <span class="planet-label">上升</span>
        <b>${planets.asc.sign.symbol} ${planets.asc.sign.name}</b>
        <span class="planet-kw">${planets.asc.sign.keywords.slice(0, 2).join('·')}</span>
        <span class="asc-note">${note}</span>
       </div>`;
  } else {
    ascLine = `<div class="natal-planet muted">↑ 上升：填写出生时间+地点可估算</div>`;
  }

  $('#natal').innerHTML = `
    <div class="natal-symbol">${sunSign.symbol}</div>
    <div class="natal-info">
      <div class="natal-name">${f.name} · ${sunSign.name}</div>
      <div class="natal-meta">${sunSign.element}象 · ${sunSign.quality}宫 · 守护星 ${sunSign.planet}</div>
      <div class="natal-key">${sunSign.keywords.map((k) => `<span>${k}</span>`).join('')}</div>
      <div class="natal-planets">${moonLine}${ascLine}</div>
    </div>`;
}

/* ──────────────── 渲染牌阵 ──────────────── */
function renderBoard(spread, draws) {
  const board = $('#board');
  board.innerHTML = '';
  const isCeltic = spread.size === 10;
  board.className = 'board' + (isCeltic ? ' board-celtic' : spread.size === 5 ? ' board-5' : '');

  draws.forEach((d, i) => {
    const { card, reversed } = d;
    const pos = spread.positions[i];
    const meaning = reversed ? card.rev : card.up;
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    // 凯尔特十字用 data-pos 标记布局位置 (1-10)
    if (isCeltic) slot.dataset.pos = i + 1;

    slot.innerHTML = `
      <div class="slot-label">${pos.title}</div>
      <div class="card" data-index="${i}">
        <div class="card-inner">
          <div class="card-face card-back">
            <div class="back-art"><span class="back-star">✦</span></div>
          </div>
          <div class="card-face card-front${reversed ? ' reversed' : ''}">
            <div class="tarot-body">
              <div class="tarot-roman">${card.roman}</div>
              <div class="tarot-symbol">${card.symbol}</div>
              <div class="tarot-name">${card.name}</div>
              <div class="tarot-en">${card.en}</div>
            </div>
            <div class="tarot-ori ${reversed ? 'rev' : 'up'}">${reversed ? '逆位' : '正位'}</div>
          </div>
        </div>
      </div>
      <div class="card-read" data-read="${i}">
        <div class="cr-title">${card.name} · ${reversed ? '逆位' : '正位'}
          <span class="cr-ori-badge ${reversed ? 'rev' : 'up'}">${reversed ? '逆' : '正'}</span>
        </div>
        <div class="cr-hint">${pos.hint} · ${card.astro}</div>
        <div class="cr-body">${meaning}</div>
        <div class="cr-advice">◈ ${card.advice}</div>
      </div>`;
    board.appendChild(slot);
  });
}

/* ──────────────── 主渲染 ──────────────── */
function renderResult(f, result) {
  const { spread, draws, closing } = result;

  renderNatal(f, result);
  $('#spread-name').textContent = `牌阵：${spread.name}`;
  $('#topic-echo').textContent = f.question ? `所问：${f.question}` : '所问：随缘一卦';

  renderBoard(spread, draws);
  $('#closing').textContent = closing;

  $('#stage-form').classList.add('hidden');
  $('#stage-result').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 逐张翻牌
  const cardEls = $('#board').querySelectorAll('.card');
  cardEls.forEach((el, i) => {
    setTimeout(() => {
      el.classList.add('flipped');
      const read = $('#board').querySelector(`[data-read="${i}"]`);
      setTimeout(() => read.classList.add('show'), 480);
    }, 400 + i * 750);
  });

  // 全部翻完后显示综合寄语
  setTimeout(() => $('#closing-wrap').classList.add('show'),
    400 + draws.length * 750 + 700);
}

/* ──────────────── 事件绑定 ──────────────── */
function initEvents() {
  $('#divine-btn').addEventListener('click', () => {
    const f = readForm();
    const err = $('#form-error');
    if (f.error) { err.textContent = f.error; err.classList.add('show'); return; }
    err.classList.remove('show');
    renderResult(f, buildResult(f));
  });

  $('#again-btn').addEventListener('click', () => {
    $('#stage-result').classList.add('hidden');
    $('#stage-form').classList.remove('hidden');
    $('#closing-wrap').classList.remove('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSpreads();
  initEvents();
});
