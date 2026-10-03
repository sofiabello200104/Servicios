(function () {
  'use strict';

  // Vista "Correspondencia Recibida": lee ID12019_Correo del mismo OData
  // (mismo proxy/credenciales que Tickets) de forma independiente -- no
  // depende de que los tickets carguen. Se carga la primera vez que se abre
  // la vista y con el botón "Actualizar".
  var TEMPLATE = 'ID12019_Correo';
  var SIN_CLIENTE = 'Sin cliente registrado';
  var PAGE = 10;
  var $ = function (id) { return document.getElementById(id); };

  var S = { note: null, items: [], loaded: false, loading: false, error: null, showAll: false,
            q: '', page: 1, sort: { key: 'id', dir: 'desc' }, wired: false };

  function clean(v, fb) { var t = (v == null ? '' : String(v)).trim(); return t === '' ? fb : t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function normalize(rows) {
    return rows.map(function (r) {
      var raw = r.FechaRadicacion || r.Fecha || null;
      var d = raw ? new Date(raw) : null;
      return { id: String(r.ID), accion: clean(r.Accion, 'Sin acción'), recurso: clean(r.Recurso_Accion, 'Sin responsable'),
               cliente: clean(r.Cliente, SIN_CLIENTE),
               fecha: d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null, asunto: clean(r.Asunto, '') };
    });
  }

  function countBy(items, key) {
    var m = new Map();
    items.forEach(function (i) { m.set(i[key], (m.get(i[key]) || 0) + 1); });
    return Array.from(m, function (e) { return { name: e[0], value: e[1] }; })
      .sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); });
  }

  function filtered() {
    var f = { from: $('cor-desde').value, to: $('cor-hasta').value, cli: $('cor-cliente').value, rec: $('cor-recurso').value };
    return S.items.filter(function (i) {
      if (f.cli && i.cliente !== f.cli) return false;
      if (f.rec && i.recurso !== f.rec) return false;
      if (f.from && (!i.fecha || i.fecha < f.from)) return false;
      if (f.to && (!i.fecha || i.fecha > f.to)) return false;
      return true;
    });
  }

  function fillSelect(id, values, label) {
    var sel = $(id), cur = sel.value;
    sel.innerHTML = '<option value="">' + label + '</option>' + values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
    sel.value = values.indexOf(cur) >= 0 ? cur : '';
  }

  function bar(id, data, color) {
    var C = window.SOFIA_CHARTS;
    var h = Math.max(160, data.length * 30 + 30);
    var box = $(id).parentElement; box.style.height = h + 'px';
    C.barChart(id, [{ label: 'Correspondencias', data: data.map(function (d) { return d.value; }), backgroundColor: color, borderRadius: 4 }],
      { horizontal: true, labels: data.map(function (d) { return d.name; }), dataLabels: true,
        xOpts: { beginAtZero: true, ticks: { precision: 0 } } });
    C.chartEmptyState(id, data.length === 0, 'Sin datos para los filtros seleccionados');
  }

  function render() {
    var banner = $('cor-banner');
    if (S.error) { banner.hidden = false; banner.className = 'card p-4 mb-6 text-sm text-red-600'; banner.textContent = S.error; }
    else if (S.note) { banner.hidden = false; banner.className = 'card p-4 mb-6 text-sm text-amber-700'; banner.textContent = S.note; }
    else if (S.loaded && !S.items.length) { banner.hidden = false; banner.className = 'card p-4 mb-6 text-sm text-slate-500'; banner.textContent = 'No hay correspondencia para mostrar.'; }
    else banner.hidden = true;
    $('cor-body').style.display = S.loaded && !S.error ? '' : 'none';
    $('cor-fecha-filters').style.display = S.items.some(function (i) { return i.fecha; }) ? '' : 'none';
    $('cor-skeleton').hidden = !(S.loading && !S.loaded);
    if (!S.loaded) return;

    var rows = filtered();
    var acc = countBy(rows, 'accion'), rec = countBy(rows, 'recurso'), cli = countBy(rows, 'cliente');
    var rem = countBy(rows.filter(function (r) { return r.cliente !== SIN_CLIENTE; }), 'cliente')[0];
    $('cor-kpi-total').textContent = rows.length.toLocaleString('es-CO');
    $('cor-kpi-accion').textContent = acc[0] ? acc[0].name : '—';
    $('cor-kpi-accion-sub').textContent = acc[0] ? acc[0].value + ' · ' + (acc[0].value / rows.length * 100).toFixed(1) + '%' : '';
    $('cor-kpi-remitente').textContent = rem ? rem.name : '—';
    $('cor-kpi-remitente-sub').textContent = rem ? rem.value + ' correspondencias' : '';

    bar('chart-cor-accion', acc, '#0099FF');
    bar('chart-cor-recurso', rec, '#002299');
    bar('chart-cor-cliente', S.showAll ? cli : cli.slice(0, 10), '#0099FF');
    $('cor-cliente-title').textContent = S.showAll ? 'Clientes (todos)' : 'Top 10 Clientes';
    var tg = $('cor-cliente-toggle');
    tg.hidden = cli.length <= 10;
    tg.textContent = S.showAll ? 'Ver top 10' : 'Ver todos (' + cli.length + ')';

    var q = S.q.trim().toLowerCase();
    if (q) rows = rows.filter(function (r) { return [r.id, r.accion, r.recurso, r.cliente, r.fecha || '', r.asunto].some(function (v) { return v.toLowerCase().indexOf(q) >= 0; }); });
    var k = S.sort.key, m = S.sort.dir === 'asc' ? 1 : -1;
    rows = rows.slice().sort(function (a, b) {
      if (k === 'id' && !isNaN(a.id) && !isNaN(b.id)) return (a.id - b.id) * m;
      return String(a[k] || '').localeCompare(String(b[k] || '')) * m;
    });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    S.page = Math.min(S.page, pages);
    $('cor-count').textContent = rows.length.toLocaleString('es-CO');
    $('cor-tbody').innerHTML = rows.slice((S.page - 1) * PAGE, S.page * PAGE).map(function (r) {
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.accion) + '</td><td>' + esc(r.recurso) + '</td><td>' + esc(r.cliente) + '</td><td>' + (r.fecha || '—') + '</td><td>' + esc(r.asunto) + '</td></tr>';
    }).join('');
    document.querySelectorAll('#cor-table th[data-k]').forEach(function (th) {
      th.textContent = th.dataset.l + (S.sort.key === th.dataset.k ? (S.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    });
    $('cor-page').textContent = 'Página ' + S.page + ' de ' + pages;
    $('cor-prev').disabled = S.page <= 1; $('cor-next').disabled = S.page >= pages;
  }

  // Consulta en vivo con tope de espera; si el servidor OData no responde
  // (504, timeout, sin configurar) cae a la copia del Power BI INDICADORES
  // (data/sample-correspondencia.json) y lo avisa con una nota visible.
  var LIVE_TIMEOUT_MS = 30000;

  async function fetchLive() {
    // El servidor OData no tolera consultas simultáneas con las mismas
    // credenciales: si los tickets se están cargando, no lo saturamos.
    if (window.SOFIA_APP && window.SOFIA_APP.isUpdating && window.SOFIA_APP.isUpdating()) throw new Error('los tickets se están cargando y el servidor no admite consultas simultáneas');
    var cfgRes = await fetch('/api/config');
    var cfg = cfgRes.ok ? await cfgRes.json() : null;
    if (!cfg || !cfg.configured || !cfg.endpointUrl) throw new Error('OData no configurado');
    var O = window.SOFIA_ODATA;
    var url = O.buildTemplateUrl(cfg.endpointUrl, TEMPLATE);
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, LIVE_TIMEOUT_MS);
    try {
      var res = await fetch('/api/odata-proxy?url=' + encodeURIComponent(url), { headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return O.toRows(await res.json());
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message);
    } finally { clearTimeout(timer); }
  }

  async function fetchSnapshot() {
    // Prefer the workflow's latest download; else the Power BI copy.
    try {
      var r1 = await fetch('/api/snapshot?entity=correspondencia');
      if (r1.ok) { var rows1 = window.SOFIA_ODATA.toRows(await r1.json()); if (rows1.length) return rows1; }
    } catch (e) { /* cae a la copia del Power BI */ }
    var res = await fetch('/api/sample?entity=correspondencia');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return window.SOFIA_ODATA.toRows(await res.json());
  }

  async function load(forceSnapshot) {
    if (S.loading) return;
    S.loading = true; S.error = null; S.note = null; render();
    var btn = $('cor-refresh'); btn.disabled = true; btn.textContent = 'Actualizando…';
    try {
      var rows, origen = 'en vivo';
      if (forceSnapshot === true) { rows = await fetchSnapshot(); origen = 'copia'; }
      else {
        try { rows = await fetchLive(); }
        catch (liveErr) {
          rows = await fetchSnapshot(); origen = 'copia';
          S.note = 'No se pudo consultar OData (' + liveErr.message + '). Se muestran los datos de la copia del Power BI INDICADORES (corte 01/10/2026). Pulsa "Actualizar" para reintentar.';
        }
      }
      S.items = normalize(rows);
      S.loaded = true;
      fillSelect('cor-cliente', Array.from(new Set(S.items.map(function (i) { return i.cliente; }))).sort(function (a, b) { return a.localeCompare(b); }), 'Todos los clientes');
      fillSelect('cor-recurso', Array.from(new Set(S.items.map(function (i) { return i.recurso; }))).sort(function (a, b) { return a.localeCompare(b); }), 'Todos los responsables');
      var t = $('cor-updated'); if (t) t.textContent = (origen === 'copia' ? 'Copia del Power BI · ' : 'Actualizado: ') + new Date().toLocaleString('es-CO');
    } catch (e) {
      S.error = 'No se pudo cargar la correspondencia: ' + e.message;
    } finally {
      S.loading = false; btn.disabled = false; btn.textContent = 'Actualizar'; render();
    }
  }

  function wire() {
    if (S.wired) return; S.wired = true;
    ['cor-desde', 'cor-hasta', 'cor-cliente', 'cor-recurso'].forEach(function (id) {
      $(id).addEventListener('change', function () { S.page = 1; render(); });
    });
    $('cor-refresh').addEventListener('click', function () { load(false); });
    $('cor-sample').addEventListener('click', function () { load(true); });
    $('cor-cliente-toggle').addEventListener('click', function () { S.showAll = !S.showAll; render(); });
    $('cor-search').addEventListener('input', function (e) { S.q = e.target.value; S.page = 1; render(); });
    $('cor-prev').addEventListener('click', function () { S.page--; render(); });
    $('cor-next').addEventListener('click', function () { S.page++; render(); });
    document.querySelectorAll('#cor-table th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.k;
        S.sort = S.sort.key === k ? { key: k, dir: S.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' };
        render();
      });
    });
  }

  // Se llama al abrir la vista; carga solo la primera vez.
  function show() { wire(); if (!S.loaded && !S.loading) load(); else render(); }

  window.SOFIA_CORRESPONDENCIA = { show: show, reload: function () { return load(false); } };
})();
