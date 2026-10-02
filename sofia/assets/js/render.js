(function () {
  'use strict';

  // Resumen view rendering — owns filter population, KPI/chart/table
  // rendering and table sort state. Depends on mapper.js (buildResumen) and
  // charts.js (chart primitives); no fetch/network code here, that lives in
  // app.js.

  const M = window.SOFIA_MAPPER;
  const C = window.SOFIA_CHARTS;

  const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // Per-card accent color, same fixed slot every render (no dependence on
  // object key order) -- ids come straight from buildResumen's RESUMEN_CARD_DEFS.
  const RESUMEN_CARD_COLORS = {
    activos: C.COLORS.brand,
    calidad: C.COLORS.violet,
    implementacion: C.COLORS.ok,
    mantenimiento: C.COLORS.warn
  };

  let _allTickets = [];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatFecha(d) {
    if (!d) return 'Sin dato';
    return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function monthLabel(mesKey) {
    if (!mesKey) return mesKey;
    const parts = mesKey.split('-');
    const y = parts[0], m = parseInt(parts[1], 10);
    return MONTHS_ES[m - 1].slice(0, 3) + ' ' + y;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ==================== Filters ====================
     4 filtros globales del spec: Rango de Fechas (desde/hasta, date_range_picker),
     Periodos (select YYYY-MM), Proceso, Producto -- todos opcionales,
     combinados con AND por buildResumen (mapper.js). */

  function populateResumenFilters(tickets) {
    const periodoSel = document.getElementById('filter-resumen-periodo');
    const procesoSel = document.getElementById('filter-resumen-proceso');
    const productoSel = document.getElementById('filter-resumen-producto');

    const mesKeys = Array.from(new Set(tickets.map((t) => t.mesKey).filter(Boolean))).sort();
    const procesos = Array.from(new Set(tickets.map((t) => t.proceso))).sort();
    const productos = Array.from(new Set(tickets.map((t) => t.producto))).sort();

    periodoSel.innerHTML = '<option value="all">Todos los periodos</option>' +
      mesKeys.map((mk) => '<option value="' + mk + '">' + monthLabel(mk) + '</option>').join('');
    procesoSel.innerHTML = '<option value="all">Todos los procesos</option>' +
      procesos.map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
    productoSel.innerHTML = '<option value="all">Todos los productos</option>' +
      productos.map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
  }

  function readResumenFilters() {
    const fechaDesde = document.getElementById('filter-resumen-desde').value;
    const fechaHasta = document.getElementById('filter-resumen-hasta').value;
    const periodo = document.getElementById('filter-resumen-periodo').value;
    const proceso = document.getElementById('filter-resumen-proceso').value;
    const producto = document.getElementById('filter-resumen-producto').value;
    const filters = {};
    if (fechaDesde) filters.fechaDesde = fechaDesde;
    if (fechaHasta) filters.fechaHasta = fechaHasta;
    if (periodo && periodo !== 'all') filters.periodo = periodo;
    if (proceso && proceso !== 'all') filters.proceso = proceso;
    if (producto && producto !== 'all') filters.producto = producto;
    return filters;
  }

  /* ==================== KPIs (4 tarjetas + sparkline) ====================
     Cada tarjeta se dibuja a mano (no vía charts.js' kpiCard()/renderSpark())
     porque el spec pide reutilizar el helper `lineChart` (existía sin uso
     desde que se quitó "Tendencia de horas" de Capacidad) en modo minimal
     -- kpiCard() ya trae su propio sparkline interno, que aquí NO se usa a
     propósito. */

  function resumenKpiCardHtml(card) {
    return '<div class="card p-4">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight">' + escapeHtml(card.title) + '</div>' +
      '<div class="mt-3 text-2xl font-extrabold text-slate-900 kpi-num">' + card.count + '</div>' +
      '<div class="spark-wrap mt-2"><canvas id="spark-resumen-' + card.id + '"></canvas></div>' +
      '</div>';
  }

  function renderKpis(resumen) {
    document.getElementById('kpi-row').innerHTML = resumen.cards.map(resumenKpiCardHtml).join('');

    resumen.cards.forEach((card) => {
      const color = RESUMEN_CARD_COLORS[card.id] || C.COLORS.brand;
      C.lineChart('spark-resumen-' + card.id, [{
        data: card.monthlySeries.map((m) => m.count),
        borderColor: color, fill: true, pointRadius: 0, tension: 0.35
      }], {
        labels: card.monthlySeries.map((m) => monthLabel(m.mesKey)),
        legend: false,
        tooltipOpts: { enabled: false },
        xOpts: { display: false },
        yOpts: { display: false }
      });
    });
  }

  /* ==================== Charts (2 barras horizontales) ==================== */

  function renderCharts(resumen) {
    // Top 10 Clientes con Tickets -- overlay "sin datos" (mismo patrón que
    // Capacidad/Primer Nivel/Segundo Nivel) cuando la columna Cliente no
    // existe en el feed, en vez de dibujar un gráfico vacío engañoso.
    C.chartEmptyState('chart-resumen-top-clientes', !resumen.hasCliente, 'La plantilla OData no incluye la columna Cliente.');
    C.barChart('chart-resumen-top-clientes', [{
      label: 'Tickets',
      data: resumen.topClientes.map((c) => c.count),
      backgroundColor: C.COLORS.brand
    }], {
      horizontal: true, legend: false, labels: resumen.topClientes.map((c) => c.label),
      yOpts: { ticks: { autoSkip: false, font: { size: 11 } } }
    });

    // Top Recursos - Segundo Nivel de Atención (dimensión recursoSoporte,
    // filtrado a SEGUNDO_NIVEL_ACCIONES por buildResumen). Eje muestra
    // primer nombre + primer apellido para que quepa; tooltip conserva el
    // nombre completo.
    const recursoFull = resumen.topRecursosSegundoNivel.map((r) => r.label);
    const recursoShort = recursoFull.map((name) => name.split(/\s+/).filter((_, i) => i === 0 || i === 2).join(' ') || name);
    C.barChart('chart-resumen-top-recursos-sn', [{
      label: 'Tickets',
      data: resumen.topRecursosSegundoNivel.map((r) => r.count),
      backgroundColor: C.COLORS.violet
    }], {
      horizontal: true, legend: false, labels: recursoShort,
      yOpts: { ticks: { autoSkip: false, font: { size: 11 } } },
      tooltipOpts: { callbacks: { title: (items) => recursoFull[items[0].dataIndex] } }
    });
  }

  /* ==================== Entry point ==================== */

  function renderResumen(tickets, opts) {
    opts = opts || {};
    _allTickets = tickets;
    if (opts.repopulateFilters !== false) populateResumenFilters(tickets);

    const filters = readResumenFilters();
    const resumen = M.buildResumen(tickets, filters);

    renderKpis(resumen);
    renderCharts(resumen);
  }

  function rerenderWithCurrentFilters() {
    if (_allTickets.length) renderResumen(_allTickets, { repopulateFilters: false });
  }

  /* ==================== Capacidad y Rendimiento ==================== */

  let _capAllTickets = [];
  let _capSortState = { key: 'pct', dir: 'desc' };
  let _capLastPorRecurso = [];
  // Capacidad multi-fuente (capacidad-multi-fuente-odata.md): hours from the
  // 4 extra OData sources, already { recurso, fecha, horas, fuente } —
  // module state, same pattern as _capAllTickets, so rerenderCapWithCurrentFilters/
  // clearCapacidadFilters/openDrilldownModal don't need it re-passed on every call.
  let _capExtraRows = [];
  let _capFailedSources = [];
  let _capExtraNoticeDismissed = false;

  function formatHoras(n) { return (Number(n) || 0).toFixed(1); }
  function formatPct(n) { return (Number(n) || 0).toFixed(1); }

  function isoToDMY(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  // Segment tables for the two "tacómetro" gauges — copied verbatim from
  // especificacion_ui_dashboard.fila_tacometros_individuales (spec v2).
  const GAUGE_PROGRAMADO_SEGMENTS = [
    { limite: 70, color: '#3B82F6', label: 'Alta Disponibilidad' },
    { limite: 85, color: '#10B981', label: 'Óptimo' },
    { limite: 100, color: '#F59E0B', label: 'Límite' },
    { limite: 150, color: '#EF4444', label: 'Saturado' }
  ];
  const GAUGE_TIEMPO_REAL_SEGMENTS = [
    { limite: 80, color: '#3B82F6', label: 'Cierre Rápido' },
    { limite: 105, color: '#10B981', label: 'En Tiempo' },
    { limite: 150, color: '#EF4444', label: 'Excedido' }
  ];

  function gaugeBand(segments, value) {
    return segments.find((s) => value <= s.limite) || segments[segments.length - 1];
  }

  /* -------- Recursos multi-select (checkboxes, no library) -------- */

  function readSelectedRecursos() {
    return Array.from(document.querySelectorAll('#filter-cap-recursos-list .cap-recurso-opt:checked')).map((el) => el.value);
  }

  function updateRecursosTriggerLabel() {
    const trigger = document.getElementById('filter-cap-recursos-trigger');
    if (!trigger) return;
    const checked = readSelectedRecursos();
    if (!checked.length) trigger.textContent = 'Todos los recursos';
    else if (checked.length === 1) trigger.textContent = checked[0];
    else trigger.textContent = checked.length + ' seleccionados';
  }

  // Re-renders the option list, preserving any previously checked names so a
  // data reload doesn't silently clear the user's selection.
  function renderRecursosOptions(recursos) {
    const list = document.getElementById('filter-cap-recursos-list');
    const checkedBefore = new Set(readSelectedRecursos());
    list.innerHTML = recursos.map((r) => (
      '<label class="multi-select-option"><input type="checkbox" class="cap-recurso-opt" value="' + escapeHtml(r) + '"' +
      (checkedBefore.has(r) ? ' checked' : '') + ' /> ' + escapeHtml(r) + '</label>'
    )).join('');
  }

  let _capMultiSelectWired = false;
  function wireCapRecursosMultiSelect() {
    if (_capMultiSelectWired) return;
    _capMultiSelectWired = true;
    const trigger = document.getElementById('filter-cap-recursos-trigger');
    const panel = document.getElementById('filter-cap-recursos-panel');
    const allCheckbox = document.getElementById('filter-cap-recursos-all');
    const list = document.getElementById('filter-cap-recursos-list');
    if (!trigger || !panel || !allCheckbox || !list) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== trigger) {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    // "Todos" checked -> clears every individual selection (means "no filter").
    allCheckbox.addEventListener('change', () => {
      if (allCheckbox.checked) list.querySelectorAll('.cap-recurso-opt').forEach((el) => { el.checked = false; });
      updateRecursosTriggerLabel();
      rerenderCapWithCurrentFilters();
    });

    // Any individual pick unchecks "Todos"; unchecking the last one re-checks it.
    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains('cap-recurso-opt')) return;
      allCheckbox.checked = list.querySelectorAll('.cap-recurso-opt:checked').length === 0;
      updateRecursosTriggerLabel();
      rerenderCapWithCurrentFilters();
    });
  }

  /* -------- Cliente -> Proyecto (dependent single-selects) -------- */

  function populateProyectoOptions(tickets, clienteValue) {
    const proyectoSel = document.getElementById('filter-cap-proyecto');
    const scoped = (clienteValue && clienteValue !== 'all') ? tickets.filter((t) => t.cliente === clienteValue) : tickets;
    const proyectos = Array.from(new Set(scoped.map((t) => (t.proyecto && t.proyecto !== 'Sin dato') ? t.proyecto : 'Sin proyecto'))).sort();
    proyectoSel.innerHTML = '<option value="all">Todos los proyectos</option>' +
      proyectos.map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
  }

  // Cliente changed -> its own change handler (not the generic rerender
  // loop): the Proyecto list must be rebuilt for the new cliente AND reset
  // to "Todos" first, per "regla" in filtros_principales.proyecto.
  function onCapClienteChange() {
    if (!_capAllTickets.length) return;
    const clienteSel = document.getElementById('filter-cap-cliente');
    populateProyectoOptions(_capAllTickets, clienteSel.value);
    document.getElementById('filter-cap-proyecto').value = 'all';
    rerenderCapWithCurrentFilters();
  }

  /* -------- Filters: populate / read -------- */

  function populateCapFilters(tickets, extraRows) {
    const desdeInput = document.getElementById('filter-cap-desde');
    const hastaInput = document.getElementById('filter-cap-hasta');
    const clienteSel = document.getElementById('filter-cap-cliente');
    const clienteHelp = document.getElementById('filter-cap-cliente-help');
    const gaugeSel = document.getElementById('filter-cap-gauge-recurso');
    const gaugeDesdeInput = document.getElementById('filter-cap-gauge-desde');
    const gaugeHastaInput = document.getElementById('filter-cap-gauge-hasta');

    // "Sin dato" is excluded from Recursos: buildCapacidad already excludes
    // it from the team/capacity calculation, so offering it as a filter
    // option would only ever produce an empty result.
    const recursos = Array.from(new Set(tickets.map((t) => t.recursoSoporte).filter((r) => r && r !== 'Sin dato'))).sort();
    renderRecursosOptions(recursos);
    updateRecursosTriggerLabel();

    const hasCliente = M.hasClienteColumn(tickets);
    clienteSel.disabled = !hasCliente;
    if (clienteHelp) clienteHelp.hidden = hasCliente;
    if (hasCliente) {
      const clientes = Array.from(new Set(tickets.map((t) => t.cliente).filter(Boolean))).sort();
      clienteSel.innerHTML = '<option value="all">Todos los clientes</option>' +
        clientes.map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('');
    } else {
      clienteSel.innerHTML = '<option value="all">Sin columna Cliente en la plantilla</option>';
    }
    populateProyectoOptions(tickets, 'all');

    // Gauge resource selector (LOCAL to the gauge row, spec v3): options
    // always refresh to the current team; preserve the user's prior pick
    // across a data reload when it's still valid.
    const gaugeHadOptions = gaugeSel.options.length > 0;
    const prevGaugeValue = gaugeSel.value;
    gaugeSel.innerHTML = recursos.map((r) => '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>').join('');
    let gaugeValueRestored = false;
    if (gaugeHadOptions && recursos.indexOf(prevGaugeValue) !== -1) {
      gaugeSel.value = prevGaugeValue;
      gaugeValueRestored = true;
    }

    const isFirstLoad = !desdeInput.value || !hastaInput.value;
    const gaugeIsFirstLoad = !gaugeDesdeInput.value || !gaugeHastaInput.value;
    if (isFirstLoad || gaugeIsFirstLoad) {
      // No explicit filters yet -> buildCapacidad resolves the "mes a la
      // fecha" default period; sync the controls to what it actually picked
      // so the UI never shows a stale default. The gauge row's own local
      // Desde/Hasta default to that SAME period (independent inputs, same
      // starting value) per spec v3. Its porRecurso (sorted desc by % Uso,
      // i.e. by Horas Reservadas since every resource shares the same period
      // capacity) also gives the gauge selector's own default: the top
      // resource by reservadas desc -- includes extraRows so a
      // Capacitación-only consultant can also win the default pick.
      const defaults = M.buildCapacidad(tickets, {}, extraRows);
      if (isFirstLoad) {
        desdeInput.value = defaults.periodo.from;
        hastaInput.value = defaults.periodo.to;
      }
      if (gaugeIsFirstLoad) {
        gaugeDesdeInput.value = defaults.periodo.from;
        gaugeHastaInput.value = defaults.periodo.to;
        if (!gaugeValueRestored && defaults.porRecurso.length) gaugeSel.value = defaults.porRecurso[0].recurso;
      }
    }
  }

  function readCapFilters() {
    return {
      from: document.getElementById('filter-cap-desde').value,
      to: document.getElementById('filter-cap-hasta').value,
      recursos: readSelectedRecursos(),
      cliente: document.getElementById('filter-cap-cliente').value,
      proyecto: document.getElementById('filter-cap-proyecto').value
    };
  }

  /* -------- KPIs -------- */

  function renderCapKpis(result) {
    const k = result.kpis;
    const cards = [
      C.kpiCard({ title: 'Capacidad Instalada', value: formatHoras(k.capacidad), unit: ' h', noChip: true, hasData: false }),
      C.kpiCard({ title: 'Horas Agendadas', value: formatHoras(k.reservadas), unit: ' h', noChip: true, hasData: false }),
      C.kpiCard({ title: 'Horas Disponibles', value: formatHoras(k.disponibles), unit: ' h', noChip: true, hasData: false })
    ];
    // % Utilización Global uses its own semáforo-colored badge (4 states),
    // which doesn't map onto kpiCard's built-in ok/warn/bad/mute chip system
    // — built inline here instead of forcing that mismatch.
    cards.push(
      '<div class="card p-4">' +
      '<div class="flex items-start justify-between">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight pr-2">% Utilización Global</div>' +
      '<span class="cap-badge ' + escapeHtml(k.badgeClass) + '">' + escapeHtml(k.estado) + '</span>' +
      '</div>' +
      '<div class="mt-3 flex items-baseline gap-2">' +
      '<div class="text-2xl font-extrabold text-slate-900 kpi-num">' + formatPct(k.utilizacionPct) + '<span class="text-base text-slate-400 font-bold">%</span></div>' +
      '</div>' +
      '<div class="spark-wrap mt-2"></div>' +
      '</div>'
    );
    document.getElementById('kpi-row-capacidad').innerHTML = cards.join('');
    C.flushSparks();

    const legend = document.getElementById('semaforo-legend');
    if (legend) {
      legend.innerHTML = M.UMBRALES.map((u) =>
        '<span class="cap-badge ' + escapeHtml(u.badgeClass) + '" style="margin-right:6px;">' + escapeHtml(u.estado) + '</span> ' + escapeHtml(u.descripcion)
      ).join(' &nbsp;·&nbsp; ');
    }
  }

  /* -------- Charts -------- */

  function renderCapCharts(result, filters) {
    // Stacked bar: Ocupación por recurso — top 10 (every resource shares the
    // same period capacity, so sorting by % Uso desc is the same order as
    // sorting by Horas Reservadas desc — matches the Resumen top-10 pattern).
    const top10 = result.porRecurso.slice(0, 10);
    const recursoFull = top10.map((r) => r.recurso);
    const recursoShort = recursoFull.map((name) => name.split(/\s+/).filter((_, i) => i === 0 || i === 2).join(' ') || name);
    C.barChart('chart-cap-ocupacion', [
      { label: 'Horas Reservadas', data: top10.map((r) => r.reservadas), backgroundColor: '#0284C7', stack: 'cap' },
      { label: 'Horas Disponibles', data: top10.map((r) => r.disponibles), backgroundColor: '#E2E8F0', stack: 'cap' },
      { label: 'Horas Saturadas', data: top10.map((r) => r.saturadas), backgroundColor: '#DC2626', stack: 'cap' }
    ], {
      stacked: true, labels: recursoShort,
      xOpts: { ticks: { autoSkip: false, font: { size: 10 }, maxRotation: 40, minRotation: 0 } },
      tooltipOpts: { callbacks: { title: (items) => recursoFull[items[0].dataIndex] } }
    });

    // Horizontal bar: Consumo por Proyecto — top 15 desc, title + data
    // dynamic on the Cliente filter (already restricted to that cliente's
    // rows by buildCapacidad, since `filters.cliente` narrows `rows` there —
    // no separate re-filtering needed here). Project names run long, so the
    // axis shows a truncated label (full name in the tooltip title).
    const titleEl = document.getElementById('chart-cap-proyecto-title');
    if (titleEl) {
      titleEl.textContent = (filters.cliente && filters.cliente !== 'all')
        ? 'Consumo por Proyecto - ' + filters.cliente
        : 'Consumo por Proyecto (Global)';
    }
    const top15 = result.porProyecto.slice(0, 15);
    C.chartEmptyState('chart-cap-proyecto', top15.length === 0, 'Sin horas agendadas para el período y filtros seleccionados');
    const proyectoFull = top15.map((p) => p.proyecto);
    const proyectoShort = proyectoFull.map((name) => name.length > 28 ? name.slice(0, 26) + '…' : name);
    C.barChart('chart-cap-proyecto', [{
      label: 'Horas',
      data: top15.map((p) => +p.horas.toFixed(1)),
      backgroundColor: C.COLORS.brand
    }], {
      horizontal: true, legend: false, labels: proyectoShort,
      yOpts: { ticks: { autoSkip: false, font: { size: 10 } } },
      tooltipOpts: { callbacks: {
        title: (items) => proyectoFull[items[0].dataIndex],
        label: (ctx) => ctx.parsed.x.toFixed(1) + ' h (' + top15[ctx.dataIndex].pct.toFixed(1) + '%)'
      } }
    });
  }

  /* -------- Gauges (tacómetros individuales) -------- */

  function updateGaugeLocalPeriodHint(from, to) {
    const hint = document.getElementById('gauge-local-period-hint');
    if (!hint) return;
    if (!from || !to) { hint.textContent = ''; return; }
    const wd = M.countWorkingDays(from, to);
    const habiles = wd.monThu + wd.fri;
    hint.textContent = 'Período local: ' + isoToDMY(from) + ' – ' + isoToDMY(to) + ' · ' + habiles + (habiles === 1 ? ' día hábil' : ' días hábiles');
  }

  // The gauge row has its OWN resource + date-range selectors, entirely
  // independent of the main Recursos/Cliente/Proyecto/Desde/Hasta filters
  // (spec v3 fila_tacometros.tacometro_izquierda.filtros_locales) — reads
  // its inputs directly rather than taking the main filter set as a param,
  // so it can be re-run standalone whenever any of its own three controls
  // change without touching the rest of the view.
  function renderCapGauges(tickets) {
    const recurso = document.getElementById('filter-cap-gauge-recurso').value;
    const from = document.getElementById('filter-cap-gauge-desde').value;
    const to = document.getElementById('filter-cap-gauge-hasta').value;
    updateGaugeLocalPeriodHint(from, to);

    const valueEl = document.getElementById('gauge-programado-value');
    const labelEl = document.getElementById('gauge-programado-label');
    const footerEl = document.getElementById('gauge-programado-footer');
    const valueEl2 = document.getElementById('gauge-tiemporeal-value');
    const labelEl2 = document.getElementById('gauge-tiemporeal-label');
    const footerEl2 = document.getElementById('gauge-tiemporeal-footer');

    if (!recurso) {
      C.segmentedGauge('chart-gauge-programado', null, GAUGE_PROGRAMADO_SEGMENTS, { hasData: false });
      C.segmentedGauge('chart-gauge-tiemporeal', null, GAUGE_TIEMPO_REAL_SEGMENTS, { hasData: false });
      valueEl.textContent = '—'; labelEl.textContent = 'Sin recurso'; footerEl.textContent = '';
      valueEl2.textContent = '—'; labelEl2.textContent = 'Sin recurso'; footerEl2.textContent = '';
      return;
    }

    const g = M.buildRecursoGauges(tickets, { recurso: recurso, from: from, to: to });

    const bandA = gaugeBand(GAUGE_PROGRAMADO_SEGMENTS, g.programado.pct);
    C.segmentedGauge('chart-gauge-programado', g.programado.pct, GAUGE_PROGRAMADO_SEGMENTS);
    valueEl.textContent = formatPct(g.programado.pct) + '%';
    labelEl.textContent = bandA.label;
    footerEl.textContent = formatHoras(g.programado.horas) + 'h programadas / ' + formatHoras(g.programado.capacidad) + 'h capacidad';

    if (g.tiempoReal.hasData) {
      const bandB = gaugeBand(GAUGE_TIEMPO_REAL_SEGMENTS, g.tiempoReal.pct);
      C.segmentedGauge('chart-gauge-tiemporeal', g.tiempoReal.pct, GAUGE_TIEMPO_REAL_SEGMENTS);
      valueEl2.textContent = formatPct(g.tiempoReal.pct) + '%';
      labelEl2.textContent = bandB.label;
    } else {
      C.segmentedGauge('chart-gauge-tiemporeal', null, GAUGE_TIEMPO_REAL_SEGMENTS, { hasData: false });
      valueEl2.textContent = '—';
      labelEl2.textContent = 'Sin datos de tiempo real';
    }
    footerEl2.textContent = formatHoras(g.tiempoReal.horasReales) + 'h reales / ' + formatHoras(g.tiempoReal.horasProgramadas) + 'h programadas';
  }

  function onCapGaugeFiltersChange() {
    if (!_capAllTickets.length) return;
    renderCapGauges(_capAllTickets);
  }

  const CAP_TABLE_COLUMNS = [
    { key: 'recurso', label: 'Recurso' },
    { key: 'capacidad', label: 'Capacidad (h)' },
    { key: 'reservadas', label: 'Reservadas (h)' },
    { key: 'disponibles', label: 'Disponibles (h)' },
    { key: 'pct', label: '% Uso' },
    { key: 'estado', label: 'Estado' },
    { key: 'analizar', label: 'ID', sortable: false }
  ];

  function sortCapRows(rows, key, dir) {
    return rows.slice().sort((a, b) => {
      let va = a[key], vb = b[key];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function renderCapTableHead() {
    const thead = document.getElementById('table-capacidad-head');
    thead.innerHTML = '<tr>' + CAP_TABLE_COLUMNS.map((c) => {
      if (c.sortable === false) return '<th>' + c.label + '</th>';
      const active = _capSortState.key === c.key;
      const arrow = active ? (_capSortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return '<th data-sort-key="' + c.key + '" style="cursor:pointer;">' + c.label + arrow + '</th>';
    }).join('') + '</tr>';
    thead.querySelectorAll('th[data-sort-key]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (_capSortState.key === key) _capSortState.dir = _capSortState.dir === 'asc' ? 'desc' : 'asc';
        else { _capSortState.key = key; _capSortState.dir = (key === 'recurso' || key === 'estado') ? 'asc' : 'desc'; }
        renderCapTableBody();
        renderCapTableHead();
      });
    });
  }

  /* -------- Drill-down: modal with tickets backing one resource's Reservadas
     (spec v4 — replaces the old inline-accordion mechanism: ONE way in, the
     "Analizar" button per row; no row click/Enter/Space/chevron anymore). -------- */

  // Fuente column (capacidad-multi-fuente-odata.md): shows whether an hour
  // came from a Ticket or one of the 4 extra OData sources.
  const DRILLDOWN_COLUMNS = ['ID', 'Fecha', 'Cliente', 'Proyecto', 'Producto', 'Hora Inicial', 'Hora Final', 'Horas Consumidas', 'Tiempo Llamada Real', 'Prioridad ANS', 'Fuente'];

  let _capLastFilters = {};
  let _drilldownOpenerBtn = null;

  // Cell helper for fields that are null on extra-source rows (id/producto/
  // tiempoLlamadaReal/prioridad -- see buildRecursoTickets) instead of
  // "Sin dato"/"" like every ticket-level field, so escapeHtml(null) never
  // renders the literal string "null".
  function cellOrDash(v) { return v == null ? '—' : escapeHtml(v); }

  function drilldownRowsHtml(rows) {
    return rows.length
      ? rows.map((r) => (
          '<tr>' +
          '<td class="det-id">' + cellOrDash(r.id) + '</td>' +
          '<td>' + formatFecha(r.fecha) + '</td>' +
          '<td>' + (r.cliente == null ? '—' : escapeHtml(r.cliente)) + '</td>' +
          '<td>' + escapeHtml(r.proyecto) + '</td>' +
          '<td>' + cellOrDash(r.producto) + '</td>' +
          '<td>' + escapeHtml(r.horaInicial || '—') +
            (r.bloque3 ? '<div class="text-[10px] text-slate-400 mt-0.5">+ bloque 3: ' + escapeHtml(r.bloque3.inicio) + '–' + escapeHtml(r.bloque3.fin) + '</div>' : '') +
          '</td>' +
          '<td>' + escapeHtml(r.horaFinal || '—') + '</td>' +
          '<td>' + formatHoras(r.horasConsumidas) + '</td>' +
          '<td>' + cellOrDash(r.tiempoLlamadaReal) + '</td>' +
          '<td>' + cellOrDash(r.prioridad) + '</td>' +
          '<td>' + escapeHtml(r.fuente) + '</td>' +
          '</tr>'
        )).join('')
      : '<tr><td colspan="' + DRILLDOWN_COLUMNS.length + '" style="text-align:center;color:#94A3B8;padding:12px;">Sin tickets para este recurso en el período y filtros actuales.</td></tr>';
  }

  // Opens the single, reused drill-down modal (index.html) for one resource,
  // built from the SAME main period/cliente/proyecto filters the table
  // itself was rendered with (never the gauge row's local filters), plus
  // the same extraRows already threaded into the table's own buildCapacidad
  // call, so this modal's total matches the clicked row's Reservadas exactly.
  function openDrilldownModal(recurso, openerBtn) {
    const drill = M.buildRecursoTickets(_capAllTickets, _capLastFilters, recurso, _capExtraRows);
    _drilldownOpenerBtn = openerBtn || null;

    document.getElementById('drilldown-modal-title').textContent = 'Tickets asociados a ' + recurso;
    const from = isoToDMY(_capLastFilters.from);
    const to = isoToDMY(_capLastFilters.to);
    const ticketWord = drill.rows.length === 1 ? 'ticket' : 'tickets';
    document.getElementById('drilldown-modal-subtitle').textContent =
      from + ' – ' + to + ' · ' + drill.rows.length + ' ' + ticketWord + ' · Total ' + formatHoras(drill.total) + ' h';

    document.getElementById('drilldown-modal-head').innerHTML = '<tr>' + DRILLDOWN_COLUMNS.map((h) => '<th>' + h + '</th>').join('') + '</tr>';
    document.getElementById('drilldown-modal-body').innerHTML = drilldownRowsHtml(drill.rows);
    document.getElementById('drilldown-modal-foot').innerHTML =
      '<tr><td colspan="' + DRILLDOWN_COLUMNS.length + '" class="drilldown-total">Total: ' + formatHoras(drill.total) + ' h</td></tr>';

    const backdrop = document.getElementById('drilldown-backdrop');
    const modal = document.getElementById('drilldown-modal');
    backdrop.hidden = false;
    modal.hidden = false;
    void modal.offsetWidth; // force reflow so the open transition actually plays
    backdrop.classList.add('show');
    modal.classList.add('show');
    document.getElementById('drilldown-modal-close').focus();
  }

  function closeDrilldownModal() {
    const modal = document.getElementById('drilldown-modal');
    const backdrop = document.getElementById('drilldown-backdrop');
    if (!modal || modal.hidden) return;
    modal.classList.remove('show');
    backdrop.classList.remove('show');
    modal.hidden = true;
    backdrop.hidden = true;
    if (_drilldownOpenerBtn) { _drilldownOpenerBtn.focus(); _drilldownOpenerBtn = null; }
  }

  let _drilldownWired = false;
  function wireDrilldownModal() {
    if (_drilldownWired) return;
    _drilldownWired = true;
    const backdrop = document.getElementById('drilldown-backdrop');
    const closeBtn = document.getElementById('drilldown-modal-close');
    if (backdrop) backdrop.addEventListener('click', closeDrilldownModal);
    if (closeBtn) closeBtn.addEventListener('click', closeDrilldownModal);
    document.addEventListener('keydown', (e) => {
      const modal = document.getElementById('drilldown-modal');
      if (e.key === 'Escape' && modal && !modal.hidden) closeDrilldownModal();
    });
  }

  function renderCapTableBody() {
    const tbody = document.getElementById('table-capacidad-body');
    const sorted = sortCapRows(_capLastPorRecurso, _capSortState.key, _capSortState.dir);
    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="' + CAP_TABLE_COLUMNS.length + '" style="text-align:center;color:#94A3B8;padding:20px;">Sin recursos para los filtros seleccionados.</td></tr>';
      return;
    }
    tbody.innerHTML = sorted.map((r) => (
      '<tr class="table-row">' +
      '<td>' + escapeHtml(r.recurso) + '</td>' +
      '<td>' + formatHoras(r.capacidad) + '</td>' +
      '<td>' + formatHoras(r.reservadas) + '</td>' +
      '<td>' + formatHoras(r.disponibles) + '</td>' +
      '<td>' + formatPct(r.pct) + '%</td>' +
      '<td><span class="cap-badge ' + escapeHtml(r.badgeClass) + '">' + escapeHtml(r.estado) + '</span></td>' +
      '<td><button type="button" class="cap-analizar-btn" data-recurso="' + escapeHtml(r.recurso) + '">Analizar</button></td>' +
      '</tr>'
    )).join('');

    tbody.querySelectorAll('.cap-analizar-btn').forEach((btn) => {
      btn.addEventListener('click', () => openDrilldownModal(btn.dataset.recurso, btn));
    });
  }

  // `filters` is stashed here so the drill-down modal (triggered later, by a
  // click on "Analizar") can reconstruct the exact same row set via
  // buildRecursoTickets() under the SAME main period/cliente/proyecto.
  function renderCapTable(result, filters) {
    _capLastPorRecurso = result.porRecurso;
    _capLastFilters = filters;
    renderCapTableHead();
    renderCapTableBody();
  }

  // extraRows: the 4 extra OData sources' rows (capacidad-multi-fuente-odata.md),
  // already { recurso, fecha, horas, fuente } -- threaded straight into
  // buildCapacidad. opts.failedSources (only ever passed by app.js, on an
  // actual data load) is the list of fuente labels that failed to fetch;
  // omitted on the internal rerender/clear helpers below so a filter change
  // doesn't resurrect a notice the user already dismissed for this dataset.
  function renderCapacidad(tickets, extraRows, opts) {
    opts = opts || {};
    _capAllTickets = tickets;
    _capExtraRows = Array.isArray(extraRows) ? extraRows : [];
    if (Object.prototype.hasOwnProperty.call(opts, 'failedSources')) {
      _capFailedSources = opts.failedSources || [];
      _capExtraNoticeDismissed = false;
    }
    if (opts.repopulateFilters !== false) populateCapFilters(tickets, _capExtraRows);

    const filters = readCapFilters();
    const result = M.buildCapacidad(tickets, filters, _capExtraRows);

    renderCapKpis(result);
    renderCapCharts(result, filters);
    renderCapTable(result, filters);
    renderCapGauges(tickets);
    renderCapExtraSourcesNotice();
  }

  function rerenderCapWithCurrentFilters() {
    if (_capAllTickets.length) renderCapacidad(_capAllTickets, _capExtraRows, { repopulateFilters: false });
  }

  function clearCapacidadFilters() {
    if (!_capAllTickets.length) return;

    document.querySelectorAll('#filter-cap-recursos-list .cap-recurso-opt').forEach((el) => { el.checked = false; });
    const allCheckbox = document.getElementById('filter-cap-recursos-all');
    if (allCheckbox) allCheckbox.checked = true;
    updateRecursosTriggerLabel();

    const clienteSel = document.getElementById('filter-cap-cliente');
    if (!clienteSel.disabled) clienteSel.value = 'all';
    populateProyectoOptions(_capAllTickets, 'all');
    document.getElementById('filter-cap-proyecto').value = 'all';

    const defaults = M.buildCapacidad(_capAllTickets, {}, _capExtraRows);
    document.getElementById('filter-cap-desde').value = defaults.periodo.from;
    document.getElementById('filter-cap-hasta').value = defaults.periodo.to;
    // The gauge row's own local Desde/Hasta/Recurso are intentionally left
    // untouched — "Limpiar" only resets the main filter row, per spec v3's
    // gauge filters being fully independent.
    rerenderCapWithCurrentFilters();
  }

  // Small non-blocking notice when one or more extra sources failed to load
  // (Degradation rule in capacidad-multi-fuente-odata.md) -- never blocks
  // rendering, just flags that Capacidad's totals may be incomplete for
  // those sources. Dismissible for the current dataset; reappears on the
  // next "Actualizar Datos" if it fails again (see renderCapacidad above).
  function renderCapExtraSourcesNotice() {
    const el = document.getElementById('cap-extra-sources-notice');
    const textEl = document.getElementById('cap-extra-sources-notice-text');
    if (!el || !textEl) return;
    if (!_capFailedSources.length || _capExtraNoticeDismissed) { el.hidden = true; return; }
    textEl.textContent = 'No se pudieron cargar algunas fuentes de horas (' + _capFailedSources.join(', ') +
      '). Los totales de Capacidad pueden estar incompletos para esos recursos.';
    el.hidden = false;
  }

  let _capExtraNoticeWired = false;
  function wireCapExtraSourcesNotice() {
    if (_capExtraNoticeWired) return;
    _capExtraNoticeWired = true;
    const closeBtn = document.getElementById('cap-extra-sources-notice-close');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      _capExtraNoticeDismissed = true;
      const el = document.getElementById('cap-extra-sources-notice');
      if (el) el.hidden = true;
    });
  }

  /* ==================== Tickets Activos ====================
     Business rules (Estado universe, Servicios/Calidad buckets, Recurso_Accion,
     requerimientoOpcion graceful degradation) all live in buildActivos()
     (mapper.js) -- this section only formats and draws, same division of
     labor as Resumen/Capacidad above. */

  let _actAllTickets = [];
  // Set by clicking a bar on chart-act-recursos-servicios -- narrows only
  // the table + summary panel below, never the charts themselves. Same
  // click-to-select pattern as Segundo Nivel's _snSelectedResource.
  let _actSelectedResource = null;
  // Set by clicking a bar on chart-act-accion-general -- narrows only the
  // table below (never the summary panel, which is resource-specific), so
  // the table's own Recurso column becomes "el detalle de los recursos"
  // behind that acción. ANDs with _actSelectedResource above when both are
  // set (independent selections, same table).
  let _actSelectedAccion = null;

  // KPI cards with a spec-mandated accent color per card (Tickets Abiertos /
  // Abiertos Servicios / Abiertos Calidad) -- kpiCard()'s chip/stripe system
  // is built for ok/warn/bad status, not an arbitrary per-card hex, so these
  // are built inline (same approach render.js already uses for Capacidad's
  // "% Utilización Global" card, which needed its own 4-state badge color).
  function activoKpiCard(title, value, color) {
    return '<div class="card p-4">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight">' + title + '</div>' +
      '<div class="mt-3 text-2xl font-extrabold kpi-num" style="color:' + color + ';">' + value + '</div>' +
      '</div>';
  }

  // Per-client horizontal bar chart (spec: chart_tickets_cliente layout).
  // The outer .chart-scroll box shows at most CLIENTE_MAX_VISIBLE rows and
  // scrolls; the inner box grows to rows * CLIENTE_ROW_PX so every bar keeps
  // its pitch. Names are truncated to CLIENTE_LABEL_MAX_CHARS on the axis
  // and shown in full in the tooltip.
  const CLIENTE_ROW_PX = 28;
  const CLIENTE_MAX_VISIBLE = 10;
  const CLIENTE_LABEL_MAX_CHARS = 35;
  const CLIENTE_AXIS_PX = 44;
  // Shared look for the two "ranked list" bar charts in Tickets Activos
  // (recursos servicios + cliente), so they read as one component. Any
  // style change goes here, not in the individual chart calls.
  const LIST_BAR_COLOR = '#0284C7';
  const LIST_BAR_DATASET = { backgroundColor: LIST_BAR_COLOR, barThickness: 12, borderRadius: 0 };
  const LIST_BAR_LAYOUT = { padding: { top: 10, right: 30, bottom: 10, left: 10 } };
  const LIST_BAR_CATEGORY_AXIS = {
    grid: { display: false, drawTicks: false },
    border: { display: true, color: LIST_BAR_COLOR, width: 1.5 },
    ticks: { autoSkip: false, padding: 12, color: '#334155', font: { size: 10.5, weight: '400', lineHeight: 1.2 } }
  };
  const LIST_BAR_VALUE_AXIS = {
    grid: { color: '#E2E8F0' },
    ticks: { precision: 0, color: '#64748B', font: { size: 11 } }
  };
  const LIST_BAR_DATA_LABELS = { anchor: 'end', align: 'end', offset: 6, color: '#1E293B', font: { size: 11, weight: '400' } };

  function truncateLabel(text, maxChars) {
    const s = String(text || '');
    return s.length > maxChars ? s.slice(0, maxChars - 1).trimEnd() + '…' : s;
  }

  // Chart.js caps a vertical axis at half the chart width and clips any
  // label wider than that, so after the character cap the label is also
  // fitted to the pixels the axis actually has (scale.maxWidth is set by
  // the time tick callbacks run). `scale` is the Chart.js scale instance.
  const CLIENTE_TICK_PADDING_PX = 14;
  function fitLabelToScale(scale, text, fontPx) {
    const ctx = scale.ctx;
    const available = scale.maxWidth - CLIENTE_TICK_PADDING_PX;
    ctx.save();
    ctx.font = fontPx + 'px ' + Chart.defaults.font.family;
    let s = String(text || '');
    if (ctx.measureText(s).width > available) {
      while (s.length > 1 && ctx.measureText(s + '…').width > available) s = s.slice(0, -1);
      s = s.trimEnd() + '…';
    }
    ctx.restore();
    return s;
  }

  function renderActivosKpis(result) {
    const cards = [
      activoKpiCard('Tickets Abiertos', result.kpis.total, '#1E293B'),
      activoKpiCard('Abiertos Servicios', result.kpis.servicios, '#2563EB'),
      activoKpiCard('Abiertos Calidad', result.kpis.calidad, '#7C3AED')
    ];
    document.getElementById('kpi-row-activos').innerHTML = cards.join('');
  }

  function renderActivosCharts(result) {
    // 1) Tickets Abiertos por Recurso (Servicios) -- horizontal bar, single
    // series, already sorted desc by buildActivos. Bar click selects/
    // deselects that resource (highlighted in a deeper blue, toggle on
    // second click) and narrows the table + summary panel below -- exact
    // same interaction as Segundo Nivel's chart-sn-recurso, never the bars
    // themselves.
    C.barChart('chart-act-recursos-servicios', [Object.assign({}, LIST_BAR_DATASET, {
      label: 'Tickets',
      data: result.recursosServicios.map((r) => r.value),
      backgroundColor: result.recursosServicios.map((r) => r.label === _actSelectedResource ? C.COLORS.brandDeep : LIST_BAR_COLOR)
    })], {
      horizontal: true, legend: false, labels: result.recursosServicios.map((r) => r.label),
      layout: LIST_BAR_LAYOUT,
      yOpts: LIST_BAR_CATEGORY_AXIS,
      xOpts: LIST_BAR_VALUE_AXIS,
      dataLabels: LIST_BAR_DATA_LABELS,
      onClick: (evt, elements, chart) => {
        if (!elements.length) return;
        const label = chart.data.labels[elements[0].index];
        _actSelectedResource = (_actSelectedResource === label) ? null : label;
        _actTablePage = 1;
        rerenderActivosWithCurrentFilters();
      }
    });

    // 2) Recuento de Tickets por Cliente -- horizontal bar, whole universe,
    // full client name on the category axis (the previous vertical layout
    // rotated the labels 45deg and they were unreadable past ~10 clients).
    // Bars shade from a deep blue (highest count) to a light blue (lowest)
    // so the ranking reads at a glance. The canvas box grows with the row
    // count so every client keeps a legible row height instead of being
    // squeezed into the fixed .chart-box-tall height.
    // Empty-state overlay when the OData template doesn't carry the Cliente
    // column at all (same chartEmptyState pattern Capacidad already uses for
    // its own "no data" charts), chart is still (re)drawn underneath with
    // whatever data is available so a later dataset swap with Cliente
    // present renders normally without a stale hint.
    C.chartEmptyState('chart-act-cliente', !result.hasCliente, 'La plantilla OData no incluye la columna Cliente en la plantilla.');
    const clienteRows = result.porCliente.length;
    const clienteValues = result.porCliente.map((c) => c.value);
    const clienteInner = document.getElementById('chart-act-cliente').parentElement;
    const clienteOuter = clienteInner.parentElement;
    // Keep the default box height when there is nothing to list so the
    // empty-state overlay has room to render.
    const clienteVisiblePx = Math.min(clienteRows, CLIENTE_MAX_VISIBLE) * CLIENTE_ROW_PX + CLIENTE_AXIS_PX;
    clienteOuter.style.height = (clienteRows ? clienteVisiblePx : 340) + 'px';
    clienteInner.style.height = (clienteRows ? clienteRows * CLIENTE_ROW_PX + CLIENTE_AXIS_PX : 340) + 'px';
    // Same look as the recursos chart above (LIST_BAR_*), plus the truncated
    // axis labels (full client name lives in the tooltip).
    const clienteAxis = Object.assign({}, LIST_BAR_CATEGORY_AXIS, {
      ticks: Object.assign({}, LIST_BAR_CATEGORY_AXIS.ticks, {
        callback: function (value) {
          return fitLabelToScale(this, truncateLabel(this.getLabelForValue(value), CLIENTE_LABEL_MAX_CHARS), LIST_BAR_CATEGORY_AXIS.ticks.font.size);
        }
      })
    });
    C.barChart('chart-act-cliente', [Object.assign({
      label: 'Tickets',
      data: clienteValues
    }, LIST_BAR_DATASET)], {
      horizontal: true, legend: false, labels: result.porCliente.map((c) => c.label),
      layout: LIST_BAR_LAYOUT,
      yOpts: clienteAxis,
      xOpts: Object.assign({}, LIST_BAR_VALUE_AXIS, {
        title: { display: true, text: 'Total Tickets Activos', color: '#94A3B8', font: { size: 11 } }
      }),
      tooltipOpts: {
        callbacks: {
          title: (items) => items[0].label,
          label: (item) => item.parsed.x + ' tickets activos'
        }
      },
      dataLabels: LIST_BAR_DATA_LABELS
    });

    // 3) Tickets Abiertos por Acción (General) -- horizontal bar, whole
    // universe, per-bar colorMapping already resolved by buildActivos
    // (Chart.js accepts an array for backgroundColor, one color per bar).
    // Bar click selects/deselects that acción (toggle on second click,
    // same pattern as the Recurso chart above) and narrows the table below
    // -- its Recurso column becomes the "detalle de los recursos" for the
    // selected acción. Unlike the Recurso chart, each bar already has its
    // own fixed color (ACTIVOS_ACCION_COLORS), so "selected" can't reuse a
    // single highlight color -- instead every OTHER bar is faded (alpha
    // suffix on its hex color) while a selection is active.
    C.barChart('chart-act-accion-general', [{
      label: 'Tickets',
      data: result.porAccion.map((a) => a.value),
      backgroundColor: result.porAccion.map((a) => (
        !_actSelectedAccion || a.label === _actSelectedAccion ? a.color : a.color + '55'
      ))
    }], {
      horizontal: true, legend: false, labels: result.porAccion.map((a) => a.label),
      yOpts: { ticks: { autoSkip: false, font: { size: 10 } } },
      dataLabels: true,
      onClick: (evt, elements, chart) => {
        if (!elements.length) return;
        const label = chart.data.labels[elements[0].index];
        _actSelectedAccion = (_actSelectedAccion === label) ? null : label;
        _actTablePage = 1;
        rerenderActivosWithCurrentFilters();
      }
    });

    // 4) Distribución de Tickets por Producto -- doughnut, cutout 60%,
    // percentage shown (doughnut()'s showPercent). Colors cycle through the
    // shared PRODUCTO_COLORS palette by index, same modulo pattern used for
    // any doughnut over an unbounded category count (no top-8/OTROS
    // bucketing here -- the active universe is small).
    const productoColors = result.porProducto.map((_, i) => C.PRODUCTO_COLORS[i % C.PRODUCTO_COLORS.length]);
    C.doughnut(
      'chart-act-producto',
      result.porProducto.map((p) => p.label),
      result.porProducto.map((p) => p.value),
      productoColors,
      { showPercent: true, cutout: '60%', legendPosition: 'right' }
    );
  }

  /* -------- Requerimientos / Opciones: searchable multiselect -------- */
  /* Hidden entirely when buildActivos reports hasRequerimiento:false (the
     Requerimiento_Opcion column doesn't exist in the feed yet) -- same
     graceful-degradation approach as Capacidad's Cliente filter. */

  function readSelectedActRequerimientos() {
    return Array.from(document.querySelectorAll('#filter-act-requerimientos-list .act-requerimiento-opt:checked')).map((el) => el.value);
  }

  function updateActRequerimientosTriggerLabel() {
    const trigger = document.getElementById('filter-act-requerimientos-trigger');
    if (!trigger) return;
    const checked = readSelectedActRequerimientos();
    if (!checked.length) trigger.textContent = 'Todos';
    else if (checked.length === 1) trigger.textContent = checked[0];
    else trigger.textContent = checked.length + ' seleccionados';
  }

  function renderActRequerimientosOptions(options) {
    const list = document.getElementById('filter-act-requerimientos-list');
    if (!list) return;
    const checkedBefore = new Set(readSelectedActRequerimientos());
    list.innerHTML = options.map((o) => (
      '<label class="multi-select-option"><input type="checkbox" class="act-requerimiento-opt" value="' + escapeHtml(o) + '"' +
      (checkedBefore.has(o) ? ' checked' : '') + ' /> ' + escapeHtml(o) + '</label>'
    )).join('');
  }

  let _actMultiSelectWired = false;
  function wireActRequerimientosMultiSelect() {
    if (_actMultiSelectWired) return;
    _actMultiSelectWired = true;
    const trigger = document.getElementById('filter-act-requerimientos-trigger');
    const panel = document.getElementById('filter-act-requerimientos-panel');
    const allCheckbox = document.getElementById('filter-act-requerimientos-all');
    const list = document.getElementById('filter-act-requerimientos-list');
    const search = document.getElementById('filter-act-requerimientos-search');
    if (!trigger || !panel || !allCheckbox || !list) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== trigger) {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    allCheckbox.addEventListener('change', () => {
      if (allCheckbox.checked) list.querySelectorAll('.act-requerimiento-opt').forEach((el) => { el.checked = false; });
      updateActRequerimientosTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains('act-requerimiento-opt')) return;
      allCheckbox.checked = list.querySelectorAll('.act-requerimiento-opt:checked').length === 0;
      updateActRequerimientosTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    // Client-side search over the option labels -- no library, filters the
    // visible rows by a case-insensitive substring match as the user types.
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        list.querySelectorAll('.act-requerimiento-opt').forEach((el) => {
          el.parentElement.style.display = (!q || el.parentElement.textContent.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
        });
      });
    }
  }

  /* -------- Recurso: searchable multiselect (above the date filters) -------- */
  /* Same widget pattern as Requerimientos above -- Recurso_Accion always
     exists (every other Activos chart already uses it), so unlike
     Requerimientos this block is never hidden. */

  function readSelectedActRecursos() {
    return Array.from(document.querySelectorAll('#filter-act-recurso-list .act-recurso-opt:checked')).map((el) => el.value);
  }

  function updateActRecursoTriggerLabel() {
    const trigger = document.getElementById('filter-act-recurso-trigger');
    if (!trigger) return;
    const checked = readSelectedActRecursos();
    if (!checked.length) trigger.textContent = 'Todos los recursos';
    else if (checked.length === 1) trigger.textContent = checked[0];
    else trigger.textContent = checked.length + ' seleccionados';
  }

  function renderActRecursoOptions(options) {
    const list = document.getElementById('filter-act-recurso-list');
    if (!list) return;
    const checkedBefore = new Set(readSelectedActRecursos());
    list.innerHTML = options.map((o) => (
      '<label class="multi-select-option"><input type="checkbox" class="act-recurso-opt" value="' + escapeHtml(o) + '"' +
      (checkedBefore.has(o) ? ' checked' : '') + ' /> ' + escapeHtml(o) + '</label>'
    )).join('');
  }

  let _actRecursoMultiSelectWired = false;
  function wireActRecursoMultiSelect() {
    if (_actRecursoMultiSelectWired) return;
    _actRecursoMultiSelectWired = true;
    const trigger = document.getElementById('filter-act-recurso-trigger');
    const panel = document.getElementById('filter-act-recurso-panel');
    const allCheckbox = document.getElementById('filter-act-recurso-all');
    const list = document.getElementById('filter-act-recurso-list');
    const search = document.getElementById('filter-act-recurso-search');
    if (!trigger || !panel || !allCheckbox || !list) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== trigger) {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    allCheckbox.addEventListener('change', () => {
      if (allCheckbox.checked) list.querySelectorAll('.act-recurso-opt').forEach((el) => { el.checked = false; });
      updateActRecursoTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains('act-recurso-opt')) return;
      allCheckbox.checked = list.querySelectorAll('.act-recurso-opt:checked').length === 0;
      updateActRecursoTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    // Client-side search over the option labels -- same no-library pattern
    // as the Requerimientos search box above.
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        list.querySelectorAll('.act-recurso-opt').forEach((el) => {
          el.parentElement.style.display = (!q || el.parentElement.textContent.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
        });
      });
    }
  }

  /* -------- Filters: populate / read -------- */

  function populateActivosFilters(tickets) {
    // buildActivos({}) computes hasRequerimiento/requerimientoOptions and
    // recursoOptions over the whole active universe with no filters applied
    // -- exactly what the filter UI needs to decide whether to show itself
    // and what to list.
    const defaults = M.buildActivos(tickets, {});
    const wrap = document.getElementById('filter-act-requerimientos-wrap');
    if (wrap) wrap.hidden = !defaults.hasRequerimiento;
    if (defaults.hasRequerimiento) {
      renderActRequerimientosOptions(defaults.requerimientoOptions);
      updateActRequerimientosTriggerLabel();
    }
    renderActRecursoOptions(defaults.recursoOptions);
    updateActRecursoTriggerLabel();
  }

  function readActivosFilters() {
    const filters = { requerimientos: readSelectedActRequerimientos(), recursos: readSelectedActRecursos() };
    const soporteDesde = document.getElementById('filter-act-soporte-desde').value;
    const soporteHasta = document.getElementById('filter-act-soporte-hasta').value;
    const entregaDesde = document.getElementById('filter-act-entrega-desde').value;
    const entregaHasta = document.getElementById('filter-act-entrega-hasta').value;
    if (soporteDesde) filters.fechaSoporteInicialFrom = soporteDesde;
    if (soporteHasta) filters.fechaSoporteInicialTo = soporteHasta;
    if (entregaDesde) filters.fechaEntregaInicialFrom = entregaDesde;
    if (entregaHasta) filters.fechaEntregaInicialTo = entregaHasta;
    return filters;
  }

  /* -------- Table: "Requerimientos de Primer Nivel" (paginated) -------- */
  /* Rows = buildActivos' `rows` (already Recurso/date/requerimiento
     filtered), narrowed further by _actSelectedResource when a bar is
     selected -- same two-stage division of labor as Segundo Nivel's table,
     except the selectedResource narrowing happens here in render.js instead
     of inside the mapper (buildActivos.recursos is the real filter; the bar
     click is a render-only secondary narrowing of the table alone). This is
     the first paginated table in the app -- a small local page-index module
     variable + slice + Prev/Next, not a generic/reusable component. */

  const ACT_TABLE_COLUMNS = ['ID', 'Recurso', 'Cliente', 'Producto', 'Accion', 'Asunto'];
  const ACT_TABLE_PAGE_SIZE = 10;
  let _actTablePage = 1;

  function actRowsHtml(rows) {
    return rows.length
      ? rows.map((r) => (
          '<tr>' +
          '<td class="det-id">' + escapeHtml(r.id) + '</td>' +
          '<td>' + escapeHtml(r.recursoAccion) + '</td>' +
          '<td>' + (r.cliente == null ? '—' : escapeHtml(r.cliente)) + '</td>' +
          '<td>' + escapeHtml(r.producto) + '</td>' +
          '<td>' + escapeHtml(r.accion) + '</td>' +
          '<td>' + (r.asunto == null ? '—' : escapeHtml(r.asunto)) + '</td>' +
          '</tr>'
        )).join('')
      : '<tr><td colspan="' + ACT_TABLE_COLUMNS.length + '" style="text-align:center;color:#94A3B8;padding:20px;">Sin tickets para los filtros seleccionados.</td></tr>';
  }

  function renderActTable(result) {
    // Both bar-click selections narrow this same table (AND semantics) --
    // independent of each other, so picking a recurso AND an acción shows
    // only that combination's rows.
    const rows = result.rows.filter((r) =>
      (!_actSelectedResource || r.recursoAccion === _actSelectedResource) &&
      (!_actSelectedAccion || r.accion === _actSelectedAccion)
    );
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / ACT_TABLE_PAGE_SIZE));
    if (_actTablePage > totalPages) _actTablePage = totalPages;
    if (_actTablePage < 1) _actTablePage = 1;
    const start = (_actTablePage - 1) * ACT_TABLE_PAGE_SIZE;
    const pageRows = rows.slice(start, start + ACT_TABLE_PAGE_SIZE);

    document.getElementById('table-act-head').innerHTML = '<tr>' + ACT_TABLE_COLUMNS.map((h) => '<th>' + h + '</th>').join('') + '</tr>';
    document.getElementById('table-act-body').innerHTML = actRowsHtml(pageRows);

    const label = document.getElementById('act-table-page-label');
    if (label) {
      label.textContent = total
        ? 'Mostrando ' + (start + 1) + '–' + Math.min(start + ACT_TABLE_PAGE_SIZE, total) + ' de ' + total
        : 'Mostrando 0 de 0';
    }
    const prevBtn = document.getElementById('act-table-prev');
    const nextBtn = document.getElementById('act-table-next');
    if (prevBtn) prevBtn.disabled = _actTablePage <= 1;
    if (nextBtn) nextBtn.disabled = _actTablePage >= totalPages;
  }

  let _actTablePagerWired = false;
  function wireActTablePager() {
    if (_actTablePagerWired) return;
    _actTablePagerWired = true;
    const prevBtn = document.getElementById('act-table-prev');
    const nextBtn = document.getElementById('act-table-next');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (_actTablePage > 1) { _actTablePage -= 1; rerenderActivosWithCurrentFilters(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      _actTablePage += 1; // renderActTable clamps back down if this is past the last page
      rerenderActivosWithCurrentFilters();
    });
  }

  /* -------- Summary panel: "Detalle del recurso seleccionado" -------- */

  function renderActResumenPanel(result) {
    const panel = document.getElementById('act-resumen-panel');
    if (!panel) return;
    if (!_actSelectedResource) {
      panel.innerHTML = '<p class="text-[12px] text-slate-500">Seleccione una barra del gráfico "Tickets Abiertos por Recurso (Servicios)" para ver el detalle de un recurso.</p>';
      return;
    }
    const recursoRows = result.rows.filter((r) => r.recursoAccion === _actSelectedResource);
    const realizar = recursoRows.filter((r) => r.accion === 'REALIZAR').length;
    const entregaFinal = recursoRows.filter((r) => r.accion === 'ENTREGA FINAL').length;
    // Total Asignados (Servicios) is read straight from recursosServicios --
    // the same count already shown by this resource's bar -- never
    // recomputed separately, per the spec.
    const asignadosEntry = result.recursosServicios.find((r) => r.label === _actSelectedResource);
    const asignados = asignadosEntry ? asignadosEntry.value : 0;

    panel.innerHTML =
      '<h4 class="text-sm font-bold text-slate-800 mb-3">' + escapeHtml(_actSelectedResource) + '</h4>' +
      '<div class="text-2xl font-extrabold text-slate-900 mb-3">' + asignados + '<span class="text-xs text-slate-400 font-semibold ml-1">asignados (servicios)</span></div>' +
      '<dl class="space-y-2 text-[12px]">' +
      '<div><dt class="text-slate-500">Total Tickets en Realizar</dt><dd class="font-semibold text-slate-800">' + realizar + '</dd></div>' +
      '<div><dt class="text-slate-500">Total Tickets en Entrega Final</dt><dd class="font-semibold text-slate-800">' + entregaFinal + '</dd></div>' +
      '</dl>';
  }

  /* -------- Entry point -------- */

  function renderActivos(tickets, opts) {
    opts = opts || {};
    _actAllTickets = tickets;
    if (opts.repopulateFilters !== false) populateActivosFilters(tickets);

    const filters = readActivosFilters();
    const result = M.buildActivos(tickets, filters);

    // A previously selected resource that no longer appears under the
    // current filters (e.g. narrowing Recurso excludes every ticket for it)
    // can't stay "selected" -- drop it and rebuild once, same guard as
    // Segundo Nivel's renderSegundoNivel.
    if (_actSelectedResource && !result.recursosServicios.some((r) => r.label === _actSelectedResource)) {
      _actSelectedResource = null;
      _actTablePage = 1;
      renderActivos(tickets, { repopulateFilters: false });
      return;
    }
    // Same guard for the Acción selection (porAccion is whole-universe, but
    // stays defensive against a future filter that could narrow it).
    if (_actSelectedAccion && !result.porAccion.some((a) => a.label === _actSelectedAccion)) {
      _actSelectedAccion = null;
      _actTablePage = 1;
      renderActivos(tickets, { repopulateFilters: false });
      return;
    }

    renderActivosKpis(result);
    renderActivosCharts(result);
    renderActTable(result);
    renderActResumenPanel(result);
  }

  function rerenderActivosWithCurrentFilters() {
    if (_actAllTickets.length) renderActivos(_actAllTickets, { repopulateFilters: false });
  }

  function clearActivosFilters() {
    if (!_actAllTickets.length) return;
    document.getElementById('filter-act-soporte-desde').value = '';
    document.getElementById('filter-act-soporte-hasta').value = '';
    document.getElementById('filter-act-entrega-desde').value = '';
    document.getElementById('filter-act-entrega-hasta').value = '';
    document.querySelectorAll('#filter-act-requerimientos-list .act-requerimiento-opt').forEach((el) => { el.checked = false; });
    const reqAllCheckbox = document.getElementById('filter-act-requerimientos-all');
    if (reqAllCheckbox) reqAllCheckbox.checked = true;
    updateActRequerimientosTriggerLabel();
    document.querySelectorAll('#filter-act-recurso-list .act-recurso-opt').forEach((el) => { el.checked = false; });
    const recAllCheckbox = document.getElementById('filter-act-recurso-all');
    if (recAllCheckbox) recAllCheckbox.checked = true;
    updateActRecursoTriggerLabel();
    _actSelectedResource = null;
    _actSelectedAccion = null;
    _actTablePage = 1;
    rerenderActivosWithCurrentFilters();
  }

  /* ==================== Segundo Nivel de Atención ====================
     Business rule (universe, Accion catalog, Recurso_Accion, Diagnostico
     graceful degradation) all live in buildSegundoNivel() (mapper.js) --
     this section only formats and draws, same division of labor as every
     other view above. */

  let _snAllTickets = [];
  // Set by clicking a bar on the Recurso_Accion chart -- narrows only the
  // table + insight panel below (see buildSegundoNivel's two-stage
  // filtering); never touches the four charts themselves.
  let _snSelectedResource = null;

  /* -------- Recursos multi-select (checkboxes, no library -- same widget
     pattern as Capacidad's own Recursos filter, no search box). -------- */

  function readSelectedSnRecursos() {
    return Array.from(document.querySelectorAll('#filter-sn-recursos-list .sn-recurso-opt:checked')).map((el) => el.value);
  }

  function updateSnRecursosTriggerLabel() {
    const trigger = document.getElementById('filter-sn-recursos-trigger');
    if (!trigger) return;
    const checked = readSelectedSnRecursos();
    if (!checked.length) trigger.textContent = 'Todos los recursos';
    else if (checked.length === 1) trigger.textContent = checked[0];
    else trigger.textContent = checked.length + ' seleccionados';
  }

  function renderSnRecursosOptions(recursos) {
    const list = document.getElementById('filter-sn-recursos-list');
    if (!list) return;
    const checkedBefore = new Set(readSelectedSnRecursos());
    list.innerHTML = recursos.map((r) => (
      '<label class="multi-select-option"><input type="checkbox" class="sn-recurso-opt" value="' + escapeHtml(r) + '"' +
      (checkedBefore.has(r) ? ' checked' : '') + ' /> ' + escapeHtml(r) + '</label>'
    )).join('');
  }

  let _snMultiSelectWired = false;
  function wireSnRecursosMultiSelect() {
    if (_snMultiSelectWired) return;
    _snMultiSelectWired = true;
    const trigger = document.getElementById('filter-sn-recursos-trigger');
    const panel = document.getElementById('filter-sn-recursos-panel');
    const allCheckbox = document.getElementById('filter-sn-recursos-all');
    const list = document.getElementById('filter-sn-recursos-list');
    if (!trigger || !panel || !allCheckbox || !list) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      trigger.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== trigger) {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    allCheckbox.addEventListener('change', () => {
      if (allCheckbox.checked) list.querySelectorAll('.sn-recurso-opt').forEach((el) => { el.checked = false; });
      updateSnRecursosTriggerLabel();
      rerenderSegundoNivelWithCurrentFilters();
    });

    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains('sn-recurso-opt')) return;
      allCheckbox.checked = list.querySelectorAll('.sn-recurso-opt:checked').length === 0;
      updateSnRecursosTriggerLabel();
      rerenderSegundoNivelWithCurrentFilters();
    });
  }

  /* -------- Filters: populate / read -------- */

  function populateSnFilters(tickets) {
    // buildSegundoNivel({}) computes recursoOptions/accionOptions over the
    // whole second-level universe with no filters applied -- same "options
    // don't shrink as you filter" pattern as Activos' Requerimientos.
    const defaults = M.buildSegundoNivel(tickets, {});
    renderSnRecursosOptions(defaults.recursoOptions);
    updateSnRecursosTriggerLabel();
    const accionSel = document.getElementById('filter-sn-accion');
    if (accionSel) {
      accionSel.innerHTML = '<option value="all">Todas</option>' +
        defaults.accionOptions.map((a) => '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>').join('');
    }
  }

  function readSnFilters() {
    const accionSel = document.getElementById('filter-sn-accion');
    return {
      recursos: readSelectedSnRecursos(),
      accion: accionSel ? accionSel.value : 'all',
      selectedResource: _snSelectedResource
    };
  }

  /* -------- KPI + charts -------- */

  function renderSnKpi(result) {
    document.getElementById('kpi-row-segundo-nivel').innerHTML = activoKpiCard('Total Requerimientos', result.kpis.total, '#1E293B');
  }

  function renderSnCharts(result) {
    // 1) Requerimientos por Recurso (Recurso_Accion) -- horizontal bar, same
    // ranked-list look as Activos' recursos-servicios chart (LIST_BAR_*),
    // plus a click handler: clicking a bar selects/deselects that resource
    // (highlighted in a deeper blue) and narrows the table + insight panel
    // below -- the bars here never disappear on click.
    const recursoDataset = Object.assign({}, LIST_BAR_DATASET, {
      label: 'Requerimientos',
      data: result.porRecurso.map((r) => r.value),
      backgroundColor: result.porRecurso.map((r) => r.label === _snSelectedResource ? C.COLORS.brandDeep : LIST_BAR_COLOR)
    });
    C.barChart('chart-sn-recurso', [recursoDataset], {
      horizontal: true, legend: false, labels: result.porRecurso.map((r) => r.label),
      layout: LIST_BAR_LAYOUT,
      yOpts: LIST_BAR_CATEGORY_AXIS,
      xOpts: LIST_BAR_VALUE_AXIS,
      dataLabels: LIST_BAR_DATA_LABELS,
      onClick: (evt, elements, chart) => {
        if (!elements.length) return;
        const label = chart.data.labels[elements[0].index];
        _snSelectedResource = (_snSelectedResource === label) ? null : label;
        rerenderSegundoNivelWithCurrentFilters();
      }
    });

    // 2) Cliente (top 10) -- horizontal bar, same ranked-list look and
    // scrolling box as Activos' "Recuento de Tickets por Cliente" chart
    // (LIST_BAR_*/CLIENTE_* shared constants above): the original vertical
    // column layout rotated long client names 45deg and read as clutter
    // past a handful of clients, so this mirrors the Activos pattern
    // instead of inventing a second look for the same kind of chart.
    C.chartEmptyState('chart-sn-cliente', !result.hasCliente, 'La plantilla OData no incluye la columna Cliente en la plantilla.');
    const snClienteRows = result.porCliente.length;
    const snClienteInner = document.getElementById('chart-sn-cliente').parentElement;
    const snClienteOuter = snClienteInner.parentElement;
    const snClienteVisiblePx = Math.min(snClienteRows, CLIENTE_MAX_VISIBLE) * CLIENTE_ROW_PX + CLIENTE_AXIS_PX;
    snClienteOuter.style.height = (snClienteRows ? snClienteVisiblePx : 340) + 'px';
    snClienteInner.style.height = (snClienteRows ? snClienteRows * CLIENTE_ROW_PX + CLIENTE_AXIS_PX : 340) + 'px';
    const snClienteAxis = Object.assign({}, LIST_BAR_CATEGORY_AXIS, {
      ticks: Object.assign({}, LIST_BAR_CATEGORY_AXIS.ticks, {
        callback: function (value) {
          return fitLabelToScale(this, truncateLabel(this.getLabelForValue(value), CLIENTE_LABEL_MAX_CHARS), LIST_BAR_CATEGORY_AXIS.ticks.font.size);
        }
      })
    });
    C.barChart('chart-sn-cliente', [Object.assign({
      label: 'Requerimientos',
      data: result.porCliente.map((c) => c.value)
    }, LIST_BAR_DATASET)], {
      horizontal: true, legend: false, labels: result.porCliente.map((c) => c.label),
      layout: LIST_BAR_LAYOUT,
      yOpts: snClienteAxis,
      xOpts: Object.assign({}, LIST_BAR_VALUE_AXIS, {
        title: { display: true, text: 'Total Requerimientos', color: '#94A3B8', font: { size: 11 } }
      }),
      tooltipOpts: {
        callbacks: {
          title: (items) => items[0].label,
          label: (item) => item.parsed.x + ' requerimientos'
        }
      },
      dataLabels: LIST_BAR_DATA_LABELS
    });

    // 3) Diagnóstico -- donut, same degradation as Cliente above when the
    // column is absent (verified absent against both the live OData
    // template shape and data/sample-tickets.json -- see normalizeTickets'
    // CANONICAL_ALIASES.diagnostico).
    C.chartEmptyState('chart-sn-diagnostico', !result.hasDiagnostico, 'La plantilla OData no incluye la columna Diagnóstico en la plantilla.');
    const diagnosticoColors = result.porDiagnostico.map((_, i) => C.PRODUCTO_COLORS[i % C.PRODUCTO_COLORS.length]);
    C.doughnut('chart-sn-diagnostico', result.porDiagnostico.map((d) => d.label), result.porDiagnostico.map((d) => d.value), diagnosticoColors, { showPercent: true, cutout: '60%' });

    // 4) Producto -- donut, whole filtered universe (Producto always exists).
    const productoColors = result.porProducto.map((_, i) => C.PRODUCTO_COLORS[i % C.PRODUCTO_COLORS.length]);
    C.doughnut('chart-sn-producto', result.porProducto.map((p) => p.label), result.porProducto.map((p) => p.value), productoColors, { showPercent: true, cutout: '60%' });
  }

  /* -------- Table -------- */

  const SN_TABLE_COLUMNS = ['ID', 'Recurso', 'Cliente', 'Producto', 'Accion', 'Asunto'];

  function snRowsHtml(rows) {
    return rows.length
      ? rows.map((r) => (
          '<tr>' +
          '<td class="det-id">' + escapeHtml(r.id) + '</td>' +
          '<td>' + escapeHtml(r.recurso) + '</td>' +
          '<td>' + (r.cliente == null ? '—' : escapeHtml(r.cliente)) + '</td>' +
          '<td>' + escapeHtml(r.producto) + '</td>' +
          '<td>' + escapeHtml(r.accion) + '</td>' +
          '<td>' + (r.asunto == null ? '—' : escapeHtml(r.asunto)) + '</td>' +
          '</tr>'
        )).join('')
      : '<tr><td colspan="' + SN_TABLE_COLUMNS.length + '" style="text-align:center;color:#94A3B8;padding:20px;">Sin requerimientos para los filtros seleccionados.</td></tr>';
  }

  function renderSnTable(result) {
    document.getElementById('table-segundo-nivel-head').innerHTML = '<tr>' + SN_TABLE_COLUMNS.map((h) => '<th>' + h + '</th>').join('') + '</tr>';
    document.getElementById('table-segundo-nivel-body').innerHTML = snRowsHtml(result.rows);
  }

  /* -------- Insight panel -------- */

  function snNarrative(insight) {
    const parts = [insight.recurso + ' tiene ' + insight.total + (insight.total === 1 ? ' requerimiento' : ' requerimientos') + ' de segundo nivel en los filtros actuales'];
    if (insight.topAccion) parts.push('la acción más frecuente es ' + insight.topAccion.label);
    if (insight.topProducto) parts.push('el producto más frecuente es ' + insight.topProducto.label);
    if (insight.topDiagnostico) parts.push('el diagnóstico más frecuente es ' + insight.topDiagnostico.label);
    return parts.join(', ') + '.';
  }

  function renderSnInsight(result) {
    const panel = document.getElementById('sn-insight-panel');
    if (!panel) return;
    const insight = result.insight;
    if (!insight) {
      panel.innerHTML = '<p class="text-[12px] text-slate-500">Seleccione una barra del gráfico "Requerimientos por Recurso" para ver el detalle de un recurso.</p>';
      return;
    }
    panel.innerHTML =
      '<h4 class="text-sm font-bold text-slate-800 mb-3">' + escapeHtml(insight.recurso) + '</h4>' +
      '<div class="text-2xl font-extrabold text-slate-900 mb-3">' + insight.total + '<span class="text-xs text-slate-400 font-semibold ml-1">requerimientos</span></div>' +
      '<dl class="space-y-2 text-[12px]">' +
      '<div><dt class="text-slate-500">Producto principal</dt><dd class="font-semibold text-slate-800">' + (insight.topProducto ? escapeHtml(insight.topProducto.label) + ' (' + insight.topProducto.value + ')' : '—') + '</dd></div>' +
      '<div><dt class="text-slate-500">Diagnóstico principal</dt><dd class="font-semibold text-slate-800">' + (insight.topDiagnostico ? escapeHtml(insight.topDiagnostico.label) + ' (' + insight.topDiagnostico.value + ')' : '—') + '</dd></div>' +
      '<div><dt class="text-slate-500">Acción principal</dt><dd class="font-semibold text-slate-800">' + (insight.topAccion ? escapeHtml(insight.topAccion.label) + ' (' + insight.topAccion.value + ')' : '—') + '</dd></div>' +
      '</dl>' +
      '<p class="text-[12px] text-slate-600 mt-3 italic">' + escapeHtml(snNarrative(insight)) + '</p>';
  }

  /* -------- Entry point -------- */

  function renderSegundoNivel(tickets, opts) {
    opts = opts || {};
    _snAllTickets = tickets;
    if (opts.repopulateFilters !== false) populateSnFilters(tickets);

    const filters = readSnFilters();
    const result = M.buildSegundoNivel(tickets, filters);

    // A previously selected resource that no longer appears under the
    // current Recursos/Accion filters (e.g. narrowing Accion excludes every
    // ticket for it) can't stay "selected" -- drop it and rebuild once so
    // the table/insight panel never show a stale selection.
    if (_snSelectedResource && !result.porRecurso.some((r) => r.label === _snSelectedResource)) {
      _snSelectedResource = null;
      renderSegundoNivel(tickets, { repopulateFilters: false });
      return;
    }

    renderSnKpi(result);
    renderSnCharts(result);
    renderSnTable(result);
    renderSnInsight(result);
  }

  function rerenderSegundoNivelWithCurrentFilters() {
    if (_snAllTickets.length) renderSegundoNivel(_snAllTickets, { repopulateFilters: false });
  }

  function clearSegundoNivelFilters() {
    if (!_snAllTickets.length) return;
    document.querySelectorAll('#filter-sn-recursos-list .sn-recurso-opt').forEach((el) => { el.checked = false; });
    const allCheckbox = document.getElementById('filter-sn-recursos-all');
    if (allCheckbox) allCheckbox.checked = true;
    updateSnRecursosTriggerLabel();
    const accionSel = document.getElementById('filter-sn-accion');
    if (accionSel) accionSel.value = 'all';
    _snSelectedResource = null;
    rerenderSegundoNivelWithCurrentFilters();
  }

  window.SOFIA_RENDER = {
    renderResumen: renderResumen,
    rerenderWithCurrentFilters: rerenderWithCurrentFilters,
    renderCapacidad: renderCapacidad,
    rerenderCapWithCurrentFilters: rerenderCapWithCurrentFilters,
    clearCapacidadFilters: clearCapacidadFilters,
    wireCapRecursosMultiSelect: wireCapRecursosMultiSelect,
    onCapClienteChange: onCapClienteChange,
    onCapGaugeFiltersChange: onCapGaugeFiltersChange,
    wireDrilldownModal: wireDrilldownModal,
    wireCapExtraSourcesNotice: wireCapExtraSourcesNotice,
    renderActivos: renderActivos,
    rerenderActivosWithCurrentFilters: rerenderActivosWithCurrentFilters,
    clearActivosFilters: clearActivosFilters,
    wireActRequerimientosMultiSelect: wireActRequerimientosMultiSelect,
    wireActRecursoMultiSelect: wireActRecursoMultiSelect,
    wireActTablePager: wireActTablePager,
    renderSegundoNivel: renderSegundoNivel,
    rerenderSegundoNivelWithCurrentFilters: rerenderSegundoNivelWithCurrentFilters,
    clearSegundoNivelFilters: clearSegundoNivelFilters,
    wireSnRecursosMultiSelect: wireSnRecursosMultiSelect
  };
})();
