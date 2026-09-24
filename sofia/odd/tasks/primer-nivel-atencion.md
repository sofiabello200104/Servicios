# Feature: "Tickets Activos" → "Primer Nivel de Atención" (rename + Recurso filter + drill-down table/panel)

## Objective
Rename the existing "Tickets Activos" view to "Primer Nivel de Atención" (to
pair with the already-existing "Segundo Nivel de Atención") and extend it
with: a Recurso multiselect filter that narrows the whole view, and a new
bottom two-column section (paginated table + summary panel) driven by
clicking a bar in "Tickets Abiertos por Recurso (Servicios)" — the exact
same click-to-select interaction pattern already built for Segundo Nivel de
Atención (`_snSelectedResource` / bar `onClick` / `rerenderSegundoNivelWithCurrentFilters`
in `render.js`), applied here as a new, analogous set of functions.

Source: a UI-schema JSON the user pasted (`UPDATE_DASHBOARD_STRUCTURE_AND_LAYOUT`
v1.2.0) — a layout reference, not itself code, same role the earlier
Segundo Nivel schema played.

## Naming scope (orchestrator's call, disclosed)
The schema's `header.renameModule` only names the topbar title
(`VIEW_META.activos.title`, currently "Centro de Control de Tickets
Activos" → "Primer Nivel de Atención"). It says nothing about the sidebar
nav label, which today is the shorter "Tickets Activos"
(`index.html` `data-view="activos"` link text) — deliberately different
from the topbar title per the existing README convention. Given the
explicit intent to pair this view with "Segundo Nivel de Atención" (whose
sidebar label and topbar title are identical), rename the sidebar label to
"Primer Nivel de Atención" too, so the sidebar reads consistently next to
"Segundo Nivel de Atención". Flag this in the final report — it's a
judgment call, not literally in the schema, easy to revert if wrong.

The view's internal id/keys (`data-view="activos"`, `VIEW_META.activos`,
`activos-content`, `chart-act-*`, `filter-act-*`, `_act*` JS state, the
`buildActivos` function name) all STAY as `activos`/`act*` — only
user-visible label text changes. Do not rename internal identifiers; that
would be a pure-churn rename with no behavior value and high diff risk for
zero benefit.

## Current state (verified in code, so the writer doesn't have to
re-discover it)
- Activos already has: KPI row, 4 charts (recursos-servicios bar, cliente
  bar, accion-general bar, producto donut), and filters:
  `Fecha Soporte Inicial` desde/hasta, `Fecha Entrega Inicial` desde/hasta,
  and a searchable "Requerimientos / Opciones" custom multiselect
  (`filter-act-requerimientos-*`, hidden entirely when the column is
  absent) — see `index.html:318-353`, `render.js:1030-1124`
  (`populateActivosFilters`/`readActivosFilters`/the multiselect wiring
  functions above them).
- It has NO per-ticket row list today — `buildActivos` (mapper.js:1090-1170)
  only returns aggregated counts (`kpis`, `recursosServicios`, `porCliente`,
  `porAccion`, `porProducto`). It has NO table, NO summary/insight panel,
  NO pagination anywhere in the app yet, and NO Recurso filter.
- `Asunto` does not exist on any real ticket record (confirmed absent
  during the Segundo Nivel task) — same graceful "—" degradation applies
  here, already established at `render.js`'s `SN_TABLE_COLUMNS`/`snRowsHtml`
  for Segundo Nivel; mirror that exact convention, don't re-litigate it.
- Segundo Nivel de Atención's click-to-select bar chart + filtered table +
  insight panel (`render.js`, roughly lines 1100-1350: `_snSelectedResource`,
  the `onClick` handler on `chart-sn-recurso`'s `barChart()` call,
  `SN_TABLE_COLUMNS`, `snRowsHtml`, `rerenderSegundoNivelWithCurrentFilters`)
  is the direct, load-bearing precedent for this task's new bottom section —
  read it in full before writing the new one; reuse its shape, don't
  reinvent it.

## Changes

### 1. Rename (header)
- `app.js`: `VIEW_META.activos.title` → `'Primer Nivel de Atención'`
  (crumb stays `'Panel'`, matching the schema's `"tag": "PANEL"`).
- `index.html`: the `data-view="activos"` sidebar link text →
  `'Primer Nivel de Atención'` (see "Naming scope" above).

### 2. New filter: Recurso (multiselect, searchable, "select all"), above
the date filters
- Same custom widget pattern as `filter-act-requerimientos-*`
  (`index.html`) — copy its markup structure for a new
  `filter-act-recurso-*` block, placed BEFORE the 4 date inputs in the
  filters row/grid.
- `targetField` is `recurso_accion` → `t.recursoAccion`, same field every
  other Activos chart already uses. Options = every distinct
  `recursoAccion` in the active universe (mirrors
  `requerimientoOptions`'s "whole universe, not narrowed by current
  filters" rule already established in `buildActivos`).
- `buildActivos(tickets, filters)` gains `filters.recursos: string[]`
  (`isAllSelector` semantics, same helper already used by
  Capacidad/Segundo Nivel) that narrows `filtered` (mapper.js:1125-1130)
  BEFORE the kpis/recursosServicios/porCliente/porAccion/porProducto
  aggregation loop — the schema's `affects` list (KPIs, both bar charts,
  the new table, the new summary panel) is just "the whole computed
  output", since everything already derives from `filtered`.
- `buildActivos(tickets, filters)` (2-arg, no recursos filter) must keep
  behaving identically — `filters.recursos` defaults to no-op
  (`isAllSelector` already treats empty/`['all']` as no filter).

### 3. `buildActivos` gains a per-ticket `rows` array
For the new table: `{ id, recursoAccion, cliente, producto, accion,
asunto }` for every ticket in `filtered` (post Recurso/date/requerimiento
filters) — `asunto` always `null` (degrades to "—" in the UI, per "Current
state" above; do not invent an `Asunto` field on `normalizeTickets` — it
was already confirmed absent from the real feed).

### 4. Bottom section: 70/30 grid, two new components
- **`table_detalle_tickets`** → "Requerimientos de Primer Nivel": columns
  ID / Recurso / Cliente / Producto / Accion / Asunto (same column set and
  "—" degradation as Segundo Nivel's `SN_TABLE_COLUMNS`/`snRowsHtml` — copy
  that pattern, don't redesign it). Rows = `buildActivos` result's `rows`,
  filtered further by the currently-selected resource (from the bar click
  below) when one is selected, otherwise the whole filtered universe.
  **Paginated**: 10 rows/page, "Mostrando X–Y de N" total label, Prev/Next
  controls. This is the first paginated table in the app — keep the pager
  a small, local implementation scoped to this table (a page-index module
  variable + slice + render Prev/Next/label), not a generic/reusable
  component; nothing else in the app needs pagination yet, and building a
  generic one now would be speculative.
- **`card_resumen_recurso`** → "Detalle del recurso seleccionado": default
  state shows the schema's exact placeholder message when no resource is
  selected. Active state (a resource is selected via the bar chart click)
  shows: Recurso Seleccionado (the label), Total Tickets en Realizar
  (count of that recurso's tickets in `filtered` where `accionNorm ===
  'REALIZAR'`), Total Tickets en Entrega Final (same, `accionNorm ===
  'ENTREGA FINAL'`), Total Asignados (Servicios) (the same count already
  shown by that resource's bar in `recursosServicios` — read it from
  there, don't recompute it separately). Visual style: same card/metric-
  list look already established for Segundo Nivel's insight panel and the
  very first "Puntos de Análisis" reference schema from this project's
  early conversation — a `card` with a title, a stat line, and a small
  metric list; no narrative sentence this time (the schema has no
  `narrative_box` for this panel, unlike Segundo Nivel's).
- **Trigger**: clicking a bar in `chart-act-recursos-servicios` (the
  "Tickets Abiertos por Recurso (Servicios)" chart) selects/deselects that
  resource — exact same toggle-on-second-click behavior as
  `_snSelectedResource` in Segundo Nivel (click same bar again →
  deselect). Selecting resets the table's pagination to page 1. This
  chart currently has no `onClick` (`render.js`'s `renderActivosCharts`,
  first chart) — add one, mirroring Segundo Nivel's exactly
  (`charts.js`'s `barChart()` already supports an `onClick` option, added
  during the Segundo Nivel task — reuse it, don't add a second mechanism).

## Files to touch
- `assets/js/mapper.js` — `buildActivos`: `filters.recursos`, `rows`
  output.
- `assets/js/render.js` — rename is in `app.js`, not here; new
  `renderActTable`/`renderActResumenPanel` (names illustrative, match
  existing file's naming conventions), Recurso filter populate/read/wire
  (mirror `populateActivosFilters`/`readActivosFilters`/
  `wireActRequerimientosMultiSelect`), bar `onClick` wiring, pagination
  state + controls.
- `app.js` — `VIEW_META.activos.title` rename only.
- `index.html` — sidebar label rename; new Recurso filter markup (above
  the date filters); new 70/30 bottom section markup (table + summary
  panel containers) inside `#activos-content`.
- `test/mapper.test.js` — tests for `buildActivos`'s new `recursos` filter
  (narrows kpis/charts/rows together; 2-arg call unaffected) and `rows`
  output (shape, Asunto always "—"/null, matches the filtered universe).
- `README.md` — update the "Vista: Tickets Activos" section's title to
  "Vista: Primer Nivel de Atención" (keep internal references to
  `data-view="activos"` accurate) and document the new filter + bottom
  section, mirroring how the Segundo Nivel section documents its own
  click-to-select table/panel.

## Constraints
- No git repository — implement directly.
- No TDD mode configured; run `npm test` after implementation.
- No build step, zero npm dependencies — stay consistent (vanilla JS,
  Chart.js CDN, IIFE modules).
- Do not touch Resumen, Capacidad y Rendimiento, or Segundo Nivel de
  Atención — scoped to this view only. Do not rename internal
  `activos`/`act*` identifiers (see "Naming scope" above) — user-visible
  text only.
- Reuse existing patterns exactly (multiselect widget, click-to-select bar
  chart, table column "—" degradation) rather than inventing new ones —
  this view is explicitly meant to feel like Segundo Nivel's sibling.

## Status
- [x] Rename topbar title (`app.js`) + sidebar label (`index.html`).
- [x] `buildActivos`: `filters.recursos` (narrows the whole output) +
      `rows` (per-ticket, for the table).
- [x] Recurso multiselect filter markup + populate/read/wire (`index.html`
      + `render.js`), positioned above the date filters.
- [x] Bottom 70/30 section markup (`index.html`): table + summary panel.
- [x] Table render + pagination (`render.js`).
- [x] Summary panel render, default/active states (`render.js`).
- [x] Bar `onClick` on `chart-act-recursos-servicios` (toggle select,
      resets table to page 1, drives table + panel).
- [x] `test/mapper.test.js` — new tests for `recursos` filter + `rows`.
- [x] `README.md` — section retitled + new behavior documented.
- [x] Run `npm test`, report actual pass/fail — 107/107 passing.

Note: the delegated writer agent stalled mid-task after finishing
`app.js`/`mapper.js`/`render.js` (all correct and complete) but before
touching `index.html`/`test/mapper.test.js`/`README.md`. The orchestrator
completed the remaining `index.html` markup (Recurso filter block + bottom
70/30 table/panel section, matching the exact element IDs already wired in
`render.js`), added the missing tests (adjusting two assumed-uppercase
assertions to match `recursoAccion`'s actual no-case-transform behavior,
caught by the first `npm test` run), and wrote the README subsection
directly, rather than re-delegating.

## Verification
- `npm test` (must pass, including new tests; every existing test for
  `buildActivos` keeps passing for the 2-arg / no-recursos-filter case).
- Manual sanity (cross-reading, no browser available to the writer): every
  new element ID referenced in `render.js` exists in `index.html` and vice
  versa; the bar `onClick` option is passed the same way Segundo Nivel's
  is (confirm against the actual current `charts.js` `barChart()` options
  shape, don't assume from memory).
