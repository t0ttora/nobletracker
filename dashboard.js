// dashboard.js - fetch aggregated data

const USERS = ["Emircan", "Mükremin", "Umut", "Guest"];
const dashUser = document.getElementById('dashUser');
const weeklyHoursEl = document.getElementById('weeklyHours');
const hoursProgressEl = document.getElementById('hoursProgress');
const topSitesEl = document.getElementById('topSites');
const documentsEl = document.getElementById('documents');
const teamOverviewEl = document.getElementById('teamOverview');
const trendBars = document.getElementById('trendBars');
const todoCol = document.getElementById('todoCol');
const progressCol = document.getElementById('progressCol');
const doneCol = document.getElementById('doneCol');
const sparkSvg = document.getElementById('hoursSpark');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const weekRange = document.getElementById('weekRange');
const globalSearchInput = document.getElementById('globalSearch');
// New task controls (dashboard inline creation)
const toggleNewTaskBtn = document.getElementById('toggleNewTask');
const newTaskBar = document.getElementById('newTaskBar');
const newTaskInput = document.getElementById('newTaskInput');
const addTaskBtnDash = document.getElementById('addTaskBtnDash');
const cancelTaskBtn = document.getElementById('cancelTaskBtn');

// Keyboard shortcut to focus global search using '/'
window.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== globalSearchInput && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    globalSearchInput?.focus();
  }
});

function initUsers() {
  USERS.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u; opt.textContent = u; dashUser.appendChild(opt);
  });
  const saved = localStorage.getItem('dashUser');
  if (saved && USERS.includes(saved)) dashUser.value = saved; else dashUser.value = USERS[0];
}

function fetchData() {
  const user = dashUser.value;
  localStorage.setItem('dashUser', user);
  chrome.runtime.sendMessage({ type: 'FETCH_DASHBOARD', user }, res => {
    if (!res?.ok) {
      renderEmptyGlobal();
      return;
    }
    renderData(res.data || {});
  });
}

function renderData(data) {
  hideGlobalEmpty();
  weeklyHoursEl.textContent = `${data.weeklyHours}h / ${data.weeklyGoal}h`;
  const pct = data.weeklyGoal ? Math.min(100, Math.round((data.weeklyHours / data.weeklyGoal) * 100)) : 0;
  hoursProgressEl.style.width = pct + '%';
  renderTopSites(data.topSites);
  renderDocuments(data.documents);
  renderTeam(data.teamStats);
  renderTasksBoard(data.tasks || []);
  if (Array.isArray(data.dailyHours) && data.dailyHours.length) renderSparkline(data.dailyHours); else clearSpark();
  if (Array.isArray(data.weeklyTrend) && data.weeklyTrend.length) renderTrend(data.weeklyTrend); else clearTrend();
  renderWeekRange();
}

function renderTopSites(list) {
  topSitesEl.innerHTML = '';
  if (!list || !list.length) {
    topSitesEl.innerHTML = '<li class="empty-inline">No site activity</li>';
    return;
  }
  list.forEach(site => {
    const li = document.createElement('li');
    if (Array.isArray(site)) li.textContent = `${site[0]} (${site[1]})`; else li.textContent = site;
    topSitesEl.appendChild(li);
  });
}

function renderDocuments(docs) {
  documentsEl.innerHTML = '';
  if (!docs || !docs.length) {
    documentsEl.innerHTML = '<li class="empty-inline">No documents</li>';
    return;
  }
  docs.forEach(doc => {
    const li = document.createElement('li');
    li.textContent = `${doc.name} (${doc.timestamp?.split('T')[0] || ''})`;
    documentsEl.appendChild(li);
  });
}

function renderTeam(stats) {
  if (!stats) { teamOverviewEl.innerHTML = '<div class="empty-inline">No team stats</div>'; return; }
  teamOverviewEl.textContent = `Total Hours: ${stats.totalHours || 0}\nCompleted Tasks: ${stats.completedTasks || 0} / ${stats.totalTasks || 0}`;
}

function clearSpark(){ if (sparkSvg) while (sparkSvg.firstChild) sparkSvg.removeChild(sparkSvg.firstChild); }
function clearTrend(){ if (trendBars) trendBars.innerHTML = '<div class="empty-inline" style="width:100%;text-align:center;">No trend</div>'; }

function renderEmptyGlobal(){
  const eg = document.getElementById('globalEmpty');
  if (!eg) return;
  eg.style.display='block';
  eg.innerHTML = `
  <div class="empty-state">
    <div class="empty-visual">
      <div class="orbit"></div>
      <div class="floating-icons">
        <span>⏱</span>
        <span>🌐</span>
        <span>📄</span>
        <span>📊</span>
        <span>✅</span>
        <span>🗂</span>
      </div>
      <div class="nucleus">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5h16M4 12h16M4 19h16" stroke="currentColor" />
        </svg>
      </div>
    </div>
    <h2>No data yet</h2>
    <p>Start a session and interact with sites, tasks or documents.<br/>Your productivity analytics will appear here.</p>
    <div class="empty-actions">
      <button id="emptyStart" class="primary">Start Session</button>
      <button id="emptyTask">+ New Task</button>
    </div>
  </div>`;
  wireEmptyActions();
}
function hideGlobalEmpty(){ const eg = document.getElementById('globalEmpty'); if (eg) eg.style.display='none'; }

function wireEmptyActions(){
  const startBtn = document.getElementById('emptyStart');
  const newTaskBtn = document.getElementById('emptyTask');
  if (startBtn) startBtn.onclick = () => {
    chrome.runtime.sendMessage({ type:'START_SESSION', user: dashUser.value || 'Guest' }, () => fetchData());
  };
  if (newTaskBtn) newTaskBtn.onclick = () => {
    const title = prompt('Task title?');
    if(!title) return;
    chrome.runtime.sendMessage({ type:'ADD_TASK', task:title, user: dashUser.value || 'Guest' }, () => fetchData());
  };
}

function renderTasksBoard(tasks) {
  todoCol.innerHTML = '';
  progressCol.innerHTML = '';
  doneCol.innerHTML = '';
  tasks.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t.task;
    li.draggable = true;
    li.dataset.id = t.id;
    li.dataset.status = t.status;
    attachDrag(li);
    if (t.status === 'TODO') todoCol.appendChild(li);
    else if (t.status === 'IN PROGRESS') progressCol.appendChild(li);
    else doneCol.appendChild(li);
  });
}

dashUser.addEventListener('change', fetchData);
refreshBtn.addEventListener('click', fetchData);
exportBtn.addEventListener('click', exportCsv);

initUsers();
fetchData();
renderWeekRange();
wireNewTaskCreation();

function renderWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  weekRange.textContent = `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

// ---- Drag & Drop ----
function attachDrag(el) {
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', el.dataset.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
}

[todoCol, progressCol, doneCol].forEach(col => {
  col.parentElement.addEventListener('dragover', e => {
    e.preventDefault();
    col.parentElement.classList.add('drag-over');
  });
  col.parentElement.addEventListener('dragleave', () => {
    col.parentElement.classList.remove('drag-over');
  });
  col.parentElement.addEventListener('drop', e => {
    e.preventDefault();
    col.parentElement.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const li = document.querySelector(`li[data-id="${id}"]`);
    if (!li) return;
    const newStatus = col.parentElement.dataset.status;
    if (li.dataset.status === newStatus) return;
    // optimistic move
    col.appendChild(li);
    li.dataset.status = newStatus;
    updateTaskStatus(id, newStatus);
  });
});

function updateTaskStatus(id, status) {
  // Keep previous for potential undo (simple 5s window)
  const li = document.querySelector(`li[data-id="${id}"]`);
  const prev = li?.dataset.status;
  chrome.runtime.sendMessage({ type: 'UPDATE_TASK_STATUS', taskId: id, status }, () => {
    if (prev && prev !== status) showUndo(id, prev);
  });
}

// ---- Sparkline ----
function renderSparkline(dailyHours) {
  if (!sparkSvg) return;
  const w = sparkSvg.viewBox.baseVal.width || 120;
  const h = sparkSvg.viewBox.baseVal.height || 30;
  while (sparkSvg.firstChild) sparkSvg.removeChild(sparkSvg.firstChild);
  const max = Math.max(...dailyHours, 1);
  const step = w / Math.max(dailyHours.length - 1, 1);
  const points = dailyHours.map((v,i)=>[i*step, h - (v/max)* (h-4) -2]);
  const d = points.map((p,i)=> (i===0?`M${p[0]},${p[1]}`:`L${p[0]},${p[1]}`)).join(' ');
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d', d + ` L${points[points.length-1][0]},${h} L0,${h} Z`);
  sparkSvg.appendChild(path);
}

function renderTrend(trend) {
  if (!trendBars) return;
  trendBars.innerHTML = '';
  const max = Math.max(...trend.map(t=>t.hours), 1);
  trend.forEach(t => {
    const div = document.createElement('div');
    div.className = 'bar';
    const hPct = (t.hours / max) * 100;
    div.style.height = Math.max(4, hPct) + '%';
    const label = document.createElement('span');
    label.textContent = t.hours;
    const wk = new Date(t.weekStart);
    div.title = `Week of ${wk.toLocaleDateString()}\n${t.hours}h`;
    div.appendChild(label);
    trendBars.appendChild(div);
  });
}

let undoTimeout;
function showUndo(taskId, previousStatus) {
  const bar = document.createElement('div');
  bar.style.position = 'fixed';
  bar.style.bottom = '12px';
  bar.style.right = '12px';
  bar.style.background = '#111';
  bar.style.color = '#fff';
  bar.style.padding = '6px 10px';
  bar.style.fontSize = '0.7rem';
  bar.style.borderRadius = '4px';
  bar.style.zIndex = '999999';
  bar.textContent = 'Task updated ';
  const btn = document.createElement('button');
  btn.textContent = 'Undo';
  btn.style.marginLeft = '6px';
  btn.style.cursor = 'pointer';
  btn.onclick = () => {
    chrome.runtime.sendMessage({ type:'UNDO_TASK_STATUS', taskId, previousStatus }, () => fetchData());
    clearTimeout(undoTimeout);
    bar.remove();
  };
  bar.appendChild(btn);
  document.body.appendChild(bar);
  undoTimeout = setTimeout(()=> bar.remove(), 5000);
}

function exportCsv() {
  const user = dashUser.value;
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, state => {
    const endpoint = state?.config?.sheetsEndpoint;
    if (!endpoint) return alert('Endpoint not configured');
    const url = `${endpoint}?user=${encodeURIComponent(user)}&mode=sessions`;
    fetch(url).then(r => r.json()).then(rows => {
      if (!Array.isArray(rows)) return alert('No data');
      const header = ['Start','End','User','DurationMinutes'];
      const csv = [header.join(',')].concat(rows.map(r => [r.startISO, r.endISO, r.user, r.duration].join(','))).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sessions_${user}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }).catch(()=> alert('Export failed'));
  });
}

// Inline new task creation wiring
function wireNewTaskCreation() {
  if (!toggleNewTaskBtn) return;
  toggleNewTaskBtn.addEventListener('click', () => {
    const show = newTaskBar.style.display !== 'flex';
    newTaskBar.style.display = show ? 'flex' : 'none';
    if (show) { newTaskInput.value=''; setTimeout(()=> newTaskInput.focus(), 30); }
  });
  if (cancelTaskBtn) cancelTaskBtn.addEventListener('click', () => { newTaskBar.style.display='none'; });
  const submit = () => {
    const title = (newTaskInput.value || '').trim();
    if (!title) return;
    chrome.runtime.sendMessage({ type:'ADD_TASK', task:title, user: dashUser.value || 'Guest' }, res => {
      if (res?.ok) { fetchData(); newTaskInput.value=''; newTaskBar.style.display='none'; }
    });
  };
  if (addTaskBtnDash) addTaskBtnDash.addEventListener('click', submit);
  if (newTaskInput) newTaskInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') newTaskBar.style.display='none';
  });
}
