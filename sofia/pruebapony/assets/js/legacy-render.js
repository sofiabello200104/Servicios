(function () {
  'use strict';

  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const COLORS = { brand: '#0EA5E9', brandDeep: '#0369A1', ok: '#10B981', warn: '#F59E0B', bad: '#EF4444', violet: '#8B5CF6', pink: '#EC4899', ink: '#0F172A', mute: '#94A3B8', line: '#E2E8F0' };
  // Versiones tenues (~60 % opacidad) para líneas de proyección
  const COLORS_P = { brand: 'rgba(14,165,233,0.6)', violet: 'rgba(139,92,246,0.6)', warn: 'rgba(245,158,11,0.6)', ok: 'rgba(16,185,129,0.6)' };
  // Valores como r.vend/r.cliente/r.id en renderComercialDetalle() vienen de columnas
  // del feed OData (nombre de vendedor, cliente, ID de negocio) — nunca renderizarlos
  // crudos en innerHTML, mismo criterio que ya se aplica en admin.js/analisis.js/filtros.js.
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const fmtMoneyM = v => '$' + (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 0 }) + 'M';
  const fmtPct = v => (Number(v) || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%';

  // ponytail: helpers extraídos de 3+ definiciones locales idénticas
  const Q_IX = { ytd: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], q1: [0, 1, 2], q2: [3, 4, 5], q3: [6, 7, 8], q4: [9, 10, 11] };
  const getCur = () => (window.CMI_FILTROS && window.CMI_FILTROS.cur != null) ? window.CMI_FILTROS.cur : 11;
  const fmtM = v => '$' + v.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';
  const fmtCOP = v => '$' + Math.round(v).toLocaleString('es-CO');
  const fmtPctOr = (v, has) => (has && v != null && v !== 0) ? fmtPct(v) : '—';
  const tooltipM = { callbacks: { label(ctx) { const v = ctx.parsed.y; return v == null || isNaN(v) ? null : ' ' + ctx.dataset.label + ': ' + fmtM(v); } } };
  const normK = (window.CMI_MAPPER && window.CMI_MAPPER.norm)
    || (s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  function getPipelineTpl(cfg) {
    var tpls = cfg && cfg.areas && cfg.areas.comercial && cfg.areas.comercial.templates;
    if (!tpls) return null;
    // first match — pipeline template is expected to be unique per area config
    return tpls.find(function (t) { return t.toLowerCase().indexOf('pipeline') !== -1; }) || null;
  }
  function getActiveIx(trimKey, mesCorte) {
    var ix = (Q_IX[trimKey] || Q_IX.ytd).slice();
    if (trimKey !== 'ytd' && mesCorte && mesCorte !== 'all') {
      var mi = parseInt(mesCorte, 10); if (!isNaN(mi)) ix = [mi];
    }
    return ix;
  }
  // Promedio de una serie mensual sobre el rango activo (trimestre + mes de corte),
  // ignorando meses sin dato — a diferencia de data[getCur()], que lee un único mes y
  // da 0%/"Sin datos" si justo ese mes está vacío aunque haya datos reales en otros
  // meses del rango (ver buildCardsIds()).
  function avgActive(data, trimKey, mesCorte) {
    var ix = getActiveIx(trimKey, mesCorte);
    var vals = ix.map(function (i) { return data[i]; }).filter(function (v) { return v != null && v !== 0; });
    return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0;
  }
  function _isActivo(r, col) {
    // ponytail: normalización via normPl (function declaration — hoisted)
    if (!col) return true;
    var v = normPl(String(r[col] || '').trim());
    return v === 'activo' || v === '1';
  }

  /* Proyecciones anuales extraídas del PE-Z-001 (en millones COP) */
  const COM_PROJ = {
    nuevos: [550, 116, 84, 450, 500, 500, 680, 720, 600, 550, 600, 650],
    cruzada: [762.15, 0, 5.07, 34.42, 0, 180.62, 174.63, 405.09, 302.97, 306.34, 141.61, 187.11],
    renovaciones: [3323.33, 0, 41.81, 133.66, 27.53, 93.56, 20.10, 0, 18.44, 18.97, 0, 52.38],
    greenywave: [0, 0, 0, 0, 0, 225, 225, 225, 225, 225, 225, 225]
  };

  /* Matchers de nombre de vendedor — única fuente de verdad para computeVendorReals() y renderCoberturaCard() */
  const VENDOR_MATCHERS = {
    john: function (n) { return n.indexOf('john') !== -1 && n.indexOf('mora') !== -1; },
    duvan: function (n) { return n.indexOf('duvan') !== -1 || n.indexOf('perdomo') !== -1; },
    maira: function (n) { return n.indexOf('maira') !== -1 || n.indexOf('amezquita') !== -1; },
    rafael: function (n) { return n.indexOf('rafael') !== -1 && n.indexOf('salazar') !== -1; },
    jorge: function (n) { return n.indexOf('jorge') !== -1 && n.indexOf('salazar') !== -1; }
  };

  /* Presupuesto por vendedor extraído de PresupuestoxVendedor.xlsx (en millones COP) */
  const VENDOR_BUDGET = {
    todos: { label: 'Todos', annual: 13804.8, months: [4635.485, 116.0, 130.878, 618.084, 527.533, 999.179, 1099.732, 1368.535, 1127.970, 1100.305, 966.606, 1114.494] },
    john: { label: 'John A.', annual: 4020.0, months: [368.5, 77.72, 56.28, 301.5, 335.0, 335.0, 455.6, 482.4, 402.0, 368.5, 402.0, 435.5] },
    duvan: { label: 'Duvan', annual: 1980.0, months: [181.5, 38.28, 27.72, 148.5, 165.0, 165.0, 224.4, 237.6, 198.0, 181.5, 198.0, 214.5] },
    maira: { label: 'Maira', annual: 6229.8, months: [4085.485, 0, 46.878, 168.084, 27.533, 274.179, 194.732, 423.535, 302.970, 325.305, 141.606, 239.494] },
    rafael: { label: 'Rafael', annual: 1575.0, months: [0, 0, 0, 0, 0, 225.0, 225.0, 225.0, 225.0, 225.0, 225.0, 225.0] }
  };

  /* Datos vacíos — se rellenan con OData al parametrizar */
  const COM = {
    nuevos: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    cruzada: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    renovaciones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    greenywave: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pipeline: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    metas: { nuevos: 6000, cruzada: 2500, renovaciones: 3729.8, greenywave: 1575 }
  };
  const FIN = {
    ebitda: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    utilOp: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    utilBruta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    facturacion: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    recaudo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    personal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };
  const PRY = {
    ejecucion: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    horas: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    avance: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    habilit: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    /* Control de cuotas / PMO — plantilla ID11887_Contro_de_cuotas. 'celdas' es una
       entrada por proyecto × mes con movimiento (ver mapper.js#buildCuotasCells); las
       medidas del tablero se derivan al renderizar con summarizeCuotas(), aplicando los
       slicers de la sub-vista + el trimestre/mes del panel lateral. Es un objeto, no un
       array de 12: el reset genérico de "Borrar parametrización" (filtros.js) lo trata
       aparte, igual que ansPorProducto en IDS. */
    pmo: { celdas: [], responsables: [] },
    /* Hitos PMO — plantilla ID11920_Hitos_PMO. Misma estrategia que 'pmo': una celda
       por contrato × hito (ver mapper.js#buildHitosCells) y las medidas se derivan al
       renderizar con summarizeHitos(). También es objeto, no array de 12. */
    hitos: { celdas: [], responsables: [], licencias: [] }
  };
  /* Soluciones — datos plantilla ID12046_73_Tablero_Indicadores_MCI. confiabilidad son
     valores REALES calculados sobre el extracto soluciones.xlsx (corte 17/07/2026):
     100 − (% de filas del mes con Diagnostico='Calidad'), agrupando TODAS las filas
     (no solo backlog) por mes de Fecha_Soporte_Inicial del año en curso — ver
     mapper.js#buildTicketStats. Meses sin filas (ago-dic, aún no llega el extracto)
     quedan en null, no en 0. abiertos/calidad/servicios y los agrupados (recursos/
     acciones/clientes/productos) siguen siendo la fotografía puntual del snapshot que
     coincide con los slicers del tablero Power BI (188 abiertos) — el extracto crudo
     sin esos slicers da ~228 abiertos (79 calidad / 149 servicios); el resumen que
     trae CMI_ODATA.fetchSolucionesKpis() (server.js#handleSolucionesKpisGet, ver
     filtros.js#runActualizarDatos) reemplaza TODO este objeto por los datos reales
     agregados en el servidor al parametrizar, y en ese momento deja de coincidir con
     el recorte de PBI. "Borrar parametrización" resetea todo esto en filtros.js
     (rama 'soluciones' de onClearParametrizacion). */
  const SOL = {
    confiabilidad: [84.1, 83.1, 77.7, 77.6, 80.1, 78.2, 80.2, null, null, null, null, null],
    metaConfiabilidad: 90,
    abiertos: 188, calidad: 67, servicios: 110,
    recursos: {
      labels: ['EDWIN CAMPOS', 'JAIDER RAMIREZ', 'MARLON HERNANDO', 'PAOLA MACIAS', 'LAURA BELLO', 'JORGE ENRIQUE B.', 'JAIBER TORRES', 'JHONATAN STEVEN B.', 'HEIDY OSORIO'],
      data: [21, 18, 11, 9, 8, 6, 4, 4, 1]
    },
    acciones: {
      labels: ['REALIZAR', 'REVISION DEV', 'ENTREGA FINAL', 'REVISION CALIDAD', 'AGENDA ENTREGA FINAL', 'REVISION SOLUCION', 'ACTUALIZA VERSION'],
      data: [81, 31, 29, 29, 7, 7, 4]
    },
    clientes: {
      labels: ['Empresas Púb.', 'Universidad', 'Área Metrop.', 'Municipio A', 'Sociedad', 'Empresa SA', 'Alcaldía C.', 'Soluciones IT', 'E.S.P. Hidro', 'Corporación', 'Municipio B', 'Hidroeléctrica'],
      data: [19, 17, 8, 7, 7, 7, 6, 6, 5, 5, 4, 3]
    },
    productos: {
      labels: ['CONTABILIDAD WEB', 'CONTROLBLOOD', 'NOMINA WEB', 'ALMACEN WEB', 'PRESUPUESTO WEB', 'BPM', 'PRESUPUESTO.NET', 'TESORERIA WEB', 'OTROS'],
      data: [50, 36, 29, 19, 18, 13, 10, 8, 5],
      colors: ['#0EA5E9', '#6D28D9', '#F97316', '#1D4ED8', '#EC4899', '#0D9488', '#84CC16', '#B45309', '#94A3B8']
    }
  };
  const IDS = {
    confiabilidad: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ansGlobal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ansPorProducto: {},   // { [nombreProducto]: Array(12) } — poblado por parametrizacion.js
    metas: {}             // metas derivadas de los datos (ej. confiabilidad, ansGlobal)
  };

  window.CMI_DATA = { COM, FIN, PRY, SOL, IDS, MONTHS, COLORS, Q_IX };

  const sumTo = (arr, n) => arr.slice(0, n).reduce((a, b) => a + (Number(b) || 0), 0);
  const cumulative = arr => arr.reduce((acc, v, i) => { acc.push((acc[i - 1] || 0) + (Number(v) || 0)); return acc; }, []);

  var _acumKpi = 'todos';
  var _vendorKey = 'todos';

  function semaphore(value, meta, opMode) {
    opMode = opMode || 'gte';
    if (!value || !meta) return 'mute';
    if (opMode === 'gte') {
      if (value >= meta) return 'ok';
      if (value >= meta * 0.92) return 'warn';
      return 'bad';
    } else {
      if (value <= meta) return 'ok';
      if (value <= meta * 1.05) return 'warn';
      return 'bad';
    }
  }
  const chipFor = s => s === 'ok' ? 'chip-ok' : s === 'warn' ? 'chip-warn' : s === 'bad' ? 'chip-bad' : 'chip-mute';
  const labelFor = s => s === 'ok' ? 'En meta' : s === 'warn' ? 'En riesgo' : s === 'bad' ? 'No cumple' : 'Sin datos';
  // Colores por barra según el semáforo de cada valor vs meta (coloreado condicional
  // para gráficos de barras — ver renderIds()). Reutiliza los mismos 3 estados/colores
  // que el resto de la app en vez de un binario rojo/verde.
  const semaphoreColors = (data, meta, opMode) => data.map(v => COLORS[semaphore(v, meta, opMode)]);
  // Color representativo para el swatch de leyenda de un dataset con backgroundColor
  // por-barra: el más frecuente entre las barras con dato real (ignora COLORS.mute de
  // los meses vacíos) — Chart.js por defecto usa el color del índice 0, que rompe apenas
  // el primer mes del año no tiene datos aunque el resto sí.
  function dominantColor(colors) {
    const counts = {};
    colors.forEach(c => { if (c && c !== COLORS.mute) counts[c] = (counts[c] || 0) + 1; });
    const keys = Object.keys(counts);
    return keys.length ? keys.sort((a, b) => counts[b] - counts[a])[0] : COLORS.mute;
  }

  /* ============================ NAV ============================ */
  const TITLES = {
    exec: ['Panel Ejecutivo', 'OKR 2026'],
    comercial: ['Área · Dirección Comercial', 'Crecimiento de Ingresos'],
    financiera: ['Área · Gestión Administrativa y Financiera', 'Sostenibilidad Financiera y Madurez del Capital Humano'],
    proyectos: ['Área · Proyectos', 'Excelencia Operativa'],
    soluciones: ['Área · Soluciones', 'Confiabilidad del Software y Gestión de Tickets'],
    ids: ['Área · IDS', 'Estabilidad y Disponibilidad del Software'],
    filtros: ['Configuración', 'Parámetros'],
    admin: ['Configuración', 'Usuarios']
  };

  function goView(v) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.querySelector('.nav-item[data-view="' + v + '"]');
    if (el) el.classList.add('active');
    document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById('view-' + v);
    if (sec) sec.classList.add('active');
    const t = TITLES[v] || ['', ''];
    document.getElementById('crumb').textContent = t[0];
    document.getElementById('page-title').textContent = t[1];
    window.CMI_CURRENT_VIEW = v;
    if (window.CMI_SIDEBAR_FILTERS) window.CMI_SIDEBAR_FILTERS.onViewChange(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
  }
  window.CMI_NAV = { go: goView };

  document.addEventListener('click', function (e) {
    const el = e.target.closest('.nav-item');
    if (!el || !el.dataset.view) return;
    goView(el.dataset.view);
  });

  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-backdrop').classList.add('show');
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('show');
  }

  document.addEventListener('DOMContentLoaded', function () {
    const ham = document.getElementById('hamburger');
    if (ham) ham.addEventListener('click', openSidebar);
    const bd = document.getElementById('sidebar-backdrop');
    if (bd) bd.addEventListener('click', closeSidebar);
  });

  /* ============================ Chart registry ============================ */
  const _charts = new Map();
  function makeChart(id, cfg) {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    // Destruir cualquier chart atado a este canvas — no solo el que registramos en
    // _charts: si un new Chart previo falló a mitad de construcción, Chart.js igual
    // dejó su instancia atada al canvas y _charts nunca la guardó; sin destruirla, el
    // próximo new Chart lanza "Canvas is already in use". Chart.getChart() consulta el
    // registro interno de Chart.js, así que atrapa también esas instancias huérfanas.
    const prev = (typeof Chart.getChart === 'function') ? Chart.getChart(ctx) : null;
    if (prev) { try { prev.destroy(); } catch (e) { } }
    else if (_charts.has(id)) { try { _charts.get(id).destroy(); } catch (e) { } }
    const c = new Chart(ctx, cfg);
    _charts.set(id, c);
    return c;
  }

  /* ============================ KPI CARDS ============================ */
  let _sparkSeq = 0;
  const _pendingSparks = [];

  function kpiCard(opts) {
    const title = opts.title, value = opts.value, meta = opts.meta;
    const status = opts.status, spark = opts.spark, sparkColor = opts.sparkColor;
    const variation = opts.variation, unit = opts.unit || '';
    const id = 'spk-' + (++_sparkSeq);
    const hasData = opts.hasData !== false;
    // variation null/undefined → sin histórico real que mostrar (ej. tarjetas de
    // backlog puntual): se omite el chip ▲/▼ en vez de mostrar un "▼ 0.0%" falso.
    const hasVariation = hasData && variation != null;
    const arrow = variation > 0 ? '▲' : '▼';
    const varColor = variation > 0 ? 'text-emerald-600' : 'text-rose-600';
    const valueClass = opts.valueClass || 'text-slate-900';
    // noChip: oculta el chip de estado y la franja de color superior. Para indicadores
    // sin meta contra la cual comparar (ej. conteos de backlog), donde un semáforo
    // "En meta/En riesgo/No cumple" no representaría nada real.
    const noChip = opts.noChip === true;
    // Prefijo de la línea inferior — por defecto "Meta: ". Las tarjetas sin meta real
    // (backlog) lo pasan vacío: el texto de abajo es un descriptor, no una meta.
    const metaPrefix = opts.metaPrefix != null ? opts.metaPrefix : 'Meta: ';
    _pendingSparks.push({ id, spark, sparkColor, hasData });
    const stripeClass = noChip ? '' : status === 'ok' ? ' kpi-ok' : status === 'warn' ? ' kpi-warn' : status === 'bad' ? ' kpi-bad' : '';
    return '<div class="card p-4' + stripeClass + '">' +
      '<div class="flex items-start justify-between">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight pr-2">' + title + '</div>' +
      (noChip ? '' : '<span class="chip ' + chipFor(status) + '">' + labelFor(status) + '</span>') +
      '</div>' +
      '<div class="mt-3 flex items-baseline gap-2">' +
      '<div class="text-2xl font-extrabold ' + valueClass + ' kpi-num">' + value + '<span class="text-base text-slate-400 font-bold">' + unit + '</span></div>' +
      (hasVariation ? '<div class="text-[11px] ' + varColor + ' font-semibold">' + arrow + ' ' + Math.abs(Number(variation) || 0).toFixed(1) + '%</div>' : '') +
      '</div>' +
      '<div class="text-[11px] text-slate-500 mt-1">' + metaPrefix + '<span class="font-semibold text-slate-700">' + meta + '</span></div>' +
      (opts.analisisId ? '<button type="button" class="analisis-btn" data-analisis-card="' + opts.analisisId + '">Análisis</button>' : '') +
      '<div class="spark-wrap mt-2"><canvas id="' + id + '"></canvas></div>' +
      '</div>';
  }

  function flushSparks() {
    while (_pendingSparks.length) {
      const s = _pendingSparks.shift();
      renderSpark(s.id, s.spark, s.sparkColor, s.hasData);
    }
  }

  function renderSpark(id, data, color, hasData) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const safe = Array.isArray(data) ? data.map(v => Number.isFinite(v) ? v : null) : [];
    const noData = !hasData || safe.every(v => !v);
    makeChart(id, {
      type: 'line',
      data: {
        labels: safe.map(function (_, i) { return i; }), datasets: [{
          data: noData ? safe.map(function () { return 0; }) : safe,
          borderColor: noData ? '#CBD5E1' : color,
          backgroundColor: noData ? 'rgba(203,213,225,.15)' : color + '22',
          fill: true, tension: .35, pointRadius: 0, borderWidth: 2, spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  }

  /* ============ Cards por área ============ */
  function _hasAnyData(arr) { return arr.some(function (v) { return v !== 0 && v != null; }); }

  function computeVendorReals() {
    var result = {};
    Object.keys(VENDOR_BUDGET).forEach(function (k) { result[k] = 0; });

    var raw = window.CMI_RAW_DATA || {};
    var cfg = window.CMI_STORE && window.CMI_STORE.getConfig();
    if (!cfg || !cfg.areas || !cfg.areas.comercial) return result;

    var rows = [];
    (cfg.areas.comercial.templates || []).forEach(function (tpl) {
      var d = raw[tpl]; if (d && d.rows) rows = rows.concat(d.rows);
    });
    if (!rows.length) return result;

    var sample = rows[0];
    var allKeys = Object.keys(sample);
    var catalog = (window.CMI_AREA_CATALOG || {}).comercial || {};
    var indivCols = [], gwyEntry = null;
    (catalog.targets || []).forEach(function (t) {
      if (t.id === 'pipeline') return;
      var aliases = [normK(t.id), normK(t.label)].concat((t.aliases || []).map(normK));
      var col = allKeys.find(function (k) {
        var nk = normK(k);
        return aliases.some(function (a) { return nk === a || nk.includes(a) || a.includes(nk); });
      });
      if (!col) return;
      if (t.filter) gwyEntry = { col: col, filter: t.filter };
      else indivCols.push(col);
    });

    var dateAliases = ['fecha_firma_contrato', 'fecha_firma', 'fechafirma', 'fecha_contrato', 'fechacontrato', 'firma', 'fecha', 'date'];
    var colFecha = allKeys.find(function (k) { return dateAliases.some(function (a) { return normK(k) === a; }); }) ||
      allKeys.find(function (k) { return dateAliases.some(function (a) { return normK(k).includes(a); }); });

    var trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    var mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    var activeIx = getActiveIx(trimKey, mesCorte);
    var activeSet = {};
    activeIx.forEach(function (i) { activeSet[i] = true; });

    rows.forEach(function (row) {
      if (colFecha) {
        var ix = window.CMI_MAPPER ? window.CMI_MAPPER.parseMonthIndex(row[colFecha]) : null;
        if (ix == null || !activeSet[ix]) return;
      }
      var rowVal = 0;
      var isGwy = gwyEntry && normK(String(row[gwyEntry.filter.col] || '')) === normK(gwyEntry.filter.val);
      if (isGwy) {
        rowVal = Number(row[gwyEntry.col]) || 0;
      } else {
        indivCols.forEach(function (col) { rowVal += Number(row[col]) || 0; });
      }
      if (!rowVal) return;
      rowVal /= 1e6; // COP → millones
      result.todos += rowVal;
      var vName = normK(String(row['Vendedor'] || ''));
      Object.keys(VENDOR_MATCHERS).forEach(function (k) {
        if (result[k] !== undefined && VENDOR_MATCHERS[k](vName)) result[k] = (result[k] || 0) + rowVal;
      });
    });
    return result;
  }

  function renderMetaVendedorCard(N, cur, hasData) {
    var vb = VENDOR_BUDGET[_vendorKey] || VENDOR_BUDGET.todos;
    var prorateYtd = sumTo(vb.months, cur + 1);
    // Reales por vendedor desde los datos crudos
    var reals = computeVendorReals();
    var realYtd = reals[_vendorKey] || 0;
    var hasReal = hasData;

    var status = hasReal ? semaphore(realYtd, prorateYtd) : 'mute';
    var pct = (hasReal && vb.annual > 0) ? ((realYtd / vb.annual) - 1) * 100 : null;
    var pctArrow = pct !== null ? (pct >= 0 ? '▲' : '▼') : '';
    var pctColor = pct !== null ? (pct >= 0 ? 'color:#10B981' : 'color:#EF4444') : '';

    var sparkId = 'spk-vendor';
    _pendingSparks.push({ id: sparkId, spark: vb.months, sparkColor: COLORS.brand, hasData: vb.months.some(function (v) { return v > 0; }) });

    var btnHtml = Object.keys(VENDOR_BUDGET).map(function (k) {
      var cfg = VENDOR_BUDGET[k], active = k === _vendorKey;
      return '<button data-vendor="' + k + '" style="padding:2px 7px;border-radius:99px;font-size:10px;font-weight:600;cursor:pointer;line-height:1.6;border:1px solid ' + (active ? 'transparent' : '#E2E8F0') + ';background:' + (active ? '#0F172A' : '#F8FAFC') + ';color:' + (active ? '#fff' : '#64748B') + ';">' + cfg.label + '</button>';
    }).join('');

    var realLine = hasReal
      ? '<div class="text-[11px] text-slate-500 mt-1">Real YTD: <span class="font-semibold text-slate-800">' + fmtM(realYtd) + '</span>'
      + (pct !== null ? ' <span style="font-size:10px;font-weight:700;' + pctColor + '">' + pctArrow + ' ' + Math.abs(pct).toFixed(1) + '%</span>' : '')
      + '</div>'
      : '';

    return '<div class="card p-4">' +
      '<div class="flex items-start justify-between">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight pr-2">Meta vendedor</div>' +
      '<span class="chip ' + chipFor(status) + '">' + labelFor(status) + '</span>' +
      '</div>' +
      '<div class="flex flex-wrap gap-1 mt-2">' + btnHtml + '</div>' +
      '<div class="mt-2 flex items-baseline gap-2">' +
      '<div class="text-2xl font-extrabold text-slate-900 kpi-num">' + fmtM(vb.annual) + '</div>' +
      '</div>' +
      '<div class="text-[11px] text-slate-500 mt-1">Meta: <span class="font-semibold text-slate-700">' + vb.label + ' — anual</span></div>' +
      realLine +
      '<button type="button" class="analisis-btn" data-analisis-card="metaVendedor">Análisis</button>' +
      '<div class="spark-wrap mt-2"><canvas id="' + sparkId + '"></canvas></div>' +
      '</div>';
  }

  function buildCardsComercial() {
    const N = window.CMI_DATA.COM;
    const cur = getCur();
    const hasData = _hasAnyData(N.nuevos) || _hasAnyData(N.cruzada);
    const sumNuevos = sumTo(N.nuevos, cur + 1);
    const sumCruzada = sumTo(N.cruzada, cur + 1);
    const sumRen = sumTo(N.renovaciones, cur + 1);
    const sumGw = sumTo(N.greenywave, cur + 1);

    // Proyecciones YTD (mismos meses que los reales)
    const projNuevos = sumTo(COM_PROJ.nuevos, cur + 1);
    const projCruzada = sumTo(COM_PROJ.cruzada, cur + 1);
    const projRen = sumTo(COM_PROJ.renovaciones, cur + 1);
    const projGw = sumTo(COM_PROJ.greenywave, cur + 1);

    // Variación: (real YTD / proyección YTD - 1) × 100
    const pctVsProj = function (actual, proj) { return proj ? ((actual / proj) - 1) * 100 : 0; };
    const varNuevos = pctVsProj(sumNuevos, projNuevos);
    const varCruzada = pctVsProj(sumCruzada, projCruzada);
    const varRen = pctVsProj(sumRen, projRen);
    const varGw = pctVsProj(sumGw, projGw);

    const data = [
      {
        title: 'Ingresos nuevos', value: hasData ? fmtMoneyM(sumNuevos * 1e6) : '—', meta: '$6.000M anual',
        status: hasData ? semaphore(sumNuevos, projNuevos) : 'mute',
        spark: N.nuevos.slice(0, cur + 1), sparkColor: COLORS.brand, variation: varNuevos, hasData, analisisId: 'nuevos'
      },
      {
        title: 'Venta cruzada', value: hasData ? fmtMoneyM(sumCruzada * 1e6) : '—', meta: '$2.500M anual',
        status: hasData ? semaphore(sumCruzada, projCruzada) : 'mute',
        spark: N.cruzada.slice(0, cur + 1), sparkColor: COLORS.violet, variation: varCruzada, hasData, analisisId: 'cruzada'
      },
      {
        title: 'Renovaciones', value: hasData ? fmtMoneyM(sumRen * 1e6) : '—', meta: '$3.729,8M anual',
        status: hasData ? semaphore(sumRen, projRen) : 'mute',
        spark: N.renovaciones.slice(0, cur + 1), sparkColor: COLORS.warn, variation: varRen, hasData, analisisId: 'renovaciones'
      },
      {
        title: 'Greenywave', value: hasData ? fmtMoneyM(sumGw * 1e6) : '—', meta: '$1.575M anual',
        status: hasData ? semaphore(sumGw, projGw) : 'mute',
        spark: N.greenywave.slice(0, cur + 1), sparkColor: COLORS.ok, variation: varGw, hasData, analisisId: 'greenywave'
      }
    ];
    var cardsEl = document.getElementById('cards-comercial');
    cardsEl.innerHTML = data.map(kpiCard).join('') + renderCoberturaCard() + renderMetaVendedorCard(N, cur, hasData);
    flushSparks();
    if (!cardsEl._vendorBound) {
      cardsEl._vendorBound = true;
      cardsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-vendor]');
        if (!btn) return;
        _vendorKey = btn.dataset.vendor;
        buildCardsComercial();
      });
    }
  }

  function buildCardsFinanciera() {
    const F = window.CMI_DATA.FIN;
    const cur = getCur();
    const hasData = _hasAnyData(F.ebitda);
    const data = [
      {
        title: 'Margen EBITDA', value: hasData ? fmtPct(F.ebitda[cur]) : '—', meta: '≥ 12%',
        status: hasData ? semaphore(F.ebitda[cur], 12) : 'mute',
        spark: F.ebitda.slice(0, cur + 1), sparkColor: COLORS.brand, variation: 5.1, hasData
      },
      {
        title: 'Margen utilidad operacional', value: hasData ? fmtPct(F.utilOp[cur]) : '—', meta: '≥ 15%',
        status: hasData ? semaphore(F.utilOp[cur], 15) : 'mute',
        spark: F.utilOp.slice(0, cur + 1), sparkColor: COLORS.ok, variation: 4.2, hasData
      },
      {
        title: 'Margen utilidad bruta', value: hasData ? fmtPct(F.utilBruta[cur]) : '—', meta: '≥ 45%',
        status: hasData ? semaphore(F.utilBruta[cur], 45) : 'mute',
        spark: F.utilBruta.slice(0, cur + 1), sparkColor: COLORS.violet, variation: 2.7, hasData
      },
      {
        title: 'Facturación', value: hasData ? fmtPct(F.facturacion[cur]) : '—', meta: '≥ 95%',
        status: hasData ? semaphore(F.facturacion[cur], 95) : 'mute',
        spark: F.facturacion.slice(0, cur + 1), sparkColor: COLORS.brandDeep, variation: 1.1, hasData
      },
      {
        title: 'Recaudo', value: hasData ? fmtPct(F.recaudo[cur]) : '—', meta: '≥ 90%',
        status: hasData ? semaphore(F.recaudo[cur], 90) : 'mute',
        spark: F.recaudo.slice(0, cur + 1), sparkColor: COLORS.ok, variation: 1.1, hasData
      },
      {
        title: 'Personal competente', value: hasData ? fmtPct(F.personal[cur]) : '—', meta: '≥ 80%',
        status: hasData ? semaphore(F.personal[cur], 80) : 'mute',
        spark: F.personal.slice(0, cur + 1), sparkColor: COLORS.pink, variation: 2.4, hasData
      }
    ];
    document.getElementById('cards-financiera').innerHTML = data.map(kpiCard).join('');
    flushSparks();
  }

  function buildCardsProyectos() {
    const P = window.CMI_DATA.PRY;
    const cur = getCur();
    const hasData = _hasAnyData(P.ejecucion);
    const data = [
      {
        title: 'Cumplimiento plan de ejecución', value: hasData ? fmtPct(P.ejecucion[cur]) : '—', meta: '≥ 95%',
        status: hasData ? semaphore(P.ejecucion[cur], 95) : 'mute',
        spark: P.ejecucion.slice(0, cur + 1), sparkColor: COLORS.brand, variation: 1.0, hasData
      },
      {
        title: 'Consumo horas de desarrollo', value: hasData ? fmtPct(P.horas[cur]) : '—', meta: '≤ 100%',
        status: hasData ? semaphore(P.horas[cur], 100, 'lte') : 'mute',
        spark: P.horas.slice(0, cur + 1), sparkColor: COLORS.warn, variation: -1.0, hasData
      },
      {
        title: 'Avance económico de proyectos', value: hasData ? fmtPct(P.avance[cur]) : '—', meta: '≥ 95%',
        status: hasData ? semaphore(P.avance[cur], 95) : 'mute',
        spark: P.avance.slice(0, cur + 1), sparkColor: COLORS.violet, variation: 2.2, hasData
      },
      {
        title: 'Habilitación de facturación', value: hasData ? fmtPct(P.habilit[cur]) : '—', meta: '≥ 95%',
        status: hasData ? semaphore(P.habilit[cur], 95) : 'mute',
        spark: P.habilit.slice(0, cur + 1), sparkColor: COLORS.ok, variation: 0, hasData
      }
    ];
    document.getElementById('cards-proyectos').innerHTML = data.map(kpiCard).join('');
    flushSparks();
  }

  function buildCardsSoluciones() {
    const S = window.CMI_DATA.SOL;
    const trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    const mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    const meta = S.metaConfiabilidad != null ? S.metaConfiabilidad : 90;
    const activeIx = getActiveIx(trimKey, mesCorte);
    // avgActive ignora null/undefined/0 (ver getActiveIx/avgActive arriba) — los meses
    // sin dato real (ago-dic, aún no cierra el extracto) no bajan el promedio ni se
    // promedian como 0%.
    const confVal = avgActive(S.confiabilidad, trimKey, mesCorte);
    const hasData = confVal !== 0;
    const defVal = +(100 - confVal).toFixed(1);

    document.getElementById('cards-soluciones').innerHTML = [
      // Variación = brecha vs meta (mismo mecanismo que buildCardsIds()): con datos
      // reales pero incompletos (meses futuros aún en null), no hay un "mes anterior"
      // fiable con el que comparar mes a mes.
      {
        title: 'Confiabilidad del software', value: hasData ? fmtPct(confVal) : '—', meta: '≥ ' + meta + '%',
        status: hasData ? semaphore(confVal, meta) : 'mute',
        spark: activeIx.map(i => S.confiabilidad[i]), sparkColor: COLORS.brand, variation: confVal - meta, hasData
      },
      {
        title: 'Defectos de calidad', value: hasData ? fmtPct(defVal) : '—', meta: '≤ 10%',
        status: hasData ? semaphore(defVal, 10, 'lte') : 'mute',
        spark: activeIx.map(i => S.confiabilidad[i] == null ? null : +(100 - S.confiabilidad[i]).toFixed(1)), sparkColor: COLORS.warn, variation: 10 - defVal, hasData
      },
      // Backlog puntual (sin dimensión mensual y sin meta): sin histórico → variation:null
      // (sin chip ▲/▼); sin meta contra la cual comparar → noChip:true (sin semáforo de
      // estado). spark en ceros para degradar a la misma línea plana "sin datos" que
      // usan otras tarjetas de la app.
      {
        title: 'Tickets abiertos', value: String(S.abiertos), meta: 'Backlog total', metaPrefix: '',
        noChip: true, valueClass: 'text-rose-600', variation: null, hasData: true,
        spark: [0, 0, 0, 0, 0], sparkColor: COLORS.bad
      },
      {
        title: 'Abiertas calidad', value: String(S.calidad), meta: '35,6% del backlog', metaPrefix: '',
        noChip: true, valueClass: 'text-rose-600', variation: null, hasData: true,
        spark: [0, 0, 0, 0, 0], sparkColor: COLORS.warn
      },
      {
        title: 'Abiertas servicios', value: String(S.servicios), meta: '58,5% del backlog', metaPrefix: '',
        noChip: true, valueClass: 'text-rose-600', variation: null, hasData: true,
        spark: [0, 0, 0, 0, 0], sparkColor: COLORS.brandDeep
      }
    ].map(kpiCard).join('');
    flushSparks();
  }

  function buildCardsIds() {
    const I = window.CMI_DATA.IDS;
    const trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    const mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    const metas = I.metas || {};
    // Meta dinámica (derivada del dato real vía columna META) — cae a 90% mientras no
    // haya datos, mismo criterio de placeholder que el resto de los indicadores IDS/ANS.
    const confMeta = metas.confiabilidad != null ? metas.confiabilidad : 90;
    const ansMeta = metas.ansGlobal != null ? metas.ansGlobal : 90;
    // Promedio sobre el rango activo (trimestre/mes de corte), no el valor de un único
    // mes — así "Acumulado YTD" refleja todos los meses con dato, no solo diciembre.
    const confVal = avgActive(I.confiabilidad, trimKey, mesCorte);
    const ansVal = avgActive(I.ansGlobal, trimKey, mesCorte);
    const hasData = confVal !== 0;
    const hasAns = ansVal !== 0;
    // El sparkline también debe recortarse al rango activo — antes mostraba siempre
    // los 12 meses aunque el trimestre filtrado fuera un Q puntual.
    const activeIx = getActiveIx(trimKey, mesCorte);
    document.getElementById('cards-ids').innerHTML = [
      // variation = brecha vs meta (valor - meta), no una tendencia mes a mes — con datos
      // de evento (no series regulares) no hay "mes anterior" real con el que comparar.
      {
        title: 'Nivel de confiabilidad del software', value: hasData ? fmtPct(confVal) : '—', meta: '≥ ' + confMeta + '%',
        status: hasData ? semaphore(confVal, confMeta) : 'mute',
        spark: activeIx.map(i => I.confiabilidad[i]), sparkColor: COLORS.brand, variation: confVal - confMeta, hasData
      },
      {
        title: 'Cumplimiento ANS', value: hasAns ? fmtPct(ansVal) : '—', meta: '≥ ' + ansMeta + '%',
        status: hasAns ? semaphore(ansVal, ansMeta) : 'mute',
        spark: activeIx.map(i => I.ansGlobal[i]), sparkColor: COLORS.violet, variation: ansVal - ansMeta, hasData: hasAns
      }
    ].map(kpiCard).join('');
    flushSparks();
  }

  /* ============================ CHART HELPERS ============================ */
  Chart.defaults.font.family = "'Inter',sans-serif";
  Chart.defaults.color = '#475569';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  const gridLight = { grid: { color: 'rgba(226,232,240,0.55)', drawBorder: false }, ticks: { color: '#94A3B8' } };

  function lineChart(id, datasets, opts) {
    opts = opts || {};
    return makeChart(id, {
      type: 'line',
      data: { labels: MONTHS, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: opts.legend !== false, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
          tooltip: Object.assign({ backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 } }, opts.tooltipOpts || {})
        },
        scales: { x: gridLight, y: Object.assign({}, gridLight, opts.yOpts || {}) }
      }
    });
  }

  function barChart(id, datasets, opts) {
    opts = opts || {};
    const legendLabels = { usePointStyle: true, boxWidth: 8, padding: 16 };
    // opts.legendColors: [colorPorDatasetIndex] — fuerza el swatch de leyenda cuando el
    // dataset usa backgroundColor por-barra (array), en vez del color del índice 0 que
    // Chart.js toma por defecto (ver dominantColor()).
    if (opts.legendColors) {
      legendLabels.generateLabels = function (chart) {
        const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
        items.forEach(item => {
          const c = opts.legendColors[item.datasetIndex];
          if (c) { item.fillStyle = c; item.strokeStyle = c; }
        });
        return items;
      };
    }
    return makeChart(id, {
      type: 'bar',
      data: { labels: opts.labels || MONTHS, datasets: datasets },
      options: {
        // opts.horizontal → indexAxis:'y' (barras horizontales). Con indexAxis:'y',
        // Chart.js invierte el rol de las escalas: 'x' pasa a ser el eje de valor y
        // 'y' el eje de categorías — por eso opts.xOpts (pensado para el eje de
        // valor cuando es horizontal) siempre se mezcla en la escala 'x', nunca en 'y'.
        indexAxis: opts.horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: opts.legend !== false, position: 'bottom', labels: legendLabels },
          tooltip: Object.assign({ backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 } }, opts.tooltipOpts || {})
        },
        scales: {
          x: Object.assign({}, gridLight, { stacked: !!opts.stacked }, opts.xOpts || {}),
          y: Object.assign({}, gridLight, { stacked: !!opts.stacked }, opts.yOpts || {})
        }
      }
    });
  }

  function doughnut(id, labels, data, colors, opts) {
    opts = opts || {};
    return makeChart(id, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: opts.cutout || '70%',
        plugins: {
          legend: { display: opts.legend !== false, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
          tooltip: Object.assign({ backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 } }, opts.tooltipOpts || {})
        }
      }
    });
  }

  function gauge(id, value, color) {
    const v = Number(value) || 0;
    return makeChart(id, {
      type: 'doughnut',
      data: { datasets: [{ data: [v, 100 - v], backgroundColor: [color, '#E2E8F0'], borderWidth: 0, circumference: 270, rotation: 225 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
  }

  /* ============================ RESUMEN EJECUTIVO ============================ */
  function renderExec() {
    const spark = _hasAnyData(window.CMI_DATA.COM.nuevos) ? [74, 76, 79, 80, 82] : [0, 0, 0, 0, 0];
    makeChart('exec-spark', {
      type: 'line',
      data: {
        labels: MONTHS.slice(0, 5), datasets: [{
          data: spark,
          borderColor: COLORS.brand, backgroundColor: 'rgba(14,165,233,.15)',
          fill: true, tension: .4, pointRadius: 0, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });

    barChart('exec-areas', [
      {
        label: 'Cumplimiento %',
        data: [0, 0, 0, 0, 0],
        backgroundColor: ['#0EA5E9', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'],
        borderRadius: 6, maxBarThickness: 48
      }
    ], { labels: ['Comercial', 'Adm. y Fin.', 'Proyectos', 'Soluciones', 'IDS'], legend: false, yOpts: { max: 100, ticks: { callback: function (v) { return v + '%'; } } } });

    doughnut('exec-donut', ['Cumplidos', 'En riesgo', 'No cumplidos'], [0, 0, 0], [COLORS.ok, COLORS.warn, COLORS.bad]);

    lineChart('exec-line', [
      { label: 'Real', data: Array(12).fill(0), borderColor: COLORS.ok, backgroundColor: 'rgba(16,185,129,.12)', fill: true, tension: .35, pointBackgroundColor: COLORS.ok, pointRadius: 4, borderWidth: 3 },
      { label: 'Meta', data: Array(12).fill(90), borderColor: COLORS.brand, borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false }
    ], { yOpts: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } });

    document.getElementById('exec-top').innerHTML =
      '<div class="text-[12px] text-slate-400 py-3 text-center">Sin datos — configura el enlace OData</div>';

    document.getElementById('exec-bottom').innerHTML =
      '<tr><td colspan="5" class="py-3 text-center text-[12px] text-slate-400">Sin datos — configura el enlace OData</td></tr>';

    makeChart('exec-radar', {
      type: 'radar',
      data: {
        labels: ['Financiera', 'Cliente', 'Procesos', 'Aprendizaje', 'Crecimiento'],
        datasets: [
          { label: 'Real', data: [0, 0, 0, 0, 0], backgroundColor: 'rgba(14,165,233,.20)', borderColor: COLORS.brand, pointBackgroundColor: COLORS.brand, borderWidth: 2 },
          { label: 'Meta', data: [90, 90, 95, 80, 90], backgroundColor: 'rgba(16,185,129,.10)', borderColor: COLORS.ok, borderDash: [4, 4], pointBackgroundColor: COLORS.ok, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } } },
        scales: {
          r: {
            min: 0, max: 100, grid: { color: '#E2E8F0' }, angleLines: { color: '#E2E8F0' },
            pointLabels: { font: { size: 11, weight: '600' }, color: '#334155' }, ticks: { display: false, stepSize: 10 }
          }
        }
      }
    });
  }

  /* ============================ ACUMULADO KPI CHART ============================ */
  function renderAcumChart(kpi) {
    var C = window.CMI_DATA.COM;

    var KPI_CFG = {
      todos: {
        realFn: function () { return C.nuevos.map(function (_, i) { return (C.nuevos[i] || 0) + (C.cruzada[i] || 0) + (C.renovaciones[i] || 0) + (C.greenywave[i] || 0); }); },
        projFn: function () { return MONTHS.map(function (_, i) { return COM_PROJ.nuevos[i] + COM_PROJ.cruzada[i] + COM_PROJ.renovaciones[i] + COM_PROJ.greenywave[i]; }); },
        metaLabel: '$13.804,8M', sub: 'Ingresos totales acumulados',
        color: '#0F172A', bg: 'rgba(15,23,42,.10)', realLabel: 'Acumulado real'
      },
      nuevos: {
        realFn: function () { return C.nuevos.slice(); },
        projFn: function () { return COM_PROJ.nuevos.slice(); },
        metaLabel: '$6.000M', sub: 'Ingresos nuevos acumulados',
        color: COLORS.brand, bg: 'rgba(14,165,233,.15)', realLabel: 'Ingresos nuevos'
      },
      cruzada: {
        realFn: function () { return C.cruzada.slice(); },
        projFn: function () { return COM_PROJ.cruzada.slice(); },
        metaLabel: '$2.500M', sub: 'Venta cruzada acumulada',
        color: COLORS.violet, bg: 'rgba(139,92,246,.15)', realLabel: 'Venta cruzada'
      },
      renovaciones: {
        realFn: function () { return C.renovaciones.slice(); },
        projFn: function () { return COM_PROJ.renovaciones.slice(); },
        metaLabel: '$3.729,8M', sub: 'Renovaciones acumuladas',
        color: COLORS.warn, bg: 'rgba(245,158,11,.15)', realLabel: 'Renovaciones'
      },
      greenywave: {
        realFn: function () { return C.greenywave.slice(); },
        projFn: function () { return COM_PROJ.greenywave.slice(); },
        metaLabel: '$1.575M', sub: 'Greenywave acumulado',
        color: COLORS.ok, bg: 'rgba(16,185,129,.15)', realLabel: 'Greenywave'
      }
    };

    var cfg = KPI_CFG[kpi] || KPI_CFG.todos;
    var acum = cumulative(cfg.realFn());
    var metaAcum = cumulative(cfg.projFn());

    var sub = document.getElementById('com-acum-sub');
    if (sub) sub.textContent = cfg.sub + ' contra meta de ' + cfg.metaLabel;

    // Sync active button state
    document.querySelectorAll('.acum-kpi-btn').forEach(function (b) {
      b.classList.toggle('acum-kpi-active', b.dataset.kpi === kpi);
    });

    var yFmt = function (v) {
      if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1) + 'k M';
      return '$' + Math.round(v) + 'M';
    };

    lineChart('com-acum', [
      {
        label: cfg.realLabel, data: acum, borderColor: cfg.color, backgroundColor: cfg.bg,
        fill: true, tension: .3, pointBackgroundColor: cfg.color, pointRadius: 3, borderWidth: 3
      },
      {
        label: 'Meta acumulada', data: metaAcum, borderColor: COLORS.ok,
        borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false
      }
    ], { yOpts: { ticks: { callback: yFmt } }, tooltipOpts: tooltipM });
  }

  /* ============================ COMERCIAL ============================ */
  function renderComercial() {
    buildCardsComercial();
    const C = window.CMI_DATA.COM;

    // ── Rango de meses según filtro de trimestre ──────────────────────────
    var Q_RANGES = {
      ytd: { ix: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], label: 'YTD', period: 'Ene – Dic 2026' },
      q1: { ix: [0, 1, 2], label: 'Q1', period: 'Ene – Mar 2026' },
      q2: { ix: [3, 4, 5], label: 'Q2', period: 'Abr – Jun 2026' },
      q3: { ix: [6, 7, 8], label: 'Q3', period: 'Jul – Sep 2026' },
      q4: { ix: [9, 10, 11], label: 'Q4', period: 'Oct – Dic 2026' }
    };
    var trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    var mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    var range = Q_RANGES[trimKey] || Q_RANGES.ytd;
    var isYTD = trimKey === 'ytd';

    // Narrowing: si se eligió un mes específico dentro del Q, mostrar solo ese mes
    var singleMonth = (!isYTD && mesCorte !== 'all') ? parseInt(mesCorte, 10) : null;
    if (singleMonth != null && !isNaN(singleMonth)) {
      range = { ix: [singleMonth], label: MONTHS[singleMonth], period: MONTHS[singleMonth] + ' 2026' };
    }

    // Extrae solo los meses del rango de un array de 12 posiciones
    var pick = function (arr) { return range.ix.map(function (i) { return arr[i] || 0; }); };
    // Suma solo los meses del rango
    var sumR = function (arr) { return range.ix.reduce(function (s, i) { return s + (arr[i] || 0); }, 0); };
    // Labels de meses para el eje X
    var rangeMonths = range.ix.map(function (i) { return MONTHS[i]; });

    // ── Actualizar títulos dinámicos en el DOM ────────────────────────────
    var el = function (id) { return document.getElementById(id); };
    var stackTitle = isYTD ? 'Ingresos mensuales por línea'
      : singleMonth != null ? 'Ingresos de ' + MONTHS[singleMonth] + ' por línea'
        : 'Ingresos trimestrales por línea';
    if (el('com-stack-title')) el('com-stack-title').textContent = stackTitle;
    if (el('com-stack-period')) el('com-stack-period').textContent = range.period;
    if (el('com-donut-title')) el('com-donut-title').textContent = 'Mix de ingresos ' + range.label;
    if (el('com-donut-sub')) el('com-donut-sub').textContent = isYTD ? 'Distribución acumulada por línea' : 'Distribución ' + range.label + ' por línea';
    if (el('com-total-label')) el('com-total-label').textContent = 'Total ' + range.label;

    // ── Gráfico de barras apiladas + líneas de proyección ────────────────
    barChart('com-stack', [
      { label: 'Nuevos', data: pick(C.nuevos), backgroundColor: COLORS.brand, borderRadius: 4, stack: 's' },
      { label: 'Venta cruzada', data: pick(C.cruzada), backgroundColor: COLORS.violet, borderRadius: 4, stack: 's' },
      { label: 'Renovaciones', data: pick(C.renovaciones), backgroundColor: COLORS.warn, borderRadius: 4, stack: 's' },
      { label: 'Greenywave', data: pick(C.greenywave), backgroundColor: COLORS.ok, borderRadius: 4, stack: 's' },
      {
        type: 'line', label: 'Proy. Nuevos', data: pick(COM_PROJ.nuevos), stack: 'pl-n',
        borderColor: COLORS_P.brand, borderDash: [5, 4], borderWidth: 1.2, fill: false, tension: .35,
        pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: COLORS_P.brand, pointBorderWidth: 1.5
      },
      {
        type: 'line', label: 'Proy. Venta cruzada', data: pick(COM_PROJ.cruzada), stack: 'pl-c',
        borderColor: COLORS_P.violet, borderDash: [5, 4], borderWidth: 1.2, fill: false, tension: .35,
        pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: COLORS_P.violet, pointBorderWidth: 1.5
      },
      {
        type: 'line', label: 'Proy. Renovaciones', data: pick(COM_PROJ.renovaciones), stack: 'pl-r',
        borderColor: COLORS_P.warn, borderDash: [5, 4], borderWidth: 1.2, fill: false, tension: .35,
        pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: COLORS_P.warn, pointBorderWidth: 1.5
      },
      {
        type: 'line', label: 'Proy. Greenywave', data: pick(COM_PROJ.greenywave), stack: 'pl-g',
        borderColor: COLORS_P.ok, borderDash: [5, 4], borderWidth: 1.2, fill: false, tension: .35,
        pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: COLORS_P.ok, pointBorderWidth: 1.5
      }
    ], { stacked: true, labels: rangeMonths, yOpts: { ticks: { callback: function (v) { return '$' + v + 'M'; } } }, tooltipOpts: tooltipM });

    // ── Donut: Mix de ingresos (solo meses del rango) ────────────────────
    var _donutVals = [sumR(C.nuevos), sumR(C.cruzada), sumR(C.renovaciones), sumR(C.greenywave)];
    var _updateDonutTotal = function (chart) {
      var sum = 0;
      _donutVals.forEach(function (v, i) { if (chart.getDataVisibility(i)) sum += v; });
      if (el('com-total')) el('com-total').textContent = '$' + sum.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';
    };
    makeChart('com-donut', {
      type: 'doughnut',
      data: {
        labels: ['Nuevos', 'Venta cruzada', 'Renovaciones', 'Greenywave'],
        datasets: [{ data: _donutVals, backgroundColor: [COLORS.brand, COLORS.violet, COLORS.warn, COLORS.ok], borderWidth: 0, hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        plugins: {
          legend: {
            display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 },
            onClick: function (e, legendItem, legend) {
              var chart = legend.chart;
              chart.toggleDataVisibility(legendItem.index);
              chart.update();
              _updateDonutTotal(chart);
            }
          },
          tooltip: {
            backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 },
            callbacks: { label: function (ctx) { return ' ' + ctx.label + ': ' + fmtM(ctx.parsed); } }
          }
        }
      }
    });
    var totalRange = _donutVals.reduce(function (s, v) { return s + v; }, 0);
    if (el('com-total')) el('com-total').textContent = '$' + totalRange.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';

    // ── Gráfico acumulado con filtro por KPI ─────────────────────────────
    var acumCard = document.getElementById('com-acum-card');
    if (acumCard && !acumCard._kpiBound) {
      acumCard._kpiBound = true;
      acumCard.addEventListener('click', function (e) {
        var btn = e.target.closest('.acum-kpi-btn');
        if (!btn) return;
        _acumKpi = btn.dataset.kpi || 'todos';
        renderAcumChart(_acumKpi);
      });
    }
    renderAcumChart(_acumKpi);

    renderComercialDetalle();
    renderPipelineFunnel();
  }

  /* ============================ DETALLE DE ACTIVIDADES ============================ */
  function renderComercialDetalle() {
    var card = document.getElementById('com-detalle-card');
    var cont = document.getElementById('com-detalle');
    if (!card || !cont) return;

    // ── Fuente de datos ───────────────────────────────────────────────────
    var raw = window.CMI_RAW_DATA || {};
    var cfg = window.CMI_STORE && window.CMI_STORE.getConfig();
    if (!cfg || !cfg.areas || !cfg.areas.comercial) { card.style.display = 'none'; return; }

    var rows = [];
    (cfg.areas.comercial.templates || []).forEach(function (tpl) {
      var d = raw[tpl]; if (d && d.rows) rows = rows.concat(d.rows);
    });
    if (!rows.length) { card.style.display = 'none'; return; }
    card.style.display = '';

    // ── Detección dinámica de columnas descriptivas ───────────────────────
    var sample = rows[0];
    var allKeys = Object.keys(sample);
    function findCol(patterns) {
      var hit = allKeys.find(function (k) { return patterns.some(function (p) { return normK(k) === p; }); });
      if (!hit) hit = allKeys.find(function (k) { return patterns.some(function (p) { return normK(k).includes(p) || p.includes(normK(k)); }); });
      return hit || null;
    }
    var colId = findCol(['id_actividad', 'id_contrato', 'actividad', 'no_actividad', 'numero_contrato', 'codigo', 'id']);
    var colFecha = findCol(['fecha_firma_contrato', 'fecha_firma', 'fechafirma', 'fecha_contrato', 'fechacontrato']);
    if (!colFecha) colFecha = findCol(['firma', 'fecha', 'date']);
    var colCliente = findCol(['cliente', 'razon_social', 'razonsocial', 'nombre_cliente', 'empresa']);
    var colVend = 'Vendedor';

    // ── Columnas de valor desde el catálogo ──────────────────────────────
    var catalog = (window.CMI_AREA_CATALOG || {}).comercial || {};
    var valCols = []; // { col, id, label, tagClass, filter? }
    var tagClasses = { nuevos: 'det-tag-nuevos', cruzada: 'det-tag-cruzada', renovaciones: 'det-tag-renovaciones', greenywave: 'det-tag-greenywave' };
    (catalog.targets || []).forEach(function (t) {
      if (t.id === 'pipeline') return;
      var aliases = [normK(t.id), normK(t.label)].concat((t.aliases || []).map(normK));
      var col = allKeys.find(function (k) {
        var nk = normK(k);
        return aliases.some(function (a) { return nk === a || nk.includes(a) || a.includes(nk); });
      });
      if (col) valCols.push({ col: col, id: t.id, label: t.label, tagClass: tagClasses[t.id] || 'det-tag-nuevos', filter: t.filter || null });
    });

    // ── Rango de meses activo ─────────────────────────────────────────────
    var trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    var mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    var activeIx = getActiveIx(trimKey, mesCorte);
    var activeSet = {};
    activeIx.forEach(function (i) { activeSet[i] = true; });

    // ── Separar cols individuales vs Greenywave ───────────────────────────
    var indivCols = valCols.filter(function (vc) { return !vc.filter; });
    var gwyEntry = valCols.find(function (vc) { return !!vc.filter; });
    // Columna de valor total para filas "Conjunto"
    var colTotal = gwyEntry ? gwyEntry.col : allKeys.find(function (k) {
      return ['valor_total_comercial', 'valor_total', 'vr_subtotal'].some(function (a) { return normK(k).includes(a); });
    }) || null;

    // ── Filtro de responsable ─────────────────────────────────────────────
    var resp = window.CMI_FILTROS && window.CMI_FILTROS.responsable;

    // ── Construcción de filas ─────────────────────────────────────────────
    var tableRows = [];
    rows.forEach(function (row) {
      if (resp && resp !== 'todos' && row[colVend] !== resp) return;
      var dateRaw = colFecha ? row[colFecha] : null;
      var ix = window.CMI_MAPPER ? window.CMI_MAPPER.parseMonthIndex(dateRaw) : null;
      if (ix == null || !activeSet[ix]) return;

      var base = {
        id: colId ? (row[colId] || '—') : null,
        fecha: dateRaw,
        vend: row[colVend] || '—',
        cliente: colCliente ? (row[colCliente] || '—') : '—',
        tooltip: null,
        _dateObj: dateRaw ? new Date(dateRaw) : null
      };

      // Greenywave: fila propia con Valor_Total_Comercial
      var isGwy = gwyEntry && normK(String(row[gwyEntry.filter.col] || '')) === normK(gwyEntry.filter.val);
      if (isGwy) {
        var gv = Number(row[gwyEntry.col]);
        if (gv > 0 && !isNaN(gv))
          tableRows.push(Object.assign({}, base, { label: gwyEntry.label, tagClass: gwyEntry.tagClass, valor: gv }));
        return;
      }

      // Valores individuales no-cero (Nuevos, Cruzada, Renovaciones)
      var nonZero = indivCols.filter(function (vc) { var v = Number(row[vc.col]); return v > 0 && !isNaN(v); });
      if (!nonZero.length) return;

      // Valores individuales de cada KPI para extracción en filtros específicos
      var rowRawVals = {};
      indivCols.forEach(function (vc) { rowRawVals[vc.id] = Number(row[vc.col]) || 0; });

      if (nonZero.length === 1) {
        // Tipo único → fila normal
        var vc0 = nonZero[0];
        tableRows.push(Object.assign({}, base, { label: vc0.label, tagClass: vc0.tagClass, valor: Number(row[vc0.col]), _rawVals: rowRawVals }));
      } else {
        // Múltiples tipos → "Conjunto": valor = Valor_Total_Comercial, tooltip = desglose
        var totalV = colTotal ? Number(row[colTotal]) : 0;
        if (!totalV || isNaN(totalV)) totalV = nonZero.reduce(function (s, vc) { return s + Number(row[vc.col]); }, 0);
        var tipLines = nonZero.map(function (vc) { return vc.label + ': $' + Number(row[vc.col]).toLocaleString('es-CO'); }).join('\n');
        tableRows.push(Object.assign({}, base, { label: 'Conjunto', tagClass: 'det-tag-conjunto', valor: totalV, tooltip: tipLines, _rawVals: rowRawVals }));
      }
    });

    // Ordenar por fecha
    tableRows.sort(function (a, b) {
      if (a._dateObj && b._dateObj && !isNaN(a._dateObj) && !isNaN(b._dateObj)) return a._dateObj - b._dateObj;
      return 0;
    });

    // ── Formato ───────────────────────────────────────────────────────────
    var fmtDate = function (raw) {
      if (!raw) return '—';
      var d = new Date(raw);
      if (isNaN(d.getTime())) return escapeHtml(String(raw));
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    // ── Label de período ──────────────────────────────────────────────────
    var periodLabel = trimKey === 'ytd' ? 'Ene – Dic 2026'
      : mesCorte !== 'all' ? MONTHS[parseInt(mesCorte, 10)] + ' 2026'
        : trimKey.toUpperCase() + ' 2026';

    // ── Render ────────────────────────────────────────────────────────────
    var hasId = tableRows.length && tableRows[0].id !== null;
    var totalValor = tableRows.reduce(function (s, r) { return s + r.valor; }, 0);

    var header = '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">' +
      '<div>' +
      '<h3 class="font-semibold text-slate-800">Detalle de actividades</h3>' +
      '<p class="text-xs text-slate-500" id="det-count-sub">' + tableRows.length + ' registros con valor · ' + periodLabel + '</p>' +
      '</div>' +
      '<div style="text-align:right;">' +
      '<span class="chip chip-info" id="det-count-chip">' + tableRows.length + ' reg.</span>' +
      '<div style="margin-top:6px;font-size:11px;color:#64748B;">Total: <strong style="color:#0F172A;" id="det-total-val">' + fmtCOP(totalValor) + '</strong></div>' +
      '</div>' +
      '</div>';

    if (!tableRows.length) {
      cont.innerHTML = header + '<p style="color:#94A3B8;font-size:13px;text-align:center;padding:24px 0;">Sin registros para el filtro actual.</p>';
      return;
    }

    // Tipos únicos presentes para las píldoras de filtro
    var uniqueTipos = [];
    tableRows.forEach(function (r) { if (uniqueTipos.indexOf(r.label) === -1) uniqueTipos.push(r.label); });

    var thead = '<thead><tr>' +
      (hasId ? '<th>ID</th>' : '') +
      '<th>Fecha firma</th><th>Responsable</th><th>Cliente</th><th>Tipo de ingreso</th>' +
      '<th style="text-align:right;">Valor</th>' +
      '</tr></thead>';

    // Función que construye el tbody a partir de un subconjunto filtrado
    function buildTbody(rows) {
      if (!rows.length) return '<tbody><tr><td colspan="' + (hasId ? 6 : 5) + '" style="text-align:center;padding:20px;color:#94A3B8;font-size:13px;">Sin registros para este tipo.</td></tr></tbody>';
      return '<tbody>' + rows.map(function (r) {
        var valCell;
        if (r.tooltip) {
          var tipHtml = r.tooltip.split('\n').map(function (l) {
            return '<span style="display:block;white-space:nowrap;">' + l + '</span>';
          }).join('');
          valCell = '<td class="det-val"><span class="det-val-tip">' + fmtCOP(r.valor) +
            '<span class="det-tip-box">' + tipHtml + '</span>' +
            '</span></td>';
        } else {
          valCell = '<td class="det-val">' + fmtCOP(r.valor) + '</td>';
        }
        return '<tr>' +
          (hasId ? '<td class="det-id">' + escapeHtml(r.id) + '</td>' : '') +
          '<td>' + fmtDate(r.fecha) + '</td>' +
          '<td>' + escapeHtml(r.vend) + '</td>' +
          '<td>' + escapeHtml(r.cliente) + '</td>' +
          '<td><span class="det-tag ' + r.tagClass + '">' + r.label + '</span></td>' +
          valCell +
          '</tr>';
      }).join('') + '</tbody>';
    }

    // Retorna filas según el filtro de tipo:
    // - '' (Todos)  → todas las filas con agrupación Conjunto intacta
    // - 'Conjunto'  → solo filas Conjunto
    // - tipo específico → filas puras del tipo + porción extraída de filas Conjunto
    function getFilteredRows(tipo) {
      if (!tipo) return tableRows;
      if (tipo === 'Conjunto') return tableRows.filter(function (r) { return r.label === 'Conjunto'; });
      var vcEntry = indivCols.find(function (vc) { return vc.label === tipo; });
      return tableRows
        .filter(function (r) {
          if (r.label === tipo) return true;
          if (r.label === 'Conjunto' && vcEntry && r._rawVals && (r._rawVals[vcEntry.id] || 0) > 0) return true;
          return false;
        })
        .map(function (r) {
          if (r.label === 'Conjunto' && vcEntry && r._rawVals) {
            return Object.assign({}, r, {
              label: tipo, tagClass: vcEntry.tagClass,
              valor: r._rawVals[vcEntry.id] || 0,
              tooltip: null
            });
          }
          return r;
        });
    }

    var pills = '<div id="det-tipo-filter" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<button class="det-pill det-pill-active" data-tipo="">Todos</button>' +
      uniqueTipos.map(function (t) { return '<button class="det-pill" data-tipo="' + t + '">' + t + '</button>'; }).join('') +
      '</div>';

    cont.innerHTML = header + pills +
      '<div id="det-table-wrap" style="overflow-x:auto;max-height:360px;overflow-y:auto;">' +
      '<table class="detalle-table">' + thead + buildTbody(tableRows) + '</table>' +
      '</div>';

    // Listener de píldoras (delegado en el contenedor)
    document.getElementById('det-tipo-filter').addEventListener('click', function (e) {
      var btn = e.target.closest('.det-pill');
      if (!btn) return;
      this.querySelectorAll('.det-pill').forEach(function (b) { b.classList.remove('det-pill-active'); });
      btn.classList.add('det-pill-active');
      var tipo = btn.getAttribute('data-tipo');
      var filtered = getFilteredRows(tipo);

      // Actualizar tabla
      var wrap = document.getElementById('det-table-wrap');
      wrap.querySelector('table').replaceChild(
        (function () { var tmp = document.createElement('template'); tmp.innerHTML = buildTbody(filtered); return tmp.content.firstChild; })(),
        wrap.querySelector('tbody')
      );

      // Actualizar contadores y total según el filtro activo
      var filteredTotal = filtered.reduce(function (s, r) { return s + r.valor; }, 0);
      var subEl = document.getElementById('det-count-sub');
      var chipEl = document.getElementById('det-count-chip');
      var totalEl = document.getElementById('det-total-val');
      if (subEl) subEl.textContent = filtered.length + ' registros con valor · ' + periodLabel;
      if (chipEl) chipEl.textContent = filtered.length + ' reg.';
      if (totalEl) totalEl.textContent = fmtCOP(filteredTotal);
    });
  }

  /* ============================ PIPELINE FUNNEL ============================ */

  /* Estado persistente del embudo — sobrevive re-renders al cambiar datos */
  var _plState = { tipo: 'todos', etapa: 'todos', cierre: 'todos' };
  var _plLastResp = 'todos'; /* rastrea cambios de responsable para resetear filtros internos */

  /* Normalización accent-insensitive usando code-point (sin regex de rango).
     También colapsa espacios múltiples y variantes de espacio (no-break, etc.) */
  function normPl(s) {
    var nfd = String(s || '').trim().toLowerCase().normalize('NFD');
    var out = '';
    for (var ci = 0; ci < nfd.length; ci++) {
      var cp = nfd.charCodeAt(ci);
      if (cp < 0x0300 || cp > 0x036f) out += nfd[ci];
    }
    return out.replace(/[\s ]+/g, ' ').trim();
  }

  /* Normalización para nombres de columna: elimina puntos, guiones y espacios
     para que "Vr. Subtotal" === "Vr_Subtotal" y "Estado Comercial" === "Estado_Comercial" */
  function normColPl(s) {
    return normPl(s).replace(/[\s._\-]+/g, '');
  }

  /* Detecta el nombre real de una columna escaneando TODAS las filas con 4 pasos */
  function pickColPl(rows, names) {
    var keySet = {};
    for (var s = 0; s < rows.length; s++) {
      var rk = Object.keys(rows[s]);
      for (var ri = 0; ri < rk.length; ri++) keySet[rk[ri]] = true;
    }
    var keys = Object.keys(keySet);
    var i, j, n, k;
    /* Paso 1: coincidencia exacta */
    for (i = 0; i < names.length; i++) { if (keySet[names[i]]) return names[i]; }
    /* Paso 2: normalización de acentos/mayúsculas */
    for (i = 0; i < names.length; i++) {
      n = normPl(names[i]);
      for (j = 0; j < keys.length; j++) { if (normPl(keys[j]) === n) return keys[j]; }
    }
    /* Paso 3: normalización de separadores (espacios, puntos, guiones bajos) */
    for (i = 0; i < names.length; i++) {
      n = normColPl(names[i]);
      for (j = 0; j < keys.length; j++) {
        k = normColPl(keys[j]);
        if (k === n) return keys[j];
      }
    }
    /* Paso 4: subcadena */
    for (i = 0; i < names.length; i++) {
      n = normPl(names[i]);
      for (j = 0; j < keys.length; j++) {
        k = normPl(keys[j]);
        if (k.indexOf(n) !== -1 || n.indexOf(k) !== -1) return keys[j];
      }
    }
    return null;
  }

  /* Etapas en orden de embudo comercial */
  var PIPELINE_STAGES = [
    { key: 'contacto', label: 'Contacto Inicial', color: '#4472C4', pats: ['contacto'] },
    { key: 'evaluacion', label: 'Evaluación', color: '#70AD47', pats: ['evaluacion', 'calificacion', 'qualification'] },
    { key: 'desarrollo', label: 'Desarrollo de la Propuesta', color: '#FFC000', pats: ['desarrollo', 'propuesta'] },
    { key: 'negociacion', label: 'Negociación', color: '#ED7D31', pats: ['negociacion'] },
    { key: 'contractual', label: 'Contractual', color: '#C00000', pats: ['contractual'] }
  ];

  /* ============================ COBERTURA DE PIPELINE ============================ */
  /* Esta tarjeta responde EXCLUSIVAMENTE al filtro de Responsable y Trimestre del sidebar.
     No se ve afectada por los botones de vendedor de la tarjeta Meta vendedor. */
  function renderCoberturaCard() {
    var trimestre = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    var mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    var sidebarResp = (window.CMI_FILTROS && window.CMI_FILTROS.responsable) || 'todos';

    // ponytail: CMI_MAPPER.parseMonthIndex cubre ISO, OData y nombres de mes; DD/MM/YYYY como fallback
    function parseFechaMonth(raw) {
      if (window.CMI_MAPPER) { var r = window.CMI_MAPPER.parseMonthIndex(raw); if (r != null) return r; }
      var dd = String(raw || '').match(/^(\d{1,2})\/(\d{2})\//);
      if (dd) { var m = parseInt(dd[2], 10); return m >= 1 && m <= 12 ? m - 1 : null; }
      return null;
    }

    var activeMonths = (Q_IX[trimestre] || Q_IX.ytd).slice();
    if (trimestre !== 'ytd' && mesCorte !== 'all') {
      var mi = parseInt(mesCorte, 10);
      if (!isNaN(mi)) activeMonths = activeMonths.filter(function (m) { return m <= mi; });
    }
    var activeMonthSet = {};
    activeMonths.forEach(function (m) { activeMonthSet[m] = true; });

    /* Determinar clave de presupuesto y función de filtro de filas SOLO por sidebar */
    var effectiveKey = 'todos';
    var rowRespFilter = null; // función(normName) → bool · null = sin filtro (mostrar todos)

    if (sidebarResp !== 'todos') {
      var normSR = normPl(sidebarResp);
      /* Buscar qué vendedor conocido corresponde al nombre seleccionado */
      var matchedKey = null;
      Object.keys(VENDOR_MATCHERS).forEach(function (k) {
        if (!matchedKey && VENDOR_MATCHERS[k](normSR)) matchedKey = k;
      });
      if (matchedKey) {
        effectiveKey = matchedKey;
        /* Usar el matcher (subcadena) para filtrar filas del pipeline,
           así funciona aunque el nombre en Recurso_Accion sea diferente al del dropdown */
        rowRespFilter = VENDOR_MATCHERS[matchedKey];
      } else {
        /* Vendedor desconocido (ej. Jorge): filtrar por nombre exacto, presupuesto sin datos */
        effectiveKey = null; // señal de "sin presupuesto conocido"
        rowRespFilter = function (n) { return n === normSR; };
      }
    }

    var isJorge = (effectiveKey === 'jorge');

    var raw = window.CMI_RAW_DATA || {};
    var cfg = window.CMI_STORE && window.CMI_STORE.getConfig();
    var hasData = false, multiplier = 0, variationPct = 0, status = 'mute';
    var pipelineTotal = 0, metaCOP = 0;

    if (cfg && (effectiveKey !== null || isJorge)) {
      var pipelineTpl = getPipelineTpl(cfg);

      if (pipelineTpl && raw[pipelineTpl] && (raw[pipelineTpl].rows || []).length) {
        var allRows = raw[pipelineTpl].rows;

        var COL_ESTADO = pickColPl(allRows, ['Estado']);
        var COL_COMERCIAL = pickColPl(allRows, ['Estado_Comercial', 'Estado Comercial', 'EstadoComercial']);
        var COL_VALOR = pickColPl(allRows, ['Vr_Subtotal_', 'Vr_Subtotal', 'Vr. Subtotal', 'Vr.Subtotal', 'Valor Subtotal', 'Valor']);
        var COL_RESP = pickColPl(allRows, ['Recurso_Accion', 'Recurso_Acción', 'Recurso Accion', 'Recurso Acción']);
        /* Columna de fecha de inicio de actividad — usada para filtrar por trimestre */
        var COL_FECHA = pickColPl(allRows, ['Fecha', 'Fecha_Inicio', 'Fecha_Actividad', 'FechaActividad', 'Fecha_Inicio_Actividad']);

        if (COL_COMERCIAL) {
          var filteredRows = allRows.filter(function (r) {
            if (!_isActivo(r, COL_ESTADO)) return false;
            /* Filtro por responsable: usa el matcher del vendedor (subcadena en Recurso_Accion) */
            if (rowRespFilter && COL_RESP) {
              if (!rowRespFilter(normPl(String(r[COL_RESP] || '')))) return false;
            }
            /* Filtro por trimestre: Fecha de inicio de actividad debe caer en los meses activos */
            if (trimestre !== 'ytd' && COL_FECHA) {
              var mIdx = parseFechaMonth(r[COL_FECHA]);
              if (mIdx == null || !activeMonthSet[mIdx]) return false;
            }
            /* Solo filas en etapas activas del embudo */
            var etapa = normPl(String(r[COL_COMERCIAL] || '')).replace(/\.$/, '');
            return PIPELINE_STAGES.some(function (s) {
              return s.pats.some(function (p) { return etapa.indexOf(p) !== -1; });
            });
          });

          pipelineTotal = filteredRows.reduce(function (sum, r) {
            return sum + (Number(r[COL_VALOR] || 0) || 0);
          }, 0);

          if (!isJorge) {
            var vb = VENDOR_BUDGET[effectiveKey] || VENDOR_BUDGET.todos;
            metaCOP = (trimestre === 'ytd')
              ? vb.annual * 1e6
              : activeMonths.reduce(function (sum, m) { return sum + (vb.months[m] || 0); }, 0) * 1e6;

            if (metaCOP > 0) {
              hasData = true;
              multiplier = (pipelineTotal * 4) / metaCOP;
              variationPct = ((multiplier / 4) - 1) * 100;
              status = semaphore(multiplier, 4);
            }
          }
        }
      }
    }

    var chipClass = chipFor(status);
    var chipLabel = labelFor(status);
    var multStr = multiplier.toFixed(2) + 'x';
    var arrow = variationPct >= 0 ? '▲' : '▼';
    var varStyle = variationPct >= 0 ? 'color:#10B981' : 'color:#EF4444';

    if (isJorge) {
      return '<div class="card p-4">' +
        '<div class="text-[12px] font-semibold text-slate-700 leading-tight">Cobertura de pipeline</div>' +
        '<div style="font-size:11px;margin-top:12px;color:#64748b;">' +
        'Pipeline real: <span style="font-weight:600;color:#1e293b;">' + fmtCOP(pipelineTotal) + '</span>' +
        '</div>' +
        '<button type="button" class="analisis-btn" data-analisis-card="cobertura">Análisis</button>' +
        '</div>';
    }

    return '<div class="card p-4">' +
      '<div class="flex items-start justify-between">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight pr-2">Cobertura de pipeline</div>' +
      '<span class="chip ' + chipClass + '">' + chipLabel + '</span>' +
      '</div>' +
      '<div class="mt-3">' +
      '<div class="text-2xl font-extrabold text-slate-900 kpi-num">' + multStr + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">cobertura actual</div>' +
      '</div>' +
      '<div class="text-[11px] text-slate-500 mt-1">Meta: <span class="font-semibold text-slate-700">≥ 4x meta de ventas</span></div>' +
      (hasData
        ? '<div style="font-size:11px;font-weight:700;margin-top:4px;' + varStyle + '">' + arrow + ' ' + Math.abs(variationPct).toFixed(1) + '% vs meta 4x</div>' +
        '<div style="font-size:11px;margin-top:6px;color:#64748b;">' +
        'Pipeline real: <span style="font-weight:600;color:#1e293b;">' + fmtCOP(pipelineTotal) + '</span>' +
        '</div>' +
        '<div style="font-size:11px;margin-top:2px;color:#64748b;">' +
        'Total meta: <span style="font-weight:600;color:#1e293b;">' + fmtCOP(metaCOP) + '</span>' +
        '</div>' +
        '<div style="font-size:11px;margin-top:2px;color:#64748b;">' +
        'Pipeline esperado: <span style="font-weight:600;color:#1e293b;">' + fmtCOP(metaCOP * 4) + '</span>' +
        '</div>'
        : '') +
      '<button type="button" class="analisis-btn" data-analisis-card="cobertura">Análisis</button>' +
      '</div>';
  }

  function renderPipelineFunnel(stateDiff) {
    if (stateDiff && typeof stateDiff === 'object') {
      Object.keys(stateDiff).forEach(function (k) { _plState[k] = stateDiff[k]; });
    }

    var card = document.getElementById('com-pipeline-card');
    var cont = document.getElementById('com-pipeline');
    if (!card || !cont) return;

    try {
      var raw = window.CMI_RAW_DATA || {};
      var cfg = window.CMI_STORE && window.CMI_STORE.getConfig();
      if (!cfg) { card.style.display = 'none'; return; }

      var pipelineTpl = getPipelineTpl(cfg);
      if (!pipelineTpl || !raw[pipelineTpl] || !(raw[pipelineTpl].rows || []).length) {
        card.style.display = 'none'; return;
      }

      var allRows = raw[pipelineTpl].rows;
      card.style.display = '';

      /* Detección de columnas — tolerante a puntos, espacios y guiones bajos */
      var COL_ESTADO = pickColPl(allRows, ['Estado']);
      var COL_COMERCIAL = pickColPl(allRows, ['Estado_Comercial', 'Estado Comercial', 'EstadoComercial']);
      var COL_VALOR = pickColPl(allRows, ['Vr_Subtotal_', 'Vr_Subtotal', 'Vr. Subtotal', 'Vr.Subtotal', 'Valor Subtotal', 'Valor']);
      var COL_JURIDICA = pickColPl(allRows, ['Valor_Juridica_', 'Valor_Juridica', 'Valor Juridica', 'ValorJuridica']);
      var COL_TIPO = pickColPl(allRows, ['Tipo_de_Oportunidad', 'Tipo de Oportunidad', 'TipodeOportunidad']);
      var COL_RESP = pickColPl(allRows, ['Recurso_Accion', 'Recurso_Acción', 'Recurso Accion', 'Recurso Acción']);
      var COL_SUBESTADO = pickColPl(allRows, ['Subestado_Comercial', 'Subestado Comercial', 'SubestadoComercial']);
      var COL_CIERRE = pickColPl(allRows, ['Posible_Cierre', 'Posible Cierre', 'PosibleCierre']);
      var COL_ID = pickColPl(allRows, ['ID', 'Id', 'id']);
      var COL_CLIENTE = pickColPl(allRows, ['Cliente', 'cliente', 'Razon_Social', 'Razon Social']);

      if (!COL_COMERCIAL) { card.style.display = 'none'; return; }

      /* ── 1. Filas activas ── */
      var activeRows = allRows.filter(function (r) { return _isActivo(r, COL_ESTADO); });

      /* ── 2. Opciones de Recurso Acción ── */
      var respSeen = {};
      if (COL_RESP) {
        activeRows.forEach(function (r) {
          var v = r[COL_RESP];
          if (v != null && v !== '') respSeen[v] = true;
        });
      }
      var respOptions = Object.keys(respSeen).sort();

      /* ── 3. Filtrar por Recurso Acción (controlado desde filtro lateral) ── */
      var _sidebarResp = (window.CMI_FILTROS && window.CMI_FILTROS.responsable) || 'todos';
      if (_sidebarResp !== _plLastResp) {
        _plState.tipo = 'todos'; _plState.etapa = 'todos'; _plState.cierre = 'todos';
        _plLastResp = _sidebarResp;
      }
      var normSelResp = normPl(_sidebarResp);
      var byResp = activeRows.filter(function (r) {
        if (_sidebarResp === 'todos') return true;
        if (!COL_RESP) return false;
        return normPl(r[COL_RESP]) === normSelResp;
      });

      /* ── 4. Opciones de Tipo de Oportunidad ── */
      var tipoSeen = {};
      if (COL_TIPO) {
        byResp.forEach(function (r) {
          var v = r[COL_TIPO];
          if (v != null && v !== '') tipoSeen[v] = true;
        });
      }
      var tipoOptions = Object.keys(tipoSeen).sort();
      if (_plState.tipo !== 'todos') {
        var _normT = normPl(_plState.tipo);
        var _cT = null;
        tipoOptions.forEach(function (o) { if (normPl(o) === _normT) _cT = o; });
        _plState.tipo = _cT || 'todos';
      }

      /* ── 5. Filtrar por Tipo ── */
      var normSelTipo = normPl(_plState.tipo);
      var afterTipo = byResp.filter(function (r) {
        if (_plState.tipo === 'todos') return true;
        if (!COL_TIPO) return false;
        return normPl(r[COL_TIPO]) === normSelTipo;
      });

      /* ── 6. Opciones de Etapa (fijas desde PIPELINE_STAGES) ── */
      if (_plState.etapa !== 'todos') {
        var _etapaValid = PIPELINE_STAGES.some(function (s) { return s.key === _plState.etapa; });
        if (!_etapaValid) _plState.etapa = 'todos';
      }

      /* ── 7. Filtrar por Etapa ── */
      var afterSub = afterTipo.filter(function (r) {
        if (_plState.etapa === 'todos') return true;
        if (!COL_COMERCIAL) return false;
        var etapa = normPl(String(r[COL_COMERCIAL] || '')).replace(/\.$/, '');
        var stage = PIPELINE_STAGES.find(function (s) { return s.key === _plState.etapa; });
        if (!stage) return false;
        return stage.pats.some(function (p) { return etapa.indexOf(p) !== -1; });
      });

      /* ── 8. Opciones de Posible Cierre ── */
      var cierreSeen = {};
      if (COL_CIERRE) {
        afterSub.forEach(function (r) {
          var v = r[COL_CIERRE];
          if (v != null && v !== '') cierreSeen[v] = true;
        });
      }
      var cierreOptions = Object.keys(cierreSeen).sort();
      if (_plState.cierre !== 'todos') {
        var _normC = normPl(_plState.cierre);
        var _cC = null;
        cierreOptions.forEach(function (o) { if (normPl(o) === _normC) _cC = o; });
        _plState.cierre = _cC || 'todos';
      }

      /* ── 9. Filtrar por Posible Cierre ── */
      var normSelCierre = normPl(_plState.cierre);
      var finalRows = afterSub.filter(function (r) {
        if (_plState.cierre === 'todos') return true;
        if (!COL_CIERRE) return false;
        return normPl(r[COL_CIERRE]) === normSelCierre;
      });

      /* ── 10. Agregar por etapa ── */
      var stageVals = {}, stageCounts = {}, stageJur = {};
      PIPELINE_STAGES.forEach(function (s) { stageVals[s.key] = 0; stageCounts[s.key] = 0; stageJur[s.key] = 0; });
      var grandTotal = 0, totalCount = 0, grandJur = 0;

      finalRows.forEach(function (r) {
        var etapa = normPl(String(COL_COMERCIAL ? (r[COL_COMERCIAL] || '') : ''));
        var valor = Number(COL_VALOR ? (r[COL_VALOR] || 0) : 0);
        var jur = Number(COL_JURIDICA ? (r[COL_JURIDICA] || 0) : 0);
        if (isNaN(valor)) valor = 0;
        if (isNaN(jur)) jur = 0;
        var matched = false;
        for (var si = 0; si < PIPELINE_STAGES.length; si++) {
          var s = PIPELINE_STAGES[si];
          if (s.pats.some(function (p) { return etapa.indexOf(p) !== -1; })) {
            stageVals[s.key] += valor;
            stageJur[s.key] += jur;
            stageCounts[s.key]++;
            grandTotal += valor;
            grandJur += jur;
            totalCount++;
            matched = true;
            break;
          }
        }
        /* filas sin etapa de pipeline (Contractual, Descartado, Posventa, etc.) se ignoran */
      });

      /* Filas que pertenecen a una etapa del pipeline (excluye Aplazado, Descartado, etc.) */
      var pipelineDetailRows = finalRows.filter(function (r) {
        var etapa = normPl(String(COL_COMERCIAL ? (r[COL_COMERCIAL] || '') : '')).replace(/\.$/, '');
        return PIPELINE_STAGES.some(function (s) {
          return s.pats.some(function (p) { return etapa.indexOf(p) !== -1; });
        });
      });

      /* Usar Valor Juridica para porcentajes si está disponible (coincide con Power BI) */
      var pctBase = grandJur > 0 ? grandJur : grandTotal;

      /* ── 11. Render: embudo (forma trapezoidal) ── */
      var n = PIPELINE_STAGES.length;
      var maxW = 100, minW = 30;
      var step = n > 1 ? (maxW - minW) / (n - 1) : 0;

      var funnelRows = PIPELINE_STAGES.map(function (s, idx) {
        var val = stageVals[s.key];
        var jurV = stageJur[s.key];
        var cnt = stageCounts[s.key];
        var pct = pctBase > 0 ? Math.round((grandJur > 0 ? jurV : val) / pctBase * 100) : 0;
        var hasData = cnt > 0;

        /* Ancho del trapecio: decrece de 100% a 30% */
        var topW = Math.round(maxW - idx * step);
        var botW = Math.round(maxW - (idx + 1) * step);
        if (botW < minW) botW = minW;
        var clipTL = (100 - topW) / 2, clipTR = (100 + topW) / 2;
        var clipBL = (100 - botW) / 2, clipBR = (100 + botW) / 2;
        var clipPath = 'polygon(' + clipTL + '% 0%,' + clipTR + '% 0%,' + clipBR + '% 100%,' + clipBL + '% 100%)';
        var barColor = hasData ? s.color : '#CBD5E1';
        var amtHtml = hasData ? fmtCOP(val) : '(En blanco)';
        var amtStyle = hasData ? 'font-size:13px;font-weight:700;color:#0F172A;' : 'font-size:12px;color:#94A3B8;font-style:italic;';

        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">' +
          '<div style="width:40px;text-align:right;font-size:13px;font-weight:800;color:' + (hasData ? s.color : '#CBD5E1') + ';">' + (hasData ? pct : '') + '%</div>' +
          '<div style="flex:1;height:46px;position:relative;">' +
          '<div style="position:absolute;inset:0;background:' + barColor + ';clip-path:' + clipPath + ';"></div>' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:0 ' + (100 - topW) / 2 + '%;">' +
          '<span style="font-size:11px;font-weight:700;color:' + (hasData ? '#fff' : '#94A3B8') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + s.label + '</span>' +
          '</div>' +
          '</div>' +
          '<div style="width:185px;flex-shrink:0;">' +
          '<div style="font-size:10px;color:#94A3B8;line-height:1.2;">' + s.label + '</div>' +
          '<div style="' + amtStyle + '">' + amtHtml + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

      /* Responsable controlado desde el filtro lateral — sin selector interno */
      var respHtml = '';

      /* ── 13. Render: cajas Tipo de Oportunidad ── */
      var tipoHtml = '';
      if (tipoOptions.length) {
        var tipoBoxes = tipoOptions.map(function (t) {
          var a = _plState.tipo === t;
          return '<button class="pl-tipo-btn" data-tipo="' + t.replace(/"/g, '&quot;') + '" ' +
            'style="display:block;width:100%;padding:8px 10px;margin-bottom:5px;text-align:center;cursor:pointer;' +
            'border:1.5px solid ' + (a ? '#3B82F6' : '#CBD5E1') + ';border-radius:4px;' +
            'background:' + (a ? '#EFF6FF' : '#F8FAFC') + ';color:#0F172A;font-size:12px;font-weight:600;">' + t + '</button>';
        }).join('');
        tipoHtml = '<div style="margin-bottom:12px;">' +
          '<div style="font-size:10px;color:#475569;margin-bottom:6px;">Tipo de Oportunidad</div>' +
          tipoBoxes +
          '</div>';
      }

      /* ── 14. Render: filtro de Etapa (Estado Comercial) ── */
      var subHtml = (function () {
        var btnStyle = function (active, color) {
          return 'display:block;width:100%;padding:6px 10px;margin-bottom:4px;text-align:left;cursor:pointer;' +
            'border:1.5px solid ' + (active ? color : '#CBD5E1') + ';border-radius:4px;' +
            'background:' + (active ? color : '#F8FAFC') + ';color:' + (active ? '#fff' : '#475569') + ';' +
            'font-size:11px;font-weight:600;';
        };
        var allActive = _plState.etapa === 'todos';
        var btns = '<button class="pl-etapa-btn" data-etapa="todos" style="' + btnStyle(allActive, '#1E3A5F') + '">Todas las etapas</button>';
        PIPELINE_STAGES.forEach(function (s) {
          var active = _plState.etapa === s.key;
          btns += '<button class="pl-etapa-btn" data-etapa="' + s.key + '" style="' + btnStyle(active, s.color) + '">' + s.label + '</button>';
        });
        return '<div style="margin-bottom:10px;">' +
          '<div style="font-size:10px;color:#475569;margin-bottom:6px;font-weight:600;">Estado Comercial</div>' +
          btns +
          '</div>';
      })();

      /* ── 15. Render: dropdown Posible Cierre ── */
      var cierreHtml = '';
      if (COL_CIERRE && cierreOptions.length) {
        cierreHtml = '<div style="margin-bottom:10px;">' +
          '<div style="font-size:10px;color:#475569;margin-bottom:4px;">Posible Cierre</div>' +
          '<select id="pl-cierre-sel" style="width:100%;padding:5px 8px;border:1px solid #E2E8F0;border-radius:4px;font-size:12px;background:#F8FAFC;">' +
          '<option value="todos">Todas</option>' +
          cierreOptions.map(function (v) {
            return '<option value="' + v.replace(/"/g, '&quot;') + '"' + (_plState.cierre === v ? ' selected' : '') + '>' + v + '</option>';
          }).join('') +
          '</select>' +
          '</div>';
      }

      /* ── 16. Tabla de detalle de actividades ── */
      var stageColorMap = {};
      PIPELINE_STAGES.forEach(function (s) { stageColorMap[s.key] = s.color; });
      function stageColor(ec) {
        var n = normPl(String(ec || '')).replace(/\.$/, '');
        for (var si = 0; si < PIPELINE_STAGES.length; si++) {
          var s = PIPELINE_STAGES[si];
          if (s.pats.some(function (p) { return n.indexOf(p) !== -1; })) return s.color;
        }
        return '#94A3B8';
      }

      var detTotalValor = pipelineDetailRows.reduce(function (s, r) { return s + (Number(r[COL_VALOR]) || 0); }, 0);

      var detThead = '<thead><tr style="background:#F8FAFC;">' +
        (COL_ID ? '<th style="padding:8px 10px;font-size:11px;font-weight:700;color:#475569;text-align:left;white-space:nowrap;border-bottom:1px solid #E2E8F0;">ID</th>' : '') +
        (COL_CLIENTE ? '<th style="padding:8px 10px;font-size:11px;font-weight:700;color:#475569;text-align:left;border-bottom:1px solid #E2E8F0;">Cliente</th>' : '') +
        '<th style="padding:8px 10px;font-size:11px;font-weight:700;color:#475569;text-align:left;border-bottom:1px solid #E2E8F0;">Responsable</th>' +
        '<th style="padding:8px 10px;font-size:11px;font-weight:700;color:#475569;text-align:left;border-bottom:1px solid #E2E8F0;">Etapa</th>' +
        '<th style="padding:8px 10px;font-size:11px;font-weight:700;color:#475569;text-align:right;border-bottom:1px solid #E2E8F0;">Vr. Subtotal</th>' +
        '</tr></thead>';

      var detTbody = '<tbody>' + pipelineDetailRows.map(function (r, i) {
        var bg = i % 2 === 0 ? '#fff' : '#F8FAFC';
        var ec = COL_COMERCIAL ? (r[COL_COMERCIAL] || '') : '';
        var col = stageColor(ec);
        var val = Number(COL_VALOR ? (r[COL_VALOR] || 0) : 0);
        return '<tr style="background:' + bg + ';">' +
          (COL_ID ? '<td style="padding:7px 10px;font-size:12px;color:#334155;font-weight:600;white-space:nowrap;">' + (r[COL_ID] || '—') + '</td>' : '') +
          (COL_CLIENTE ? '<td style="padding:7px 10px;font-size:12px;color:#334155;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (r[COL_CLIENTE] || '').replace(/"/g, '&quot;') + '">' + (r[COL_CLIENTE] || '—') + '</td>' : '') +
          '<td style="padding:7px 10px;font-size:12px;color:#475569;white-space:nowrap;">' + (COL_RESP ? (r[COL_RESP] || '—') : '—') + '</td>' +
          '<td style="padding:7px 10px;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;color:#fff;background:' + col + ';">' + ec + '</span></td>' +
          '<td style="padding:7px 10px;font-size:12px;font-weight:700;color:#0F172A;text-align:right;white-space:nowrap;">' + fmtCOP(val) + '</td>' +
          '</tr>';
      }).join('') + '</tbody>';

      var detHeader = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
        '<div>' +
        '<span style="font-size:13px;font-weight:700;color:#1E293B;">Detalle de oportunidades</span>' +
        '<span style="margin-left:8px;font-size:11px;color:#94A3B8;">' + pipelineDetailRows.length + ' registros</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#64748B;">Total: <strong style="color:#0F172A;">' + fmtCOP(detTotalValor) + '</strong></div>' +
        '</div>';

      var detTable = pipelineDetailRows.length
        ? detHeader + '<div style="overflow-x:auto;max-height:320px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:6px;"><table style="width:100%;border-collapse:collapse;">' + detThead + detTbody + '</table></div>'
        : detHeader + '<p style="text-align:center;color:#94A3B8;font-size:13px;padding:20px 0;">Sin oportunidades para el filtro actual.</p>';

      /* ── 17. Layout final ── */
      cont.innerHTML =
        '<div style="display:flex;gap:16px;align-items:flex-start;">' +

        /* Embudo (izquierda) */
        '<div style="flex:1;min-width:0;">' +
        '<h3 class="font-semibold text-slate-800" style="margin-bottom:10px;">Pipeline Comercial</h3>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
        '<div style="width:40px;text-align:right;font-size:12px;font-weight:800;color:#475569;">100 %</div>' +
        '<div style="flex:1;"></div>' +
        '<div style="width:185px;">' +
        '<div style="font-size:10px;color:#94A3B8;">Pipeline</div>' +
        '<div style="font-size:18px;font-weight:800;color:#0F172A;">' + fmtCOP(grandTotal) + '</div>' +
        '</div>' +
        '</div>' +
        funnelRows +
        '<div style="margin-top:8px;font-size:11px;color:#94A3B8;">' + totalCount + ' oportunidades activas</div>' +
        '</div>' +

        /* Filtros (derecha) */
        '<div style="width:240px;flex-shrink:0;">' +
        respHtml +
        tipoHtml +
        subHtml +
        cierreHtml +
        '</div>' +

        '</div>' +

        /* Tabla de detalle debajo del embudo */
        '<div style="margin-top:16px;border-top:1px solid #E2E8F0;padding-top:14px;">' +
        detTable +
        '</div>';

      /* ── Listeners ── */
      cont.querySelectorAll('.pl-tipo-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = this.getAttribute('data-tipo');
          renderPipelineFunnel({ tipo: _plState.tipo === t ? 'todos' : t });
        });
      });
      cont.querySelectorAll('.pl-etapa-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var e = this.getAttribute('data-etapa');
          renderPipelineFunnel({ etapa: _plState.etapa === e ? 'todos' : e });
        });
      });
      var cierreSel = document.getElementById('pl-cierre-sel');
      if (cierreSel) cierreSel.addEventListener('change', function () { renderPipelineFunnel({ cierre: this.value }); });

    } catch (err) {
      console.error('[Pipeline] Error al renderizar:', err);
      if (card) card.style.display = 'none';
    }
  }

  /* ============================ FINANCIERA ============================ */
  function _updateFinBar(id, value, meta, hasData) {
    var el = document.getElementById(id);
    if (!el) return;
    var pctEl = el.querySelector('.fin-bar-pct');
    var fillEl = el.querySelector('.fin-bar-fill');
    var statusEl = el.querySelector('.fin-bar-status');
    if (!hasData || value == null || value === 0) {
      if (pctEl) pctEl.textContent = '—';
      if (fillEl) fillEl.style.width = '0%';
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'fin-bar-status font-semibold'; }
      return;
    }
    var pctStr = (Number(value) || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%';
    if (pctEl) pctEl.textContent = pctStr;
    if (fillEl) fillEl.style.width = Math.min(Number(value) || 0, 100) + '%';
    if (statusEl) {
      var state = semaphore(value, meta);
      if (state === 'ok') { statusEl.textContent = 'Cumple'; statusEl.className = 'fin-bar-status font-semibold text-emerald-600'; }
      else if (state === 'warn') { statusEl.textContent = 'En riesgo'; statusEl.className = 'fin-bar-status font-semibold text-amber-600'; }
      else { statusEl.textContent = 'No cumple'; statusEl.className = 'fin-bar-status font-semibold text-rose-600'; }
    }
  }

  function renderFinanciera() {
    buildCardsFinanciera();
    const F = window.CMI_DATA.FIN;
    const cur = getCur();
    const hasFinData = _hasAnyData(F.facturacion) || _hasAnyData(F.recaudo) || _hasAnyData(F.personal);
    _updateFinBar('fin-bar-facturacion', F.facturacion[cur], 95, hasFinData);
    _updateFinBar('fin-bar-recaudo', F.recaudo[cur], 90, hasFinData);
    _updateFinBar('fin-bar-personal', F.personal[cur], 80, hasFinData);
    lineChart('fin-margenes', [
      { label: 'EBITDA', data: F.ebitda, borderColor: COLORS.brand, backgroundColor: 'rgba(14,165,233,.10)', fill: true, tension: .3, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Utilidad operacional', data: F.utilOp, borderColor: COLORS.ok, fill: false, tension: .3, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Utilidad bruta', data: F.utilBruta, borderColor: COLORS.violet, fill: false, tension: .3, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Meta EBITDA (12%)', data: Array(12).fill(12), borderColor: COLORS.brand, borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 }
    ], { yOpts: { ticks: { callback: function (v) { return v + '%'; } } } });

    lineChart('fin-ebitda', [
      { label: 'EBITDA mensual', data: F.ebitda, borderColor: COLORS.brand, backgroundColor: 'rgba(14,165,233,.18)', fill: true, tension: .3, pointBackgroundColor: COLORS.brand, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Meta 12%', data: Array(12).fill(12), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
    ], { yOpts: { min: 0, max: 20, ticks: { callback: function (v) { return v + '%'; } } } });

    makeChart('fin-factrec', {
      type: 'bar',
      data: {
        labels: MONTHS, datasets: [
          { label: 'Facturación', data: F.facturacion, backgroundColor: COLORS.brand, borderRadius: 4 },
          { label: 'Recaudo', data: F.recaudo, backgroundColor: COLORS.ok, borderRadius: 4 },
          { type: 'line', label: 'Meta 95%', data: Array(12).fill(95), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } } },
        scales: { x: gridLight, y: Object.assign({}, gridLight, { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } }) }
      }
    });
  }

  /* ==================== PROYECTOS · Control de cuotas (PMO) ====================
     Réplica del tablero Power BI "Oficina de Gestión de Proyectos" sobre la plantilla
     ID11887_Contro_de_cuotas. Las medidas y su verificación contra los totales
     publicados están documentadas en mapper.js#buildCuotasCells.
  
     Los slicers "Fechas por Q" y "Fechas por Mes" del tablero original no se duplican
     acá: el panel de filtros lateral ya expone trimestre + mes de corte para toda la
     app y esta vista los consume vía getActiveIx(). Solo CUMPLE, RESPONSABLE y la
     búsqueda por Cliente son locales, porque no tienen equivalente global. */

  const MONTHS_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  var _pmoFilter = { cumple: 'todos', responsable: 'todos', cliente: '' };
  var _pmoBound = false;

  // Tarjeta de importe: sin semáforo ni sparkline (no hay meta contra la cual comparar
  // una cuota), titular en millones para que entre en la grilla y cifra exacta debajo.
  function pmoCard(opts) {
    const stripe = opts.tone ? ' kpi-' + opts.tone : '';
    return '<div class="card p-4' + stripe + '">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight">' + escapeHtml(opts.title) + '</div>' +
      '<div class="mt-3 text-2xl font-extrabold kpi-num ' + (opts.valueClass || 'text-slate-900') + '">' + opts.value + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-1">' + opts.detail + '</div>' +
      '</div>';
  }

  function pmoActiveMonths() {
    const trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    const mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    return { ix: getActiveIx(trimKey, mesCorte), trimKey: trimKey };
  }

  function pmoPeriodoLabel(ix) {
    if (ix.length === 12) return 'Ene – Dic';
    if (ix.length === 1) return MONTHS_FULL[ix[0]];
    return MONTHS[ix[0]] + ' – ' + MONTHS[ix[ix.length - 1]];
  }

  function bindPmoControls() {
    if (_pmoBound) return;
    const cumple = document.getElementById('pmo-cumple');
    if (!cumple) return;
    _pmoBound = true;

    cumple.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-cumple]');
      if (!btn) return;
      _pmoFilter.cumple = btn.dataset.cumple;
      renderPmo();   // repinta las píldoras desde _pmoFilter (ver paintPmoCumple)
    });

    const sel = document.getElementById('pmo-responsable');
    if (sel) sel.addEventListener('change', function () { _pmoFilter.responsable = sel.value; renderPmo(); });

    const inp = document.getElementById('pmo-cliente');
    if (inp) inp.addEventListener('input', function () { _pmoFilter.cliente = inp.value; renderPmo(); });

    const clear = document.getElementById('pmo-clear');
    if (clear) clear.addEventListener('click', function () {
      _pmoFilter = { cumple: 'todos', responsable: 'todos', cliente: '' };
      if (sel) sel.value = 'todos';
      if (inp) inp.value = '';
      renderPmo();
    });

  }

  // Sub-pestañas del área (PMO / Hitos / OKR). Genérico sobre [data-pry-tab] → panel
  // #pry-tab-<id>: agregar una pestaña nueva es solo marcado, no hay que tocar esto.
  // Repinta el área al cambiar porque un canvas oculto mide 0px y Chart.js lo dibuja
  // vacío — recién al mostrarse toma su tamaño real.
  var _pryTabsBound = false;
  function bindPryTabs() {
    if (_pryTabsBound) return;
    const tabs = document.querySelectorAll('[data-pry-tab]');
    if (!tabs.length) return;
    _pryTabsBound = true;
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (o) {
          const activa = o === t;
          o.classList.toggle('det-pill-active', activa);
          const panel = document.getElementById('pry-tab-' + o.dataset.pryTab);
          if (panel) panel.style.display = activa ? '' : 'none';
        });
        renderProyectos();
      });
    });
  }

  // El estado activo de las píldoras CUMPLE se deriva de _pmoFilter en cada render, no
  // se togglea en el click: así el marcado nunca queda desincronizado del filtro real
  // (ej. tras "Limpiar", o si el estado se cambia desde otro punto del código).
  function paintPmoCumple() {
    document.querySelectorAll('#pmo-cumple [data-cumple]').forEach(function (btn) {
      btn.classList.toggle('det-pill-active', btn.dataset.cumple === _pmoFilter.cumple);
    });
  }

  function fillPmoResponsables(responsables) {
    const sel = document.getElementById('pmo-responsable');
    if (!sel) return;
    const prev = _pmoFilter.responsable;
    sel.innerHTML = '<option value="todos">Todos</option>' +
      responsables.map(function (r) {
        return '<option value="' + escapeHtml(r.key) + '">' + escapeHtml(r.label) + '</option>';
      }).join('');
    // Si el responsable elegido ya no existe tras un refresh de datos, vuelve a "Todos"
    // en vez de dejar el combo apuntando a una opción inexistente (filtraría a cero).
    const stillThere = responsables.some(function (r) { return r.key === prev; });
    _pmoFilter.responsable = stillThere ? prev : 'todos';
    sel.value = _pmoFilter.responsable;
  }

  function renderPmoTabla(filas) {
    const tabla = document.getElementById('pmo-tabla');
    const count = document.getElementById('pmo-tabla-count');
    if (!tabla) return;

    if (!filas.length) {
      tabla.innerHTML = '<tbody><tr><td style="padding:24px;text-align:center;color:#94A3B8;">Sin cuotas para los filtros seleccionados.</td></tr></tbody>';
      if (count) count.textContent = '0 cuotas';
      return;
    }
    if (count) count.textContent = filas.length + (filas.length === 1 ? ' cuota' : ' cuotas');

    // Tope de render: la tabla es exploratoria, no un export — con miles de filas el
    // navegador se traba y el usuario igual filtra para encontrar lo suyo.
    const MAX = 300;
    const vista = filas.slice(0, MAX);

    // Mismas definiciones que las tarjetas: Facturado = toda cuota con factura;
    // Ejecutado PMO = solo las que además cumplen (SN = "Si"). Por eso una fila puede
    // mostrar factura y aun así $0 ejecutado — la columna "Cumple" lo explica.
    const totProy = filas.reduce(function (a, r) { return a + r.proyectado; }, 0);
    const totFact = filas.reduce(function (a, r) { return a + r.ejecutado; }, 0);
    const totEjec = filas.reduce(function (a, r) { return a + (r.cumple ? r.ejecutado : 0); }, 0);

    const body = vista.map(function (r) {
      const ejecPmo = r.cumple ? r.ejecutado : 0;
      const saldo = r.proyectado - ejecPmo;
      return '<tr>' +
        '<td class="det-id">' + escapeHtml(r.id) + '</td>' +
        '<td>' + escapeHtml(r.cliente) + '</td>' +
        '<td>' + escapeHtml(r.responsable) + '</td>' +
        '<td>' + MONTHS_FULL[r.mes] + '</td>' +
        '<td>' + (r.doc ? escapeHtml(r.doc) : '<span style="color:#CBD5E1;">—</span>') + '</td>' +
        '<td><span class="det-tag ' + (r.cumple ? 'det-tag-greenywave' : 'det-tag-renovaciones') + '">' + (r.cumple ? 'Sí' : 'No') + '</span></td>' +
        '<td class="det-val">' + fmtCOP(r.proyectado) + '</td>' +
        '<td class="det-val">' + fmtCOP(r.ejecutado) + '</td>' +
        '<td class="det-val">' + fmtCOP(ejecPmo) + '</td>' +
        '<td class="det-val" style="color:' + (saldo > 0 ? COLORS.bad : COLORS.ok) + ';">' + fmtCOP(saldo) + '</td>' +
        '</tr>';
    }).join('');

    const truncado = filas.length > MAX
      ? '<tr><td colspan="10" style="text-align:center;color:#94A3B8;font-size:11px;">Se muestran las ' + MAX + ' cuotas con mayor saldo — usá los filtros para acotar. Los totales incluyen las ' + filas.length + '.</td></tr>'
      : '';

    tabla.innerHTML =
      '<thead><tr>' +
      '<th>ID</th><th>Cliente</th><th>Responsable</th><th>Mes</th><th>Documento</th><th>Cumple</th>' +
      '<th style="text-align:right;">Proyectado</th><th style="text-align:right;">Facturado</th>' +
      '<th style="text-align:right;">Ejecutado PMO</th><th style="text-align:right;">Saldo por ejecutar</th>' +
      '</tr></thead>' +
      '<tbody>' + body + truncado + '</tbody>' +
      '<tfoot><tr style="border-top:2px solid #E2E8F0;font-weight:700;">' +
      '<td colspan="6" style="padding:10px;color:#0F172A;">Total</td>' +
      '<td class="det-val" style="padding:10px;">' + fmtCOP(totProy) + '</td>' +
      '<td class="det-val" style="padding:10px;">' + fmtCOP(totFact) + '</td>' +
      '<td class="det-val" style="padding:10px;">' + fmtCOP(totEjec) + '</td>' +
      '<td class="det-val" style="padding:10px;">' + fmtCOP(totProy - totEjec) + '</td>' +
      '</tr></tfoot>';
  }

  function renderPmo() {
    const cardsEl = document.getElementById('pmo-cards');
    if (!cardsEl) return;
    bindPmoControls();

    const PMO = window.CMI_DATA.PRY.pmo || { celdas: [], responsables: [] };
    const activo = pmoActiveMonths();

    paintPmoCumple();
    fillPmoResponsables(PMO.responsables || []);

    const periodoEl = document.getElementById('pmo-periodo');
    if (periodoEl) periodoEl.textContent = pmoPeriodoLabel(activo.ix);

    const r = window.CMI_MAPPER.summarizeCuotas(PMO.celdas, {
      meses: activo.ix.length === 12 ? null : activo.ix,
      cumple: _pmoFilter.cumple,
      responsable: _pmoFilter.responsable,
      cliente: _pmoFilter.cliente
    });

    const hasData = (PMO.celdas || []).length > 0;
    const money = function (v) { return hasData ? fmtMoneyM(v) : '—'; };
    const exact = function (v) { return hasData ? fmtCOP(v) : 'Sin datos aún'; };

    cardsEl.innerHTML = [
      pmoCard({ title: 'Valor total con IVA', value: money(r.totalConIva), detail: exact(r.totalConIva) }),
      pmoCard({ title: 'Valor total sin IVA', value: money(r.totalSinIva), detail: exact(r.totalSinIva) }),
      pmoCard({
        title: 'Vr ejecutado PMO', value: money(r.ejecutadoPmo), detail: 'Cuotas con cumple = Sí · ' + exact(r.ejecutadoPmo),
        tone: 'ok', valueClass: 'text-emerald-600'
      }),
      pmoCard({
        title: 'Pendiente PMO', value: money(r.pendientePmo), detail: exact(r.pendientePmo),
        tone: 'warn', valueClass: 'text-amber-600'
      }),
      pmoCard({ title: 'Valor facturado', value: money(r.facturadoTotal), detail: exact(r.facturadoTotal) }),
      pmoCard({
        title: 'Pendiente recaudo', value: money(r.pendienteRecaudo), detail: 'Recaudado ' + exact(r.recaudadoTotal),
        tone: 'bad', valueClass: 'text-rose-600'
      })
    ].join('');

    barChart('pmo-mes', [
      { label: 'Proyectado', data: r.proyectado, backgroundColor: COLORS.ok, borderRadius: 4, maxBarThickness: 26 },
      { label: 'Ejecutado PMO', data: r.ejecutado, backgroundColor: COLORS.brand, borderRadius: 4, maxBarThickness: 26 },
      { label: 'Saldo por ejecutar', data: r.saldo, backgroundColor: COLORS.bad, borderRadius: 4, maxBarThickness: 26 }
    ], {
      yOpts: { ticks: { callback: function (v) { return '$' + (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 0 }) + 'M'; } } },
      tooltipOpts: { callbacks: { label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmtCOP(ctx.parsed.y); } } }
    });

    gauge('pmo-g-pmo', Math.max(0, Math.min(100, r.pctPmo)), COLORS.brand);
    gauge('pmo-g-rec', Math.max(0, Math.min(100, r.pctRecaudado)), COLORS.ok);
    const oPmo = document.getElementById('pmo-overlay-pmo');
    const oRec = document.getElementById('pmo-overlay-rec');
    if (oPmo) oPmo.textContent = hasData ? fmtPct(r.pctPmo) : '—';
    if (oRec) oRec.textContent = hasData ? fmtPct(r.pctRecaudado) : '—';

    const resumen = document.getElementById('pmo-resumen');
    if (resumen) {
      resumen.innerHTML = hasData
        ? '<div>Proyectos en el periodo: <span class="font-semibold text-slate-700">' + r.proyectos + '</span></div>' +
        '<div>IVA del periodo: <span class="font-semibold text-slate-700">' + fmtCOP(r.ivaTotal) + '</span></div>' +
        '<div>Recaudado: <span class="font-semibold text-slate-700">' + fmtCOP(r.recaudadoTotal) + '</span></div>'
        : '<div>Sin datos: asigná la plantilla de control de cuotas al área de Proyectos en Parametrización y actualizá los datos.</div>';
    }

    renderPmoTabla(r.filas);
  }

  /* ==================== PROYECTOS · Hitos (ID11920_Hitos_PMO) ====================
     Indicador pedido por el área:
       % Cumplimiento = (Hitos habilitados para facturación / Hitos facturables) × 100
     En pantalla ese numerador se rotula "Hitos facturables" y el denominador "Total de
     hitos" — nomenclatura del área; en el código siguen siendo habilitados/facturables.
     habilitados = CumplimientoHito<N> "SI"; facturables = "SI" o "NO". Los hitos con
     cumplimiento vacío quedan fuera de la fórmula (no están evaluados todavía) pero sí
     se muestran en la tabla y en el resumen, para que no desaparezcan del radar.
  
     Semáforo de fechas: FechaReal ≤ FechaEstimada → verde; posterior → rojo con los
     días de atraso. Ver mapper.js#buildHitosCells. */

  var _hitFilter = { cumple: 'todos', responsable: 'todos', licencia: 'todos', cliente: '' };
  var _hitBound = false;

  function bindHitosControls() {
    if (_hitBound) return;
    const cumple = document.getElementById('hit-cumple');
    if (!cumple) return;
    _hitBound = true;

    cumple.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-hcumple]');
      if (!btn) return;
      _hitFilter.cumple = btn.dataset.hcumple;
      renderHitos();
    });

    const selResp = document.getElementById('hit-responsable');
    if (selResp) selResp.addEventListener('change', function () { _hitFilter.responsable = selResp.value; renderHitos(); });

    const selLic = document.getElementById('hit-licencia');
    if (selLic) selLic.addEventListener('change', function () { _hitFilter.licencia = selLic.value; renderHitos(); });

    const inp = document.getElementById('hit-cliente');
    if (inp) inp.addEventListener('input', function () { _hitFilter.cliente = inp.value; renderHitos(); });

    const clear = document.getElementById('hit-clear');
    if (clear) clear.addEventListener('click', function () {
      _hitFilter = { cumple: 'todos', responsable: 'todos', licencia: 'todos', cliente: '' };
      if (selResp) selResp.value = 'todos';
      if (selLic) selLic.value = 'todos';
      if (inp) inp.value = '';
      renderHitos();
    });
  }

  // Mismo criterio que paintPmoCumple: el marcado se deriva del estado en cada render,
  // nunca se togglea en el click.
  function paintHitCumple() {
    document.querySelectorAll('#hit-cumple [data-hcumple]').forEach(function (btn) {
      btn.classList.toggle('det-pill-active', btn.dataset.hcumple === _hitFilter.cumple);
    });
  }

  // Rellena un <select> de dimensión conservando la selección si sigue existiendo.
  function fillHitSelect(id, opciones, etiquetaTodos, filtroKey) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = _hitFilter[filtroKey];
    sel.innerHTML = '<option value="todos">' + etiquetaTodos + '</option>' +
      opciones.map(function (o) {
        return '<option value="' + escapeHtml(o.key) + '">' + escapeHtml(o.label) + '</option>';
      }).join('');
    const sigue = opciones.some(function (o) { return o.key === prev; });
    _hitFilter[filtroKey] = sigue ? prev : 'todos';
    sel.value = _hitFilter[filtroKey];
  }

  // Chip de días: verde si cumplió en fecha o antes, rojo con el atraso si fue después.
  function hitDiasChip(c) {
    if (c.dias == null) {
      return '<span style="color:#CBD5E1;">—</span>';
    }
    if (c.dias > 0) {
      return '<span class="det-tag" style="background:#FEE2E2;color:#B91C1C;">+' + c.dias + ' d</span>';
    }
    const texto = c.dias === 0 ? 'En fecha' : Math.abs(c.dias) + ' d antes';
    return '<span class="det-tag" style="background:#DCFCE7;color:#15803D;">' + texto + '</span>';
  }

  function renderHitosTabla(filas) {
    const tabla = document.getElementById('hit-tabla');
    const count = document.getElementById('hit-tabla-count');
    if (!tabla) return;

    if (!filas.length) {
      tabla.innerHTML = '<tbody><tr><td style="padding:24px;text-align:center;color:#94A3B8;">Sin hitos para los filtros seleccionados.</td></tr></tbody>';
      if (count) count.textContent = '0 hitos';
      return;
    }
    if (count) count.textContent = filas.length + (filas.length === 1 ? ' hito' : ' hitos');

    const MAX = 300;
    const vista = filas.slice(0, MAX);

    const body = vista.map(function (c) {
      const estado = !c.facturable
        ? '<span class="det-tag" style="background:#F1F5F9;color:#64748B;">Sin evaluar</span>'
        : c.cumple
          ? '<span class="det-tag det-tag-greenywave">Sí</span>'
          : '<span class="det-tag det-tag-renovaciones">No</span>';
      const colorReal = (c.dias == null) ? '#334155' : (c.dias > 0 ? COLORS.bad : COLORS.ok);
      return '<tr>' +
        '<td class="det-id">' + escapeHtml(c.id) + '</td>' +
        '<td>' + escapeHtml(c.cliente) + '</td>' +
        '<td>' + escapeHtml(c.responsable) + '</td>' +
        '<td>' + escapeHtml(c.licencia) + '</td>' +
        '<td title="' + escapeHtml(c.proyecto) + '">' +
        '<span style="font-weight:700;color:#0EA5E9;">[Hito' + c.n + ']</span> ' +
        escapeHtml(c.hito) +
        '</td>' +
        '<td style="white-space:nowrap;">' + (c.fecha || '<span style="color:#CBD5E1;">—</span>') + '</td>' +
        '<td style="white-space:nowrap;font-weight:600;color:' + colorReal + ';">' + (c.fechaReal || '<span style="color:#CBD5E1;">—</span>') + '</td>' +
        '<td>' + hitDiasChip(c) + '</td>' +
        '<td>' + estado + '</td>' +
        '</tr>';
    }).join('');

    const truncado = filas.length > MAX
      ? '<tr><td colspan="9" style="text-align:center;color:#94A3B8;font-size:11px;">Se muestran los primeros ' + MAX + ' hitos — usá los filtros para acotar. Los indicadores incluyen los ' + filas.length + '.</td></tr>'
      : '';

    tabla.innerHTML =
      '<thead><tr>' +
      '<th>ID</th><th>Cliente</th><th>Responsable</th><th>Licencia</th><th>Hito</th>' +
      '<th>Fecha estimada</th><th>Fecha real</th><th>Días</th><th style="text-align:left;">Cumplimiento</th>' +
      '</tr></thead>' +
      '<tbody>' + body + truncado + '</tbody>';
  }

  function renderHitos() {
    const cardsEl = document.getElementById('hit-cards');
    if (!cardsEl) return;
    bindHitosControls();

    const H = window.CMI_DATA.PRY.hitos || { celdas: [], responsables: [], licencias: [] };
    const activo = pmoActiveMonths();

    paintHitCumple();
    fillHitSelect('hit-responsable', H.responsables || [], 'Todos', 'responsable');
    fillHitSelect('hit-licencia', H.licencias || [], 'Todas', 'licencia');

    const periodoEl = document.getElementById('hit-periodo');
    if (periodoEl) periodoEl.textContent = pmoPeriodoLabel(activo.ix);

    const r = window.CMI_MAPPER.summarizeHitos(H.celdas, {
      meses: activo.ix.length === 12 ? null : activo.ix,
      cumple: _hitFilter.cumple,
      responsable: _hitFilter.responsable,
      licencia: _hitFilter.licencia,
      cliente: _hitFilter.cliente
    });

    const hasData = (H.celdas || []).length > 0;
    const num = function (v) { return hasData ? String(v) : '—'; };

    cardsEl.innerHTML = [
      pmoCard({
        title: 'Hitos facturables', value: num(r.habilitados), detail: 'Cumplimiento = Sí',
        tone: 'ok', valueClass: 'text-emerald-600'
      }),
      pmoCard({ title: 'Total de hitos', value: num(r.facturables), detail: 'Sí + No del periodo' }),
      pmoCard({
        title: 'Hitos por cumplir', value: num(r.noHabilitados), detail: 'Cumplimiento = No',
        tone: 'bad', valueClass: 'text-rose-600'
      }),
      pmoCard({
        title: 'Cumplidos en fecha', value: num(r.aTiempo), detail: 'En la fecha estimada o antes',
        tone: 'ok', valueClass: 'text-emerald-600'
      }),
      pmoCard({
        title: 'Cumplidos con atraso', value: num(r.conAtraso), detail: 'Después de la fecha estimada',
        tone: 'warn', valueClass: 'text-amber-600'
      }),
      pmoCard({
        title: 'Atraso promedio', value: hasData ? Math.round(r.diasAtrasoProm) + ' d' : '—',
        detail: hasData ? 'Máximo ' + r.diasAtrasoMax + ' d' : 'Sin datos aún'
      })
    ].join('');

    makeChart('hit-mes', {
      type: 'bar',
      data: {
        labels: MONTHS, datasets: [
          { label: 'Facturables', data: r.porMesHabilitados, backgroundColor: COLORS.ok, borderRadius: 4, stack: 'h', maxBarThickness: 30 },
          { label: 'Por cumplir', data: r.porMesNo, backgroundColor: COLORS.bad, borderRadius: 4, stack: 'h', maxBarThickness: 30 },
          { label: 'Sin evaluar', data: r.porMesSinEvaluar, backgroundColor: COLORS.mute, borderRadius: 4, stack: 'h', maxBarThickness: 30 },
          {
            type: 'line', label: '% cumplimiento', data: r.pctPorMes, yAxisID: 'y1',
            borderColor: COLORS.brand, backgroundColor: 'rgba(14,165,233,.10)', borderWidth: 2.5,
            pointRadius: 3, tension: .3, spanGaps: true
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
          tooltip: {
            backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 },
            callbacks: {
              label: function (ctx) {
                const v = ctx.parsed.y;
                if (v == null) return null;
                return ctx.dataset.yAxisID === 'y1'
                  ? ' ' + ctx.dataset.label + ': ' + fmtPct(v)
                  : ' ' + ctx.dataset.label + ': ' + v + (v === 1 ? ' hito' : ' hitos');
              }
            }
          }
        },
        scales: {
          x: Object.assign({}, gridLight, { stacked: true }),
          y: Object.assign({}, gridLight, { stacked: true, beginAtZero: true, ticks: { precision: 0 } }),
          y1: {
            position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false },
            ticks: { color: '#94A3B8', callback: function (v) { return v + '%'; } }
          }
        }
      }
    });

    gauge('hit-gauge', Math.max(0, Math.min(100, r.pctCumplimiento)), COLORS.ok);
    const ov = document.getElementById('hit-overlay');
    if (ov) ov.textContent = (hasData && r.facturables) ? fmtPct(r.pctCumplimiento) : '—';

    const resumen = document.getElementById('hit-resumen');
    if (resumen) {
      resumen.innerHTML = hasData
        ? '<div>' + r.habilitados + ' de ' + r.facturables + ' hitos totales</div>' +
        '<div>Contratos en el periodo: <span class="font-semibold text-slate-700">' + r.contratos + '</span></div>' +
        '<div>Hitos sin evaluar: <span class="font-semibold text-slate-700">' + r.sinEvaluar + '</span> <span class="text-slate-400">(fuera de la fórmula)</span></div>'
        : '<div>Sin datos: asigná la plantilla de hitos al área de Proyectos en Parametrización y actualizá los datos.</div>';
    }

    renderHitosTabla(r.filas);
    renderHitosPorCliente(r);
  }

  /* Ranking de clientes: barras horizontales apiladas — el largo total es la cantidad
     de hitos facturables y el tramo verde es la parte cumplida, así el % se lee de un
     vistazo sin pasar el mouse. El orden lo define el mapper (cantidad desc, luego %
     desc). Como pueden ser decenas de clientes, el canvas crece a lo alto y el
     contenedor scrollea — mismo criterio que el gráfico de clientes de Soluciones. */
  function renderHitosPorCliente(r) {
    const wrap = document.getElementById('hit-clientes-wrap');
    const count = document.getElementById('hit-clientes-count');
    if (!wrap) return;

    const datos = r.porCliente || [];
    if (count) {
      count.textContent = datos.length + (datos.length === 1 ? ' cliente' : ' clientes') +
        (r.clientesSinFacturables ? ' · ' + r.clientesSinFacturables + ' sin hitos evaluados' : '');
    }

    // Alto proporcional a la cantidad de barras; el contenedor de arriba scrollea.
    wrap.style.height = Math.max(220, datos.length * 26) + 'px';

    const corta = function (s) { return s.length > 40 ? s.slice(0, 39) + '…' : s; };
    const etiquetas = datos.map(function (d) { return corta(d.cliente) + ' · ' + fmtPct(d.pct); });

    barChart('hit-clientes', [
      { label: 'Cumplidos', data: datos.map(function (d) { return d.cumplidos; }), backgroundColor: COLORS.ok, borderRadius: 3, maxBarThickness: 16 },
      { label: 'Por cumplir', data: datos.map(function (d) { return d.porCumplir; }), backgroundColor: COLORS.bad, borderRadius: 3, maxBarThickness: 16 }
    ], {
      labels: etiquetas,
      horizontal: true,
      stacked: true,
      xOpts: { beginAtZero: true, ticks: { precision: 0 } },
      yOpts: { ticks: { autoSkip: false, font: { size: 10 }, color: '#475569' } },
      tooltipOpts: {
        callbacks: {
          label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + ctx.parsed.x; },
          footer: function (items) {
            const d = datos[items[0].dataIndex];
            if (!d) return '';
            return d.hitos + (d.hitos === 1 ? ' hito' : ' hitos') + ' · ' + fmtPct(d.pct) + ' de cumplimiento' +
              (d.sinEvaluar ? '\n' + d.sinEvaluar + ' sin evaluar (fuera del %)' : '');
          }
        }
      }
    });
  }

  /* ============================ PROYECTOS ============================ */
  function renderProyectos() {
    bindPryTabs();
    renderPmo();
    renderHitos();
    buildCardsProyectos();
    const P = window.CMI_DATA.PRY;
    lineChart('pry-line', [
      { label: 'Plan de ejecución', data: P.ejecucion, borderColor: COLORS.brand, backgroundColor: 'rgba(14,165,233,.10)', fill: false, tension: .3, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Avance económico', data: P.avance, borderColor: COLORS.violet, fill: false, tension: .3, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Habilitación facturación', data: P.habilit, borderColor: COLORS.ok, fill: false, tension: .3, pointRadius: 3, borderWidth: 2.5 },
      { label: 'Meta 95%', data: Array(12).fill(95), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 }
    ], { yOpts: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } });

    makeChart('pry-horas', {
      type: 'bar',
      data: {
        labels: MONTHS, datasets: [
          { label: 'Consumo horas', data: P.horas, backgroundColor: P.horas.map(function (v) { return v <= 100 ? COLORS.ok : COLORS.bad; }), borderRadius: 4 },
          { type: 'line', label: 'Meta ≤100%', data: Array(12).fill(100), borderColor: COLORS.warn, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } } },
        scales: { x: gridLight, y: Object.assign({}, gridLight, { min: 0, max: 110, ticks: { callback: function (v) { return v + '%'; } } }) }
      }
    });

    var pryCur = getCur();
    var pryHasData = _hasAnyData(P.ejecucion) || _hasAnyData(P.avance) || _hasAnyData(P.habilit);

    gauge('pry-g1', pryHasData ? (P.ejecucion[pryCur] || 0) : 0, COLORS.ok);
    gauge('pry-g2', pryHasData ? (P.avance[pryCur] || 0) : 0, COLORS.warn);
    gauge('pry-g3', pryHasData ? (P.habilit[pryCur] || 0) : 0, COLORS.ok);
    var _pryO1 = document.getElementById('pry-overlay-g1');
    var _pryO2 = document.getElementById('pry-overlay-g2');
    var _pryO3 = document.getElementById('pry-overlay-g3');
    if (_pryO1) _pryO1.textContent = fmtPctOr(P.ejecucion[pryCur], pryHasData);
    if (_pryO2) _pryO2.textContent = fmtPctOr(P.avance[pryCur], pryHasData);
    if (_pryO3) _pryO3.textContent = fmtPctOr(P.habilit[pryCur], pryHasData);
  }

  /* ============================ SOLUCIONES ============================ */
  function renderSoluciones() {
    buildCardsSoluciones();
    const S = window.CMI_DATA.SOL;
    const trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    const mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    const meta = S.metaConfiabilidad != null ? S.metaConfiabilidad : 90;

    // Escala 60–100 (no 80–100): los valores reales rondan 77–84%, bien por debajo de
    // la meta del 90% — con piso en 80 la línea quedaría pegada al borde inferior.
    // spanGaps salta los meses en null (ago-dic, aún no llega el extracto) en vez de
    // cortar la línea o leerlos como 0%.
    lineChart('sol-line', [
      { label: 'Confiabilidad', data: S.confiabilidad, borderColor: COLORS.brand, backgroundColor: 'rgba(14,165,233,.15)', fill: true, tension: .35, pointBackgroundColor: COLORS.brand, pointRadius: 4, borderWidth: 3, spanGaps: true },
      { label: 'Meta ' + meta + '%', data: Array(12).fill(meta), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
    ], { yOpts: { min: 60, max: 100, ticks: { callback: function (v) { return v + '%'; } } } });

    // Backlog por recurso/acción/cliente/producto: fotografía puntual del tablero de
    // origen, sin dimensión mensual — NO se filtra por trimestre ni mes de corte
    // (mismo criterio ya aplicado a "Cumplimiento ANS por producto" en renderIds()).
    barChart('sol-recurso', [
      { label: 'Tickets abiertos', data: S.recursos.data, backgroundColor: COLORS.brand, borderRadius: 4, maxBarThickness: 18 }
    ], { labels: S.recursos.labels, horizontal: true, legend: false, xOpts: { ticks: { precision: 0 } } });

    barChart('sol-accion', [
      { label: 'Tickets abiertos', data: S.acciones.data, backgroundColor: COLORS.brand, borderRadius: 4, maxBarThickness: 18 }
    ], { labels: S.acciones.labels, horizontal: true, legend: false, xOpts: { ticks: { precision: 0 } } });

    // Clientes: se muestran TODOS. Para no achicar la tarjeta ni aplastar las barras, el
    // contenedor tiene scroll horizontal (overflow-x en index.html) y acá se fija el ancho
    // interno según la cantidad de clientes (~56px por barra). Si caben en el ancho visible
    // el min-width no fuerza scroll (el contenedor gana); si sobran, aparece la barra.
    var nCli = S.clientes.labels.length;
    var _cliWrap = document.getElementById('sol-cliente-wrap');
    if (_cliWrap) _cliWrap.style.minWidth = (nCli * 56) + 'px';
    var _cliCount = document.getElementById('sol-cliente-count');
    if (_cliCount) _cliCount.textContent = nCli + (nCli === 1 ? ' cliente' : ' clientes');
    barChart('sol-cliente', [
      { label: 'Tickets abiertos', data: S.clientes.data, backgroundColor: COLORS.brand, borderRadius: 6, maxBarThickness: 32 }
    ], { labels: S.clientes.labels, legend: false, yOpts: { ticks: { precision: 0 } } });

    // Doughnut de productos vía makeChart directo (no el helper doughnut()): necesita
    // borderColor/borderWidth blancos entre porciones y un generateLabels con
    // valor+porcentaje que el helper compartido no contempla (igual criterio que
    // com-donut en renderComercial(), que tampoco usa el helper por la misma razón).
    var prodLabels = (S.productos && S.productos.labels) || [];
    var prodData = (S.productos && S.productos.data) || [];
    var prodColors = (S.productos && S.productos.colors) || [];
    makeChart('sol-producto', {
      type: 'doughnut',
      data: { labels: prodLabels, datasets: [{ data: prodData, backgroundColor: prodColors, borderColor: '#FFFFFF', borderWidth: 2, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom', labels: {
              usePointStyle: true, boxWidth: 8, padding: 10,
              generateLabels: function (chart) {
                var d = chart.data;
                var vals = d.datasets[0].data;
                var total = vals.reduce(function (a, b) { return a + b; }, 0);
                return d.labels.map(function (l, i) {
                  var pct = total ? (vals[i] / total * 100).toFixed(1).replace('.', ',') : '0,0';
                  var bg = d.datasets[0].backgroundColor || [];
                  return {
                    text: l + ' · ' + vals[i] + ' (' + pct + '%)',
                    fillStyle: bg[i] || '#94A3B8',
                    strokeStyle: bg[i] || '#94A3B8',
                    // Reemplazar generateLabels pisa también el default de Chart.js, que es
                    // quien tacha la etiqueta oculta — hay que marcarlo acá para que el
                    // plugin de leyenda dibuje el line-through al ocultar una porción.
                    hidden: !chart.getDataVisibility(i),
                    pointStyle: 'circle', index: i
                  };
                });
              }
            }
          },
          tooltip: { backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 } }
        }
      }
    });
  }

  /* ============================ IDS ============================ */
  function renderIds() {
    buildCardsIds();
    const I = window.CMI_DATA.IDS;
    const idsMetas = I.metas || {};
    const confMeta = idsMetas.confiabilidad != null ? idsMetas.confiabilidad : 90;
    const ansMeta = idsMetas.ansGlobal != null ? idsMetas.ansGlobal : 90;

    // Rango de meses activo según trimestre/mes de corte — aplica a "Nivel de
    // confiabilidad" y "Cumplimiento ANS" (mensuales, grilla fija de 12 meses).
    // NO aplica a "Cumplimiento ANS por producto": ese gráfico ya solo muestra los
    // meses con dato real por producto, no la grilla de 12 meses, así que filtrarlo
    // por trimestre no tiene el mismo sentido y quedó fuera a pedido explícito.
    var trimKey = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
    var mesCorte = (window.CMI_FILTROS && window.CMI_FILTROS.mesCorte) || 'all';
    var activeIx = getActiveIx(trimKey, mesCorte);
    var activeMonths = activeIx.map(function (i) { return MONTHS[i]; });
    var periodLabel = trimKey === 'ytd' ? 'Ene – Dic'
      : mesCorte !== 'all' ? MONTHS[parseInt(mesCorte, 10)]
        : trimKey.toUpperCase();
    var _confChip = document.getElementById('ids-conf-period');
    if (_confChip) _confChip.textContent = periodLabel;
    var _ansChip = document.getElementById('ids-ans-global-period');
    if (_ansChip) _ansChip.textContent = periodLabel;

    // Indicador #1 (ID11947): barra por mes con coloreado semáforo + meta dinámica
    var confData = activeIx.map(function (i) { return I.confiabilidad[i]; });
    var confColors = semaphoreColors(confData, confMeta);
    barChart('ids-conf', [
      { label: 'Confiabilidad', data: confData, backgroundColor: confColors, borderRadius: 4, maxBarThickness: 34 },
      { type: 'line', label: 'Meta ' + confMeta + '%', data: Array(activeIx.length).fill(confMeta), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
    ], { labels: activeMonths, legendColors: [dominantColor(confColors)], yOpts: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } });

    // Indicador #2 (ID11948, agrupado por NOMPRODUCTO): un bloque de barras por
    // producto, mes a mes (solo meses con datos — la cantidad de productos y de
    // meses reportados no está acotada, ver #view-ids en index.html para el
    // contenedor con scroll horizontal). Tick de 2 líneas [mes, producto].
    var productos = Object.keys(I.ansPorProducto || {}).sort();
    var prodLabels = [], prodData = [];
    productos.forEach(function (p) {
      var serie = I.ansPorProducto[p] || [];
      MONTHS.forEach(function (m, i) {
        var v = serie[i];
        if (v == null || v === 0) return;
        prodLabels.push([m, p]);
        prodData.push(v);
      });
    });
    var hasProdData = prodData.length > 0;
    barChart('ids-ans-producto', [
      {
        label: 'Cumplimiento ANS', data: hasProdData ? prodData : [0],
        backgroundColor: hasProdData ? semaphoreColors(prodData, ansMeta) : COLORS.mute, borderRadius: 4, maxBarThickness: 26
      },
      { type: 'line', label: 'Meta ' + ansMeta + '%', data: Array(hasProdData ? prodData.length : 1).fill(ansMeta), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
    ], { labels: hasProdData ? prodLabels : ['Sin datos'], legend: false, yOpts: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } });

    // Leyenda de colores — este gráfico corre con legend:false (los datasets no son
    // series con nombre, son barras individuales), así que el significado de cada
    // color se explica acá en vez de en la leyenda de Chart.js. Umbrales calculados
    // sobre la meta real (ansMeta), no hardcodeados, para que no queden desfasados
    // si la columna META trae un valor distinto a 90.
    var _prodLegend = document.getElementById('ids-ans-producto-legend');
    if (_prodLegend) {
      var warnFloor = (ansMeta * 0.92).toFixed(1);
      var dot = function (color) { return '<span class="dot" style="background:' + color + '"></span>'; };
      _prodLegend.innerHTML =
        '<span class="flex items-center gap-1.5">' + dot(COLORS.ok) + 'Cumple meta (≥ ' + ansMeta + '%)</span>' +
        '<span class="flex items-center gap-1.5">' + dot(COLORS.warn) + 'En riesgo (' + warnFloor + '% – ' + ansMeta + '%)</span>' +
        '<span class="flex items-center gap-1.5">' + dot(COLORS.bad) + 'No cumple (< ' + warnFloor + '%)</span>';
    }

    // Indicador #3 (misma tabla que #2, promedio mensual entre todos los productos)
    var ansGlobalData = activeIx.map(function (i) { return I.ansGlobal[i]; });
    var ansGlobalColors = semaphoreColors(ansGlobalData, ansMeta);
    barChart('ids-ans-global', [
      { label: 'Cumplimiento ANS', data: ansGlobalData, backgroundColor: ansGlobalColors, borderRadius: 4, maxBarThickness: 34 },
      { type: 'line', label: 'Meta ' + ansMeta + '%', data: Array(activeIx.length).fill(ansMeta), borderColor: COLORS.bad, borderDash: [5, 5], pointRadius: 0, borderWidth: 2 }
    ], { labels: activeMonths, legendColors: [dominantColor(ansGlobalColors)], yOpts: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } });
  }

  // Soluciones se alimenta del resumen agregado del servidor (fetchSolucionesKpis), que
  // llega ~1-2s después de la carga inicial. Hasta que ese dato real esté, mantenemos el
  // esqueleto de carga en toda el área en vez de pintar la fotografía estática (188/67/110):
  // esos números son un placeholder obsoleto y verlos saltar a los reales confunde.
  // runActualizarDatos() (o app.js si no hay OData configurado) marca listo vía markSolReady().
  var _solReady = false;

  function renderAll() {
    renderExec();
    renderComercial();
    renderFinanciera();
    renderProyectos();
    renderSoluciones();
    renderIds();
    var solView = document.getElementById('view-soluciones');
    document.querySelectorAll('.card-loading').forEach(function (el) {
      if (!_solReady && solView && solView.contains(el)) return; // Soluciones sigue en carga
      el.classList.remove('card-loading');
    });
    // Mientras no haya dato real, todas las tarjetas de Soluciones quedan en esqueleto.
    if (!_solReady && solView) {
      solView.querySelectorAll('.card').forEach(function (c) { c.classList.add('card-loading'); });
    }
    paintUpdatedAtBadges();
  }

  // Pinta las etiquetas "Actualizado: ..." de cada área + sidebar + OKR/Parámetros/
  // Usuarios (estas últimas usan la fecha global porque no traen datos propios).
  // Idempotente y segura de llamar aunque un id no exista todavía en el DOM.
  function paintUpdatedAtBadges() {
    window.CMI_AREA_IDS.forEach(function (areaId) {
      var el = document.getElementById('updated-at-' + areaId);
      if (el) el.textContent = window.CMI_STORE.formatUpdatedAt(window.CMI_STORE.getAreaUpdatedAt(areaId));
    });
    var globalText = window.CMI_STORE.formatUpdatedAt(window.CMI_STORE.getGlobalUpdatedAt());
    ['sidebar-updated-at', 'updated-at-exec', 'updated-at-filtros', 'updated-at-admin'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = globalText;
    });
  }

  // Marca que el resumen de Soluciones ya se resolvió (llegó del servidor, falló, o no
  // hay OData configurado) — a partir de acá renderAll() deja de mostrar el esqueleto y
  // pinta lo que haya en CMI_DATA.SOL. Idempotente.
  function markSolReady() { _solReady = true; }

  window.CMI_RENDER = {
    all: renderAll,
    exec: renderExec,
    comercial: renderComercial,
    financiera: renderFinanciera,
    proyectos: renderProyectos,
    soluciones: renderSoluciones,
    ids: renderIds,
    markSolReady: markSolReady,
    paintUpdatedAtBadges: paintUpdatedAtBadges
  };

  window.addEventListener('DOMContentLoaded', renderAll);
})();
