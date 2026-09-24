# Feature: Segundo Nivel de Atención (4th dashboard view)

## Objective
Add a fourth view to the SOFIA dashboard ("Resumen" / "Capacidad y Rendimiento" /
"Tickets Activos" already exist), titled "Segundo Nivel de Atención", following
the exact same architecture as the existing views (pure `mapper.js` build
function, `render.js` formats/draws only, sidebar nav item, `app.js` wiring).

## Why
User wants a dedicated operational view scoped to second-level-support
requerimientos, filterable by resource, with the same KPI/chart/table/insight
layout already sketched in a JSON UI schema they provided (not itself a code
artifact — used here only as a layout reference).

## Business rule (confirmed with user)
Full `Accion` catalog: CREAR, REALIZAR, REVISION CALIDAD, REVISION DEV,
REVISION SOLUCION, ACTUALIZAR VERSION, AGENDA ENTREGA FINAL, ENTREGA FINAL,
CIERRE.

**Segundo Nivel universe** = tickets where `accionNorm` (already computed by
`normalizeTickets`) is in:
`['REVISION CALIDAD', 'REVISION DEV', 'REVISION SOLUCION', 'ACTUALIZA VERSION', 'ACTUALIZAR VERSION']`
(`ACTUALIZAR VERSION` is the existing alias of `ACTUALIZA VERSION` — same list
as `ACTIVOS_CALIDAD_ACCIONES` in `mapper.js:958` **minus** `REVISION EN
PLANTA`, which the user did not include in the second-level catalog).

Reuse the same "active" gate `Tickets Activos` uses (`mapper.js:997`,
`t.estado === 1`) combined with the Accion set above — do not invent a new
Estado convention.

## Filters
- **Recurso** (`Recurso_Accion`): free multi-select, no restriction, same
  custom checkbox multi-select widget pattern already used for "Recursos" in
  Capacidad y Rendimiento (not a native `<select multiple>`).
- **Accion**: single-select dropdown, options constrained to the 5-value
  second-level set above (no "Todas" that leaks outside the universe).

## Layout (adapted from the reference JSON schema to this codebase's idioms —
Chart.js via `charts.js` helpers, vanilla JS, Tailwind classes already used
elsewhere, no new libraries)
1. KPI card: total requerimientos in the (filtered) universe.
2. Horizontal bar chart: tickets by `Recurso_Accion`, clickable bars — click
   selects/deselects a resource and filters the table + insight panel below
   (reuse the ranked-bar-chart look from `renderActivosCharts`, add an
   `onClick` handler since Activos charts don't have one today).
3. Column chart: tickets by `Cliente` (top 10).
4. Donut: tickets by `Diagnostico`.
5. Donut: tickets by `Producto`.
6. Data table: ID, Recurso, Cliente, Producto, Accion, Asunto — filtered by
   selected resource (from bar click) and the Accion dropdown.
7. Insight panel next to the table: total for the selected resource, top
   producto/diagnóstico/acción for that resource, one narrative sentence.

If the live dataset lacks a `Diagnostico` field (verify via
`normalizeTickets`/sample data before building the donut), degrade the same
way the `Cliente` column degrades elsewhere (`hasClienteColumn` pattern) —
do not silently render an empty/misleading chart.

## Files to touch
- `assets/js/mapper.js` — pure `buildSegundoNivel(tickets, filters)`.
- `assets/js/render.js` — `renderSegundoNivel`, filter population/read,
  chart click wiring, table + insight panel rendering.
- `assets/js/charts.js` — only if a genuinely new chart helper is needed;
  prefer reusing existing helpers.
- `index.html` — sidebar nav item (`data-view="segundo-nivel"` or similar),
  new view container markup.
- `assets/js/app.js` — `VIEW_META` entry, stale-flag + switchView wiring
  (mirror the existing `activos` handling).
- `test/mapper.test.js` — unit tests for `buildSegundoNivel` (universe
  filter, per-resource counts, Cliente/Diagnostico/Producto grouping),
  using `data/sample-tickets.json` for an integration-style count assertion
  like the existing Activos test.
- `README.md` — new "Vista: Segundo Nivel de Atención" section (mirror the
  existing view sections' structure/tone).

## Constraints
- No git repository in this working directory — implement directly, no
  branch/commit step.
- No TDD mode configured for this project; run `npm test`
  (`node test/mapper.test.js`) after implementation as the functional check,
  not a RED-first cycle.
- No build step, zero npm dependencies — stay consistent (plain Chart.js CDN
  already loaded, vanilla JS, IIFE module pattern already used in every
  `assets/js/*.js` file).
- Match existing code style exactly (var vs let/const usage, comment
  density, Spanish UI copy / English code identifiers — see Persona Scope:
  UI strings can be Spanish since the whole existing app's UI is Spanish,
  but identifiers/comments stay English).

## Status
- [x] Explore existing Activos/Capacidad view code as the concrete pattern
      to mirror (already partially done by orchestrator: see accion alias
      list at `mapper.js:957-973`, nav pattern at `index.html:40-48`,
      view-switch pattern at `app.js:17,64-141`).
- [x] Implement `buildSegundoNivel` in `mapper.js` + tests.
- [x] Implement `renderSegundoNivel` in `render.js` (KPI, 4 charts with bar
      click-to-filter, table, insight panel).
- [x] Wire nav item + view container in `index.html`.
- [x] Wire view switching + stale-refresh in `app.js`.
- [x] Update `README.md`.
- [x] Run `npm test` and report actual pass/fail.

## Verification
- `npm test` (must pass, including new `buildSegundoNivel` tests).
- Manual sanity: open `index.html` (or `npm start`), load sample data, switch
  to the new view, confirm KPI/charts/table populate and the bar-click →
  table/insight filter interaction works.
