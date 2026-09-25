(function () {
  'use strict';

  // Capacidad y Rendimiento's 4 extra OData sources (Tarea, Tarea con
  // Revisión, Seguimiento Cliente, Capacitación), unified with Tickets so
  // "Horas Reservadas" reflects ALL time a consultant has booked, not just
  // support tickets — see odd/tasks/capacidad-multi-fuente-odata.md. Same
  // dual Node/browser export pattern as mapper.js (require()'s mapper.js
  // under Node for parseFecha/parseHHMM; window.SOFIA_MAPPER in the
  // browser), so normalizeExtraRow can be unit-tested from
  // test/mapper.test.js without a browser.

  var _root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  var _isNode = (typeof module !== 'undefined' && !!module.exports);
  var M = _isNode ? require('./mapper.js') : _root.SOFIA_MAPPER;

  // Template OData names, campo recurso, fechas y horas confirmados por el
  // usuario (tabla "Confirmed OData entities" del spec). Fecha_Incio es un
  // typo real de la columna en el feed en vivo (Tarea con revisión), no un
  // error de tipeo aquí -- verificar contra el feed real antes de tocarlo.
  var CAPACIDAD_EXTRA_SOURCES = [
    {
      key: 'tarea',
      fuente: 'Tarea',
      templateName: 'ID12097_Plantilla_tarea',
      recursoField: 'Recurso',
      fechaInicialField: 'Fecha_Inicial',
      horaInicialField: 'Hora_Cal_Inicial',
      horaFinalField: 'Hora_Cal_Final'
    },
    {
      key: 'tareaConRevision',
      fuente: 'Tarea con Revisión',
      templateName: 'ID12096_Plantilla_tarea_con_rev',
      recursoField: 'Funcionario_que_Resuelve',
      // Sic: real column name typo confirmed against the live OData feed
      // (unlike the other three sources' "Fecha_Inicial") -- see
      // odd/tasks/capacidad-multi-fuente-odata.md.
      fechaInicialField: 'Fecha_Incio',
      horaInicialField: 'Hora_Cal_Inicial',
      horaFinalField: 'Hora_Cal_Final'
    },
    {
      key: 'seguimientoCliente',
      fuente: 'Seguimiento Cliente',
      templateName: 'ID12098_Plantilla_seguimiento_c',
      recursoField: 'Responsable_de_Seguimiento',
      fechaInicialField: 'Fecha_Inicial',
      horaInicialField: 'Hora_Cal_Inicial',
      horaFinalField: 'Hora_Cal_Final'
    },
    {
      key: 'capacitacion',
      fuente: 'Capacitación',
      templateName: 'ID12095_Plantilla_capacitacion',
      recursoField: '_Colaborador_en_formacion',
      fechaInicialField: 'Fecha_Inicial',
      horaInicialField: 'Hora_Cal_Inicial',
      horaFinalField: 'Hora_Cal_Final'
    }
  ];

  function round4(n) {
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
  }

  // normalizeExtraRow(raw, sourceDef): single hour-block per row (these 4
  // entities carry no bloque 3), same formula as mapper.js's ticketHours
  // block 1 -- Hora_Cal_Final - Hora_Cal_Inicial when both are present and
  // final > inicial, dated by the entity's own "fecha inicial" field.
  // recursoRaw is intentionally NOT run through normalizeRecurso here -- the
  // caller (app.js) does that, then buildCapacidad/buildRecursoTickets
  // (mapper.js) resolve accent/casing variants across the union of all 5
  // sources (see buildExtraSourcesResolver), which this function has no
  // visibility into on its own.
  function normalizeExtraRow(raw, sourceDef) {
    raw = raw || {};
    var recursoRaw = raw[sourceDef.recursoField];
    var fecha = M.parseFecha(raw[sourceDef.fechaInicialField]);
    var start = M.parseHHMM(raw[sourceDef.horaInicialField]);
    var end = M.parseHHMM(raw[sourceDef.horaFinalField]);
    var horas = (start != null && end != null && end > start) ? round4(end - start) : 0;
    return { recursoRaw: recursoRaw, fecha: fecha, horas: horas, fuente: sourceDef.fuente };
  }

  // fetchExtraSource(endpointUrl, sourceDef): builds the entity's full URL
  // (endpointUrl + '/' + templateName) via SOFIA_ODATA.buildTemplateUrl,
  // appends $select with only the ~4 needed columns to keep payload small
  // (no $filter by date -- see "Fetch cadence" in the spec), and calls it
  // through the same /odata-proxy?url=... path fetchTemplate() already uses
  // for Tickets (host-allowlisted + signed server-side, server.js never
  // changes).
  async function fetchExtraSource(endpointUrl, sourceDef) {
    var O = _root.SOFIA_ODATA;
    var selectFields = [sourceDef.recursoField, sourceDef.fechaInicialField, sourceDef.horaInicialField, sourceDef.horaFinalField];
    var url = O.buildTemplateUrl(endpointUrl, sourceDef.templateName) + '&$select=' + encodeURIComponent(selectFields.join(','));
    var data = await O.getJson('/api/odata-proxy?url=' + encodeURIComponent(url));
    return O.toRows(data).map(function (row) { return normalizeExtraRow(row, sourceDef); });
  }

  // fetchAllExtraSources(endpointUrl): fetches the 4 sources ONE AT A TIME,
  // not Promise.all -- the upstream OData host (bpm.webapidashboard...)
  // cannot handle concurrent requests under the same credentials: firing
  // Tickets + the 4 extras together was measured to time out 2 of the 5
  // requests at the 20s proxy limit (confirmed by reproducing
  // actualizarDatos()'s original concurrent fetch against the live
  // endpoint), even though each request is fast in isolation. Sequential
  // fetching is slower end-to-end but reliable; this only runs on the
  // manual "Actualizar Datos" click, which already shows a loading state.
  // Still tolerates individual failures -- a single source timing out or
  // erroring must not blank out the whole Capacidad view (Degradation rule
  // in the spec). Returns the union of every successful source's rows plus
  // the list of fuente labels that failed, so the UI can show a small
  // non-blocking notice instead of silently under-reporting.
  async function fetchAllExtraSources(endpointUrl) {
    var rows = [];
    var failedSources = [];
    for (var i = 0; i < CAPACIDAD_EXTRA_SOURCES.length; i++) {
      var sourceDef = CAPACIDAD_EXTRA_SOURCES[i];
      try {
        rows = rows.concat(await fetchExtraSource(endpointUrl, sourceDef));
      } catch (err) {
        console.error('[data-sources] Error cargando ' + sourceDef.fuente + ':', err);
        failedSources.push(sourceDef.fuente);
      }
    }
    return { rows: rows, failedSources: failedSources };
  }

  var SOFIA_DATA_SOURCES = {
    CAPACIDAD_EXTRA_SOURCES: CAPACIDAD_EXTRA_SOURCES,
    normalizeExtraRow: normalizeExtraRow,
    fetchExtraSource: fetchExtraSource,
    fetchAllExtraSources: fetchAllExtraSources
  };
  _root.SOFIA_DATA_SOURCES = SOFIA_DATA_SOURCES;
  if (_isNode) module.exports = SOFIA_DATA_SOURCES;
})();
