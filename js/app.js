/* ===========================================================
   SPI3 マスター — アプリ本体
   =========================================================== */
'use strict';

/* ---------- ユーティリティ ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const pad2 = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDs = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const catById = id => BOOK.categories.find(c => c.id === id);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- 状態管理 ---------- */
const LS_KEY = 'spi3master.v1';
const DEFAULT_EXAM = '2026-08-31';

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* 破損時は初期化 */ }
  return {
    v: 1,
    examDate: DEFAULT_EXAM,
    planStart: ds(today()),
    done: {},   // unitId -> 完了日
    qs: {},     // qid -> {a, c, box, due}
    act: {},    // 'YYYY-MM-DD' -> 回数
    xp: 0,
    sessions: 0,
  };
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function markActivity() {
  const k = ds(today());
  state.act[k] = (state.act[k] || 0) + 1;
  save();
}

/* ---------- 学習プラン生成 ---------- */
function generatePlan() {
  const start = parseDs(state.planStart);
  const exam = parseDs(state.examDate);
  const lastPrep = addDays(exam, -1);
  const totalDays = Math.round((lastPrep - start) / 86400000) + 1;

  const calendar = [];
  const tight = totalDays < 18; // 期間が短ければ予備日なし
  for (let i = 0; i < Math.max(totalDays, 1); i++) {
    const d = addDays(start, i);
    const isBuffer = !tight && d.getDay() === 0 && i !== 0; // 日曜=予備日
    calendar.push({ date: d, isBuffer });
  }
  const sd = calendar.filter(c => !c.isBuffer);

  const reserved = sd.length >= 4 ? 2 : 0;               // 直前調整
  const c3min = sd.length >= 26 ? 5 : sd.length >= 16 ? 3 : sd.length >= 8 ? 1 : 0;
  const packDays = Math.max(1, sd.length - reserved - c3min);
  const totalMin = [...UNITS_C1, ...UNITS_C2].reduce((s, u) => s + u.min, 0);
  const cap = Math.max(120, Math.ceil(totalMin / packDays));

  // 1周目→2周目を順に詰める
  const packed = [];
  let cur = [], curMin = 0, phase = 1;
  const queue = [...UNITS_C1.map(u => ({ ...u, phase: 1 })), ...UNITS_C2.map(u => ({ ...u, phase: 2 }))];
  for (const u of queue) {
    if (curMin + u.min > cap && cur.length) {
      packed.push({ phase, tasks: cur });
      cur = []; curMin = 0;
    }
    if (u.phase !== phase && cur.length) {
      packed.push({ phase, tasks: cur });
      cur = []; curMin = 0;
    }
    phase = u.phase;
    cur.push(u); curMin += u.min;
  }
  if (cur.length) packed.push({ phase, tasks: cur });

  // 3周目（実戦・弱点）
  const c3days = Math.max(0, sd.length - reserved - packed.length);
  for (let i = 0; i < c3days; i++) {
    packed.push({
      phase: 3,
      tasks: [
        { id: `c3-${i}-a`, cat: null, label: '弱点分野を書籍で復習', detail: '「記録」タブで正答率の低い分野を確認し、該当ページを解き直す', min: 60 },
        { id: `c3-${i}-b`, cat: null, label: 'アプリで模試モード', detail: '「ドリル」タブ → 模試20問。時間内に正確に解く練習', min: 45 },
        { id: `c3-${i}-c`, cat: null, label: '間違い直し', detail: '今日間違えた問題の解法を自分の言葉でメモに書き出す', min: 15 },
      ],
    });
  }

  // 直前調整
  if (reserved === 2) {
    packed.push({
      phase: 4,
      tasks: [
        { id: 'pre-1a', cat: null, label: '全分野の速解法を総ざらい', detail: '書籍P.35–419を高速で流し読みし、解法が浮かぶか確認', min: 60 },
        { id: 'pre-1b', cat: null, label: '苦手トップ3分野の最終演習', detail: '記録タブのワースト3分野をアプリと書籍で仕上げる', min: 40 },
        { id: 'pre-1c', cat: null, label: '性格検査の最終確認', detail: '書籍P.421–430を再読。正直に・直感で・一貫して', min: 20 },
      ],
    });
    packed.push({
      phase: 4,
      tasks: [
        { id: 'pre-2a', cat: null, label: '腕慣らし10問だけ', detail: '「おまかせ10問」を軽く。新しいことはやらない', min: 20 },
        { id: 'pre-2b', cat: null, label: '本番準備の最終確認', detail: '本人確認書類・会場への行き方・予約時間をチェック', min: 15 },
        { id: 'pre-2c', cat: null, label: '早めに就寝', detail: '睡眠が当日の処理速度を決める。夜更かし厳禁', min: 0 },
      ],
    });
  }

  // カレンダーに割当て
  const days = [];
  let si = 0;
  for (const c of calendar) {
    if (c.isBuffer) {
      days.push({ date: c.date, buffer: true, tasks: [] });
    } else {
      const p = packed[si];
      days.push({ date: c.date, buffer: false, phase: p ? p.phase : 0, tasks: p ? p.tasks : [] });
      si++;
    }
  }
  return days;
}

let PLAN = generatePlan();
const allPlanTasks = () => PLAN.flatMap(d => d.tasks);

/* ---------- ストリーク ---------- */
function streak() {
  let n = 0;
  let d = today();
  if (!state.act[ds(d)]) d = addDays(d, -1); // 今日まだでも昨日から継続中なら維持
  while (state.act[ds(d)]) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- 集計 ---------- */
function catStats(catId) {
  let a = 0, c = 0;
  const qids = QUESTIONS.filter(q => q.c === catId).map(q => q.id);
  for (const id of qids) {
    const s = state.qs[id];
    if (s) { a += s.a; c += s.c; }
  }
  return { a, c, acc: a ? c / a : null };
}
function totalStats() {
  let a = 0, c = 0;
  for (const id in state.qs) { a += state.qs[id].a; c += state.qs[id].c; }
  return { a, c, acc: a ? c / a : null };
}
function dueReviews() {
  const t = ds(today());
  return QUESTIONS.filter(q => {
    const s = state.qs[q.id];
    return s && s.a > s.c && s.due && s.due <= t;
  });
}
function planProgress() {
  const tasks = allPlanTasks();
  if (!tasks.length) return 0;
  return tasks.filter(t => state.done[t.id]).length / tasks.length;
}

/* ---------- SVGリング ---------- */
function ringSVG(pct, size, stroke, color, trackColor, label, sub) {
  const r = (size - stroke) / 2;
  const cir = 2 * Math.PI * r;
  const off = cir * (1 - Math.min(1, Math.max(0, pct)));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${cir}" stroke-dashoffset="${off}"
      transform="rotate(-90 ${size/2} ${size/2})" style="transition: stroke-dashoffset .6s cubic-bezier(.32,.72,.35,1)"/>
    <text x="50%" y="${sub ? '46%' : '50%'}" text-anchor="middle" dominant-baseline="central"
      font-size="${size * 0.21}" font-weight="800" fill="currentColor">${label}</text>
    ${sub ? `<text x="50%" y="64%" text-anchor="middle" font-size="${size * 0.1}" font-weight="600" fill="currentColor" opacity=".7">${sub}</text>` : ''}
  </svg>`;
}

/* ---------- タブ切替 ---------- */
function showPage(name) {
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.page === name));
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'plan') renderPlan();
  if (name === 'drill') renderDrillMenu();
  if (name === 'stats') renderStats();
  if (name === 'more') renderMore();
}

/* ===========================================================
   ホーム
   =========================================================== */
function renderHome() {
  const exam = parseDs(state.examDate);
  const t = today();
  const daysLeft = Math.round((exam - t) / 86400000);
  const prog = planProgress();
  const st = totalStats();
  const quote = QUOTES[Math.abs(Math.round(t / 86400000)) % QUOTES.length];

  $('#hero-days').innerHTML = daysLeft > 0
    ? `${daysLeft}<small>日</small>`
    : daysLeft === 0 ? '本番当日' : '受験期間中';
  $('#hero-date').textContent = `試験日 ${state.examDate.replace(/-/g, '/')}（${DOW[exam.getDay()]}）`;
  $('#hero-ring').innerHTML = ringSVG(prog, 92, 9, '#ffffff', 'rgba(255,255,255,.28)', `${Math.round(prog * 100)}%`, '進捗');
  $('#hero-quote').textContent = '💬 ' + quote;

  $('#stat-streak').innerHTML = `${streak()}<span class="unit">日</span>`;
  $('#stat-answered').innerHTML = `${st.a}<span class="unit">問</span>`;
  $('#stat-acc').innerHTML = st.acc === null ? '—' : `${Math.round(st.acc * 100)}<span class="unit">%</span>`;

  // 今日のタスク（遅れがあれば最も古い未完了日を提示）
  const tk = ds(t);
  let target = PLAN.find(d => ds(d.date) === tk);
  const firstIncomplete = PLAN.find(d => !d.buffer && d.tasks.some(x => !state.done[x.id]));
  let behindNote = '';
  if (firstIncomplete && ds(firstIncomplete.date) < tk) {
    target = firstIncomplete;
    const lateDays = Math.round((t - firstIncomplete.date) / 86400000);
    behindNote = `<div class="badge b-orange" style="margin-bottom:10px">⏰ ${lateDays}日分の未消化タスクがあります — ここから再開しましょう</div>`;
  }

  const box = $('#today-tasks');
  if (!target || (target.buffer && !behindNote)) {
    box.innerHTML = `<div class="empty"><span class="e-ico">🛋️</span>今日は予備日。遅れの回収か、完全休養を。<br>休むのも戦略のうち！</div>`;
  } else if (!target.tasks.length) {
    box.innerHTML = `<div class="empty"><span class="e-ico">🎉</span>プランはすべて完了！ドリルで仕上げを。</div>`;
  } else {
    box.innerHTML = behindNote + target.tasks.map(u => taskRowHTML(u)).join('');
    bindTaskRows(box);
  }

  const due = dueReviews().length;
  $('#btn-review-home').style.display = due ? '' : 'none';
  if (due) $('#btn-review-home').textContent = `🔁 復習キュー ${due}問を解く`;
}

function taskRowHTML(u) {
  const done = !!state.done[u.id];
  const cat = u.cat ? catById(u.cat) : null;
  return `<div class="task-row ${done ? 'done' : ''}" data-task="${u.id}">
    <div class="task-check">✓</div>
    <div class="task-main">
      <div class="t-label">${cat ? cat.icon + ' ' : ''}${u.label}</div>
      <div class="t-detail">${u.detail}</div>
      <div class="t-meta">${u.min ? `<span class="badge b-gray">⏱ 約${u.min}分</span>` : ''}${cat ? `<span class="badge b-blue">${cat.name}</span>` : ''}</div>
    </div>
  </div>`;
}
function bindTaskRows(root) {
  $$('.task-row', root).forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.task;
      if (state.done[id]) { delete state.done[id]; }
      else {
        state.done[id] = ds(today());
        state.xp += 30;
        markActivity();
        toast('✅ タスク完了！ +30 XP');
      }
      save();
      row.classList.toggle('done', !!state.done[id]);
      // 進捗リング等を更新
      const active = $('.page.active');
      if (active && active.id === 'page-home') {
        const prog = planProgress();
        $('#hero-ring').innerHTML = ringSVG(prog, 92, 9, '#ffffff', 'rgba(255,255,255,.28)', `${Math.round(prog * 100)}%`, '進捗');
      }
    });
  });
}

/* ===========================================================
   プラン
   =========================================================== */
const PHASE_INFO = {
  1: { name: '1周目 — 全分野を理解する', sub: '正誤より「解法の理解」を優先。すぐ解説を読んでOK', color: 'var(--blue)', icon: '📘' },
  2: { name: '2周目 — 速く正確に', sub: '間違えた問題中心に、制限時間を意識して解き直す', color: 'var(--purple)', icon: '⚡' },
  3: { name: '3周目 — 弱点つぶし＆実戦', sub: '弱点への集中投下と模試演習で得点力を最大化', color: 'var(--orange)', icon: '🎯' },
  4: { name: '直前調整', sub: '新しい問題はやらない。総ざらいとコンディション調整', color: 'var(--green)', icon: '🏁' },
};

function renderPlan() {
  const box = $('#plan-list');
  const tk = ds(today());
  let html = '';
  let lastPhase = 0;
  for (const day of PLAN) {
    if (!day.buffer && day.phase !== lastPhase && day.tasks.length) {
      const p = PHASE_INFO[day.phase];
      if (p) {
        html += `<div class="phase-head"><span class="ph-badge" style="background:${p.color}">${p.icon}</span><span>${p.name}<span class="ph-sub">${p.sub}</span></span></div>`;
        lastPhase = day.phase;
      }
    }
    const k = ds(day.date);
    const dow = day.date.getDay();
    const isToday = k === tk;
    const isPast = k < tk;
    if (day.buffer) {
      html += `<div class="rest-day">🛋️ ${day.date.getMonth() + 1}/${day.date.getDate()}（日）予備日 — 遅れの回収 or 休養</div>`;
      continue;
    }
    const incomplete = day.tasks.some(t => !state.done[t.id]);
    const totalMin = day.tasks.reduce((s, t) => s + (t.min || 0), 0);
    html += `<div class="card day-card ${isToday ? 'today-card' : ''} ${isPast && incomplete ? 'past-incomplete' : ''}" ${isToday ? 'id="plan-today"' : ''}>
      <div class="day-head">
        <div class="day-date">${day.date.getMonth() + 1}/${day.date.getDate()}<span class="dow ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">（${DOW[dow]}）</span>${isToday ? ' <span class="badge b-blue">今日</span>' : ''}</div>
        <div class="day-total">計 約${totalMin}分</div>
      </div>
      ${day.tasks.map(u => taskRowHTML(u)).join('')}
    </div>`;
  }
  box.innerHTML = html || '<div class="empty">プランを生成できませんでした。試験日を確認してください。</div>';
  bindTaskRows(box);
}

/* ===========================================================
   ドリル
   =========================================================== */
function accColor(acc) {
  if (acc === null) return 'var(--fill2)';
  if (acc >= 0.8) return 'var(--green)';
  if (acc >= 0.6) return 'var(--orange)';
  return 'var(--red)';
}

function renderDrillMenu() {
  const due = dueReviews().length;
  const btn = $('#btn-review');
  btn.textContent = due ? `🔁 復習キュー（${due}問が復習期日）` : '🔁 復習キュー（期日の問題なし）';
  btn.classList.toggle('secondary', !due);
  btn.classList.toggle('orange', !!due);

  const grid = $('#cat-grid');
  grid.innerHTML = BOOK.categories.map(c => {
    const s = catStats(c.id);
    const n = QUESTIONS.filter(q => q.c === c.id).length;
    const pct = s.acc === null ? 0 : s.acc;
    return `<button class="cat-cell" data-cat="${c.id}">
      <span class="c-name"><span class="ico">${c.icon}</span>${c.name}</span>
      <span class="c-stats">${s.a ? `正答率 ${Math.round(pct * 100)}%・${s.a}回答` : `未挑戦・全${n}問`}</span>
      <span class="mini-bar"><i style="width:${Math.round(pct * 100)}%; background:${accColor(s.acc)}"></i></span>
    </button>`;
  }).join('');
  $$('.cat-cell', grid).forEach(b => b.addEventListener('click', () => startQuiz('cat', b.dataset.cat)));
}

/* ---- 出題選択 ---- */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickQuestions(mode, catId) {
  const unseen = q => !state.qs[q.id];
  if (mode === 'cat') {
    return shuffle(QUESTIONS.filter(q => q.c === catId)).slice(0, 8);
  }
  if (mode === 'review') {
    return shuffle(dueReviews()).slice(0, 12);
  }
  if (mode === 'weak') {
    const ranked = BOOK.categories
      .map(c => ({ c, s: catStats(c.id) }))
      .filter(x => x.s.a > 0)
      .sort((a, b) => (a.s.acc ?? 1) - (b.s.acc ?? 1))
      .slice(0, 3).map(x => x.c.id);
    let pool = QUESTIONS.filter(q => ranked.includes(q.c));
    if (pool.length < 10) pool = pool.concat(shuffle(QUESTIONS.filter(q => !ranked.includes(q.c))).slice(0, 10 - pool.length));
    return shuffle(pool).slice(0, 10);
  }
  if (mode === 'mock') {
    // 頻出度で重み付けした20問
    const pool = [];
    for (const q of QUESTIONS) {
      const w = catById(q.c).weight;
      pool.push({ q, key: Math.random() * (1 / w) });
    }
    return pool.sort((a, b) => a.key - b.key).slice(0, 20).map(x => x.q);
  }
  // omakase: 未挑戦 > 復習期日 > ランダム
  const u = shuffle(QUESTIONS.filter(unseen));
  const d = shuffle(dueReviews().filter(q => !u.includes(q)));
  const rest = shuffle(QUESTIONS.filter(q => !u.includes(q) && !d.includes(q)));
  return [...u, ...d, ...rest].slice(0, 10);
}

/* ---- クイズ実行 ---- */
const quiz = { list: [], i: 0, ok: 0, timer: null, left: 0, answered: false, mode: '' };

function startQuiz(mode, catId) {
  const list = pickQuestions(mode, catId);
  if (!list.length) { toast('出題できる問題がありません'); return; }
  quiz.list = list; quiz.i = 0; quiz.ok = 0; quiz.mode = mode;
  showPage('quiz');
  renderQuestion();
}

function renderQuestion() {
  clearInterval(quiz.timer);
  const q = quiz.list[quiz.i];
  const cat = catById(q.c);
  quiz.answered = false;
  quiz.left = q.t;

  // 選択肢シャッフル
  const order = shuffle(q.ch.map((_, i) => i));
  quiz.order = order;

  $('#quiz-body').innerHTML = `
    <div class="quiz-top">
      <button class="quiz-exit" id="quiz-exit">✕ 終了</button>
      <div class="quiz-progress">${quiz.i + 1} / ${quiz.list.length}</div>
    </div>
    <div class="timer-track"><div class="timer-bar" id="timer-bar" style="width:100%"></div></div>
    <div class="q-cat">${cat.icon} ${cat.name}<span style="color:var(--label3)"> ・ 書籍${cat.pages}</span></div>
    <div class="q-text">${escapeHtml(q.q)}</div>
    <div id="choices">${order.map((oi, i) => `
      <button class="choice" data-oi="${oi}">
        <span class="letter">${'ABCD'[i]}</span><span>${escapeHtml(q.ch[oi])}</span>
      </button>`).join('')}
    </div>
    <div id="exp-slot"></div>
  `;
  $('#quiz-exit').addEventListener('click', endQuiz);
  $$('#choices .choice').forEach(b => b.addEventListener('click', () => answer(Number(b.dataset.oi))));

  const bar = $('#timer-bar');
  const t0 = Date.now();
  quiz.timer = setInterval(() => {
    const elapsed = (Date.now() - t0) / 1000;
    quiz.left = q.t - elapsed;
    const r = Math.max(0, quiz.left / q.t);
    bar.style.width = (r * 100) + '%';
    bar.classList.toggle('warn', r < 0.5 && r >= 0.25);
    bar.classList.toggle('danger', r < 0.25);
    if (quiz.left <= 0) { answer(-1); }
  }, 250);
}

function answer(oi) {
  if (quiz.answered) return;
  quiz.answered = true;
  clearInterval(quiz.timer);
  const q = quiz.list[quiz.i];
  const correct = oi === q.a;
  if (correct) { quiz.ok++; state.xp += 10; }
  updateSRS(q.id, correct);
  markActivity();
  save();

  $$('#choices .choice').forEach(b => {
    const bi = Number(b.dataset.oi);
    b.disabled = true;
    if (bi === q.a) b.classList.add('correct');
    else if (bi === oi) b.classList.add('wrong');
    else b.classList.add('dim');
  });

  const timeout = oi === -1;
  $('#exp-slot').innerHTML = `
    <div class="exp-card">
      <div class="exp-head ${correct ? 'ok' : 'ng'}">${correct ? '✅ 正解！ +10 XP' : timeout ? '⏰ 時間切れ' : '❌ 不正解'}</div>
      <div class="exp-body">${escapeHtml(q.e)}</div>
      <div class="exp-time">この問題の目安時間: ${q.t}秒 ${correct ? '' : '｜復習キューに追加されました'}</div>
    </div>
    <button class="btn" id="btn-next">${quiz.i + 1 < quiz.list.length ? '次の問題 →' : '結果を見る'}</button>
  `;
  $('#btn-next').addEventListener('click', () => {
    quiz.i++;
    if (quiz.i < quiz.list.length) renderQuestion();
    else showResult();
  });
  $('#btn-next').scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function updateSRS(qid, correct) {
  const s = state.qs[qid] || { a: 0, c: 0, box: 0, due: null };
  s.a++;
  if (correct) {
    s.c++;
    s.box = Math.min(s.box + 1, 4);
  } else {
    s.box = 0;
  }
  const gap = [1, 2, 4, 7, 14][s.box];
  s.due = ds(addDays(today(), gap));
  state.qs[qid] = s;
}

function showResult() {
  clearInterval(quiz.timer);
  state.sessions++;
  save();
  const n = quiz.list.length;
  const pct = Math.round((quiz.ok / n) * 100);
  const emoji = pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : pct >= 50 ? '💪' : '📖';
  const msg = pct >= 90 ? '素晴らしい！本番レベルの仕上がり'
    : pct >= 70 ? 'いい調子！間違えた問題だけ復習しよう'
    : pct >= 50 ? '解説の速解法を意識してもう一周'
    : '大丈夫、間違いは伸びしろ。解説をじっくり読もう';
  $('#quiz-body').innerHTML = `
    <div class="result-hero">
      <div class="r-emoji">${emoji}</div>
      <div class="r-score">${quiz.ok} / ${n} 問正解</div>
      <div class="r-msg">${msg}（+${quiz.ok * 10} XP）</div>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn secondary" id="btn-again">もう一度</button>
      <button class="btn" id="btn-done">ドリルに戻る</button>
    </div>
  `;
  $('#btn-again').addEventListener('click', () => startQuiz(quiz.mode, quiz.list[0].c));
  $('#btn-done').addEventListener('click', () => showPage('drill'));
}

function endQuiz() {
  clearInterval(quiz.timer);
  showPage('drill');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ===========================================================
   記録
   =========================================================== */
function renderStats() {
  const prog = planProgress();
  const st = totalStats();
  $('#stats-ring').innerHTML = ringSVG(prog, 110, 11, 'var(--blue)', 'var(--fill)', `${Math.round(prog * 100)}%`, 'プラン進捗');

  const tasks = allPlanTasks();
  const doneN = tasks.filter(t => state.done[t.id]).length;
  const startD = parseDs(state.planStart);
  const dayN = Math.round((today() - startD) / 86400000) + 1;
  $('#stats-kv').innerHTML = `
    <div class="kv-row"><span class="k">学習開始から</span><span class="v">${dayN}日目</span></div>
    <div class="kv-row"><span class="k">完了タスク</span><span class="v">${doneN} / ${tasks.length}</span></div>
    <div class="kv-row"><span class="k">総回答数</span><span class="v">${st.a}問</span></div>
    <div class="kv-row"><span class="k">総正答率</span><span class="v">${st.acc === null ? '—' : Math.round(st.acc * 100) + '%'}</span></div>
    <div class="kv-row"><span class="k">連続学習</span><span class="v">🔥 ${streak()}日</span></div>
    <div class="kv-row"><span class="k">累計XP</span><span class="v">⭐ ${state.xp}</span></div>
    <div class="kv-row"><span class="k">復習待ち</span><span class="v">${dueReviews().length}問</span></div>
  `;

  // 分野別
  $('#stats-cats').innerHTML = BOOK.categories.map(c => {
    const s = catStats(c.id);
    const pct = s.acc === null ? 0 : Math.round(s.acc * 100);
    return `<div class="cat-stat-row">
      <span class="ico">${c.icon}</span>
      <span class="name">${c.name}</span>
      <span class="bar mini-bar"><i style="width:${pct}%; background:${accColor(s.acc)}"></i></span>
      <span class="pct">${s.a ? pct + '%' : '—'}<span class="n">${s.a}回答</span></span>
    </div>`;
  }).join('');

  // 4週間ヒートマップ（今日を右下に）
  const cells = [];
  const t = today();
  const start = addDays(t, -27);
  for (let i = 0; i < 28; i++) {
    const d = addDays(start, i);
    const v = state.act[ds(d)] || 0;
    const lv = v >= 6 ? 3 : v >= 3 ? 2 : v >= 1 ? 1 : 0;
    cells.push(`<div class="heat-cell ${lv ? 'l' + lv : ''}"><span class="d">${d.getDate()}</span></div>`);
  }
  $('#stats-heat').innerHTML = cells.join('');
}

/* ===========================================================
   その他
   =========================================================== */
function renderMore() {
  $('#exam-date-input').value = state.examDate;
  $('#guide-list').innerHTML = GUIDES.map(g => `
    <button class="list-row" data-guide="${g.id}">
      <span class="ico">${g.icon}</span>${g.title}<span class="chev">›</span>
    </button>`).join('');
  $$('#guide-list .list-row').forEach(b => b.addEventListener('click', () => openGuide(b.dataset.guide)));
}

function openGuide(id) {
  const g = GUIDES.find(x => x.id === id);
  $('#guide-title').textContent = g.icon + ' ' + g.title;
  $('#guide-content').innerHTML = g.body.map(([h, p]) => `<h4>${h}</h4><p>${p}</p>`).join('');
  showPage('guide');
}

/* ---- 同期コード ---- */
function exportCode() {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  const area = $('#sync-export-area');
  area.value = payload;
  area.style.display = 'block';
  area.select();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(payload).then(() => toast('📋 同期コードをコピーしました'));
  } else {
    toast('コードを長押しでコピーしてください');
  }
}
function importCode() {
  const raw = $('#sync-import-area').value.trim();
  if (!raw) { toast('コードを貼り付けてください'); return; }
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!obj || obj.v !== 1) throw new Error('bad');
    if (!confirm('この端末の記録を、貼り付けたコードの内容で上書きします。よろしいですか？')) return;
    state = obj;
    save();
    PLAN = generatePlan();
    toast('✅ 取り込みました');
    showPage('home');
  } catch (e) {
    toast('⚠️ コードが正しくありません');
  }
}

/* ---------- 初期化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // タブ
  $$('.tab').forEach(t => t.addEventListener('click', () => showPage(t.dataset.page)));

  // ホームのクイックアクション
  $('#btn-omakase').addEventListener('click', () => startQuiz('omakase'));
  $('#btn-review-home').addEventListener('click', () => startQuiz('review'));

  // ドリルメニュー
  $('#btn-drill-omakase').addEventListener('click', () => startQuiz('omakase'));
  $('#btn-weak').addEventListener('click', () => startQuiz('weak'));
  $('#btn-mock').addEventListener('click', () => startQuiz('mock'));
  $('#btn-review').addEventListener('click', () => startQuiz('review'));

  // プラン
  $('#btn-goto-today').addEventListener('click', () => {
    const el = $('#plan-today');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast('今日は予備日です');
  });

  // 設定
  $('#exam-date-input').addEventListener('change', e => {
    const v = e.target.value;
    if (!v) return;
    state.examDate = v;
    save();
    PLAN = generatePlan();
    toast('📅 試験日を更新し、プランを再生成しました');
  });
  $('#btn-export').addEventListener('click', exportCode);
  $('#btn-import').addEventListener('click', importCode);
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('すべての記録（進捗・回答履歴）を削除します。本当によろしいですか？')) return;
    if (!confirm('この操作は取り消せません。実行しますか？')) return;
    localStorage.removeItem(LS_KEY);
    location.reload();
  });
  $('#guide-back').addEventListener('click', () => showPage('more'));

  showPage('home');
});
