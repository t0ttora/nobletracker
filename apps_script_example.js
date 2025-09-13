// Google Apps Script example (Code.gs) for Sheets integration
// Create a Google Sheet with tabs: Sessions, Activities, Tasks, Documents, Meta
// Deploy as a Web App (execute as: you; accessible by: anyone in domain or anyone with link depending on restriction)

function doPost(e) {
  try {
  const raw = JSON.parse(e.postData.contents);
  const data = verifyAndStripSignature(raw); // throws on invalid signature
    const sheetBundle = getSheets();
    let result;
    if (data.type === 'session') {
      result = writeLegacySession(sheetBundle.sessions, data);
    } else if (data.type === 'sessionStart') {
      result = startSessionRow(sheetBundle.sessions, data);
    } else if (data.type === 'sessionEnd') {
      result = endSessionRow(sheetBundle.sessions, data);
    } else if (data.type === 'activity') {
      result = writeActivity(sheetBundle.activities, data);
    } else if (data.type === 'task') {
      result = writeTask(sheetBundle.tasks, data);
    } else if (data.type === 'taskStatus') {
      result = updateTaskStatus(sheetBundle.tasks, data);
    } else if (data.type === 'document') {
      result = writeDocument(sheetBundle.documents, data);
    } else if (data.type === 'batch') {
      result = data.records.map(r => routeRecord(sheetBundle, r));
    } else {
      throw new Error('Unknown type');
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ error: true, message: err.message }, 500);
  }
}

function doGet(e) {
  try {
    const user = e.parameter.user;
    const mode = e.parameter.mode;
    if (mode === 'dashboard') {
      const data = buildDashboard(user);
      return jsonOut(data);
    } else if (mode === 'tasks') {
      return jsonOut(listTasks(user));
    } else if (mode === 'sessions') {
      return jsonOut(listSessions(user));
    }
    throw new Error('Unknown mode');
  } catch (err) {
    return jsonOut({ error: true, message: err.message }, 500);
  }
}

// Ensures each sheet exists with proper headers; idempotent.
function getSheets() {
  const ss = SpreadsheetApp.getActive();
  const sessions = ensureSheet(ss, 'Sessions', ['ID','User','Start','End','DurationMinutes','ProjectTag','ActivityLevel','URLsSample','KeyContributions','Notes']);
  const activities = ensureSheet(ss, 'Activities', ['Timestamp', 'User', 'URL', 'Title']);
  const tasks = ensureSheet(ss, 'Tasks', ['ID', 'User', 'Task', 'Status', 'CreatedAt', 'CompletedAt']);
  const documents = ensureSheet(ss, 'Documents', ['User', 'Name', 'Timestamp']);
  return { sessions, activities, tasks, documents };
}

function ensureSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    return sh;
  }
  // If first row is empty or headers mismatch, set headers.
  const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = headers.some((h, i) => firstRow[i] !== h);
  if (needsHeaders) {
    // If existing data starts at row1, shift it down.
    if (firstRow.some(v => v !== '')) {
      sh.insertRowBefore(1);
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function routeRecord(bundle, r) {
  if (r.type === 'session') return writeSession(bundle.sessions, r);
  if (r.type === 'activity') return writeActivity(bundle.activities, r);
  if (r.type === 'task') return writeTask(bundle.tasks, r);
  if (r.type === 'taskStatus') return updateTaskStatus(bundle.tasks, r);
  if (r.type === 'document') return writeDocument(bundle.documents, r);
  throw new Error('Unknown batch record type');
}

// Legacy (single payload)
function writeLegacySession(sh, d) {
  const id = 'S' + Date.now() + Math.floor(Math.random()*1000);
  sh.appendRow([id, d.user, new Date(d.start), new Date(d.end), d.duration, d.projectTag||'', d.activityLevel||'', d.urlsSample||'', d.keyContributions||'', d.notes||'']);
  return { id, ok: true };
}

// New split model
function startSessionRow(sh, d) {
  const id = 'S' + Date.now() + Math.floor(Math.random()*1000);
  const start = new Date(); // authoritative server time
  sh.appendRow([id, d.user, start, '', '', d.projectTag||'', '', '', '', '']);
  return { id, start: start.toISOString() };
}

function endSessionRow(sh, d) {
  const data = sh.getDataRange().getValues();
  const now = new Date();
  for (let i=1;i<data.length;i++) {
    if (data[i][0] === d.id) {
      const row = i+1;
      const start = data[i][2];
      const durationMin = Math.max(1, Math.round((now - start)/60000));
      sh.getRange(row, 4).setValue(now); // End
      sh.getRange(row, 5).setValue(durationMin); // Duration
      sh.getRange(row, 7).setValue(d.activityLevel||'');
      sh.getRange(row, 8).setValue(d.urlsSample||'');
      sh.getRange(row, 9).setValue(d.keyContributions||'');
      sh.getRange(row, 10).setValue(d.notes||'');
      sh.getRange(row, 6).setValue(d.projectTag||'');
      return { ok:true };
    }
  }
  throw new Error('Session not found');
}

function writeActivity(sh, d) {
  sh.appendRow([new Date(d.timestamp), d.user, d.url, d.title]);
  return { ok: true };
}

function writeTask(sh, d) {
  const id = 'T' + Date.now() + Math.floor(Math.random()*1000);
  sh.appendRow([id, d.user, d.task, d.status, new Date(d.createdAt), '']);
  return { id: id, ...d };
}

function updateTaskStatus(sh, d) {
  const data = sh.getDataRange().getValues();
  for (let i=1; i<data.length; i++) {
    if (data[i][0] === d.id) {
      const row = i+1;
      const statusCol = 4; // D
      const completedCol = 6; // F
      sh.getRange(row, statusCol).setValue(d.status);
      sh.getRange(row, completedCol).setValue(d.completedAt ? new Date(d.completedAt) : '');
      return { id: d.id, status: d.status, completedAt: d.completedAt };
    }
  }
  throw new Error('Task not found');
}

function writeDocument(sh, d) {
  sh.appendRow([d.user, d.name, new Date(d.timestamp)]);
  return { ok: true };
}

function buildDashboard(user) {
  const ss = SpreadsheetApp.getActive();
  const sessions = ss.getSheetByName('Sessions').getDataRange().getValues();
  const tasks = ss.getSheetByName('Tasks').getDataRange().getValues();
  const documents = ss.getSheetByName('Documents').getDataRange().getValues();
  const activities = ss.getSheetByName('Activities').getDataRange().getValues();

  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate()+7);

  let weeklyMinutes = 0;
  const dailyBuckets = new Array(7).fill(0); // minutes per weekday index (0=Sunday)
  sessions.slice(1).forEach(r => {
    const start = r[2];
    if (!(start instanceof Date)) return;
    if (start >= startOfWeek && start < endOfWeek && r[1] === user) {
      weeklyMinutes += (r[4] || 0);
      dailyBuckets[start.getDay()] += (r[4] || 0);
    }
  });

  const userTasks = tasks.slice(1).filter(r => r[1] === user).map(r => ({ id: r[0], task: r[2], status: r[3] }));
  const docs = documents.slice(1).filter(r => r[0] === user).map(r => ({ user: r[0], name: r[1], timestamp: r[2] }));

  const teamHours = sessions.slice(1).reduce((acc, r) => acc + (r[4]||0), 0) / 60;
  const totalTasks = tasks.length - 1;
  const completedTasks = tasks.slice(1).filter(r => r[3] === 'DONE').length;

  const topSites = aggregateTopSites(activities, startOfWeek, endOfWeek, 5);
  const trendWeeks = computeWeeklyTrend(sessions, user, 6); // last 6 weeks

  return {
    weeklyHours: +(weeklyMinutes/60).toFixed(2),
    weeklyGoal: 40,
    topSites: topSites,
    documents: docs,
    tasks: userTasks,
  teamStats: { totalHours: +teamHours.toFixed(2), totalTasks, completedTasks },
  dailyHours: dailyBuckets.map(m=> +(m/60).toFixed(2)),
  weeklyTrend: trendWeeks
  };
}

function listTasks(user) {
  const tasks = SpreadsheetApp.getActive().getSheetByName('Tasks').getDataRange().getValues();
  return tasks.slice(1).filter(r => !user || r[1] === user).map(r => ({ id: r[0], user: r[1], task: r[2], status: r[3], createdAt: r[4], completedAt: r[5] }));
}

function listSessions(user) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Sessions');
  const data = sh.getDataRange().getValues();
  return data.slice(1).filter(r => !user || r[1] === user).map(r => ({ id: r[0], user: r[1], startISO: r[2], endISO: r[3], duration: r[4], projectTag: r[5], activityLevel: r[6], urlsSample: r[7], keyContributions: r[8], notes: r[9] }));
}

function aggregateTopSites(activities, start, end, limit) {
  const counts = {};
  activities.slice(1).forEach(r => {
    const ts = r[0];
    if (!(ts instanceof Date)) return;
    if (ts < start || ts >= end) return;
    const url = r[2];
    if (!url) return;
    const domain = extractDomain(url);
    counts[domain] = (counts[domain] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a,b)=> b[1]-a[1])
    .slice(0, limit)
    .map(e => [e[0], e[1]]);
}

function computeWeeklyTrend(sessions, user, count) {
  const now = new Date();
  const results = [];
  for (let i=0;i<count;i++) {
    const end = new Date(now); end.setHours(0,0,0,0); end.setDate(end.getDate() - end.getDay() - 7*i);
    const start = new Date(end); start.setDate(start.getDate() - 6);
    let minutes = 0;
    sessions.slice(1).forEach(r => {
      const sdate = r[2];
      if (sdate >= start && sdate <= end && (!user || r[1] === user)) minutes += (r[4] || 0);
    });
    results.unshift({ weekStart: start, hours: +(minutes/60).toFixed(2) });
  }
  return results;
}

function extractDomain(url) {
  try {
    return url.replace(/^https?:\/\//,'').split('/')[0].replace(/^www\./,'');
  } catch(e) { return 'unknown'; }
}

function jsonOut(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .setContent(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- HMAC Verification (Optional) ----
// Store the shared secret in Script Properties (File > Project Properties > Script Properties) under key SHARED_SECRET.
function verifyAndStripSignature(payload) {
  if (!payload._sig) return payload; // unsigned accepted (can enforce by throwing instead)
  const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!secret) return payload; // if secret not configured, accept
  const sig = payload._sig;
  const ts = payload._ts;
  if (!ts) throw new Error('Missing timestamp');
  // Basic replay window: 10 minutes
  const ageMs = Date.now() - Number(ts);
  if (isNaN(ageMs) || ageMs > 10 * 60 * 1000) throw new Error('Stale payload');
  // Rebuild body without _sig
  const clone = Object.assign({}, payload);
  delete clone._sig;
  const message = JSON.stringify(clone);
  const expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(message, secret));
  if (expected !== sig) throw new Error('Invalid signature');
  return clone;
}
