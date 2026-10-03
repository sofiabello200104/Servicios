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
  // Capacidad's team: the M.CAP_CARD_RECURSOS people present in the data,
  // under their canonical buildCapacidad names. Set by populateCapFilters.
  let _capTeam = [];

  function formatHoras(n) { return (Number(n) || 0).toFixed(1); }
  function formatPct(n) { return (Number(n) || 0).toFixed(1); }
  // es-CO grouping: 1.234 tickets, 37,5 min.
  const _fmtEntero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const _fmtMinutos = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function formatEntero(n) { return _fmtEntero.format(Number(n) || 0); }
  function formatMinutos(n) { return _fmtMinutos.format(Number(n) || 0); }

  function isoToDMY(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
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

    // Team = buildCapacidad's own resource names (already without "Sin dato"
    // and with accent/casing variants fused across the 5 sources), narrowed
    // to M.CAP_CARD_RECURSOS. Using the canonical names means every option
    // matches a team key exactly when passed back as filters.recursos.
    const defaults = M.buildCapacidad(tickets, {}, extraRows);
    const recursos = defaults.porRecurso
      .map((r) => r.recurso)
      .filter((r) => M.isRecursoInList(r, M.CAP_CARD_RECURSOS))
      .sort();
    _capTeam = recursos;
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

    const isFirstLoad = !desdeInput.value || !hastaInput.value;
    if (isFirstLoad) {
      desdeInput.value = defaults.periodo.from;
      hastaInput.value = defaults.periodo.to;
    }
  }

  function readCapFilters() {
    // Nothing ticked = "Todos los recursos" = the whole Capacidad team
    // (_capTeam), not every person in the feed -- so KPIs, charts and cards
    // all count the same people the filter offers.
    const selected = readSelectedRecursos();
    return {
      from: document.getElementById('filter-cap-desde').value,
      to: document.getElementById('filter-cap-hasta').value,
      recursos: selected.length ? selected : _capTeam.slice(),
      // Explicit pick only (empty = nobody ticked); used by the CountAll KPI.
      recursosSeleccion: selected,
      cliente: document.getElementById('filter-cap-cliente').value,
      proyecto: document.getElementById('filter-cap-proyecto').value
    };
  }

  /* -------- KPIs -------- */

  // ticketStats = M.buildTicketStatsPorRecurso(...) for the same filters --
  // computed once in renderCapacidad. The "Total Tickets Atendidos" card
  // reads ticketStats.todos (CountAll over the whole ticket source in the
  // period), so it can exceed the sum of the team's bars in the chart.
  function renderCapKpis(result, ticketStats) {
    const k = result.kpis;
    const tot = ticketStats.todos;

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
    // 5th KPI: Total Tickets Atendidos (CountAll) + promedio general
    // de minutos por ticket. "—" when no ticket in range has a Minutos value
    // (or the template lacks the column) instead of a misleading "0 min".
    const promedioTxt = tot.promedioMinutos != null ? formatMinutos(tot.promedioMinutos) + ' min' : '—';
    const promedioHint = !ticketStats.hasMinutos
      ? 'La plantilla no incluye la columna Minutos'
      : 'Promedio de tiempo por ticket';
    cards.push(
      '<div class="card p-4">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight" title="Todos los tickets de ID12086_Tickets_medidor con Fecha dentro del periodo">Total Tickets Atendidos</div>' +
      '<div class="mt-3 flex items-baseline gap-2">' +
      '<div class="text-2xl font-extrabold text-slate-900 kpi-num">' + formatEntero(tot.tickets) + '</div>' +
      '<span class="text-sm text-slate-400 font-medium">tickets</span>' +
      '</div>' +
      '<div class="text-[11px] text-slate-500 mt-1" title="' + escapeHtml(promedioHint) + '">' +
      'Promedio: <strong class="text-slate-700">' + escapeHtml(promedioTxt) + '</strong> por ticket</div>' +
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

  /* -------- Grouped bar: Avg minutes + ticket count per resource -------- */

  const CAP_TICKETS_COLORS = { promedio: '#0099FF', recuento: '#002299' };

  // Full name on the X axis, split in two lines (nombres / apellidos) so the
  // 12 people fit side by side without rotating the labels. Chart.js draws
  // an array label as one line per item. With 4+ words the split falls after
  // the 2nd word (Colombian convention: two given names, two surnames).
  function axisRecursoName(full) {
    const w = String(full || '').trim().split(/\s+/);
    if (w.length <= 2) return w;
    const cut = w.length >= 4 ? 2 : 1;
    return [w.slice(0, cut).join(' '), w.slice(cut).join(' ')];
  }

  // ticketStats = M.buildTicketStatsPorRecurso(tickets, filters): one row per
  // resource in the filter's team (0-ticket people included), in list order.
  function renderCapTicketsBar(ticketStats) {
    const rows = ticketStats.porRecurso;
    const labels = rows.map((r) => axisRecursoName(r.recurso));
    const fullNames = rows.map((r) => r.recurso);
    // null (no Minutos value) -> no bar and no label, rather than a fake 0.
    const avgData = rows.map((r) => r.promedioMinutos);
    const countData = rows.map((r) => r.tickets);

    const hasData = rows.some((r) => r.tickets > 0);
    C.chartEmptyState('chart-cap-tickets-stats', !hasData, 'Sin tickets para los filtros seleccionados');

    const noteEl = document.getElementById('chart-cap-tickets-stats-note');
    if (noteEl) {
      const tot = ticketStats.totales;
      const parts = [
        'Tickets del equipo: ' + formatEntero(tot.tickets) + ' (de ' + formatEntero(ticketStats.todos.tickets) + ' en total)',
        'Promedio del equipo: ' + (tot.promedioMinutos != null ? formatMinutos(tot.promedioMinutos) + ' min/ticket' : '—'),
        'Período (por Fecha del ticket): ' + isoToDMY(ticketStats.periodo.from) + ' – ' + isoToDMY(ticketStats.periodo.to)
      ];
      let text = parts.join(' · ');
      if (!ticketStats.hasMinutos) {
        text += '. La plantilla OData no incluye la columna Minutos: la serie "Promedio de Minutos" no se puede calcular.';
      }
      noteEl.textContent = text;
    }

    const labelFor = (color, fmt) => ({
      display: (ctx) => {
        const v = ctx.dataset.data[ctx.dataIndex];
        return v != null && v > 0;
      },
      anchor: 'end',
      align: 'end',
      offset: 2,
      color: color,
      font: { weight: '700', size: 10 },
      formatter: fmt
    });

    C.barChart('chart-cap-tickets-stats', [
      {
        label: 'Promedio de Minutos',
        data: avgData,
        backgroundColor: CAP_TICKETS_COLORS.promedio,
        borderRadius: 4,
        maxBarThickness: 28,
        datalabels: labelFor(CAP_TICKETS_COLORS.promedio, (v) => formatMinutos(v))
      },
      {
        label: 'Recuento de Tickets',
        data: countData,
        backgroundColor: CAP_TICKETS_COLORS.recuento,
        borderRadius: 4,
        maxBarThickness: 28,
        datalabels: labelFor(CAP_TICKETS_COLORS.recuento, (v) => formatEntero(v))
      }
    ], {
      labels: labels,
      dataLabels: true,
      xOpts: { ticks: { autoSkip: false, font: { size: 11 }, maxRotation: 0, minRotation: 0 } },
      yOpts: { beginAtZero: true, grace: '12%', title: { display: true, text: 'Minutos / Tickets', color: '#94A3B8', font: { size: 11 } } },
      tooltipOpts: {
        callbacks: {
          title: (items) => fullNames[items[0].dataIndex],
          label: (item) => {
            const r = rows[item.dataIndex];
            if (item.datasetIndex === 0) {
              return r.promedioMinutos != null
                ? 'Promedio: ' + formatMinutos(r.promedioMinutos) + ' min/ticket (' + formatEntero(r.conMinutos) + ' con dato)'
                : 'Promedio: sin dato de minutos';
            }
            return 'Tickets: ' + formatEntero(r.tickets);
          }
        }
      }
    });
  }

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

  // The card grid replaced the sortable table head: this <select> carries the
  // same _capSortState the header arrows used to drive, so sorting survives
  // the redesign. Wired once -- the grid is re-rendered on change.
  let _capSortWired = false;
  function wireCapCardsSort() {
    if (_capSortWired) return;
    const sel = document.getElementById('cap-cards-sort');
    if (!sel) return;
    _capSortWired = true;
    sel.addEventListener('change', () => {
      const [key, dir] = sel.value.split('-');
      _capSortState.key = key;
      _capSortState.dir = dir;
      renderCapCards();
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
  // itself was rendered with, plus
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

  // One resource card: avatar with initials, name, % Uso progress bar, the
  // three hour figures and the semaphore badge. Avatar and bar fill reuse
  // r.color (mapper.js UMBRALES' colorBadge), the SAME value the badge already
  // used -- the colour scale is not duplicated here.
  // The bar is capped at 100% width so a Saturado resource (>100%) doesn't
  // overflow its track, while the numeric label still shows the real figure.
  function capCardHtml(r) {
    const pct = Number(r.pct) || 0;
    const barWidth = Math.min(Math.max(pct, 0), 100);
    return '' +
      '<article class="cap-card">' +
        '<div class="cap-card-head">' +
          '<div class="cap-avatar" style="background:' + escapeHtml(r.color) + ';" aria-hidden="true">' +
            escapeHtml(M.initialsFromName(r.recurso)) +
          '</div>' +
          '<div class="cap-card-name">' + escapeHtml(r.recurso) + '</div>' +
        '</div>' +
        '<div class="cap-progress-row">' +
          '<div class="cap-progress" role="progressbar" aria-label="% Uso de ' + escapeHtml(r.recurso) + '"' +
            ' aria-valuenow="' + formatPct(r.pct) + '" aria-valuemin="0" aria-valuemax="100">' +
            '<div class="cap-progress-fill" style="width:' + barWidth + '%;background:' + escapeHtml(r.color) + ';"></div>' +
          '</div>' +
          '<span class="cap-progress-pct">' + formatPct(r.pct) + '%</span>' +
        '</div>' +
        '<dl class="cap-card-stats">' +
          // Capacity = 7 h/día base + hours booked inside the franjas de
          // trámite (12:00-12:50, 17:00-17:30); the extra is shown so the
          // figure can be traced back.
          '<div class="cap-card-stat"' + (r.horasEnFranjaTramite > 0
            ? ' title="Base ' + formatHoras(r.capacidadBase) + ' h + ' + formatHoras(r.horasEnFranjaTramite) + ' h agendadas en franjas de trámite"' : '') + '>' +
            '<dt>Capacidad</dt><dd>' + formatHoras(r.capacidad) + ' h' +
            (r.horasEnFranjaTramite > 0 ? '<span class="block text-[10px] font-medium text-sky-700">+' + formatHoras(r.horasEnFranjaTramite) + ' h en trámite</span>' : '') +
            '</dd></div>' +
          '<div class="cap-card-stat"><dt>Reservadas</dt><dd>' + formatHoras(r.reservadas) + ' h</dd></div>' +
          '<div class="cap-card-stat"><dt>Disponibles</dt><dd>' + formatHoras(r.disponibles) + ' h</dd></div>' +
        '</dl>' +
        '<div class="cap-card-foot">' +
          '<span class="cap-badge ' + escapeHtml(r.badgeClass) + '">' + escapeHtml(r.estado) + '</span>' +
          '<button type="button" class="cap-analizar-btn" data-recurso="' + escapeHtml(r.recurso) + '">Analizar</button>' +
        '</div>' +
      '</article>';
  }

  function renderCapCards() {
    const grid = document.getElementById('cap-cards-grid');
    if (!grid) return;
    // Only the people in M.CAP_CARD_RECURSOS get a card; the rest of the
    // view (KPIs, charts) keeps the whole team.
    const shown = M.filterRecursosByList(_capLastPorRecurso, M.CAP_CARD_RECURSOS);
    const sorted = sortCapRows(shown, _capSortState.key, _capSortState.dir);
    if (!sorted.length) {
      grid.innerHTML = '<p class="cap-cards-empty">Sin recursos para los filtros seleccionados.</p>';
      return;
    }
    grid.innerHTML = sorted.map(capCardHtml).join('');

    grid.querySelectorAll('.cap-analizar-btn').forEach((btn) => {
      btn.addEventListener('click', () => openDrilldownModal(btn.dataset.recurso, btn));
    });
  }

  // `filters` is stashed here so the drill-down modal (triggered later, by a
  // click on "Analizar") can reconstruct the exact same row set via
  // buildRecursoTickets() under the SAME main period/cliente/proyecto.
  function renderCapTable(result, filters) {
    _capLastPorRecurso = result.porRecurso;
    _capLastFilters = filters;
    wireCapCardsSort();
    renderCapCards();
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
    if (opts.repopulateFilters !== false) populateCapFilters(tickets, _capExtraRows);

    const filters = readCapFilters();
    const result = M.buildCapacidad(tickets, filters, _capExtraRows);
    const ticketStats = M.buildTicketStatsPorRecurso(tickets, filters);

    renderCapKpis(result, ticketStats);
    renderCapTicketsBar(ticketStats);
    renderCapTable(result, filters);
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
    rerenderCapWithCurrentFilters();
  }

  /* ==================== Primer / Segundo Nivel de Atención ====================
     Both views are the same page built from one template, createNivelView(cfg):
       cfg.prefix  -- element-id prefix in index.html ('act' Primer Nivel,
                      'sn' Segundo Nivel): filter-<p>-..., chart-<p>-...,
                      kpi-row-<p>, btn-<p>-limpiar, <p>-resumen-panel, ...
       cfg.acciones -- acciones the view considers (M.buildActivos opts.acciones)
       cfg.cards    -- one KPI card per acción: { title, accion, color }; also
                      the Acción filter options, in that order
       cfg.aliases  -- { filter label: other feed spelling } for one acción
       cfg.equipo   -- optional team list; others are grouped as "Otro"
     Any change here applies to both levels. */
  function createNivelView(cfg) {
  const P = cfg.prefix;

  /* ==================== Tickets Activos ====================
     Business rules (Estado universe, Servicios/Calidad buckets, Recurso_Accion,
     requerimientoOpcion graceful degradation) all live in buildActivos()
     (mapper.js) -- this section only formats and draws, same division of
     labor as Resumen/Capacidad above. */

  let _actAllTickets = [];
  // Set by clicking a bar on chart-act-recursos-servicios -- narrows only
  // the table + summary panel below, never the charts themselves. Same
  // click-to-select pattern in both levels.
  let _actSelectedResource = null;
  // Acciones picked in the Acción multi-select or toggled by clicking an
  // acción KPI card; empty = all 4. Narrows the table and the summary panel
  // (ANDed with _actSelectedResource when both are set).
  let _actSelectedAcciones = [];

  // KPI cards with an accent color per card (Tickets Activos / one per
  // acción) -- kpiCard()'s chip/stripe system
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

  // Tickets Activos = active tickets in the 4 Primer Nivel acciones
  // (inside the Fecha de creación range + Recurso/Requerimiento filters),
  // then one card per acción. The acción cards replace the removed "Tickets
  // Abiertos por Acción" chart: clicking one toggles that acción in the
  // Acción filter (selected cards get a ring, the rest fade).
  const ACT_ACCION_CARDS = cfg.cards;

  function renderActivosKpis(result) {
    const opciones = actAccionOptions(result); // same labels as the Acción filter
    const count = (accion) => result.porAccion
      .filter((a) => sameAccion(a.label, accion))
      .reduce((s, a) => s + a.value, 0);
    const cards = [activoKpiCard('Tickets Activos', formatEntero(result.kpis.totalAcciones), '#1E293B')];
    ACT_ACCION_CARDS.forEach((c) => {
      const value = opciones.find((o) => sameAccion(o, c.accion)) || c.accion;
      const selected = _actSelectedAcciones.indexOf(value) !== -1;
      const faded = _actSelectedAcciones.length && !selected;
      cards.push(
        '<button type="button" class="card p-4 text-left w-full transition' + (selected ? ' ring-2 ring-offset-1' : '') + '"' +
        ` data-${P}-accion="` + escapeHtml(value) + '" aria-pressed="' + selected + '"' +
        ' title="Clic para filtrar ' + escapeHtml(value) + '"' +
        ' style="' + (selected ? '--tw-ring-color:' + c.color + ';' : '') + (faded ? 'opacity:.55;' : '') + '">' +
        '<div class="text-[12px] font-semibold text-slate-700 leading-tight">' + c.title + '</div>' +
        '<div class="mt-3 text-2xl font-extrabold kpi-num" style="color:' + c.color + ';">' + formatEntero(count(c.accion)) + '</div>' +
        '</button>'
      );
    });
    const row = document.getElementById(`kpi-row-${P}`);
    row.innerHTML = cards.join('');
    if (!row.dataset.wired) {
      row.dataset.wired = '1';
      row.addEventListener('click', (e) => {
        const btn = e.target.closest(`[data-${P}-accion]`);
        if (!btn) return;
        const accion = btn.getAttribute(`data-${P}-accion`);
        _actSelectedAcciones = _actSelectedAcciones.indexOf(accion) !== -1
          ? _actSelectedAcciones.filter((x) => x !== accion)
          : _actSelectedAcciones.concat([accion]);
        // Picking all 4 is the same as "Todas".
        if (_actSelectedAcciones.length >= ACT_ACCION_CARDS.length) _actSelectedAcciones = [];
        _actTablePage = 1;
        rerenderActivosWithCurrentFilters();
      });
    }
  }

  // Acción multi-select: only the 4 Primer Nivel acciones, names only.
  // _actSelectedAcciones empty = all 4 (the default: every box checked).
  // "AGENDAR ENTREGA FINAL" and the feed's "AGENDA ENTREGA FINAL" are one
  // option, labelled with whichever spelling the data uses.
  const ACT_ACCIONES_BASE = cfg.cards.map((c) => c.accion);
  // cfg.aliases: { label shown in the filter: other spelling in the feed }.
  // Both spellings are one option, labelled with whichever the data uses.
  const ACT_ALIASES = cfg.aliases || {};
  function sameAccion(a, b) {
    return a === b || ACT_ALIASES[a] === b || ACT_ALIASES[b] === a;
  }
  function actAccionOptions(result) {
    const present = result.porAccion.map((a) => a.label);
    return ACT_ACCIONES_BASE.map((a) => {
      const alt = ACT_ALIASES[a];
      return alt && present.indexOf(alt) !== -1 && present.indexOf(a) === -1 ? alt : a;
    });
  }


  function updateActAccionTriggerLabel() {
    const trigger = document.getElementById(`filter-${P}-accion-trigger`);
    if (!trigger) return;
    if (!_actSelectedAcciones.length) trigger.textContent = 'Todas (' + ACT_ACCIONES_BASE.length + ')';
    else if (_actSelectedAcciones.length === 1) trigger.textContent = _actSelectedAcciones[0];
    else trigger.textContent = _actSelectedAcciones.length + ' seleccionadas';
  }

  function renderActAccionOptions(result) {
    const list = document.getElementById(`filter-${P}-accion-list`);
    if (!list) return;
    const selected = new Set(_actSelectedAcciones);
    const all = !_actSelectedAcciones.length;
    list.innerHTML = actAccionOptions(result).map((a) => (
      `<label class="multi-select-option"><input type="checkbox" class="${P}-accion-opt" value="` + escapeHtml(a) + '"' +
      (all || selected.has(a) ? ' checked' : '') + ' /> ' + escapeHtml(a) + '</label>'
    )).join('');
    const allBox = document.getElementById(`filter-${P}-accion-all`);
    if (allBox) allBox.checked = all;
    updateActAccionTriggerLabel();
  }

  let _actAccionMultiSelectWired = false;
  function wireActAccionMultiSelect() {
    if (_actAccionMultiSelectWired) return;
    _actAccionMultiSelectWired = true;
    const trigger = document.getElementById(`filter-${P}-accion-trigger`);
    const panel = document.getElementById(`filter-${P}-accion-panel`);
    const allCheckbox = document.getElementById(`filter-${P}-accion-all`);
    const list = document.getElementById(`filter-${P}-accion-list`);
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
    // "Todas" always means all 4 (unchecking it would leave nothing to show,
    // so it just re-checks itself).
    allCheckbox.addEventListener('change', () => {
      _actSelectedAcciones = [];
      _actTablePage = 1;
      rerenderActivosWithCurrentFilters();
    });
    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains(`${P}-accion-opt`)) return;
      const boxes = Array.from(list.querySelectorAll(`.${P}-accion-opt`));
      const checked = boxes.filter((el) => el.checked).map((el) => el.value);
      // All or none checked -> back to the default (all 4).
      _actSelectedAcciones = (checked.length === 0 || checked.length === boxes.length) ? [] : checked;
      _actTablePage = 1;
      rerenderActivosWithCurrentFilters();
    });
  }

  function renderActivosCharts(result) {
    // 1) Tickets por Recurso -- horizontal bar, single
    // series, already sorted desc by buildActivos. Bar click selects/
    // deselects that resource (highlighted in a deeper blue, toggle on
    // second click) and narrows the table + summary panel below -- exact
    // same interaction as Segundo Nivel's chart-sn-recurso, never the bars
    // themselves.
    C.barChart(`chart-${P}-recursos-servicios`, [Object.assign({}, LIST_BAR_DATASET, {
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
        // Deferred: redrawing destroys this chart, which Chart.js is still
        // dispatching the click on ("reading 'handleEvent'" otherwise).
        setTimeout(rerenderActivosWithCurrentFilters, 0);
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
    C.chartEmptyState(`chart-${P}-cliente`, !result.hasCliente, 'La plantilla OData no incluye la columna Cliente en la plantilla.');
    const clienteRows = result.porCliente.length;
    const clienteValues = result.porCliente.map((c) => c.value);
    const clienteInner = document.getElementById(`chart-${P}-cliente`).parentElement;
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
    C.barChart(`chart-${P}-cliente`, [Object.assign({
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
  }

  /* -------- Nota sobre fechas futuras (bajo las tarjetas) -------- */
  // Dynamic line of the "Nota sobre fechas" banner: how many tickets the
  // current range leaves out because their support is scheduled after
  // "hasta", or -- when nothing is left out -- how many of the counted
  // tickets are scheduled after today. Hidden when neither applies.
  function renderActFechasNota(result) {
    const el = document.getElementById(`${P}-fechas-detalle`);
    if (!el) return;
    const f = result.fechasFuturas;
    const desglose = (porAccion) => {
      const parts = Object.keys(porAccion).sort((a, b) => porAccion[b] - porAccion[a])
        .map((a) => formatEntero(porAccion[a]) + ' en ' + a.charAt(0) + a.slice(1).toLowerCase());
      return parts.length ? ' (' + parts.join(', ') + ')' : '';
    };
    let html = '';
    if (f && f.excluidosPosterior > 0) {
      html = '<strong>Con el rango actual</strong> quedan fuera <strong>' + formatEntero(f.excluidosPosterior) + '</strong> tickets con soporte programado después del ' +
        escapeHtml(isoToDMY(f.hasta)) + escapeHtml(desglose(f.excluidosPorAccion)) + '. Amplíe la fecha «hasta» para incluirlos.';
    } else if (f && f.futuros > 0) {
      html = '<strong>El total actual incluye</strong> <strong>' + formatEntero(f.futuros) + '</strong> tickets con soporte programado después de hoy, ' +
        escapeHtml(isoToDMY(f.hoy)) + escapeHtml(desglose(f.futurosPorAccion)) + '.';
    }
    el.innerHTML = html;
    el.hidden = !html;
  }

  /* -------- Requerimientos / Opciones: searchable multiselect -------- */
  /* Hidden entirely when buildActivos reports hasRequerimiento:false (the
     Requerimiento_Opcion column doesn't exist in the feed yet) -- same
     graceful-degradation approach as Capacidad's Cliente filter. */

  function readSelectedActRequerimientos() {
    return Array.from(document.querySelectorAll(`#filter-${P}-requerimientos-list .${P}-requerimiento-opt:checked`)).map((el) => el.value);
  }

  function updateActRequerimientosTriggerLabel() {
    const trigger = document.getElementById(`filter-${P}-requerimientos-trigger`);
    if (!trigger) return;
    const checked = readSelectedActRequerimientos();
    if (!checked.length) trigger.textContent = 'Todos';
    else if (checked.length === 1) trigger.textContent = checked[0];
    else trigger.textContent = checked.length + ' seleccionados';
  }

  function renderActRequerimientosOptions(options) {
    const list = document.getElementById(`filter-${P}-requerimientos-list`);
    if (!list) return;
    const checkedBefore = new Set(readSelectedActRequerimientos());
    list.innerHTML = options.map((o) => (
      `<label class="multi-select-option"><input type="checkbox" class="${P}-requerimiento-opt" value="` + escapeHtml(o) + '"' +
      (checkedBefore.has(o) ? ' checked' : '') + ' /> ' + escapeHtml(o) + '</label>'
    )).join('');
  }

  let _actMultiSelectWired = false;
  function wireActRequerimientosMultiSelect() {
    if (_actMultiSelectWired) return;
    _actMultiSelectWired = true;
    const trigger = document.getElementById(`filter-${P}-requerimientos-trigger`);
    const panel = document.getElementById(`filter-${P}-requerimientos-panel`);
    const allCheckbox = document.getElementById(`filter-${P}-requerimientos-all`);
    const list = document.getElementById(`filter-${P}-requerimientos-list`);
    const search = document.getElementById(`filter-${P}-requerimientos-search`);
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
      if (allCheckbox.checked) list.querySelectorAll(`.${P}-requerimiento-opt`).forEach((el) => { el.checked = false; });
      updateActRequerimientosTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains(`${P}-requerimiento-opt`)) return;
      allCheckbox.checked = list.querySelectorAll(`.${P}-requerimiento-opt:checked`).length === 0;
      updateActRequerimientosTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    // Client-side search over the option labels -- no library, filters the
    // visible rows by a case-insensitive substring match as the user types.
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        list.querySelectorAll(`.${P}-requerimiento-opt`).forEach((el) => {
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
    return Array.from(document.querySelectorAll(`#filter-${P}-recurso-list .${P}-recurso-opt:checked`)).map((el) => el.value);
  }

  function updateActRecursoTriggerLabel() {
    const trigger = document.getElementById(`filter-${P}-recurso-trigger`);
    if (!trigger) return;
    const checked = readSelectedActRecursos();
    if (!checked.length) trigger.textContent = 'Todos los recursos';
    else if (checked.length === 1) trigger.textContent = checked[0];
    else trigger.textContent = checked.length + ' seleccionados';
  }

  function renderActRecursoOptions(options) {
    const list = document.getElementById(`filter-${P}-recurso-list`);
    if (!list) return;
    const checkedBefore = new Set(readSelectedActRecursos());
    list.innerHTML = options.map((o) => (
      `<label class="multi-select-option"><input type="checkbox" class="${P}-recurso-opt" value="` + escapeHtml(o) + '"' +
      (checkedBefore.has(o) ? ' checked' : '') + ' /> ' + escapeHtml(o) + '</label>'
    )).join('');
  }

  let _actRecursoMultiSelectWired = false;
  function wireActRecursoMultiSelect() {
    if (_actRecursoMultiSelectWired) return;
    _actRecursoMultiSelectWired = true;
    const trigger = document.getElementById(`filter-${P}-recurso-trigger`);
    const panel = document.getElementById(`filter-${P}-recurso-panel`);
    const allCheckbox = document.getElementById(`filter-${P}-recurso-all`);
    const list = document.getElementById(`filter-${P}-recurso-list`);
    const search = document.getElementById(`filter-${P}-recurso-search`);
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
      if (allCheckbox.checked) list.querySelectorAll(`.${P}-recurso-opt`).forEach((el) => { el.checked = false; });
      updateActRecursoTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    list.addEventListener('change', (e) => {
      if (!e.target.classList.contains(`${P}-recurso-opt`)) return;
      allCheckbox.checked = list.querySelectorAll(`.${P}-recurso-opt:checked`).length === 0;
      updateActRecursoTriggerLabel();
      rerenderActivosWithCurrentFilters();
    });

    // Client-side search over the option labels -- same no-library pattern
    // as the Requerimientos search box above.
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        list.querySelectorAll(`.${P}-recurso-opt`).forEach((el) => {
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
    const defaults = M.buildActivos(tickets, {}, { equipo: cfg.equipo, acciones: cfg.acciones });
    const wrap = document.getElementById(`filter-${P}-requerimientos-wrap`);
    if (wrap) wrap.hidden = !defaults.hasRequerimiento;
    if (defaults.hasRequerimiento) {
      renderActRequerimientosOptions(defaults.requerimientoOptions);
      updateActRequerimientosTriggerLabel();
    }
    renderActRecursoOptions(defaults.recursoOptions);
    updateActRecursoTriggerLabel();
  }

  function readActivosFilters() {
    // acciones: the Acción selection also narrows both charts, the table and
    // the summary (the acción KPI cards keep their full counts).
    const filters = { requerimientos: readSelectedActRequerimientos(), recursos: readSelectedActRecursos(), acciones: _actSelectedAcciones.slice() };
    const creacionDesde = document.getElementById(`filter-${P}-creacion-desde`).value;
    const creacionHasta = document.getElementById(`filter-${P}-creacion-hasta`).value;
    if (creacionDesde) filters.fechaCreacionFrom = creacionDesde;
    if (creacionHasta) filters.fechaCreacionTo = creacionHasta;
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
          // Real name even for people grouped as "Otro" in filters/charts.
          '<td>' + escapeHtml(r.recursoNombre || r.recursoAccion) + '</td>' +
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
      (!_actSelectedAcciones.length || _actSelectedAcciones.indexOf(r.accion) !== -1)
    );
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / ACT_TABLE_PAGE_SIZE));
    if (_actTablePage > totalPages) _actTablePage = totalPages;
    if (_actTablePage < 1) _actTablePage = 1;
    const start = (_actTablePage - 1) * ACT_TABLE_PAGE_SIZE;
    const pageRows = rows.slice(start, start + ACT_TABLE_PAGE_SIZE);

    document.getElementById(`table-${P}-head`).innerHTML = '<tr>' + ACT_TABLE_COLUMNS.map((h) => '<th>' + h + '</th>').join('') + '</tr>';
    document.getElementById(`table-${P}-body`).innerHTML = actRowsHtml(pageRows);

    const label = document.getElementById(`${P}-table-page-label`);
    if (label) {
      label.textContent = total
        ? 'Mostrando ' + (start + 1) + '–' + Math.min(start + ACT_TABLE_PAGE_SIZE, total) + ' de ' + total
        : 'Mostrando 0 de 0';
    }
    const prevBtn = document.getElementById(`${P}-table-prev`);
    const nextBtn = document.getElementById(`${P}-table-next`);
    if (prevBtn) prevBtn.disabled = _actTablePage <= 1;
    if (nextBtn) nextBtn.disabled = _actTablePage >= totalPages;
  }

  let _actTablePagerWired = false;
  function wireActTablePager() {
    if (_actTablePagerWired) return;
    _actTablePagerWired = true;
    const prevBtn = document.getElementById(`${P}-table-prev`);
    const nextBtn = document.getElementById(`${P}-table-next`);
    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (_actTablePage > 1) { _actTablePage -= 1; rerenderActivosWithCurrentFilters(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      _actTablePage += 1; // renderActTable clamps back down if this is past the last page
      rerenderActivosWithCurrentFilters();
    });
  }

  /* -------- Summary panel: "Detalle del recurso seleccionado" -------- */

  // Summary of the tickets behind the current Acción selection (all 4 by
  // default), grouped by the person's real name -- people outside the team
  // are listed by name with an "Otro" tag. With a team member's bar
  // selected, that person's tickets are grouped by acción instead; with the
  // "Otro" bar selected, by person.
  function renderActAccionResumen(panel, result) {
    const rows = result.rows.filter((r) =>
      (!_actSelectedAcciones.length || _actSelectedAcciones.indexOf(r.accion) !== -1) &&
      (!_actSelectedResource || r.recursoAccion === _actSelectedResource));
    const porAccion = _actSelectedResource && _actSelectedResource !== M.RECURSO_OTRO;
    const counts = {};
    const esOtro = {};
    rows.forEach((r) => {
      const k = porAccion ? r.accion : (r.recursoNombre || r.recursoAccion);
      counts[k] = (counts[k] || 0) + 1;
      if (!porAccion && r.recursoAccion === M.RECURSO_OTRO) esOtro[k] = true;
    });
    const grupos = Object.keys(counts).map((k) => ({ label: k, tickets: counts[k], otro: !!esOtro[k] }))
      .sort((a, b) => (b.tickets - a.tickets) || a.label.localeCompare(b.label));
    const accionesTxt = _actSelectedAcciones.length ? _actSelectedAcciones.join(', ') : 'las ' + ACT_ACCIONES_BASE.length + ' acciones';
    panel.innerHTML =
      '<div class="text-2xl font-extrabold text-slate-900 mb-3">' + formatEntero(rows.length) +
      '<span class="text-xs text-slate-400 font-semibold ml-1">tickets en ' + escapeHtml(accionesTxt) + '</span></div>' +
      (grupos.length
        ? '<table class="w-full text-[12px]"><thead><tr class="text-left text-slate-500">' +
            '<th class="py-1 font-semibold">' + (porAccion ? 'Acción' : 'Recurso asignado') + '</th><th class="py-1 font-semibold text-right">Tickets</th></tr></thead><tbody>' +
            grupos.map((g) => '<tr class="border-t border-slate-100"><td class="py-1.5 text-slate-800">' + escapeHtml(g.label) +
              (g.otro ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-500">Otro</span>' : '') +
              '</td><td class="py-1.5 text-right font-semibold text-slate-900">' + formatEntero(g.tickets) + '</td></tr>').join('') +
          '</tbody></table>'
        : '<p class="text-[12px] text-slate-500">Sin tickets para la selección actual.</p>');
  }

  function renderActResumenPanel(result) {
    const panel = document.getElementById(`${P}-resumen-panel`);
    if (!panel) return;
    const title = document.getElementById(`${P}-resumen-title`);
    if (title) {
      title.textContent = _actSelectedResource
        ? (_actSelectedResource === M.RECURSO_OTRO ? 'Resumen — personas fuera del equipo' : 'Resumen por acción — ' + _actSelectedResource)
        : 'Resumen por recurso' + (_actSelectedAcciones.length === 1 ? ' — ' + _actSelectedAcciones[0] : _actSelectedAcciones.length ? ' — ' + _actSelectedAcciones.length + ' acciones' : '');
    }
    renderActAccionResumen(panel, result);
  }

  /* -------- Entry point -------- */

  function renderActivos(tickets, opts) {
    opts = opts || {};
    _actAllTickets = tickets;
    if (opts.repopulateFilters !== false) populateActivosFilters(tickets);

    const filters = readActivosFilters();
    // The Recurso dimension uses cfg.equipo when given (anyone else is
    // grouped as "Otro"); without it, every real name is listed.
    // Charts/table/summary only consider the 4 Primer Nivel acciones.
    const result = M.buildActivos(tickets, filters, { equipo: cfg.equipo, acciones: cfg.acciones });

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
    const opcionesAccion = actAccionOptions(result);
    const accionesPresentes = _actSelectedAcciones.filter((x) => opcionesAccion.indexOf(x) !== -1);
    if (accionesPresentes.length !== _actSelectedAcciones.length) {
      _actSelectedAcciones = accionesPresentes;
      _actTablePage = 1;
      renderActivos(tickets, { repopulateFilters: false });
      return;
    }

    renderActivosKpis(result);
    renderActFechasNota(result);
    renderActAccionOptions(result);
    renderActivosCharts(result);
    renderActTable(result);
    renderActResumenPanel(result);
  }

  function rerenderActivosWithCurrentFilters() {
    if (_actAllTickets.length) renderActivos(_actAllTickets, { repopulateFilters: false });
  }

  function clearActivosFilters() {
    if (!_actAllTickets.length) return;
    document.getElementById(`filter-${P}-creacion-desde`).value = '';
    document.getElementById(`filter-${P}-creacion-hasta`).value = '';
    document.querySelectorAll(`#filter-${P}-requerimientos-list .${P}-requerimiento-opt`).forEach((el) => { el.checked = false; });
    const reqAllCheckbox = document.getElementById(`filter-${P}-requerimientos-all`);
    if (reqAllCheckbox) reqAllCheckbox.checked = true;
    updateActRequerimientosTriggerLabel();
    document.querySelectorAll(`#filter-${P}-recurso-list .${P}-recurso-opt`).forEach((el) => { el.checked = false; });
    const recAllCheckbox = document.getElementById(`filter-${P}-recurso-all`);
    if (recAllCheckbox) recAllCheckbox.checked = true;
    updateActRecursoTriggerLabel();
    _actSelectedResource = null;
    _actSelectedAcciones = [];
    _actTablePage = 1;
    rerenderActivosWithCurrentFilters();
  }

  // Everything app.js used to wire by hand for this view.
  function wireView() {
    [`filter-${P}-creacion-desde`, `filter-${P}-creacion-hasta`].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => rerenderActivosWithCurrentFilters());
    });
    const btnLimpiar = document.getElementById(`btn-${P}-limpiar`);
    if (btnLimpiar) btnLimpiar.addEventListener('click', () => clearActivosFilters());
    wireActAccionMultiSelect();
    wireActRequerimientosMultiSelect();
    wireActRecursoMultiSelect();
    wireActTablePager();
  }

  return {
    render: renderActivos,
    rerender: rerenderActivosWithCurrentFilters,
    clear: clearActivosFilters,
    wire: wireView
  };
  }

  const nivel1 = createNivelView({
    prefix: 'act',
    acciones: M.ACTIVOS_SERVICIOS_ACCIONES,
    equipo: M.CAP_CARD_RECURSOS,
    aliases: { 'AGENDAR ENTREGA FINAL': 'AGENDA ENTREGA FINAL' },
    cards: [
      { title: 'En Realizar', accion: 'REALIZAR', color: '#2563EB' },
      { title: 'En Cierre', accion: 'CIERRE', color: '#0EA5E9' },
      { title: 'En Entrega Final', accion: 'ENTREGA FINAL', color: '#0284C7' },
      { title: 'Por Agendar Entrega Final', accion: 'AGENDAR ENTREGA FINAL', color: '#A855F7' }
    ]
  });

  // Segundo Nivel: no team list yet, so every person shows by name.
  const nivel2 = createNivelView({
    prefix: 'sn',
    acciones: M.SEGUNDO_NIVEL_ACCIONES,
    equipo: null,
    aliases: { 'ACTUALIZAR VERSION': 'ACTUALIZA VERSION' },
    cards: [
      { title: 'En Revisión Calidad', accion: 'REVISION CALIDAD', color: '#A855F7' },
      { title: 'En Revisión Dev', accion: 'REVISION DEV', color: '#8B5CF6' },
      { title: 'En Revisión Solución', accion: 'REVISION SOLUCION', color: '#9333EA' },
      { title: 'En Actualizar Versión', accion: 'ACTUALIZAR VERSION', color: '#6D28D9' }
    ]
  });

  window.SOFIA_RENDER = {
    renderResumen: renderResumen,
    rerenderWithCurrentFilters: rerenderWithCurrentFilters,
    renderCapacidad: renderCapacidad,
    rerenderCapWithCurrentFilters: rerenderCapWithCurrentFilters,
    clearCapacidadFilters: clearCapacidadFilters,
    wireCapRecursosMultiSelect: wireCapRecursosMultiSelect,
    onCapClienteChange: onCapClienteChange,
    wireDrilldownModal: wireDrilldownModal,
    renderActivos: nivel1.render,
    rerenderActivosWithCurrentFilters: nivel1.rerender,
    clearActivosFilters: nivel1.clear,
    wireActivos: nivel1.wire,
    renderSegundoNivel: nivel2.render,
    rerenderSegundoNivelWithCurrentFilters: nivel2.rerender,
    clearSegundoNivelFilters: nivel2.clear,
    wireSegundoNivel: nivel2.wire
  };
})();
