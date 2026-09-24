# Rediseño de la vista Resumen

## Objetivo

Reemplazar la vista "Resumen" actual (filtros Año/Mes + Proceso + Producto,
KPIs de cerrados/backlog, 5 gráficos + tabla de últimos tickets) por el
diseño especificado por el usuario: 4 filtros globales, 4 tarjetas KPI con
sparkline, 2 gráficos de barras horizontales.

## Por qué

El usuario pegó un JSON de spec para el módulo "Resumen" y pidió
implementarlo. El mapeo exploratorio (ver decisiones abajo) confirmó que
`data.json` no tiene un bloque de spec propio para Resumen hoy (el bloque
`especificacion_ui_dashboard` describe en realidad "Capacidad y
Rendimiento"), y que varios campos del spec nuevo no existen tal cual en el
modelo de datos — se resolvieron con el usuario antes de escribir código.

## Decisiones confirmadas con el usuario

1. **Alcance: REEMPLAZAR**, no agregar. La vista Resumen pasa a ser
   exactamente lo que describe el spec nuevo.
2. **"Total Tickets Activos"** = `estado === 1` (misma regla que ya usan
   Primer y Segundo Nivel de Atención vía `parseEstado`/`ticket.estado`).
3. **"Tickets en Calidad"** = mismo set de acciones que el bucket "Calidad"
   de Primer Nivel de Atención (`accionNorm` en `REVISION EN PLANTA`,
   `REVISION CALIDAD`, `REVISION DEV`, `REVISION SOLUCION`,
   `ACTUALIZA VERSION`/`ACTUALIZAR VERSION`).

## Decisiones técnicas (mecánicas, sin ambigüedad de negocio)

- Cada tarjeta KPI aplica **solo sus propias condiciones** (tal como lista
  el spec) sobre el universo ya filtrado por los 4 filtros globales — no
  hereda el filtro de "activos" de otra tarjeta salvo la suya propia
  (`card_quality_tickets`/`card_implementation_tickets`/
  `card_maintenance_tickets` no filtran por `estado`, solo por su condición
  listada).
- `Proceso` en los datos viene en Title Case con tilde (`"Implementación"`,
  `"Mantenimiento"`), no en mayúsculas sin tilde (`IMPLEMENTACION`,
  `MANTENIMIENTO`) — normalizar acento/mayúsculas al comparar contra las
  condiciones del spec.
- **Filtro "Rango de Fechas"** (date range picker) y **"Periodos"** (select
  YYYY-MM mensual) son independientes y se combinan con AND sobre
  `ticket.fecha` — si hay período elegido, restringe a ese mes; si además
  hay rango, intersecta.
- `chart_top_clients`: dimensión `cliente` (agregar el mismo overlay
  "sin datos" vía `hasClienteColumn()` que ya usan Primer/Segundo Nivel
  cuando la columna Cliente no existe en el feed).
- `chart_top_tier_2_agents`: dimensión `recursoSoporte` (tal como pide el
  spec, no `recursoAccion`), filtrado a tickets cuyo `accionNorm` esté en
  el set de "Segundo Nivel" (`SEGUNDO_NIVEL_ACCIONES` ya existente en
  `mapper.js`, reusar sin duplicar la lista).
- Sparklines de las 4 tarjetas: serie mensual del conteo de esa tarjeta
  (mismo patrón que `monthlySeries` ya calcula hoy), usando el helper
  `lineChart` de `charts.js` (existe pero está sin uso desde que se quitó
  "Tendencia de horas" de Capacidad) en modo minimal (sin ejes/leyenda).
- `data.json`: agregar un bloque de spec propio para Resumen (filtros,
  tarjetas, gráficos) siguiendo el mismo patrón que ya existe para
  Capacidad, para no dejar la vista sin documentación de referencia como
  está hoy.

## TDD

Modo: **estricto, confirmado por convención del proyecto** (encabezado de
`test/mapper.test.js`: "written BEFORE the implementation (strict TDD)").
Runner: `node --test` / `npm test` (node:test, sin dependencias).
Orden: RED (tests nuevos para el `buildResumen` rediseñado, deben fallar)
→ GREEN (implementación mínima que los pasa) → REFACTOR.

## Tareas

- [ ] T1 — Tests RED en `test/mapper.test.js` para el `buildResumen`
      rediseñado: las 4 tarjetas (activos/calidad/implementación/
      mantenimiento) con sus condiciones exactas, `monthlySeries` por
      tarjeta para sparklines, `topClientes` (top 10), `topRecursosSegundoNivel`
      (top 10, dimensión recursoSoporte, filtrado a acciones de 2do nivel),
      combinación de filtros Rango de Fechas + Periodo + Proceso + Producto.
- [ ] T2 — Implementación GREEN en `assets/js/mapper.js`: reescribir
      `buildResumen(tickets, filters)` para devolver las 4 tarjetas + 2
      series de top-10 + sparklines mensuales, filtros nuevos.
- [ ] T3 — `index.html`: rediseñar el markup de `#resumen-content` — 4
      filtros (rango de fechas, período YYYY-MM, proceso, producto), 4
      contenedores de tarjeta con canvas de sparkline, 2 contenedores de
      gráfico de barras horizontales. Quitar markup de los 5 gráficos/tabla
      viejos que ya no aplican.
- [ ] T4 — `assets/js/render.js`: reescribir `renderResumen` — wiring de
      los 4 filtros nuevos, render de las 4 tarjetas con sparkline
      (`lineChart` minimal), los 2 `barChart` horizontales, overlay
      "sin datos" en `chart_top_clients` si `!hasCliente`.
- [ ] T5 — `assets/js/app.js`: actualizar wiring de filtros si cambian los
      ids (`filter-periodo` → nuevo esquema rango+período).
- [ ] T6 — `data.json`: agregar bloque de spec para `resumen` (filtros,
      tarjetas_kpi, graficas) siguiendo el patrón existente de Capacidad.
- [ ] T7 — `README.md`: documentar la vista Resumen rediseñada (filtros,
      fórmulas de cada tarjeta, gráficos) siguiendo el mismo nivel de
      detalle que las otras 3 vistas.
- [ ] T8 — Correr `npm test` completo (no solo los tests nuevos) y
      confirmar que nada de Capacidad/Primer Nivel/Segundo Nivel se rompió.

## Estado

Sin repo git en este proyecto (`Is a git repository: false`) — no hay
commits de work-unit por tarea; el checklist de este archivo es el único
registro de progreso.

## Próximo paso

Delegar T1–T8 a un agente escritor con contexto completo (spec, decisiones,
hallazgos de exploración).
