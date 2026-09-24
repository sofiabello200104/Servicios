# SOFIA — Engram Context Export

Snapshot of every Engram memory recorded for project `sofia` up to 2026-09-18.
Purpose: move the full project context to another machine so the coding agent
there starts with the same knowledge (decisions, business rules, gotchas, test
counts, environment quirks).

Source database on the original machine: `~/.engram/engram.db` (project key `sofia`, 20 observations).

---

## How to restore this context on the new machine

Two options. Option A is the clean one; Option B is the fast one.

### Option A — Re-import through the agent (recommended)

Open Claude Code in the project folder (the folder MUST be named `sofia`, Engram
derives the project key from the directory basename) and paste this prompt:

> Read `ENGRAM_CONTEXT.md`. For every entry under "Memory entries", call
> `mem_save` with `project: "sofia"`, using the entry's `type`, `title`,
> `topic_key` (when present) and the full body as `content`. Set
> `capture_prompt: false`. Do not rewrite or summarise the bodies. When done,
> call `mem_context` for project `sofia` and confirm 20 observations exist.

Session summaries (type `session_summary`) can be saved with `type: "discovery"`
if the installed Engram version rejects `session_summary` on `mem_save`.

### Option B — Copy the database

Copy `~/.engram/engram.db` (plus `engram.db-wal` and `engram.db-shm` if present)
from the original machine into `~/.engram/` on the new one **before** starting
the Engram MCP server. This brings every project, not only `sofia`.

---

## Project overview (synthesised from the entries below)

- **What**: SOFIA, an internal support-ticket dashboard over the OData entity
  `ID12086_Tickets_medidor`. Three views: **Resumen**, **Capacidad y
  Rendimiento**, **Tickets Activos**.
- **Stack**: plain Node `http`/`https` server (`server.js`), zero npm
  dependencies, no build step. Client uses Tailwind Play CDN, Chart.js 4.4.1
  CDN and `chartjs-plugin-datalabels@2.2.0` CDN. Tests with `node:test`
  (`npm test`), browser mirror in `test-runner.html`.
- **Conventions**: strict TDD (tests before implementation), English
  code/comments/identifiers, neutral Spanish UI copy, reply to the user in
  Rioplatense Spanish. Not a git repository. `pruebapony/` is a read-only
  reference project — never modify it. `data.json` is the user's spec (v1–v4
  merged) — reflect what the user pastes, never invent.
- **Data flow**: browser calls `/odata-proxy`; the server injects Basic Auth
  from `data/config.json` (gitignored) and enforces a host allowlist. All
  aggregation happens client-side in `assets/js/mapper.js` (dual Node/browser
  module). Dev fixture: `data/sample-tickets.json` (4847 rows, 22 columns)
  generated from `Libro1.xlsx` by `scripts/generate-sample.py`.
- **Runtime**: `npm start` → `https://localhost:3000` when `certs/key.pem` +
  `certs/cert.pem` exist (self-signed, SAN includes 190.145.254.194,
  172.16.16.171, 127.0.0.1, localhost), otherwise plain `http`. Static files
  are served with `Cache-Control: no-cache`.
- **Test count at last session**: 75/75 green.

Key files:

| Path | Role |
| --- | --- |
| `server.js` | http/https server, `/api/config` GET/POST, `/api/config/test`, `/odata-proxy`, `/api/sample`, static allowlist, CSP, no-cache headers |
| `assets/js/mapper.js` | Pure data layer: `normalizeTickets`, `buildResumen`, `buildCapacidad`, `buildRecursoGauges`, `buildRecursoTickets`, `buildActivos`, holidays, date parsing, `normalizeCliente`, `CLIENTE_ALIASES` |
| `assets/js/charts.js` | Chart primitives: `makeChart` registry, `doughnut`, `barChart`, `lineChart`, `gauge`, `segmentedGauge`, `renderSpark`, `kpiCard`, `semaphore`, `chartEmptyState`, `COLORS` |
| `assets/js/render.js` | `renderResumen`, `renderCapacidad`, `renderActivos`, drill-down modal, `LIST_BAR_*` shared style |
| `assets/js/app.js` | Boot, view switching (`data-view`, localStorage last view), filters, lazy render flags |
| `assets/js/parametrizacion.js` | OData configuration slide-over |
| `assets/js/store.js`, `assets/js/odata-client.js` | Local cache + proxy client |
| `index.html`, `assets/css/app.css` | App shell, three views, modal markup |
| `test/mapper.test.js` | 75 `node:test` cases |
| `data.json` | User spec, versions v1–v4 merged (read-only for the agent) |
| `data/config.json` | OData endpoint + credentials (gitignored, never commit) |
| `README.md` | Documents each view and its business rules |

---

## Memory entries

Ordered chronologically. Each entry reproduces the Engram observation body verbatim.

---

### Entry 1

- **id (original)**: 182
- **type**: discovery
- **title**: Analyzed pruebapony reference project for new dashboard
- **topic_key**: `analysis/pruebapony-reference`
- **created**: 2026-09-10 16:35:13

**What**: Full read-only analysis of `pruebapony/` (CMI SICSS dashboard) as reference for the new "sofia" dashboard project.
**Why**: User wants a new visually attractive data dashboard that reuses pruebapony's OData+auth+charting patterns. Analysis/planning phase only, no implementation yet.
**Where**: pruebapony/server.js, db.js, auth-lib.js, assets/js/{mapper,legacy-render,odata-client,area-catalog,store,app,login}.js, assets/css/app.css, index.html, login.html, test-runner.html
**Learned**:
- Stack: Node >=20, raw http/https (no Express), single dep better-sqlite3 (data/users.db for users + odata_config only). HTTPS self-signed certs in certs/ (gitignored). Port 3000. No env vars, all constants hardcoded.
- Auth (COPY AS-IS): auth-lib.js = scrypt hashing + timingSafeEqual + dummy-hash timing defense, HMAC-SHA256 signed session token (8h), secret in data/.session-secret, cookie sid HttpOnly/Secure/SameSite=Strict, server-side revocation map on logout. Rate limit 5 fails/15min in-memory. Password policy duplicated client+server. RBAC by `area` column + is_admin; bootstrapped admin with random temp password printed once. Static path allowlist resolve+decode before prefix check (fixed traversal bug).
- OData: browser calls /odata-proxy?url= ; server injects Basic Auth from odata_config table (creds never reach browser), host allowlist ALLOWED_ODATA_HOSTS, 20s timeout. No $filter/$select — pulls whole entity set, aggregates client-side. Exception: /api/soluciones/kpis aggregates 7.5MB server-side. Raw rows cached in localStorage (cmi.rawdata.v1) with memory fallback; refetch on every load.
- Data shaping (COPY PATTERN): mapper.js dual Node/browser module (module.exports + window.CMI_MAPPER). Alias-based column detection (detectColumns/findAliasColumn) instead of hardcoded column names. Date parsing avoids new Date(raw) (UTC-5 drift bug) — regex for /Date(ms)/, ISO, DD/MM/YYYY, Spanish months, all UTC. Builders: buildKpiBundle (tidy), buildWideBundle (wide sum), buildMetricBundle (avg), buildTicketStats. area-catalog.js = {id,label,aliases[],valueScale} per area drives both mapping and KPI cards.
- Charts: Chart.js 4.4.1 CDN + Tailwind Play CDN. makeChart(id,cfg) registry destroys prev instance (Chart.getChart) before create. Helpers: barChart, lineChart, doughnut (cutout 70%, legend bottom usePointStyle), gauge (doughnut hack circumference 270 rotation 225 cutout 78%), renderSpark, kpiCard (HTML template w/ status chip, ▲▼ variation, sparkline). Also radar, CSS clip-path funnel, DOM progress bars, sortable tables. COLORS palette brand #0EA5E9 ok #10B981 warn #F59E0B bad #EF4444; semaphore(value,meta,op) warn threshold meta*0.92.
- UI: light only, Inter font, dark navy sidebar w-64 + sticky topbar, cards radius 14px, slide-over panels, inline SVG icons, skeleton .card-loading. Integrasoft logo base64 in login.html.
- Tests: test-runner.html stubs window.Chart + hidden DOM, zero deps.
- DO NOT port: mockup-cmi-sicss-2026.html (drifted prototype), hardcoded business constants in legacy-render.js (COM_PROJ, VENDOR_BUDGET, SOL snapshot), xlsx/PNG, pony.md/prompt.md. odata auth_pass stored plaintext in SQLite.

---

### Entry 2

- **id (original)**: 186
- **type**: architecture
- **title**: Decided sofia dashboard architecture (no login, JSON config, ticket data)
- **topic_key**: `architecture/sofia-dashboard`
- **created**: 2026-09-10 19:20:26

**What**: New dashboard at sofia root, derived from pruebapony but stripped of auth.
**Why**: User priorities: (1) OData link with user/password, (2) pruebapony's visual language for charts/tables/KPI text, (3) Parametrización + Actualizar datos flow. Explicitly NO user login. Data source = OData entity `ID12086_Tickets_medidor` (sample in Libro1.xlsx: ~5000 support ticket rows, Nov-2025→Sep-2026, cols: ID, Fecha, Accion, Producto, Proyecto, Proceso, Recurso_Soporte, Recurso_Entrega_Final, Fecha_Soporte_Inicial/Final, Hora_Cal_*, Fecha_Entrega_*, Prioridad_del_Servicio_ANS, Tiempo_empleado_entrega, Tiempo_de_llamada).
**Where**: sofia/server.js, sofia/index.html, sofia/assets/{css,js}, sofia/data/config.json, sofia/data/sample-tickets.json
**Learned**:
- Decisions: plain Node `http` (no HTTPS/certs — no cookies to protect), zero npm deps (drop better-sqlite3; config lives in data/config.json gitignored), server proxy /odata-proxy?url= keeps Basic Auth server-side + host allowlist copied from pruebapony, aggregation client-side (5k rows is small). Chart.js 4.4.1 + Tailwind CDN like reference. UI copy Spanish (neutral), code/comments English.
- Tradeoff accepted: without login the Parametrización panel (OData creds) is open to anyone reaching the server — acceptable for an internal/local tool; revisit if exposed.
- Data quality gotchas in Libro1: Recurso_Soporte has duplicate casing ('Paola Andrea Macias Rojas' vs 'PAOLA ANDREA MACIAS ROJAS') → normalize; Prioridad_del_Servicio_ANS has 11 variants → group by leading number (1-Critico, 2-Urgente, 3-Prioritario, 5-Evolutivo/Sugerencia, 10-Visita); Tiempo_de_llamada mixed ('60', '1 Hora'); empty strings and None both mean missing; Accion: CIERRE 2984 / REALIZAR 1795 / Crear 144 (backlog = not CIERRE).
- Landing = app shell (sidebar+topbar) + Parametrización slide-over + Actualizar datos + resumen view (KPI tiles, donut producto, bar por mes, bar horizontal recurso, donut prioridad) + empty state when unconfigured + dev fixture from Libro1.

> Note: the "plain http, no HTTPS" decision was later superseded by Entry 15 (optional HTTPS when certs exist).

---

### Entry 3

- **id (original)**: 187
- **type**: architecture
- **title**: Built SOFIA ticket dashboard (zero-dep, no build step)
- **topic_key**: `sofia/build-summary`
- **created**: 2026-09-10 19:36:46

What: Built the full SOFIA dashboard at C:\Users\GREENYWAVE\3D Objects\sofia\ per spec — plain Node http server (no deps), Tailwind Play CDN + Chart.js 4.4.1 CDN client, single "Resumen" view over OData entity ID12086_Tickets_medidor. TDD: wrote test/mapper.test.js first (17 cases), then implemented assets/js/mapper.js to pass all of them on first attempt; mirrored the same 17 cases in test-runner.html for the browser.

Why: User request to replicate patterns from pruebapony/ reference project but simpler (no login/sessions/SQLite), adapted for a single ticket entity set instead of pruebapony's multi-area OKR dashboard.

Where: server.js, index.html, assets/js/{mapper,charts,render,store,odata-client,parametrizacion,app}.js, assets/css/app.css, test/mapper.test.js, test-runner.html, scripts/generate-sample.py, data/sample-tickets.json (5011 rows generated from Libro1.xlsx), README.md.

Key decisions/deviations from a literal reference copy:
1. ALLOWED_ODATA_HOSTS: copied reference's literal host list verbatim (same org's OData infra) as the default, extensible via SOFIA_ODATA_HOSTS env var — needed because sofia has no session/admin gate to hide this list behind.
2. Date parsing (mapper.js parseFecha): never uses `new Date(rawString)` — regex-extracts y/m/d and builds via Date.UTC(...), read back only with getUTC* getters. This is what prevents the classic day-1-of-month timezone shift bug. Verified with explicit tests for ISO and DD/MM/YYYY at day 1.
3. Prioridad_del_Servicio_ANS grouping: regex `^(\d+)-([^\s(]+)/` — captures leading number+word up to the first space or paren. This correctly produces "10-Visita" from "10-Visita / Implementación (Programación)" (space before slash stops the match) AND "5-Evolutivo/Sugerencia" from "5-Evolutivo/Sugerencia (algo)" (no space before slash, so the whole slash-joined token survives). Both cases came directly from spec examples.
4. buildResumen() extended beyond the original ask to add per-month `total`/`cerrados`/`backlog` fields on monthlySeries entries, so each KPI card's sparkline shows a trend of ITS OWN metric (total volume, cerrados, backlog, %cierre) rather than one generic activity line reused everywhere.
5. odata-client.js fetchTemplate() calls plain `/odata-proxy` with no query params — server already knows the configured endpoint+template+credentials server-side (data/config.json), so the browser never needs to construct the OData URL itself, consistent with "credentials never touch the client" posture.
6. server.js performODataRequest adapted from reference: dropped https-only assumption (dials http OR https transport based on the target URL's own protocol, since this server itself is plain http with no certs).

Verified: node --check on all 9 JS files (clean), npm test (17/17 pass), server smoke tests (GET / -> 200, GET /api/sample -> JSON array, GET /api/config -> {configured:false} with no password field), path-traversal attempts blocked (404) both raw ../ and %2f-encoded, disallowed OData host rejected (400 on save, 403 on test/proxy), password-preservation-on-blank-update verified end to end against data/config.json on disk.

Learned: On this Windows/Git-Bash environment, background `node server.js &` runs can leave orphaned listeners on port 3000 across tool calls (EADDRINUSE / "Empty reply from server" symptoms) — had to netstat -ano + taskkill //F //PID to clear stray node.exe processes before a clean server start would respond. Not a bug in the app itself.

---

### Entry 4

- **id (original)**: 188
- **type**: session_summary
- **title**: Session summary: sofia (initial build)
- **created**: 2026-09-10 19:36:59

## Goal
Build a new zero-dependency SOFIA ticket dashboard at C:\Users\GREENYWAVE\3D Objects\sofia\, adapting patterns from the pruebapony/ reference project, for the OData entity ID12086_Tickets_medidor. Strict TDD required.

## Instructions
- No build step, zero npm dependencies, plain Node http server.
- Code/identifiers in English, UI copy in neutral professional Spanish.
- Write test/mapper.test.js BEFORE implementing mapper.js.
- Do not modify anything inside pruebapony/.

## Discoveries
- Day-1-of-month timezone bug avoided by never calling `new Date(rawString)` — always regex-extract y/m/d/h/m/s and build via Date.UTC(...), read back only with getUTC* getters.
- Prioridad_del_Servicio_ANS grouping regex `^(\d+)-([^\s(]+)` correctly handles both "10-Visita / Implementación (...)" -> "10-Visita" and "5-Evolutivo/Sugerencia (...)" -> "5-Evolutivo/Sugerencia" because it stops at the first space or paren.
- Libro1.xlsx has exactly 5011 rows, sheet name ID12086_Tickets_medidor, matching spec's data facts.
- Windows/Git-Bash background `node server.js &` runs can leave orphaned listeners on port 3000 (EADDRINUSE / empty replies on retry) — required netstat -ano + taskkill //F //PID to get a clean server start.

## Accomplished
- Full project scaffolded: server.js, index.html, assets/css/app.css, assets/js/{mapper,charts,render,store,odata-client,parametrizacion,app}.js, test/mapper.test.js (17 cases, written first), test-runner.html (browser mirror of the same 17 cases), scripts/generate-sample.py, data/sample-tickets.json (5011 rows), README.md, package.json, .gitignore.
- All 9 JS files pass `node --check`. `npm test` → 17/17 pass.
- Server smoke-tested live: GET / → 200, GET /api/sample → JSON array, GET /api/config → {configured:false} with no password leaked, path-traversal blocked (raw ../ and %2f-encoded), disallowed OData host rejected (400 save / 403 test-proxy), password-preserved-on-blank-update verified against data/config.json on disk.
- Full details and the verbatim-vs-adapted reference list saved to Engram under topic_key sofia/build-summary (type: architecture).

## Next Steps
- None outstanding — task complete. Future work (not requested): real OData host testing against a live server, additional dashboard views beyond "Resumen".

## Relevant Files
- C:\Users\GREENYWAVE\3D Objects\sofia\server.js — Node http server, config/proxy/static routes
- C:\Users\GREENYWAVE\3D Objects\sofia\assets\js\mapper.js — pure data layer, dual Node/browser export
- C:\Users\GREENYWAVE\3D Objects\sofia\test\mapper.test.js — 17 TDD tests, written before implementation
- C:\Users\GREENYWAVE\3D Objects\sofia\index.html, assets\js\{charts,render,store,odata-client,parametrizacion,app}.js, assets\css\app.css
- C:\Users\GREENYWAVE\3D Objects\sofia\scripts\generate-sample.py, data\sample-tickets.json
- C:\Users\GREENYWAVE\3D Objects\sofia\README.md

---

### Entry 5

- **id (original)**: 189
- **type**: session_summary
- **title**: Session summary: sofia (analysis + landing page)
- **created**: 2026-09-10 19:41:55

## Goal
Analyze the pruebapony reference project and build the landing page (app shell + Parametrización + Actualizar datos + Resumen view) of the new "sofia" ticket dashboard.

## Instructions
- User priorities: OData link with user/password (server-side proxy), pruebapony's visual language for charts/tables/KPI text, Parametrización + Actualizar datos flow. NO user login.
- Build incrementally: landing first, then more views on request.
- UI copy in neutral Spanish; code/comments English.
- Reply to user in Rioplatense Spanish.

## Discoveries
- Data source: OData entity `ID12086_Tickets_medidor` (sample Libro1.xlsx, 5011 support tickets, Nov-2025→Sep-2026). Backlog = Accion != CIERRE (2984 cerrados, 2027 backlog, 59.5%).
- Data quality: Recurso_Soporte casing duplicates (normalize Title Case), 11 priority variants (group by leading number), Tiempo_de_llamada mixed formats, '' and null both missing.
- Installed Node is v18.20.5 although package.json says >=20 — everything runs fine on 18 (no better-sqlite3 anymore).
- Chart.js v4 uses `border:{display:false}` not `grid.drawBorder` (fixed in charts.js).
- Proxy returns 409 when OData unconfigured before checking host allowlist; once configured returns 403 for non-allowlisted hosts. Not an SSRF hole.
- Global skill registry lives at ~/.claude/skills (no .atl in sofia); relevant skills for this project: dataviz, ponytail.

## Accomplished
- ✅ Full analysis of pruebapony saved (engram topic analysis/pruebapony-reference).
- ✅ Architecture decided (engram topic architecture/sofia-dashboard): plain http, zero deps, data/config.json, proxy with host allowlist, client-side aggregation.
- ✅ Built sofia landing: package.json, server.js, index.html, assets/css/app.css, assets/js/{mapper,charts,render,store,odata-client,parametrizacion,app}.js, test/mapper.test.js (17/17 pass, node:test), test-runner.html, scripts/generate-sample.py, data/sample-tickets.json, README.md, .gitignore.
- ✅ Fresh-context review: DOM contract 100% match, boot path traced, CSP OK, curl checks OK, mapper numbers verified against fixture.
- 🔲 User has not yet opened it in a browser / tested against real OData endpoint.

## Next Steps
- User runs `npm start`, opens http://localhost:3000, loads sample data, then configures real OData via Parametrización.
- Add further views (per producto, per recurso, ANS compliance/time-to-close using Fecha_Soporte_*/Hora_Cal_*, Tiempo_empleado_entrega).
- Consider `data-view` nav handler when a second view is added; consider vendoring Tailwind/Chart.js if going to production.

## Relevant Files
- server.js — http server, /api/config GET/POST, /api/config/test, /odata-proxy, /api/sample, static allowlist, CSP
- assets/js/mapper.js — dual Node/browser: normalizeTickets, buildResumen, safe date parsing, alias column detection
- assets/js/charts.js — makeChart registry, doughnut, barChart, gauge, renderSpark, kpiCard, semaphore, COLORS, PRODUCTO_COLORS
- assets/js/app.js — boot sequence, refresh, filters, empty state
- assets/js/parametrizacion.js — slide-over config panel
- data/sample-tickets.json — dev fixture generated from Libro1.xlsx
- pruebapony/ — reference project, untouched

---

### Entry 6

- **id (original)**: 190
- **type**: bugfix
- **title**: Fixed doughnut legend showing single item (Chart.js v4 generateLabels)
- **created**: 2026-09-10 20:08:19

**What**: Doughnut legends rendered only one entry; horizontal bar labels were clipped; producto legend overflowed its box.
**Why**: Visual verification via headless Chrome (Playwright + installed Chrome, run with Node 22 from nvm since Playwright needs >=20) after user reported "no funciona".
**Where**: assets/js/charts.js (doughnut generateLabels), assets/js/render.js (top recursos short labels + full-name tooltip), index.html + assets/css/app.css (.chart-box-legend 440px), index.html (empty favicon link)
**Learned**: In Chart.js v4, `Chart.defaults.plugins.legend.labels.generateLabels` is the generic per-dataset generator; for per-slice labels on doughnut/pie you must call `Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart)`. Also `grid.drawBorder` is v3 — use `border.display`. Verification recipe: scratchpad/pw/drive.js launches Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` with Node 22 (`C:/Users/GREENYWAVE/AppData/Local/nvm/v22.10.0/node.exe`).

---

### Entry 7

- **id (original)**: 191
- **type**: architecture
- **title**: Capacity view spec v4: ID/Analizar button opens modal drill-down; no-cache headers
- **topic_key**: `architecture/sofia-capacidad-view`
- **created**: 2026-09-10 23:03:33 (revised 4 times)

**What**: Spec v4 merged into data.json (`cambios_solicitados_v4`, `especificacion_ui_dashboard_actualizada`). Drill-down is now an "ID" column with an "Analizar" button per resource row that opens a centered modal (#drilldown-modal) "Tickets asociados a {recurso}"; inline accordion removed. Temporalidad/Tendencia/Rol were already removed in v3.
**Why**: User spec; user had kept seeing old UI due to browser cache.
**Where**: index.html, assets/js/render.js, app.js, app.css, README.md; server.js (Cache-Control: no-cache on static)
**Learned**: server.js sent no cache headers → Chrome heuristically cached JS/HTML across deployments; fixed with `Cache-Control: no-cache` on serveStatic. App URL is https://localhost:3000 (certs/ present). 75/75 tests. Live OData now has 22 cols incl. Cliente.

---

### Entry 8

- **id (original)**: 192
- **type**: bugfix
- **title**: Replaced drill-down accordion with modal (spec v4)
- **topic_key**: `sofia/capacidad-view`
- **created**: 2026-09-10 23:21:37 (revised 5 times)

**What**: Spec v4 replaced the v3 inline-accordion drill-down on "Detalle por Recurso" with an explicit "ID" column holding an "Analizar" button per row, which opens a single reused centered modal (`#drilldown-modal`/`#drilldown-backdrop` in index.html) titled "Tickets asociados a {recurso}" with a subtitle summary line (period · ticket count · total hours), the same buildRecursoTickets-backed ticket table + footer total, closable via X/Escape/backdrop-click, with focus moving into the modal (close button) on open and back to the opener "Analizar" button on close.

**Why**: Coordinator explicitly said v3's row-click/Enter/Space/chevron accordion should be the ONE mechanism removed in favor of the button+modal — data.json's `especificacion_ui_dashboard_actualizada.tabla_detalle.columnas[6]` (`tipo: boton_analizar_tickets`) and `.drilldown_modal`.

**Where**: assets/js/render.js (removed `_capExpandedRecurso`/`renderDrilldownRow`/`toggleCapDrilldown`/row click+keydown wiring; added `openDrilldownModal`/`closeDrilldownModal`/`wireDrilldownModal`/`drilldownRowsHtml`, added a 7th `{key:'analizar', label:'ID', sortable:false}` to CAP_TABLE_COLUMNS), index.html (added the single modal markup block, removed nothing structural elsewhere), assets/css/app.css (removed `.cap-recurso-row`/`.drilldown-chevron`/`.table-row-detail`, added `.cap-analizar-btn` + `#drilldown-modal`/`#drilldown-backdrop`/`.drilldown-modal-*` — centered-dialog shadow/radius matching `#param-panel`'s weight but symmetric instead of directional), README.md. mapper.js untouched (buildRecursoTickets already covered everything needed).

**Learned**: No mapper/test changes needed at all this round — the whole delta was purely a UI mechanism swap on top of the already-tested `buildRecursoTickets`. Verified via Playwright (shot-cap5.png modal open, shot-cap6.png after Escape): modal renders correctly, closes on Escape, and focus visibly returns to the specific "Analizar" button that opened it (visible focus ring in the screenshot) — confirms the open/close focus management works end to end. 75/75 tests still green (untouched). Server auto-enables HTTPS via detected cert files (unrelated parallel change, noted in prior session) — driver needs `ignoreHTTPSErrors: true` + `https://localhost:3001`.

---

### Entry 9

- **id (original)**: 193
- **type**: session_summary
- **title**: Session summary: sofia (Capacidad y Rendimiento v1)
- **created**: 2026-09-10 23:34:27

## Goal
Add the "Capacidad y Rendimiento" view (spec in sofia/data.json) to the sofia ticket dashboard, after fixing the Resumen landing (legend bug, clipped labels).

## Instructions
- User priorities: OData link, pruebapony visual language, Parametrización + Actualizar datos. No login. Build view by view on request.
- UI copy neutral Spanish; code/comments English. Reply in Rioplatense Spanish.
- User already configured real OData creds in data/config.json (endpoint bpm.webapidashboard.integrasoftsas.co/odata/plantillas, template ID12086_Tickets_medidor) — app auto-loads real data on boot.

## Discoveries
- Chart.js v4: per-slice doughnut legend labels need `Chart.overrides.doughnut.plugins.legend.labels.generateLabels`, not the generic default. `grid.drawBorder` is v3 → `border.display`.
- Visual verification recipe: scratchpad pw/drive.js + drive-cap.js (Playwright with installed Chrome, run with Node 22 at C:/Users/GREENYWAVE/AppData/Local/nvm/v22.10.0/node.exe; installed default Node is 18). Use PORT=3001 for agent checks; user's server runs on 3000.
- Resource names have accent variants (Lina María/Maria) → normalizeTickets merges by diacritic-stripped key, keeps most frequent variant. Genuine typos (Villrreal/Villarreal) remain separate.
- Capacity default period = month-to-date using LOCAL calendar date (localTodayAsUTC) — UTC date rolled "today" forward between 19:00–24:00 Colombia.
- Trend "Capacidad Máxima" per bucket must be clipped to the period edges (bug found by fresh review, fixed + regression test).
- Open judgment calls: Proyecto filter narrows hours but keeps whole-team capacity (% reads as project share of team capacity); team-level disponibles can go negative while per-resource floors at 0 with `saturadas`; no Colombian holiday calendar (TODO in countWorkingDays); no Rol field → "Soporte".

## Accomplished
- ✅ Resumen fixes: doughnut legends, short recurso labels + full-name tooltip, .chart-box-legend, favicon.
- ✅ Capacidad view: mapper.js (JORNADA, UMBRALES, parseHHMM, ticketHours, countWorkingDays, periodCapacity, capacityStatus, resolvePeriod, buildBucketSequence, buildCapacidad), charts.js lineChart, render.js renderCapacidad, app.js view switching (localStorage last view), index.html view + filters + KPI + 3 charts + table with semáforo badges, README section.
- ✅ Tests 35/35 (node:test). Fresh adversarial review done.

## Next Steps
- User to validate numbers against real OData data and decide on: Proyecto-filter semantics, holiday calendar, Rol source.
- Possible next views: ANS compliance (time to first response vs priority SLA), per-producto drill-down.

## Relevant Files
- assets/js/mapper.js — all pure calculations for both views
- assets/js/render.js — renderResumen, renderCapacidad
- assets/js/app.js — boot, view switching, filters
- assets/js/charts.js — chart primitives incl. lineChart
- index.html — both views
- data.json — spec for capacidad view (do not modify)
- test/mapper.test.js — 35 tests

---

### Entry 10

- **id (original)**: 194
- **type**: discovery
- **title**: Documented how to run cmi-sicss project (pruebapony)
- **topic_key**: `setup/run-project`
- **created**: 2026-09-11 09:13:17

**What**: Project is a plain Node.js HTTPS server (no bundler/framework) at pruebapony/, package name cmi-sicss v0.3.0. Run with `npm start` (node server.js), serves https://localhost:3000 with self-signed certs in certs/key.pem + certs/cert.pem.
**Why**: User asked for step-by-step to run the project.
**Where**: pruebapony/server.js (PORT=3000, DATA_DIR=./data), pruebapony/db.js (better-sqlite3, data/users.db, seeds admin user on first boot and prints temp password to console), pruebapony/auth-lib.js.
**Learned**: Machine has Node v18.20.5 but package.json engines requires >=20 — works today because npm only warns and better-sqlite3 native binding was built for Node 18. On Node upgrade, `npm rebuild better-sqlite3` is needed. Tools eza/fd/bat are NOT installed on this machine (only rg works).

---

### Entry 11

- **id (original)**: 195
- **type**: session_summary
- **title**: Session summary: sofia (Capacidad y Rendimiento v2)
- **created**: 2026-09-11 11:16:18

## Goal
Implement spec v2 of the "Capacidad y Rendimiento" view (Cliente→Proyecto cascading filter, recursos multi-select, two per-resource gauges, Tailwind badges) and fix hours = 0 on live OData.

## Instructions
- User priorities unchanged: OData link, pruebapony visual language, Parametrización flow. No login.
- data.json at project root is the user's spec (v2 now); it must reflect what the user pastes.
- Reply in Rioplatense Spanish; artifacts English code / neutral Spanish UI.

## Discoveries
- Live OData feed has NO `Cliente` column (19 cols). Times "HH:MM:SS", dates ISO -05:00. parseHHMM fixed → live hours now 427.5h (Sep MTD).
- `.card{will-change:transform}` creates a stacking context per card → dropdown panels inside a card get painted over by later cards; fix `.card:has(.multi-select){position:relative;z-index:50}`.
- Tiempo_de_llamada: 78/5011 non-empty, 66 parse (minutes or 'N Hora'), 12 are garbage text → null. Most resources show "Sin datos de tiempo real" on gauge B.
- Known minor: temporalidad dia/mes auto-default only fires on first population; a very wide manual range with Diario is dense.

## Accomplished
- ✅ parseHHMM accepts seconds + live-row regression test.
- ✅ Spec v2: cliente alias detection with graceful degradation (disabled select + help text when column absent), recursos multi-select (custom checkbox dropdown), Cliente→Proyecto dependent select, dynamic consumo title/tooltip, segmentedGauge helper + two gauges with shared resource selector, buildRecursoGauges, parseTiempoLlamada, Tailwind badge classes, README updated. 47/47 tests.
- ✅ Cosmetic: dropdown z-index, chartEmptyState overlay for empty charts.
- ✅ data.json updated to spec v2.

## Next Steps
- Platform side: add `Cliente` column to OData template ID12086_Tickets_medidor → filter activates automatically.
- User to validate numbers; open decisions: team definition, holidays, Rol source, whether to drop Tendencia chart (not in v2 spec).

## Relevant Files
- assets/js/mapper.js — normalizeTickets (cliente, accent merge), buildCapacidad (recursos[], cliente, proyecto), buildRecursoGauges, parseTiempoLlamada, hasClienteColumn
- assets/js/charts.js — segmentedGauge, lineChart, chartEmptyState
- assets/js/render.js — renderCapacidad, multi-select, gauges
- assets/js/app.js — view switching, filters wiring
- index.html, assets/css/app.css — capacidad view markup/styles
- data.json — spec v2
- test/mapper.test.js — 47 tests

> Note: the "live OData has no Cliente column" finding was later superseded — the live feed now has 22 columns including `Cliente`, `Recurso_Accion`, `Estado` (see Entries 7 and 16).

---

### Entry 12

- **id (original)**: 196
- **type**: decision
- **title**: Active tickets view (active_tickets_monitor) business rules resolved with user
- **topic_key**: `sofia/views/tickets-activos-rules`
- **created**: 2026-09-11 12:33:00

**What**: User delivered JSON spec for a third view "Centro de Control de Tickets Activos" (module id active_tickets_monitor): 3 filters (Fecha_Soporte_Inicial range, Fecha_Entrega_Inicial range, requerimiento_opcion multiselect), 3 KPIs (total/servicios/calidad, COUNT_DISTINCT ID), 4 charts (h-bar recursos servicios, v-bar por cliente, h-bar por accion with colorMapping, donut por producto). Spec's original bucket rules were corrected by the user after data cross-check.
**Why**: Spec's NOT_IN rule for Calidad would have counted CIERRE as open; sample data had no recurso_accion column. User clarified via Excel columns U/V.
**Where**: Libro1.xlsx (now 22 cols, A-V), data/sample-tickets.json regenerated (4847 rows) with Cliente, Recurso_Accion, Estado.
**Learned**:
- Universe = Estado == 1 (1 activo, 2 inactivo; 2 stray rows with 3 are CREAR) AND Accion != CREAR (case-insensitive; data has "Crear"). Sample: 103 active tickets.
- Servicios = Accion IN [REALIZAR, AGENDA ENTREGA FINAL, ENTREGA FINAL, CIERRE] (88 in sample).
- Calidad = Accion IN [REVISION EN PLANTA, REVISION CALIDAD, REVISION DEV, REVISION SOLUCION, ACTUALIZA VERSION] (15 in sample). Data spells it "ACTUALIZA VERSION".
- Resource for charts = column Recurso_Accion (NOT Recurso_Soporte/Recurso_Entrega_Final).
- requerimiento_opcion column does not exist yet → filter hidden via graceful degradation.
- CIERRE with Estado=1 = pending closure (35), so CIERRE is legitimately an active state.

---

### Entry 13

- **id (original)**: 197
- **type**: architecture
- **title**: Implemented Tickets Activos view (buildActivos)
- **created**: 2026-09-11 12:54:38

**What**: Added a third dashboard view "Tickets Activos" (`data-view="activos"`) alongside Resumen/Capacidad, following strict TDD (21 new tests written before implementation, all green, 68/68 total).

**Why**: User-requested new module "Centro de Control de Tickets Activos" with confirmed business rules for active-ticket monitoring (Servicios/Calidad buckets, Recurso_Accion resource dimension).

**Where**:
- `assets/js/mapper.js` — extended `CANONICAL_ALIASES`/`normalizeTickets` with `recursoAccion` (fallback "Sin recurso"), `estado` (parsed to number via new `parseEstado()`), `requerimientoOpcion` (null when column absent, same graceful-degradation pattern as `cliente`); also added explicit `fechaSoporteInicial`/`fechaEntregaInicial` fields (un-fallback-chained, distinct from `fechaBloque1`/`fechaBloque3` used by ticketHours). Added `buildActivos(tickets, filters)` returning `{kpis:{total,servicios,calidad}, recursosServicios, porCliente, porAccion, porProducto, hasCliente, hasRequerimiento, requerimientoOptions}`.
- `test/mapper.test.js` — 21 new tests incl. an integration test against `data/sample-tickets.json` asserting total=103, servicios=88, calidad=15 (business-confirmed numbers, verified via manual node script before writing tests).
- `assets/js/charts.js` — registered `chartjs-plugin-datalabels` (new CDN dep in `index.html`, globally OFF by default via `Chart.defaults.set('plugins.datalabels',{display:false})`, opt-in per chart via `barChart(...,{dataLabels:true})`); added 10% axis `grace` when dataLabels enabled (fixes label clipping on the longest bar); added `doughnut()` `opts.legendPosition` (default unchanged 'bottom', 'right' used only for chart_tickets_producto per spec).
- `index.html`, `render.js`, `app.js` — new view section/sidebar entry, `renderActivos`/`buildActivos` wiring, lazy-render-on-view-switch pattern mirroring Capacidad's `_capacidadStale` flag (`_activosStale`).
- `README.md` — new "Vista: Tickets Activos" section documenting all business rules.

**Learned**:
- `normKey()` in mapper.js originally didn't strip diacritics before the alnum filter, so an accented alias like "Recurso_Acción" would normalize differently than "Recurso_Accion" and fail to match. Fixed by calling `stripDiacritics()` inside `normKey()` (safe — existing aliases are all ASCII, so no behavior change for them).
- Universe rule verified empirically against the sample fixture with a throwaway node script BEFORE writing tests (Estado==1 AND accionNorm!=CREAR gives exactly 103/88/15) — avoids encoding an assumption that doesn't match real data.
- Playwright E2E check done via Node 22 (nvm4w `nvm use 22.10.0`) using a cached npx playwright install at `%LOCALAPPDATA%\npm-cache\_npx\e41f203b7505f1fb\node_modules\playwright`, with `executablePath` pointed at the cached `ms-playwright\chromium-1208\chrome-win64\chrome.exe` (the npx-installed playwright's default expected revision 1228 wasn't downloaded, but 1208 worked fine via explicit executablePath). The app's `data/config.json` has a real configured OData endpoint, so page load races a live network fetch — tests must poll for either views-root or the empty-state button becoming visible, not use a fixed sleep.
- Zero console errors confirmed across Resumen/Capacidad/Activos view switching and Activos filter interaction (date filter 103→80, Limpiar restores 103) via headless screenshot verification.

---

### Entry 14

- **id (original)**: 198
- **type**: session_summary
- **title**: Session summary: sofia (Tickets Activos view)
- **created**: 2026-09-11 13:01:02

## Goal
Add the third view "Tickets Activos" (spec module id active_tickets_monitor) to the SOFIA ticket dashboard from a user-delivered JSON spec, after resolving business rules against real data.

## Instructions
- User delivers dashboard specs as JSON; business rules in the spec may be wrong — cross-check field names and bucket rules against Libro1.xlsx / sample fixture before implementing.
- Libro1.xlsx is the mirror of the live OData entity; when the user references "columna U/V" they mean the Excel, which they may have open unsaved (~$ lock file). Ask them to save, then re-read.
- Strict TDD, zero deps, no build step, Spanish UI labels, English code/comments. Not a git repo.

## Discoveries
- Excel now has 22 columns; new ones: T Cliente, U Recurso_Accion, V Estado (1 activo, 2 inactivo, 2 stray rows with 3 = CREAR).
- Final rules: universe = Estado==1 AND Accion!=CREAR (case-insensitive; data has "Crear"). Servicios = REALIZAR, AGENDA ENTREGA FINAL, ENTREGA FINAL, CIERRE. Calidad = REVISION EN PLANTA, REVISION CALIDAD, REVISION DEV, REVISION SOLUCION, ACTUALIZA VERSION. Fixture: total 103 / servicios 88 / calidad 15.
- CIERRE with Estado=1 (35 rows) = pending closure → legitimately active. Without the Estado filter CIERRE is 60% of rows (historic closed).
- requerimiento_opcion column does not exist yet → filter hidden via graceful degradation (same as Cliente).
- Fresh review caught a real bug: date-range upper bound truncated to UTC midnight while ticket date kept its time → tickets stamped 14:30 on the "hasta" day were excluded. Fixed by comparing toUTCDateOnly(ticketDate) on both sides (outsideRange helper in buildActivos). NOTE: buildCapacidad has the same comparison pattern and was NOT changed — possible latent issue there with live timestamps.
- normKey() now strips diacritics so the Recurso_Acción alias resolves; verified no existing alias collides.
- chartjs-plugin-datalabels@2.2.0 added via CDN, registered globally with display:false default; only barChart() opts in per chart.

## Accomplished
- ✅ Regenerated data/sample-tickets.json (4847 rows, 22 cols) via scripts/generate-sample.py.
- ✅ buildActivos(tickets, filters) in mapper.js + normalized fields recursoAccion/estado/requerimientoOpcion/fechaSoporteInicial/fechaEntregaInicial.
- ✅ View wired in index.html (data-view="activos"), render.js, app.js (_activosStale lazy render), charts.js (datalabels opt-in, legendPosition), README section.
- ✅ 69/69 tests green (22 new incl. fixture integration test). Headless Chromium check: zero console errors, filters work live.
- 🔲 test-runner.html (browser harness) not updated with buildActivos cases.

## Next Steps
- Verify against live OData that Estado / Recurso_Accion come with those exact names (aliases exist for variants).
- Consider applying the same calendar-day comparison fix to buildCapacidad date filters.
- Optionally sync test-runner.html with the new tests.

## Relevant Files
- assets/js/mapper.js — buildActivos + normalization aliases + outsideRange day-level date filter
- assets/js/render.js — renderActivos (filters, KPIs, 4 charts)
- assets/js/app.js — view switch + refresh wiring for activos
- assets/js/charts.js — datalabels plugin opt-in, doughnut legendPosition
- index.html — sidebar entry + activos section + datalabels CDN tag
- test/mapper.test.js — 22 new buildActivos tests
- data/sample-tickets.json — regenerated fixture with Cliente/Recurso_Accion/Estado

---

### Entry 15

- **id (original)**: 199
- **type**: config
- **title**: Added optional HTTPS to sofia-dashboard server
- **topic_key**: `infra/lan-access-port-3000`
- **created**: 2026-09-11 14:49:28 (revised 2 times)

**What**: server.js now uses https.createServer when certs/key.pem + certs/cert.pem exist, else falls back to plain http. Startup log prints localhost, 172.16.16.171 and 190.145.254.194 URLs. README updated.
**Why**: User confirmed http://190.145.254.194:3000 works from another machine (router has port-forward + NAT loopback) and wants https on that address.
**Where**: sofia/server.js (TLS_ENABLED block near line 20 and server creation near line 372), sofia/README.md, sofia/certs/ (must contain key.pem + cert.pem copied from sofia/pruebapony/certs/ — the agent sandbox denies copying .pem files, user copies manually).
**Learned**: Cert is self-signed, SAN = 190.145.254.194, 172.16.16.171, 127.0.0.1, localhost, valid until 2036-07-11; browsers show a one-time trust warning. Tests (npm test) do not import server.js. Verified HTTP fallback on PORT=3100 returns 200.

---

### Entry 16

- **id (original)**: 217
- **type**: session_summary
- **title**: Session summary: sofia (Capacidad y Rendimiento v3)
- **created**: 2026-09-13 21:37:00

## Goal
Implement spec v3 of "Capacidad y Rendimiento": Colombian holidays (Ley Emiliani), remove Tendencia chart + Rol column, gauges with local filters, drill-down of backing tickets per resource.

## Instructions
- User pastes JSON spec deltas; merge them into sofia/data.json (now has `reglas_calendario_laboral` and `modificaciones_layout`).
- Reply in Rioplatense Spanish; artifacts English code / neutral Spanish UI.

## Discoveries
- Between sessions (2026-09-11 12:30–15:00) someone (likely another session of the user) changed the repo: Libro1.xlsx regenerated → data/sample-tickets.json now 4847 rows with `Cliente`, `Recurso_Accion`, `Estado`; server.js auto-enables HTTPS when certs/key.pem+cert.pem exist (they do) → app URL is now **https://localhost:3000** (self-signed); a "Tickets Activos" view was added. Not a conflict with today's work, but be aware of concurrent edits.
- LIVE OData feed now has 22 columns incl. `Cliente`, `Recurso_Accion`, `Estado` → Cliente→Proyecto filter is active against real data.
- Holidays implemented algorithmically: easterSunday + colombianHolidays(year) cached; 2026 = 18 holidays; Aug 7 2026 is a Friday (August 2026 = 16 Mon-Thu + 3 Fri working days = 143.67h).
- Temporalidad filter removed (dead after Tendencia removal), along with buildBucketSequence/mondayOf.
- Playwright driver needs `ignoreHTTPSErrors: true` now.

## Accomplished
- ✅ Spec v3 fully implemented; 75/75 tests.
- ✅ Visual check: no Tendencia, no Rol, gauge local filters independent of main filters, drill-down accordion with footer total == Reservadas.

## Next Steps
- User to validate on real data. Open: team definition (all historical resources), Proyecto-filter % semantics.
- Possibly use `Estado`/`Recurso_Accion` new columns in future views.

## Relevant Files
- assets/js/mapper.js — colombianHolidays, countWorkingDays (holiday-aware), buildCapacidad, buildRecursoGauges({recurso,from,to}), buildRecursoTickets
- assets/js/render.js, app.js, index.html, app.css — capacidad view v3
- data.json — spec v1+v2+v3 merged
- server.js — HTTPS auto when certs/ present (changed outside this session)

> Note: the v3 drill-down accordion mentioned here was replaced by the modal in spec v4 (Entries 7 and 8).

---

### Entry 17

- **id (original)**: 222
- **type**: decision
- **title**: Switched Recuento de Tickets por Cliente chart to horizontal ranked bars
- **topic_key**: `sofia/activos-cliente-chart`
- **created**: 2026-09-14 22:10:49

**What**: chart-act-cliente (Tickets Activos view) changed from vertical bars with 45deg-rotated labels to horizontal bars, full client name on Y axis, data labels at bar end, single-hue blue ramp dark->light by rank (rankedBlue), borderRadius 3, and the .chart-box-tall wrapper height is set inline to max(340, rows*24+60)px so all clients stay legible.
**Why**: User provided a reference mockup; the rotated labels were unreadable with ~28 clients.
**Where**: assets/js/render.js (renderActivosCharts, CLIENTE_ROW_PX, rankedBlue), README.md Tickets Activos section.
**Learned**: charts.js barChart already supports horizontal + dataLabels; per-bar colors are passed as an array in backgroundColor. Inline height on the parent overrides the mobile media query for .chart-box-tall, which is intended here.

> Note: the blue ramp / borderRadius styling was later unified into the shared `LIST_BAR_*` style (Entry 20).

---

### Entry 18

- **id (original)**: 223
- **type**: decision
- **title**: Cliente normalized to UPPERCASE (merge case variants) + wrapped labels on cliente chart
- **topic_key**: `sofia/data/cliente-normalization`
- **created**: 2026-09-14 22:43:46

**What**: `normalizeCliente()` in mapper.js upper-cases Cliente and collapses whitespace so case variants of the same organisation merge ("Universidad de la Amazonia" + "UNIVERSIDAD DE LA AMAZONIA" -> 12 tickets). Accents are kept. The Tickets Activos "Recuento de Tickets por Cliente" chart wraps long names into max 2 lines of ~34 chars (`wrapLabel` in render.js) and sizes the card height from the total line count.
**Why**: User confirmed ("unificalo") after seeing duplicate clients in the chart; long names were clipped on the left by Chart.js in the half-width card.
**Where**: assets/js/mapper.js (normalizeCliente, used in normalizeTickets), assets/js/render.js (wrapLabel, CLIENTE_* constants, tooltip title joins wrapped lines), test/mapper.test.js (new merge test; 4 existing Cliente assertions updated to 'ACME'/'GLOBEX').
**Learned**: Title Case is wrong for organisation names (acronyms like E.S.P. become E.s.p.) — recursos use Title Case (people), clientes use UPPERCASE. Filter values for cliente are populated from normalized tickets, so the change is transparent to the Capacidad cliente filter. Server now serves HTTPS when certs/ exists; Playwright harness needs ignoreHTTPSErrors.

---

### Entry 19

- **id (original)**: 224
- **type**: decision
- **title**: Added CLIENTE_ALIASES table for business-confirmed client spelling variants
- **topic_key**: `sofia/data/cliente-aliases`
- **created**: 2026-09-14 22:48:45

**What**: `CLIENTE_ALIASES` map in mapper.js (applied inside normalizeCliente after upper-casing) merges spelling variants that are the same client. First entry: 'E.S.P. HIDROELÉCTRICA ITUANGO S.A. - HIDROITUANGO S.A. E.S.P' -> 'HIDROELÉCTRICA ITUANGO S.A. E.S.P.' (user confirmed same client; 5+2 = 7 tickets).
**Why**: User asked to unify; upper-casing alone cannot merge different strings. Explicit table chosen over fuzzy matching to avoid accidental merges.
**Where**: assets/js/mapper.js (CLIENTE_ALIASES, normalizeCliente), test/mapper.test.js.
**Learned**: Keys must be the already upper-cased, whitespace-collapsed value. Add rows only on business confirmation. See [[sofia/data/cliente-normalization]].

---

### Entry 20

- **id (original)**: 225
- **type**: pattern
- **title**: Shared LIST_BAR_* style for the two ranked-list charts in Tickets Activos
- **topic_key**: `sofia/views/activos-cliente-chart`
- **created**: 2026-09-14 23:01:12 (revised 2 times)

**What**: User sent SYNC_CHART_STYLES (cliente chart must match recursos chart). Extracted shared constants in render.js — LIST_BAR_COLOR (#0284C7), LIST_BAR_DATASET (12px bars, no radius), LIST_BAR_LAYOUT (padding 10/30/10/10), LIST_BAR_CATEGORY_AXIS (no grid, axis line #0284C7 1.5px, ticks 10.5px #334155 padding 12), LIST_BAR_VALUE_AXIS (grid #E2E8F0, ticks 11px #64748B, integer), LIST_BAR_DATA_LABELS (outside right, #1E293B 11px) — and applied them to BOTH chart-act-recursos-servicios and chart-act-cliente. Cliente keeps its extras: scroll list (10 visible rows x 28px), truncateLabel + fitLabelToScale on the y ticks, full name tooltip, x-axis title. charts.js barChart now accepts opts.layout.
**Why**: One component look; a single place to change list-bar styling.
**Where**: assets/js/render.js, assets/js/charts.js.
**Learned**: Deliberately did NOT apply the spec's fontFamily (Segoe UI stack): the whole dashboard uses Inter via Chart.defaults.font.family; changing two charts only would break consistency. Flagged to user.

---

## Open items carried over (as of the last recorded session)

- Validate Capacidad numbers on real data; decide Proyecto-filter % semantics and team definition (all historical resources).
- `buildCapacidad` still compares date-range bounds with the pre-fix pattern that `buildActivos` corrected (`toUTCDateOnly` on both sides) — possible latent off-by-a-day with live timestamps.
- `test-runner.html` (browser harness) was not updated with the `buildActivos` cases.
- `requerimiento_opcion` column does not exist in the feed yet; the filter stays hidden until it appears.
- Add rows to `CLIENTE_ALIASES` only after business confirmation.

## Environment notes for the new machine

- Node 18 works for the app itself (`npm start`, `npm test`); Node >= 20 is only needed for Playwright visual checks.
- `certs/key.pem` + `certs/cert.pem` are not committed; copy them manually if HTTPS is wanted. Without them the server falls back to `http://localhost:3000`.
- `data/config.json` holds OData credentials; recreate it through the Parametrización panel rather than copying it around.
- Use `PORT=3001` for agent-driven checks so it does not collide with the user's running server on 3000.
