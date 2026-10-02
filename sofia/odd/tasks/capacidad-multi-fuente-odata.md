# Feature: Capacidad y Rendimiento — unificación multi-fuente OData

## Objective
`Capacidad y Rendimiento` currently computes "Horas Reservadas" per recurso
from a single source (the `Tickets` OData entity, `ID12086_Tickets_medidor`,
`mapper.js:buildCapacidad`). Extend it to unify hours-per-recurso across
**five** OData entities, all served through the SAME already-configured
OData connection (base URL + credentials in `data/config.json`), so the
capacity/utilization numbers reflect ALL time a consultant has booked, not
just support tickets.

## Correction of the original request's premise
The user's original ask assumed Capacidad reads from a static local Excel.
Verified false: `app.js`/`server.js` show every view (Resumen, Capacidad,
Activos, Segundo Nivel) already shares one `tickets` array loaded from the
live OData proxy (`/odata-proxy`), configured via the Parametrización panel.
`Libro1.xlsx` only feeds the offline "Cargar datos de ejemplo" demo button.
The five `.xlsx` files in the project root (`Libro1.xlsx`, `Tarea.xlsx`,
`Tarea con revisión.xlsx`, `Capacitaciones.xlsx`, `Seguimiento cliente.xlsx`)
were given only as a reference for column structure — the user confirmed
implementation must target the real OData entities, not read these files at
runtime.

## Confirmed OData entities (user-confirmed template names)
| Fuente | Template OData | Campo recurso | Fecha inicial | Fecha final | Horas |
|---|---|---|---|---|---|
| Tickets (ya existente) | `ID12086_Tickets_medidor` | `Recurso_Soporte` | `Fecha_Soporte_Inicial`/`Fecha_Entrega_Inicial` (bloques 1/3) | — | `Hora_Cal_Inicial`/`Hora_Cal_Final` (+ bloque 3) |
| Tarea | `ID12097_Plantilla_tarea` | `Recurso` | `Fecha_Inicial` | `Fecha_Final` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Tarea con revisión | `ID12096_Plantilla_tarea_con_rev` | `Funcionario_que_Resuelve` | `Fecha_Incio` (sic, typo in the real column name — verify against the live OData response, not assumed) | `Fecha_Final` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Seguimiento cliente | `ID12098_Plantilla_seguimiento_c` | `Responsable_de_Seguimiento` | `Fecha_Inicial` | `Fecha_Final` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Capacitación | `ID12095_Plantilla_capacitacion` | `_Colaborador_en_formacion` | `Fecha_Inicial` | `Fecha_Final` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |

None of the 4 new entities expose an `Estado`/`Accion`-style column in their
Excel reference (only ID + resource + 2 date + 2 hour columns) — there is no
"active" filter to apply to them; every row with a valid date+hour block in
period counts. If the live OData response for any of them turns out to
carry more columns than the Excel reference, that's fine (extra columns are
simply ignored) — but if `Fecha_Incio`/`Fecha_Inicial`/`Hora_Cal_Inicial`/
`Hora_Cal_Final` are missing or renamed on the real feed, STOP and report
back rather than guessing new field names.

## Architecture decision (orchestrator's call, disclosed — not asked as a
question because it's forced by the existing design, not a genuine
ambiguity)
- **No `server.js` changes.** `handleODataProxyGet` already accepts
  `?url=<full target url>`, validates the host against the existing
  `ALLOWED_ODATA_HOSTS` allowlist, and always signs the request with the
  credentials from `data/config.json` regardless of which URL is passed
  (`server.js:342-351`, `performODataRequest` at `server.js:175`). The
  browser already receives `endpointUrl` (not the password) via
  `GET /api/config` (`server.js:252-256`), so a new client-side module can
  build each extra entity's full URL (`endpointUrl + '/' + templateName`)
  and call `/odata-proxy?url=...` the same way `fetchTemplate()` already
  calls it for Tickets.
- **Fetch cadence**: the 4 extra sources are fetched in parallel with
  Tickets, once per "Actualizar Datos" click (same trigger as today) — NOT
  refetched on every Desde/Hasta change. Desde/Hasta stay a pure client-side
  filter over already-loaded data, exactly like every other filter in this
  app today. Use `$select` (only the ~5-6 needed columns per entity) to keep
  payload small; do not add `$filter` by date — introducing server-side
  date filtering would mean a network round-trip on every date-range edit,
  which breaks the instant-filter UX every other view in this app already
  relies on.
- **Team membership**: extend the existing "team = every distinct recurso
  across the whole dataset" rule (README "Supuestos" #1, already
  established for Tickets alone) to the union of all 5 sources — a
  consultant with only Capacitación hours and zero tickets must still
  appear in `porRecurso`, otherwise their hours are silently invisible.
- **Cliente/Proyecto filters**: the 4 extra sources have no Cliente/Proyecto
  columns, so they are structurally exempt from those two filters (not a
  choice — the data doesn't have the field). They ARE still subject to the
  Recursos filter and the Desde/Hasta period, exactly like ticket rows.
- **Resource-name alignment**: extra-source resource values MUST go through
  the same `normalizeRecurso()` (mapper.js:177) Title-Case + accent-fusion
  pipeline Tickets already uses (`resolveRecursoDisplayNames`,
  mapper.js:224), extended to consider names from all 5 sources together —
  otherwise "Juan Perez" from Tarea and "Juan Pérez" from Tickets become two
  separate, wrong rows instead of summing into one consultant.
- **Degradation**: if OData isn't configured, or any single extra-source
  fetch fails/times out, do not fail the whole Capacidad view — skip that
  source's contribution and show a small non-blocking notice (mirrors the
  existing "no Cliente column" degradation pattern), never silently
  under-report without any indication. Sample-data mode (no OData
  configured) simply has zero extra-source rows — no local fixture exists
  for these 4 entities and none should be invented.

## Implementation
1. **`assets/js/data-sources.js`** (new file, same IIFE/`window.SOFIA_*`
   module pattern as every other `assets/js/*.js`): a small registry
   (`CAPACIDAD_EXTRA_SOURCES`, the 4-row table above) + a generic
   `fetchExtraSource(endpointUrl, sourceDef)` (builds the `$select` URL via
   `SOFIA_ODATA.buildTemplateUrl`-style helper, calls
   `SOFIA_ODATA.getJson('/odata-proxy?url=' + encodeURIComponent(url))`,
   `SOFIA_ODATA.toRows()`) + `normalizeExtraRow(raw, sourceDef)` returning
   `{ recursoRaw, fecha, horas, fuente }` (single hour-block, same formula
   as `ticketHours`'s block 1: `Hora_Cal_Final − Hora_Cal_Inicial` when both
   present and final > inicial, dated by the entity's own Fecha_Inicial
   field). Export a `fetchAllExtraSources(endpointUrl)` that
   `Promise.all`s the 4 fetches, tolerating individual failures (see
   Degradation above), and returns `{ rows, failedSources }`.
2. **`assets/js/mapper.js`**:
   - `buildCapacidad(tickets, filters, extraRows)` — new optional 3rd
     param, an array of `{ recurso, fecha, horas, fuente }` already run
     through `normalizeRecurso`. Merge into the same `rows`/team-building
     logic per the rules above. Keep `buildCapacidad(tickets, filters)`
     (2-arg call) working unchanged (`extraRows` defaults to `[]`) — every
     existing call site and test keeps passing.
   - Extend `resolveRecursoDisplayNames` usage (or the call site that
     builds it) to run over the UNION of `tickets` recurso names and
     `extraRows` recurso names, so accent/casing fusion is consistent
     across all 5 sources.
   - `buildRecursoTickets` (drill-down source rows, mapper.js:907) gains a
     `fuente` column so the modal can show whether an hour came from a
     Ticket, Tarea, Tarea con Revisión, Seguimiento Cliente, or
     Capacitación — this directly answers the original ask ("modal con el
     desglose de los tickets exactos... que sustentan las horas
     calculadas") now that "las horas" can come from 5 places, not 1.
3. **`assets/js/app.js`**: on "Actualizar Datos", after `fetchTemplate()`
   resolves, also call `fetchAllExtraSources(cfg.endpointUrl)` (fetch
   `GET /api/config` first if `endpointUrl` isn't already held client-side)
   in parallel; store the combined `extraRows` alongside `_currentTickets`
   and pass them into every `buildCapacidad(...)` call site in `render.js`.
   Sample-data mode: `extraRows = []`.
4. **`assets/js/render.js`**: thread `extraRows` through to
   `buildCapacidad`; render the new `fuente` column in the drill-down
   modal table (`DRILLDOWN_COLUMNS`, render.js:638); if `failedSources` is
   non-empty, show a small dismissible notice in the Capacidad view (do not
   block rendering).
5. **`test/mapper.test.js`**: unit tests for `normalizeExtraRow` (block
   formula, missing/invalid hour handling), for `buildCapacidad` with a
   synthetic `extraRows` array (resource appears only via `extraRows` and
   still shows in `porRecurso`; hours from `extraRows` add to `reservadas`;
   Cliente/Proyecto filters don't drop `extraRows` contributions), and for
   the accent-fusion extension.
6. **`README.md`**: document the 5-source unification under "Vista:
   Capacidad y Rendimiento" (new subsection), listing the entities/fields
   table above and the fetch-cadence/degradation rules.

## Constraints
- No git repository in this working directory — implement directly.
- Never write the OData credentials (`authUser`/`authPass` in
  `data/config.json`) into any new file, log, comment, or the README.
- No TDD mode configured; run `npm test` after implementation.
- No build step, zero npm dependencies — stay consistent with the existing
  vanilla JS / Chart.js CDN / IIFE module stack.
- Do not touch Resumen, Tickets Activos, or Segundo Nivel de Atención —
  this task is scoped to Capacidad y Rendimiento only.

## Status
- [x] `assets/js/data-sources.js` — registry + fetch + normalize + tolerant
      `fetchAllExtraSources`.
- [x] `mapper.js` — `buildCapacidad` 3rd param, team-membership union,
      accent-fusion across sources, `buildRecursoTickets` `fuente` column.
- [x] `app.js` — fetch extra sources alongside Tickets on "Actualizar
      Datos", store + thread `extraRows`.
- [x] `render.js` — thread `extraRows` into `buildCapacidad` calls, drill-
      down `fuente` column, non-blocking partial-failure notice.
- [x] `test/mapper.test.js` — new tests (see Implementation #5).
- [x] `README.md` — new subsection under Capacidad y Rendimiento.
- [x] Run `npm test`, report actual pass/fail (103/103 passing, see report).

## Verification
- `npm test` (must pass, including new tests, and the existing
  `buildCapacidad`/`buildRecursoTickets` tests must keep passing
  unmodified in behavior for the 2-arg / no-extra-sources case).
- Manual sanity (cross-reading, no browser available to the writer): every
  new client fetch call target, element ID, and function signature change
  is consistent across the files it touches.
