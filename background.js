// background.js - session logic, timers, Sheets integration
// Using ES module syntax (declared in manifest)

const USERS = ["Emircan", "Mükremin", "Umut", "Guest"]; // NOTE: For stricter identity control, future: fetch from backend controlled list.

// State stored in memory; persisted in chrome.storage for popup/dashboard sync
// activeSession extended: { id, user, start, lastTick, projectTag, domains:Set, docs:[], activityEvents }
let activeSession = null; // { user, start, lastTick }
let activityBuffer = []; // queued page/activity events to batch send
let taskCache = []; // cached tasks from Sheets
let sheetsEndpoint = null; // built from deploymentId in sync storage
let consentLogging = false; // user consent flag from options
let sharedSecret = null; // optional HMAC shared secret for signing
let domainOnlyLogging = false; // if true, strip path/query
let anonymizeUrls = false; // if true, hash the URL (after domain stripping if enabled)
let omitTitles = false; // if true, do not send page titles
let enableTelemetry = false; // if true, send anonymous error telemetry
let idleMinutes = 30; // configurable auto-stop idle threshold
const DATA_VERSION = 1; // bump when storage schema changes
let perfEnabled = true; // local flag for perf telemetry (can future toggle)
const ACTIVITY_FLUSH_INTERVAL_MS = 60_000; // flush every minute
const HEARTBEAT_INTERVAL_MS = 1_000; // session timer tick
const IDLE_TIMEOUT_MIN = 30; // auto-stop after 30 minutes idle (configurable future)
// Endpoint is loaded dynamically; placeholder kept for reference only.

async function init() {
  await loadConfig();
  await checkDataVersion();
  await Promise.all([restoreState(), restoreActivityBuffer()]);
  startHeartbeat();
  scheduleActivityFlush();
  attachListeners();
  // Attempt initial fetch for persistent tasks so popup has them even after reload
  try { await hydrateTasks(); } catch (e) { /* ignore at startup */ }
}

async function checkDataVersion() {
  const stored = await chrome.storage.local.get(['dataVersion']);
  if (stored.dataVersion !== DATA_VERSION) {
    // Migration: clear volatile buffers; keep activeSession
    await chrome.storage.local.remove(['activityBuffer']);
    await chrome.storage.local.set({ dataVersion: DATA_VERSION });
  }
}

async function loadConfig() {
  const cfg = await chrome.storage.sync.get(["deploymentId", "consentLogging", "sharedSecret", "domainOnlyLogging", "anonymizeUrls", "omitTitles", "enableTelemetry", "idleMinutes"]);
  if (cfg.deploymentId) {
    sheetsEndpoint = `https://script.google.com/macros/s/${cfg.deploymentId}/exec`;
  } else {
    sheetsEndpoint = null;
  }
  consentLogging = !!cfg.consentLogging;
  sharedSecret = (cfg.sharedSecret || '').trim() || null;
  domainOnlyLogging = !!cfg.domainOnlyLogging;
  anonymizeUrls = !!cfg.anonymizeUrls;
  omitTitles = !!cfg.omitTitles;
  enableTelemetry = !!cfg.enableTelemetry;
  if (cfg.idleMinutes) idleMinutes = Math.min(240, Math.max(1, parseInt(cfg.idleMinutes,10) || 30));
}

function attachListeners() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'START_SESSION':
        startSession(msg.user, msg.projectTag || null).then(()=> sendResponse({ ok: true, activeSession })).catch(e => sendResponse({ ok:false, error:e.message }));
        return true;
        break;
      case 'STOP_SESSION':
        stopSession(msg.notes || null).then(()=> sendResponse({ ok: true })).catch(e => sendResponse({ ok:false, error:e.message }));
        return true;
        break;
    case 'GET_STATE':
  sendResponse({ activeSession, tasks: taskCache, config: { sheetsEndpoint, consentLogging, hasSecret: !!sharedSecret, domainOnlyLogging, anonymizeUrls, omitTitles, enableTelemetry } });
        break;
      case 'ADD_TASK':
        addTask(msg.task, msg.user).then(t => sendResponse({ ok: true, task: t }));
        return true;
      case 'UPDATE_TASK_STATUS':
        updateTaskStatus(msg.taskId, msg.status).then(t => sendResponse({ ok: true, task: t }));
        return true;
      case 'FETCH_DASHBOARD':
        fetchDashboard(msg.user).then(data => sendResponse({ ok: true, data })).catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
      case 'LOG_DOCUMENT':
        logDocument(msg.meta).then(r => sendResponse({ ok: true, record: r })).catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
      case 'CONFIG_UPDATED':
        loadConfig().then(()=> sendResponse({ ok: true, sheetsEndpoint, consentLogging }));
        return true;
      case 'MANUAL_FLUSH':
        manualFlush().then(count => sendResponse({ ok: count>0, count })).catch(()=> sendResponse({ ok:false }));
        return true;
      case 'UNDO_TASK_STATUS':
        updateTaskStatus(msg.taskId, msg.previousStatus).then(t => sendResponse({ ok: true, task: t })).catch(e => sendResponse({ ok:false, error:e.message }));
        return true;
      default:
        break;
    }
  });

  chrome.webNavigation.onCompleted.addListener(async details => {
    if (!activeSession || !consentLogging) return;
    try {
      const tab = await chrome.tabs.get(details.tabId);
      if (!tab.url) return;
      // Basic privacy filter: ignore chrome://, extensions, and very short URLs
      if (/^(chrome|edge|about|file):/i.test(tab.url)) return;
      queueActivity({
        type: 'activity',
        user: activeSession.user,
        url: tab.url,
        title: tab.title,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      // ignore
    }
  }, { url: [{ schemes: ['https', 'http'] }] });
}

async function restoreState() {
  const stored = await chrome.storage.local.get(['activeSession']);
  if (stored.activeSession && stored.activeSession.start) {
    activeSession = stored.activeSession;
  }
}

function persistState() {
  chrome.storage.local.set({ activeSession });
}

async function startSession(user, projectTag) {
  if (activeSession) return; // already running
  const localStart = new Date().toISOString();
  // optimistic local state; server will assign authoritative start timestamp
  activeSession = { id: null, user, start: localStart, lastTick: Date.now(), projectTag: projectTag || '', domains: new Set(), docs: [], activityEvents: 0 };
  persistState();
  try {
    const res = await resilientSend({ type: 'sessionStart', user });
    if (res && res.id && res.start) {
      activeSession.id = res.id;
      activeSession.start = res.start; // replace with server authoritative time
      persistState();
    }
  } catch (e) {
    // fallback: will send legacy single record on stop if start failed
    console.warn('sessionStart failed, will fallback to legacy session write', e.message);
  }
}

async function stopSession(notes) {
  if (!activeSession) return;
  const sessionRef = activeSession; // capture
  // aggregate metadata
  const durationMinutes = Math.max(1, Math.round((Date.now() - new Date(sessionRef.start).getTime()) / 60000));
  const uniqueDomains = Array.from(sessionRef.domains || []);
  const urlsSample = uniqueDomains.slice(0,5).join(' ');
  const keyContributions = (sessionRef.docs || []).slice(0,3).join(' | ');
  const eventsPerMin = sessionRef.activityEvents / Math.max(1, durationMinutes);
  const activityLevel = eventsPerMin > 1.2 ? 'High' : eventsPerMin > 0.5 ? 'Medium' : 'Low';
  const payloadEnd = {
    type: sessionRef.id ? 'sessionEnd' : 'session',
    id: sessionRef.id,
    user: sessionRef.user,
    start: sessionRef.start,
    projectTag: sessionRef.projectTag || '',
    urlsSample,
    keyContributions,
    activityLevel,
    notes: notes || ''
  };
  try {
    if (payloadEnd.type === 'session') {
      // legacy single payload write requires end + duration
      payloadEnd.end = new Date().toISOString();
      payloadEnd.duration = durationMinutes;
    }
    await resilientSend(payloadEnd);
  } catch (e) {
    console.error('sessionEnd error', e);
  }
  activeSession = null;
  persistState();
}

function startHeartbeat() {
  setInterval(() => {
    if (!activeSession) return;
    activeSession.lastTick = Date.now();
  chrome.runtime.sendMessage({ type: 'TICK', now: Date.now(), activeSession });
  updateBadge();
  }, HEARTBEAT_INTERVAL_MS);
  // Active tab sampling every 60s for passive operational visibility
  setInterval(sampleActiveTab, 60_000);
  // Idle detection
  try {
    chrome.idle.setDetectionInterval(idleMinutes * 60);
    chrome.idle.onStateChanged.addListener(state => {
      if (state === 'idle' || state === 'locked') {
        if (activeSession) {
          notify('Session auto-stopped due to inactivity');
          stopSession();
        }
      }
    });
  } catch (e) { /* environment may not support */ }
}

function queueActivity(evt) {
  const transformed = transformActivity(evt);
  activityBuffer.push(transformed);
  if (activeSession) {
    activeSession.activityEvents = (activeSession.activityEvents || 0) + 1;
    try {
      const u = new URL(evt.url);
      activeSession.domains?.add(u.hostname.replace(/^www\./,''));
    } catch {/* ignore */}
  }
  // simple cap to avoid unbounded growth offline
  if (activityBuffer.length > 500) activityBuffer.splice(0, activityBuffer.length - 500);
  persistActivityBuffer();
  updateBadge();
}

function transformActivity(evt) {
  let { url, title } = evt;
  if (domainOnlyLogging) {
    try { url = new URL(url).origin; } catch { /* ignore parse error */ }
  }
  if (anonymizeUrls) {
    // Hash URL (async not desired here) -> use simple SHA-256 sync via Subtle (must adapt to async) so queueActivity becomes async? Instead mark placeholder and compute later in flush.
    // We'll defer hashing to flush step if anonymize enabled by marking field.
    return { ...evt, url, title: omitTitles ? undefined : title, _needsHash: true };
  }
  return { ...evt, url, title: omitTitles ? undefined : title };
}

function scheduleActivityFlush() {
  setInterval(async () => {
    if (activityBuffer.length === 0) return;
    const batch = [...activityBuffer];
    activityBuffer = [];
    try {
      const records = await Promise.all(batch.map(async r => {
        if (r._needsHash) {
          const hashed = await hashUrl(r.url);
            return { ...r, url: hashed, _needsHash: undefined };
        }
        return r;
      }));
      await resilientSend({ type: 'batch', records });
    } catch (e) {
      // re-queue on failure
      activityBuffer.unshift(...batch);
    }
    persistActivityBuffer();
  updateBadge();
  }, ACTIVITY_FLUSH_INTERVAL_MS);
}

async function addTask(taskTitle, user) {
  const payload = {
    type: 'task',
    user,
    task: taskTitle,
    status: 'TODO',
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  const saved = await resilientSend(payload);
  taskCache.push(saved);
  return saved;
}

async function updateTaskStatus(taskId, status) {
  const payload = { type: 'taskStatus', id: taskId, status, completedAt: status === 'DONE' ? new Date().toISOString() : null };
  const updated = await resilientSend(payload);
  taskCache = taskCache.map(t => t.id === updated.id ? updated : t);
  return updated;
}

async function logDocument(meta) {
  const payload = { type: 'document', ...meta, timestamp: new Date().toISOString() };
  const res = await resilientSend(payload);
  if (activeSession) {
    activeSession.docs = activeSession.docs || [];
    if (!activeSession.docs.includes(meta.name)) activeSession.docs.push(meta.name);
  }
  return res;
}

async function fetchDashboard(user) {
  if (!sheetsEndpoint) throw new Error('Endpoint not configured');
  const res = await fetch(`${sheetsEndpoint}?user=${encodeURIComponent(user)}&mode=dashboard`);
  if (!res.ok) throw new Error('Failed dashboard fetch');
  return res.json();
}

async function sendToSheets(body) {
  if (!sheetsEndpoint) {
    // Attempt to refresh config once
    await loadConfig();
    if (!sheetsEndpoint) throw new Error('Sheets endpoint missing');
  }
  const signed = await signPayload(body);
  const start = performance.now();
  const res = await fetch(sheetsEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed)
  });
  if (!res.ok) throw new Error('Sheets write failed');
  const json = await res.json();
  const dur = performance.now() - start;
  if (enableTelemetry && body.type !== 'telemetry' && perfEnabled) {
    fireAndForgetTelemetry({ type: 'perf', op: body.type, ms: Math.round(dur) });
  }
  return json;
}

async function manualFlush() {
  if (activityBuffer.length === 0) return 0;
  const batch = [...activityBuffer];
  activityBuffer = [];
  try {
    const records = await Promise.all(batch.map(async r => {
      if (r._needsHash) {
        const hashed = await hashUrl(r.url);
        return { ...r, url: hashed, _needsHash: undefined };
      }
      return r;
    }));
    await resilientSend({ type: 'batch', records });
    persistActivityBuffer();
    updateBadge();
    return records.length;
  } catch (e) {
    activityBuffer.unshift(...batch);
    persistActivityBuffer();
    updateBadge();
    return 0;
  }
}

// Exponential backoff wrapper
async function resilientSend(body, attempts = 0) {
  const MAX_ATTEMPTS = 5;
  try {
    return await sendToSheets(body);
  } catch (e) {
    if (attempts >= MAX_ATTEMPTS) throw e;
    const delay = Math.min(30_000, 500 * 2 ** attempts + Math.random() * 250);
    await new Promise(r => setTimeout(r, delay));
    return resilientSend(body, attempts + 1);
  }
}

async function hydrateTasks() {
  if (!sheetsEndpoint) await loadConfig();
  if (!sheetsEndpoint) return;
  try {
    const res = await fetch(`${sheetsEndpoint}?mode=tasks`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) {
      taskCache = data;
    }
  } catch (e) {
    // ignore
  }
}

async function signPayload(payload) {
  if (!sharedSecret) return { ...payload }; // no signing configured
  const ts = Date.now().toString();
  const base = { ...payload, _ts: ts };
  // stringify without _sig first
  const jsonStr = JSON.stringify(base);
  try {
    const sig = await computeHmac(jsonStr, sharedSecret);
    return { ...base, _sig: sig };
  } catch (e) {
    // On any crypto failure, fallback to unsigned to avoid total breakage
    return base;
  }
}

async function computeHmac(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const bytes = new Uint8Array(sigBuf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary); // Base64
}

function persistActivityBuffer() {
  chrome.storage.local.set({ activityBuffer });
}

async function restoreActivityBuffer() {
  const stored = await chrome.storage.local.get(['activityBuffer']);
  if (Array.isArray(stored.activityBuffer)) {
    activityBuffer = stored.activityBuffer;
  }
}

async function hashUrl(value) {
  try {
    const enc = new TextEncoder();
    const data = enc.encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'hash_error';
  }
}

function updateBadge() {
  const count = activityBuffer.length;
  if (!activeSession) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (count === 0) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
  }
}

// ---- Active Tab Sampler ----
async function sampleActiveTab() {
  if (!activeSession || !consentLogging) return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0] || !tabs[0].url) return;
    const url = tabs[0].url;
    if (/^(chrome|edge|about|file):/i.test(url)) return;
    queueActivity({ type: 'activity', user: activeSession.user, url, title: omitTitles ? undefined : tabs[0].title, timestamp: new Date().toISOString(), sampled: true });
  } catch (e) {/* ignore */}
}

// Global error capture for telemetry
self.addEventListener('error', evt => {
  if (!enableTelemetry) return;
  logTelemetry({ type: 'error', message: evt.message, stack: evt.error?.stack });
});

self.addEventListener('unhandledrejection', evt => {
  if (!enableTelemetry) return;
  logTelemetry({ type: 'unhandledrejection', message: evt.reason?.message || String(evt.reason) });
});

async function logTelemetry(payload) {
  try {
    await resilientSend({ type: 'telemetry', level: payload.type, message: payload.message, stack: payload.stack || null, ts: new Date().toISOString() });
  } catch (e) {
    // swallow
  }
}

function fireAndForgetTelemetry(obj) {
  // Avoid recursion / retries; sign manually if secret present
  if (!sheetsEndpoint) return;
  let payload = { type: 'telemetry', level: obj.type || 'perf', ...obj, ts: new Date().toISOString() };
  (async () => {
    try {
      if (sharedSecret) payload = await signPayload(payload);
      fetch(sheetsEndpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    } catch { /* ignore */ }
  })();
}

function notify(message) {
  if (!chrome?.notifications) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'assets/icon48.png',
    title: 'NobleTracker',
    message
  });
}


init();
