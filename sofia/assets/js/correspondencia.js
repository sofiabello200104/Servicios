(function () {
  'use strict';

  // Vista "Correspondencia Recibida". Lee SOLO ID12019_Correo (~120 filas)
  // por el mismo proxy/credenciales que Tickets, independiente de la carga de
  // tickets. Tres gráficas simétricas (Acción, Responsable, Cliente) con clic
  // para filtrar, KPIs, rango de fechas y tabla de detalle paginada.
  var TEMPLATE = 'ID12019_Correo';
  var BLANK = '(En blanco)';
  var TIMEOUT_MS = 60000;
  var PAGE = 10;
  var ROW_H = 30;
  var LABEL_W = 160;
  var BRAND = '#0EA5E9', BRAND_DEEP = '#0369A1';
  var AVATAR = ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#F97316'];
  var $ = function (id) { return document.getElementById(id); };

  var S = { items: [], loaded: false, loading: false, error: null, wired: false, page: 1,
            dirtyDates: false, sel: { accion: null, recurso: null, cliente: null } };

  function clean(v) { var t = (v == null ? '' : String(v)).trim(); return t === '' ? BLANK : t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function short(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function titleCase(s) {
    if (s === BLANK || s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function fmtFecha(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—'; }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function initials(s) { return s.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }

  function normalize(rows) {
    return rows.map(function (r) {
      var d = r.Fecha ? new Date(r.Fecha) : null;
      return { id: String(r.ID), accion: clean(r.Accion), recurso: titleCase(clean(r.Recurso_Accion)), cliente: titleCase(clean(r.Cliente)),
               fecha: d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null };
    });
  }

  function countBy(items, key) {
    var m = new Map();
    items.forEach(function (i) { m.set(i[key], (m.get(i[key]) || 0) + 1); });
    return Array.from(m, function (e) { return { name: e[0], value: e[1] }; })
      .sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); });
  }

  // skip = la gráfica que se dibuja: muestra todo su universo y atenúa lo no
  // seleccionado; las demás se filtran por esa selección.
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

  function toggle(key, name) {
    S.sel[key] = S.sel[key] === name ? null : name;
    S.page = 1;
    setTimeout(render, 0); // fuera del manejador de Chart.js
  }

  // Mismo estilo para las tres: barras finas redondeadas, valor al final, sin
  // ejes ni cuadrícula; alto fijo de tarjeta y scroll interno si hay muchas filas.
  function drawChart(key) {
    var id = 'chart-cor-' + key;
    var C = window.SOFIA_CHARTS, data = countBy(rows(key), key), sel = S.sel[key];
    var labels = data.map(function (d) { return d.name; });
    $(id).parentElement.style.height = Math.max(data.length * ROW_H + 16, 60) + 'px';
    C.barChart(id, [{
      label: 'Correspondencias',
      data: data.map(function (d) { return d.value; }),
      backgroundColor: data.map(function (d, i) {
        var base = i === 0 ? BRAND_DEEP : BRAND;
        return !sel || sel === d.name ? base : base + '40';
      }),
      borderRadius: 4, borderSkipped: false, maxBarThickness: 16
    }], {
      horizontal: true, labels: labels, legend: false,
      layout: { padding: { right: 8 } },
      dataLabels: { color: '#334155', font: { size: 11, weight: '700' }, offset: 6 },
      tooltipOpts: { callbacks: { title: function (items) { return labels[items[0].dataIndex]; } } },
      xOpts: { display: false, beginAtZero: true },
      yOpts: { grid: { display: false }, border: { display: false },
               // Ancho fijo de etiquetas: mismas proporciones en las tres gráficas
               // y sin que Chart.js recorte el texto por la izquierda.
               afterFit: function (scale) { scale.width = LABEL_W; },
               ticks: { autoSkip: false, color: '#475569', font: { size: 11 }, padding: 6,
                        callback: function (v) { return short(labels[v] || '', 22); } } },
      onClick: function (e, els) { if (els.length) toggle(key, labels[els[0].index]); }
    });
    C.chartEmptyState(id, data.length === 0, 'Sin datos para el rango seleccionado');
    var count = $('cor-n-' + key); if (count) count.textContent = data.length;
  }

  function renderChips() {
    var names = { accion: 'Acción', recurso: 'Responsable', cliente: 'Cliente' };
    var html = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(function (k) {
      return '<button type="button" class="cor-chip" data-k="' + k + '">' + names[k] + ': <b>' + esc(short(S.sel[k], 32)) + '</b> <span aria-hidden="true">✕</span></button>';
    }).join('');
    var box = $('cor-chips');
    box.innerHTML = html;
    box.hidden = !html;
    box.querySelectorAll('.cor-chip').forEach(function (b) {
      b.addEventListener('click', function () { S.sel[b.dataset.k] = null; S.page = 1; render(); });
    });
  }

  function renderTable() {
    var list = rows().slice().sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || '') || Number(b.id) - Number(a.id); });
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    S.page = Math.min(S.page, pages);
    var start = (S.page - 1) * PAGE, slice = list.slice(start, start + PAGE);
    $('cor-tbody').innerHTML = slice.length ? slice.map(function (r) {
      var color = AVATAR[hash(r.recurso) % AVATAR.length];
      return '<tr>' +
        '<td><div class="flex items-center gap-2"><span class="cor-avatar" style="background:' + color + '">' + esc(initials(r.recurso)) + '</span><span class="font-medium text-slate-800">' + esc(r.recurso) + '</span></div></td>' +
        '<td><span class="cor-pill">' + esc(r.accion) + '</span></td>' +
        '<td class="whitespace-nowrap tabular-nums">' + fmtFecha(r.fecha) + '</td>' +
        '<td>' + esc(r.cliente) + '</td>' +
        '<td class="text-slate-400 tabular-nums">' + esc(r.id) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="text-center text-slate-400 py-6">Sin correspondencia para los filtros seleccionados</td></tr>';
    $('cor-page-label').textContent = list.length ? 'Mostrando ' + (start + 1) + '–' + (start + slice.length) + ' de ' + list.length : 'Mostrando 0 de 0';
    $('cor-prev').disabled = S.page <= 1;
    $('cor-next').disabled = S.page >= pages;
  }

  function render() {
    var show = S.loaded && !S.error;
    $('cor-body').style.display = show ? '' : 'none';
    $('cor-loading').hidden = !(S.loading && !S.loaded);
    var banner = $('cor-banner');
    if (S.error) {
      banner.hidden = false;
      banner.innerHTML = '<span>' + esc(S.error) + '</span> <button type="button" id="cor-retry" class="underline ml-2">Reintentar</button>';
      $('cor-retry').addEventListener('click', load);
    } else banner.hidden = true;
    if (!show) return;

    var all = rows();
    $('cor-total').textContent = all.length.toLocaleString('es-CO');
    $('cor-clientes').textContent = new Set(all.map(function (i) { return i.cliente; })).size;
    $('cor-responsables').textContent = new Set(all.map(function (i) { return i.recurso; })).size;
    var top = countBy(all, 'accion')[0];
    $('cor-top-accion').textContent = top ? top.name : '—';
    $('cor-top-accion-sub').textContent = top ? top.value + ' · ' + Math.round(top.value / all.length * 100) + '% del total' : '';
    renderChips();
    drawChart('accion');
    drawChart('recurso');
    drawChart('cliente');
    renderTable();
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
    try {
      var origen = null;
      try { S.items = normalize(await fetchRows()); }
      catch (liveErr) {
        // Servidor OData lento o caído: se usa la copia automática (cada hora).
        var copia = window.SOFIA_COPIA ? await window.SOFIA_COPIA.load('correspondencia') : null;
        var rowsCopia = copia ? window.SOFIA_ODATA.toRows(copia) : [];
        if (!rowsCopia.length) throw liveErr;
        S.items = normalize(rowsCopia);
        origen = copia.updatedAt;
      }
      S.loaded = true;
      var ds = S.items.map(function (i) { return i.fecha; }).filter(Boolean).sort();
      if (!S.dirtyDates && ds.length) { $('cor-desde').value = ds[0]; $('cor-hasta').value = ds[ds.length - 1]; }
      $('cor-updated').textContent = origen
        ? 'Copia automática del ' + new Date(origen).toLocaleString('es-CO') + ' (el servidor OData no respondió)'
        : 'Actualizado ' + new Date().toLocaleString('es-CO');
    } catch (e) {
      S.error = 'No se pudo cargar la correspondencia: ' + e.message;
    } finally {
      S.loading = false; render();
    }
  }

  function wire() {
    if (S.wired) return; S.wired = true;
    ['cor-desde', 'cor-hasta'].forEach(function (id) {
      $(id).addEventListener('change', function () { S.dirtyDates = true; S.page = 1; render(); });
    });
    $('cor-prev').addEventListener('click', function () { S.page--; renderTable(); });
    $('cor-next').addEventListener('click', function () { S.page++; renderTable(); });
    // El botón general "Actualizar datos" también refresca esta vista.
    var top = $('btn-actualizar-datos');
    if (top) top.addEventListener('click', function () { if (S.loaded || S.error) load(); });
  }

  function show() { wire(); if (!S.loaded && !S.loading) load(); else render(); }

  window.SOFIA_CORRESPONDENCIA = { show: show, reload: load };
})();
