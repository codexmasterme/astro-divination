/* =====================================================================
 * 星语塔罗 — 逻辑层
 * 流程：录入出生信息与问题 → 定本命盘(太阳星座) → 以信息为种子抽塔罗牌
 *       → 塔罗牌翻牌动画呈现(含正/逆位) → 生成综合解读
 * 设计原则：同一人 + 同一问题 + 同一日期 => 结果稳定（盘由人定）
 * ===================================================================== */

/* ---------------- 工具：确定性随机 ---------------- */
// 字符串 -> 32bit 哈希（xfnv1a）
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
// mulberry32：由种子生成可复现的伪随机序列
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 太阳星座计算 ---------------- */
function getSunSign(month, day) {
  for (const z of ZODIAC) {
    const [fm, fd] = z.from, [tm, td] = z.to;
    if (fm === 12) { // 摩羯座跨年
      if ((month === 12 && day >= fd) || (month === 1 && day <= td)) return z;
    } else if ((month === fm && day >= fd) || (month === tm && day <= td)) {
      return z;
    }
  }
  return ZODIAC[0];
}

/* ---------------- 上升星座估算（天文近似） ----------------
 * 步骤：本地钟表时间 → UT → 儒略日 → 格林尼治恒星时(GMST) → 地方恒星时(LST)
 *       → 结合黄赤交角与纬度求上升点黄经 → 映射到黄道十二星座。
 * 说明：这是不含岁差/章动的近似算法，用于占卜参考，非专业排盘精度。 */
const DEG = Math.PI / 180;
function julianDay(y, m, d, hourUT) {
  // hourUT 为 UT 的小数小时，可为负（会正确落到前一日）
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1))
    + d + B - 1524.5 + hourUT / 24;
}
function normDeg(x) { return ((x % 360) + 360) % 360; }
function localSiderealTime(jd, lngEast) {
  const T = (jd - 2451545.0) / 36525;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - (T * T * T) / 38710000;
  return normDeg(normDeg(gmst) + lngEast);
}
// 由地方恒星时(RAMC)与纬度求上升点黄经(0-360°)
function ascendantLongitude(lstDeg, latDeg) {
  const eps = 23.4392911 * DEG;          // 黄赤交角
  const ramc = lstDeg * DEG;
  const lat = latDeg * DEG;
  // 经日出校验：此式给出的黄经在日出时与太阳黄经吻合，即东方地平线上的上升点
  const asc = Math.atan2(
    Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(eps) + Math.tan(lat) * Math.sin(eps))
  ) / DEG;
  return normDeg(asc);
}
// 黄经 -> 星座（0°=白羊，每 30° 一个星座）
function signFromLongitude(lonDeg) {
  const idx = Math.floor(normDeg(lonDeg) / 30) % 12;
  return signByKey(ZODIAC_ORDER[idx]);
}
// 综合入口：给定出生年月日、时间字符串、地点文本，返回上升星座信息或 null
function estimateAscendant(y, m, d, timeStr, placeStr) {
  if (!timeStr) return null; // 无出生时间无法估算
  const [hh, mm] = timeStr.split(':').map(Number);
  if (Number.isNaN(hh)) return null;
  const city = geocodeCity(placeStr) || DEFAULT_CITY;
  const localHour = hh + (mm || 0) / 60;
  const hourUT = localHour - city.tz;         // 本地钟表时间转 UT
  const jd = julianDay(y, m, d, hourUT);
  const lst = localSiderealTime(jd, city.lng);
  const lon = ascendantLongitude(lst, city.lat);
  const sign = signFromLongitude(lon);
  const matched = !!geocodeCity(placeStr);
  return { sign, city, matched, longitude: lon };
}

/* ---------------- 从种子抽牌（无重复，并决定正/逆位） ---------------- */
function drawCards(rng, deck, n) {
  const pool = deck.slice();
  const picked = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    const card = pool.splice(idx, 1)[0];
    const reversed = rng() < 0.42; // 逆位概率略低于正位
    picked.push({ card, reversed });
  }
  return picked;
}

/* ---------------- DOM 引用 ---------------- */
const $ = (sel) => document.querySelector(sel);
const state = { topic: 'general' };

/* ---------------- 初始化：领域按钮 ---------------- */
function initTopics() {
  const wrap = $('#topic-group');
  TOPICS.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'topic-btn' + (i === 0 ? ' active' : '');
    b.dataset.key = t.key;
    b.innerHTML = `<span class="ic">${t.icon}</span>${t.label}`;
    b.addEventListener('click', () => {
      document.querySelectorAll('.topic-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.topic = t.key;
    });
    wrap.appendChild(b);
  });
}

/* ---------------- 表单校验 ---------------- */
function readForm() {
  const name = $('#f-name').value.trim() || '有缘人';
  const date = $('#f-date').value;      // yyyy-mm-dd
  const time = $('#f-time').value;      // hh:mm 可空
  const place = $('#f-place').value.trim();
  const question = $('#f-question').value.trim();
  if (!date) { return { error: '请填写你的出生日期，这是定盘的根基。' }; }
  const [y, m, d] = date.split('-').map(Number);
  return { name, y, m, d, time, place, question, topic: state.topic };
}

/* ---------------- 生成解读 ---------------- */
function buildResult(f) {
  const sign = getSunSign(f.m, f.d);
  const asc = estimateAscendant(f.y, f.m, f.d, f.time, f.place);
  const deck = buildDeck();
  const spread = SPREADS[f.topic];

  // 种子：出生信息 + 问题 + 领域 + 当日日期（让"今日之问"有当下的行运感）
  const today = new Date().toISOString().slice(0, 10);
  const seedStr = [f.name, f.y, f.m, f.d, f.time, f.place, f.question, f.topic, today].join('|');
  const rng = mulberry32(hashSeed(seedStr));

  const draws = drawCards(rng, deck, spread.positions.length);

  // 综合寄语：结合星座与正/逆位的整体倾向
  const upCount = draws.filter((d) => !d.reversed).length;
  const total = draws.length;
  let tone;
  if (upCount === total) {
    tone = '三张牌尽数正位，能量顺畅通达，正是乘势而行的好时机';
  } else if (upCount === 0) {
    tone = '三张牌皆为逆位，提示你先向内调整、清理阻碍，蓄势方能后发';
  } else if (upCount >= total - upCount) {
    tone = '正位居多，大势向好，只需留意逆位之处点到的功课';
  } else {
    tone = '逆位偏多，眼下宜守宜省，把绊住你的心结一一解开，转机自会到来';
  }

  const ascSentence = asc
    ? `太阳落于${sign.name}、上升约在${asc.sign.name}，前者是你的内核，后者是你面向世界的姿态。`
    : '';
  const closing = `作为${sign.element}象的${sign.name}，你的底色是「${sign.keywords.join('、')}」。` +
    ascSentence +
    `本次牌阵中${tone}。${sign.trait}让塔罗照见的，与你星盘的本性彼此呼应，顺此而行，问题自会显出答案。`;

  return { sign, asc, spread, draws, closing };
}

/* ---------------- 渲染结果 ---------------- */
function renderResult(f, result) {
  const { sign, asc, spread, draws, closing } = result;

  // 上升星座行（估算）
  let ascLine;
  if (asc) {
    const note = asc.matched
      ? `按「${asc.city.name}」经纬度估算`
      : '未识别出生地点，按默认经纬度估算';
    ascLine = `<div class="natal-asc">上升星座（估算）
        <b>${asc.sign.symbol} ${asc.sign.name}</b>
        <span class="asc-note">${note}，仅供参考</span></div>`;
  } else {
    ascLine = `<div class="natal-asc muted">💡 填写出生时间（和地点）可估算你的上升星座</div>`;
  }

  // 本命盘卡片
  $('#natal').innerHTML = `
    <div class="natal-symbol">${sign.symbol}</div>
    <div class="natal-info">
      <div class="natal-name">${f.name} · ${sign.name}</div>
      <div class="natal-meta">${sign.element}象 · ${sign.quality}宫 · 守护星 ${sign.planet}</div>
      <div class="natal-key">${sign.keywords.map((k) => `<span>${k}</span>`).join('')}</div>
      ${ascLine}
    </div>`;

  $('#spread-name').textContent = `牌阵：${spread.name}`;
  $('#topic-echo').textContent = f.question ? `所问：${f.question}` : '所问：随缘一卦';

  // 牌位
  const board = $('#board');
  board.innerHTML = '';
  draws.forEach((d, i) => {
    const { card, reversed } = d;
    const pos = spread.positions[i];
    const meaning = reversed ? card.rev : card.up;
    const oriLabel = reversed ? '逆位' : '正位';
    const slot = document.createElement('div');
    slot.className = 'card-slot';
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
            <div class="tarot-ori ${reversed ? 'rev' : 'up'}">${oriLabel}</div>
          </div>
        </div>
      </div>
      <div class="card-read" data-read="${i}">
        <div class="cr-title">${card.name} · ${oriLabel}
          <span class="cr-ori-badge ${reversed ? 'rev' : 'up'}">${oriLabel}</span>
        </div>
        <div class="cr-hint">${pos.hint} · 对应${card.astro}</div>
        <div class="cr-body">${meaning}</div>
        <div class="cr-advice">◈ ${card.advice}</div>
      </div>`;
    board.appendChild(slot);
  });

  $('#closing').textContent = closing;

  // 切换到结果视图
  $('#stage-form').classList.add('hidden');
  $('#stage-result').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 依次翻牌
  const cardEls = board.querySelectorAll('.card');
  cardEls.forEach((el, i) => {
    setTimeout(() => {
      el.classList.add('flipped');
      const read = board.querySelector(`[data-read="${i}"]`);
      setTimeout(() => read.classList.add('show'), 500);
    }, 500 + i * 850);
  });
  // 全部翻完后显示综合寄语
  const totalDelay = 500 + draws.length * 850 + 700;
  setTimeout(() => $('#closing-wrap').classList.add('show'), totalDelay);
}

/* ---------------- 事件绑定 ---------------- */
function initEvents() {
  $('#divine-btn').addEventListener('click', () => {
    const f = readForm();
    const err = $('#form-error');
    if (f.error) { err.textContent = f.error; err.classList.add('show'); return; }
    err.classList.remove('show');
    const result = buildResult(f);
    renderResult(f, result);
  });

  $('#again-btn').addEventListener('click', () => {
    $('#stage-result').classList.add('hidden');
    $('#stage-form').classList.remove('hidden');
    $('#closing-wrap').classList.remove('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTopics();
  initEvents();
});
