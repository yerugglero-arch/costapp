/* ==================== 记账 PWA 应用核心逻辑 ==================== */

// 分类配置
const CATEGORIES = {
  expense: [
    { id: 'food', name: '餐饮', emoji: '🍜' },
    { id: 'transport', name: '交通', emoji: '🚇' },
    { id: 'shopping', name: '购物', emoji: '🛍️' },
    { id: 'entertain', name: '娱乐', emoji: '🎬' },
    { id: 'home', name: '居家', emoji: '🏠' },
    { id: 'medical', name: '医疗', emoji: '💊' },
    { id: 'edu', name: '教育', emoji: '📚' },
    { id: 'other_e', name: '其他', emoji: '📦' }
  ],
  income: [
    { id: 'salary', name: '工资', emoji: '💰' },
    { id: 'parttime', name: '兼职', emoji: '🛠️' },
    { id: 'redpacket', name: '红包', emoji: '🧧' },
    { id: 'invest', name: '投资', emoji: '📈' },
    { id: 'other_i', name: '其他', emoji: '🎁' }
  ]
};
const CAT_MAP = {};
[...CATEGORIES.expense, ...CATEGORIES.income].forEach(c => CAT_MAP[c.id] = c);

// 存储
const STORAGE_KEY = 'costapp_records_v1';
const STATE_KEY = 'costapp_state_v1';
const OPENING_BALANCE_KEY = 'costapp_opening_balance_v1';

let state = {
  selectedType: 'expense',
  selectedCategory: null,
  editingId: null,
  recordsFilter: 'all',
  recordsFilterDate: null, // YYYY-MM-DD，当 recordsFilter === 'custom' 时使用
  statsMonth: null // {year, month}
};

// 工具
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const fmt = n => '¥' + (Math.round(n * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function getRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveRecords(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
function saveState() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function getOpeningBalance() {
  const v = parseFloat(localStorage.getItem(OPENING_BALANCE_KEY));
  return isNaN(v) ? 0 : v;
}
function setOpeningBalance(v) { localStorage.setItem(OPENING_BALANCE_KEY, String(v)); }
// 期初余额默认 0（用户自行通过账单调整）
function initOpeningBalanceIfNeeded() {
  if (localStorage.getItem(OPENING_BALANCE_KEY) === null) {
    setOpeningBalance(0);
  }
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    Object.assign(state, s);
  } catch {}
  if (!state.statsMonth) {
    const d = new Date();
    state.statsMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
}

// Toast
let toastTimer = null;
function toast(msg, ms = 1500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ==================== 渲染分类网格 ====================
function renderCategoryGrid() {
  const grid = $('#category-grid');
  const list = CATEGORIES[state.selectedType];
  grid.innerHTML = list.map(c => `
    <button class="cat-item ${state.selectedCategory === c.id ? 'selected' : ''}" data-cat="${c.id}">
      <div class="cat-emoji">${c.emoji}</div>
      <div class="cat-name">${c.name}</div>
    </button>
  `).join('');
  grid.querySelectorAll('.cat-item').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedCategory = el.dataset.cat;
      renderCategoryGrid();
    });
  });
}

// ==================== 渲染首页 ====================
function renderHome() {
  const records = getRecords();
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  let totalIncome = 0, totalExpense = 0, monthIncome = 0, monthExpense = 0;
  records.forEach(r => {
    if (r.type === 'income') totalIncome += +r.amount;
    else totalExpense += +r.amount;
    if (r.date.startsWith(ym)) {
      if (r.type === 'income') monthIncome += +r.amount;
      else monthExpense += +r.amount;
    }
  });

  $('#total-balance').textContent = fmt(getOpeningBalance() + totalIncome - totalExpense);
  $('#month-income').textContent = fmt(monthIncome);
  $('#month-expense').textContent = fmt(monthExpense);
  $('#month-surplus').textContent = fmt(monthIncome - monthExpense);

  // 最近 5 条
  const recent = [...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const list = $('#recent-records');
  $('#home-empty').hidden = recent.length > 0;
  list.innerHTML = recent.map(r => recordItemHTML(r)).join('');
  bindRecordItems(list);
}

function recordItemHTML(r) {
  const cat = CAT_MAP[r.category] || { name: '其他', emoji: '📦' };
  return `
    <div class="record-item" data-id="${r.id}">
      <div class="record-icon">${cat.emoji}</div>
      <div class="record-info">
        <div class="record-category">${cat.name}</div>
        <div class="record-note">${r.note ? escapeHTML(r.note) : formatDateShort(r.date)}</div>
      </div>
      <div class="record-amount ${r.type}">${r.type === 'income' ? '+' : '−'}${fmt(r.amount).slice(1)}</div>
    </div>
  `;
}

function escapeHTML(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function formatDateShort(d) {
  const dt = new Date(d);
  const m = dt.getMonth() + 1, day = dt.getDate();
  return `${m}月${day}日`;
}

// ==================== 操作菜单（长按/右键弹出） ====================
let actionMenuRecordId = null;
function showActionMenu(recordId, anchorEl, x, y) {
  const menu = $('#action-menu');
  if (!menu) return;
  actionMenuRecordId = recordId;

  // 先显示一下获取尺寸，再定位
  menu.classList.add('show');
  menu.setAttribute('aria-hidden', 'false');
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  // 如果传入了锚点元素（长按），以其为基准定位；否则用 x,y（右键）
  let left, top;
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    left = r.left + r.width / 2 - rect.width / 2;
    top = r.top - rect.height - 8;
    if (top < 8) top = r.bottom + 8; // 上方不够就翻到下方
  } else {
    left = x; top = y;
  }
  // 边界修正
  left = Math.max(8, Math.min(left, vw - rect.width - 8));
  top = Math.max(8, Math.min(top, vh - rect.height - 8));

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  // 重新触发动画
  menu.classList.remove('show');
  void menu.offsetWidth;
  menu.classList.add('show');
  menu.setAttribute('aria-hidden', 'false');
}
function hideActionMenu() {
  const menu = $('#action-menu');
  if (!menu) return;
  menu.classList.remove('show');
  menu.setAttribute('aria-hidden', 'true');
  actionMenuRecordId = null;
}

function bindRecordItems(container) {
  container.querySelectorAll('.record-item').forEach(el => {
    // 点击编辑（区分长按，避免冲突）
    let clickTimer = null;
    let longPressed = false;

    el.addEventListener('click', () => {
      if (longPressed) { longPressed = false; return; }
      // 如果菜单已经打开，先关菜单不触发编辑
      const menu = $('#action-menu');
      if (menu && menu.classList.contains('show')) { hideActionMenu(); return; }
      clickTimer = setTimeout(() => editRecord(el.dataset.id), 200);
    });

    // 移动端长按 → 弹操作菜单
    el.addEventListener('touchstart', e => {
      longPressed = false;
      el._longTimer = setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
        showActionMenu(el.dataset.id, el);
      }, 550);
    });
    el.addEventListener('touchend', () => clearTimeout(el._longTimer));
    el.addEventListener('touchmove', () => clearTimeout(el._longTimer));

    // 桌面端鼠标长按 → 弹操作菜单
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      longPressed = false;
      el._mouseTimer = setTimeout(() => {
        longPressed = true;
        showActionMenu(el.dataset.id, el);
      }, 550);
    });
    el.addEventListener('mouseup', () => clearTimeout(el._mouseTimer));
    el.addEventListener('mouseleave', () => clearTimeout(el._mouseTimer));

    // 桌面端右键 → 弹操作菜单（防原生菜单）
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      longPressed = true;
      showActionMenu(el.dataset.id, null, e.clientX, e.clientY);
    });
  });
}

function editRecord(id) {
  const r = getRecords().find(x => x.id === id);
  if (!r) { toast('记录不存在或已删除'); return; }
  state.editingId = id;
  state.selectedType = r.type;
  // 防御性修复：如果分类 id 不在 CAT_MAP（旧数据），回退到"其他"
  if (!CAT_MAP[r.category]) {
    state.selectedCategory = r.type === 'income' ? 'other_i' : 'other_e';
  } else {
    state.selectedCategory = r.category;
  }
  $('#amount-input').value = r.amount;
  $('#date-input').value = r.date;
  $('#note-input').value = r.note || '';
  renderCategoryGrid();
  // 编辑模式：显示删除按钮 + 改标题
  $('#modal-title').textContent = '编辑记录';
  const delRow = $('#delete-row');
  if (delRow) delRow.style.display = 'block';
  openModal(true);
}

function deleteRecord(id) {
  saveRecords(getRecords().filter(r => r.id !== id));
  toast('已删除');
  renderAll();
}

// ==================== 渲染记录页 ====================
function renderRecords() {
  const records = getRecords();
  const now = new Date();
  const weekStart = new Date(now);
  // JS getDay(): 0=周日,1=周一...6=周六。本周按周一为起点：周一=0, 周二=1, ... 周日=6
  const dow = (now.getDay() + 6) % 7; // 把周日(0)→6, 周一(1)→0
  weekStart.setDate(now.getDate() - dow);
  weekStart.setHours(0, 0, 0, 0);
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  let filtered = records;
  if (state.recordsFilter === 'month') filtered = records.filter(r => r.date.startsWith(ym));
  else if (state.recordsFilter === 'week') filtered = records.filter(r => new Date(r.date) >= weekStart);
  else if (state.recordsFilter === 'custom' && state.recordsFilterDate) filtered = records.filter(r => r.date === state.recordsFilterDate);

  filtered.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  const groups = {};
  filtered.forEach(r => { (groups[r.date] = groups[r.date] || []).push(r); });

  // 同步 filter 按钮高亮（含 custom 场景）
  $$('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === state.recordsFilter);
  });
  // 当前筛选提示
  const info = $('#filter-info');
  if (info) {
    if (state.recordsFilter === 'custom' && state.recordsFilterDate) {
      const dt = new Date(state.recordsFilterDate);
      info.textContent = `当前筛选：${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（共 ${filtered.length} 条）· 点"全部"清除`;
      info.hidden = false;
    } else {
      info.hidden = true;
    }
  }

  const container = $('#all-records');
  $('#records-empty').hidden = filtered.length > 0;
  container.innerHTML = Object.keys(groups).sort((a, b) => a < b ? 1 : -1).map(date => {
    const items = groups[date];
    const dayIncome = items.filter(i => i.type === 'income').reduce((s, i) => s + +i.amount, 0);
    const dayExpense = items.filter(i => i.type === 'expense').reduce((s, i) => s + +i.amount, 0);
    return `
      <div class="record-date-group">
        <div class="record-date-label">${formatDateLong(date)} · 收 ${fmt(dayIncome)} · 支 ${fmt(dayExpense)}</div>
        ${items.map(r => recordItemHTML(r)).join('')}
      </div>
    `;
  }).join('');
  bindRecordItems(container);
}

function formatDateLong(d) {
  const dt = new Date(d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  const diff = Math.round((today - target) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

// ==================== 渲染日历 ====================
function renderCalendar() {
  const { year, month } = state.statsMonth;
  const ym = year + '-' + String(month).padStart(2, '0');

  const records = getRecords().filter(r => r.date.startsWith(ym));
  const dailyMap = {}; // dateStr -> {income, expense}
  records.forEach(r => {
    if (!dailyMap[r.date]) dailyMap[r.date] = { income: 0, expense: 0 };
    if (r.type === 'income') dailyMap[r.date].income += +r.amount;
    else dailyMap[r.date].expense += +r.amount;
  });

  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = firstDay.getDay(); // 0=周日...6=周六
  // 按周一为第一列：周一=0, 周二=1, ... 周日=6  →  前置空格 = (firstWeekday + 6) % 7
  const leadingBlanks = (firstWeekday + 6) % 7;
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  const cells = [];
  // 前置：上月末尾
  for (let i = leadingBlanks - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dateStr = (month === 1 ? year - 1 : year) + '-' + String(month === 1 ? 12 : month - 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    cells.push({ day, dateStr, out: true });
  }
  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = ym + '-' + String(d).padStart(2, '0');
    cells.push({ day: d, dateStr, out: false });
  }
  // 后置：补齐到 42 格（6 行）
  let nextDay = 1;
  while (cells.length < 42) {
    const dateStr = (month === 12 ? year + 1 : year) + '-' + String(month === 12 ? 1 : month + 1).padStart(2, '0') + '-' + String(nextDay).padStart(2, '0');
    cells.push({ day: nextDay, dateStr, out: true });
    nextDay++;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const selectedDate = state.recordsFilter === 'custom' ? state.recordsFilterDate : null;

  const fmtSmall = n => {
    if (n <= 0) return '';
    return n.toFixed(2);
  };

  const grid = $('#calendar-grid');
  grid.innerHTML = cells.map(c => {
    const stats = dailyMap[c.dateStr] || { income: 0, expense: 0 };
    const isToday = c.dateStr === todayStr;
    const isSelected = c.dateStr === selectedDate && !c.out;
    const classes = ['cal-cell'];
    if (c.out) classes.push('out-of-month');
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');
    return `
      <div class="${classes.join(' ')}" data-date="${c.dateStr}">
        <div class="cal-num">${c.day}</div>
        <div class="cal-amounts">
          ${stats.income > 0 ? `<div class="cal-amount income">+${fmtSmall(stats.income)}</div>` : ''}
          ${stats.expense > 0 ? `<div class="cal-amount expense">−${fmtSmall(stats.expense)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ==================== 渲染统计页 ====================
function renderStats() {
  const { year, month } = state.statsMonth;
  const ym = year + '-' + String(month).padStart(2, '0');
  $('#stats-month-label').textContent = `${year}年${month}月`;

  renderCalendar();

  const records = getRecords().filter(r => r.date.startsWith(ym));
  let income = 0, expense = 0;
  const catMap = {};
  records.forEach(r => {
    if (r.type === 'income') income += +r.amount;
    else {
      expense += +r.amount;
      catMap[r.category] = (catMap[r.category] || 0) + +r.amount;
    }
  });

  $('#stats-income').textContent = fmt(income);
  $('#stats-expense').textContent = fmt(expense);
  $('#stats-surplus').textContent = fmt(income - expense);

  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const list = $('#category-list');
  $('#stats-empty').hidden = cats.length > 0;
  list.innerHTML = cats.map(([id, amt]) => {
    const c = CAT_MAP[id] || { name: '其他', emoji: '📦' };
    const pct = expense > 0 ? (amt / expense * 100) : 0;
    return `
      <div class="cat-stat">
        <div class="record-icon">${c.emoji}</div>
        <div class="cat-stat-info">
          <div class="cat-stat-top">
            <span class="cat-stat-name">${c.name}</span>
            <span class="cat-stat-amount">${fmt(amt)}</span>
          </div>
          <div class="cat-stat-bar"><div class="cat-stat-bar-fill" style="width: ${pct}%"></div></div>
          <div class="cat-stat-pct">占比 ${pct.toFixed(1)}%</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAll() { renderHome(); renderRecords(); renderStats(); }

// ==================== 弹窗 ====================
function openModal(skipReset = false) {
  if (!skipReset || !state.editingId) {
    // 新增模式：重置表单并隐藏删除按钮
    $('#amount-input').value = '';
    $('#date-input').value = todayStr();
    $('#note-input').value = '';
    state.selectedType = 'expense';
    state.selectedCategory = CATEGORIES.expense[0].id;
    $('#modal-title').textContent = '记一笔';
    const delRow = $('#delete-row');
    if (delRow) delRow.style.display = 'none';
  }
  renderCategoryGrid();
  $('#add-modal').classList.add('active');
  $('#add-modal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#amount-input').focus(), 320);
}

function closeModal() {
  $('#add-modal').classList.remove('active');
  $('#add-modal').setAttribute('aria-hidden', 'true');
  state.editingId = null;
  // 关闭后恢复默认（防止下次打开残留删除按钮）
  setTimeout(() => {
    $('#modal-title').textContent = '记一笔';
    const delRow = $('#delete-row');
    if (delRow) delRow.style.display = 'none';
  }, 300);
}

function saveRecord() {
  const amount = parseFloat($('#amount-input').value);
  if (!amount || amount <= 0) { toast('请输入金额'); return; }
  if (!state.selectedCategory || !CAT_MAP[state.selectedCategory]) { toast('请选择分类'); return; }
  const date = $('#date-input').value || todayStr();
  const note = $('#note-input').value.trim();
  const records = getRecords();

  if (state.editingId) {
    const idx = records.findIndex(r => r.id === state.editingId);
    if (idx >= 0) {
      records[idx] = { ...records[idx], type: state.selectedType, amount, category: state.selectedCategory, note, date };
    }
  } else {
    records.push({ id: uid(), type: state.selectedType, amount, category: state.selectedCategory, note, date, createdAt: Date.now() });
  }
  saveRecords(records);
  saveState();
  closeModal();
  toast('已保存');
  renderAll();
}

// ==================== Tab 切换 ====================
function switchPage(page) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-' + page).classList.add('active');
  $$('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  window.scrollTo(0, 0);
  if (page === 'records') renderRecords();
  if (page === 'stats') renderStats();
}

// ==================== 数据管理 ====================
function exportData() {
  const records = getRecords();
  if (records.length === 0) { toast('暂无数据可导出'); return; }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    openingBalance: getOpeningBalance(),
    records
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `记账数据_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      let incomingRecords = [];
      let incomingOpening = null;

      if (Array.isArray(data)) {
        // 旧版：纯 records 数组
        incomingRecords = data;
      } else if (data && Array.isArray(data.records)) {
        // 新版：对象格式
        incomingRecords = data.records;
        if (typeof data.openingBalance === 'number' && !isNaN(data.openingBalance)) {
          incomingOpening = data.openingBalance;
        }
      } else {
        throw new Error('格式错误');
      }

      const records = getRecords();
      const existing = new Set(records.map(r => r.id));
      let added = 0;
      incomingRecords.forEach(r => {
        if (!r.id) r.id = uid();
        if (!existing.has(r.id)) { records.push(r); added++; }
      });
      saveRecords(records);

      if (incomingOpening !== null) {
        setOpeningBalance(incomingOpening);
      }

      renderAll();
      let msg = `已导入 ${added} 条`;
      if (incomingOpening !== null) msg += `，余额已同步`;
      toast(msg);
    } catch (err) { toast('文件格式错误'); }
  };
  reader.readAsText(file);
}

function clearAllData() {
  if (!confirm('确定清空所有记账数据？此操作不可恢复')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(SEED_KEY); // 允许重新填充种子数据
  state = {
    selectedType: 'expense',
    selectedCategory: CATEGORIES.expense[0].id,
    editingId: null,
    recordsFilter: 'all',
    recordsFilterDate: null,
    statsMonth: null
  };
  const d = new Date();
  state.statsMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
  // 清除期初，使下次打开或导入时按规则重新校准
  localStorage.removeItem(OPENING_BALANCE_KEY);
  initOpeningBalanceIfNeeded();
  renderAll();
  toast('已清空所有数据');
}

// ==================== 事件绑定 ====================
function bindEvents() {
  // 操作菜单按钮
  const menu = $('#action-menu');
  if (menu) {
    menu.querySelectorAll('.action-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = actionMenuRecordId;
        const action = btn.dataset.action;
        hideActionMenu();
        if (!id) return;
        if (action === 'edit') editRecord(id);
        else if (action === 'delete') {
          setTimeout(() => {
            if (confirm('删除这条记录？')) deleteRecord(id);
          }, 50);
        }
      });
    });
  }
  // 点击空白 / 滚动 / 切换页面 → 关闭菜单
  document.addEventListener('click', e => {
    const m = $('#action-menu');
    if (!m || !m.classList.contains('show')) return;
    if (e.target.closest('#action-menu') || e.target.closest('.record-item')) return;
    hideActionMenu();
  }, true);
  window.addEventListener('scroll', hideActionMenu, true);
  window.addEventListener('resize', hideActionMenu);

  // Tab 切换
  $$('.tab-item').forEach(t => t.addEventListener('click', () => { hideActionMenu(); switchPage(t.dataset.page); }));
  // 查看全部
  $('#view-all-btn').addEventListener('click', () => switchPage('records'));
  // FAB
  $('#fab').addEventListener('click', () => openModal());
  // 弹窗取消
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-save').addEventListener('click', saveRecord);
  $$('.modal-mask').forEach(m => m.addEventListener('click', closeModal));
  // 弹窗内删除按钮
  const modalDel = $('#modal-delete');
  if (modalDel) {
    modalDel.addEventListener('click', () => {
      if (!state.editingId) return;
      if (confirm('删除这条记录？')) {
        const id = state.editingId;
        state.editingId = null;
        deleteRecord(id);
        closeModal();
      }
    });
  }
  // ESC 键关闭弹窗 / 操作菜单
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const modal = $('#add-modal');
    if (modal && modal.classList.contains('active')) { closeModal(); return; }
    const m = $('#action-menu');
    if (m && m.classList.contains('show')) hideActionMenu();
  });
  // 类型切换
  $$('.type-btn').forEach(b => b.addEventListener('click', () => {
    state.selectedType = b.dataset.type;
    state.selectedCategory = CATEGORIES[state.selectedType][0].id;
    $$('.type-btn').forEach(x => x.classList.toggle('active', x === b));
    renderCategoryGrid();
  }));
  // 过滤
  $$('.filter-btn').forEach(b => b.addEventListener('click', () => {
    state.recordsFilter = b.dataset.filter;
    $$('.filter-btn').forEach(x => x.classList.toggle('active', x === b));
    renderRecords();
    saveState();
  }));
  // 月份切换
  $('#prev-month').addEventListener('click', () => {
    let { year, month } = state.statsMonth;
    month--; if (month < 1) { month = 12; year--; }
    state.statsMonth = { year, month };
    renderStats(); saveState();
  });
  $('#next-month').addEventListener('click', () => {
    let { year, month } = state.statsMonth;
    month++; if (month > 12) { month = 1; year++; }
    state.statsMonth = { year, month };
    renderStats(); saveState();
  });
  // 数据管理
  $('#export-btn').addEventListener('click', exportData);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#clear-btn').addEventListener('click', clearAllData);
  // 金额回车保存
  $('#amount-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveRecord(); });

  // 首页余额 5 连点 → 切换快速导入面板（保护隐私，不常显示）
  let tapCount = 0, tapTimer = null;
  const balanceCard = document.querySelector('.balance-amount');
  if (balanceCard) {
    balanceCard.style.cursor = 'pointer';
    balanceCard.addEventListener('click', () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => tapCount = 0, 1200);
      if (tapCount >= 5) {
        tapCount = 0;
        const box = $('#paste-import-box');
        if (box) box.style.display = (box.style.display === 'none') ? 'block' : 'none';
        toast(box.style.display === 'block' ? '已打开快速导入' : '已关闭快速导入');
      }
    });
  }
  const pasteBtn = $('#paste-import-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', () => {
      const txt = $('#paste-area').value.trim();
      if (!txt) { toast('先粘贴数据'); return; }
      try {
        const raw = JSON.parse(txt);
        let incomingRecords = [];
        let incomingOpening = null;
        if (Array.isArray(raw)) incomingRecords = raw;
        else if (raw && Array.isArray(raw.records)) {
          incomingRecords = raw.records;
          if (typeof raw.openingBalance === 'number' && !isNaN(raw.openingBalance)) incomingOpening = raw.openingBalance;
        } else if (raw && raw.data && Array.isArray(raw.data)) {
          // records-data.json 种子文件：按日生成收入/支出两条
          raw.data.forEach(monthBlock => {
            const m = String(monthBlock.month).padStart(2, '0');
            if (!Array.isArray(monthBlock.daily)) return;
            monthBlock.daily.forEach(d => {
              const day = String(d.day).padStart(2, '0');
              const dateStr = `${new Date().getFullYear()}-${m}-${day}`;
              if (+d.income > 0) incomingRecords.push({
                id: uid(), date: dateStr, type: 'income',
                amount: +d.income, category: 'other_i', note: ''
              });
              if (+d.expense > 0) incomingRecords.push({
                id: uid(), date: dateStr, type: 'expense',
                amount: +d.expense, category: 'other_e', note: ''
              });
            });
          });
          // 种子导入时期初默认 0，用户自行调整
          incomingOpening = 0;
        } else throw new Error('不认识的格式');
        if (!incomingRecords.length) throw new Error('空数据');

        // 先清空再写入（避免重号）
        saveRecords(incomingRecords);
        if (incomingOpening !== null) setOpeningBalance(incomingOpening);
        localStorage.removeItem(STATE_KEY); // 重置筛选状态
        location.reload();
      } catch (err) {
        toast('格式错误：' + (err.message || '无法解析'));
      }
    });
  }
  const clearPaste = $('#paste-clear-btn');
  if (clearPaste) clearPaste.addEventListener('click', () => { $('#paste-area').value = ''; });
  // 日历点击：选中日期 → 切到记录页看当日明细
  const calGrid = $('#calendar-grid');
  if (calGrid) {
    calGrid.addEventListener('click', e => {
      const cell = e.target.closest('.cal-cell');
      if (!cell || cell.classList.contains('out-of-month')) return;
      const date = cell.dataset.date;
      if (!date) return;
      state.recordsFilter = 'custom';
      state.recordsFilterDate = date;
      $$('.filter-btn').forEach(x => x.classList.remove('active'));
      // 如果所选月份不在当前 state.statsMonth 里，同步一下
      const [y, m] = date.split('-').map(Number);
      if (state.statsMonth.year !== y || state.statsMonth.month !== m) {
        state.statsMonth = { year: y, month: m };
      }
      saveState();
      switchPage('records');
      // 显示简要提示
      const dt = new Date(date);
      toast(`${dt.getMonth() + 1}月${dt.getDate()}日 · 当日记录`);
    });
  }
}

// ==================== Service Worker ====================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ==================== 首次启动数据填充 ====================
const SEED_KEY = 'costapp_seeded_v1';

async function seedDataIfNeeded() {
  // 已填充过则不再填充（即使清空数据后也不再自动恢复，避免覆盖用户"想要空"的意图）
  if (localStorage.getItem(SEED_KEY)) return;
  localStorage.setItem(SEED_KEY, '1');
  // 已有数据则不覆盖
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  try {
    const resp = await fetch('records-data.json', { cache: 'no-cache' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) saveRecords(data);
  } catch (e) { /* 静默失败，保持空状态 */ }
}

// ==================== 初始化 ====================
async function init() {
  loadState();
  bindEvents();
  await seedDataIfNeeded();
  initOpeningBalanceIfNeeded();
  renderAll();
  registerSW();
}
document.addEventListener('DOMContentLoaded', init);
