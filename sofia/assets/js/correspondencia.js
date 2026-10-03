(function () {
  'use strict';

  // Vista "Correspondencia Recibida": réplica del tablero de Power BI
  // (INDICADORES). Lee SOLO ID12019_Correo (~120 filas) por el mismo proxy y
  // credenciales que Tickets; es independiente de la carga de tickets.
  //   - Recuento de Recurso_Accion por Acción   (barras de colores + leyenda)
  //   - Total correspondencia + rango de Fecha  (segmentador)
  //   - Recuento de ID por Cliente              (todos los clientes)
  //   - Recuento de ID por Recurso_Accion
  // Como en Power BI, hacer clic en una barra filtra los demás visuales.
  var TEMPLATE = 'ID12019_Correo';
  var BLANK = '(En blanco)';
  var TIMEOUT_MS = 60000;
  var PBI = ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#D64550'];
  var BLUE = '#118DFF';
  var $ = function (id) { return document.getElementById(id); };

  var S = { items: [], loaded: false, loading: false, error: null, wired: false,
            dirtyDates: false, sel: { accion: null, recurso: null, cliente: null } };

  function clean(v) { var t = (v == null ? '' : String(v)).trim(); return t === '' ? BLANK : t; }

  function normalize(rows) {
    return rows.map(function (r) {
      var d = r.Fecha ? new Date(r.Fecha) : null;
      return { id: String(r.ID), accion: clean(r.Accion), recurso: clean(r.Recurso_Accion), cliente: clean(r.Cliente),
               fecha: d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null };
    });
  }

  function countBy(items, key) {
    var m = new Map();
    items.forEach(function (i) { m.set(i[key], (m.get(i[key]) || 0) + 1); });
    return Array.from(m, function (e) { return { name: e[0], value: e[1] }; })
      .sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); });
  }

  // Filtra por fechas y por las selecciones de los demás visuales (skip = el
  // visual que se está dibujando, que muestra todo su universo, atenuando lo
  // no seleccionado -- igual que Power BI).
  function rows(skip) {
    var from = $('cor-desde').value, to = $('cor-hasta').value;
    return S.items.filter(function (i) {
      if (from && (!i.fecha || i.fecha < from)) return false;
      if (to && (!i.fecha || i.fecha > to)) return false;
      if (skip !== 'accion' && S.sel.accion && i.accion !== S.sel.accion) return false;
      if (skip !== 'recurso' && S.sel.recurso && i.recurso !== S.sel.recurso) return false;
      if (skip !== 'cliente' && S.sel.cliente && i.cliente !== S.sel.cliente) return false;
      return true;
    });
  }

  function fade(hex, on) { return on ? hex : hex + '59'; }
  function short(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function toggle(key, name) {
    S.sel[key] = S.sel[key] === name ? null : name;
    // Redibujar fuera del manejador del clic (Chart.js se rompe si se destruye dentro).
    setTimeout(render, 0);
  }

  function sizeBox(id, n, per, min) {
    var box = $(id).parentElement; box.style.height = Math.max(min, n * per + 50) + 'px';
  }

  function drawAccion() {
    var C = window.SOFIA_CHARTS, data = countBy(rows('accion'), 'accion'), sel = S.sel.accion;
    var labels = data.map(function (d) { return d.name; });
    sizeBox('chart-cor-accion', data.length, 36, 240);
    var datasets = data.map(function (d, i) {
      var arr = data.map(function (_, j) { return j === i ? d.value : null; });
      return { label: d.name, data: arr, backgroundColor: fade(PBI[i % PBI.length], !sel || sel === d.name), borderRadius: 2, barPercentage: 0.8, categoryPercentage: 0.85 };
    });
    C.barChart('chart-cor-accion', datasets, {
      horizontal: true, labels: labels, stacked: true,
      dataLabels: { anchor: 'center', align: 'center', offset: 0, color: '#fff', font: { size: 11, weight: '700' },
                    display: function (ctx) { return ctx.dataset.data[ctx.dataIndex] != null; } },
      xOpts: { beginAtZero: true, ticks: { precision: 0 } },
      yOpts: { ticks: { autoSkip: false, callback: function (v) { return short(labels[v] || '', 34); } } },
      onClick: function (e, els) { if (els.length) toggle('accion', labels[els[0].index]); }
    });
    C.chartEmptyState('chart-cor-accion', data.length === 0, 'Sin datos para los filtros seleccionados');
  }

  function drawSimple(id, key, color, per, min) {
    var C = window.SOFIA_CHARTS, data = countBy(rows(key), key), sel = S.sel[key];
    var labels = data.map(function (d) { return d.name; });
    sizeBox(id, data.length, per, min);
    C.barChart(id, [{ label: 'Recuento de ID', data: data.map(function (d) { return d.value; }),
                      backgroundColor: data.map(function (d) { return fade(color, !sel || sel === d.name); }), borderRadius: 2 }], {
      horizontal: true, labels: labels, legend: false,
      dataLabels: { color: '#334155', font: { size: 10, weight: '600' } },
      xOpts: { beginAtZero: true, ticks: { precision: 0 } },
      yOpts: { ticks: { autoSkip: false, callback: function (v) { return short(labels[v] || '', key === 'cliente' ? 30 : 32); } } },
      onClick: function (e, els) { if (els.length) toggle(key, labels[els[0].index]); }
    });
    C.chartEmptyState(id, data.length === 0, 'Sin datos para los filtros seleccionados');
  }

  function render() {
    var banner = $('cor-banner');
    var show = S.loaded && !S.error;
    $('cor-body').style.display = show ? '' : 'none';
    $('cor-loading').hidden = !(S.loading && !S.loaded);
    if (S.error) {
      banner.hidden = false;
      banner.innerHTML = '<span>' + S.error.replace(/[<>&]/g, '') + '</span> <button type="button" id="cor-retry" class="underline ml-2">Reintentar</button>';
      $('cor-retry').addEventListener('click', load);
    } else banner.hidden = true;
    if (!show) return;

    $('cor-total').textContent = rows().length.toLocaleString('es-CO');
    var any = S.sel.accion || S.sel.recurso || S.sel.cliente;
    $('cor-clear').hidden = !any;
    drawAccion();
    drawSimple('chart-cor-recurso', 'recurso', BLUE, 30, 220);
    drawSimple('chart-cor-cliente', 'cliente', BLUE, 26, 300);
  }

  async function fetchRows() {
    var cfgRes = await fetch('/api/config');
    var cfg = cfgRes.ok ? await cfgRes.json() : null;
    if (!cfg || !cfg.configured || !cfg.endpointUrl) throw new Error('OData no configurado. Configúralo en Parametrización.');
    var O = window.SOFIA_ODATA;
    var url = O.buildTemplateUrl(cfg.endpointUrl, TEMPLATE) + '&$select=' + encodeURIComponent('ID,Accion,Recurso_Accion,Cliente,Fecha');
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    try {
      var res = await fetch('/api/odata-proxy?url=' + encodeURIComponent(url), { headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 401) throw new Error('Sin acceso (401). Verifica las credenciales en Parametrización.');
      if (!res.ok) throw new Error('HTTP ' + res.status + ' al consultar ' + TEMPLATE);
      return O.toRows(await res.json());
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'El servidor tardó más de ' + TIMEOUT_MS / 1000 + ' s en responder' : e.message);
    } finally { clearTimeout(timer); }
  }

  async function load() {
    if (S.loading) return;
    S.loading = true; S.error = null; render();
    var btn = $('cor-refresh'); btn.disabled = true; btn.textContent = 'Actualizando…';
    try {
      S.items = normalize(await fetchRows());
      S.loaded = true;
      // Como el segmentador de Power BI: arranca con el rango completo de datos.
      var ds = S.items.map(function (i) { return i.fecha; }).filter(Boolean).sort();
      if (!S.dirtyDates && ds.length) { $('cor-desde').value = ds[0]; $('cor-hasta').value = ds[ds.length - 1]; }
      $('cor-updated').textContent = 'Actualizado: ' + new Date().toLocaleString('es-CO');
    } catch (e) {
      S.error = 'No se pudo cargar la correspondencia: ' + e.message;
    } finally {
      S.loading = false; btn.disabled = false; btn.textContent = 'Actualizar'; render();
    }
  }

  function wire() {
    if (S.wired) return; S.wired = true;
    ['cor-desde', 'cor-hasta'].forEach(function (id) {
      $(id).addEventListener('change', function () { S.dirtyDates = true; render(); });
    });
    $('cor-refresh').addEventListener('click', load);
    $('cor-clear').addEventListener('click', function () { S.sel = { accion: null, recurso: null, cliente: null }; render(); });
  }

  function show() { wire(); if (!S.loaded && !S.loading) load(); else render(); }

  window.SOFIA_CORRESPONDENCIA = { show: show, reload: load };
})();
