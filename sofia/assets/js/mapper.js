(function () {
  'use strict';

  // Pure data-shaping layer for the ID12086_Tickets_medidor ticket feed.
  // No DOM access anywhere in this file — it runs unmodified in Node (tests,
  // and potentially server-side aggregation later) and in the browser, via
  // the dual export at the bottom (adapted from the reference project's
  // CMI_MAPPER pattern).

  /* ==================== Column alias detection ====================
     The OData feed and the Libro1.xlsx fixture already use the exact
     ID12086_Tickets_medidor column names, but resolving them through a
     small alias table (instead of hardcoding row.Fecha etc. everywhere)
     keeps normalizeTickets() tolerant of minor casing/naming drift without
     needing to touch every call site. */
  var CANONICAL_ALIASES = {
    id: ['id'],
    fecha: ['fecha'],
    accion: ['accion'],
    producto: ['producto'],
    proyecto: ['proyecto'],
    proceso: ['proceso'],
    recursoSoporte: ['recursosoporte'],
    recursoEntregaFinal: ['recursoentregafinal'],
    prioridad: ['prioridaddelservicioans'],
    tiempoEmpleadoEntrega: ['tiempoempleadoentrega'],
    tiempoDeLlamada: ['tiempodellamada'],
    // Not present in the live OData feed as of spec v2 — detected via alias
    // like every other column, so normalizeTickets can tell "column absent"
    // apart from "column present but empty" (see hasClienteColumn()).
    cliente: ['cliente', 'clientenombre', 'nombrecliente', 'client'],
    // Capacidad y Rendimiento fields — raw HH:MM time-of-day strings and the
    // dates that anchor each hour block (see ticketHours()/buildCapacidad()).
    horaCalInicial: ['horacalinicial'],
    horaCalFinal: ['horacalfinal'],
    horaCalInicial3: ['horacalinicial3'],
    horaCalFinal3: ['horacalfinal3'],
    fechaSoporteInicial: ['fechasoporteinicial'],
    fechaEntregaInicial: ['fechaentregainicial'],
    // Tickets Activos fields (spec v3). recursoAccion/estado always exist in
    // the feed (regular alias resolution, like producto/proceso above).
    // requerimientoOpcion does NOT exist yet in either the live feed or the
    // sample fixture -- detected the same way as `cliente` above, so
    // normalizeTickets can tell "column absent" (-> null on every ticket)
    // apart from "column present but empty" (-> 'Sin requerimiento').
    recursoAccion: ['recursoaccion'],
    estado: ['estado', 'activo', 'estadoticket'],
    requerimientoOpcion: ['requerimientoopcion', 'requerimiento', 'opcion', 'opciones'],
    // Segundo Nivel de Atención fields. Neither exists yet in the live feed
    // nor in the sample fixture (verified against data/sample-tickets.json's
    // 21 columns) -- detected the same absent-column way as cliente/
    // requerimientoOpcion above, so buildSegundoNivel can degrade gracefully
    // instead of rendering a misleading empty donut / blank table column.
    diagnostico: ['diagnostico'],
    asunto: ['asunto']
  };

  // Strips accents before the alphanumeric filter so an accented alias
  // (e.g. "Recurso_Acción") normalizes to the same key as its unaccented
  // spelling ("Recurso_Accion") instead of losing the accented letter
  // entirely -- stripDiacritics is defined further down but hoisted within
  // this module's IIFE scope, so it's available here at call time.
  function normKey(s) {
    return stripDiacritics(String(s || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Encuentra una columna cuyo nombre normalizado calce con alguno de los
  // alias dados: primero coincidencia exacta, luego "uno contiene al otro".
  function findAliasColumn(sampleRow, aliases, keysArg) {
    if (!sampleRow || !aliases || !aliases.length) return null;
    var keys = keysArg || Object.keys(sampleRow);
    var hit = keys.find(function (k) { return aliases.indexOf(normKey(k)) !== -1; });
    if (!hit) {
      hit = keys.find(function (k) {
        var nk = normKey(k);
        return aliases.some(function (a) { return nk.indexOf(a) !== -1 || a.indexOf(nk) !== -1; });
      });
    }
    return hit || null;
  }

  function detectColumns(sampleRow) {
    if (!sampleRow) return null;
    var keys = Object.keys(sampleRow);
    var lookup = {};
    Object.keys(CANONICAL_ALIASES).forEach(function (field) {
      var hit = findAliasColumn(sampleRow, CANONICAL_ALIASES[field], keys);
      if (hit) lookup[field] = hit;
    });
    return lookup;
  }

  /* ==================== Safe date parsing ====================
     Handles the three shapes this feed can produce: OData v2 "/Date(ms)/",
     ISO "YYYY-MM-DDTHH:MM:SS", and "DD/MM/YYYY". Deliberately never falls
     back to `new Date(rawString)`: that constructor is locale/engine
     dependent for ambiguous strings and, critically, parsing a date-only
     ISO string like "2026-03-01" with it produces a LOCAL midnight, which in
     any UTC-negative timezone reads back as Feb 28 — shifting day 1 of the
     month into the previous month. Building explicitly via Date.UTC(...) and
     reading back with the UTC getters avoids that entirely. */
  function parseFecha(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;

    var odataMatch = s.match(/\/Date\((-?\d+)\)\//i);
    if (odataMatch) return new Date(parseInt(odataMatch[1], 10));

    var isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (isoMatch) {
      var y = parseInt(isoMatch[1], 10);
      var mo = parseInt(isoMatch[2], 10);
      var d = parseInt(isoMatch[3], 10);
      if (mo < 1 || mo > 12) return null;
      var hh = isoMatch[4] ? parseInt(isoMatch[4], 10) : 0;
      var mm = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
      var ss = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;
      return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
    }

    var dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyMatch) {
      var d2 = parseInt(dmyMatch[1], 10);
      var m2 = parseInt(dmyMatch[2], 10);
      var y2 = parseInt(dmyMatch[3], 10);
      if (m2 < 1 || m2 > 12) return null;
      return new Date(Date.UTC(y2, m2 - 1, d2));
    }

    return null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function monthKey(date) {
    if (!date) return null;
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1);
  }

  /* ==================== Text normalization ==================== */

  function fillOrDefaultText(v, fallback) {
    if (v == null) return fallback;
    var s = String(v).trim();
    return s === '' ? fallback : s;
  }

  function fillOrDefault(v) {
    return fillOrDefaultText(v, 'Sin dato');
  }

  // Estado comes in as either a number (1, 2) or a numeric string ("1",
  // "2") depending on the feed -- normalized once here to a plain number so
  // every consumer (buildActivos' universe filter) can compare with ===
  // instead of re-deriving this coercion. Unparseable/absent -> null.
  function parseEstado(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (s === '') return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Title-Cases a name so duplicate-cased values from the feed
  // (e.g. "PAOLA ANDREA MACIAS ROJAS" vs "Paola Andrea Macias Rojas") merge
  // into a single grouping key. Uses locale-aware case conversion so
  // accented characters (á, é, í, ó, ú, ñ) round-trip correctly.
  function toTitleCase(s) {
    s = String(s || '').trim();
    if (!s) return '';
    return s.toLowerCase().split(/\s+/).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function normalizeRecurso(raw) {
    var s = fillOrDefault(raw);
    return s === 'Sin dato' ? s : toTitleCase(s);
  }

  // Client names are organisations, not people: Title Case would mangle
  // acronyms ("E.S.P." -> "E.s.p."), so case variants of the same client
  // ("Universidad de la Amazonia" / "UNIVERSIDAD DE LA AMAZONIA") merge by
  // upper-casing instead, with internal whitespace collapsed. Accents are
  // kept: they can distinguish real entities in this feed.
  // Spelling variants of the same client that upper-casing alone cannot
  // merge. Keys are the already upper-cased/whitespace-collapsed feed value,
  // values the canonical display name. Business-confirmed entries only:
  // add a row here when the BPM introduces another spelling, never guess.
  var CLIENTE_ALIASES = {
    'E.S.P. HIDROELÉCTRICA ITUANGO S.A. - HIDROITUANGO S.A. E.S.P': 'HIDROELÉCTRICA ITUANGO S.A. E.S.P.'
  };

  function normalizeCliente(raw) {
    var s = fillOrDefaultText(raw, 'Sin cliente');
    if (s === 'Sin cliente') return s;
    var upper = s.replace(/\s+/g, ' ').toUpperCase();
    return CLIENTE_ALIASES[upper] || upper;
  }

  // Strips combining diacritical marks (the accent, not the base letter) so
  // "María" and "Maria" compare equal. NFD splits each accented character
  // into base+mark, then the U+0300-U+036F range (Unicode's "Combining
  // Diacritical Marks" block) is dropped.
  function stripDiacritics(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function recursoGroupKey(titleCasedName) {
    return stripDiacritics(titleCasedName).toLowerCase();
  }

  // Per-row Title Case only merges pure case differences ("PAOLA X" vs
  // "Paola X"). It does NOT merge accent variants of the same person
  // ("María" vs "Maria"), which the feed genuinely contains for the same
  // recurso. This groups every Title-Cased name by its diacritic-stripped,
  // lower-cased key and rewrites every ticket to the MOST FREQUENT variant
  // within that group — so "Lina María Peralta" (1 row) and "Lina Maria
  // Peralta" (2 rows) become a single "Lina Maria Peralta" resource.
  // Deliberately narrow: this only strips accents, so real typos ("Villrreal"
  // vs "Villarreal" — differ by more than an accent) are correctly left
  // as distinct resources, not silently merged.
  function resolveRecursoDisplayNames(titleCasedNames) {
    var counts = {}; // groupKey -> { variant: count }
    titleCasedNames.forEach(function (name) {
      if (!name || name === 'Sin dato') return;
      var key = recursoGroupKey(name);
      if (!counts[key]) counts[key] = {};
      counts[key][name] = (counts[key][name] || 0) + 1;
    });
    var winners = {};
    Object.keys(counts).forEach(function (key) {
      var variants = counts[key];
      var best = null, bestCount = -1;
      // Sorted iteration keeps the winner pick deterministic on a count tie.
      Object.keys(variants).sort().forEach(function (variant) {
        if (variants[variant] > bestCount) { best = variant; bestCount = variants[variant]; }
      });
      winners[key] = best;
    });
    return function resolve(name) {
      if (!name || name === 'Sin dato') return name;
      return winners[recursoGroupKey(name)];
    };
  }

  // Capacidad multi-fuente (capacidad-multi-fuente-odata.md): resolves
  // accent/casing variants across the UNION of tickets' recursoSoporte and
  // the 4 extra OData sources' own recurso values (Tarea/Tarea con
  // Revisión/Seguimiento Cliente/Capacitación — see data-sources.js), so
  // "Juan Perez" from one source and "Juan Pérez" from another fuse into the
  // same consultant instead of becoming two separate rows. Returns null when
  // there are no extraRows, so buildCapacidad/buildRecursoTickets can skip
  // re-resolving tickets that normalizeTickets already fused once — keeps
  // the 2-arg / no-extra-sources call path byte-identical to its
  // pre-multi-fuente behavior.
  function buildExtraSourcesResolver(tickets, extraRows) {
    if (!extraRows || !extraRows.length) return null;
    var allNames = tickets.map(function (t) { return t.recursoSoporte; })
      .concat(extraRows.map(function (r) { return r.recurso; }));
    var resolve = resolveRecursoDisplayNames(allNames);
    return function (raw) { return resolve(raw) || raw; };
  }

  // Prioridad_del_Servicio_ANS values look like
  // "3-Prioritario (Atendido en 16 horas hábiles)" or
  // "10-Visita / Implementación (Programación)" — group by the leading
  // "<number>-<word>" token (stops at the first space or opening paren),
  // which is what distinguishes the 11 raw variants into a handful of
  // priority tiers.
  function groupPrioridad(raw) {
    var s = String(raw || '').trim();
    if (!s) return 'Sin dato';
    var m = s.match(/^(\d+)-([^\s(]+)/);
    return m ? (m[1] + '-' + m[2]) : s;
  }

  /* ==================== Categorical palette ====================
     Reference project's own PRODUCTO_COLORS — kept verbatim per the
     dataviz-vs-reference-palette tie-break rule (reference wins on values). */
  var PRODUCTO_COLORS = ['#0EA5E9', '#6D28D9', '#F97316', '#1D4ED8', '#EC4899', '#0D9488', '#84CC16', '#B45309'];
  var PRODUCTO_COLOR_OTROS = '#94A3B8';

  /* ==================== normalizeTickets ==================== */

  function normalizeTickets(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    var cols = detectColumns(rows[0]) || {};

    function col(field, fallbackKey) {
      return cols[field] || fallbackKey;
    }

    var tickets = rows.map(function (row) {
      var fechaRaw = row[col('fecha', 'Fecha')];
      var fecha = parseFecha(fechaRaw);
      var accionRaw = row[col('accion', 'Accion')];
      var recursoRaw = row[col('recursoSoporte', 'Recurso_Soporte')];
      var prioridadRaw = row[col('prioridad', 'Prioridad_del_Servicio_ANS')];

      // Block 1 is dated by Fecha_Soporte_Inicial. Block 3 is dated by
      // Fecha_Entrega_Inicial, falling back to Fecha_Soporte_Inicial, then
      // Fecha — resolved once here so ticketHours()/buildCapacidad() never
      // duplicate this fallback chain.
      var fechaSoporteInicial = parseFecha(row[col('fechaSoporteInicial', 'Fecha_Soporte_Inicial')]);
      var fechaEntregaInicial = parseFecha(row[col('fechaEntregaInicial', 'Fecha_Entrega_Inicial')]);

      // Cliente: the live feed doesn't have this column today. `cols.cliente`
      // is only set when detectColumns() actually found it in this dataset's
      // first row, so `cliente` is either "always a string" or "always null"
      // across the whole ticket list — never a mix — which is exactly what
      // hasClienteColumn() checks for.
      var clienteCol = cols.cliente;

      // requerimientoOpcion: same absent-column detection as Cliente above
      // (this column doesn't exist yet in the live feed or the sample
      // fixture) -- the Tickets Activos filter hides itself when this is
      // null on every ticket.
      var requerimientoCol = cols.requerimientoOpcion;

      // Same absent-column detection for Segundo Nivel de Atención's own
      // fields -- see the CANONICAL_ALIASES comment above.
      var diagnosticoCol = cols.diagnostico;
      var asuntoCol = cols.asunto;

      return {
        id: row[col('id', 'ID')],
        fecha: fecha,
        mesKey: fecha ? monthKey(fecha) : null,
        accion: fillOrDefault(accionRaw),
        accionNorm: String(accionRaw || '').trim().toUpperCase(),
        producto: fillOrDefault(row[col('producto', 'Producto')]),
        proyecto: fillOrDefault(row[col('proyecto', 'Proyecto')]),
        proceso: fillOrDefault(row[col('proceso', 'Proceso')]),
        recursoSoporte: normalizeRecurso(recursoRaw),
        recursoEntregaFinal: fillOrDefault(row[col('recursoEntregaFinal', 'Recurso_Entrega_Final')]),
        prioridad: groupPrioridad(prioridadRaw),
        prioridadRaw: fillOrDefault(prioridadRaw),
        tiempoEmpleadoEntrega: fillOrDefault(row[col('tiempoEmpleadoEntrega', 'Tiempo_empleado_entrega')]),
        tiempoDeLlamada: fillOrDefault(row[col('tiempoDeLlamada', 'Tiempo_de_llamada')]),
        // Raw HH:MM strings (or null) — kept un-normalized (not "Sin dato")
        // because ticketHours() needs to distinguish "absent" from a real value.
        horaCalInicial: row[col('horaCalInicial', 'Hora_Cal_Inicial')] != null ? row[col('horaCalInicial', 'Hora_Cal_Inicial')] : null,
        horaCalFinal: row[col('horaCalFinal', 'Hora_Cal_Final')] != null ? row[col('horaCalFinal', 'Hora_Cal_Final')] : null,
        horaCalInicial3: row[col('horaCalInicial3', 'Hora_Cal_Inicial_3')] != null ? row[col('horaCalInicial3', 'Hora_Cal_Inicial_3')] : null,
        horaCalFinal3: row[col('horaCalFinal3', 'Hora_Cal_Final_3')] != null ? row[col('horaCalFinal3', 'Hora_Cal_Final_3')] : null,
        fechaBloque1: fechaSoporteInicial,
        fechaBloque3: fechaEntregaInicial || fechaSoporteInicial || fecha,
        // Un-fallback-chained copies of the same two dates, for filters that
        // need the exact column value (Tickets Activos date-range filters)
        // rather than ticketHours()'s block-dating fallback chain.
        fechaSoporteInicial: fechaSoporteInicial,
        fechaEntregaInicial: fechaEntregaInicial,
        cliente: clienteCol ? normalizeCliente(row[clienteCol]) : null,
        recursoAccion: fillOrDefaultText(row[col('recursoAccion', 'Recurso_Accion')], 'Sin recurso'),
        estado: parseEstado(row[col('estado', 'Estado')]),
        requerimientoOpcion: requerimientoCol ? fillOrDefaultText(row[requerimientoCol], 'Sin requerimiento') : null,
        diagnostico: diagnosticoCol ? fillOrDefaultText(row[diagnosticoCol], 'Sin diagnóstico') : null,
        asunto: asuntoCol ? fillOrDefaultText(row[asuntoCol], 'Sin asunto') : null
      };
    });

    // Second pass: merge accent-variant spellings of the same resource (see
    // resolveRecursoDisplayNames) — needs the full per-row Title-Cased list
    // before it can decide which variant is most frequent.
    var resolveRecurso = resolveRecursoDisplayNames(tickets.map(function (t) { return t.recursoSoporte; }));
    tickets.forEach(function (t) { t.recursoSoporte = resolveRecurso(t.recursoSoporte); });

    return tickets;
  }

  // True when the dataset's Cliente column was detected (see normalizeTickets
  // above) — the UI uses this to disable the Cliente filter and show a help
  // message instead of a select with no real options.
  function hasClienteColumn(tickets) {
    return Array.isArray(tickets) && tickets.some(function (t) { return t.cliente !== null; });
  }

  /* ==================== buildResumen (rediseño) ====================
     Reemplazo completo del buildResumen anterior — ver
     odd/tasks/resumen-rediseno.md y el spec JSON pegado por el usuario.
     Aggregates everything the redesigned Resumen view needs from a
     normalized ticket list + optional filters:
       { fechaDesde, fechaHasta, periodo, proceso, producto }
       - fechaDesde/fechaHasta ("Rango de Fechas"): inclusive day range over
         ticket.fecha (asUTCDate/toUTCDateOnly, same day-granularity compare
         buildActivos' outsideRange already uses).
       - periodo ("Periodos", 'YYYY-MM'): independent month filter over the
         same ticket.fecha. Combined with fechaDesde/fechaHasta via AND — if
         both are set, the range further narrows the chosen month.
       - proceso/producto: exact match, 'all'/falsy = no filter.
     Every one of the 4 KPI cards below applies ONLY its own condition on
     top of this shared filtered universe — never another card's condition
     (confirmed with the user: calidad/implementacion/mantenimiento do NOT
     also require estado===1, that gate belongs to the activos card alone). */

  // ACTIVOS_CALIDAD_ACCIONES/SEGUNDO_NIVEL_ACCIONES are defined further down
  // this file (module-scope `var`, hoisted within the IIFE) — referenced
  // here by buildResumen's calidad card / topRecursosSegundoNivel so the
  // "Calidad"/"Segundo Nivel" action buckets stay defined in exactly one
  // place, reused by Primer Nivel de Atención, Segundo Nivel de Atención and
  // this view alike.

  // Proceso values in the feed are Title Case with accents ("Implementación",
  // "Mantenimiento"), not the spec's uppercase/no-accent literals
  // (IMPLEMENTACION, MANTENIMIENTO) — normalize both sides the same way
  // before comparing.
  function procesoNorm(raw) {
    return stripDiacritics(String(raw || '')).toUpperCase();
  }

  var RESUMEN_CARD_DEFS = [
    { id: 'activos', title: 'Total Tickets Activos', test: function (t) { return t.estado === 1; } },
    { id: 'calidad', title: 'Tickets en Calidad', test: function (t) { return ACTIVOS_CALIDAD_ACCIONES.indexOf(t.accionNorm) !== -1; } },
    { id: 'implementacion', title: 'Total Tickets Implementación', test: function (t) { return procesoNorm(t.proceso) === 'IMPLEMENTACION'; } },
    { id: 'mantenimiento', title: 'Total Tickets Mantenimiento', test: function (t) { return procesoNorm(t.proceso) === 'MANTENIMIENTO'; } }
  ];

  function buildResumen(tickets, filters) {
    filters = filters || {};
    tickets = Array.isArray(tickets) ? tickets : [];

    var hasCliente = hasClienteColumn(tickets);

    var dateFrom = filters.fechaDesde ? asUTCDate(filters.fechaDesde) : null;
    var dateTo = filters.fechaHasta ? asUTCDate(filters.fechaHasta) : null;
    var periodoYear = null, periodoMonth = null;
    if (filters.periodo && filters.periodo !== 'all') {
      var periodoParts = String(filters.periodo).split('-');
      periodoYear = parseInt(periodoParts[0], 10);
      periodoMonth = parseInt(periodoParts[1], 10);
    }

    // Day-granularity range compare (both ends truncated to UTC midnight),
    // same pattern buildActivos' own outsideRange() uses, AND-ed against the
    // independent Periodo month filter.
    function outsideResumenFilters(t) {
      if (dateFrom || dateTo) {
        if (!t.fecha) return true;
        var day = toUTCDateOnly(t.fecha).getTime();
        if (dateFrom && day < dateFrom.getTime()) return true;
        if (dateTo && day > dateTo.getTime()) return true;
      }
      if (periodoYear != null) {
        if (!t.fecha || t.fecha.getUTCFullYear() !== periodoYear || (t.fecha.getUTCMonth() + 1) !== periodoMonth) return true;
      }
      return false;
    }

    var filtered = tickets.filter(function (t) {
      if (outsideResumenFilters(t)) return false;
      if (filters.proceso && filters.proceso !== 'all' && t.proceso !== filters.proceso) return false;
      if (filters.producto && filters.producto !== 'all' && t.producto !== filters.producto) return false;
      return true;
    });

    // Every month present in the filtered universe -- shared x-axis for all
    // 4 sparklines, so they stay comparable to one another.
    var monthsSet = {};
    filtered.forEach(function (t) { if (t.mesKey) monthsSet[t.mesKey] = true; });
    var months = Object.keys(monthsSet).sort();

    var cards = RESUMEN_CARD_DEFS.map(function (def) {
      var matches = filtered.filter(def.test);
      var monthCounts = {};
      matches.forEach(function (t) { if (t.mesKey) monthCounts[t.mesKey] = (monthCounts[t.mesKey] || 0) + 1; });
      return {
        id: def.id,
        title: def.title,
        count: matches.length,
        monthlySeries: months.map(function (m) { return { mesKey: m, count: monthCounts[m] || 0 }; })
      };
    });

    // chart_top_clients: dimensión cliente, top 10 -- degrada a [] (con
    // hasCliente:false) cuando la columna Cliente no existe en el feed,
    // mismo patrón que buildActivos/buildSegundoNivel (hasClienteColumn()).
    var clienteCount = {};
    if (hasCliente) filtered.forEach(function (t) { clienteCount[t.cliente] = (clienteCount[t.cliente] || 0) + 1; });
    var topClientes = hasCliente
      ? sortedCounts(clienteCount).slice(0, 10).map(function (e) { return { label: e.label, count: e.value }; })
      : [];

    // chart_top_tier_2_agents: dimensión recursoSoporte (tal como pide el
    // spec, no recursoAccion), universo restringido a SEGUNDO_NIVEL_ACCIONES.
    var tier2Count = {};
    filtered.forEach(function (t) {
      if (SEGUNDO_NIVEL_ACCIONES.indexOf(t.accionNorm) === -1) return;
      tier2Count[t.recursoSoporte] = (tier2Count[t.recursoSoporte] || 0) + 1;
    });
    var topRecursosSegundoNivel = sortedCounts(tier2Count).slice(0, 10).map(function (e) { return { label: e.label, count: e.value }; });

    return {
      cards: cards,
      hasCliente: hasCliente,
      topClientes: topClientes,
      topRecursosSegundoNivel: topRecursosSegundoNivel
    };
  }

  /* ==================== Capacidad y Rendimiento ====================
     configuracion_jornada / logica_calculo_metricas / umbrales_semaforo from
     data.json, copied verbatim into these two constants so the numbers live
     in exactly one place — every calculation below derives from JORNADA/
     UMBRALES instead of repeating literals. */

  var JORNADA = {
    lunesAJueves: { capacidadNetaAgendableHoras: 7.6667 },
    viernes: { capacidadNetaAgendableHoras: 7.0 }
    // NOTE: data.json also prints capacidad_semanal_neta_horas = 37.6667 as a
    // reference weekly total. periodCapacity() does NOT use that field — it
    // multiplies the two per-day constants above (4 * 7.6667 + 7.0 = 37.6668),
    // which is 0.0001h higher. That's a rounding-order artifact already
    // present in data.json itself (37.6667 was computed from the unrounded
    // 23/3 = 7.6666..., not from the 4-decimal-rounded 7.6667), not a bug
    // here — see the "periodCapacity derives from the JORNADA constant" test.
  };

  // badgeClass values copied verbatim from especificacion_ui_dashboard.tabla_detalle.regla_badges
  // (spec v2) — the table/KPI badges use these Tailwind classes directly
  // instead of the inline hex-derived style spec v1 used.
  var UMBRALES = [
    { estado: 'Alta Disponibilidad', rangoMin: 0, rangoMax: 69.99, colorBadge: '#3B82F6', badgeClass: 'bg-blue-100 text-blue-800', descripcion: 'El recurso cuenta con espacio libre suficiente para nuevas asignaciones' },
    { estado: 'Óptimo', rangoMin: 70.0, rangoMax: 85.0, colorBadge: '#10B981', badgeClass: 'bg-green-100 text-green-800', descripcion: 'Rango ideal de ocupación operativa' },
    { estado: 'Límite', rangoMin: 85.01, rangoMax: 100.0, colorBadge: '#F59E0B', badgeClass: 'bg-yellow-100 text-yellow-800', descripcion: 'Capacidad casi completada, riesgo de saturación ante nuevos requerimientos' },
    { estado: 'Saturado', rangoMin: 100.01, rangoMax: null, colorBadge: '#EF4444', badgeClass: 'bg-red-100 text-red-800', descripcion: 'Horas asignadas exceden la capacidad neta disponible del periodo' }
  ];

  function round4(n) {
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
  }

  // "HH:MM" -> decimal hours. No format tolerance beyond that shape — the
  // feed only ever emits "HH:MM" or null for these columns.
  function parseHHMM(raw) {
    if (raw == null) return null;
    // Excel exports give "HH:MM"; the live OData feed gives "HH:MM:SS".
    var m = String(raw).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return parseInt(m[1], 10) + parseInt(m[2], 10) / 60 + (m[3] ? parseInt(m[3], 10) / 3600 : 0);
  }

  // Tiempo_de_llamada -> minutes. The live feed is mostly a plain-minutes
  // string ('60', '120', '180'), but ~1.5% of rows spell it out as free text
  // ('1 Hora', '2 Horas', 'N min'). Anything else (including '', null, and
  // the normalizeTickets 'Sin dato' fallback) is unparseable -> null, which
  // buildRecursoGauges treats as "no real-time data" for that ticket.
  function parseTiempoLlamada(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || s === 'Sin dato') return null;
    var numMatch = s.match(/^(\d+(?:\.\d+)?)$/);
    if (numMatch) return parseFloat(numMatch[1]);
    var horaMatch = s.match(/^(\d+(?:\.\d+)?)\s*Hora/i);
    if (horaMatch) return parseFloat(horaMatch[1]) * 60;
    var minMatch = s.match(/^(\d+(?:\.\d+)?)\s*min/i);
    if (minMatch) return parseFloat(minMatch[1]);
    return null;
  }

  function blockHours(startRaw, endRaw) {
    var start = parseHHMM(startRaw);
    var end = parseHHMM(endRaw);
    if (start == null || end == null) return null;
    if (end <= start) return null;
    return round4(end - start);
  }

  // ticketHours(ticket): ticket is a normalized ticket (from
  // normalizeTickets), so block 1 is already dated by fechaBloque1 and
  // block 3 by fechaBloque3 (Fecha_Entrega_Inicial -> Fecha_Soporte_Inicial
  // -> Fecha fallback, resolved once in normalizeTickets). A block only
  // counts when both ends are present and end > start; everything else
  // contributes 0, matching the many rows with no logged hours at all.
  function ticketHours(ticket) {
    var blocks = [];
    var h1 = blockHours(ticket.horaCalInicial, ticket.horaCalFinal);
    if (h1 != null) blocks.push({ date: ticket.fechaBloque1 || null, hours: h1 });
    var h3 = blockHours(ticket.horaCalInicial3, ticket.horaCalFinal3);
    if (h3 != null) blocks.push({ date: ticket.fechaBloque3 || null, hours: h3 });
    var total = round4(blocks.reduce(function (s, b) { return s + b.hours; }, 0));
    return { total: total, blocks: blocks };
  }

  function toUTCDateOnly(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  function localTodayAsUTC(d) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  // Accepts a Date, an ISO/DD-MM-YYYY string (via parseFecha), or a plain
  // "YYYY-MM-DD" <input type="date"> value (also matched by parseFecha's ISO
  // branch since the time part is optional).
  function asUTCDate(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : toUTCDateOnly(v);
    var parsed = parseFecha(v);
    return parsed ? toUTCDateOnly(parsed) : null;
  }

  function pad2b(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getUTCFullYear() + '-' + pad2b(d.getUTCMonth() + 1) + '-' + pad2b(d.getUTCDate()); }

  /* ==================== Colombian public holidays (Ley Emiliani) ====================
     Pure algorithm, no API/network — reglas_calendario_laboral in data.json.
     Three kinds of holiday, by how their date is fixed:
       - Fixed: same calendar date every year, never moved.
       - "Emiliani" (Ley 51 de 1983): a fixed calendar date, but the holiday
         is actually OBSERVED on the following Monday (or that same date, if
         it already falls on a Monday).
       - Easter-based: an offset in days from Easter Sunday. Three of these
         (Ascensión, Corpus Christi, Sagrado Corazón) are ALSO Emiliani-moved
         in the civil calendar, but the offsets below (+43/+64/+71) are
         already the final Monday-observed offsets — not the canonical
         liturgical ones (+39/+60/+68) — so no extra moveToMonday() step is
         needed for those three; see the "easterSunday computes..." test for
         how the offsets were derived against the known 2026 holiday list. */

  // Anonymous Gregorian algorithm (aka Meeus/Jones/Butcher) for the date of
  // Easter Sunday in the Gregorian calendar, valid for any year.
  function easterSunday(year) {
    var a = year % 19;
    var b = Math.floor(year / 100);
    var c = year % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var monthDay = h + l - 7 * m + 114;
    var month = Math.floor(monthDay / 31); // 3 = March, 4 = April
    var day = (monthDay % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  // Moves a date to the following Monday, or leaves it alone if it already
  // IS a Monday — the Ley Emiliani rule. (8 - dow) % 7 happens to give the
  // right answer for every day-of-week including Monday itself (dow=1 -> 0).
  function moveToMonday(date) {
    var d = toUTCDateOnly(date);
    var dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (8 - dow) % 7);
    return d;
  }

  var _holidayCache = {};

  // colombianHolidays(year) -> Set<'YYYY-MM-DD'> of that year's Colombian
  // public holidays. Cached per year (a Set is immutable from the outside
  // here, so sharing the instance across calls is safe).
  function colombianHolidays(year) {
    if (_holidayCache[year]) return _holidayCache[year];

    var set = new Set();
    function add(date) { set.add(isoDate(date)); }
    function addFixed(month, day) { add(new Date(Date.UTC(year, month - 1, day))); }
    function addEmiliani(month, day) { add(moveToMonday(new Date(Date.UTC(year, month - 1, day)))); }

    // Fixed (never moved).
    addFixed(1, 1);   // Año Nuevo
    addFixed(5, 1);   // Día del Trabajo
    addFixed(7, 20);  // Independencia
    addFixed(8, 7);   // Batalla de Boyacá
    addFixed(12, 8);  // Inmaculada Concepción
    addFixed(12, 25); // Navidad

    // Emiliani (moved to the following Monday if not already one).
    addEmiliani(1, 6);   // Reyes Magos
    addEmiliani(3, 19);  // San José
    addEmiliani(6, 29);  // San Pedro y San Pablo
    addEmiliani(8, 15);  // Asunción de la Virgen
    addEmiliani(10, 12); // Día de la Raza
    addEmiliani(11, 1);  // Todos los Santos
    addEmiliani(11, 11); // Independencia de Cartagena

    // Easter-based.
    var easter = easterSunday(year);
    function fromEaster(offsetDays) {
      var d = new Date(easter.getTime());
      d.setUTCDate(d.getUTCDate() + offsetDays);
      return d;
    }
    add(fromEaster(-3)); // Jueves Santo
    add(fromEaster(-2)); // Viernes Santo
    add(fromEaster(43)); // Ascensión (Monday-observed offset)
    add(fromEaster(64)); // Corpus Christi (Monday-observed offset)
    add(fromEaster(71)); // Sagrado Corazón (Monday-observed offset)

    _holidayCache[year] = set;
    return set;
  }

  // countWorkingDays(from, to): inclusive day-by-day count split into
  // Mon-Thu vs Fri. Weekends AND Colombian public holidays are excluded.
  function countWorkingDays(from, to) {
    var f = asUTCDate(from), t = asUTCDate(to);
    if (!f || !t || f.getTime() > t.getTime()) return { monThu: 0, fri: 0 };
    var monThu = 0, fri = 0;
    var cur = new Date(f.getTime());
    while (cur.getTime() <= t.getTime()) {
      var dow = cur.getUTCDay(); // 0=Sun .. 6=Sat
      if (dow !== 0 && dow !== 6 && !colombianHolidays(cur.getUTCFullYear()).has(isoDate(cur))) {
        if (dow >= 1 && dow <= 4) monThu++;
        else if (dow === 5) fri++;
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return { monThu: monThu, fri: fri };
  }

  // periodCapacity(from, to): net schedulable capacity for ONE resource over
  // the period = (#Mon-Thu days * JORNADA.lunesAJueves) + (#Fridays * JORNADA.viernes).
  function periodCapacity(from, to) {
    var wd = countWorkingDays(from, to);
    return round4(wd.monThu * JORNADA.lunesAJueves.capacidadNetaAgendableHoras + wd.fri * JORNADA.viernes.capacidadNetaAgendableHoras);
  }

  // capacityStatus(pct): band lookup equivalent to umbrales_semaforo's
  // rango_min/rango_max pairs (0-69.99 / 70-85 / 85.01-100 / >100), written
  // as half-open thresholds so the 85 vs 85.01 boundary never depends on
  // float equality against a *.01 literal.
  function capacityStatus(pct) {
    var p = Number(pct);
    if (!Number.isFinite(p)) p = 0;
    var band = p < 70 ? UMBRALES[0] : p <= 85 ? UMBRALES[1] : p <= 100 ? UMBRALES[2] : UMBRALES[3];
    return { estado: band.estado, color: band.colorBadge, badgeClass: band.badgeClass, descripcion: band.descripcion };
  }

  // Default period = "mes a la fecha" (month-to-date): the 1st of the
  // current month through today, both computed against the WHOLE dataset
  // passed in (not the recurso/proyecto-filtered subset) — capacity is only
  // ever counted up to `to`, so hour blocks dated after "now" never count
  // towards this default. `filters.now` is an internal test-only override
  // (Date, or a value asUTCDate() can parse); production call sites never
  // set it, so it's always `new Date()` at render time.
  //
  // Fallback: if the current month has zero hour-block activity at all
  // (nothing to show "month to date" for), fall back to the month containing
  // the latest hour block in the whole dataset (1st of that month -> that
  // block's own date) instead of the old whole-dataset-range default, which
  // could span well over a year and made % Utilización meaningless.
  function resolvePeriod(tickets, filters) {
    if (filters.from && filters.to) {
      var f = asUTCDate(filters.from), t = asUTCDate(filters.to);
      if (f && t) return { from: f, to: t };
    }

    // "Today" is the machine's local calendar date (Colombia, UTC-5), mapped
    // onto the UTC-only date model; using the UTC date would roll "today" to
    // tomorrow between 19:00 and midnight local time.
    var now = filters.now ? asUTCDate(filters.now) : localTodayAsUTC(new Date());
    var monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    var hasCurrentMonthActivity = false;
    tickets.forEach(function (t) {
      if (hasCurrentMonthActivity) return;
      ticketHours(t).blocks.forEach(function (b) {
        if (!b.date || hasCurrentMonthActivity) return;
        if (b.date.getTime() >= monthStart.getTime() && b.date.getTime() <= now.getTime()) hasCurrentMonthActivity = true;
      });
    });
    if (hasCurrentMonthActivity) return { from: monthStart, to: now };

    var max = null;
    tickets.forEach(function (t) {
      ticketHours(t).blocks.forEach(function (b) {
        if (!b.date) return;
        if (!max || b.date.getTime() > max.getTime()) max = b.date;
      });
    });
    if (!max) return { from: now, to: now }; // empty dataset — degenerate but harmless
    var maxMonthStart = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), 1));
    return { from: maxMonthStart, to: max };
  }

  // isAllSelector: true when a multi-select filter value means "no filter"
  // — undefined/empty, or the literal ["all"] the UI sends for its "Todos"
  // toggle state.
  function isAllSelector(arr) {
    return !Array.isArray(arr) || !arr.length || (arr.length === 1 && arr[0] === 'all');
  }

  // buildCapacidad(tickets, filters, extraRows): filters = { from, to,
  // recursos, cliente, proyecto }. tickets must already be normalized.
  // extraRows is an OPTIONAL array of { recurso, fecha, horas, fuente } from
  // the 4 extra OData sources (Tarea, Tarea con Revisión, Seguimiento
  // Cliente, Capacitación — see data-sources.js), each recurso already run
  // through normalizeRecurso() by the caller (app.js). Defaults to [] so
  // buildCapacidad(tickets, filters) keeps behaving exactly as before
  // (capacidad-multi-fuente-odata.md).
  //
  // ASSUMPTION (team definition): the team is every distinct normalized
  // Recurso_Soporte present in the WHOLE dataset (excluding the "Sin dato"
  // bucket), not only resources with tickets inside the selected period —
  // otherwise an idle resource with full free capacity would simply be
  // invisible instead of showing as available. The Recursos filter narrows
  // this team down to the selected resources. With extraRows, the team
  // extends to every distinct recurso across ALL 5 sources — a consultant
  // with only Capacitación hours and zero tickets must still appear in
  // porRecurso ("Team membership" rule in the spec).
  //
  // Cliente/Proyecto only narrow `rows` (Horas Agendadas and everything
  // derived from it), never the team/Capacidad Instalada — matching
  // tarjetas_kpi's own wording ("capacidad neta equipo según recursos
  // filtrados", i.e. capacity reacts to the Recursos filter only). The 4
  // extra sources have no Cliente/Proyecto columns, so their rows are
  // structurally exempt from those two filters (still subject to Recursos
  // and the Desde/Hasta period, exactly like ticket rows).
  function buildCapacidad(tickets, filters, extraRows) {
    filters = filters || {};
    tickets = Array.isArray(tickets) ? tickets : [];
    extraRows = Array.isArray(extraRows) ? extraRows : [];

    var period = resolvePeriod(tickets, filters);
    var from = period.from, to = period.to;

    var resolveExtra = buildExtraSourcesResolver(tickets, extraRows);
    function teamName(raw) { return resolveExtra ? resolveExtra(raw) : raw; }

    var teamSet = {};
    tickets.forEach(function (t) {
      var name = teamName(t.recursoSoporte);
      if (name && name !== 'Sin dato') teamSet[name] = true;
    });
    extraRows.forEach(function (r) {
      var name = teamName(r.recurso);
      if (name && name !== 'Sin dato') teamSet[name] = true;
    });
    var team = Object.keys(teamSet).sort();
    if (!isAllSelector(filters.recursos)) team = filters.recursos.filter(function (r) { return teamSet[r]; });

    // Cliente/Proyecto empty bucket is labelled "Sin proyecto" in this view
    // (Resumen's normalizeTickets already fills empty Proyecto as the
    // generic "Sin dato" — remapped here rather than duplicating
    // normalization just for this view's own label).
    function proyectoLabel(raw) { return raw && raw !== 'Sin dato' ? raw : 'Sin proyecto'; }

    var recursosFilter = isAllSelector(filters.recursos) ? null : filters.recursos;

    // Flatten every in-period, filter-matching hour block into rows carrying
    // the owning ticket's recurso/proyecto/fuente, so trend/porRecurso/
    // porProyecto all read from the same filtered set.
    var rows = [];
    tickets.forEach(function (t) {
      if (!t.recursoSoporte || t.recursoSoporte === 'Sin dato') return; // capacity excludes "Sin dato"
      var recurso = teamName(t.recursoSoporte);
      if (recursosFilter && recursosFilter.indexOf(recurso) === -1) return;
      if (filters.cliente && filters.cliente !== 'all' && t.cliente !== filters.cliente) return;
      var proyecto = proyectoLabel(t.proyecto);
      if (filters.proyecto && filters.proyecto !== 'all' && proyecto !== proyectoLabel(filters.proyecto)) return;
      ticketHours(t).blocks.forEach(function (b) {
        if (!b.date) return;
        if (b.date.getTime() < from.getTime() || b.date.getTime() > to.getTime()) return;
        rows.push({ recurso: recurso, proyecto: proyecto, date: b.date, hours: b.hours, fuente: 'Ticket' });
      });
    });

    // Extra sources (Tarea/Tarea con Revisión/Seguimiento Cliente/
    // Capacitación): no Cliente/Proyecto columns on these entities, so every
    // row lands in the generic "Sin proyecto" bucket and is structurally
    // exempt from the Cliente/Proyecto filters — still subject to Recursos
    // and the Desde/Hasta period, exactly like ticket rows.
    extraRows.forEach(function (r) {
      if (!r.recurso || r.recurso === 'Sin dato' || !r.fecha || !(r.horas > 0)) return;
      var recurso = teamName(r.recurso);
      if (recursosFilter && recursosFilter.indexOf(recurso) === -1) return;
      if (r.fecha.getTime() < from.getTime() || r.fecha.getTime() > to.getTime()) return;
      rows.push({ recurso: recurso, proyecto: 'Sin proyecto', date: r.fecha, hours: r.horas, fuente: r.fuente });
    });

    var capacidadPorRecurso = periodCapacity(from, to);
    var capacidadTotal = round4(capacidadPorRecurso * team.length);
    var reservadasTotal = round4(rows.reduce(function (s, r) { return s + r.hours; }, 0));
    var disponiblesTotal = round4(capacidadTotal - reservadasTotal);
    var pctTotal = capacidadTotal > 0 ? round4(reservadasTotal / capacidadTotal * 100) : 0;
    var estadoTotal = capacityStatus(pctTotal);

    var reservadasByRecurso = {};
    rows.forEach(function (r) { reservadasByRecurso[r.recurso] = (reservadasByRecurso[r.recurso] || 0) + r.hours; });
    var porRecurso = team.map(function (recurso) {
      var reservadas = round4(reservadasByRecurso[recurso] || 0);
      var disponibles = round4(Math.max(0, capacidadPorRecurso - reservadas));
      var saturadas = round4(Math.max(0, reservadas - capacidadPorRecurso));
      var pct = capacidadPorRecurso > 0 ? round4(reservadas / capacidadPorRecurso * 100) : 0;
      var estado = capacityStatus(pct);
      return {
        recurso: recurso, capacidad: capacidadPorRecurso, reservadas: reservadas,
        disponibles: disponibles, saturadas: saturadas, pct: pct,
        estado: estado.estado, color: estado.color, badgeClass: estado.badgeClass
      };
    }).sort(function (a, b) { return b.pct - a.pct; });

    var horasByProyecto = {};
    rows.forEach(function (r) { horasByProyecto[r.proyecto] = (horasByProyecto[r.proyecto] || 0) + r.hours; });
    var porProyecto = Object.keys(horasByProyecto)
      .sort(function (a, b) { return horasByProyecto[b] - horasByProyecto[a]; })
      .map(function (k) {
        var horas = round4(horasByProyecto[k]);
        var pct = reservadasTotal > 0 ? round4(horas / reservadasTotal * 100) : 0;
        return { proyecto: k, horas: horas, pct: pct };
      });

    return {
      kpis: {
        capacidad: capacidadTotal, reservadas: reservadasTotal, disponibles: disponiblesTotal,
        utilizacionPct: pctTotal, estado: estadoTotal.estado, color: estadoTotal.color,
        badgeClass: estadoTotal.badgeClass, descripcion: estadoTotal.descripcion
      },
      porRecurso: porRecurso,
      porProyecto: porProyecto,
      periodo: { from: isoDate(from), to: isoDate(to) }
    };
  }

  // buildRecursoGauges(tickets, filters): pure per-resource figures for the
  // two "tacómetro" gauges. filters = { recurso, from, to } — a self-
  // contained LOCAL filter set (spec v3's own Recurso + rango_fechas_local
  // under fila_tacometros), deliberately independent of the main filter
  // row's recursos/cliente/proyecto/from/to.
  //
  // "In period" for a ticket = it has at least one hour block dated inside
  // [from, to] (Tiempo_de_llamada is a ticket-level field, not per-block, so
  // there's no finer-grained date to check it against).
  function buildRecursoGauges(tickets, filters) {
    filters = filters || {};
    tickets = Array.isArray(tickets) ? tickets : [];
    var recurso = filters.recurso;
    var period = resolvePeriod(tickets, filters);
    var from = period.from, to = period.to;
    var capacidad = periodCapacity(from, to);

    var reservadas = 0;
    var tiempoRealMinutos = 0;
    var hasTiempoData = false;

    tickets.forEach(function (t) {
      if (t.recursoSoporte !== recurso) return;
      var inPeriodHours = 0;
      ticketHours(t).blocks.forEach(function (b) {
        if (!b.date) return;
        if (b.date.getTime() < from.getTime() || b.date.getTime() > to.getTime()) return;
        inPeriodHours += b.hours;
      });
      if (inPeriodHours <= 0) return;
      reservadas += inPeriodHours;
      var mins = parseTiempoLlamada(t.tiempoDeLlamada);
      if (mins != null) { tiempoRealMinutos += mins; hasTiempoData = true; }
    });

    reservadas = round4(reservadas);
    var tiempoRealHoras = round4(tiempoRealMinutos / 60);
    var pctProgramado = capacidad > 0 ? round4(reservadas / capacidad * 100) : 0;
    // No Tiempo_de_llamada logged for this resource in this period -> null
    // (not 0%), so the UI can render an empty gray gauge instead of a
    // misleading "0% real time" reading.
    var pctTiempoReal = (hasTiempoData && reservadas > 0) ? round4(tiempoRealHoras / reservadas * 100) : null;

    return {
      programado: { pct: pctProgramado, horas: reservadas, capacidad: capacidad },
      tiempoReal: { pct: pctTiempoReal, horasReales: tiempoRealHoras, horasProgramadas: reservadas, hasData: hasTiempoData }
    };
  }

  // buildRecursoTickets(tickets, filters, recurso, extraRows): the
  // ticket-level rows that back ONE resource's Reservadas figure from
  // buildCapacidad, for the "Detalle por Recurso" Power-BI-style drill-down.
  // filters = the SAME shape passed to buildCapacidad ({ from, to, cliente,
  // proyecto } — `recursos` is ignored here since the caller already knows
  // which row was clicked). extraRows is the SAME optional array
  // buildCapacidad accepts (defaults to []); when present, each matching
  // extra-source row becomes its own drill-down row (no Cliente/Proyecto/
  // Hora Inicial-Final/Tiempo Real/Prioridad — those columns don't exist on
  // those 4 entities), tagged with its own `fuente` so the modal can show
  // whether an hour came from a Ticket, Tarea, Tarea con Revisión,
  // Seguimiento Cliente or Capacitación. Mirrors buildCapacidad's own row-
  // collection logic exactly (same resolveExtra/teamName resolution, same
  // ticket-level cliente/proyecto gates, then per-block period check) so
  // `total` is guaranteed to equal that resource's porRecurso.reservadas.
  function buildRecursoTickets(tickets, filters, recurso, extraRows) {
    filters = filters || {};
    tickets = Array.isArray(tickets) ? tickets : [];
    extraRows = Array.isArray(extraRows) ? extraRows : [];
    var period = resolvePeriod(tickets, filters);
    var from = period.from, to = period.to;

    var resolveExtra = buildExtraSourcesResolver(tickets, extraRows);
    function teamName(raw) { return resolveExtra ? resolveExtra(raw) : raw; }

    function proyectoLabel(raw) { return raw && raw !== 'Sin dato' ? raw : 'Sin proyecto'; }
    function inPeriod(date) { return date && date.getTime() >= from.getTime() && date.getTime() <= to.getTime(); }

    var rows = [];
    tickets.forEach(function (t) {
      if (teamName(t.recursoSoporte) !== recurso) return;
      if (filters.cliente && filters.cliente !== 'all' && t.cliente !== filters.cliente) return;
      var proyecto = proyectoLabel(t.proyecto);
      if (filters.proyecto && filters.proyecto !== 'all' && proyecto !== proyectoLabel(filters.proyecto)) return;

      // Re-derive block 1 / block 3 explicitly by name (not via ticketHours()'s
      // positional blocks[] array) so the UI can show block 1's raw times as
      // the primary Hora Inicial/Final and block 3 as a separate hint, per
      // "Hora Inicial/Final show block 1 ... append a muted + bloque 3 hint".
      var h1 = blockHours(t.horaCalInicial, t.horaCalFinal);
      var h3 = blockHours(t.horaCalInicial3, t.horaCalFinal3);
      var block1InPeriod = h1 != null && inPeriod(t.fechaBloque1);
      var block3InPeriod = h3 != null && inPeriod(t.fechaBloque3);
      if (!block1InPeriod && !block3InPeriod) return; // ticket doesn't count in this period

      var horasConsumidas = round4((block1InPeriod ? h1 : 0) + (block3InPeriod ? h3 : 0));
      rows.push({
        id: t.id,
        fecha: block1InPeriod ? t.fechaBloque1 : t.fechaBloque3,
        cliente: t.cliente, // null while the Cliente column is absent -> UI shows "—"
        proyecto: proyecto,
        producto: t.producto,
        horaInicial: t.horaCalInicial || null,
        horaFinal: t.horaCalFinal || null,
        bloque3: block3InPeriod ? { inicio: t.horaCalInicial3, fin: t.horaCalFinal3 } : null,
        horasConsumidas: horasConsumidas,
        tiempoLlamadaReal: t.tiempoDeLlamada,
        prioridad: t.prioridadRaw || t.prioridad,
        fuente: 'Ticket'
      });
    });

    // Extra sources: one row per matching record, dated by the entity's own
    // "fecha inicial" field (see normalizeExtraRow in data-sources.js) — no
    // block/Cliente/Proyecto/Tiempo Real/Prioridad structure, so the UI
    // shows "—" for those columns on this row.
    extraRows.forEach(function (r) {
      if (teamName(r.recurso) !== recurso) return;
      if (!r.fecha || !(r.horas > 0) || !inPeriod(r.fecha)) return;
      rows.push({
        id: null,
        fecha: r.fecha,
        cliente: null,
        proyecto: 'Sin proyecto',
        producto: null,
        horaInicial: null,
        horaFinal: null,
        bloque3: null,
        horasConsumidas: round4(r.horas),
        tiempoLlamadaReal: null,
        prioridad: null,
        fuente: r.fuente
      });
    });

    rows.sort(function (a, b) { return (a.fecha ? a.fecha.getTime() : 0) - (b.fecha ? b.fecha.getTime() : 0); });
    var total = round4(rows.reduce(function (s, r) { return s + r.horasConsumidas; }, 0));
    return { rows: rows, total: total };
  }

  /* ==================== Tickets Activos ====================
     Business rules confirmed with the user (see test/mapper.test.js's
     "Tickets Activos" section and README.md's matching documentation
     section):
       - Universe: Estado == 1 (already coerced to a number by
         normalizeTickets/parseEstado) AND Accion (accionNorm, already
         trimmed/uppercased) != 'CREAR'. Estado == 2 means inactive; any
         other value is simply excluded from the universe.
       - Bucket Servicios / Bucket Calidad below -- ACTUALIZAR VERSION is
         accepted as an alias of ACTUALIZA VERSION. Any other active Accion
         counts toward kpis.total but neither bucket.
       - Every chart's resource dimension is Recurso_Accion (recursoAccion),
         not Recurso_Soporte / Recurso_Entrega_Final.
       - KPI aggregation is COUNT DISTINCT on ID (a Set per bucket, not a
         raw .length) -- defensive against a duplicate ID row rather than an
         expected shape of the feed. */

  var ACTIVOS_SERVICIOS_ACCIONES = ['REALIZAR', 'AGENDA ENTREGA FINAL', 'ENTREGA FINAL', 'CIERRE'];
  var ACTIVOS_CALIDAD_ACCIONES = ['REVISION EN PLANTA', 'REVISION CALIDAD', 'REVISION DEV', 'REVISION SOLUCION', 'ACTUALIZA VERSION', 'ACTUALIZAR VERSION'];

  // Per-bar color mapping for "Tickets Abiertos por Acción (General)",
  // copied verbatim from the UI spec. An active accion outside both buckets
  // above (counts toward the total only) falls back to the neutral gray.
  var ACTIVOS_ACCION_COLORS = {
    REALIZAR: '#2563EB',
    'ENTREGA FINAL': '#38BDF8',
    CIERRE: '#0EA5E9',
    'AGENDA ENTREGA FINAL': '#C084FC',
    'REVISION DEV': '#8B5CF6',
    'REVISION CALIDAD': '#A855F7',
    'REVISION SOLUCION': '#9333EA',
    'REVISION EN PLANTA': '#7E22CE',
    'ACTUALIZA VERSION': '#6D28D9',
    'ACTUALIZAR VERSION': '#6D28D9' // alias of ACTUALIZA VERSION, same color slot
  };
  var ACTIVOS_ACCION_COLOR_FALLBACK = '#94A3B8';

  // { label: count } -> [{label, value}], sorted desc by value -- shared by
  // every buildActivos series (recursosServicios/porCliente/porAccion/porProducto).
  function sortedCounts(counts) {
    return Object.keys(counts)
      .map(function (label) { return { label: label, value: counts[label] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // buildActivos(tickets, filters): filters = { fechaSoporteInicialFrom,
  // fechaSoporteInicialTo, fechaEntregaInicialFrom, fechaEntregaInicialTo,
  // requerimientos, recursos }. tickets must already be normalized.
  //   - filters.recursos: free multi-select over Recurso_Accion, isAllSelector
  //     semantics (empty/['all'] = no filter) -- same as Capacidad's Recursos
  //     and Segundo Nivel's own filters.recursos. Narrows `filtered` before
  //     the kpis/recursosServicios/porCliente/porAccion/porProducto/rows
  //     aggregation, so it affects the whole computed output at once.
  function buildActivos(tickets, filters) {
    filters = filters || {};
    tickets = Array.isArray(tickets) ? tickets : [];

    var hasCliente = hasClienteColumn(tickets);
    var hasRequerimiento = tickets.some(function (t) { return t.requerimientoOpcion !== null; });

    // Universe first (Estado + Accion), independent of the optional filters
    // below -- matches "filters apply on top of the universe" from the spec.
    var universe = tickets.filter(function (t) { return t.estado === 1 && t.accionNorm !== 'CREAR'; });

    // requerimientoOptions/recursoOptions reflect the whole active universe,
    // not narrowed by the currently applied filters (same "options don't
    // shrink as you filter" pattern as populateCapFilters' Recursos list in
    // render.js / buildSegundoNivel's own recursoOptions).
    var requerimientoOptions = hasRequerimiento
      ? Array.from(new Set(universe.map(function (t) { return t.requerimientoOpcion; }).filter(Boolean))).sort()
      : [];
    var recursoOptions = Array.from(new Set(universe.map(function (t) { return t.recursoAccion; }))).sort();

    var soporteFrom = filters.fechaSoporteInicialFrom ? asUTCDate(filters.fechaSoporteInicialFrom) : null;
    var soporteTo = filters.fechaSoporteInicialTo ? asUTCDate(filters.fechaSoporteInicialTo) : null;
    var entregaFrom = filters.fechaEntregaInicialFrom ? asUTCDate(filters.fechaEntregaInicialFrom) : null;
    var entregaTo = filters.fechaEntregaInicialTo ? asUTCDate(filters.fechaEntregaInicialTo) : null;
    var requerimientosFilter = isAllSelector(filters.requerimientos) ? null : filters.requerimientos;
    var recursosFilter = isAllSelector(filters.recursos) ? null : filters.recursos;

    // Compare by calendar day (both sides truncated to UTC midnight) so a
    // ticket stamped 14:30 on the "hasta" day is still inside the range.
    function outsideRange(date, from, to) {
      if (!from && !to) return false;
      if (!date) return true;
      var day = toUTCDateOnly(date).getTime();
      if (from && day < from.getTime()) return true;
      if (to && day > to.getTime()) return true;
      return false;
    }

    var filtered = universe.filter(function (t) {
      if (outsideRange(t.fechaSoporteInicial, soporteFrom, soporteTo)) return false;
      if (outsideRange(t.fechaEntregaInicial, entregaFrom, entregaTo)) return false;
      if (requerimientosFilter && requerimientosFilter.indexOf(t.requerimientoOpcion) === -1) return false;
      if (recursosFilter && recursosFilter.indexOf(t.recursoAccion) === -1) return false;
      return true;
    });

    var totalIds = new Set();
    var serviciosIds = new Set();
    var calidadIds = new Set();
    var recursosServiciosCount = {};
    var clienteCount = {};
    var accionCount = {};
    var productoCount = {};

    filtered.forEach(function (t) {
      totalIds.add(t.id);
      accionCount[t.accionNorm] = (accionCount[t.accionNorm] || 0) + 1;
      productoCount[t.producto] = (productoCount[t.producto] || 0) + 1;
      if (hasCliente) clienteCount[t.cliente] = (clienteCount[t.cliente] || 0) + 1;

      if (ACTIVOS_SERVICIOS_ACCIONES.indexOf(t.accionNorm) !== -1) {
        serviciosIds.add(t.id);
        recursosServiciosCount[t.recursoAccion] = (recursosServiciosCount[t.recursoAccion] || 0) + 1;
      } else if (ACTIVOS_CALIDAD_ACCIONES.indexOf(t.accionNorm) !== -1) {
        calidadIds.add(t.id);
      }
      // Any other active accion: counted in totalIds above, no bucket.
    });

    var porAccion = sortedCounts(accionCount).map(function (entry) {
      entry.color = ACTIVOS_ACCION_COLORS[entry.label] || ACTIVOS_ACCION_COLOR_FALLBACK;
      return entry;
    });

    // Per-ticket rows for the "Requerimientos de Primer Nivel" table -- every
    // ticket in `filtered` (post Recurso/date/requerimiento filters), same
    // shape/sort as buildSegundoNivel's own rows. asunto: t.asunto is always
    // null here (Asunto column confirmed absent from the real feed, same
    // graceful degradation Segundo Nivel already established) -> UI shows "—".
    var rows = filtered.map(function (t) {
      return {
        id: t.id,
        recursoAccion: t.recursoAccion,
        cliente: t.cliente, // null while the Cliente column is absent -> UI shows "—"
        producto: t.producto,
        accion: t.accionNorm,
        asunto: t.asunto
      };
    });
    rows.sort(function (a, b) { return String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); });

    return {
      kpis: { total: totalIds.size, servicios: serviciosIds.size, calidad: calidadIds.size },
      recursosServicios: sortedCounts(recursosServiciosCount),
      porCliente: hasCliente ? sortedCounts(clienteCount) : [],
      porAccion: porAccion,
      porProducto: sortedCounts(productoCount),
      hasCliente: hasCliente,
      hasRequerimiento: hasRequerimiento,
      requerimientoOptions: requerimientoOptions,
      recursoOptions: recursoOptions,
      rows: rows
    };
  }

  /* ==================== Segundo Nivel de Atención ====================
     Business rule confirmed with the user: the universe is every ticket
     where estado === 1 (same active gate Tickets Activos uses) AND
     accionNorm is one of the five values below -- the same list as
     ACTIVOS_CALIDAD_ACCIONES minus REVISION EN PLANTA, which the user did
     not include in this catalog. ACTUALIZAR VERSION stays as the existing
     alias of ACTUALIZA VERSION. */
  var SEGUNDO_NIVEL_ACCIONES = ['REVISION CALIDAD', 'REVISION DEV', 'REVISION SOLUCION', 'ACTUALIZA VERSION', 'ACTUALIZAR VERSION'];

  // Accion dropdown options collapse the ACTUALIZA VERSION / ACTUALIZAR
  // VERSION alias into a single selectable value (same real-world accion,
  // two feed spellings) -- mirrors the color-slot alias ACTIVOS_ACCION_COLORS
  // already uses for the same pair. `value` is what filters.accion carries;
  // `accionesNorm` is what it matches against accionNorm.
  var SEGUNDO_NIVEL_ACCION_OPTIONS = [
    { value: 'REVISION CALIDAD', accionesNorm: ['REVISION CALIDAD'] },
    { value: 'REVISION DEV', accionesNorm: ['REVISION DEV'] },
    { value: 'REVISION SOLUCION', accionesNorm: ['REVISION SOLUCION'] },
    { value: 'ACTUALIZAR VERSION', accionesNorm: ['ACTUALIZA VERSION', 'ACTUALIZAR VERSION'] }
  ];

  // Picks the highest-count entry from a { label: count } map, or null for
  // an empty map -- shared by the insight panel's "top producto/diagnóstico/
  // acción for this resource" fields.
  function topEntry(counts) {
    var sorted = sortedCounts(counts);
    return sorted.length ? sorted[0] : null;
  }

  // buildSegundoNivel(tickets, filters): filters = { recursos: string[],
  // accion: string, selectedResource: string|null }. tickets must already
  // be normalized.
  //   - filters.recursos: free multi-select over Recurso_Accion, isAllSelector
  //     semantics (empty/['all'] = no filter) -- same as Capacidad's Recursos.
  //   - filters.accion: one of SEGUNDO_NIVEL_ACCION_OPTIONS' values, or
  //     'all'/falsy for no narrowing (the universe is already confined to
  //     the five second-level acciones, so "all" never leaks outside it).
  //   - filters.selectedResource: set by the bar-click interaction on the
  //     Recurso_Accion chart -- narrows only `rows`/`insight` below, never
  //     the charts themselves (clicking a bar highlights/filters the table,
  //     it doesn't make the other bars disappear).
  function buildSegundoNivel(tickets, filters) {
    filters = filters || {};
    tickets = Array.isArray(tickets) ? tickets : [];

    var hasCliente = hasClienteColumn(tickets);
    var hasDiagnostico = tickets.some(function (t) { return t.diagnostico !== null; });

    var universe = tickets.filter(function (t) {
      return t.estado === 1 && SEGUNDO_NIVEL_ACCIONES.indexOf(t.accionNorm) !== -1;
    });

    // recursoOptions reflects the whole second-level universe, not narrowed
    // by the currently applied filters -- same "options don't shrink as you
    // filter" pattern as buildActivos' requerimientoOptions.
    var recursoOptions = Array.from(new Set(universe.map(function (t) { return t.recursoAccion; }))).sort();

    var recursosFilter = isAllSelector(filters.recursos) ? null : filters.recursos;
    var accionGroup = null;
    if (filters.accion && filters.accion !== 'all') {
      accionGroup = SEGUNDO_NIVEL_ACCION_OPTIONS.find(function (o) { return o.value === filters.accion; }) || null;
    }

    var filtered = universe.filter(function (t) {
      if (recursosFilter && recursosFilter.indexOf(t.recursoAccion) === -1) return false;
      if (accionGroup && accionGroup.accionesNorm.indexOf(t.accionNorm) === -1) return false;
      return true;
    });

    var recursoCount = {};
    var clienteCount = {};
    var productoCount = {};
    var diagnosticoCount = {};
    filtered.forEach(function (t) {
      recursoCount[t.recursoAccion] = (recursoCount[t.recursoAccion] || 0) + 1;
      productoCount[t.producto] = (productoCount[t.producto] || 0) + 1;
      if (hasCliente) clienteCount[t.cliente] = (clienteCount[t.cliente] || 0) + 1;
      if (hasDiagnostico) diagnosticoCount[t.diagnostico] = (diagnosticoCount[t.diagnostico] || 0) + 1;
    });

    // Table + insight panel: filtered further narrowed by the bar-click
    // selection, per the division of labor documented above.
    var tableTickets = filters.selectedResource
      ? filtered.filter(function (t) { return t.recursoAccion === filters.selectedResource; })
      : filtered;

    var rows = tableTickets.map(function (t) {
      return {
        id: t.id,
        recurso: t.recursoAccion,
        cliente: t.cliente, // null while the Cliente column is absent -> UI shows "—"
        producto: t.producto,
        accion: t.accionNorm,
        asunto: t.asunto // null while the Asunto column is absent -> UI shows "—"
      };
    });
    rows.sort(function (a, b) { return String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); });

    var insight = null;
    if (filters.selectedResource) {
      var insightProductoCount = {};
      var insightDiagnosticoCount = {};
      var insightAccionCount = {};
      tableTickets.forEach(function (t) {
        insightProductoCount[t.producto] = (insightProductoCount[t.producto] || 0) + 1;
        insightAccionCount[t.accionNorm] = (insightAccionCount[t.accionNorm] || 0) + 1;
        if (hasDiagnostico) insightDiagnosticoCount[t.diagnostico] = (insightDiagnosticoCount[t.diagnostico] || 0) + 1;
      });
      insight = {
        recurso: filters.selectedResource,
        total: tableTickets.length,
        topProducto: topEntry(insightProductoCount),
        topDiagnostico: hasDiagnostico ? topEntry(insightDiagnosticoCount) : null,
        topAccion: topEntry(insightAccionCount)
      };
    }

    return {
      kpis: { total: filtered.length },
      porRecurso: sortedCounts(recursoCount),
      porCliente: hasCliente ? sortedCounts(clienteCount).slice(0, 10) : [],
      porProducto: sortedCounts(productoCount),
      porDiagnostico: hasDiagnostico ? sortedCounts(diagnosticoCount) : [],
      hasCliente: hasCliente,
      hasDiagnostico: hasDiagnostico,
      recursoOptions: recursoOptions,
      accionOptions: SEGUNDO_NIVEL_ACCION_OPTIONS.map(function (o) { return o.value; }),
      rows: rows,
      insight: insight
    };
  }

  /* ==================== Dual Node/browser export ====================
     Same pattern as the reference project's mapper.js: attach to
     window in the browser, export via module.exports under Node (so
     test/mapper.test.js can require() this file directly). */
  var _root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  var SOFIA_MAPPER = {
    detectColumns: detectColumns,
    findAliasColumn: findAliasColumn,
    parseFecha: parseFecha,
    monthKey: monthKey,
    toTitleCase: toTitleCase,
    normalizeRecurso: normalizeRecurso,
    groupPrioridad: groupPrioridad,
    normalizeTickets: normalizeTickets,
    buildResumen: buildResumen,
    hasClienteColumn: hasClienteColumn,
    PRODUCTO_COLORS: PRODUCTO_COLORS,
    PRODUCTO_COLOR_OTROS: PRODUCTO_COLOR_OTROS,
    JORNADA: JORNADA,
    UMBRALES: UMBRALES,
    parseHHMM: parseHHMM,
    parseTiempoLlamada: parseTiempoLlamada,
    ticketHours: ticketHours,
    easterSunday: easterSunday,
    colombianHolidays: colombianHolidays,
    countWorkingDays: countWorkingDays,
    periodCapacity: periodCapacity,
    capacityStatus: capacityStatus,
    buildCapacidad: buildCapacidad,
    buildRecursoGauges: buildRecursoGauges,
    buildRecursoTickets: buildRecursoTickets,
    buildActivos: buildActivos,
    buildSegundoNivel: buildSegundoNivel
  };
  _root.SOFIA_MAPPER = SOFIA_MAPPER;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOFIA_MAPPER;
})();
