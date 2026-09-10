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
  plans: [],
  checkins: {},
  stats: [],
  errors: [],
  maoIdx: null,
  qtyIdx: null,
  progress: { language: {}, politics: {}, commonSense: {}, dataAnalysis: {} },
  notes: {},
  profile: { avatar: '', nickname: '备考兔', motto: '每天进步一点点，上岸就在眼前 ✨' },
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
      sync: parsed.sync || {},
      meta: { ...defaultState().meta, ...(parsed.meta || {}) } };
  } catch (e) { console.warn('数据读取失败', e); }
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
  'shenlun-small', 'shenlun-big', 'errors'
];
const MODULE_ROUTES = ['politics','common-sense','language','logic','quantity','data-analysis','shenlun-small','shenlun-big'];
const ROUTE_CAT = {
  'politics':'政治理论','common-sense':'常识','language':'言语理解','logic':'逻辑判断',
  'quantity':'数量关系','data-analysis':'资料分析','shenlun-small':'申论','shenlun-big':'申论'
};
const COURSE_FOR_ROUTE = { 'politics':'politics','common-sense':'commonSense','language':'language','data-analysis':'dataAnalysis' };

const navigate = (route) => {
  if (!ROUTES.includes(route)) route = 'home';
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
    const regText = exam.regDate ? `｜报名：${exam.regDate}（${regPassed ? '已结束' : '还剩 ' + regDays + ' 天'}）` : '';
    const regLink = exam.url ? `<a class="exam-link" href="${escapeAttr(exam.url)}" target="_blank" rel="noopener">🔗 报名官网</a>` : '';
    const regTip = (regDays !== null && regDays >= 0 && regDays <= 14) ? `<div class="exam-reg-tip">⚠️ 报名还剩 ${regDays} 天，请尽快前往官网完成！</div>` : '';
    return `
      <div class="exam-item ${urgent ? 'urgent' : ''}">
        <div class="exam-info">
          <div class="exam-name">📌 ${escapeHtml(exam.name)} ${regLink}</div>
          <div class="exam-date">考试：${exam.date} ${passed ? '· 已过' : '· 还剩 ' + days + ' 天'}${regText}</div>
          ${regTip}
        </div>
        <div class="exam-days ${urgent ? 'urgent' : ''}">${passed ? '已过' : days}<span class="small">${passed ? '' : '天'}</span></div>
        <button class="danger-btn" data-del-exam="${exam.id}">删除</button>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-del-exam]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.exams = state.exams.filter(e => e.id !== btn.dataset.delExam);
      saveState(); renderExamList(); toast('已删除');
    });
  });
};

const addExam = () => {
  const name = prompt('考试名称（如：国考笔试 / 省考面试）');
  if (!name) return;
  const date = prompt('考试日期（YYYY-MM-DD）');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('日期格式不正确', 'error'); return; }
  const regDate = prompt('报名开始/截止日期（YYYY-MM-DD，没有则留空）');
  const exam = { id: 'e_' + Date.now(), name, date };
  if (regDate && /^\d{4}-\d{2}-\d{2}$/.test(regDate)) exam.regDate = regDate;
  const urlRaw = prompt('报名 / 官网网址（没有则留空，如 https://bm.scs.gov.cn/）');
  if (urlRaw && /^https?:\/\//i.test(urlRaw.trim())) exam.url = urlRaw.trim();
  state.exams.push(exam);
  saveState(); renderExamList(); toast('已添加');
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

/* ---------- 头像 / 昵称 ---------- */
const loadProfile = () => {
  const p = state.profile;
  const av = $('#avatar');
  if (p.avatar) av.innerHTML = `<img src="${p.avatar}" alt="头像">`; else av.textContent = '🐰';
  $('#nickname').innerHTML = escapeHtml(p.nickname) + ' <span class="edit-ico">✏️</span>';
  $('#motto').textContent = p.motto;
};
const compressAvatar = (file, cb) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const scale = 300 / img.width;
      const w = 300, h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => cb(null);
    img.src = e.target.result;
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

  document.querySelectorAll('input[name="trendMetric"]').forEach(r => r.addEventListener('change', renderTrend));

  $('#politicsRefresh').addEventListener('click', () => {
    state.pref.pastOffset = (state.pref.pastOffset || 0) + 1; saveState(); renderPolitics(); toast('已换一批');
  });

  $('#avatarWrap').addEventListener('click', () => $('#avatarInput').click());
  $('#avatarInput').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    compressAvatar(f, (b64) => {
      if (!b64) { toast('图片读取失败', 'error'); return; }
      state.profile.avatar = b64; saveState(); loadProfile(); toast('头像已更新');
    });
    e.target.value = '';
  });
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
    const headers = { ...supaHeaders(), 'Prefer': 'resolution=merge-duplicates' };
    let res = await fetch(`${base}/rest/v1/workspace_sync?id=eq.main`, {
      method: 'PATCH', headers, body: JSON.stringify({ data: payload, updated_at: new Date().toISOString() })
    });
    if (res.status === 404) {
      res = await fetch(`${base}/rest/v1/workspace_sync`, {
        method: 'POST', headers, body: JSON.stringify({ id: 'main', data: payload, updated_at: new Date().toISOString() })
      });
    }
    if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status);
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
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
const saveSyncConfig = () => {
  state.sync.url = $('#syncUrl').value.trim();
  state.sync.anonKey = $('#syncKey').value.trim();
  state.sync.code = $('#syncCode').value.trim();
  state.sync.enabled = !!(state.sync.url && state.sync.anonKey);
  saveState();
  setSyncStatus(state.sync.enabled ? '☁️ 已保存并启用' : '已保存（未启用）');
  toast('云端同步配置已保存');
  if (state.sync.enabled) pushToCloud();
};
const testSync = async () => {
  const url = $('#syncUrl').value.trim(), key = $('#syncKey').value.trim();
  if (!url || !key) { setSyncStatus('⚠️ 请填写 URL 和 anon key'); return; }
  setSyncStatus('🔄 测试中…');
  try {
    const base = url.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/v1/workspace_sync?id=eq.main&select=id`, { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    setSyncStatus(res.ok ? '✅ 连接成功' : '⚠️ 连接失败 HTTP ' + res.status);
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