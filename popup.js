// popup.js - handles UI interactions with background

const userSelect = document.getElementById('userSelect');
const startBtn = document.getElementById('startBtn'); // text changed to plain label
const stopBtn = document.getElementById('stopBtn'); // text changed to plain label
const timerDisplay = document.getElementById('timerDisplay');
const tasksList = document.getElementById('tasksList');
const addTaskBtn = document.getElementById('addTaskBtn');
const completeTaskBtn = document.getElementById('completeTaskBtn');
const uploadBtn = document.getElementById('uploadBtn');
const flushBtn = document.getElementById('flushBtn');
const taskSearch = document.getElementById('taskSearch');
const statusEl = document.getElementById('status');
const allTasksList = document.getElementById('allTasksList');
const toggleTasksBtn = document.getElementById('toggleTasksBtn');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const focusModeBtn = document.getElementById('focusModeBtn');
const projectTagInput = document.getElementById('projectTagInput');
const sessionNotes = document.getElementById('sessionNotes');
let suggestedDocs = [];
let config = {};

const USERS = ["Emircan", "Mükremin", "Umut", "Guest"];
let activeSession = null;
let tasks = [];
let showAll = false;
let page = 1;
const PAGE_SIZE = 20;

function renderUsers() {
  USERS.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u; opt.textContent = u; userSelect.appendChild(opt);
  });
  const saved = localStorage.getItem('selectedUser');
  if (saved && USERS.includes(saved)) userSelect.value = saved;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function updateTimer() {
  if (!activeSession) return;
  const elapsed = Date.now() - new Date(activeSession.start).getTime();
  timerDisplay.textContent = formatDuration(elapsed);
}

function renderTasks() {
  tasksList.innerHTML = '';
  const filter = (taskSearch.value || '').toLowerCase();
  let display = tasks;
  if (filter) display = tasks.filter(t => t.task.toLowerCase().includes(filter));
  const recent = display.slice(-3).reverse();
  if (recent.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-inline';
    li.textContent = 'No tasks yet';
    tasksList.appendChild(li);
    return;
  }
  recent.forEach(t => {
    const li = document.createElement('li');
    li.textContent = `${t.task} [${t.status}]`;
    li.dataset.id = t.id || '';
    if (t.status !== 'DONE') {
  const btn = document.createElement('button');
  btn.textContent = 'Done';
      btn.addEventListener('click', () => quickComplete(t));
      li.appendChild(btn);
    }
    tasksList.appendChild(li);
  });
}

function renderAllTasks() {
  if (!showAll) return;
  allTasksList.innerHTML = '';
  const filter = (taskSearch.value || '').toLowerCase();
  let display = tasks;
  if (filter) display = tasks.filter(t => t.task.toLowerCase().includes(filter));
  const totalPages = Math.max(1, Math.ceil(display.length / PAGE_SIZE));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * PAGE_SIZE;
  const slice = display.slice(start, start + PAGE_SIZE);
  if (slice.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-inline';
    li.textContent = 'No tasks';
    allTasksList.appendChild(li);
  }
  slice.forEach(t => {
    const li = document.createElement('li');
    li.textContent = `${t.task} [${t.status}]`;
    if (t.status !== 'DONE') {
  const btn = document.createElement('button');
  btn.textContent = 'Done';
      btn.addEventListener('click', () => quickComplete(t));
      li.appendChild(btn);
    }
    allTasksList.appendChild(li);
  });
  pageInfo.textContent = `Page ${page}/${totalPages}`;
  prevPageBtn.disabled = page <= 1;
  nextPageBtn.disabled = page >= totalPages;
}

function quickComplete(task) {
  const prev = task.status;
  chrome.runtime.sendMessage({ type: 'UPDATE_TASK_STATUS', taskId: task.id, status: 'DONE' }, res => {
    if (res?.ok) {
      tasks = tasks.map(t => t.id === res.task.id ? res.task : t);
      renderTasks();
      renderAllTasks();
      showUndo(task.id, prev);
    }
  });
}

function syncState() {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, res => {
    if (!res) return;
    activeSession = res.activeSession;
    tasks = res.tasks || [];
  suggestedDocs = res.suggestedDocs || [];
    config = res.config || {};
    if (activeSession) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
      updateTimer();
  document.querySelector('.notes-field').style.display='block';
  if (projectTagInput) projectTagInput.disabled = true;
    } else {
      startBtn.disabled = false;
      stopBtn.disabled = true;
      timerDisplay.textContent = '00:00:00';
  document.querySelector('.notes-field').style.display='none';
  if (projectTagInput) projectTagInput.disabled = false;
    }
    renderTasks();
  renderAllTasks();
  renderSuggestedDocs();
    showConfigHint();
  });
}

function showConfigHint() {
  if (!config.sheetsEndpoint) {
    flashStatus('Configure endpoint in Options');
  }
}

startBtn.addEventListener('click', () => {
  const user = userSelect.value || USERS[0];
  localStorage.setItem('selectedUser', user);
  const projectTag = (projectTagInput?.value || '').trim();
  chrome.runtime.sendMessage({ type: 'START_SESSION', user, projectTag }, () => syncState());
});

stopBtn.addEventListener('click', () => {
  const notes = (sessionNotes?.value || '').trim();
  chrome.runtime.sendMessage({ type: 'STOP_SESSION', notes }, () => { sessionNotes.value=''; syncState(); });
});

addTaskBtn.addEventListener('click', () => {
  const title = prompt('Task title?');
  if (!title) return;
  const user = userSelect.value || USERS[0];
  chrome.runtime.sendMessage({ type: 'ADD_TASK', task: title, user }, res => {
    if (res?.ok) {
      tasks.push(res.task);
      renderTasks();
    }
  });
});

completeTaskBtn.addEventListener('click', () => {
  const pending = tasks.filter(t => t.status !== 'DONE');
  if (pending.length === 0) return alert('No open tasks');
  const last = pending[pending.length - 1];
  quickComplete(last);
});

uploadBtn.addEventListener('click', () => {
  const name = prompt('Document name?');
  if (!name) return;
  const user = userSelect.value || USERS[0];
  chrome.runtime.sendMessage({ type: 'LOG_DOCUMENT', meta: { user, name } }, res => {
    if (res?.ok) {
      flashStatus('Logged document');
    }
  });
});

flushBtn?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'MANUAL_FLUSH' }, res => {
    if (res?.ok) flashStatus('Flushed'); else flashStatus('No data');
  });
});

taskSearch?.addEventListener('input', () => renderTasks());
taskSearch?.addEventListener('input', () => renderAllTasks());

toggleTasksBtn?.addEventListener('click', () => {
  showAll = !showAll;
  document.querySelector('.full-tasks').style.display = showAll ? 'block':'none';
  toggleTasksBtn.textContent = showAll ? 'Hide All' : 'Show All';
  if (showAll) { page = 1; renderAllTasks(); }
});

prevPageBtn?.addEventListener('click', () => { if (page>1){ page--; renderAllTasks(); }});
nextPageBtn?.addEventListener('click', () => { page++; renderAllTasks(); });

focusModeBtn?.addEventListener('click', () => {
  const fm = document.body.classList.toggle('focus-mode');
  focusModeBtn.textContent = fm ? 'Exit Focus' : 'Focus Mode';
});

let undoTimer;
function showUndo(taskId, previousStatus) {
  clearTimeout(undoTimer);
  statusEl.innerHTML = `Updated. <a href="#" id="undoLink">Undo</a>`;
  const link = document.getElementById('undoLink');
  link.addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'UNDO_TASK_STATUS', taskId, previousStatus }, res => {
      if (res?.ok) {
        tasks = tasks.map(t => t.id === res.task.id ? res.task : t);
        renderTasks();
        renderAllTasks();
      }
    });
    statusEl.textContent = '';
  });
  undoTimer = setTimeout(()=> statusEl.textContent = '', 5000);
}

function flashStatus(msg) {
  statusEl.textContent = msg;
  setTimeout(() => statusEl.textContent = '', 2000);
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'TICK') {
    activeSession = msg.activeSession;
    updateTimer();
  }
});

renderUsers();
syncState();
setInterval(updateTimer, 1000);
// initial render for pagination containers
renderAllTasks();

function renderSuggestedDocs() {
  let container = document.getElementById('suggestedDocs');
  if (!container) {
    container = document.createElement('div');
    container.id = 'suggestedDocs';
    container.style.marginTop = '4px';
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '4px';
    const tasksPanel = document.querySelector('.tasks-panel');
    tasksPanel?.parentNode?.insertBefore(container, tasksPanel.nextSibling);
  }
  container.innerHTML = '';
  if (!suggestedDocs.length) return;
  suggestedDocs.slice(-5).forEach(name => {
    const btn = document.createElement('button');
    btn.textContent = name.length>18? name.slice(0,17)+'…': name;
    btn.className = 'ghost small';
    btn.title = 'Log document: '+name;
    btn.addEventListener('click', () => {
      const user = userSelect.value || USERS[0];
      chrome.runtime.sendMessage({ type:'LOG_DOCUMENT', meta:{ user, name } }, () => flashStatus('Logged: '+name));
    });
    container.appendChild(btn);
  });
}
