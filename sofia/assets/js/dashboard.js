(function () {
  'use strict';

  // Dashboard central (antes "Resumen"): tarjetas por acción / proceso que
  // también filtran, rango de fechas, línea de tiempo por acción con botones
  // de nivel y tops. Todo sale de M.buildDashboardCentral sobre los mismos
  // tickets que usan los demás módulos.
  var M = window.SOFIA_MAPPER;
  var $ = function (id) { return document.getElementById(id); };
  var S = { tickets: [], accion: null, proceso: null, nivel: 'todos', wired: false };

  var SERIE_COLOR = {
    REALIZAR: '#2563EB', 'ENTREGA FINAL': '#0EA5E9', CIERRE: '#10B981',
    'REVISION CALIDAD': '#A855F7', 'REVISION DEV': '#F59E0B', 'REVISION SOLUCION': '#EC4899'
  };
  var ACCION_LABEL = {
    REALIZAR: 'Realizar', 'AGENDA ENTREGA FINAL': 'Agendar Entrega Final', 'ENTREGA FINAL': 'Entrega Final', CIERRE: 'Cierre',
    'REVISION CALIDAD': 'Revisión Calidad', 'REVISION DEV': 'Revisión Dev', 'REVISION SOLUCION': 'Revisión Solución', 'ACTUALIZA VERSION': 'Actualizar Versión'
  };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var fmt = new Intl.NumberFormat('es-CO');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function labelAccion(a) { return ACCION_LABEL[a] || (a.charAt(0) + a.slice(1).toLowerCase()); }
  function short(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function titleCase(s) { return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }) : s; }

  function bucketLabel(iso, g) {
    var y = iso.slice(2, 4), m = MESES[parseInt(iso.slice(5, 7), 10) - 1], d = iso.slice(8, 10);
    if (g === 'mes') return m + ' ' + y;
    return d + ' ' + m;
  }

  function card(opts) {
    var active = opts.active ? ' dash-card-active' : '';
    return '<button type="button" class="card dash-card' + active + '" data-kind="' + opts.kind + '" data-value="' + esc(opts.value || '') + '" style="--accent:' + opts.color + '">' +
      '<div class="text-[12px] font-semibold text-slate-500 leading-tight">' + esc(opts.title) + '</div>' +
      '<div class="text-2xl font-extrabold text-slate-900 kpi-num mt-2">' + fmt.format(opts.count) + '</div>' +
      (opts.sub ? '<div class="text-[11px] text-slate-400 mt-1">' + esc(opts.sub) + '</div>' : '') +
      '</button>';
  }

  function renderCards(d) {
    var c = d.cards;
    $('dash-cards-top').innerHTML =
      card({ kind: 'todos', title: 'Tickets activos', count: c.activos, color: '#0F172A', active: !S.accion && !S.proceso, sub: 'Primer + Segundo Nivel' }) +
      card({ kind: 'proceso', value: 'Mantenimiento', title: 'Mantenimiento', count: c.mantenimiento, color: '#0369A1', active: S.proceso === 'Mantenimiento', sub: 'Proceso' }) +
      card({ kind: 'proceso', value: 'Implementación', title: 'Implementación', count: c.implementacion, color: '#7C3AED', active: S.proceso === 'Implementación', sub: 'Proceso' });
    var primer = c.acciones.filter(function (a) { return a.nivel === 'primer'; });
    var segundo = c.acciones.filter(function (a) { return a.nivel === 'segundo'; });
    function row(list, color) {
      return list.map(function (a) {
        return card({ kind: 'accion', value: a.accion, title: labelAccion(a.accion), count: a.value, color: SERIE_COLOR[a.accion] || color, active: S.accion === a.accion });
      }).join('');
    }
    $('dash-cards-primer').innerHTML = row(primer, '#2563EB') || '<p class="text-xs text-slate-400">Sin tickets</p>';
    $('dash-cards-segundo').innerHTML = row(segundo, '#A855F7') || '<p class="text-xs text-slate-400">Sin tickets</p>';
    document.querySelectorAll('#resumen-content .dash-card').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.kind, v = b.dataset.value;
        if (k === 'todos') { S.accion = null; S.proceso = null; }
        else if (k === 'proceso') S.proceso = S.proceso === v ? null : v;
        else S.accion = S.accion === v ? null : v;
        render();
      });
    });
  }

  function renderLinea(d) {
    var C = window.SOFIA_CHARTS, L = d.linea;
    document.querySelectorAll('#dash-nivel button').forEach(function (b) { b.classList.toggle('active', b.dataset.nivel === S.nivel); });
    var disp = L.series.filter(function (s) { return s.disponible; });
    var faltan = L.series.filter(function (s) { return !s.disponible; });
    var datasets = disp.map(function (s) {
      return { label: labelAccion(s.accion) + ' (' + fmt.format(s.total) + ')', data: s.data, borderColor: SERIE_COLOR[s.accion], backgroundColor: SERIE_COLOR[s.accion],
               pointRadius: L.labels.length > 60 ? 0 : 2, tension: 0.25 };
    });
    C.lineChart('chart-dash-linea', datasets, {
      labels: L.labels.map(function (k) { return bucketLabel(k, L.granularidad); }),
      legend: true,
      yOpts: { beginAtZero: true, ticks: { precision: 0 } },
      xOpts: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } }
    });
    var vacio = !datasets.length || !L.labels.length;
    var msg = 'Sin eventos para el rango seleccionado';
    if (S.accion && !L.series.length) msg = labelAccion(S.accion) + ' no tiene una fecha propia, así que no se grafica en la línea de tiempo';
    else if (L.series.length && !disp.length) msg = 'Las fechas de estas acciones no llegan en los datos cargados (' + faltan.map(function (s) { return s.campo; }).join(', ') + ')';
    C.chartEmptyState('chart-dash-linea', vacio, msg);
    var g = { dia: 'por día', semana: 'por semana', mes: 'por mes' }[L.granularidad];
    var dmy = function (iso) { return iso.split('-').reverse().join('/'); };
    var nota = 'Cantidad de tickets que pasaron por cada acción, ' + g + (L.desde ? ', del ' + dmy(L.desde) : '') + ' al ' + dmy(L.hasta) + '.';
    if (faltan.length) nota += ' Sin datos de ' + faltan.map(function (s) { return labelAccion(s.accion) + ' (' + s.campo + ')'; }).join(', ') + ': esa columna no llega en el OData.';
    $('dash-linea-nota').textContent = nota;
  }

  function topChart(id, list, color, prettify) {
    var C = window.SOFIA_CHARTS;
    var labels = list.map(function (x) { return prettify ? titleCase(x.label) : x.label; });
    $(id).parentElement.style.height = Math.max(list.length * 30 + 16, 60) + 'px';
    C.barChart(id, [{ label: 'Tickets', data: list.map(function (x) { return x.value; }),
      backgroundColor: list.map(function (x, i) { return i === 0 ? color : color + 'B3'; }), borderRadius: 4, borderSkipped: false, maxBarThickness: 16 }], {
      horizontal: true, labels: labels, legend: false, layout: { padding: { right: 28 } },
      dataLabels: { color: '#334155', font: { size: 11, weight: '700' }, offset: 6 },
      tooltipOpts: { callbacks: { title: function (it) { return labels[it[0].dataIndex]; } } },
      xOpts: { display: false, beginAtZero: true },
      yOpts: { grid: { display: false }, border: { display: false }, afterFit: function (sc) { sc.width = 160; },
               ticks: { autoSkip: false, color: '#475569', font: { size: 11 }, callback: function (v) { return short(labels[v] || '', 22); } } }
    });
    C.chartEmptyState(id, !list.length, 'Sin tickets para los filtros seleccionados');
  }

  function renderChips() {
    var parts = [];
    if (S.accion) parts.push({ k: 'accion', t: 'Acción: ' + labelAccion(S.accion) });
    if (S.proceso) parts.push({ k: 'proceso', t: 'Proceso: ' + S.proceso });
    var box = $('dash-chips');
    box.innerHTML = parts.map(function (p) { return '<button type="button" class="cor-chip" data-k="' + p.k + '">' + esc(p.t) + ' <span aria-hidden="true">✕</span></button>'; }).join('');
    box.hidden = !parts.length;
    box.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { S[b.dataset.k] = null; render(); }); });
  }

  function render() {
    if (!S.tickets.length) return;
    var d = M.buildDashboardCentral(S.tickets, {
      desde: $('dash-desde').value || null, hasta: $('dash-hasta').value || null,
      accion: S.accion, proceso: S.proceso, nivel: S.nivel
    });
    renderChips();
    renderCards(d);
    renderLinea(d);
    topChart('chart-dash-top-clientes', d.topClientes, '#0EA5E9', true);
    topChart('chart-dash-top-primer', d.topRecursosPrimer, '#2563EB');
    topChart('chart-dash-top-calidad', d.topRecursosCalidad, '#A855F7');
  }

  function wire() {
    if (S.wired) return; S.wired = true;
    ['dash-desde', 'dash-hasta'].forEach(function (id) { $(id).addEventListener('change', render); });
    $('dash-limpiar').addEventListener('click', function () {
      $('dash-desde').value = ''; $('dash-hasta').value = ''; S.accion = null; S.proceso = null; render();
    });
    document.querySelectorAll('#dash-nivel button').forEach(function (b) {
      b.addEventListener('click', function () { S.nivel = b.dataset.nivel; render(); });
    });
  }

  window.SOFIA_DASHBOARD = {
    render: function (tickets) { wire(); S.tickets = tickets || []; render(); }
  };
})();
