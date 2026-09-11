/* ====================================================================
 * 备考兔 · 上岸工作台 · 主应用逻辑 v2.1
 * ==================================================================== */

'use strict';

/* ---------- 工具函数 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEY = 'shangan_workspace_v2';
let _pushTimer = null, _syncing = false;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayOfYear = (dateStr) => {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
};

const daysBetween = (a, b) => Math.ceil((new Date(b) - new Date(a)) / 86400000);

const fmtDateCN = (date) => {
  const d = new Date(date);
  const wk = ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${wk}`;
};

const weekRange = () => {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - day);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { start: f(mon), end: f(sun) };
};

const weekOfYear = () => {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d - start + ((start.getDay() + 6) % 7) * 86400000;
  return Math.floor(diff / 604800000) + 1;
};

const seededShuffle = (arr, seed) => {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const toast = (msg, type = 'info') => {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type === 'error' ? 'error' : ''}`;
  setTimeout(() => { el.className = 'toast'; }, 2200);
};

/* ---------- 数据存储 ---------- */
const defaultState = () => ({
  exams: [...DEFAULT_EXAMS],
  examInfo: typeof DEFAULT_EXAM_INFO !== 'undefined' ? [...DEFAULT_EXAM_INFO] : [],
  plans: [],
  checkins: {},
  stats: [],
  errors: [],
  maoIdx: null,
  qtyIdx: null,
  progress: { language: {}, politics: {}, commonSense: {}, dataAnalysis: {} },
  notes: {},
  profile: { avatar: '', emoji: '🐰', nickname: '备考兔', motto: '每天进步一点点，上岸就在眼前 ✨' },
  pref: { navFolded: false, font: 'm', pastOffset: 0 },
  politicsToday: [],
  politicsPast: [],
  studyPlan: {},
  sync: { url: '', anonKey: '', code: '', enabled: false, lastSync: '' },
  meta: { firstOpen: today(), streak: 0, lastCheckin: '' },
});

let state = defaultState();

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state = { ...defaultState(), ...parsed,
      profile: { ...defaultState().profile, ...(parsed.profile || {}) },
      pref: { ...defaultState().pref, ...(parsed.pref || {}) },
      progress: { ...defaultState().progress, ...(parsed.progress || {}) },
      notes: parsed.notes || {},
      politicsToday: parsed.politicsToday || [],
      politicsPast: parsed.politicsPast || [],
      studyPlan: parsed.studyPlan || {},
      examInfo: parsed.examInfo || defaultState().examInfo,
      sync: parsed.sync || {},
      meta: { ...defaultState().meta, ...(parsed.meta || {}) } };
    // 旧考试数据迁移：补齐 type / subjects
    state.exams = (state.exams || []).map(migrateExam);
  } catch (e) { console.warn('数据读取失败', e); }
};

const EXAM_TYPE_HINTS = ['国考', '省考', '选调', '市考'];
const DEFAULT_SUBJECTS = {
  '国考笔试': [
    { name: '行政职业能力测验', duration: '120分钟', timeRange: '9:00-11:00' },
    { name: '申论', duration: '180分钟', timeRange: '14:00-17:00' },
  ],
  '国考': [
    { name: '行政职业能力测验', duration: '120分钟', timeRange: '9:00-11:00' },
    { name: '申论', duration: '180分钟', timeRange: '14:00-17:00' },
  ],
  '湖北省选调': [
    { name: '综合能力测试', duration: '180分钟', timeRange: '9:00-12:00' },
  ],
  '湖北选调': [
    { name: '综合能力测试', duration: '180分钟', timeRange: '9:00-12:00' },
  ],
  '上海市选调': [
    { name: '综合能力测试', duration: '180分钟', timeRange: '9:00-12:00' },
  ],
  '上海选调': [
    { name: '综合能力测试', duration: '180分钟', timeRange: '9:00-12:00' },
  ],
};
const migrateExam = (exam) => {
  if (!exam) return exam;
  if (!exam.type) {
    const hint = EXAM_TYPE_HINTS.find(t => exam.name && exam.name.includes(t));
    exam.type = hint || '其他';
  }
  if (!exam.subjects || !exam.subjects.length) {
    for (const key of Object.keys(DEFAULT_SUBJECTS)) {
      if (exam.name && exam.name.includes(key)) {
        exam.subjects = DEFAULT_SUBJECTS[key].map(s => ({ ...s }));
        break;
      }
    }
    if (!exam.subjects) exam.subjects = [];
  }
  return exam;
};

let _saveTimer = null;
const saveState = () => {
  const pill = $('#syncPill');
  if (pill) { pill.textContent = '💾 保存中'; pill.classList.add('saving'); }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (pill) {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => { pill.textContent = '🟢 已保存'; pill.classList.remove('saving'); }, 400);
    }
  } catch (e) {
    if (pill) { pill.textContent = '⚠️ 无法保存'; pill.classList.remove('saving'); }
    toast('保存失败：' + e.message, 'error');
  }
  if (state.sync && state.sync.enabled && state.sync.url && state.sync.anonKey && !_syncing) {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(pushToCloud, 1500);
  }
};

/* ---------- 路由 ---------- */
const ROUTES = [
  'home', 'countdown', 'daily-plan',
  'politics', 'common-sense', 'language', 'logic',
  'quantity', 'data-analysis', 'stats',
  'shenlun-small', 'shenlun-big', 'errors', 'exam-info',
  'tool-percent', 'tool-politics', 'tool-growth', 'tool-section'
];
const MODULE_ROUTES = ['politics','common-sense','language','logic','quantity','data-analysis','shenlun-small','shenlun-big'];
const ROUTE_CAT = {
  'politics':'政治理论','common-sense':'常识','language':'言语理解','logic':'逻辑判断',
  'quantity':'数量关系','data-analysis':'资料分析','shenlun-small':'申论','shenlun-big':'申论'
};
const COURSE_FOR_ROUTE = { 'politics':'politics','common-sense':'commonSense','language':'language','data-analysis':'dataAnalysis' };

const navigate = (route) => {
  if (!ROUTES.includes(route)) route = 'home';
  // 离开百分化游戏时停表并收起弹层（保留进度，回来可继续）
  if (route !== 'tool-percent') { try { stopPcfTimer(); closePcfOverlay(); } catch (_) {} }
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.route === route));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === route));
  onEnter(route);
  if (window.innerWidth <= 900) closeSidebar();
  history.replaceState(null, '', '#' + route);
  const fab = $('#planFab');
  if (fab) fab.style.display = (route === 'daily-plan') ? 'block' : 'none';
};

const onEnter = (route) => {
  switch (route) {
    case 'countdown': renderCountdown(); break;
    case 'daily-plan': renderDailyPlan(); break;
    case 'politics': renderPolitics(); break;
    case 'common-sense': renderCommonSense(); break;
    case 'language': renderLanguage(); break;
    case 'logic': renderLogic(); break;
    case 'quantity': renderQuantity(); break;
    case 'data-analysis': renderDataAnalysis(); break;
    case 'stats': renderStats(); break;
    case 'shenlun-small': renderShenlunSmall(); break;
    case 'shenlun-big': renderShenlunBig(); break;
    case 'errors': renderErrors(); break;
    case 'exam-info': renderExamInfo(); break;
    case 'tool-percent': renderToolPercent(); break;
    case 'tool-politics': renderToolPolitics(); break;
    case 'tool-growth': renderToolGrowth(); break;
    case 'tool-section': renderToolSection(); break;
  }
  if (MODULE_ROUTES.includes(route)) renderModuleHeader(route);
};

/* ---------- 顶部信息 ---------- */
const renderTopbar = () => {
  $('#todayDate').textContent = fmtDateCN(today());
  $('#streakBadge').textContent = `🔥 ${calcStreak()}`;
  $('#syncPill').textContent = '🟢 已保存';
};

const calcStreak = () => {
  let s = 0;
  let d = new Date();
  while (true) {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const planCount = state.plans.filter(p => (state.checkins[key] || {})[p.id]).length;
    if (state.plans.length > 0 && planCount > 0) { s++; d.setDate(d.getDate()-1); }
    else break;
  }
  return s;
};

/* ---------- 倒计时 / 毛选金句 ---------- */
let maoIdx = 0;
const renderCountdown = () => {
  if (state.maoIdx === null || state.maoIdx === undefined) maoIdx = dayOfYear(today()) % MAO_QUOTES.length;
  else maoIdx = state.maoIdx;
  const q = MAO_QUOTES[maoIdx];
  $('#maoQuote').textContent = '"' + q.text + '"';
  $('#maoSource').textContent = '—— ' + q.source;
  $('#maoDateTag').textContent = today();
  $('#maoCounter').textContent = `${maoIdx + 1} / ${MAO_QUOTES.length}`;
  renderExamList();
};

const renderExamList = () => {
  const el = $('#examList');
  if (!state.exams.length) {
    el.innerHTML = '<div class="muted" style="text-align:center;padding:16px">还没有考试，点击右上角"添加考试"</div>';
    return;
  }
  const sorted = [...state.exams].sort((a, b) => {
    const da = daysBetween(today(), a.date);
    const db = daysBetween(today(), b.date);
    if (da < 0 && db < 0) return db - da;
    if (da < 0) return 1;
    if (db < 0) return -1;
    return da - db;
  });
  el.innerHTML = sorted.map(exam => {
    const days = daysBetween(today(), exam.date);
    const urgent = days <= 30 && days >= 0;
    const passed = days < 0;
    const regDays = exam.regDate ? daysBetween(today(), exam.regDate) : null;
    const regPassed = regDays !== null && regDays < 0;
    const regText = regRangeText(exam)
      ? `报名：${regRangeText(exam)}${regStatusText(exam) ? ' · ' + regStatusText(exam) : ''}`
      : '报名日期未设置';
    return `
      <div class="exam-card ${urgent ? 'urgent' : ''} ${passed ? 'passed' : ''}" data-detail-exam="${exam.id}">
        <div class="exam-card-top">
          <div class="exam-card-title">${escapeHtml(exam.name)}</div>
          <div class="exam-card-actions">
            <button class="ghost-btn small" data-edit-exam="${exam.id}" title="编辑">✏️ 编辑</button>
            <button class="danger-btn" data-del-exam="${exam.id}" title="删除">删除</button>
          </div>
        </div>
        <div class="exam-card-main">
          <div class="exam-card-days">${passed ? '已结束' : days}<span class="exam-card-unit">${passed ? '' : '天后开考'}</span></div>
          <div class="exam-card-meta">
            <div class="exam-card-date">📅 考试：${exam.date}</div>
            <div class="exam-card-reg">⏰ ${regText}</div>
          </div>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-del-exam]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('确定删除该考试？')) return;
      state.exams = state.exams.filter(e => e.id !== btn.dataset.delExam);
      saveState(); renderExamList(); toast('已删除');
    });
  });
  el.querySelectorAll('[data-edit-exam]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const exam = state.exams.find(e => e.id === btn.dataset.editExam);
      if (exam) openExamModal(exam);
    });
  });
  el.querySelectorAll('[data-detail-exam]').forEach(card => {
    card.addEventListener('click', () => {
      const exam = state.exams.find(e => e.id === card.dataset.detailExam);
      if (exam) openExamDetail(exam);
    });
  });
};

const addExam = () => { openExamModal(null); };

const openExamDetail = (exam) => {
  const days = daysBetween(today(), exam.date);
  const passed = days < 0;
  $('#detailExamName').textContent = exam.name;
  $('#detailExamStatus').textContent = passed ? '已结束' : `${days} 天后开考`;
  $('#detailExamDate').textContent = `考试日期：${exam.date}`;
  const regDays = exam.regDate ? daysBetween(today(), exam.regDate) : null;
  const regPassed = regDays !== null && regDays < 0;
  $('#detailExamReg').textContent = regRangeText(exam)
    ? `${regRangeText(exam)}${regStatusText(exam) ? '（' + regStatusText(exam) + '）' : ''}`
    : '未设置';
  const urlEl = $('#detailExamUrl');
  if (exam.url) { urlEl.href = exam.url; urlEl.textContent = exam.url; urlEl.style.display = 'inline-flex'; }
  else { urlEl.style.display = 'none'; }
  const subEl = $('#detailExamSubjects');
  if (exam.subjects && exam.subjects.length) {
    subEl.innerHTML = exam.subjects.map(s => `
      <div class="exam-subject-item">
        <span class="exam-subject-name">${escapeHtml(s.name)}</span>
        <span class="exam-subject-tag">${escapeHtml(s.duration)}</span>
        ${s.timeRange ? `<span class="exam-subject-tag time">${escapeHtml(s.timeRange)}</span>` : ''}
      </div>`).join('');
  } else {
    subEl.innerHTML = '<div class="muted">暂未填写笔试科目</div>';
  }
  $('#detailExamEdit').onclick = () => { $('#examDetailModal').hidden = true; openExamModal(exam); };
  $('#detailExamDelete').onclick = () => {
    if (!confirm('确定删除该考试？')) return;
    state.exams = state.exams.filter(e => e.id !== exam.id);
    saveState(); $('#examDetailModal').hidden = true; renderExamList(); toast('已删除');
  };
  $('#detailExamClose').onclick = () => { $('#examDetailModal').hidden = true; };
  $('#examDetailModal').hidden = false;
};

let examEditTarget = null;
const openExamModal = (exam) => {
  examEditTarget = exam;
  $('#examEditTitle').textContent = exam ? '编辑考试' : '添加考试';
  $('#examEditName').value = exam ? exam.name : '';
  $('#examEditDate').value = exam ? exam.date : '';
  $('#examEditRegStart').value = exam ? (exam.registerStart || exam.regDate || '') : '';
  $('#examEditRegEnd').value = exam ? (exam.registerEnd || '') : '';
  $('#examEditUrl').value = exam ? (exam.url || '') : '';
  $('#examEditType').value = exam ? (exam.type || '其他') : '其他';
  renderExamSubjectInputs(exam ? (exam.subjects || []) : []);
  $('#examEditModal').hidden = false;
};

const renderExamSubjectInputs = (subjects) => {
  const wrap = $('#examSubjectList');
  wrap.innerHTML = (subjects || []).map((s, i) => `
    <div class="exam-subject-input" data-si="${i}">
      <input type="text" class="text-input sub-name" placeholder="科目名" value="${escapeAttr(s.name)}">
      <input type="text" class="text-input sub-duration" placeholder="时限" value="${escapeAttr(s.duration)}">
      <input type="text" class="text-input sub-time" placeholder="时段 如 9:00-12:00" value="${escapeAttr(s.timeRange || '')}">
      <button type="button" class="danger-btn sub-del">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.sub-del').forEach(btn => {
    btn.addEventListener('click', () => { btn.closest('.exam-subject-input').remove(); });
  });
};

const addExamSubjectRow = () => {
  const wrap = $('#examSubjectList');
  const div = document.createElement('div');
  div.className = 'exam-subject-input';
  div.innerHTML = `
    <input type="text" class="text-input sub-name" placeholder="科目名">
    <input type="text" class="text-input sub-duration" placeholder="时限">
    <input type="text" class="text-input sub-time" placeholder="时段 如 9:00-12:00">
    <button type="button" class="danger-btn sub-del">✕</button>`;
  div.querySelector('.sub-del').addEventListener('click', () => div.remove());
  wrap.appendChild(div);
};

const saveExam = () => {
  const name = $('#examEditName').value.trim();
  const date = $('#examEditDate').value;
  const regStart = $('#examEditRegStart').value;
  const regEnd = $('#examEditRegEnd').value;
  const url = $('#examEditUrl').value.trim();
  const type = $('#examEditType').value;
  if (!name) { toast('请填写考试名称', 'error'); return; }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('请选择考试日期', 'error'); return; }
  const subjects = [];
  $('#examSubjectList').querySelectorAll('.exam-subject-input').forEach(row => {
    const n = row.querySelector('.sub-name').value.trim();
    const d = row.querySelector('.sub-duration').value.trim();
    const t = row.querySelector('.sub-time').value.trim();
    if (n) subjects.push({ name: n, duration: d, timeRange: t });
  });
  const payload = { name, date, type, subjects };
  if (regStart && /^\d{4}-\d{2}-\d{2}$/.test(regStart)) payload.registerStart = regStart;
  if (regEnd && /^\d{4}-\d{2}-\d{2}$/.test(regEnd)) payload.registerEnd = regEnd;
  if (!payload.registerStart && !payload.registerEnd) payload.regDate = '';
  if (url && /^https?:\/\//i.test(url)) payload.url = url;
  if (examEditTarget) {
    Object.assign(examEditTarget, payload);
    toast('已保存');
  } else {
    payload.id = 'e_' + Date.now();
    state.exams.push(payload);
    toast('已添加');
  }
  saveState(); renderExamList(); $('#examEditModal').hidden = true;
};

const rotateMao = (delta) => {
  maoIdx = (maoIdx + delta + MAO_QUOTES.length) % MAO_QUOTES.length;
  state.maoIdx = maoIdx; saveState(); renderCountdown();
};

/* ---------- 每日计划 ---------- */
const renderDailyPlan = () => {
  $('#todayDateLabel').textContent = fmtDateCN(today());
  renderPlanList();
  renderProgress();
};

const renderPlanList = () => {
  const el = $('#planList');
  if (!state.plans.length) {
    el.innerHTML = '<div class="muted" style="text-align:center;padding:16px">还没有计划目标，请在上方添加 ↑</div>';
    return;
  }
  const checks = state.checkins[today()] || {};
  el.innerHTML = state.plans.map(p => {
    const done = !!checks[p.id];
    return `
      <div class="plan-item ${done ? 'done' : ''}" data-pid="${p.id}">
        <div class="plan-check" data-toggle="${p.id}">${done ? '✓' : ''}</div>
        <div class="plan-text">${escapeHtml(p.text)}</div>
        <span class="plan-cat">${escapeHtml(p.category)}</span>
        <button class="danger-btn" data-del-plan="${p.id}">删</button>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', () => toggleCheckin(el.dataset.toggle)));
  el.querySelectorAll('[data-del-plan]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('确定删除该计划？')) return;
    const id = btn.dataset.delPlan;
    state.plans = state.plans.filter(p => p.id !== id);
    Object.keys(state.checkins).forEach(k => delete state.checkins[k][id]);
    saveState(); renderPlanList(); renderProgress(); renderTopbar(); toast('已删除');
  }));
};

const toggleCheckin = (planId) => {
  const t = today();
  state.checkins[t] = state.checkins[t] || {};
  state.checkins[t][planId] = !state.checkins[t][planId];
  saveState(); renderPlanList(); renderProgress(); renderTopbar();
};

const addPlan = () => {
  const text = $('#planInput').value.trim();
  const category = $('#planCategory').value;
  if (!text) { toast('请输入计划内容', 'error'); return; }
  state.plans.push({ id: 'p_' + Date.now(), text, category, createdAt: today() });
  $('#planInput').value = '';
  saveState(); renderPlanList(); renderProgress(); toast('已添加');
};

const renderProgress = () => {
  const el = $('#progressGrid');
  const allDates = Object.keys(state.checkins);
  const totalPerCat = {};
  state.plans.forEach(p => {
    totalPerCat[p.category] = totalPerCat[p.category] || { done: 0, all: 0 };
    totalPerCat[p.category].all += allDates.length;
    allDates.forEach(d => { if (state.checkins[d] && state.checkins[d][p.id]) totalPerCat[p.category].done++; });
  });
  const t = today();
  const todayChecks = state.checkins[t] || {};
  state.plans.forEach(p => {
    if (!totalPerCat[p.category]) totalPerCat[p.category] = { done: 0, all: 0 };
    totalPerCat[p.category].all += 1;
    if (todayChecks[p.id]) totalPerCat[p.category].done += 1;
  });
  const todayPlanCount = state.plans.length;
  const todayDoneCount = state.plans.filter(p => todayChecks[p.id]).length;
  const todayPct = todayPlanCount ? Math.round(todayDoneCount / todayPlanCount * 100) : 0;
  let html = `
    <div class="progress-item">
      <div class="progress-item-head"><span class="progress-item-name">📅 今日完成</span><span class="progress-item-val">${todayDoneCount}/${todayPlanCount}</span></div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${todayPct}%"></div></div>
    </div>`;
  Object.keys(totalPerCat).forEach(cat => {
    const { done, all } = totalPerCat[cat];
    const pct = all ? Math.round(done / all * 100) : 0;
    html += `
      <div class="progress-item">
        <div class="progress-item-head"><span class="progress-item-name">${escapeHtml(cat)}</span><span class="progress-item-val">${done}/${all}</span></div>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  });
  el.innerHTML = html;
};

/* ---------- 模块头部：待办 + 进度 ---------- */
const coursePct = (key) => {
  const course = COURSES[key];
  if (!course) return { done: 0, total: 0, pct: 0 };
  const prog = state.progress[key] || {};
  const total = course.items.length;
  const done = course.items.filter((_, i) => prog[i]).length;
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
};

const renderModuleHeader = (route) => {
  const el = $(`#mhead-${route}`);
  if (!el) return;
  const cat = ROUTE_CAT[route];
  const todos = state.plans.filter(p => p.category === cat);
  const checks = state.checkins[today()] || {};
  let todoHtml;
  if (!todos.length) {
    todoHtml = `<div class="mh-todo-empty">暂无该模块打卡目标，可在「每日计划」中添加 📝</div>`;
  } else {
    todoHtml = todos.map(p => {
      const done = !!checks[p.id];
      return `<div class="mh-todo-item ${done ? 'done' : ''}">
        <div class="mh-todo-check" data-mtodo="${p.id}">${done ? '✓' : ''}</div>
        <div class="mh-todo-text">${escapeHtml(p.text)}</div></div>`;
    }).join('');
  }
  const courseKey = COURSE_FOR_ROUTE[route];
  let pct, progText;
  if (courseKey) {
    const c = coursePct(courseKey);
    pct = c.pct; progText = `课程完成 ${c.done}/${c.total} 节`;
  } else {
    const cnt = state.stats.filter(s => s.date === today() && s.module === cat).reduce((a, s) => a + s.count, 0);
    pct = Math.min(100, Math.round(cnt / 20 * 100)); progText = `今日已做 ${cnt} 题`;
  }
  el.innerHTML = `
    <div class="mh-todo">
      <div class="mh-title">📋 今日待办</div>
      ${todoHtml}
    </div>
    <div class="mh-progress">
      <div class="mh-title">📊 学习进度</div>
      <div class="mh-prog-bar"><div class="mh-prog-fill" style="width:${pct}%"></div></div>
      <div class="mh-prog-text">${progText} · ${pct}%</div>
    </div>`;
  el.querySelectorAll('[data-mtodo]').forEach(c => c.addEventListener('click', () => toggleCheckin(c.dataset.mtodo)));
};

/* ---------- 政治理论 ---------- */
const renderPolitics = () => {
  $('#politicsDate').textContent = fmtDateCN(today());
  const todayEl = $('#politicsToday');
  const todayNews = state.politicsToday.length ? state.politicsToday.slice(0, 5) : POLITICS_TODAY;
  todayEl.innerHTML = todayNews.map(n => newsItem(n)).join('');
  const pastEl = $('#politicsPast');
  const off = state.pref.pastOffset || 0;
  const past = state.politicsPast.length ? state.politicsPast.slice(0, 5) : seededShuffle(POLITICS_PAST, off + dayOfYear(today())).slice(0, 5);
  pastEl.innerHTML = past.map(n => newsItem(n)).join('');
  renderCourseProgress('politics');
  renderStudyPlan('politicsStudyPlan', 'politics');
};
const newsItem = (n) => `
  <li>
    <div class="news-title">${escapeHtml(n.title)}</div>
    <div class="news-key">${escapeHtml(n.key)}</div>
    <div class="news-source">来源：${escapeHtml(n.source)}（点击查阅原文）</div>
  </li>`;

/* ---------- 课程进度（通用） + 课程笔记 ---------- */
let noteTarget = null;
const renderCourseProgress = (key) => {
  const el = $(`#${key}Course`);
  if (!el) return;
  const course = COURSES[key];
  if (!course) { el.innerHTML = ''; return; }
  state.progress[key] = state.progress[key] || {};
  state.notes[key] = state.notes[key] || {};
  const prog = state.progress[key];
  const total = course.items.length;
  const done = course.items.filter((_, i) => prog[i]).length;
  const pct = total ? Math.round(done / total * 100) : 0;

  let html = `
    <div class="course-head" data-toggle-course="${key}">
      <span class="course-icon">📚</span>
      <span class="course-name">${escapeHtml(course.name)}</span>
      <span class="course-stat"><b>${done}</b>/${total} · ${pct}%</span>
      <button class="course-toggle">▾ 展开目录</button>
    </div>
    <div class="course-bar"><div class="course-bar-fill" style="width:${pct}%"></div></div>
    <div class="course-body" id="${key}CourseBody">`;

  let idx = 0;
  const sectionHtml = (sec, secStart) => {
    const secDone = sec.items.filter((_, j) => prog[secStart + j]).length;
    return `
      <div class="course-section">
        <div class="course-section-title"><span>${escapeHtml(sec.title)}</span><small>${secDone}/${sec.items.length}</small></div>
        <div class="course-list">
          ${sec.items.map((it, j) => courseItem(key, secStart + j, it, prog[secStart + j])).join('')}
        </div>
      </div>`;
  };
  if (course.sections) {
    course.sections.forEach(sec => { html += sectionHtml(sec, idx); idx += sec.items.length; });
  } else {
    html += `<div class="course-list">${course.items.map((it, i) => courseItem(key, i, it, prog[i])).join('')}</div>`;
  }
  html += `</div>`;
  el.innerHTML = html;

  if (location.search.includes('expand=1')) {
    el.querySelector(`#${key}CourseBody`)?.classList.add('show');
    const tgl = el.querySelector('.course-toggle'); if (tgl) tgl.textContent = '▴ 收起';
  }

  el.querySelector(`[data-toggle-course="${key}"]`)?.addEventListener('click', () => {
    const body = el.querySelector(`#${key}CourseBody`);
    body.classList.toggle('show');
    const tgl = el.querySelector('.course-toggle');
    tgl.textContent = body.classList.contains('show') ? '▴ 收起' : '▾ 展开目录';
  });
  el.querySelectorAll('[data-ck]').forEach(c => c.addEventListener('click', () => {
    const [k, i] = c.dataset.ck.split(':'); const i2 = +i;
    state.progress[k] = state.progress[k] || {};
    state.progress[k][i2] = !state.progress[k][i2];
    if (!state.progress[k][i2]) delete state.progress[k][i2];
    saveState(); renderCourseProgress(k);
  }));
  el.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const [k, i] = b.dataset.note.split(':');
    openNoteModal(k, +i);
  }));
};
const courseItem = (key, i, text, isDone) => {
  const hasNote = state.notes[key] && state.notes[key][i] && (state.notes[key][i].text || state.notes[key][i].image);
  return `
    <div class="course-item ${isDone ? 'done' : ''}">
      <div class="course-check" data-ck="${key}:${i}">${isDone ? '✓' : ''}</div>
      <div class="course-item-text">${escapeHtml(text)}</div>
      <button class="course-note-btn" data-note="${key}:${i}" title="添加笔记">📝${hasNote ? '<span class="course-note-dot"></span>' : ''}</button>
    </div>`;
};

/* ---------- 追剧式五轮复习（数据来自 study_plan.js / 小黑 xlsx 总进度表） ---------- */
const escapeAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const SP_FIELDS = ['study','r1','r2','r3','r4','r5'];
const SP_LABELS = ['初学','巩固1','巩固2','巩固3','巩固4','巩固5'];
const renderStudyPlan = (containerId, scope) => {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (typeof STUDY_PLAN === 'undefined') { el.innerHTML = '<div class="muted">复习计划数据未加载</div>'; return; }
  state.studyPlan = state.studyPlan || {};
  const tStr = today();
  const courses = STUDY_PLAN.courses.filter(c => {
    if (scope === 'politics') return c.m === '政治理论';
    return c.m !== '政治理论' && c.m !== '导学';
  });
  let tInit = 0, tRev = 0;
  courses.forEach(c => { if (c.d === tStr) tInit++; c.r.forEach(rd => { if (rd === tStr) tRev++; }); });

  const groups = {};
  courses.forEach(c => { (groups[c.m] = groups[c.m] || []).push(c); });
  const groupNames = Object.keys(groups);

  const cellHtml = (c, fi) => {
    const dateStr = fi === 0 ? c.d : c.r[fi - 1];
    const st = state.studyPlan[c.t] || {};
    const done = !!st[SP_FIELDS[fi]];
    const isToday = dateStr === tStr;
    return `<div class="sp-cell ${done?'done':''} ${isToday?'today':''}" data-title="${escapeAttr(c.t)}" data-field="${SP_FIELDS[fi]}" title="${SP_LABELS[fi]}：${dateStr}">${done?'✓':''}</div>`;
  };
  const rowHtml = (c) => {
    const st = state.studyPlan[c.t] || {};
    const allDone = SP_FIELDS.every(f => st[f]);
    const isTodayRow = (c.d === tStr) || c.r.indexOf(tStr) >= 0;
    return `<div class="sp-row ${allDone?'all-done':''} ${isTodayRow?'today-row':''}">
      <div class="sp-seq">${c.s}</div>
      <div class="sp-title">${escapeHtml(c.t)}</div>
      <div class="sp-cells">${SP_FIELDS.map((_,fi)=>cellHtml(c,fi)).join('')}</div>
    </div>`;
  };

  let html = '';
  groupNames.forEach((g, gi) => {
    const list = groups[g];
    const doneCount = list.filter(c => SP_FIELDS.every(f => (state.studyPlan[c.t]||{})[f])).length;
    const collapsed = (scope === 'common') ? 'collapsed' : '';
    const gid = 'spg-' + scope + '-' + gi;
    html += `<div class="sp-group ${collapsed}" data-group="${escapeAttr(g)}">
      <div class="sp-group-head" data-toggle-group="${gid}">
        <span class="sp-group-title">${escapeHtml(g)}</span>
        <span class="sp-group-stat">${doneCount}/${list.length}</span>
        <span class="sp-group-toggle">${collapsed?'▸':'▾'}</span>
      </div>
      <div class="sp-group-body" id="${gid}">
        ${list.map(rowHtml).join('')}
      </div>
    </div>`;
  });
  el.innerHTML = html;

  const summaryId = containerId === 'politicsStudyPlan' ? 'spPoliticsSummary' : 'spCommonSenseSummary';
  const sumEl = document.getElementById(summaryId);
  if (sumEl) {
    sumEl.textContent = (tInit + tRev === 0)
      ? `计划 ${STUDY_PLAN.start} 起 · 共 ${courses.length} 节 · 今日无任务`
      : `今日：初学 ${tInit} · 巩固 ${tRev}`;
  }

  el.querySelectorAll('.sp-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const title = cell.dataset.title, field = cell.dataset.field;
      state.studyPlan[title] = state.studyPlan[title] || {};
      const cur = !!state.studyPlan[title][field];
      if (cur) delete state.studyPlan[title][field]; else state.studyPlan[title][field] = true;
      cell.classList.toggle('done', !cur);
      cell.textContent = !cur ? '✓' : '';
      const row = cell.closest('.sp-row');
      const st = state.studyPlan[title];
      row.classList.toggle('all-done', SP_FIELDS.every(f => st[f]));
      const grp = cell.closest('.sp-group');
      const total = grp.querySelectorAll('.sp-row').length;
      const dcount = grp.querySelectorAll('.sp-row.all-done').length;
      grp.querySelector('.sp-group-stat').textContent = `${dcount}/${total}`;
      saveState();
    });
  });
  el.querySelectorAll('[data-toggle-group]').forEach(h => {
    h.addEventListener('click', () => {
      const grp = h.closest('.sp-group');
      grp.classList.toggle('collapsed');
      h.querySelector('.sp-group-toggle').textContent = grp.classList.contains('collapsed') ? '▸' : '▾';
    });
  });
};

/* ---------- 课程笔记弹窗 ---------- */
let notePendingImage = null;
const openNoteModal = (key, idx) => {
  noteTarget = { key, idx };
  const course = COURSES[key];
  const label = course.sections
    ? course.sections.reduce((acc, s) => { acc.push(...s.items); return acc; }, [])[idx]
    : course.items[idx];
  $('#noteTitle').textContent = label || '课程笔记';
  const note = (state.notes[key] && state.notes[key][idx]) || {};
  $('#noteText').value = note.text || '';
  notePendingImage = note.image || null;
  if (note.image) {
    $('#noteImagePreview').src = note.image;
    $('#noteImagePreviewWrap').hidden = false;
    $('#noteImageLabel').textContent = '已选图片';
  } else {
    $('#noteImagePreviewWrap').hidden = true;
    $('#noteImageLabel').textContent = '';
  }
  $('#noteModal').hidden = false;
};
const saveNote = () => {
  if (!noteTarget) return;
  const { key, idx } = noteTarget;
  state.notes[key] = state.notes[key] || {};
  state.notes[key][idx] = { text: $('#noteText').value.trim(), image: notePendingImage || '' };
  saveState();
  $('#noteModal').hidden = true;
  toast('笔记已保存');
  if (COURSE_FOR_ROUTE) {
    Object.keys(COURSE_FOR_ROUTE).forEach(r => {
      if (COURSE_FOR_ROUTE[r] === key && $(`#${key}Course`)) renderCourseProgress(key);
    });
  }
};

/* ---------- 常识 ---------- */
const renderCommonSense = () => {
  $('#csDate').textContent = fmtDateCN(today());
  const startIdx = dayOfYear(today()) % CS_POOL.length;
  const list = [];
  for (let i = 0; i < 10; i++) list.push(CS_POOL[(startIdx + i) % CS_POOL.length]);
  const byCat = {};
  const chosen = [];
  list.forEach(c => { byCat[c.cat] = (byCat[c.cat] || 0) + 1; if (byCat[c.cat] <= 2) chosen.push(c); });
  $('#csList').innerHTML = chosen.map(c => `
    <div class="cs-item"><span class="cs-cat">${escapeHtml(c.cat)}</span><span class="cs-content">${escapeHtml(c.text)}</span></div>
  `).join('');
  renderCourseProgress('commonSense');
  renderStudyPlan('commonSenseStudyPlan', 'common');
};

/* ---------- 言语理解 ---------- */
const renderLanguage = () => {
  const startIdx = dayOfYear(today()) % IDIOM_POOL.length;
  const list = [];
  for (let i = 0; i < 5; i++) list.push(IDIOM_POOL[(startIdx + i) % IDIOM_POOL.length]);
  $('#idiomList').innerHTML = list.map(pair => `
    <div class="idiom-pair">
      <div class="idiom-cell">
        <div class="idiom-word">${escapeHtml(pair[0].word)}</div>
        <div class="idiom-meaning">${escapeHtml(pair[0].meaning)}</div>
      </div>
      <div class="idiom-vs">VS</div>
      <div class="idiom-cell">
        <div class="idiom-word">${escapeHtml(pair[1].word)}</div>
        <div class="idiom-meaning">${escapeHtml(pair[1].meaning)}</div>
      </div>
    </div>`).join('');
  renderCourseProgress('language');
  const startQ = dayOfYear(today()) % LANG_QUIZ_POOL.length;
  const quizzes = [0,1,2,3,4].map(k => LANG_QUIZ_POOL[(startQ + k) % LANG_QUIZ_POOL.length]);
  renderQuiz($('#langQuiz'), quizzes);
};

/* ---------- 逻辑判断（每日 3 题） ---------- */
const renderLogic = () => {
  const startIdx = dayOfYear(today()) % LOGIC_POOL.length;
  const list = [0,1,2].map(k => LOGIC_POOL[(startIdx + k) % LOGIC_POOL.length]);
  renderQuiz($('#logicQuiz'), list);
};

/* ---------- 数量关系 ---------- */
let qtyIdx = 0;
const renderQuantity = () => {
  if (state.qtyIdx === null || state.qtyIdx === undefined) qtyIdx = dayOfYear(today()) % QUANTITY_POOL.length;
  else qtyIdx = state.qtyIdx;
  const q = QUANTITY_POOL[qtyIdx];
  $('#qtyType').textContent = '📌 ' + q.type;
  $('#qtyFormula').innerHTML = q.formula.replace(/\n/g, '<br>');
  $('#qtyExample').innerHTML = `<div style="font-weight:700;color:var(--sky-deep);margin-bottom:0.3em">例题</div><pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(q.example)}</pre>`;
};
const rotateQty = () => { qtyIdx = (qtyIdx + 1) % QUANTITY_POOL.length; state.qtyIdx = qtyIdx; saveState(); renderQuantity(); };

/* ---------- 资料分析 ---------- */
const renderDataAnalysis = () => {
  $('#formulaGrid').innerHTML = FORMULA_LIST.map(f => `
    <div class="formula-card"><div class="formula-name">${escapeHtml(f.name)}</div><div class="formula-expr">${escapeHtml(f.expr)}</div></div>
  `).join('');
  renderCourseProgress('dataAnalysis');
  const startIdx = dayOfYear(today()) % FORMULA_QUIZ_POOL.length;
  renderQuiz($('#formulaQuiz'), [FORMULA_QUIZ_POOL[startIdx], FORMULA_QUIZ_POOL[(startIdx+1) % FORMULA_QUIZ_POOL.length]]);
  const sIdx = dayOfYear(today()) % DA_PERCENT_POOL.length;
  const pctList = [0, 1, 2].map(k => DA_PERCENT_POOL[(sIdx + k) % DA_PERCENT_POOL.length]);
  renderQuiz($('#daPercentQuiz'), pctList);
};

/* ---------- 通用测验渲染 ---------- */
const renderQuiz = (container, list) => {
  container.innerHTML = list.map((q, qi) => {
    const opts = q.opts.map((o, oi) => `<div class="quiz-opt" data-oi="${oi}">${String.fromCharCode(65+oi)}. ${escapeHtml(o).replace(/<b>/g,'<b>').replace(/<\/b>/g,'</b>')}</div>`).join('');
    return `<div class="quiz" data-qi="${qi}">
      <div class="quiz-q">${qi+1}. ${escapeHtml(q.q).replace(/\n/g,'<br>')}</div>
      <div class="quiz-opts">${opts}</div>
      <div class="quiz-check" style="display:none">✅ <strong>正确答案：${String.fromCharCode(65+q.ans)}</strong><br>${escapeHtml(q.explain)}</div>
    </div>`;
  }).join('');
  container.querySelectorAll('.quiz').forEach(quizEl => {
    const qi = +quizEl.dataset.qi; const q = list[qi];
    quizEl.querySelectorAll('.quiz-opt').forEach(optEl => optEl.addEventListener('click', () => {
      if (optEl.classList.contains('disabled')) return;
      const oi = +optEl.dataset.oi;
      quizEl.querySelectorAll('.quiz-opt').forEach(o => o.classList.add('disabled'));
      if (oi === q.ans) optEl.classList.add('correct');
      else { optEl.classList.add('wrong'); quizEl.querySelector(`.quiz-opt[data-oi="${q.ans}"]`)?.classList.add('correct'); }
      quizEl.querySelector('.quiz-check').style.display = 'block';
      quizEl.querySelector('.quiz-check').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  });
};

/* ---------- 每日统计 ---------- */
const renderStats = () => {
  const t = today();
  const todayStats = state.stats.filter(s => s.date === t);
  const byModule = {};
  todayStats.forEach(s => {
    byModule[s.module] = byModule[s.module] || { count: 0, duration: 0, correct: 0 };
    byModule[s.module].count += s.count; byModule[s.module].duration += s.duration; byModule[s.module].correct += s.correct;
  });
  const modules = ['政治理论','常识','言语理解','逻辑判断','数量关系','资料分析'];
  $('#statsGrid').innerHTML = modules.map(m => {
    const v = byModule[m] || { count: 0, duration: 0, correct: 0 };
    const acc = v.count ? Math.round(v.correct / v.count * 100) : 0;
    return `<div class="stat-card"><div class="stat-icon">${statIcon(m)}</div><div class="stat-name">${m}</div><div class="stat-val">${v.count}<small> 题</small></div><div class="muted">${v.duration} 分钟 · 正确率 ${acc}%</div></div>`;
  }).join('');
  renderTrend();
  const hist = $('#statHistory');
  if (!state.stats.length) hist.innerHTML = '<div class="muted" style="text-align:center;padding:16px">暂无记录</div>';
  else {
    const sorted = [...state.stats].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 50);
    hist.innerHTML = `<div class="stat-row stat-row-head"><span>日期</span><span>模块</span><span>题数/时长</span><span>正确率</span><span>操作</span></div>` +
      sorted.map(s => {
        const acc = s.count ? Math.round(s.correct / s.count * 100) : 0;
        return `<div class="stat-row"><span class="stat-cell-date">${s.date}</span><span>${escapeHtml(s.module)}</span><span>${s.count}题/${s.duration}分</span><span>${acc}%</span><span><button class="danger-btn" data-del-stat="${s.id}">删</button></span></div>`;
      }).join('');
    hist.querySelectorAll('[data-del-stat]').forEach(btn => btn.addEventListener('click', () => {
      state.stats = state.stats.filter(s => s.id !== btn.dataset.delStat);
      saveState(); renderStats(); toast('已删除');
    }));
  }
};

const renderTrend = () => {
  const el = $('#trendChart');
  if (!el) return;
  const metric = document.querySelector('input[name="trendMetric"]:checked')?.value || 'count';
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i);
    days.push({ date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, label: `${d.getMonth()+1}/${d.getDate()}`, value: 0 }); }
  state.stats.forEach(s => { const idx = days.findIndex(d => d.date === s.date); if (idx >= 0) days[idx].value += metric==='count'?s.count:s.duration; });
  const max = Math.max(1, ...days.map(d => d.value));
  let html = '<div class="heatmap">';
  days.forEach(d => {
    const level = d.value === 0 ? 0 : Math.min(4, Math.ceil(d.value / max * 4));
    const unit = metric === 'count' ? '题' : '分钟';
    html += `<div class="heat-cell level-${level}" title="${d.date} · ${d.value}${unit}"></div>`;
  });
  html += '</div><div class="heatmap-legend">';
  html += '<span>少</span><div class="heat-cell level-0"></div><div class="heat-cell level-1"></div><div class="heat-cell level-2"></div><div class="heat-cell level-3"></div><div class="heat-cell level-4"></div><span>多</span>';
  html += '</div>';
  el.innerHTML = html;
};
const statIcon = (m) => ({ '政治理论':'🏛️','常识':'🌐','言语理解':'💬','逻辑判断':'🧩','数量关系':'🔢','资料分析':'📊' }[m] || '📌');

const addStat = () => {
  const module = $('#statModule').value;
  const count = +$('#statCount').value || 0;
  const duration = +$('#statDuration').value || 0;
  const correct = +$('#statCorrect').value || 0;
  if (count <= 0) { toast('请填写做题数', 'error'); return; }
  state.stats.push({ id: 's_' + Date.now(), date: today(), module, count, duration, correct });
  $('#statCount').value = ''; $('#statDuration').value = ''; $('#statCorrect').value = '';
  saveState(); renderStats(); toast('已记录');
};

/* ---------- 示例数据 / 清空 ---------- */
const loadDemoData = () => {
  if (state.plans.length || state.errors.length || state.stats.length) {
    if (!confirm('当前已有数据，加载示例会追加在末尾。确定继续？')) return;
  }
  const t = today();
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const dayBefore = (() => { const d = new Date(); d.setDate(d.getDate()-2); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const demoPlans = [
    { id:'p1', category:'政治理论', text:'背诵习近平总书记最新讲话3则', createdAt:t },
    { id:'p2', category:'言语理解', text:'整理5 对形近成语', createdAt:t },
    { id:'p3', category:'逻辑判断', text:'完成判断推理 10 题', createdAt:t },
    { id:'p4', category:'数量关系', text:'工程问题公式默写', createdAt:t },
    { id:'p5', category:'资料分析', text:'增长率/基期专项 5 题', createdAt:t },
    { id:'p6', category:'常识', text:'法律常识 5 条', createdAt:t },
  ];
  demoPlans.forEach(p => { if (!state.plans.find(x => x.id === p.id)) state.plans.push(p); });
  state.checkins[t] = state.checkins[t] || {}; state.checkins[t]['p1'] = true; state.checkins[t]['p3'] = true;

  const demoStats = []; const modules = ['言语理解','逻辑判断','数量关系','资料分析','常识','政治理论'];
  let _id = 1;
  for (let d = 29; d >= 0; d--) {
    const dt = new Date(); dt.setDate(dt.getDate()-d);
    const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const recordsToday = (d % 2 === 0 || d < 7) ? Math.floor(Math.random()*3)+1 : (Math.random()>0.5?Math.floor(Math.random()*2)+1:0);
    for (let r = 0; r < recordsToday; r++) {
      const m = modules[Math.floor(Math.random()*modules.length)];
      const count = Math.floor(Math.random()*15)+5; const duration = Math.floor(Math.random()*25)+5; const correct = Math.floor(count*(0.5+Math.random()*0.45));
      demoStats.push({ id:`s${_id++}`, date:dateStr, module:m, count, duration, correct });
    }
  }
  demoStats.push({ id:'sA', date:t, module:'言语理解', count:15, duration:12, correct:12 });
  demoStats.push({ id:'sB', date:t, module:'逻辑判断', count:10, duration:15, correct:7 });
  demoStats.push({ id:'sC', date:t, module:'资料分析', count:8, duration:10, correct:6 });
  demoStats.forEach(s => { if (!state.stats.find(x => x.id === s.id)) state.stats.push(s); });

  const demoErrors = [
    { id:'e1', date:t, module:'资料分析', title:'增长率与增长量混淆', note:'做题时把"增长率 = 增长量 / 基期"错写成了"增长量 / 现期"。', image:'' },
    { id:'e2', date:t, module:'逻辑判断', title:'否定前件谬误', note:'所有 A 是 B → 非 A 不一定不是 B。', image:'' },
    { id:'e3', date:yesterday, module:'言语理解', title:'"不刊之论"vs"不易之论"', note:'两个都形容不能改的言论，差别在：不刊=不能削除；不易=不能改变。', image:'' },
    { id:'e4', date:yesterday, module:'数量关系', title:'鸡兔同笼公式记错', note:'总脚数 = 鸡×2 + 兔×4。', image:'' },
    { id:'e5', date:dayBefore, module:'常识', title:'四大名著作答', note:'《红楼梦》《三国演义》《西游记》《水浒传》。', image:'' },
  ];
  demoErrors.forEach(e => { if (!state.errors.find(x => x.id === e.id)) state.errors.push(e); });

  ['language','politics','commonSense','dataAnalysis'].forEach(k => {
    state.progress[k] = state.progress[k] || {};
    for (let i = 0; i < 3; i++) state.progress[k][i] = true;
  });

  saveState(); renderTopbar(); toast('示例数据已加载');
};

const clearAllData = () => {
  if (!confirm('确定清空所有数据？此操作不可恢复（建议先导出备份）。')) return;
  state = defaultState(); saveState(); renderTopbar(); navigate('home'); toast('已清空');
};

/* ---------- 申论小题（题型 + 长材料 + 解析 + 规范词） ---------- */
const renderShenlunSmall = () => {
  const idx = dayOfYear(today()) % SHENLUN_SMALL_POOL.length;
  const s = SHENLUN_SMALL_POOL[idx];
  const matId = 'slmat_' + idx;
  const analysisId = 'slanal_' + idx;
  const typeLabel = (s.type || '申论小题').replace(/-/g, ' · ');
  $('#slSmallContent').innerHTML = `
    <div class="sl-type-badge">${escapeHtml(typeLabel)}</div>
    <h4>📌 题目</h4>
    <div style="font-weight:700;color:var(--text-strong)">${escapeHtml(s.task)}</div>
    <h4>📰 给定材料</h4>
    <div class="sl-material-fold">
      <div class="sl-fold-toggle" data-fold="${matId}"><span>点击展开 / 收起材料全文</span><span>▾</span></div>
      <div class="sl-fold-body" id="${matId}">${escapeHtml(s.material).replace(/\n{2,}/g,'<br><br>').replace(/\n/g,'<br>')}</div>
    </div>
    <h4>📝 参考要点</h4>
    <div class="sl-outline">${escapeHtml(s.outline).replace(/\n/g,'<br>')}</div>
    <h4>🔍 解析</h4>
    <div class="sl-material-fold">
      <div class="sl-fold-toggle" data-fold="${analysisId}"><span>点击展开 / 收起解析</span><span>▾</span></div>
      <div class="sl-fold-body sl-analysis" id="${analysisId}">${escapeHtml(s.analysis).replace(/\n/g,'<br>')}</div>
    </div>`;
  bindFold($(`#slSmallContent [data-fold="${matId}"]`), $(`#${matId}`));
  bindFold($(`#slSmallContent [data-fold="${analysisId}"]`), $(`#${analysisId}`));
  renderNormWords();
};

const renderNormWords = () => {
  const start = dayOfYear(today()) % NORM_WORDS.length;
  const list = [0, 1, 2].map(k => NORM_WORDS[(start + k) % NORM_WORDS.length]);
  $('#normWordsList').innerHTML = list.map(w => `
    <div class="norm-item">
      <div class="norm-term">${escapeHtml(w.term)}</div>
      <div class="norm-meaning">${escapeHtml(w.meaning)}</div>
      <div class="norm-usage">适用：${escapeHtml(w.usage)}</div>
    </div>
  `).join('');
};

const bindFold = (toggle, body) => {
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    body.classList.toggle('show');
    toggle.querySelector('span:last-child').textContent = body.classList.contains('show') ? '▴' : '▾';
  });
};

/* ---------- 大作文 ---------- */
const renderShenlunBig = () => {
  const idx = dayOfYear(today()) % SHENLUN_BIG_POOL.length;
  const s = SHENLUN_BIG_POOL[idx];
  $('#slBigTheme').innerHTML = `
    <div style="font-size:1.05em;font-weight:800;color:var(--sky-deep);margin-bottom:10px">${escapeHtml(s.theme)}</div>
    <div class="muted">建议从"提出观点—分析论证—对策建议—升华结尾"四段式展开。</div>`;
  $('#slBigMaterial').innerHTML = `
    <h4>📚 理论 + 案例素材</h4>
    <ul>${s.material.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>
    <h4>📜 官方金句（注明来源）</h4>
    ${s.quotes.map(q => `<div class="sl-quote">${escapeHtml(q.text)}<div class="sl-source">—— ${escapeHtml(q.from)}</div></div>`).join('')}`;
  renderModelEssay();
};

const renderModelEssay = () => {
  const wk = weekOfYear();
  const idx = (wk - 1) % MODEL_ESSAYS.length;
  const e = MODEL_ESSAYS[idx];
  $('#modelEssay').innerHTML = `
    <div class="model-essay-meta">第 ${wk} 周 · 主题：${escapeHtml(e.theme)}</div>
    <div class="model-essay-title">${escapeHtml(e.title)}</div>
    <div class="model-essay-body">${escapeHtml(e.body).replace(/\n{2,}/g,'<br><br>').replace(/\n/g,'<br>')}</div>
  `;
};

/* ---------- 错题本 ---------- */
let pendingImage = null;
const renderErrors = () => { renderErrList(); renderErrWeekSummary(); updateExportCount(); };

const renderErrList = () => {
  const filter = $('#errFilter').value;
  const list = filter === 'all' ? state.errors : state.errors.filter(e => e.module === filter);
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
  const el = $('#errList');
  if (!sorted.length) { el.innerHTML = '<div class="muted" style="text-align:center;padding:16px">还没有错题，加油！</div>'; return; }
  el.innerHTML = sorted.map(e => `
    <div class="err-item" data-eid="${e.id}">
      <div class="err-actions"><button class="danger-btn" data-del-err="${e.id}">删除</button></div>
      <div class="err-item-head"><span class="err-title">${escapeHtml(e.title)}</span><span class="plan-cat">${escapeHtml(e.module)}</span></div>
      <div class="err-meta">📅 ${e.date}</div>
      ${e.note ? `<div class="err-note">${escapeHtml(e.note)}</div>` : ''}
      ${e.image ? `<img class="err-img" src="${e.image}" data-img-view="${e.id}">` : ''}
    </div>`).join('');
  el.querySelectorAll('[data-del-err]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('确定删除该错题？')) return;
    state.errors = state.errors.filter(e => e.id !== btn.dataset.delErr);
    saveState(); renderErrors(); toast('已删除');
  }));
  el.querySelectorAll('[data-img-view]').forEach(img => img.addEventListener('click', () => window.open(img.src, '_blank')));
};

const renderErrWeekSummary = () => {
  const { start, end } = weekRange();
  const inWeek = state.errors.filter(e => e.date >= start && e.date <= end);
  const byModule = {};
  inWeek.forEach(e => byModule[e.module] = (byModule[e.module] || 0) + 1);
  const modules = Object.keys(byModule).sort((a, b) => byModule[b] - byModule[a]);
  const el = $('#errWeekSummary');
  if (!modules.length) { el.innerHTML = '<div class="muted" style="grid-column:1/-1;text-align:center;padding:16px">本周暂无错题</div>'; return; }
  let html = modules.map(m => `<div class="err-week-card"><div class="err-week-name">${escapeHtml(m)}</div><div class="err-week-val">${byModule[m]}</div></div>`).join('');
  const top = modules[0];
  html += `<div class="err-week-tip">💡 本周最薄弱模块：<b>${escapeHtml(top)}</b>（${byModule[top]} 道），建议针对性强化训练。</div>`;
  el.innerHTML = html;
};

const handleErrImage = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('图片不能超过 5MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => { pendingImage = ev.target.result; $('#errImageLabel').textContent = `已选择：${file.name}`; $('#errOcrBtn').disabled = false; $('#errOcrStatus').textContent = ''; };
  reader.readAsDataURL(file);
};

let tesseractLoading = false;
const runOcr = async () => {
  if (!pendingImage) return;
  if (tesseractLoading) return;
  tesseractLoading = true;
  $('#errOcrBtn').disabled = true;
  $('#errOcrStatus').textContent = '识别中，请稍候（首次需下载语言包）...';
  try {
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const { createWorker } = window.Tesseract;
    const worker = await createWorker('chi_sim');
    const ret = await worker.recognize(pendingImage);
    await worker.terminate();
    const text = ret.data.text.replace(/\s+/g, ' ').trim();
    if (text) {
      const titleEl = $('#errTitle');
      if (!titleEl.value.trim()) titleEl.value = text.slice(0, 120);
      else {
        const noteEl = $('#errNote');
        noteEl.value = noteEl.value.trim() ? noteEl.value.trim() + '\n[OCR识别]\n' + text : '[OCR识别]\n' + text;
      }
      toast('已识别并填入题干/备注');
    } else { toast('未识别到文字', 'error'); }
  } catch (e) { toast('识别失败：' + e.message, 'error'); }
  finally { tesseractLoading = false; $('#errOcrBtn').disabled = false; $('#errOcrStatus').textContent = ''; }
};

const addErr = () => {
  const module = $('#errModule').value;
  const title = $('#errTitle').value.trim();
  const note = $('#errNote').value.trim();
  if (!title) { toast('请填写错题简述', 'error'); return; }
  state.errors.push({ id: 'e_' + Date.now(), date: today(), module, title, note, image: pendingImage || '' });
  $('#errTitle').value = ''; $('#errNote').value = ''; pendingImage = null; $('#errImage').value = ''; $('#errImageLabel').textContent = ''; $('#errOcrBtn').disabled = true;
  saveState(); renderErrors(); toast('已保存');
};

/* ---------- 考试汇总 ---------- */
const EXAM_INFO_FIXED_CATS = ['全部', '国考', '省考', '选调', '市考', '河南', '上海', '湖北', '北京', '广东', '浙江', '江苏'];
let examInfoFilter = { category: '全部', subcategory: '全部', q: '' };
let examInfoEditTarget = null;

const renderExamInfo = () => { renderExamInfoFilters(); renderExamInfoList(); };

const getExamInfoCats = () => {
  const set = new Set(EXAM_INFO_FIXED_CATS);
  (state.examInfo || []).forEach(i => { if (i.category) set.add(i.category); });
  return EXAM_INFO_FIXED_CATS.filter(c => set.has(c));
};

const getExamInfoSubcats = () => {
  const set = new Set();
  (state.examInfo || []).forEach(i => {
    if (i.subcategory && (examInfoFilter.category === '全部' || i.category === examInfoFilter.category)) set.add(i.subcategory);
  });
  return ['全部', ...Array.from(set).sort()];
};

const renderExamInfoFilters = () => {
  const cats = getExamInfoCats();
  const chips = $('#examInfoChips');
  chips.innerHTML = cats.map(c => `
    <button class="info-chip ${examInfoFilter.category === c ? 'active' : ''}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join('');
  chips.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => { examInfoFilter.category = btn.dataset.cat; examInfoFilter.subcategory = '全部'; renderExamInfo(); });
  });

  const subCats = getExamInfoSubcats();
  const subEl = $('#examInfoSubChips');
  if (subCats.length <= 1) { subEl.innerHTML = ''; subEl.hidden = true; }
  else {
    subEl.hidden = false;
    subEl.innerHTML = subCats.map(c => `
      <button class="info-chip sub ${examInfoFilter.subcategory === c ? 'active' : ''}" data-subcat="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join('');
    subEl.querySelectorAll('[data-subcat]').forEach(btn => {
      btn.addEventListener('click', () => { examInfoFilter.subcategory = btn.dataset.subcat; renderExamInfoList(); });
    });
  }
};

const renderExamInfoList = () => {
  const el = $('#examInfoList');
  const q = (examInfoFilter.q || '').trim().toLowerCase();
  const list = (state.examInfo || []).filter(i => {
    if (examInfoFilter.category !== '全部' && i.category !== examInfoFilter.category) return false;
    if (examInfoFilter.subcategory !== '全部' && i.subcategory !== examInfoFilter.subcategory) return false;
    if (!q) return true;
    const hay = `${i.title} ${i.category} ${i.subcategory} ${i.content}`.toLowerCase();
    return hay.includes(q);
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!list.length) {
    el.innerHTML = '<div class="muted" style="text-align:center;padding:24px">暂无匹配信息，可点击右上角「添加」或导入 JSON</div>';
    return;
  }
  el.innerHTML = list.map(item => `
    <div class="info-card" data-info-id="${item.id}">
      <div class="info-card-head">
        <div class="info-card-title">${escapeHtml(item.title)}</div>
        <div class="info-card-tags">
          <span class="info-tag cat">${escapeHtml(item.category || '其他')}</span>
          ${item.subcategory ? `<span class="info-tag sub">${escapeHtml(item.subcategory)}</span>` : ''}
          ${item.date ? `<span class="info-tag date">${escapeHtml(item.date)}</span>` : ''}
          ${regRangeText(item) ? `<span class="info-tag reg">📝 报名 ${escapeHtml(regRangeText(item))}</span>` : ''}
        </div>
      </div>
      <div class="info-card-body">${escapeHtml(item.content || '').replace(/\n/g, '<br>')}</div>
      ${(item.links && item.links.length) ? `<div class="info-card-links">${item.links.map(l => `<a class="info-link" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || '链接')}</a>`).join('')}</div>` : ''}
      ${item.talk ? `
        <div class="info-talk-card">
          <div class="info-talk-title">【${escapeHtml(item.talk.title)}】</div>
          <div class="info-talk-row">⏰ 时间：${escapeHtml(item.talk.time)}</div>
          <div class="info-talk-row">📍 地点：${escapeHtml(item.talk.location)}</div>
        </div>` : ''}
      <div class="info-card-actions">
        <button class="ghost-btn small" data-edit-info="${item.id}">✏️ 编辑</button>
        <button class="danger-btn" data-del-info="${item.id}">删除</button>
      </div>
    </div>`).join('');

  el.querySelectorAll('[data-del-info]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('确定删除该条信息？')) return;
      state.examInfo = state.examInfo.filter(i => i.id !== btn.dataset.delInfo);
      saveState(); renderExamInfo(); toast('已删除');
    });
  });
  el.querySelectorAll('[data-edit-info]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = state.examInfo.find(i => i.id === btn.dataset.editInfo);
      if (item) openExamInfoModal(item);
    });
  });
};

const openExamInfoModal = (item) => {
  examInfoEditTarget = item || null;
  $('#examInfoEditTitle').textContent = item ? '编辑考试信息' : '添加考试信息';
  $('#examInfoEditTitleInput').value = item ? item.title : '';
  $('#examInfoEditCategory').value = item ? (item.category || '') : '';
  $('#examInfoEditSubcategory').value = item ? (item.subcategory || '') : '';
  $('#examInfoEditDate').value = item ? (item.date || '') : '';
  $('#examInfoEditRegStart').value = item ? (item.registerStart || item.regDate || '') : '';
  $('#examInfoEditRegEnd').value = item ? (item.registerEnd || '') : '';
  $('#examInfoEditContent').value = item ? (item.content || '') : '';
  renderExamInfoLinkInputs(item ? (item.links || []) : []);
  const hasTalk = !!(item && item.talk);
  $('#examInfoHasTalk').checked = hasTalk;
  $('#examInfoTalkFields').hidden = !hasTalk;
  $('#examInfoTalkTitle').value = hasTalk ? item.talk.title : '';
  $('#examInfoTalkTime').value = hasTalk ? item.talk.time : '';
  $('#examInfoTalkLocation').value = hasTalk ? item.talk.location : '';
  $('#examInfoEditModal').hidden = false;
};

/* ---------- 外部链接确认 ---------- */
let externalLinkTargetUrl = '';
const openExternalLink = (url) => {
  if (!url || !/^https?:\/\//i.test(url)) return;
  externalLinkTargetUrl = url;
  $('#externalLinkUrl').textContent = url;
  // 「打开」按钮是原生 <a>，把真实地址写进 href，由浏览器直接新标签跳转
  const openBtn = $('#externalLinkOpen');
  if (openBtn) openBtn.setAttribute('href', url);
  $('#externalLinkModal').hidden = false;
};

const renderExamInfoLinkInputs = (links) => {
  const wrap = $('#examInfoLinkList');
  wrap.innerHTML = (links || []).map((l, i) => `
    <div class="exam-info-link-input" data-li="${i}">
      <input type="text" class="text-input link-label" placeholder="链接名称" value="${escapeAttr(l.label)}">
      <input type="text" class="text-input link-url" placeholder="https://..." value="${escapeAttr(l.url)}">
      <button type="button" class="danger-btn link-del">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.link-del').forEach(btn => {
    btn.addEventListener('click', () => { btn.closest('.exam-info-link-input').remove(); });
  });
};

const addExamInfoLinkRow = () => {
  const wrap = $('#examInfoLinkList');
  const div = document.createElement('div'); div.className = 'exam-info-link-input';
  div.innerHTML = `
    <input type="text" class="text-input link-label" placeholder="链接名称">
    <input type="text" class="text-input link-url" placeholder="https://...">
    <button type="button" class="danger-btn link-del">✕</button>`;
  div.querySelector('.link-del').addEventListener('click', () => div.remove());
  wrap.appendChild(div);
};

const saveExamInfo = () => {
  const title = $('#examInfoEditTitleInput').value.trim();
  const category = $('#examInfoEditCategory').value.trim();
  if (!title || !category) { toast('请填写标题和地区/大类', 'error'); return; }
  const links = [];
  $('#examInfoLinkList').querySelectorAll('.exam-info-link-input').forEach(row => {
    const label = row.querySelector('.link-label').value.trim();
    const url = row.querySelector('.link-url').value.trim();
    if (label && url && /^https?:\/\//i.test(url)) links.push({ label, url });
  });
  const hasTalk = $('#examInfoHasTalk').checked;
  const talk = hasTalk ? {
    title: $('#examInfoTalkTitle').value.trim(),
    time: $('#examInfoTalkTime').value.trim(),
    location: $('#examInfoTalkLocation').value.trim(),
  } : null;
  const payload = {
    title, category,
    subcategory: $('#examInfoEditSubcategory').value.trim(),
    date: $('#examInfoEditDate').value,
    registerStart: $('#examInfoEditRegStart').value || undefined,
    registerEnd: $('#examInfoEditRegEnd').value || undefined,
    content: $('#examInfoEditContent').value.trim(),
    links,
    talk,
  };
  if (examInfoEditTarget) {
    Object.assign(examInfoEditTarget, payload);
    toast('已保存');
  } else {
    payload.id = 'info_' + Date.now();
    state.examInfo.push(payload);
    toast('已添加');
  }
  saveState(); renderExamInfo(); $('#examInfoEditModal').hidden = true;
};

const exportExamInfo = () => {
  const data = JSON.stringify(state.examInfo || [], null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `考试汇总_${today()}.json`; a.click();
  URL.revokeObjectURL(url); toast('已导出');
};
const importExamInfo = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('文件应为考试信息数组');
      if (!confirm(`导入将追加/覆盖 ${data.length} 条考试信息，确定继续？`)) return;
      const merged = [...(state.examInfo || [])];
      data.forEach(it => {
        if (!it.id) it.id = 'info_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const idx = merged.findIndex(x => x.id === it.id);
        if (idx >= 0) merged[idx] = it; else merged.push(it);
      });
      state.examInfo = merged;
      saveState(); renderExamInfo(); toast('导入成功');
    } catch (err) { toast('导入失败：' + err.message, 'error'); }
  };
  reader.readAsText(file);
};

/* ---------- 错题库导出 ---------- */
const updateExportCount = () => {
  const n = state.errors.length;
  $('#exportCount').textContent = `当前共 ${n} 道错题`;
  const btn = $('#exportErrBtn'); if (btn) btn.disabled = n === 0;
  $$('.export-opt').forEach(b => b.disabled = n === 0);
};
const buildErrorDocHTML = () => {
  const { start, end } = weekRange();
  const inWeek = state.errors.filter(e => e.date >= start && e.date <= end);
  const byModule = {};
  inWeek.forEach(e => byModule[e.module] = (byModule[e.module] || 0) + 1);
  const weak = Object.keys(byModule).sort((a, b) => byModule[b] - byModule[a]);
  const grouped = {};
  state.errors.forEach(e => { (grouped[e.module] = grouped[e.module] || []).push(e); });
  let body = '';
  Object.keys(grouped).forEach(mod => {
    body += `<h2>📂 ${escapeHtml(mod)}（${grouped[mod].length}题）</h2>`;
    grouped[mod].forEach((e, i) => {
      body += `<div style="margin:10px 0;padding:10px;border:1px solid #ddd;border-radius:8px">
        <p><b>题目：</b>${escapeHtml(e.title)}</p>
        <p><b>板块：</b>${escapeHtml(e.module)} ｜ <b>日期：</b>${escapeHtml(e.date)}</p>
        ${e.note ? `<p><b>个人备注：</b><br>${escapeHtml(e.note).replace(/\n/g,'<br>')}</p>` : ''}
        ${e.image ? `<p><img src="${e.image}" style="max-width:300px"></p>` : ''}
      </div>`;
    });
  });
  const weakHtml = weak.length
    ? `<p>本周最薄弱模块：<b>${weak.map(w=>escapeHtml(w)+`(${byModule[w]}题)`).join('、')}</b>。</p>
       <p>复习建议：优先针对最薄弱模块进行专项突破，结合错题重做与知识点回顾，建议每日安排 20-30 分钟集中攻克。</p>`
    : `<p>本周暂无错题记录，继续保持！</p>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>错题本</title>
    <style>body{font-family:"Microsoft YaHei",sans-serif;padding:30px;color:#333;line-height:1.7}
    h1{color:#2b6cb0}h2{color:#2b6cb0;border-bottom:2px solid #cfe3f5;padding-bottom:4px}</style></head>
    <body>
      <h1>🐰 备考兔 · 错题本</h1>
      <p><b>备考人：</b>${escapeHtml(state.profile.nickname)} ｜ <b>导出日期：</b>${today()} ｜ <b>错题总数：</b>${state.errors.length}</p>
      <hr>
      ${body}
      <h2>📊 本周错题汇总与薄弱点分析</h2>
      ${weakHtml}
    </body></html>`;
};
const exportWord = () => {
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'></head><body>${buildErrorDocHTML()}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `错题本_${state.profile.nickname}_${today()}.doc`;
  a.click(); URL.revokeObjectURL(url);
  $('#exportModal').hidden = true; toast('已导出 Word');
};
const exportPDF = () => {
  const w = window.open('', '_blank');
  if (!w) { toast('请允许弹出窗口以导出 PDF', 'error'); return; }
  w.document.write(buildErrorDocHTML());
  w.document.close();
  setTimeout(() => { w.print(); }, 400);
  $('#exportModal').hidden = true; toast('正在打开打印窗口…');
};

/* ---------- 语音识别 ---------- */
let recognition = null, voiceResult = '';
const startVoice = () => {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { toast('当前浏览器不支持语音识别，建议使用 Chrome / Edge', 'error'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'zh-CN'; recognition.interimResults = true; recognition.continuous = true;
  voiceResult = ''; $('#voiceText').textContent = '请开始说话...'; $('#voiceModal').hidden = false;
  recognition.onresult = (e) => { let t=''; for (let i=e.resultIndex;i<e.results.length;i++) t+=e.results[i][0].transcript; voiceResult=t; $('#voiceText').textContent = t || '（未识别到语音）'; };
  recognition.onerror = (e) => toast('语音识别失败：' + e.error, 'error');
  recognition.start();
};
const stopVoice = () => {
  if (recognition) { try { recognition.stop(); } catch(e){} }
  $('#voiceModal').hidden = true;
  if (voiceResult.trim()) { const cur = $('#errNote').value.trim(); $('#errNote').value = cur ? cur + '\n' + voiceResult : voiceResult; toast('已写入备注'); }
};
const cancelVoice = () => { if (recognition) { try { recognition.stop(); } catch(e){} } $('#voiceModal').hidden = true; voiceResult = ''; };

/* ---------- 番茄钟 ---------- */
let pomoTimer = null, pomoMode = 'focus', pomoSeconds = 25*60, pomoRemaining = 25*60, pomoRunning = false;
let pomoToday = { date: '', count: 0 };
const loadPomoToday = () => { const t = today(); if (pomoToday.date !== t) pomoToday = { date: t, count: 0 }; };
const pomoRender = () => {
  const m = String(Math.floor(pomoRemaining/60)).padStart(2,'0'); const s = String(pomoRemaining%60).padStart(2,'0');
  $('#pomoTime').textContent = `${m}:${s}`;
  const total = pomoMode === 'focus' ? 25*60 : 5*60;
  $('#pomoBar').style.width = ((total - pomoRemaining)/total*100) + '%';
  $('#pomoStart').textContent = pomoRunning ? '⏸ 暂停' : '▶ ' + (pomoRemaining === total ? '开始' : '继续');
  $('#pomoCount').textContent = pomoToday.count;
  $('#pomoFab').classList.toggle('active', pomoRunning);
};
const pomoSetMode = (mode) => {
  if (pomoRunning) { toast('请先暂停计时器', 'error'); return; }
  pomoMode = mode; pomoSeconds = mode === 'focus' ? 25*60 : 5*60; pomoRemaining = pomoSeconds;
  $$('.pomo-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  pomoRender();
};
const pomoTick = () => { if (pomoRemaining > 0) { pomoRemaining--; pomoRender(); } else pomoFinish(); };
const pomoFinish = () => {
  clearInterval(pomoTimer); pomoTimer = null; pomoRunning = false;
  if (pomoMode === 'focus') {
    loadPomoToday(); pomoToday.count++;
    const module = $('#pomoModule').value;
    if (module) { state.stats.push({ id:'p_'+Date.now(), date:today(), module, count:0, duration:25, correct:0, pomodoro:true }); saveState(); }
    $('#pomoModalText').textContent = `已完成 1 个专注番茄 🍅\n${module ? '已自动记录到「'+module+'」统计' : ''}`;
    $('#pomoModal').hidden = false; pomoSetMode('rest');
  } else { $('#pomoModalText').textContent = '休息结束，继续加油 ✨'; $('#pomoModal').hidden = false; pomoSetMode('focus'); }
  pomoRender();
};
const pomoStart = () => { if (pomoRunning) { clearInterval(pomoTimer); pomoRunning = false; } else { pomoRunning = true; pomoTimer = setInterval(pomoTick, 1000); } pomoRender(); };
const pomoReset = () => { if (pomoRunning && !confirm('正在计时中，确定重置？')) return; clearInterval(pomoTimer); pomoTimer = null; pomoRunning = false; pomoRemaining = pomoSeconds; pomoRender(); };
const togglePomoPanel = () => { const panel = $('#pomoPanel'); if (panel.hidden) { loadPomoToday(); panel.hidden = false; pomoRender(); } else panel.hidden = true; };

// 番茄钟可整体收起（隐藏悬浮球），避免遮挡内容；状态持久化
const POMO_HIDDEN_KEY = 'shangan_pomo_hidden';
const applyPomoHidden = (h) => {
  $('#pomoFab').hidden = h;
  if (h) $('#pomoPanel').hidden = true;
  $('#pomoShow').hidden = !h;
};
const togglePomoHidden = () => {
  const h = !$('#pomoFab').hidden;
  try { localStorage.setItem(POMO_HIDDEN_KEY, h ? '1' : '0'); } catch (_) {}
  applyPomoHidden(h);
};

// 报名时间区间（registerStart ~ registerEnd），兼容旧的单个 regDate
const regRangeText = (o) => {
  if (!o) return '';
  const s = o.registerStart || o.regDate || '', e = o.registerEnd || '';
  if (s && e) return `${s} 至 ${e}`;
  if (s) return s;
  if (e) return e;
  return '';
};
const regStatusText = (o) => {
  if (!o) return null;
  const s = o.registerStart || o.regDate || '', e = o.registerEnd || '';
  if (!s && !e) return null;
  const t = today();
  if (e && e < t) return '报名已结束';
  if (s && s > t) { const d = daysBetween(t, s); return `还有 ${d} 天开始报名`; }
  if (e && e >= t) { const d = daysBetween(t, e); return `报名中 · 还剩 ${d} 天`; }
  if (s && s <= t) return '报名进行中';
  return '';
};

/* ---------- 头像 / 昵称 ---------- */
const AVATAR_EMOJIS = ['🐰', '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐨', '🐸', '🐧', '🦉', '🎓'];
const renderAvatar = (el, size) => {
  if (!el) return;
  const p = state.profile;
  if (p.avatar) el.innerHTML = `<img src="${p.avatar}" alt="头像">`;
  else el.textContent = p.emoji || '🐰';
};
const loadProfile = () => {
  const p = state.profile;
  renderAvatar($('#avatar'));
  renderAvatar($('#avatarPreview'));
  $('#nickname').innerHTML = escapeHtml(p.nickname) + ' <span class="edit-ico">✏️</span>';
  $('#motto').textContent = p.motto;
};
// 选择图片 → 压缩 → 保存。做了多重兜底：超时保护、大图走 createImageBitmap、
// 压缩失败降级用原图（过大则提示），任何环节失败都会明确提示而不是静默无反应。
const setAvatarImage = (dataUrl) => {
  state.profile.avatar = dataUrl; saveState(); loadProfile(); toast('头像已更新');
};
const handleAvatarFile = (file) => {
  if (!file) return;
  if (file.type && !/^image\//.test(file.type)) { toast('请选择图片文件', 'error'); return; }
  let done = false;
  const finish = (b64, raw) => {
    if (done) return; done = true; clearTimeout(timer);
    if (b64) { setAvatarImage(b64); return; }
    if (raw && raw.length < 2000000) { setAvatarImage(raw); return; }
    toast(raw ? '图片过大，请先截图或压缩后再试' : '图片读取失败，换一张试试', 'error');
  };
  const timer = setTimeout(() => { if (!done) { done = true; toast('图片处理超时，请换一张或先截图再试', 'error'); } }, 15000);
  const reader = new FileReader();
  reader.onerror = () => finish(null, null);
  reader.onload = (e) => {
    const src = String(e.target.result || '');
    if (!src) { finish(null, null); return; }
    const toCanvas = (draw, w0) => {
      try {
        const scale = Math.min(1, 300 / (w0 || 300));
        const w = Math.max(1, Math.round((w0 || 300) * scale)), h = Math.max(1, Math.round((draw.height || w) * scale));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(draw, 0, 0, w, h);
        const out = c.toDataURL('image/jpeg', 0.85);
        out && out.length > 100 ? finish(out, src) : finish(null, src);
      } catch (_) { finish(null, src); }
    };
    const viaImg = () => {
      const img = new Image();
      img.onload = () => toCanvas(img, img.width);
      img.onerror = () => finish(null, src);
      img.src = src;
    };
    // 手机大图走 createImageBitmap 更稳（部分浏览器对超大图 <img> 解码会失败）
    if (window.createImageBitmap && window.Blob && src.length > 1500000) {
      fetch(src).then(r => r.blob()).then(createImageBitmap)
        .then(bmp => toCanvas(bmp, bmp.width))
        .catch(viaImg);
    } else viaImg();
  };
  reader.readAsDataURL(file);
};

/* ---------- 钉按钮 / 字体 / 设置 ---------- */
const applyNavMode = () => {
  const folded = state.pref.navFolded;
  document.body.classList.toggle('nav-folded', folded);
  const pin = $('#pinBtn');
  pin.textContent = folded ? '📍' : '📌';
  pin.classList.toggle('fixed', !folded);
  pin.title = folded ? '点击展开导航（固定）' : '点击折叠导航';
};
const applyFont = () => {
  document.body.dataset.font = state.pref.font;
  $$('.font-opt').forEach(b => b.classList.toggle('active', b.dataset.font === state.pref.font));
};

/* ---------- 侧栏（移动端） ---------- */
const openSidebar = () => { document.body.classList.add('nav-open'); $('#backdrop').classList.add('show'); };
const closeSidebar = () => { document.body.classList.remove('nav-open'); $('#backdrop').classList.remove('show'); };

/* ---------- 事件 ---------- */
const bindEvents = () => {
  $$('.nav-item').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); navigate(el.dataset.route); }));
  $('#hamburgerBtn').addEventListener('click', () => { if (document.body.classList.contains('nav-open')) closeSidebar(); else openSidebar(); });
  $('#backdrop').addEventListener('click', closeSidebar);

  $('#addExamBtn').addEventListener('click', addExam);
  $('#examEditCancel').addEventListener('click', () => $('#examEditModal').hidden = true);
  $('#examEditSave').addEventListener('click', saveExam);
  $('#examAddSubjectBtn').addEventListener('click', addExamSubjectRow);
  $('#maoPrev').addEventListener('click', () => rotateMao(-1));
  $('#maoNext').addEventListener('click', () => rotateMao(1));

  $('#addPlanBtn').addEventListener('click', addPlan);
  $('#planInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlan(); });

  $('#qtyNextBtn').addEventListener('click', rotateQty);
  $('#addStatBtn').addEventListener('click', addStat);

  $('#errImage').addEventListener('change', handleErrImage);
  $('#errOcrBtn').addEventListener('click', runOcr);
  $('#errVoiceBtn').addEventListener('click', startVoice);
  $('#voiceCancel').addEventListener('click', cancelVoice);
  $('#voiceConfirm').addEventListener('click', stopVoice);
  $('#addErrBtn').addEventListener('click', addErr);
  $('#errFilter').addEventListener('change', renderErrList);
  $('#exportErrBtn').addEventListener('click', () => { updateExportCount(); $('#exportModal').hidden = false; });
  $('#exportCancel').addEventListener('click', () => $('#exportModal').hidden = true);
  $$('.export-opt').forEach(b => b.addEventListener('click', () => { if (b.dataset.type === 'word') exportWord(); else exportPDF(); }));

  $('#gotoCountdown').addEventListener('click', () => navigate('countdown'));
  $('#loadDemoBtn').addEventListener('click', loadDemoData);
  $('#clearAllBtn').addEventListener('click', clearAllData);

  $('#exportBtn').addEventListener('click', exportData);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });
  $('#importPolitics').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importPolitics(f); e.target.value = ''; });

  $('#pomoFab').addEventListener('click', togglePomoPanel);
  $('#pomoClose').addEventListener('click', () => { $('#pomoPanel').hidden = true; });
  $('#pomoStart').addEventListener('click', pomoStart);
  $('#pomoReset').addEventListener('click', pomoReset);
  $$('.pomo-tab').forEach(t => t.addEventListener('click', () => pomoSetMode(t.dataset.mode)));
  $('#pomoModalOk').addEventListener('click', () => { $('#pomoModal').hidden = true; });
  $('#pomoHide').addEventListener('click', togglePomoHidden);
  $('#pomoShow').addEventListener('click', togglePomoHidden);

  document.querySelectorAll('input[name="trendMetric"]').forEach(r => r.addEventListener('change', renderTrend));

  $('#politicsRefresh').addEventListener('click', () => {
    state.pref.pastOffset = (state.pref.pastOffset || 0) + 1; saveState(); renderPolitics(); toast('已换一批');
  });

  // 考试汇总
  $('#addExamInfoBtn').addEventListener('click', () => openExamInfoModal(null));
  $('#examInfoSearch').addEventListener('input', (e) => { examInfoFilter.q = e.target.value; renderExamInfoList(); });
  $('#exportExamInfoBtn').addEventListener('click', exportExamInfo);
  $('#importExamInfoBtn').addEventListener('click', () => $('#importExamInfoFile').click());
  $('#importExamInfoFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importExamInfo(f); e.target.value = ''; });
  $('#examInfoEditCancel').addEventListener('click', () => $('#examInfoEditModal').hidden = true);
  $('#examInfoEditSave').addEventListener('click', saveExamInfo);
  $('#examInfoAddLinkBtn').addEventListener('click', addExamInfoLinkRow);
  $('#examInfoHasTalk').addEventListener('change', (e) => { $('#examInfoTalkFields').hidden = !e.target.checked; });

  // 外部链接确认弹窗(避免 PWA 里直接跳走后找不到返回入口)
  $('#externalLinkCancel').addEventListener('click', () => { $('#externalLinkModal').hidden = true; externalLinkTargetUrl = ''; });
  // 「打开」是原生 <a target="_blank">，交给浏览器本身跳转（不再用 window.open，避免被移动端弹窗拦截）
  $('#externalLinkOpen').addEventListener('click', () => { $('#externalLinkModal').hidden = true; });
  $('#examInfoList').addEventListener('click', (e) => {
    const a = e.target.closest('.info-link');
    if (!a) return;
    e.preventDefault();
    openExternalLink(a.href);
  });
  $('#detailExamUrl').addEventListener('click', (e) => {
    e.preventDefault();
    openExternalLink($('#detailExamUrl').href);
  });

  const pickAvatar = (inputId) => { const el = $(inputId); if (el) el.click(); };
  $('#avatarWrap').addEventListener('click', () => pickAvatar('#avatarInput'));
  [['#avatarInput'], ['#avatarInput2']].forEach(([sel]) => {
    const el = $(sel); if (!el) return;
    el.addEventListener('change', (e) => { handleAvatarFile(e.target.files[0]); e.target.value = ''; });
  });
  $('#avatarPickBtn').addEventListener('click', () => pickAvatar('#avatarInput2'));
  $('#profileBox').addEventListener('click', (e) => {
    if (e.target.closest('#avatarWrap')) return;
    openProfileModal();
  });
  $('#profileCancel').addEventListener('click', () => $('#profileModal').hidden = true);
  $('#profileSave').addEventListener('click', () => {
    const name = $('#nicknameInput').value.trim() || '备考兔';
    state.profile.nickname = name.slice(0, 12);
    state.profile.motto = $('#mottoInput').value.trim() || '每天进步一点点，上岸就在眼前 ✨';
    saveState(); loadProfile(); $('#profileModal').hidden = true; toast('资料已保存');
  });

  $('#noteImage').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => { notePendingImage = ev.target.result; $('#noteImagePreview').src = notePendingImage; $('#noteImagePreviewWrap').hidden = false; $('#noteImageLabel').textContent = '已选图片'; };
    reader.readAsDataURL(f); e.target.value = '';
  });
  $('#noteCancel').addEventListener('click', () => $('#noteModal').hidden = true);
  $('#noteSave').addEventListener('click', saveNote);

  $('#pinBtn').addEventListener('click', () => {
    state.pref.navFolded = !state.pref.navFolded; saveState(); applyNavMode();
  });
  $('#reopenBtn').addEventListener('click', () => { state.pref.navFolded = false; saveState(); applyNavMode(); });

  $('#settingsBtn').addEventListener('click', () => {
    const p = $('#settingsPanel'); p.hidden = !p.hidden;
  });
  $('#openSyncBtn').addEventListener('click', () => { openSyncModal(); });
  $('#syncSaveBtn').addEventListener('click', saveSyncConfig);
  $('#syncTestBtn').addEventListener('click', testSync);
  $('#syncPushBtn').addEventListener('click', () => { if (state.sync.enabled) pushToCloud(); else toast('请先保存配置', 'error'); });
  $('#syncPullBtn').addEventListener('click', pullFromCloud);
  $('#syncDisconnectBtn').addEventListener('click', syncDisconnect);
  $('#syncCancel').addEventListener('click', () => { $('#syncModal').hidden = true; });
  $$('.font-opt').forEach(b => b.addEventListener('click', () => {
    state.pref.font = b.dataset.font; saveState(); applyFont();
  }));

  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!state.pref.navFolded) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (touchStartX < 30 && dx > 60 && Math.abs(dy) < 80) openSidebar();
    else if (dx < -60 && Math.abs(dy) < 80 && !e.target.closest('.sidebar')) closeSidebar();
  }, { passive: true });
  $('.main').addEventListener('click', (e) => {
    if (state.pref.navFolded && window.innerWidth <= 900 && e.target === e.currentTarget) closeSidebar();
  });
};

const openProfileModal = () => {
  $('#nicknameInput').value = state.profile.nickname === '备考兔' ? '' : state.profile.nickname;
  $('#mottoInput').value = state.profile.motto;
  renderAvatar($('#avatarPreview'));
  const presets = $('#avatarPresets');
  if (presets && !presets.dataset.init) {
    presets.dataset.init = '1';
    AVATAR_EMOJIS.forEach((em) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'avatar-preset'; b.textContent = em;
      b.addEventListener('click', () => {
        state.profile.avatar = ''; state.profile.emoji = em;
        saveState(); loadProfile(); toast('头像已更新');
      });
      presets.appendChild(b);
    });
  }
  $('#profileModal').hidden = false;
};

/* ---------- 导入 / 导出 ---------- */
const exportData = () => {
  const exp = { ...state, sync: { ...state.sync, url: '', anonKey: '' } };
  const data = JSON.stringify(exp, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `备考兔_${today()}.json`; a.click();
  URL.revokeObjectURL(url); toast('已导出');
};
const importData = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.plans && !data.exams && !data.errors) throw new Error('文件格式不正确');
      if (!confirm('导入将覆盖当前数据，确定继续？')) return;
      state = { ...defaultState(), ...data };
      saveState(); applyNavMode(); applyFont(); loadProfile(); navigate('home'); renderTopbar(); toast('已导入');
    } catch (err) { toast('导入失败：' + err.message, 'error'); }
  };
  reader.readAsText(file);
};

/* ---------- 云端同步（Supabase 免费云数据库，参考小红书方案） ---------- */
// 同步码：对 state 做 XOR + base64 简单加密，保护隐私（多端需填同一码）
const xorCrypt = (str, code) => {
  if (!code) return str;
  const bytes = new TextEncoder().encode(str);
  const key = new TextEncoder().encode(code);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
};
const xorDecrypt = (b64, code) => {
  if (!code) return b64;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const key = new TextEncoder().encode(code);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ key[i % key.length];
  return new TextDecoder().decode(bytes);
};

const supaHeaders = () => ({
  'apikey': state.sync.anonKey,
  'Authorization': 'Bearer ' + state.sync.anonKey,
  'Content-Type': 'application/json'
});
// 从 Supabase 错误响应中提取具体原因（如 Invalid API key），便于定位 401/404 等问题
const supaHint = (m) => {
  if (/row-level security/i.test(m)) return ' 👉 云表权限未开：请到 Supabase → SQL Editor 重新运行 supabase_schema.sql（会关闭 RLS 并授权），再回来上传';
  if (/permission denied/i.test(m)) return ' 👉 云表缺少授权：请在 SQL Editor 运行 supabase_schema.sql 第 3 步的 grant 语句';
  if (/Invalid API key|No API key/i.test(m)) return ' 👉 key 无效：请重新复制 Project Settings → API 里的 Publishable key（勿带空格换行）';
  if (/relation .* does not exist/i.test(m)) return ' 👉 表未创建：请在 SQL Editor 运行 supabase_schema.sql';
  return '';
};
const supaErrMsg = async (res) => {
  let detail = '';
  try {
    const j = await res.json();
    const m = j && (j.msg || j.message || j.error_description || j.error);
    if (m) detail = '：' + m + supaHint(String(m));
  } catch (_) {}
  return 'HTTP ' + res.status + detail;
};
const fmtNow = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const setSyncStatus = (txt) => {
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = txt;
  const mini = document.getElementById('syncMini');
  if (mini) mini.textContent = (state.sync.enabled ? '☁️ 云端' : '本机保存');
};

// 判断一份 state 是否含有真实学习数据（用于防止空数据覆盖云端）
const stateHasContent = (s) => {
  if (!s) return false;
  if (s.plans && s.plans.length) return true;
  if (s.errors && s.errors.length) return true;
  if (s.stats && s.stats.length) return true;
  if (s.politicsToday && s.politicsToday.length) return true;
  if (s.checkins && Object.keys(s.checkins).length) return true;
  if (s.notes && Object.keys(s.notes).length) return true;
  if (s.studyPlan && Object.keys(s.studyPlan).length) return true;
  const p = s.progress || {};
  for (const k of Object.keys(p)) if (Object.keys(p[k] || {}).length) return true;
  return false;
};

const pushToCloud = async () => {
  if (!state.sync.enabled || !state.sync.url || !state.sync.anonKey || _syncing) return;
  _syncing = true;
  try {
    const payload = xorCrypt(JSON.stringify(state), state.sync.code);
    const base = state.sync.url.replace(/\/$/, '');
    // 安全网：本机几乎无数据、云端却有数据时，先确认，避免误点「上传」把云端清空
    try {
      const chk = await fetch(`${base}/rest/v1/workspace_sync?id=eq.main&select=data`, { headers: supaHeaders() });
      if (chk.ok) {
        const arrChk = await chk.json();
        if (arrChk.length) {
          let remoteState = null;
          try { remoteState = JSON.parse(xorDecrypt(arrChk[0].data, state.sync.code)); } catch (_) { remoteState = null; }
          if (remoteState && stateHasContent(remoteState) && !stateHasContent(state)) {
            const go = confirm('⚠️ 本机几乎没有学习数据，但云端已有数据。\n\n继续上传会用【本机空白数据】覆盖云端！\n\n若你是想在新设备上获取已有数据，请点「取消」，然后改点「手动下载」。\n\n确定仍要上传吗？');
            if (!go) { setSyncStatus('已取消上传（已保护云端数据）'); toast('已取消上传，云端数据未被覆盖'); return; }
          }
        }
      }
    } catch (_) { /* 探测失败不阻断正常上传 */ }
    const headers = { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' };
    const body = JSON.stringify({ data: payload, updated_at: new Date().toISOString() });
    // PATCH 只能更新已有行；PostgREST 对「零行命中」也返回 200（而非 404），
    // 因此必须检查返回的行数：空数组说明首次上传、行还不存在，需改用 POST upsert 插入
    let res = await fetch(`${base}/rest/v1/workspace_sync?id=eq.main`, { method: 'PATCH', headers, body });
    let rows = [];
    try { rows = await res.json(); } catch (_) { rows = []; }
    if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
      res = await fetch(`${base}/rest/v1/workspace_sync`, {
        method: 'POST', headers, body: JSON.stringify({ id: 'main', data: payload, updated_at: new Date().toISOString() })
      });
    }
    if (!res.ok && res.status !== 409) throw new Error(await supaErrMsg(res));
    state.sync.lastSync = fmtNow();
    setSyncStatus('☁️ 已上传 ' + state.sync.lastSync);
  } catch (e) {
    setSyncStatus('⚠️ 上传失败：' + e.message);
  } finally { _syncing = false; }
};

const pullFromCloud = async () => {
  if (!state.sync.url || !state.sync.anonKey) { toast('请先配置云端同步', 'error'); return; }
  if (_syncing) return;
  _syncing = true;
  const keepSync = state.sync;
  try {
    const base = state.sync.url.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/v1/workspace_sync?id=eq.main&select=data,updated_at`, { headers: supaHeaders() });
    if (!res.ok) throw new Error(await supaErrMsg(res));
    const arr = await res.json();
    if (!arr.length) { toast('云端暂无数据，请先上传'); return; }
    const remote = xorDecrypt(arr[0].data, state.sync.code);
    const remoteState = JSON.parse(remote);
    state = { ...defaultState(), ...remoteState };
    state.sync = keepSync;
    state.sync.lastSync = fmtNow();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    applyNavMode(); applyFont(); loadProfile(); renderTopbar(); navigate('home');
    setSyncStatus('☁️ 已下载 ' + state.sync.lastSync);
    toast('已从云端同步');
  } catch (e) {
    setSyncStatus('⚠️ 下载失败：' + e.message); toast('下载失败：' + e.message, 'error');
  } finally { _syncing = false; }
};

const openSyncModal = () => {
  $('#syncUrl').value = state.sync.url || '';
  $('#syncKey').value = state.sync.anonKey || '';
  $('#syncCode').value = state.sync.code || '';
  setSyncStatus(state.sync.enabled ? ('☁️ 已启用，上次：' + (state.sync.lastSync || '无')) : '未连接');
  $('#syncModal').hidden = false;
};
const cleanSyncKey = (v) => (v || '').replace(/\s+/g, ''); // 去掉所有空白（含中间换行，手机复制粘贴常见）
const syncWarn = (url, key) => {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url || '')) return '⚠️ URL 应形如 https://xxxx.supabase.co（不带路径，不要用 postgres 连接串）';
  if (key && !/^(eyJ|sb_publishable_)/.test(key)) return '⚠️ key 应以 sb_publishable_ 开头（新版）或 eyJ 开头（旧版 anon key）';
  return '';
};
const saveSyncConfig = () => {
  state.sync.url = $('#syncUrl').value.trim().replace(/\/+$/, '');
  state.sync.anonKey = cleanSyncKey($('#syncKey').value);
  state.sync.code = $('#syncCode').value.trim();
  state.sync.enabled = !!(state.sync.url && state.sync.anonKey);
  saveState();
  setSyncStatus(state.sync.enabled ? '☁️ 已保存并启用' : '已保存（未启用）');
  toast('云端同步配置已保存');
  if (state.sync.enabled) pushToCloud();
};
const testSync = async () => {
  const url = $('#syncUrl').value.trim().replace(/\/+$/, ''), key = cleanSyncKey($('#syncKey').value);
  $('#syncUrl').value = url; $('#syncKey').value = key;
  if (!url || !key) { setSyncStatus('⚠️ 请填写 URL 和 anon key'); return; }
  const warn = syncWarn(url, key);
  if (warn) { setSyncStatus(warn); toast(warn, 'error'); return; }
  setSyncStatus('🔄 测试中…');
  try {
    const base = url.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/v1/workspace_sync?id=eq.main&select=id`, { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    setSyncStatus(res.ok ? '✅ 连接成功' : '⚠️ 连接失败 ' + await supaErrMsg(res));
  } catch (e) { setSyncStatus('⚠️ 连接失败：' + e.message); }
};
const syncDisconnect = () => {
  state.sync.enabled = false; state.sync.url = ''; state.sync.anonKey = '';
  saveState(); setSyncStatus('已断开');
  const mini = document.getElementById('syncMini'); if (mini) mini.textContent = '本机保存';
  toast('已断开云端同步');
};
const importPolitics = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.today) || !Array.isArray(data.past)) throw new Error('JSON 需包含 today 和 past 数组');
      state.politicsToday = data.today.slice(0, 10);
      state.politicsPast = data.past.slice(0, 10);
      saveState(); renderPolitics(); toast('时政导入成功');
    } catch (err) { toast('导入失败：' + err.message, 'error'); }
  };
  reader.readAsText(file);
};

/* ---------- HTML 转义 ---------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ====================================================================
 * 工具合集：4 个小工具（百分化游戏 / 每日时政 / 年均增长率 / 截面图）
 * ==================================================================== */
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => arr.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

/* ---------- 1) 百分化游戏：学习 / 闯关 / 自由 三种模式 ---------- */
/* 巧记百化分对照表（4 组配色，参考小红书"巧记百化分"） */
const PCF_TABLE = [
  { group: 'blue', label: '不用背也会', items: [
    ['1/2', '50%'], ['1/3', '33.3%'], ['1/4', '25%'], ['1/5', '20%'],
    ['1/20', '5%'], ['1/25', '4%'], ['1/30', '3.3%'], ['1/33', '3%'], ['1/40', '2.5%'], ['1/50', '2%'],
  ] },
  { group: 'yellow', label: '5.963 等差数列', items: [
    ['1/17', '5.9%'], ['1/18', '5.6%'], ['1/19', '5.3%'],
    ['1/5.3', '19%'], ['1/5.6', '18%'], ['1/5.9', '17%'],
  ] },
  { group: 'green', label: '母子互换', items: [
    ['1/6', '16.7%'], ['1/7', '14.3%'], ['1/14', '7.1%'], ['1/15', '6.7%'], ['1/16', '6.25%'],
    ['1/6.5', '15.4%'], ['1/7.5', '13.3%'],
  ] },
  { group: 'red', label: '加和为 20', items: [
    ['1/8', '12.5%'], ['1/9', '11.1%'], ['1/11', '9.1%'], ['1/12', '8.3%'], ['1/13', '7.7%'],
    ['1/8.5', '11.8%'], ['1/9.5', '10.5%'], ['1/10', '10%'], ['1/12.5', '8%'],
    ['1/13.5', '7.4%'], ['1/14.5', '6.9%'], ['1/15.5', '6.5%'], ['1/16.5', '6%'],
  ] },
];
const PCF_POOL = [];
PCF_TABLE.forEach(g => g.items.forEach(([f, p]) => PCF_POOL.push({ frac: f, pct: p })));

/* 闯关模式：15 关 · 三种棋盘（4×4 / 4×6 / 6×6），限时递减 */
const PCF_LEVELS = [
  { rows: 4, cols: 4, time: 100 }, { rows: 4, cols: 4, time: 90 }, { rows: 4, cols: 4, time: 80 },
  { rows: 4, cols: 4, time: 70 }, { rows: 4, cols: 4, time: 60 },
  { rows: 4, cols: 6, time: 140 }, { rows: 4, cols: 6, time: 125 }, { rows: 4, cols: 6, time: 110 },
  { rows: 4, cols: 6, time: 95 }, { rows: 4, cols: 6, time: 80 },
  { rows: 6, cols: 6, time: 200 }, { rows: 6, cols: 6, time: 180 }, { rows: 6, cols: 6, time: 160 },
  { rows: 6, cols: 6, time: 140 }, { rows: 6, cols: 6, time: 120 },
];
const PCF_FREE_SIZES = [{ rows: 4, cols: 4 }, { rows: 4, cols: 5 }, { rows: 4, cols: 6 }, { rows: 6, cols: 6 }];
const PCF_CHALLENGE_HINTS = 3;
const PCF_FREE_HINTS = 5;
const PCF_LEVEL_LS = 'shangan_pcf_level';

const pcf = {
  screen: 'menu', mode: 'study',
  board: [], sel: [], rows: 4, cols: 5,
  matched: 0, totalPairs: 0, hintsLeft: Infinity,
  elapsed: 0, timeLimit: 0, remain: 0,
  paused: false, locked: false, level: 1, timerId: null,
};

const fmtMS = (s) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};
/* 值 = 当前可挑战的关卡号；等于 关卡数+1 表示已全部通关 */
const pcfBestLevel = () => {
  try { return Math.max(1, Math.min(PCF_LEVELS.length + 1, parseInt(localStorage.getItem(PCF_LEVEL_LS) || '1', 10) || 1)); }
  catch (_) { return 1; }
};
const pcfSaveBest = (n) => {
  try { if (n > pcfBestLevel() && n <= PCF_LEVELS.length + 1) localStorage.setItem(PCF_LEVEL_LS, String(n)); } catch (_) {}
};

const stopPcfTimer = () => { if (pcf.timerId) { clearInterval(pcf.timerId); pcf.timerId = null; } };
const resumePcfTimer = () => {
  if (pcf.screen !== 'game' || pcf.timerId) return;
  pcf.timerId = setInterval(() => {
    if (pcf.paused || pcf.screen !== 'game') return;
    pcf.elapsed++;
    if (pcf.timeLimit) {
      pcf.remain = pcf.timeLimit - pcf.elapsed;
      if (pcf.remain <= 0) { pcf.remain = 0; paintPcfTimer(); stopPcfTimer(); pcfResult(false); return; }
    }
    paintPcfTimer();
  }, 1000);
};

/* ---------- 弹层（百化分表 / 选关 / 选棋盘 / 暂停 / 结算） ---------- */
const closePcfOverlay = () => { const ov = $('#pcfOverlay'); if (ov) { ov.hidden = true; ov.innerHTML = ''; } };
const pcfOverlay = (title, bodyHtml, onMount) => {
  let ov = $('#pcfOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pcfOverlay'; ov.className = 'pcf-overlay'; ov.hidden = true;
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="pcf-sheet-card">
      <div class="pcf-sheet-head"><b>${title}</b><button type="button" class="pcf-sheet-close" id="pcfSheetClose">✕</button></div>
      <div class="pcf-sheet-body">${bodyHtml}</div>
    </div>`;
  ov.hidden = false;
  $('#pcfSheetClose').addEventListener('click', closePcfOverlay);
  ov.onclick = (e) => { if (e.target === ov) closePcfOverlay(); };
  if (onMount) onMount(ov);
};

const openPcfTable = () => {
  const body = PCF_TABLE.map(g => `
    <div class="pcf-tgroup ${g.group}">
      <div class="pcf-tgroup-title">${g.label}</div>
      <div class="pcf-tgrid">${g.items.map(([f, p]) => `
        <div class="pcf-tcell"><span class="f">${f}</span><span class="eq">=</span><span class="p">${p}</span></div>`).join('')}
      </div>
    </div>`).join('');
  pcfOverlay('📖 巧记百化分', `<div class="pcf-table">${body}</div>`);
};

const openPcfChallenge = () => {
  const best = pcfBestLevel();
  const body = `<div class="pcf-levels">${PCF_LEVELS.map((lv, i) => {
    const n = i + 1, locked = n > best;
    const own = i < 5 ? '4×4' : (i < 10 ? '4×6' : '6×6');
    return `<button type="button" class="pcf-level${locked ? ' locked' : ''}" data-lv="${n}" ${locked ? 'disabled' : ''}>
      <b>第 ${n} 关</b><span>${own} · ${fmtMS(lv.time)}</span>${locked ? '<i>🔒</i>' : ''}
    </button>`;
  }).join('')}</div>
  <div class="muted" style="margin-top:.7em;font-size:.85em">闯关模式：每关提示 3 次，限时内消完全部配对即过关。</div>`;
  pcfOverlay('🚩 闯关模式 · 选择关卡', body, (ov) => {
    ov.querySelectorAll('.pcf-level:not(.locked)').forEach(b => b.addEventListener('click', () => {
      startPcfGame('challenge', { level: parseInt(b.dataset.lv, 10) });
    }));
  });
};

const openPcfFreePicker = () => {
  const body = `<div class="pcf-sizes">${PCF_FREE_SIZES.map(s => `
    <button type="button" class="pcf-size" data-r="${s.rows}" data-c="${s.cols}">
      <b>${s.rows} × ${s.cols}</b><span>${s.rows * s.cols} 格 · ${s.rows * s.cols / 2} 对</span>
    </button>`).join('')}</div>
  <div class="muted" style="margin-top:.7em;font-size:.85em">自由模式：不限时间，每局提示 5 次。</div>`;
  pcfOverlay('🔲 自由模式 · 选择棋盘', body, (ov) => {
    ov.querySelectorAll('.pcf-size').forEach(b => b.addEventListener('click', () => {
      startPcfGame('free', { rows: +b.dataset.r, cols: +b.dataset.c });
    }));
  });
};

/* ---------- 开局 / 渲染 ---------- */
const startPcfGame = (mode, opts = {}) => {
  let rows, cols, timeLimit, hints;
  if (mode === 'study') { rows = 4; cols = 5; timeLimit = 0; hints = Infinity; }
  else if (mode === 'free') { rows = opts.rows || 4; cols = opts.cols || 5; timeLimit = 0; hints = PCF_FREE_HINTS; }
  else {
    const lv = PCF_LEVELS[Math.min(PCF_LEVELS.length, opts.level || 1) - 1];
    rows = lv.rows; cols = lv.cols; timeLimit = lv.time; hints = PCF_CHALLENGE_HINTS;
  }
  const pairs = Math.floor(rows * cols / 2);
  const chosen = shuffle(PCF_POOL.slice()).slice(0, Math.min(pairs, PCF_POOL.length));
  const board = [];
  chosen.forEach((c, i) => {
    board.push({ pairId: i, kind: 'frac', text: c.frac, done: false, wrong: false, hint: false });
    board.push({ pairId: i, kind: 'pct', text: c.pct, done: false, wrong: false, hint: false });
  });
  Object.assign(pcf, {
    screen: 'game', mode, board: shuffle(board), sel: [], rows, cols,
    matched: 0, totalPairs: chosen.length, hintsLeft: hints, elapsed: 0,
    timeLimit, remain: timeLimit, paused: false, locked: false, level: opts.level || 1,
  });
  closePcfOverlay();
  stopPcfTimer();
  renderPcfGame();
  resumePcfTimer();
};

const renderPcfGame = () => {
  const root = $('#toolPercentRoot'); if (!root) return;
  const modeName = { study: '📖 学习模式', challenge: '🚩 闯关模式', free: '🔲 自由模式' }[pcf.mode] || '';
  root.innerHTML = `
    <div class="pcf-game">
      <div class="pcf-hud">
        <span class="pcf-hud-mode">${modeName}</span>
        <span class="pcf-hud-info" id="pcfHudInfo"></span>
      </div>
      <div class="pcf-topbar">
        <button type="button" class="pcf-pause" id="pcfPause" title="暂停">⏸</button>
        <div class="pcf-timer" id="pcfTimer">00:00</div>
        <button type="button" class="pcf-exit" id="pcfExit" title="返回">✕</button>
      </div>
      <div class="pcf-board" id="pcfBoard" style="grid-template-columns:repeat(${pcf.cols},minmax(0,1fr))"></div>
      <div class="pcf-bottombar">
        <button type="button" class="pcf-tool" id="pcfHint"><span class="pcf-tool-ico">💡</span><span class="pcf-tool-txt">提示</span><i class="pcf-badge" id="pcfHintBadge"></i></button>
        <button type="button" class="pcf-tool" id="pcfTableBtn"><span class="pcf-tool-ico">📖</span><span class="pcf-tool-txt">百化分表</span></button>
      </div>
    </div>`;
  paintPcfBoard();
  paintPcfTimer();
  paintPcfHintBadge();
  $('#pcfPause').addEventListener('click', pcfTogglePause);
  $('#pcfExit').addEventListener('click', () => { stopPcfTimer(); pcf.screen = 'menu'; pcf.board = []; closePcfOverlay(); renderToolPercent(); });
  $('#pcfHint').addEventListener('click', pcfHint);
  $('#pcfTableBtn').addEventListener('click', openPcfTable);
};

const paintPcfTimer = () => {
  const el = $('#pcfTimer'); if (!el) return;
  if (pcf.timeLimit) { el.textContent = fmtMS(pcf.remain); el.classList.toggle('low', pcf.remain <= 15); }
  else { el.textContent = fmtMS(pcf.elapsed); el.classList.remove('low'); }
};
const paintPcfHintBadge = () => {
  const el = $('#pcfHintBadge'); if (!el) return;
  if (pcf.hintsLeft === Infinity) { el.textContent = '∞'; el.classList.remove('zero'); }
  else { el.textContent = String(Math.max(0, pcf.hintsLeft)); el.classList.toggle('zero', pcf.hintsLeft <= 0); }
};
const paintPcfBoard = () => {
  const el = $('#pcfBoard'); if (!el) return;
  el.innerHTML = pcf.board.map((t, i) => {
    const cls = ['pcf-tile', t.kind === 'frac' ? 'frac' : 'pct'];
    if (t.done) cls.push('done');
    if (pcf.sel.includes(i)) cls.push('sel');
    if (t.wrong) cls.push('wrong');
    if (t.hint) cls.push('hint');
    return `<button type="button" class="${cls.join(' ')}" data-i="${i}"${t.done ? ' disabled' : ''}>${escapeHtml(t.text)}</button>`;
  }).join('');
  el.querySelectorAll('.pcf-tile:not([disabled])').forEach(b => b.addEventListener('click', () => pcfTap(+b.dataset.i)));
  const info = $('#pcfHudInfo');
  if (info) info.textContent = pcf.mode === 'challenge'
    ? `第 ${pcf.level} / ${PCF_LEVELS.length} 关 · 已完成 ${pcf.matched}/${pcf.totalPairs} 对`
    : `已完成 ${pcf.matched} / ${pcf.totalPairs} 对`;
};

/* ---------- 交互 ---------- */
const pcfTap = (i) => {
  if (pcf.locked || pcf.paused || pcf.screen !== 'game') return;
  const t = pcf.board[i];
  if (!t || t.done) return;
  if (pcf.sel.includes(i)) { pcf.sel = pcf.sel.filter(x => x !== i); paintPcfBoard(); return; }
  pcf.sel.push(i);
  paintPcfBoard();
  if (pcf.sel.length < 2) return;
  const a = pcf.sel[0], b = pcf.sel[1];
  const ta = pcf.board[a], tb = pcf.board[b];
  if (ta.pairId === tb.pairId && ta.kind !== tb.kind) {
    ta.done = tb.done = true;
    pcf.sel = [];
    pcf.matched++;
    paintPcfBoard();
    if (pcf.matched === pcf.totalPairs) {
      pcf.locked = true;
      if (pcf.mode === 'challenge') pcfSaveBest(pcf.level + 1);
      setTimeout(() => pcfResult(true), 340);
    }
  } else {
    pcf.locked = true;
    ta.wrong = tb.wrong = true;
    paintPcfBoard();
    setTimeout(() => {
      ta.wrong = tb.wrong = false;
      pcf.sel = [];
      pcf.locked = false;
      paintPcfBoard();
    }, 480);
  }
};

const pcfHint = () => {
  if (pcf.paused || pcf.locked || pcf.screen !== 'game') return;
  if (pcf.hintsLeft <= 0) { toast('本局提示次数已用完'); return; }
  const byPair = {};
  pcf.board.forEach((t, i) => { if (!t.done) (byPair[t.pairId] = byPair[t.pairId] || []).push(i); });
  const key = Object.keys(byPair).find(k => byPair[k].length === 2);
  if (key == null) return;
  const idxs = byPair[key];
  if (pcf.hintsLeft !== Infinity) pcf.hintsLeft--;
  idxs.forEach(i => { pcf.board[i].hint = true; });
  pcf.sel = [];
  paintPcfBoard(); paintPcfHintBadge();
  setTimeout(() => { idxs.forEach(i => { if (pcf.board[i]) pcf.board[i].hint = false; }); paintPcfBoard(); }, 1500);
};

const pcfTogglePause = () => {
  if (pcf.screen !== 'game') return;
  pcf.paused = true;
  pcfOverlay('⏸ 已暂停', `<div class="pcf-paused">
      <p class="muted">已用时 ${fmtMS(pcf.elapsed)}${pcf.timeLimit ? ' · 剩余 ' + fmtMS(pcf.remain) : ''}</p>
      <div class="modal-actions">
        <button type="button" class="primary-btn" id="pcfResume">继续</button>
        <button type="button" class="ghost-btn" id="pcfQuit">退出本局</button>
      </div>
    </div>`, () => {
    $('#pcfResume').addEventListener('click', () => { closePcfOverlay(); pcf.paused = false; });
    $('#pcfQuit').addEventListener('click', () => { closePcfOverlay(); stopPcfTimer(); pcf.screen = 'menu'; pcf.board = []; renderToolPercent(); });
  });
};

const pcfResult = (win) => {
  stopPcfTimer();
  pcf.locked = true;
  const left = pcf.totalPairs - pcf.matched;
  const title = win ? '🎉 全部消除！' : '⏰ 时间到';
  const big = win ? `用时 ${fmtMS(pcf.elapsed)}` : `还剩 ${left} 对未消`;
  const sub = pcf.mode === 'challenge'
    ? `第 ${pcf.level} / ${PCF_LEVELS.length} 关 · 提示剩余 ${Math.max(0, pcf.hintsLeft)} 次`
    : `提示剩余：${pcf.hintsLeft === Infinity ? '不限' : Math.max(0, pcf.hintsLeft)} 次`;
  let actions;
  if (win && pcf.mode === 'challenge' && pcf.level < PCF_LEVELS.length) {
    actions = `<button type="button" class="primary-btn" id="pcfNextLv">下一关 →</button>
               <button type="button" class="ghost-btn" id="pcfBackMenu">返回</button>`;
  } else {
    actions = `<button type="button" class="primary-btn" id="pcfReplay">再来一局</button>
               <button type="button" class="ghost-btn" id="pcfBackMenu">返回</button>`;
  }
  pcfOverlay(title, `<div class="pcf-result">
      <p class="pcf-result-big">${big}</p>
      <p class="muted">${sub}</p>
      <div class="modal-actions">${actions}</div>
    </div>`, () => {
    const nx = $('#pcfNextLv');
    if (nx) nx.addEventListener('click', () => startPcfGame('challenge', { level: pcf.level + 1 }));
    const rp = $('#pcfReplay');
    if (rp) rp.addEventListener('click', () => startPcfGame(pcf.mode, { level: pcf.level, rows: pcf.rows, cols: pcf.cols }));
    $('#pcfBackMenu').addEventListener('click', () => { closePcfOverlay(); pcf.screen = 'menu'; pcf.board = []; renderToolPercent(); });
  });
};

/* ---------- 模式选择 ---------- */
const renderToolPercent = () => {
  const root = $('#toolPercentRoot'); if (!root) return;
  if (pcf.screen === 'game' && pcf.board.length) { renderPcfGame(); resumePcfTimer(); return; }
  pcf.screen = 'menu';
  const best = pcfBestLevel();
  const cleared = Math.min(PCF_LEVELS.length, Math.max(0, pcfBestLevel() - 1));
  root.innerHTML = `
    <div class="pcf-modes">
      <button type="button" class="pcf-mode-card orange" data-mode="study">
        <span class="pcf-mode-ico">📖</span>
        <span class="pcf-mode-txt"><b>学习模式</b><em>自由练习，提示次数不限，成绩不计入排行榜</em></span>
      </button>
      <button type="button" class="pcf-mode-card green" data-mode="challenge">
        <span class="pcf-mode-ico">🚩</span>
        <span class="pcf-mode-txt"><b>闯关模式</b><em>15 关 · 三种棋盘，限时挑战${cleared > 0 ? ` · 已通关 ${cleared} 关` : ''}</em></span>
      </button>
      <button type="button" class="pcf-mode-card blue" data-mode="free">
        <span class="pcf-mode-ico">🔲</span>
        <span class="pcf-mode-txt"><b>自由模式</b><em>自选格子数，不限时练习</em></span>
      </button>
      <div class="pcf-modes-foot">
        <button type="button" class="pcf-table-link" id="pcfTableBtn2">📖 查看巧记百化分表</button>
      </div>
    </div>`;
  root.querySelectorAll('.pcf-mode-card').forEach(b => b.addEventListener('click', () => {
    const mode = b.dataset.mode;
    if (mode === 'free') openPcfFreePicker();
    else if (mode === 'challenge') openPcfChallenge();
    else startPcfGame('study');
  }));
  $('#pcfTableBtn2').addEventListener('click', openPcfTable);
};

/* ---------- 2) 每日时政：标签筛选 + 收藏 ---------- */
const POLITICS_ITEMS = [
  { id: 'p1', date: '2026-09-08', tag: '会议', title: '中共中央政治局召开会议，研究部署下半年经济工作，强调稳中求进、提振内需。' },
  { id: 'p2', date: '2026-09-07', tag: '科技', title: '我国新一代量子计算原型机取得突破，量子比特数进一步提升。' },
  { id: 'p3', date: '2026-09-06', tag: '民生', title: '多地出台生育支持政策，扩大普惠托育供给、发放育儿补贴。' },
  { id: 'p4', date: '2026-09-05', tag: '经济', title: '央行运用结构性货币政策工具，引导金融资源流向科技创新与绿色发展。' },
  { id: 'p5', date: '2026-09-04', tag: '生态', title: '长江流域重点水域十年禁渔阶段性评估发布，水生生物资源恢复明显。' },
  { id: 'p6', date: '2026-09-03', tag: '国际', title: '上合组织成员国元首理事会举行，聚焦安全、发展与多边合作。' },
  { id: 'p7', date: '2026-09-02', tag: '民生', title: '基本医保参保长效机制进一步完善，灵活就业人员参保更便利。' },
  { id: 'p8', date: '2026-09-01', tag: '科技', title: '国产大飞机新增商业航线，C919 机队规模与运营范围持续扩大。' },
  { id: 'p9', date: '2026-08-31', tag: '经济', title: '前七月高技术制造业增加值同比增长较快，新动能持续壮大。' },
  { id: 'p10', date: '2026-08-30', tag: '会议', title: '中央财经委员会会议研究促进共同富裕、优化收入分配格局。' },
  { id: 'p11', date: '2026-08-29', tag: '生态', title: '全国碳市场扩容，更多高排放行业纳入配额管理。' },
  { id: 'p12', date: '2026-08-28', tag: '国际', title: '第三届"一带一路"科技交流大会召开，推动创新合作。' },
];
const loadPoliticsFav = () => { try { return new Set(JSON.parse(localStorage.getItem('shangan_politics_fav') || '[]')); } catch (_) { return new Set(); } };
const savePoliticsFav = (set) => { try { localStorage.setItem('shangan_politics_fav', JSON.stringify(Array.from(set))); } catch (_) {} };
let politicsFilter = '全部';
const renderToolPolitics = () => {
  const root = $('#toolPoliticsRoot'); if (!root) return;
  const tags = ['全部', ...Array.from(new Set(POLITICS_ITEMS.map(i => i.tag)))];
  const fav = loadPoliticsFav();
  const list = POLITICS_ITEMS
    .filter(i => politicsFilter === '全部' || i.tag === politicsFilter)
    .sort((a, b) => b.date.localeCompare(a.date));
  root.innerHTML = `
    <div class="politics-chips">${tags.map(t => `<button class="info-chip ${politicsFilter === t ? 'active' : ''}" data-tag="${t}">${t}</button>`).join('')}</div>
    <div class="politics-list">${list.map(i => `
      <div class="politics-item ${fav.has(i.id) ? 'faved' : ''}">
        <div class="politics-main">
          <span class="info-tag ${'tg-' + i.tag}">${i.tag}</span>
          <span class="politics-date">${i.date}</span>
          <div class="politics-title">${escapeHtml(i.title)}</div>
        </div>
        <button class="politics-fav" data-id="${i.id}" title="收藏">${fav.has(i.id) ? '⭐' : '☆'}</button>
      </div>`).join('')}</div>`;
  root.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => { politicsFilter = b.dataset.tag; renderToolPolitics(); }));
  root.querySelectorAll('.politics-fav').forEach(b => b.addEventListener('click', () => {
    const f = loadPoliticsFav();
    if (f.has(b.dataset.id)) f.delete(b.dataset.id); else f.add(b.dataset.id);
    savePoliticsFav(f); renderToolPolitics();
  }));
};

/* ---------- 3) 年均增长率练习：r = (B/A)^(1/n) − 1 四选一 ---------- */
const toolGrowth = { score: 0, total: 0 };
const renderToolGrowth = () => {
  const root = $('#toolGrowthRoot'); if (!root) return;
  const A = pick([120, 150, 200, 240, 300, 360, 480, 500, 640, 800]);
  const n = pick([2, 3, 4, 5]);
  const rPct = pick([5, 6, 8, 10, 12, 15, 18, 20]);
  const r = rPct / 100;
  const B = Math.round(A * Math.pow(1 + r, n));
  const correct = rPct;
  const opts = new Set([correct]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 50) {
    const v = pick([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 25]);
    if (v !== correct) opts.add(v);
  }
  const optArr = shuffle(Array.from(opts));
  root.innerHTML = `<div class="quiz-card">
    <div class="quiz-stat">答对 <b id="tgScore">${toolGrowth.score}</b> / <span id="tgTotal">${toolGrowth.total}</span></div>
    <div class="quiz-q">基期 ${A}，现期 ${B}，间隔 ${n} 年。<br>求年均增长率 r = (B/A)<sup>1/${n}</sup> − 1（精确到整数百分比）</div>
    <div class="quiz-opts" id="tgOpts">${optArr.map(o => `<button class="quiz-opt" data-v="${o}">${o}%</button>`).join('')}</div>
    <div class="quiz-fb" id="tgFb"></div>
    <div class="quiz-actions"><button class="primary-btn" id="tgNext">下一题 →</button></div>
  </div>`;
  const optsEl = $('#tgOpts');
  optsEl.dataset.done = '';
  optsEl.querySelectorAll('.quiz-opt').forEach(b => {
    b.addEventListener('click', () => {
      if (optsEl.dataset.done) return;
      optsEl.dataset.done = '1';
      const v = parseInt(b.dataset.v, 10);
      toolGrowth.total++;
      const ok = v === correct;
      if (ok) toolGrowth.score++;
      b.classList.add(ok ? 'correct' : 'wrong');
      optsEl.querySelectorAll('.quiz-opt').forEach(x => { if (parseInt(x.dataset.v, 10) === correct) x.classList.add('correct'); });
      $('#tgScore').textContent = toolGrowth.score;
      $('#tgTotal').textContent = toolGrowth.total;
      const real = (Math.pow(B / A, 1 / n) - 1) * 100;
      $('#tgFb').textContent = ok ? '✅ 正确！' : `❌ 正确答案：${correct}%（实际约 ${real.toFixed(1)}%）`;
      $('#tgFb').className = 'quiz-fb ' + (ok ? 'ok' : 'bad');
    });
  });
  $('#tgNext').addEventListener('click', renderToolGrowth);
};

/* ---------- 4) 截面图练习：立体图形截面可视化 + 四选一 ---------- */
const SECTION_PUZZLES = [
  { type: 'cylinder', name: '圆柱', cut: '水平', ans: '圆' },
  { type: 'cylinder', name: '圆柱', cut: '竖直', ans: '矩形' },
  { type: 'cone', name: '圆锥', cut: '水平', ans: '圆' },
  { type: 'cone', name: '圆锥', cut: '过顶点竖直', ans: '三角形' },
  { type: 'sphere', name: '球体', cut: '任意', ans: '圆' },
  { type: 'cube', name: '正方体', cut: '水平', ans: '正方形' },
  { type: 'cube', name: '正方体', cut: '竖直', ans: '矩形' },
  { type: 'triPrism', name: '三棱柱', cut: '水平', ans: '三角形' },
];
const SHAPE_POOL = ['圆', '椭圆', '矩形', '正方形', '三角形', '梯形'];
const drawSolid = (canvas, type) => {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#eaf4ff'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a6ea5'; ctx.fillStyle = '#cfe6ff'; ctx.lineWidth = 2;
  const cx = W / 2;
  if (type === 'cylinder') {
    const top = 40, bot = 140, rx = 55, ry = 18;
    ctx.beginPath(); ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - rx, top); ctx.lineTo(cx - rx, bot); ctx.moveTo(cx + rx, top); ctx.lineTo(cx + rx, bot); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI); ctx.fill(); ctx.stroke();
  } else if (type === 'cone') {
    const top = 35, bot = 145, rx = 55, ry = 16;
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx - rx, bot); ctx.lineTo(cx + rx, bot); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI); ctx.fill(); ctx.stroke();
  } else if (type === 'sphere') {
    const c = cx, cy = 90, r = 58;
    const g = ctx.createRadialGradient(c - 18, cy - 18, 8, c, cy, r);
    g.addColorStop(0, '#eaf6ff'); g.addColorStop(1, '#9cc6f0');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (type === 'cube') {
    const x = 70, y = 45, s = 90, d = 28;
    ctx.beginPath(); ctx.rect(x, y, s, s); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + d, y - d); ctx.lineTo(x + d + s, y - d); ctx.lineTo(x + s, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s, y); ctx.lineTo(x + s + d, y - d); ctx.lineTo(x + s + d, y - d + s); ctx.lineTo(x + s, y + s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + d, y - d); ctx.lineTo(x + d, y - d + s); ctx.lineTo(x + s, y + s); ctx.stroke();
  } else if (type === 'triPrism') {
    const x = 70, y = 60, w = 90, h = 80, d = 30;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y - h / 2); ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 70); ctx.lineTo(x + w, y + 70); ctx.lineTo(x + w, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + d, y - d); ctx.lineTo(x + w + d, y + 70 - d); ctx.lineTo(x + w, y + 70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w / 2, y - h / 2); ctx.lineTo(x + w / 2 + d, y - h / 2 - d); ctx.lineTo(x + w + d, y - d); ctx.stroke();
  }
};
const renderToolSection = () => {
  const root = $('#toolSectionRoot'); if (!root) return;
  const p = pick(SECTION_PUZZLES);
  const distract = shuffle(SHAPE_POOL.filter(s => s !== p.ans)).slice(0, 3);
  const opts = shuffle([p.ans, ...distract]);
  root.innerHTML = `<div class="quiz-card">
    <div class="quiz-q">对该<b>${p.name}</b>做<b>${p.cut}</b>截面，得到的截面形状是？</div>
    <div class="section-canvas-wrap"><canvas id="secCanvas" width="240" height="180"></canvas></div>
    <div class="quiz-opts" id="secOpts">${opts.map(o => `<button class="quiz-opt" data-v="${o}">${o}</button>`).join('')}</div>
    <div class="quiz-fb" id="secFb"></div>
    <div class="quiz-actions"><button class="primary-btn" id="secNext">下一题 →</button></div>
  </div>`;
  const canvas = $('#secCanvas');
  if (canvas) drawSolid(canvas, p.type);
  const optsEl = $('#secOpts');
  optsEl.dataset.done = '';
  optsEl.querySelectorAll('.quiz-opt').forEach(b => {
    b.addEventListener('click', () => {
      if (optsEl.dataset.done) return;
      optsEl.dataset.done = '1';
      const v = b.dataset.v;
      const ok = v === p.ans;
      b.classList.add(ok ? 'correct' : 'wrong');
      optsEl.querySelectorAll('.quiz-opt').forEach(x => { if (x.dataset.v === p.ans) x.classList.add('correct'); });
      $('#secFb').textContent = ok ? '✅ 正确！' : `❌ 正确答案：${p.ans}`;
      $('#secFb').className = 'quiz-fb ' + (ok ? 'ok' : 'bad');
    });
  });
  $('#secNext').addEventListener('click', renderToolSection);
};

/* ---------- 启动 ---------- */
const init = () => {
  loadState();
  const fab = document.createElement('button');
  fab.id = 'planFab'; fab.className = 'fab-plus'; fab.textContent = '＋'; fab.title = '添加打卡目标';
  fab.style.display = 'none';
  fab.addEventListener('click', () => { navigate('daily-plan'); setTimeout(() => { $('#planInput')?.focus(); }, 200); });
  document.body.appendChild(fab);

  bindEvents();
  loadProfile();
  applyNavMode();
  applyFont();
  renderTopbar();
  // 番茄钟收起状态（持久化）
  try { applyPomoHidden(localStorage.getItem(POMO_HIDDEN_KEY) === '1'); } catch (_) {}
  const hash = location.hash.replace('#', '');
  navigate(ROUTES.includes(hash) ? hash : 'home');
};

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (location.search.includes('demo=1')) {
    if (!state.plans.length) loadDemoData(); else renderTopbar();
    const hash = location.hash.replace('#', '');
    if (ROUTES.includes(hash) && hash !== 'home') navigate(hash);
  }
  if (location.search.includes('pomo=1')) setTimeout(() => { $('#pomoPanel').hidden = false; pomoRender(); }, 100);
});