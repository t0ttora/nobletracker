<div align="center">
  <h1>NobleTracker</h1>
  <p><strong>Privacy‑aware team productivity & activity analytics for Chrome (MV3)</strong></p>
  <p>Sessions · Tasks (drag & drop + undo) · Documents · Domain-only / hashed activity · Dark dashboard · Google Sheets (Apps Script) backend · Offline queue · HMAC signing</p>
  <sub>Accent: <code>#ff5a26</code> · Full black UI</sub>
</div>

---

## 1. Overview
NobleTracker tracks team session time, tasks, documents and (optionally) browsing activity, presenting real‑time analytics in a focused dark dashboard. Data is stored in Google Sheets via a minimal Apps Script JSON endpoint. Privacy modes (domain‑only, SHA‑256 URL hashing, omit titles) minimize sensitive exposure. An offline queue + HMAC signatures add resilience and integrity.

## 2. Core Feature Groups
### Sessions & Activity
- Start / stop sessions per user
- Live timer (heartbeat updates)
- Auto stop after configurable idle minutes
- Domain-only capture, optional URL hashing & title omission
- Activity batching with exponential backoff retry

### Task Management
- Quick add in popup (shows last 3 tasks)
- Inline add bar on dashboard (My Tasks)
- Kanban board: TODO / IN PROGRESS / DONE (drag & drop)
- Quick complete (popup)
- Search & pagination (popup full list)
- Undo status change (5s window)

### Document Logging
- One‑click document log from popup
- Dashboard list with date labels

### Dashboard Analytics
- Weekly Hours metric + progress bar
- 7‑day sparkline (dailyHours)
- Multi‑week (last 6) trend bars
- Top Sites (domain + visit count)
- Documents and Team Overview blocks
- Inline empty states + rich global empty state (orbit layout)
- Global search bar (Google) with '/' keyboard focus shortcut

### Backend / Apps Script
- REST-like GET (dashboard|tasks|sessions) & POST (session, activity, task, taskStatus, document, batch, telemetry)
- Automatic sheet + header bootstrap
- Batch sending for efficiency
- HMAC signing (shared secret + timestamp freshness)

### Resilience & Telemetry
- Local offline queue (auto + manual flush)
- Manual Flush button (popup)
- Error + performance telemetry (optional)
- UI feedback & Undo snackbar

### UI / Theme
- Pure black background (#000) with dark cards (#1a1a1a / #0f0f0f variants)
- Accent color #ff5a26 across progress, buttons, charts
- Enhanced search component (icon + hint + enter trigger)
- Focus Mode in popup (large timer)

### Security & Privacy
- HMAC SHA‑256 signatures (payload + timestamp)
- Consent gate (disable data collection entirely)
- Domain-only + hashing + title omission combinations
- Data versioning / migration stub

### Quality of Life
- Undo task changes
- CSV export (sessions)
- Performance timings (flush)
- Inline & global empty states
- '/' keyboard shortcut to focus search

## 3. Architecture Summary
| Layer | Responsibility |
|-------|----------------|
| MV3 Service Worker | Sessions, activity queue, flush, HMAC, telemetry |
| Popup | Quick controls (timer, tasks, doc, flush) |
| Dashboard | Analytics + kanban + search |
| Options | Endpoint / secret / privacy / telemetry / idle config |
| Apps Script | Sheets CRUD & aggregations (hours, trend, sites, tasks, docs) |

## 4. Sheet Tabs / Data Model
- Sessions: startISO, endISO, user, duration
- Activities: timestamp, user, domainOrHash, titleOpt
- Tasks: id, user, task, status, createdAt, completedAt
- Documents: timestamp, user, name
- Telemetry: ts, level, message, stack?, perfLabel?, ms

## 5. Apps Script API Contract
```jsonc
// Write (POST)
{ type: 'session', user, start, end, duration }
{ type: 'activity', user, url|hash, title?, timestamp }
{ type: 'task', user, task, status, createdAt }
{ type: 'taskStatus', id, status, completedAt|null }
{ type: 'document', user, name, timestamp }
{ type: 'batch', records: [...] }
{ type: 'telemetry', level, message, stack?, ts, perfLabel?, ms }

// Read (GET)
?user=NAME&mode=dashboard -> { weeklyHours, weeklyGoal, topSites, documents, tasks, teamStats, dailyHours, weeklyTrend }
?user=NAME&mode=sessions  -> session rows
?user=NAME&mode=tasks     -> task rows
```

## 6. Local Setup
1. Chrome → Extensions → Enable Developer Mode
2. Load Unpacked → select this folder
3. Open Options → set Apps Script Web App URL + shared secret + privacy toggles
4. Start a session, browse a few domains, add tasks
5. Open a new tab (dashboard) to view analytics

## 7. Deploying the Apps Script
1. Create an Apps Script project linked to a Sheet
2. Paste contents of `apps_script_example.js`
3. Deploy → New deployment → Web app (anyone or domain)
4. Copy the Web App URL into Options
5. Script Properties → add `SHARED_SECRET`
6. (Optional) Enforce signature inside `verifyAndStripSignature`

## 8. HMAC Signing
Payload + timestamp string hashed with shared secret (SHA‑256). Reject timestamps older than your freshness window (e.g., 10 minutes) to mitigate replay.

## 9. Privacy Modes
| Mode | Effect |
|------|--------|
| Domain-only | Strip path/query; keep only origin |
| Hash URL | Apply domain-only then SHA‑256 hash (irreversible) |
| Omit Titles | Do not send page title |
| Consent off | No activity collected |

## 10. Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `/` (dashboard) | Focus global search |
| Enter (search) | Launch Google search |
| Escape (new task input) | Close new task bar |

## 11. Roadmap (Selected)
- Command mode (`:task`, `:search` etc.)
- Labels / priorities for tasks
- Light theme toggle
- Domain allowlist enforcement
- Advanced charts (stacked / category grouping)
- Multi‑user comparison graphs
- WebSocket / push for realtime board
- Animated (Lottie / SVG) empty states

## 12. Development Tips
- After editing background logic reload the extension on chrome://extensions
- Queue auto‑retries on network failure; manual flush in popup
- Disable telemetry to stop error/perf posts

## 13. Contributing
Open an Issue describing the enhancement before large PRs. Small UI/typo fixes can go straight to PR.

## 14. License
Proprietary – All rights reserved.

This project is NOT open source. Source code, assets and documentation are provided solely for internal use within Nobleverse (and approved contractors under NDA). See the `LICENSE` file for full terms (NobleTracker Proprietary License v1.0). No redistribution, sublicensing, external hosting, or derivative public release is permitted without prior written consent.

If the company later elects to open source the project, this section will be updated and a standard OSI license (e.g., MIT or Apache‑2.0) may replace the current proprietary terms.

---
## 15. Spec Coverage (Operational Framework \& Architecture)
Alignment with internal PDF (Sep 4, 2025):

| Spec Theme | Implemented | Notes |
|------------|-------------|-------|
| Granular Operational Visibility | ✅ | Session start/end + sampled & navigation activities, documents, tasks |
| Centralized Hub (Chrome + Google Workspace) | ✅ | Extension + Apps Script + Sheets only |
| Verifiable Integrity (server timestamps) | ✅ | sessionStart (server start) + sessionEnd (server end/duration) fallback to legacy single record |
| Passive Activity Logging | ✅ | webNavigation + 60s active tab sampler (`sampleActiveTab`) |
| Active Contribution Logging | ✅ | Manual document log; session aggregates `keyContributions` from docs list |
| Project Tag per Session | ✅ | `projectTag` input in popup UI |
| Activity Level Classification | ✅ | Derived from events per minute (High/Medium/Low) written on session end + shown in dashboard sessions table |
| URLs Sample Capture | ✅ | First 5 unique domains stored as `urlsSample` |
| Key Contributions Summary | ✅ | Up to 3 document names aggregated |
| Weekly Performance Goal Tracking | ✅ | Weekly goal (40h) + progress bar; (future: threshold nudges) |
| Automated Idle Auto-Stop | ✅ | chrome.idle with configurable minutes |
| Forgotten Session Timeout (prolonged inactivity) | ✅ | Watchdog: 2h inactivity & 8h hard ceiling auto-stop with note |
| Central Identity Control | ⚠️ Partial | Static USERS array; future: fetch allowed list from backend sheet |
| Integrity: Server Timestamps | ✅ | sessionStart uses server time in Apps Script |
| Automated Weekly Briefing (email) | ❌ | Not yet; would require Gmail API script weekly trigger |
| Project-Based Filtering / Tags in Analytics | ❌ | Tag captured but not surfaced on dashboard UI yet |
| Activity-Level Visualization | ❌ | Stored but not yet displayed |
| Threshold Nudges (in-extension alerts) | ❌ | Not yet implemented |
| Document Auto-Suggestion (detect active Docs) | ✅ | Content script detects Docs/Sheets/Slides & surfaces quick log buttons |
| Strategic Weekly Email Summary | ❌ | Not implemented (cron trigger placeholder) |
| Role/Access Controls | ❌ | Not required yet; all users equal scope |

### Newly Added vs Previous Version
- Split session model (`sessionStart` / `sessionEnd`) with authoritative server start time.
- Extended Sessions sheet schema: ID, User, Start, End, DurationMinutes, ProjectTag, ActivityLevel, URLsSample, KeyContributions, Notes.
- Activity level classification based on passive events per minute + dashboard display.
- Active tab 60-second sampler for supplemental passive activity evidence.
- Aggregation of unique domains + document names per session.
- Watchdog (inactivity & max duration) + supportive weekly threshold nudge logic.
- Google Docs/Sheets/Slides auto-suggestion (content script) added to popup.

### Follow-Up Implementation Candidates
1. Popup: project tag input + optional notes on stop (UI layer not yet wired).
2. Dashboard: surface project tag column & activity level badge per session history (needs sessions view component).
3. Background: long-session watchdog (e.g., force stop & flag after 2h idle-lack but still active timer).
4. Apps Script: weekly timed trigger -> compile summary & send Gmail briefing.
5. Content script enhancement: auto-suggest recent Google Docs/Sheets/Slides for quick add.
6. Threshold nudges: compare mid-week hours vs goal with unobtrusive notification.

These items remain intentionally deferred for incremental delivery.
---
Questions & feedback welcome via Issues.
