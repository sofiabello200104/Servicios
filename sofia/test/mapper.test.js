'use strict';

// Tests for assets/js/mapper.js, written BEFORE the implementation (strict TDD).
// Run with: node test/mapper.test.js  (uses Node's built-in test runner, no deps)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mapper = require(path.join('..', 'assets', 'js', 'mapper.js'));
const dataSources = require(path.join('..', 'assets', 'js', 'data-sources.js'));

/* ==================== parseFecha: format coverage ==================== */

test('parseFecha parses OData v2 /Date(ms)/ format as UTC', () => {
  // 1700000000000 ms epoch -> 2023-11-14T22:13:20.000Z
  const d = mapper.parseFecha('/Date(1700000000000)/');
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), 1700000000000);
});

test('parseFecha parses ISO date-time strings as UTC', () => {
  const d = mapper.parseFecha('2026-03-15T14:30:00');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 2); // March = index 2
  assert.equal(d.getUTCDate(), 15);
  assert.equal(d.getUTCHours(), 14);
  assert.equal(d.getUTCMinutes(), 30);
});

test('parseFecha parses DD/MM/YYYY strings as UTC', () => {
  const d = mapper.parseFecha('25/12/2025');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 11); // December = index 11
  assert.equal(d.getUTCDate(), 25);
});

test('parseFecha returns null for empty/unparseable input', () => {
  assert.equal(mapper.parseFecha(null), null);
  assert.equal(mapper.parseFecha(''), null);
  assert.equal(mapper.parseFecha('not a date'), null);
});

/* ==================== day-1-of-month timezone-shift bug ==================== */
// The classic bug: new Date('2026-03-01') in a UTC-negative local timezone
// renders as Feb 28/29 when later read with local getters. Our parser must
// build dates via Date.UTC(...) and callers must read them back with the
// UTC getters, so day 1 never shifts to the previous/next month.

test('parseFecha does not shift day 1 of month (ISO)', () => {
  const d = mapper.parseFecha('2026-01-01T00:00:00');
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 0);
  assert.equal(d.getUTCDate(), 1);
});

test('parseFecha does not shift day 1 of month (DD/MM/YYYY)', () => {
  const d = mapper.parseFecha('01/09/2026');
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 8); // September = index 8
  assert.equal(d.getUTCDate(), 1);
});

test('monthKey formats a UTC date as YYYY-MM without drift on day 1', () => {
  const d = mapper.parseFecha('2026-12-01T00:00:00');
  assert.equal(mapper.monthKey(d), '2026-12');
});

/* ==================== Title Case normalization ==================== */

test('toTitleCase merges duplicate-cased names into the same value', () => {
  const a = mapper.toTitleCase('PAOLA ANDREA MACIAS ROJAS');
  const b = mapper.toTitleCase('Paola Andrea Macias Rojas');
  const c = mapper.toTitleCase('paola andrea macias rojas');
  assert.equal(a, 'Paola Andrea Macias Rojas');
  assert.equal(a, b);
  assert.equal(b, c);
});

/* ==================== Priority grouping ==================== */

test('groupPrioridad groups by leading number+word', () => {
  assert.equal(
    mapper.groupPrioridad('3-Prioritario (Atendido en 16 horas hábiles)'),
    '3-Prioritario'
  );
  assert.equal(mapper.groupPrioridad('1-Critico (1 Hora hábil)'), '1-Critico');
  assert.equal(
    mapper.groupPrioridad('10-Visita / Implementación (Programación)'),
    '10-Visita'
  );
  assert.equal(
    mapper.groupPrioridad('5-Evolutivo/Sugerencia (algo)'),
    '5-Evolutivo/Sugerencia'
  );
});

test('groupPrioridad falls back to Sin dato for empty input', () => {
  assert.equal(mapper.groupPrioridad(''), 'Sin dato');
  assert.equal(mapper.groupPrioridad(null), 'Sin dato');
});

/* ==================== normalizeTickets ==================== */

test('normalizeTickets fills empty/null fields with Sin dato', () => {
  const rows = [
    {
      ID: 1, Fecha: '2026-03-01T00:00:00', Accion: 'CIERRE', Producto: '',
      Proyecto: null, Proceso: '', Recurso_Soporte: '', Recurso_Entrega_Final: '',
      Prioridad_del_Servicio_ANS: '', Tiempo_empleado_entrega: '', Tiempo_de_llamada: ''
    }
  ];
  const [t] = mapper.normalizeTickets(rows);
  assert.equal(t.producto, 'Sin dato');
  assert.equal(t.proyecto, 'Sin dato');
  assert.equal(t.proceso, 'Sin dato');
  assert.equal(t.recursoSoporte, 'Sin dato');
  assert.equal(t.prioridad, 'Sin dato');
});

test('normalizeTickets Title-Cases Recurso_Soporte so duplicates merge', () => {
  const rows = [
    { ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'PAOLA ANDREA MACIAS ROJAS' },
    { ID: 2, Fecha: '2026-01-06T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'Paola Andrea Macias Rojas' }
  ];
  const tickets = mapper.normalizeTickets(rows);
  assert.equal(tickets[0].recursoSoporte, tickets[1].recursoSoporte);
  assert.equal(tickets[0].recursoSoporte, 'Paola Andrea Macias Rojas');
});

/* ==================== buildResumen (rediseño, ver odd/tasks/resumen-rediseno.md) ====================
   Reemplaza por completo el buildResumen anterior (Año/Mes+Proceso+Producto,
   KPIs cerrados/backlog, 5 gráficos + tabla) por el spec pegado por el
   usuario: 4 tarjetas KPI con sparkline mensual, 2 top-10 (clientes /
   recursos de segundo nivel), filtros Rango de Fechas + Periodo + Proceso +
   Producto combinados con AND. */

function resumenFixtureTickets() {
  const rows = [
    { ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'CIERRE',           Producto: 'NOMINA WEB',       Proceso: 'Mantenimiento',   Recurso_Soporte: 'Ana Perez',   Estado: '1', Cliente: 'Cliente A' },
    { ID: 2, Fecha: '2026-01-10T00:00:00', Accion: 'REALIZAR',         Producto: 'NOMINA WEB',       Proceso: 'Mantenimiento',   Recurso_Soporte: 'Ana Perez',   Estado: '1', Cliente: 'Cliente A' },
    { ID: 3, Fecha: '2026-02-01T00:00:00', Accion: 'REVISION CALIDAD', Producto: 'CONTABILIDAD WEB', Proceso: 'Implementación', Recurso_Soporte: 'Luis Gomez',  Estado: '1', Cliente: 'Cliente B' },
    { ID: 4, Fecha: '2026-02-15T00:00:00', Accion: 'REVISION EN PLANTA', Producto: 'CONTABILIDAD WEB', Proceso: 'Implementación', Recurso_Soporte: 'Luis Gomez', Estado: '2', Cliente: 'Cliente B' },
    { ID: 5, Fecha: '2026-02-20T00:00:00', Accion: 'ACTUALIZAR VERSION', Producto: 'PRESUPUESTO WEB', Proceso: 'Mantenimiento', Recurso_Soporte: 'Maria Lopez', Estado: '1', Cliente: 'Cliente A' },
    { ID: 6, Fecha: '2026-03-01T00:00:00', Accion: 'REVISION DEV',     Producto: 'NOMINA WEB',       Proceso: 'Implementación', Recurso_Soporte: 'Maria Lopez', Estado: '1', Cliente: 'Cliente C' },
    { ID: 7, Fecha: '2026-03-05T00:00:00', Accion: 'REVISION SOLUCION', Producto: 'NOMINA WEB',      Proceso: 'Implementación', Recurso_Soporte: 'Luis Gomez',  Estado: '2', Cliente: 'Cliente D' }
  ];
  return mapper.normalizeTickets(rows);
}

test('buildResumen cards: activos/calidad/implementacion/mantenimiento with exact conditions', () => {
  const tickets = resumenFixtureTickets();
  const resumen = mapper.buildResumen(tickets, {});
  const byId = Object.fromEntries(resumen.cards.map((c) => [c.id, c]));
  // activos = estado === 1 (decisión confirmada con el usuario): filas 1,2,3,5,6
  assert.equal(byId.activos.count, 5);
  // calidad = ACTIVOS_CALIDAD_ACCIONES (mismo bucket que Primer Nivel de Atención): filas 3,4,5,6,7
  assert.equal(byId.calidad.count, 5);
  // implementacion = Proceso normalizado === IMPLEMENTACION: filas 3,4,6,7
  assert.equal(byId.implementacion.count, 4);
  // mantenimiento = Proceso normalizado === MANTENIMIENTO: filas 1,2,5
  assert.equal(byId.mantenimiento.count, 3);
});

test('buildResumen calidad card applies only its own condition, not the activos estado===1 gate', () => {
  const tickets = resumenFixtureTickets();
  const resumen = mapper.buildResumen(tickets, {});
  const calidad = resumen.cards.find((c) => c.id === 'calidad');
  // La fila 4 (REVISION EN PLANTA) tiene Estado '2' y aun así cuenta para Calidad.
  assert.equal(calidad.count, 5);
});

test('buildResumen implementacion/mantenimiento cards normalize Proceso accents and case', () => {
  const rows = [
    { ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'CIERRE', Proceso: 'IMPLEMENTACION' },
    { ID: 2, Fecha: '2026-01-06T00:00:00', Accion: 'CIERRE', Proceso: 'mantenimiento' }
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildResumen(tickets, {});
  const byId = Object.fromEntries(resumen.cards.map((c) => [c.id, c]));
  assert.equal(byId.implementacion.count, 1);
  assert.equal(byId.mantenimiento.count, 1);
});

test('buildResumen each card exposes a monthly series (sparkline) matching its own count', () => {
  const tickets = resumenFixtureTickets();
  const resumen = mapper.buildResumen(tickets, {});
  const activos = resumen.cards.find((c) => c.id === 'activos');
  const total = activos.monthlySeries.reduce((s, m) => s + m.count, 0);
  assert.equal(total, activos.count);
  assert.deepEqual(activos.monthlySeries.map((m) => m.mesKey), ['2026-01', '2026-02', '2026-03']);
});

test('buildResumen returns zero counts and empty series when filters match nothing', () => {
  const tickets = resumenFixtureTickets();
  const resumen = mapper.buildResumen(tickets, { proceso: 'NoExiste' });
  resumen.cards.forEach((c) => {
    assert.equal(c.count, 0);
    assert.deepEqual(c.monthlySeries, []);
  });
  assert.deepEqual(resumen.topClientes, []);
  assert.deepEqual(resumen.topRecursosSegundoNivel, []);
});

test('buildResumen topClientes: top 10 by cliente with counts', () => {
  const tickets = resumenFixtureTickets();
  const resumen = mapper.buildResumen(tickets, {});
  const byLabel = Object.fromEntries(resumen.topClientes.map((c) => [c.label, c.count]));
  // normalizeCliente() upper-cases client names (organisations, not people).
  assert.equal(byLabel['CLIENTE A'], 3);
  assert.equal(byLabel['CLIENTE B'], 2);
  assert.equal(byLabel['CLIENTE C'], 1);
  assert.equal(byLabel['CLIENTE D'], 1);
  assert.equal(resumen.hasCliente, true);
});

test('buildResumen topClientes degrades to an empty array when the Cliente column is absent (hasClienteColumn)', () => {
  const rows = [{ ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'CIERRE', Producto: 'X', Proceso: 'Mantenimiento', Recurso_Soporte: 'Ana Perez' }];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildResumen(tickets, {});
  assert.equal(resumen.hasCliente, false);
  assert.deepEqual(resumen.topClientes, []);
});

test('buildResumen topRecursosSegundoNivel: dimension recursoSoporte, filtered to SEGUNDO_NIVEL_ACCIONES', () => {
  const tickets = resumenFixtureTickets();
  const resumen = mapper.buildResumen(tickets, {});
  const byLabel = Object.fromEntries(resumen.topRecursosSegundoNivel.map((r) => [r.label, r.count]));
  assert.equal(byLabel['Luis Gomez'], 2); // filas 3 (Revision Calidad) y 7 (Revision Solucion)
  assert.equal(byLabel['Maria Lopez'], 2); // filas 5 (Actualizar Version) y 6 (Revision Dev)
  assert.equal(byLabel['Ana Perez'], undefined); // sin tickets de segundo nivel en el fixture
});

test('buildResumen topRecursosSegundoNivel excludes REVISION EN PLANTA (bucket Calidad, no Segundo Nivel)', () => {
  const rows = [
    { ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'REVISION EN PLANTA', Recurso_Soporte: 'Solo Planta' },
    { ID: 2, Fecha: '2026-01-06T00:00:00', Accion: 'REVISION DEV', Recurso_Soporte: 'Dev Person' }
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildResumen(tickets, {});
  const byLabel = Object.fromEntries(resumen.topRecursosSegundoNivel.map((r) => [r.label, r.count]));
  assert.equal(byLabel['Solo Planta'], undefined);
  assert.equal(byLabel['Dev Person'], 1);
});

test('buildResumen combines Rango de Fechas + Periodo + Proceso + Producto filters with AND', () => {
  const tickets = resumenFixtureTickets();

  // Periodo restringe a Febrero 2026 (filas 3,4,5) -> activos (estado===1): filas 3,5 = 2.
  const byPeriodo = mapper.buildResumen(tickets, { periodo: '2026-02' });
  assert.equal(byPeriodo.cards.find((c) => c.id === 'activos').count, 2);

  // Periodo 2026-02 AND rango 10..28 feb -> intersecta a filas 4,5 -> calidad (ambas califican) = 2.
  const combined = mapper.buildResumen(tickets, { periodo: '2026-02', fechaDesde: '2026-02-10', fechaHasta: '2026-02-28' });
  assert.equal(combined.cards.find((c) => c.id === 'calidad').count, 2);

  // Proceso + Producto AND -> filas 1,2 (Mantenimiento + NOMINA WEB) -> activos = 2.
  const byProcesoProducto = mapper.buildResumen(tickets, { proceso: 'Mantenimiento', producto: 'NOMINA WEB' });
  assert.equal(byProcesoProducto.cards.find((c) => c.id === 'activos').count, 2);
});

/* ==================== Capacidad y Rendimiento (TDD) ==================== */
/* Tests written before the implementation — see mapper.js for
   parseHHMM/ticketHours/countWorkingDays/periodCapacity/capacityStatus/
   buildCapacidad. */

/* -------- parseHHMM -------- */

test('parseHHMM parses "HH:MM" into decimal hours', () => {
  assert.equal(mapper.parseHHMM('08:00'), 8);
  assert.equal(mapper.parseHHMM('08:30'), 8.5);
  assert.equal(mapper.parseHHMM('17:15'), 17.25);
});

test('parseHHMM accepts the live OData "HH:MM:SS" format', () => {
  assert.equal(mapper.parseHHMM('16:00:00'), 16);
  assert.equal(mapper.parseHHMM('08:30:00'), 8.5);
  assert.equal(mapper.parseHHMM('08:00:30'), 8 + 30 / 3600);
});

test('ticketHours works on a live OData row (HH:MM:SS times, ISO dates with -05:00 offset)', () => {
  const [t] = mapper.normalizeTickets([{
    ID: 1, Fecha: '2025-11-11T15:29:13.603-05:00', Accion: 'REALIZAR', Producto: 'X', Proyecto: '',
    Proceso: 'Mantenimiento', Recurso_Soporte: 'Ana Perez',
    Fecha_Soporte_Inicial: '2026-03-24T00:00:00-05:00', Fecha_Soporte_Final: '2026-03-24T00:00:00-05:00',
    Hora_Cal_Inicial: '16:00:00', Hora_Cal_Final: '17:00:00', Hora_Cal_Inicial_3: null, Hora_Cal_Final_3: null,
    Fecha_Entrega_Inicial: null, Fecha_Entrega_Final: null, Prioridad_del_Servicio_ANS: '3-Prioritario (Atendido en 16 horas hábiles)'
  }]);
  const h = mapper.ticketHours(t);
  assert.equal(h.total, 1);
  assert.equal(h.blocks.length, 1);
  assert.equal(h.blocks[0].date.toISOString().slice(0, 10), '2026-03-24');
});

test('parseHHMM returns null for null/empty/malformed input', () => {
  assert.equal(mapper.parseHHMM(null), null);
  assert.equal(mapper.parseHHMM(undefined), null);
  assert.equal(mapper.parseHHMM(''), null);
  assert.equal(mapper.parseHHMM('not-a-time'), null);
});

/* -------- ticketHours -------- */

function rawTicketWithHours(overrides) {
  return Object.assign({
    ID: 1, Fecha: '2026-03-02T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'Ana Perez',
    Proyecto: null, Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Fecha_Entrega_Inicial: null,
    Hora_Cal_Inicial: null, Hora_Cal_Final: null, Hora_Cal_Inicial_3: null, Hora_Cal_Final_3: null
  }, overrides);
}

test('ticketHours sums both blocks when both are present and valid', () => {
  const [t] = mapper.normalizeTickets([rawTicketWithHours({
    Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:30',
    Hora_Cal_Inicial_3: '14:00', Hora_Cal_Final_3: '15:00',
    Fecha_Entrega_Inicial: '2026-03-03T00:00:00'
  })]);
  const h = mapper.ticketHours(t);
  assert.equal(h.total, 2.5); // 1.5h + 1h
  assert.equal(h.blocks.length, 2);
  assert.equal(h.blocks[0].hours, 1.5);
  assert.equal(h.blocks[0].date.getUTCDate(), 2); // dated by Fecha_Soporte_Inicial
  assert.equal(h.blocks[1].hours, 1);
  assert.equal(h.blocks[1].date.getUTCDate(), 3); // dated by Fecha_Entrega_Inicial
});

test('ticketHours ignores a missing block and only counts the present one', () => {
  const [t] = mapper.normalizeTickets([rawTicketWithHours({ Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '12:00' })]);
  const h = mapper.ticketHours(t);
  assert.equal(h.total, 4);
  assert.equal(h.blocks.length, 1);
});

test('ticketHours ignores a block whose end is not after its start', () => {
  const [t] = mapper.normalizeTickets([rawTicketWithHours({ Hora_Cal_Inicial: '12:00', Hora_Cal_Final: '12:00' })]);
  assert.equal(mapper.ticketHours(t).total, 0);
  const [t2] = mapper.normalizeTickets([rawTicketWithHours({ Hora_Cal_Inicial: '13:00', Hora_Cal_Final: '12:00' })]);
  assert.equal(mapper.ticketHours(t2).total, 0);
});

test('ticketHours returns total 0 with no blocks when both are absent', () => {
  const [t] = mapper.normalizeTickets([rawTicketWithHours({})]);
  const h = mapper.ticketHours(t);
  assert.equal(h.total, 0);
  assert.equal(h.blocks.length, 0);
});

/* -------- countWorkingDays / periodCapacity -------- */

test('countWorkingDays counts Mon-Thu and Fri separately across a known week', () => {
  const wd = mapper.countWorkingDays('2026-03-02', '2026-03-08'); // Mon..Sun
  assert.equal(wd.monThu, 4);
  assert.equal(wd.fri, 1);
});

test('periodCapacity derives from the JORNADA constant (not a second hardcoded copy)', () => {
  // 4 * 7.6667 + 1 * 7.0 = 37.6668. This is 0.0001h off the 37.6667 weekly
  // figure data.json prints under configuracion_jornada.capacidad_semanal_neta_horas
  // -- that figure was computed from the *unrounded* 23/3 and only rounded at
  // the end, while periodCapacity() multiplies the already-4-decimal-rounded
  // JORNADA.lunesAJueves value (also copied verbatim from data.json) by 4.
  // Documented deviation, not a bug.
  const cap = mapper.periodCapacity('2026-03-02', '2026-03-08');
  assert.equal(cap, 37.6668);
});

/* -------- capacityStatus -------- */

test('capacityStatus bands match umbrales_semaforo, including boundaries', () => {
  assert.equal(mapper.capacityStatus(69.99).estado, 'Alta Disponibilidad');
  assert.equal(mapper.capacityStatus(70).estado, 'Óptimo');
  assert.equal(mapper.capacityStatus(85).estado, 'Óptimo');
  assert.equal(mapper.capacityStatus(85.01).estado, 'Límite');
  assert.equal(mapper.capacityStatus(100).estado, 'Límite');
  assert.equal(mapper.capacityStatus(100.01).estado, 'Saturado');
  assert.equal(mapper.capacityStatus(69.99).color, '#3B82F6');
  assert.equal(mapper.capacityStatus(70).color, '#10B981');
  assert.equal(mapper.capacityStatus(85.01).color, '#F59E0B');
  assert.equal(mapper.capacityStatus(100.01).color, '#EF4444');
});

/* -------- buildCapacidad -------- */

test('buildCapacidad computes capacidad/reservadas/pct/estado and shows idle resources at 0', () => {
  const rows = [
    rawTicketWithHours({
      ID: 1, Recurso_Soporte: 'Ana Perez', Proyecto: 'Proyecto A',
      Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '12:00' // 4h on Mon 2026-03-02
    }),
    // Luis Gomez has a ticket in the dataset but no hour blocks -> idle resource,
    // must still show up in porRecurso with 0 reservadas (team = every distinct
    // Recurso_Soporte in the dataset, not just those with logged hours).
    rawTicketWithHours({ ID: 2, Recurso_Soporte: 'Luis Gomez', Proyecto: 'Proyecto B' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02' });

  // 1 Monday => monThu=1 => periodCapacity = 7.6667h per resource; team of 2.
  assert.equal(resumen.kpis.capacidad, 15.3334);
  assert.equal(resumen.kpis.reservadas, 4);
  assert.equal(resumen.kpis.disponibles, 11.3334);
  assert.equal(resumen.kpis.utilizacionPct, +(4 / 15.3334 * 100).toFixed(4));
  assert.equal(resumen.kpis.estado, 'Alta Disponibilidad');

  const byRecurso = Object.fromEntries(resumen.porRecurso.map((r) => [r.recurso, r]));
  assert.equal(byRecurso['Ana Perez'].reservadas, 4);
  assert.equal(byRecurso['Ana Perez'].capacidad, 7.6667);
  assert.equal(byRecurso['Luis Gomez'].reservadas, 0);
  assert.equal(byRecurso['Luis Gomez'].capacidad, 7.6667);
  assert.equal(byRecurso['Luis Gomez'].estado, 'Alta Disponibilidad');
});

/* -------- buildCapacidad: default period = "mes a la fecha" -------- */

test('buildCapacidad defaults to month-to-date (1st of current month -> now) when the current month has hour-block activity', () => {
  const rows = [
    rawTicketWithHours({
      ID: 1, Fecha_Soporte_Inicial: '2026-03-05T00:00:00',
      Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00'
    })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildCapacidad(tickets, { now: '2026-03-15' });
  assert.equal(resumen.periodo.from, '2026-03-01');
  assert.equal(resumen.periodo.to, '2026-03-15');
});

test('buildCapacidad falls back to the latest hour block\'s own month when the current month has no activity', () => {
  const rows = [
    rawTicketWithHours({
      ID: 1, Fecha_Soporte_Inicial: '2026-01-20T00:00:00',
      Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00'
    })
  ];
  const tickets = mapper.normalizeTickets(rows);
  // "now" = 2026-03-15, but March has zero hour-block activity -> fall back
  // to the month containing the latest block in the whole dataset (January).
  const resumen = mapper.buildCapacidad(tickets, { now: '2026-03-15' });
  assert.equal(resumen.periodo.from, '2026-01-01');
  assert.equal(resumen.periodo.to, '2026-01-20');
});

test('buildCapacidad only counts capacity/hours up to "now" in the month-to-date default', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Fecha_Soporte_Inicial: '2026-03-05T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00' }),
    // This block falls AFTER "now" and must not count towards the default period.
    rawTicketWithHours({ ID: 2, Fecha_Soporte_Inicial: '2026-03-20T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildCapacidad(tickets, { now: '2026-03-15' });
  assert.equal(resumen.kpis.reservadas, 2); // only the 2026-03-05 block
});

/* -------- normalizeTickets: diacritic-insensitive resource grouping -------- */

test('normalizeTickets merges accent-variant spellings of the same resource, keeping the most frequent variant', () => {
  const rows = [
    { ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'Lina María Peralta' },
    { ID: 2, Fecha: '2026-01-06T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'Lina Maria Peralta' },
    { ID: 3, Fecha: '2026-01-07T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'LINA MARIA PERALTA' }
  ];
  const tickets = mapper.normalizeTickets(rows);
  const distinct = new Set(tickets.map((t) => t.recursoSoporte));
  assert.equal(distinct.size, 1);
  assert.equal(tickets[0].recursoSoporte, 'Lina Maria Peralta'); // most frequent variant (2 of 3 rows)
});

test('normalizeTickets does not merge genuinely different spellings (real typos are not diacritic variants)', () => {
  const rows = [
    { ID: 1, Fecha: '2026-01-05T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'Ruben Dario Cantor Villarreal' },
    { ID: 2, Fecha: '2026-01-06T00:00:00', Accion: 'CIERRE', Recurso_Soporte: 'Ruben Dario Cantor Villrreal' }
  ];
  const tickets = mapper.normalizeTickets(rows);
  assert.notEqual(tickets[0].recursoSoporte, tickets[1].recursoSoporte);
});

/* ==================== Spec v2: Cliente column ==================== */

test('hasClienteColumn detects the Cliente column when present, and reports false when absent', () => {
  const withCliente = mapper.normalizeTickets([rawTicketWithHours({ ID: 1, Cliente: 'Acme' })]);
  assert.equal(mapper.hasClienteColumn(withCliente), true);
  assert.equal(withCliente[0].cliente, 'ACME');

  const withoutCliente = mapper.normalizeTickets([rawTicketWithHours({ ID: 1 })]);
  assert.equal(mapper.hasClienteColumn(withoutCliente), false);
  assert.equal(withoutCliente[0].cliente, null);
});

test('normalizeTickets maps an empty Cliente value to "Sin cliente" when the column exists', () => {
  const tickets = mapper.normalizeTickets([rawTicketWithHours({ ID: 1, Cliente: '' })]);
  assert.equal(tickets[0].cliente, 'Sin cliente');
});

test('normalizeTickets upper-cases Cliente and collapses whitespace so case variants merge', () => {
  const tickets = mapper.normalizeTickets([
    rawTicketWithHours({ ID: 1, Cliente: 'UNIVERSIDAD DE LA AMAZONIA' }),
    rawTicketWithHours({ ID: 2, Cliente: 'Universidad de la Amazonia' }),
    rawTicketWithHours({ ID: 3, Cliente: '  Empresa De  Servicios Publicos ' }),
    rawTicketWithHours({ ID: 4, Cliente: 'Empresa de Servicios Publicos' }),
    rawTicketWithHours({ ID: 5, Cliente: 'EMPRESAS PÚBLICAS DE NEIVA E.S.P.' })
  ]);
  assert.equal(tickets[0].cliente, 'UNIVERSIDAD DE LA AMAZONIA');
  assert.equal(tickets[1].cliente, tickets[0].cliente);
  assert.equal(tickets[2].cliente, 'EMPRESA DE SERVICIOS PUBLICOS');
  assert.equal(tickets[3].cliente, tickets[2].cliente);
  assert.equal(tickets[4].cliente, 'EMPRESAS PÚBLICAS DE NEIVA E.S.P.');
});

test('normalizeTickets maps known Cliente spelling variants to one canonical name via CLIENTE_ALIASES', () => {
  const tickets = mapper.normalizeTickets([
    rawTicketWithHours({ ID: 1, Cliente: 'HIDROELÉCTRICA ITUANGO S.A. E.S.P.' }),
    rawTicketWithHours({ ID: 2, Cliente: 'E.S.P. Hidroeléctrica Ituango S.A. - HIDROITUANGO S.A. E.S.P' })
  ]);
  assert.equal(tickets[0].cliente, 'HIDROELÉCTRICA ITUANGO S.A. E.S.P.');
  assert.equal(tickets[1].cliente, tickets[0].cliente);
});

/* ==================== Spec v2: badgeClass (Tailwind) ==================== */

test('capacityStatus returns the Tailwind badge classes from tabla_detalle.regla_badges', () => {
  assert.equal(mapper.capacityStatus(50).badgeClass, 'bg-blue-100 text-blue-800');
  assert.equal(mapper.capacityStatus(75).badgeClass, 'bg-green-100 text-green-800');
  assert.equal(mapper.capacityStatus(90).badgeClass, 'bg-yellow-100 text-yellow-800');
  assert.equal(mapper.capacityStatus(120).badgeClass, 'bg-red-100 text-red-800');
});

test('buildCapacidad porRecurso rows and kpis carry the same badgeClass as capacityStatus', () => {
  const tickets = mapper.normalizeTickets([rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez' })]);
  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02' });
  assert.equal(resumen.kpis.badgeClass, 'bg-blue-100 text-blue-800');
  assert.equal(resumen.porRecurso[0].badgeClass, 'bg-blue-100 text-blue-800');
});

/* ==================== Spec v2: buildCapacidad recursos[]/cliente filters ==================== */

test('buildCapacidad filters by a recursos array (multiple selected resources) and narrows the team accordingly', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00' }),
    rawTicketWithHours({ ID: 2, Recurso_Soporte: 'Luis Gomez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' }),
    rawTicketWithHours({ ID: 3, Recurso_Soporte: 'Marta Diaz' }) // idle, excluded by the recursos filter
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02', recursos: ['Ana Perez', 'Luis Gomez'] });
  assert.equal(resumen.porRecurso.length, 2);
  assert.equal(resumen.kpis.reservadas, 3); // 2h + 1h
  const names = resumen.porRecurso.map((r) => r.recurso).sort();
  assert.deepEqual(names, ['Ana Perez', 'Luis Gomez']);
});

test('buildCapacidad treats an empty or ["all"] recursos array as no filter', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez' }),
    rawTicketWithHours({ ID: 2, Recurso_Soporte: 'Luis Gomez' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const withEmpty = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02', recursos: [] });
  const withAll = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02', recursos: ['all'] });
  assert.equal(withEmpty.porRecurso.length, 2);
  assert.equal(withAll.porRecurso.length, 2);
});

test('buildCapacidad filters rows by cliente (narrows reservadas only, team/capacity unaffected)', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Cliente: 'Acme', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00' }),
    rawTicketWithHours({ ID: 2, Recurso_Soporte: 'Ana Perez', Cliente: 'Globex', Hora_Cal_Inicial: '10:00', Hora_Cal_Final: '11:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02', cliente: 'ACME' });
  assert.equal(resumen.kpis.reservadas, 2); // only the Acme block
  assert.equal(resumen.porRecurso.length, 1);
  assert.equal(resumen.porRecurso[0].capacidad, 7.6667); // capacity untouched by the cliente filter
});

/* ==================== Spec v2: parseTiempoLlamada ==================== */

test('parseTiempoLlamada parses plain-minute strings, "N Hora(s)" and "N min", and rejects garbage', () => {
  assert.equal(mapper.parseTiempoLlamada('60'), 60);
  assert.equal(mapper.parseTiempoLlamada('120'), 120);
  assert.equal(mapper.parseTiempoLlamada('180'), 180);
  assert.equal(mapper.parseTiempoLlamada('1 Hora'), 60);
  assert.equal(mapper.parseTiempoLlamada('2 Horas'), 120);
  assert.equal(mapper.parseTiempoLlamada('90 min'), 90);
  assert.equal(mapper.parseTiempoLlamada(''), null);
  assert.equal(mapper.parseTiempoLlamada(null), null);
  assert.equal(mapper.parseTiempoLlamada('garbage'), null);
});

/* ==================== Spec v2: buildRecursoGauges ==================== */
/* Spec v3 changed the signature to (tickets, filters) where filters embeds
   `recurso` alongside `from`/`to` — the gauges now have their OWN local
   Desde/Hasta filter (independent of the main filter row's from/to), so
   `recurso` can't stay a separate positional argument once the caller needs
   to pass a filters object it fully controls either way. */

test('buildRecursoGauges computes programado % and tiempoReal % for one resource in a period', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '12:00', Tiempo_de_llamada: '180' }) // 4h, 180min=3h real
  ];
  const tickets = mapper.normalizeTickets(rows);
  const g = mapper.buildRecursoGauges(tickets, { recurso: 'Ana Perez', from: '2026-03-02', to: '2026-03-02' });
  assert.equal(g.programado.horas, 4);
  assert.equal(g.programado.capacidad, 7.6667);
  assert.equal(g.programado.pct, +(4 / 7.6667 * 100).toFixed(4));
  assert.equal(g.tiempoReal.horasReales, 3);
  assert.equal(g.tiempoReal.horasProgramadas, 4);
  assert.equal(g.tiempoReal.pct, +(3 / 4 * 100).toFixed(4));
  assert.equal(g.tiempoReal.hasData, true);
});

test('buildRecursoGauges reports hasData:false when the resource has no Tiempo_de_llamada in the period', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00', Tiempo_de_llamada: null })];
  const tickets = mapper.normalizeTickets(rows);
  const g = mapper.buildRecursoGauges(tickets, { recurso: 'Ana Perez', from: '2026-03-02', to: '2026-03-02' });
  assert.equal(g.tiempoReal.hasData, false);
  assert.equal(g.tiempoReal.pct, null);
});

test('buildRecursoGauges uses periodCapacity, which is holiday-aware', () => {
  // 2026-07-20 is Independencia (Emiliani-unmoved: falls on a Monday itself)
  // -- capacity for that Mon-Sun week is 3 Mon-Thu (Tue/Wed/Thu) + 1 Fri.
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Fecha_Soporte_Inicial: '2026-07-21T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })];
  const tickets = mapper.normalizeTickets(rows);
  const g = mapper.buildRecursoGauges(tickets, { recurso: 'Ana Perez', from: '2026-07-20', to: '2026-07-26' });
  assert.equal(g.programado.capacidad, mapper.periodCapacity('2026-07-20', '2026-07-26'));
  assert.equal(g.programado.capacidad, +(3 * 7.6667 + 7.0).toFixed(4));
});

/* ==================== Spec v3: Colombian holidays (Ley Emiliani) ==================== */

test('easterSunday computes the correct Easter Sunday for 2025, 2026 and 2027', () => {
  const e2025 = mapper.easterSunday(2025);
  assert.equal(e2025.getUTCMonth(), 3); // April
  assert.equal(e2025.getUTCDate(), 20);

  const e2026 = mapper.easterSunday(2026);
  assert.equal(e2026.getUTCMonth(), 3);
  assert.equal(e2026.getUTCDate(), 5);

  const e2027 = mapper.easterSunday(2027);
  assert.equal(e2027.getUTCMonth(), 2); // March
  assert.equal(e2027.getUTCDate(), 28);
});

test('colombianHolidays returns exactly the 18 expected 2026 holidays', () => {
  const holidays = mapper.colombianHolidays(2026);
  const expected = [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
    '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
    '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25'
  ];
  assert.equal(holidays.size, 18);
  expected.forEach((d) => assert.ok(holidays.has(d), 'missing ' + d));
});

test('colombianHolidays caches per year (same Set instance on repeat calls)', () => {
  assert.equal(mapper.colombianHolidays(2026), mapper.colombianHolidays(2026));
  assert.notEqual(mapper.colombianHolidays(2026), mapper.colombianHolidays(2025));
});

test('countWorkingDays/periodCapacity skip Colombian holidays', () => {
  // 2026-07-20 (Mon) is Independencia -- excluded even though it's a weekday.
  // Week 2026-07-20..26: Mon(holiday) Tue Wed Thu Fri Sat Sun -> 3 monThu + 1 fri.
  const wd = mapper.countWorkingDays('2026-07-20', '2026-07-26');
  assert.equal(wd.monThu, 3);
  assert.equal(wd.fri, 1);
  const cap = mapper.periodCapacity('2026-07-20', '2026-07-26');
  assert.equal(cap, +(3 * 7.6667 + 1 * 7.0).toFixed(4));
});

/* ==================== Spec v3: buildRecursoTickets (drill-down) ==================== */

test('buildRecursoTickets returns per-ticket rows whose total equals the parent porRecurso reservadas', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Producto: 'NOMINA WEB', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:00' }),
    rawTicketWithHours({ ID: 2, Recurso_Soporte: 'Ana Perez', Producto: 'CONTABILIDAD WEB', Fecha_Soporte_Inicial: '2026-03-03T00:00:00', Hora_Cal_Inicial: '09:00', Hora_Cal_Final: '11:30' }),
    rawTicketWithHours({ ID: 3, Recurso_Soporte: 'Luis Gomez', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const filters = { from: '2026-03-01', to: '2026-03-05' };
  const capacidad = mapper.buildCapacidad(tickets, filters);
  const anaReservadas = capacidad.porRecurso.find((r) => r.recurso === 'Ana Perez').reservadas;

  const drill = mapper.buildRecursoTickets(tickets, filters, 'Ana Perez');
  assert.equal(drill.rows.length, 2);
  assert.equal(drill.total, anaReservadas);
  assert.equal(drill.rows[0].id, 1); // sorted by Fecha (block date) asc
  assert.equal(drill.rows[1].id, 2);
  assert.equal(drill.rows[0].horasConsumidas, 2);
  assert.equal(drill.rows[1].horasConsumidas, 2.5);
});

test('buildRecursoTickets only counts tickets with a block dated inside the period, and respects cliente/proyecto', () => {
  const rows = [
    rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Cliente: 'Acme', Proyecto: 'Proyecto A', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' }),
    rawTicketWithHours({ ID: 2, Recurso_Soporte: 'Ana Perez', Cliente: 'Globex', Proyecto: 'Proyecto B', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '09:00', Hora_Cal_Final: '10:00' }),
    rawTicketWithHours({ ID: 3, Recurso_Soporte: 'Ana Perez', Fecha_Soporte_Inicial: '2026-04-15T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' }) // out of period
  ];
  const tickets = mapper.normalizeTickets(rows);
  const drill = mapper.buildRecursoTickets(tickets, { from: '2026-03-01', to: '2026-03-31', cliente: 'ACME' }, 'Ana Perez');
  assert.equal(drill.rows.length, 1);
  assert.equal(drill.rows[0].id, 1);
});

test('buildRecursoTickets surfaces block 3 as a separate hint when it also contributes', () => {
  const rows = [rawTicketWithHours({
    ID: 1, Recurso_Soporte: 'Ana Perez', Fecha_Soporte_Inicial: '2026-03-02T00:00:00',
    Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00',
    Hora_Cal_Inicial_3: '14:00', Hora_Cal_Final_3: '15:30', Fecha_Entrega_Inicial: '2026-03-02T00:00:00'
  })];
  const tickets = mapper.normalizeTickets(rows);
  const drill = mapper.buildRecursoTickets(tickets, { from: '2026-03-01', to: '2026-03-31' }, 'Ana Perez');
  assert.equal(drill.rows.length, 1);
  assert.equal(drill.rows[0].horasConsumidas, 2.5); // 1h + 1.5h
  assert.equal(drill.rows[0].horaInicial, '08:00');
  assert.equal(drill.rows[0].horaFinal, '09:00');
  assert.deepEqual(drill.rows[0].bloque3, { inicio: '14:00', fin: '15:30' });
});

test('buildRecursoTickets shows cliente as null when the column is absent (UI renders "—")', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })];
  const tickets = mapper.normalizeTickets(rows);
  const drill = mapper.buildRecursoTickets(tickets, { from: '2026-03-01', to: '2026-03-31' }, 'Ana Perez');
  assert.equal(drill.rows[0].cliente, null);
});

/* ==================== Capacidad multi-fuente OData (extraRows) ====================
   Tests for the extension that unifies Capacidad y Rendimiento's "Horas
   Reservadas" across Tickets + 4 extra OData sources (Tarea, Tarea con
   Revisión, Seguimiento Cliente, Capacitación) -- see
   odd/tasks/capacidad-multi-fuente-odata.md. extraRows = [{ recurso, fecha,
   horas, fuente }], already run through normalizeRecurso() by the caller
   (app.js), exactly like buildCapacidad/buildRecursoTickets expect. */

function extraRow(overrides) {
  return Object.assign({
    recurso: 'Ana Perez', fecha: mapper.parseFecha('2026-03-02'), horas: 2, fuente: 'Tarea'
  }, overrides);
}

/* -------- normalizeExtraRow (data-sources.js) -------- */

test('normalizeExtraRow computes hours as Hora_Cal_Final - Hora_Cal_Inicial, dated by the entity\'s own Fecha_Inicial (same formula as ticketHours block 1)', () => {
  const sourceDef = dataSources.CAPACIDAD_EXTRA_SOURCES.find((s) => s.key === 'tarea');
  const row = dataSources.normalizeExtraRow({
    Recurso: 'Ana Perez', Fecha_Inicial: '2026-03-05T00:00:00',
    Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '10:30'
  }, sourceDef);
  assert.equal(row.recursoRaw, 'Ana Perez');
  assert.equal(row.fecha.getUTCDate(), 5);
  assert.equal(row.horas, 2.5);
  assert.equal(row.fuente, 'Tarea');
});

test('normalizeExtraRow uses Fecha_Incio for Tarea con Revisión (real column-name typo confirmed on the live feed, not a bug here)', () => {
  const sourceDef = dataSources.CAPACIDAD_EXTRA_SOURCES.find((s) => s.key === 'tareaConRevision');
  const row = dataSources.normalizeExtraRow({
    Funcionario_que_Resuelve: 'Luis Gomez', Fecha_Incio: '2026-03-06T00:00:00',
    Hora_Cal_Inicial: '09:00', Hora_Cal_Final: '11:00'
  }, sourceDef);
  assert.equal(row.recursoRaw, 'Luis Gomez');
  assert.equal(row.fecha.getUTCDate(), 6);
  assert.equal(row.horas, 2);
});

test('normalizeExtraRow returns horas:0 when a bound is missing or end is not after start (no block, same rule as ticketHours)', () => {
  const sourceDef = dataSources.CAPACIDAD_EXTRA_SOURCES.find((s) => s.key === 'tarea');
  const missing = dataSources.normalizeExtraRow({ Recurso: 'Ana Perez', Fecha_Inicial: '2026-03-05', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: null }, sourceDef);
  assert.equal(missing.horas, 0);
  const equalBounds = dataSources.normalizeExtraRow({ Recurso: 'Ana Perez', Fecha_Inicial: '2026-03-05', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '08:00' }, sourceDef);
  assert.equal(equalBounds.horas, 0);
  const inverted = dataSources.normalizeExtraRow({ Recurso: 'Ana Perez', Fecha_Inicial: '2026-03-05', Hora_Cal_Inicial: '10:00', Hora_Cal_Final: '09:00' }, sourceDef);
  assert.equal(inverted.horas, 0);
});

test('normalizeExtraRow handles a completely empty raw row without throwing', () => {
  const sourceDef = dataSources.CAPACIDAD_EXTRA_SOURCES.find((s) => s.key === 'capacitacion');
  const row = dataSources.normalizeExtraRow({}, sourceDef);
  assert.equal(row.recursoRaw, undefined);
  assert.equal(row.fecha, null);
  assert.equal(row.horas, 0);
  assert.equal(row.fuente, 'Capacitación');
});

/* -------- buildCapacidad with extraRows -------- */

test('buildCapacidad: a resource with only extraRows hours (zero tickets) still appears in porRecurso', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '12:00' })]; // 4h
  const tickets = mapper.normalizeTickets(rows);
  const extra = [extraRow({ recurso: 'Carla Nieto', fecha: mapper.parseFecha('2026-03-02'), horas: 3, fuente: 'Capacitación' })];

  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02' }, extra);
  const byRecurso = Object.fromEntries(resumen.porRecurso.map((r) => [r.recurso, r]));
  assert.ok(byRecurso['Carla Nieto'], 'Carla Nieto (extraRows-only) must appear in porRecurso');
  assert.equal(byRecurso['Carla Nieto'].reservadas, 3);
  assert.equal(byRecurso['Ana Perez'].reservadas, 4);
});

test('buildCapacidad: extraRows hours add to an existing ticket resource\'s reservadas and to the team total', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '12:00' })]; // 4h
  const tickets = mapper.normalizeTickets(rows);
  const extra = [extraRow({ recurso: 'Ana Perez', fecha: mapper.parseFecha('2026-03-02'), horas: 1.5, fuente: 'Tarea' })];

  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02' }, extra);
  const ana = resumen.porRecurso.find((r) => r.recurso === 'Ana Perez');
  assert.equal(ana.reservadas, 5.5);
  assert.equal(resumen.kpis.reservadas, 5.5);
});

test('buildCapacidad: extraRows contributions are NOT dropped by the Cliente/Proyecto filters (structurally exempt, no Cliente/Proyecto columns)', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Cliente: 'ACME', Proyecto: 'Proyecto A', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })]; // 1h
  const tickets = mapper.normalizeTickets(rows);
  const extra = [extraRow({ recurso: 'Ana Perez', fecha: mapper.parseFecha('2026-03-02'), horas: 2, fuente: 'Capacitación' })];

  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02', cliente: 'Globex', proyecto: 'Otro Proyecto' }, extra);
  const ana = resumen.porRecurso.find((r) => r.recurso === 'Ana Perez');
  // Ticket's 1h is dropped (cliente/proyecto mismatch); extraRows' 2h still counts.
  assert.equal(ana.reservadas, 2);
});

test('buildCapacidad: extraRows are still subject to the Recursos filter and the Desde/Hasta period', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })]; // 1h
  const tickets = mapper.normalizeTickets(rows);
  const extra = [
    extraRow({ recurso: 'Ana Perez', fecha: mapper.parseFecha('2026-03-02'), horas: 2, fuente: 'Tarea' }),
    extraRow({ recurso: 'Luis Gomez', fecha: mapper.parseFecha('2026-03-02'), horas: 5, fuente: 'Tarea' }), // excluded by recursos filter
    extraRow({ recurso: 'Ana Perez', fecha: mapper.parseFecha('2026-04-15'), horas: 9, fuente: 'Tarea' }) // out of period
  ];

  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02', recursos: ['Ana Perez'] }, extra);
  assert.equal(resumen.porRecurso.length, 1);
  assert.equal(resumen.porRecurso[0].recurso, 'Ana Perez');
  assert.equal(resumen.porRecurso[0].reservadas, 3); // 1h ticket + 2h Tarea, not the out-of-period 9h nor Luis Gomez's 5h
});

test('buildCapacidad(tickets, filters) with no 3rd argument keeps defaulting extraRows to [] (backward compatibility)', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '12:00' })];
  const tickets = mapper.normalizeTickets(rows);
  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-02', to: '2026-03-02' });
  assert.equal(resumen.porRecurso.length, 1);
  assert.equal(resumen.kpis.reservadas, 4);
});

/* -------- Accent-fusion extension across tickets + extraRows -------- */

test('buildCapacidad fuses accent/casing variants of the same person across tickets and extraRows into one porRecurso row', () => {
  // Ticket-level resource is the unaccented "Lina Maria Peralta" (the only
  // variant normalizeTickets saw among tickets alone).
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Lina Maria Peralta', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })]; // 1h
  const tickets = mapper.normalizeTickets(rows);
  // extraRows carry the accented variant twice (Title-Cased by app.js's
  // normalizeRecurso, but NOT yet accent-fused against the ticket side).
  const extra = [
    extraRow({ recurso: 'Lina María Peralta', fecha: mapper.parseFecha('2026-03-02'), horas: 2, fuente: 'Tarea' }),
    extraRow({ recurso: 'Lina María Peralta', fecha: mapper.parseFecha('2026-03-03'), horas: 1, fuente: 'Capacitación' })
  ];

  const resumen = mapper.buildCapacidad(tickets, { from: '2026-03-01', to: '2026-03-31' }, extra);
  // 2 occurrences of the accented variant outvote the 1 unaccented ticket
  // occurrence -> "Lina María Peralta" wins as the single fused display name.
  assert.equal(resumen.porRecurso.length, 1);
  assert.equal(resumen.porRecurso[0].recurso, 'Lina María Peralta');
  assert.equal(resumen.porRecurso[0].reservadas, 4); // 1h ticket + 2h + 1h extraRows, all merged
});

/* -------- buildRecursoTickets with extraRows (drill-down fuente column) -------- */

test('buildRecursoTickets includes extraRows as their own rows tagged with fuente, id/cliente/proyecto/producto/prioridad degrading to null/"Sin proyecto"', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })]; // 1h
  const tickets = mapper.normalizeTickets(rows);
  const extra = [extraRow({ recurso: 'Ana Perez', fecha: mapper.parseFecha('2026-03-03'), horas: 2.5, fuente: 'Seguimiento Cliente' })];

  const drill = mapper.buildRecursoTickets(tickets, { from: '2026-03-01', to: '2026-03-31' }, 'Ana Perez', extra);
  assert.equal(drill.rows.length, 2);
  assert.equal(drill.total, 3.5); // 1h ticket + 2.5h extraRow

  const ticketRow = drill.rows.find((r) => r.fuente === 'Ticket');
  const extraRowResult = drill.rows.find((r) => r.fuente === 'Seguimiento Cliente');
  assert.ok(ticketRow && extraRowResult, 'expected one row per source');
  assert.equal(extraRowResult.id, null);
  assert.equal(extraRowResult.cliente, null);
  assert.equal(extraRowResult.proyecto, 'Sin proyecto');
  assert.equal(extraRowResult.producto, null);
  assert.equal(extraRowResult.prioridad, null);
  assert.equal(extraRowResult.horasConsumidas, 2.5);
});

test('buildRecursoTickets(tickets, filters, recurso) with no extraRows keeps defaulting to [] (backward compatibility)', () => {
  const rows = [rawTicketWithHours({ ID: 1, Recurso_Soporte: 'Ana Perez', Fecha_Soporte_Inicial: '2026-03-02T00:00:00', Hora_Cal_Inicial: '08:00', Hora_Cal_Final: '09:00' })];
  const tickets = mapper.normalizeTickets(rows);
  const drill = mapper.buildRecursoTickets(tickets, { from: '2026-03-01', to: '2026-03-31' }, 'Ana Perez');
  assert.equal(drill.rows.length, 1);
  assert.equal(drill.rows[0].fuente, 'Ticket');
});

/* ==================== Tickets Activos (TDD) ====================
   Tests written BEFORE the implementation — see mapper.js for the new
   normalizeTickets fields (recursoAccion, estado, requerimientoOpcion) and
   buildActivos(). Business rules confirmed with the user:
   - Universe: Estado == 1 (numeric or numeric-string; 2 = inactive, any
     other value ignored) AND Accion (case-insensitive, trimmed) != CREAR.
   - Bucket Servicios: REALIZAR, AGENDA ENTREGA FINAL, ENTREGA FINAL, CIERRE.
   - Bucket Calidad: REVISION EN PLANTA, REVISION CALIDAD, REVISION DEV,
     REVISION SOLUCION, ACTUALIZA VERSION (alias ACTUALIZAR VERSION).
   - Any other active Accion counts toward the total but neither bucket.
   - Resource field for charts is Recurso_Accion (not Recurso_Soporte),
     empty -> "Sin recurso".
   - KPI aggregation is COUNT DISTINCT on ID. */

function rawActivoTicket(overrides) {
  return Object.assign({
    ID: 1, Fecha: '2026-08-01T00:00:00', Accion: 'REALIZAR', Estado: 1,
    Producto: 'NOMINA WEB', Proyecto: null, Proceso: 'Mantenimiento',
    Recurso_Soporte: 'Ana Perez', Recurso_Accion: 'ANA PEREZ',
    Fecha_Soporte_Inicial: '2026-08-01T00:00:00', Fecha_Entrega_Inicial: null,
    Cliente: 'Acme'
  }, overrides);
}

/* -------- normalizeTickets: new fields -------- */

test('normalizeTickets exposes recursoAccion via Recurso_Accion alias, empty -> Sin recurso', () => {
  const [withValue] = mapper.normalizeTickets([rawActivoTicket({ Recurso_Accion: 'MARLON SERNA' })]);
  assert.equal(withValue.recursoAccion, 'MARLON SERNA');

  const [empty] = mapper.normalizeTickets([rawActivoTicket({ Recurso_Accion: '' })]);
  assert.equal(empty.recursoAccion, 'Sin recurso');

  const [missing] = mapper.normalizeTickets([rawActivoTicket({ Recurso_Accion: null })]);
  assert.equal(missing.recursoAccion, 'Sin recurso');
});

test('normalizeTickets parses estado to a number (numeric or numeric-string), null when unparseable', () => {
  const [numeric] = mapper.normalizeTickets([rawActivoTicket({ Estado: 1 })]);
  assert.equal(numeric.estado, 1);

  const [stringy] = mapper.normalizeTickets([rawActivoTicket({ Estado: '1' })]);
  assert.equal(stringy.estado, 1);

  const [inactive] = mapper.normalizeTickets([rawActivoTicket({ Estado: 2 })]);
  assert.equal(inactive.estado, 2);

  const [missing] = mapper.normalizeTickets([rawActivoTicket({ Estado: null })]);
  assert.equal(missing.estado, null);
});

test('normalizeTickets sets requerimientoOpcion to null for every row when the column is absent (graceful degradation)', () => {
  const tickets = mapper.normalizeTickets([rawActivoTicket({ ID: 1 }), rawActivoTicket({ ID: 2 })]);
  assert.equal(tickets[0].requerimientoOpcion, null);
  assert.equal(tickets[1].requerimientoOpcion, null);
});

test('normalizeTickets detects requerimientoOpcion via alias when present, empty -> Sin requerimiento', () => {
  const rows = [
    Object.assign(rawActivoTicket({ ID: 1 }), { Requerimiento_Opcion: 'Cambio de contraseña' }),
    Object.assign(rawActivoTicket({ ID: 2 }), { Requerimiento_Opcion: '' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  assert.equal(tickets[0].requerimientoOpcion, 'Cambio de contraseña');
  assert.equal(tickets[1].requerimientoOpcion, 'Sin requerimiento');
});

/* -------- buildActivos: universe -------- */

test('buildActivos universe = Estado 1 AND Accion != CREAR (case-insensitive/trimmed), excludes Estado 2 and CREAR rows', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Estado: 1, Accion: 'REALIZAR' }),
    rawActivoTicket({ ID: 2, Estado: 2, Accion: 'REALIZAR' }), // inactive -> excluded
    rawActivoTicket({ ID: 3, Estado: 1, Accion: 'Crear' }),    // CREAR (mixed case) -> excluded
    rawActivoTicket({ ID: 4, Estado: 1, Accion: '  crear  ' }), // CREAR trimmed/lowercase -> excluded
    rawActivoTicket({ ID: 5, Estado: 3, Accion: 'REALIZAR' })  // any other estado -> excluded
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 1);
});

test('buildActivos accepts Estado as a numeric string ("1")', () => {
  const tickets = mapper.normalizeTickets([rawActivoTicket({ ID: 1, Estado: '1', Accion: 'REALIZAR' })]);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 1);
});

/* -------- buildActivos: buckets -------- */

test('buildActivos buckets Servicios accions and counts them in kpis.servicios', () => {
  const rows = ['REALIZAR', 'AGENDA ENTREGA FINAL', 'ENTREGA FINAL', 'CIERRE'].map((accion, i) =>
    rawActivoTicket({ ID: i + 1, Accion: accion })
  );
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 4);
  assert.equal(result.kpis.servicios, 4);
  assert.equal(result.kpis.calidad, 0);
});

test('buildActivos buckets Calidad accions (including the ACTUALIZAR VERSION alias) and counts them in kpis.calidad', () => {
  const rows = ['REVISION EN PLANTA', 'REVISION CALIDAD', 'REVISION DEV', 'REVISION SOLUCION', 'ACTUALIZA VERSION', 'ACTUALIZAR VERSION'].map((accion, i) =>
    rawActivoTicket({ ID: i + 1, Accion: accion })
  );
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 6);
  assert.equal(result.kpis.calidad, 6);
  assert.equal(result.kpis.servicios, 0);
});

test('buildActivos counts an active ticket with an accion outside both buckets toward total only', () => {
  const tickets = mapper.normalizeTickets([rawActivoTicket({ ID: 1, Accion: 'ALGO RARO' })]);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 1);
  assert.equal(result.kpis.servicios, 0);
  assert.equal(result.kpis.calidad, 0);
});

test('buildActivos kpis are COUNT DISTINCT on ID (duplicate ID rows count once)', () => {
  const tickets = mapper.normalizeTickets([
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR' }),
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR' }) // duplicate ID
  ]);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 1);
  assert.equal(result.kpis.servicios, 1);
});

/* -------- buildActivos: recursosServicios (Recurso_Accion, Servicios bucket only) -------- */

test('buildActivos recursosServicios groups the Servicios bucket by recursoAccion, sorted desc, empty -> Sin recurso', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR', Recurso_Accion: 'Ana' }),
    rawActivoTicket({ ID: 2, Accion: 'CIERRE', Recurso_Accion: 'Ana' }),
    rawActivoTicket({ ID: 3, Accion: 'ENTREGA FINAL', Recurso_Accion: '' }),
    rawActivoTicket({ ID: 4, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Luis' }) // Calidad -> excluded from recursosServicios
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.deepEqual(result.recursosServicios, [
    { label: 'Ana', value: 2 },
    { label: 'Sin recurso', value: 1 }
  ]);
});

/* -------- buildActivos: porCliente + hasCliente -------- */

test('buildActivos porCliente groups the whole active universe by cliente, sorted desc', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Cliente: 'Acme' }),
    rawActivoTicket({ ID: 2, Cliente: 'Acme' }),
    rawActivoTicket({ ID: 3, Cliente: 'Globex' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.hasCliente, true);
  assert.deepEqual(result.porCliente, [
    { label: 'ACME', value: 2 },
    { label: 'GLOBEX', value: 1 }
  ]);
});

test('buildActivos reports hasCliente:false when the Cliente column is absent (empty-state chart)', () => {
  const rows = [rawActivoTicket({ ID: 1 })];
  rows.forEach((r) => { delete r.Cliente; });
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.hasCliente, false);
  assert.deepEqual(result.porCliente, []);
});

/* -------- buildActivos: porAccion (whole universe, per-bar colorMapping) -------- */

test('buildActivos porAccion groups the whole active universe by accion (uppercased), sorted desc, with colorMapping and fallback', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'realizar' }),
    rawActivoTicket({ ID: 2, Accion: 'REALIZAR' }),
    rawActivoTicket({ ID: 3, Accion: 'CIERRE' }),
    rawActivoTicket({ ID: 4, Accion: 'ALGO RARO' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  const byLabel = Object.fromEntries(result.porAccion.map((a) => [a.label, a]));
  assert.equal(byLabel['REALIZAR'].value, 2);
  assert.equal(byLabel['REALIZAR'].color, '#2563EB');
  assert.equal(byLabel['CIERRE'].value, 1);
  assert.equal(byLabel['CIERRE'].color, '#0EA5E9');
  assert.equal(byLabel['ALGO RARO'].value, 1);
  assert.equal(byLabel['ALGO RARO'].color, '#94A3B8'); // fallback
  assert.equal(result.porAccion[0].label, 'REALIZAR'); // sorted desc
});

/* -------- buildActivos: porProducto (whole universe, doughnut) -------- */

test('buildActivos porProducto groups the whole active universe by producto, sorted desc', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 2, Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 3, Producto: 'CONTABILIDAD WEB' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.porProducto[0].label, 'NOMINA WEB');
  assert.equal(result.porProducto[0].value, 2);
  assert.equal(result.porProducto[1].label, 'CONTABILIDAD WEB');
  assert.equal(result.porProducto[1].value, 1);
});

/* -------- buildActivos: hasRequerimiento + requerimientoOptions (hidden filter) -------- */

test('buildActivos reports hasRequerimiento:false and an empty requerimientoOptions when the column is absent', () => {
  const tickets = mapper.normalizeTickets([rawActivoTicket({ ID: 1 })]);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.hasRequerimiento, false);
  assert.deepEqual(result.requerimientoOptions, []);
});

test('buildActivos reports hasRequerimiento:true and sorted requerimientoOptions when the column is present', () => {
  const rows = [
    Object.assign(rawActivoTicket({ ID: 1 }), { Requerimiento_Opcion: 'Soporte' }),
    Object.assign(rawActivoTicket({ ID: 2 }), { Requerimiento_Opcion: 'Cambio' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.hasRequerimiento, true);
  assert.deepEqual(result.requerimientoOptions, ['Cambio', 'Soporte']);
});

/* -------- buildActivos: filters -------- */

test('buildActivos filters by Fecha Soporte Inicial range', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Fecha_Soporte_Inicial: '2026-08-01T00:00:00' }),
    rawActivoTicket({ ID: 2, Fecha_Soporte_Inicial: '2026-08-15T00:00:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, { fechaSoporteInicialFrom: '2026-08-01', fechaSoporteInicialTo: '2026-08-05' });
  assert.equal(result.kpis.total, 1);
});

test('buildActivos date-range bounds are inclusive by calendar day even when the ticket date carries a time component', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Fecha_Soporte_Inicial: '2026-08-05T14:30:00', Fecha_Entrega_Inicial: '2026-08-10T18:00:00' }),
    rawActivoTicket({ ID: 2, Fecha_Soporte_Inicial: '2026-08-06T00:00:00', Fecha_Entrega_Inicial: '2026-08-11T00:00:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const soporte = mapper.buildActivos(tickets, { fechaSoporteInicialFrom: '2026-08-05', fechaSoporteInicialTo: '2026-08-05' });
  assert.equal(soporte.kpis.total, 1);
  const entrega = mapper.buildActivos(tickets, { fechaEntregaInicialFrom: '2026-08-10', fechaEntregaInicialTo: '2026-08-10' });
  assert.equal(entrega.kpis.total, 1);
});

test('buildActivos filters by Fecha Entrega Inicial range', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Fecha_Entrega_Inicial: '2026-09-01T00:00:00' }),
    rawActivoTicket({ ID: 2, Fecha_Entrega_Inicial: '2026-09-20T00:00:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, { fechaEntregaInicialFrom: '2026-09-01', fechaEntregaInicialTo: '2026-09-10' });
  assert.equal(result.kpis.total, 1);
});

test('buildActivos filters by requerimientos (isAllSelector semantics: empty/["all"] = no filter)', () => {
  const rows = [
    Object.assign(rawActivoTicket({ ID: 1 }), { Requerimiento_Opcion: 'Soporte' }),
    Object.assign(rawActivoTicket({ ID: 2 }), { Requerimiento_Opcion: 'Cambio' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const filtered = mapper.buildActivos(tickets, { requerimientos: ['Soporte'] });
  assert.equal(filtered.kpis.total, 1);

  const all = mapper.buildActivos(tickets, { requerimientos: ['all'] });
  assert.equal(all.kpis.total, 2);
  const none = mapper.buildActivos(tickets, { requerimientos: [] });
  assert.equal(none.kpis.total, 2);
});

test('buildActivos filters by recursos (isAllSelector semantics: empty/["all"] = no filter), narrowing kpis/recursosServicios/porCliente/rows together', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR', Recurso_Accion: 'Ana', Cliente: 'Acme' }),
    rawActivoTicket({ ID: 2, Accion: 'REALIZAR', Recurso_Accion: 'Luis', Cliente: 'Beta' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  // recursoAccion keeps the feed's original casing (no Title Case/accent
  // fusion, unlike recursoSoporte -- see normalizeTickets' recursoAccion
  // mapping), so the filter value must match that casing exactly.
  const filtered = mapper.buildActivos(tickets, { recursos: ['Ana'] });
  assert.equal(filtered.kpis.total, 1);
  assert.deepEqual(filtered.recursosServicios, [{ label: 'Ana', value: 1 }]);
  // Cliente IS uppercased by normalizeCliente (unlike recursoAccion above).
  assert.deepEqual(filtered.porCliente, [{ label: 'ACME', value: 1 }]);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].recursoAccion, 'Ana');

  const all = mapper.buildActivos(tickets, { recursos: ['all'] });
  assert.equal(all.kpis.total, 2);
  const none = mapper.buildActivos(tickets, { recursos: [] });
  assert.equal(none.kpis.total, 2);
});

test('buildActivos recursoOptions reflects the whole active universe, not narrowed by the currently applied filters', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR', Recurso_Accion: 'Ana' }),
    rawActivoTicket({ ID: 2, Accion: 'REALIZAR', Recurso_Accion: 'Luis' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, { recursos: ['Ana'] });
  assert.deepEqual(result.recursoOptions, ['Ana', 'Luis']);
});

/* -------- buildActivos: rows (per-ticket, for the "Requerimientos de Primer Nivel" table) -------- */

test('buildActivos exposes ID/Recurso/Cliente/Producto/Accion/Asunto rows for the whole filtered universe', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR', Recurso_Accion: 'Ana', Cliente: 'Acme', Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Luis', Cliente: 'Beta', Producto: 'CONTABILIDAD WEB' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.rows.length, 2);
  const row1 = result.rows.find((r) => r.id === 1);
  assert.equal(row1.recursoAccion, 'Ana');
  assert.equal(row1.cliente, 'ACME');
  assert.equal(row1.producto, 'NOMINA WEB');
  assert.equal(row1.accion, 'REALIZAR');
  // Asunto is confirmed absent from the real feed -> always null, UI shows "—".
  assert.equal(row1.asunto, null);
});

test('buildActivos rows respect the same date/requerimientos/recursos filters as kpis', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REALIZAR', Recurso_Accion: 'Ana', Fecha_Soporte_Inicial: '2026-08-01T00:00:00' }),
    rawActivoTicket({ ID: 2, Accion: 'REALIZAR', Recurso_Accion: 'Luis', Fecha_Soporte_Inicial: '2026-08-15T00:00:00' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, { fechaSoporteInicialFrom: '2026-08-01', fechaSoporteInicialTo: '2026-08-05' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 1);
});

/* -------- buildActivos: integration against the real sample fixture -------- */

test('buildActivos on data/sample-tickets.json matches the confirmed business numbers (total=103, servicios=88, calidad=15)', () => {
  const rows = require(path.join('..', 'data', 'sample-tickets.json'));
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildActivos(tickets, {});
  assert.equal(result.kpis.total, 103);
  assert.equal(result.kpis.servicios, 88);
  assert.equal(result.kpis.calidad, 15);
});

/* ==================== Segundo Nivel de Atención (TDD) ====================
   Business rule confirmed with the user:
   - Universe: estado === 1 (same active gate as Tickets Activos) AND
     accionNorm in ['REVISION CALIDAD', 'REVISION DEV', 'REVISION SOLUCION',
     'ACTUALIZA VERSION', 'ACTUALIZAR VERSION'] -- ACTIVOS_CALIDAD_ACCIONES
     minus REVISION EN PLANTA.
   - Every chart's resource dimension is Recurso_Accion, like Tickets
     Activos.
   - Diagnostico doesn't exist yet in the live feed or the sample fixture --
     graceful degradation, same hasClienteColumn-style pattern. */

/* -------- buildSegundoNivel: universe -------- */

test('buildSegundoNivel universe = Estado 1 AND Accion in the five second-level values', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Estado: 1, Accion: 'REVISION CALIDAD' }),
    rawActivoTicket({ ID: 2, Estado: 1, Accion: 'REVISION DEV' }),
    rawActivoTicket({ ID: 3, Estado: 1, Accion: 'REVISION SOLUCION' }),
    rawActivoTicket({ ID: 4, Estado: 1, Accion: 'ACTUALIZA VERSION' }),
    rawActivoTicket({ ID: 5, Estado: 1, Accion: 'ACTUALIZAR VERSION' }),
    rawActivoTicket({ ID: 6, Estado: 2, Accion: 'REVISION CALIDAD' }), // inactive -> excluded
    rawActivoTicket({ ID: 7, Estado: 1, Accion: 'REVISION EN PLANTA' }), // Activos Calidad, NOT Segundo Nivel -> excluded
    rawActivoTicket({ ID: 8, Estado: 1, Accion: 'REALIZAR' }), // Servicios bucket -> excluded
    rawActivoTicket({ ID: 9, Estado: 1, Accion: 'CREAR' }) // excluded (not in the 5-value set either)
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.kpis.total, 5);
});

/* -------- buildSegundoNivel: porRecurso (Recurso_Accion) -------- */

test('buildSegundoNivel porRecurso groups the universe by recursoAccion, sorted desc', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Ana' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Recurso_Accion: 'Ana' }),
    rawActivoTicket({ ID: 3, Accion: 'REVISION SOLUCION', Recurso_Accion: 'Luis' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.deepEqual(result.porRecurso, [
    { label: 'Ana', value: 2 },
    { label: 'Luis', value: 1 }
  ]);
});

/* -------- buildSegundoNivel: porCliente + hasCliente (top 10) -------- */

test('buildSegundoNivel porCliente groups the filtered universe by cliente, sorted desc, capped at top 10', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Cliente: 'Acme' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Cliente: 'Acme' }),
    rawActivoTicket({ ID: 3, Accion: 'REVISION SOLUCION', Cliente: 'Globex' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.hasCliente, true);
  assert.deepEqual(result.porCliente, [
    { label: 'ACME', value: 2 },
    { label: 'GLOBEX', value: 1 }
  ]);
});

test('buildSegundoNivel reports hasCliente:false when the Cliente column is absent', () => {
  const rows = [rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD' })];
  rows.forEach((r) => { delete r.Cliente; });
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.hasCliente, false);
  assert.deepEqual(result.porCliente, []);
});

/* -------- buildSegundoNivel: porProducto -------- */

test('buildSegundoNivel porProducto groups the filtered universe by producto, sorted desc', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 3, Accion: 'REVISION SOLUCION', Producto: 'CONTABILIDAD WEB' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.porProducto[0].label, 'NOMINA WEB');
  assert.equal(result.porProducto[0].value, 2);
  assert.equal(result.porProducto[1].label, 'CONTABILIDAD WEB');
  assert.equal(result.porProducto[1].value, 1);
});

/* -------- buildSegundoNivel: porDiagnostico + hasDiagnostico (graceful degradation) -------- */

test('buildSegundoNivel reports hasDiagnostico:false and an empty porDiagnostico when the column is absent (not present in the fixture)', () => {
  const tickets = mapper.normalizeTickets([rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD' })]);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.hasDiagnostico, false);
  assert.deepEqual(result.porDiagnostico, []);
});

test('buildSegundoNivel groups by diagnostico when the column is present, empty -> Sin diagnóstico', () => {
  const rows = [
    Object.assign(rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD' }), { Diagnostico: 'Falla de red' }),
    Object.assign(rawActivoTicket({ ID: 2, Accion: 'REVISION DEV' }), { Diagnostico: 'Falla de red' }),
    Object.assign(rawActivoTicket({ ID: 3, Accion: 'REVISION SOLUCION' }), { Diagnostico: '' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.hasDiagnostico, true);
  assert.deepEqual(result.porDiagnostico, [
    { label: 'Falla de red', value: 2 },
    { label: 'Sin diagnóstico', value: 1 }
  ]);
});

/* -------- buildSegundoNivel: recursoOptions / accionOptions -------- */

test('buildSegundoNivel exposes recursoOptions (sorted, whole universe) and the fixed accionOptions catalog', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Luis' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Recurso_Accion: 'Ana' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.deepEqual(result.recursoOptions, ['Ana', 'Luis']);
  assert.deepEqual(result.accionOptions, ['REVISION CALIDAD', 'REVISION DEV', 'REVISION SOLUCION', 'ACTUALIZAR VERSION']);
});

test('buildSegundoNivel recursoOptions reflects the whole universe, not narrowed by the currently applied filters', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Luis' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Recurso_Accion: 'Ana' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, { recursos: ['Ana'] });
  assert.deepEqual(result.recursoOptions, ['Ana', 'Luis']);
  assert.equal(result.kpis.total, 1); // the filter itself still narrows kpis/rows
});

/* -------- buildSegundoNivel: filters -------- */

test('buildSegundoNivel filters by recursos (isAllSelector semantics: empty/["all"] = no filter)', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Ana' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Recurso_Accion: 'Luis' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const filtered = mapper.buildSegundoNivel(tickets, { recursos: ['Ana'] });
  assert.equal(filtered.kpis.total, 1);

  const all = mapper.buildSegundoNivel(tickets, { recursos: ['all'] });
  assert.equal(all.kpis.total, 2);
  const none = mapper.buildSegundoNivel(tickets, { recursos: [] });
  assert.equal(none.kpis.total, 2);
});

test('buildSegundoNivel filters by accion (single-select), collapsing the ACTUALIZA/ACTUALIZAR VERSION alias into one option', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV' }),
    rawActivoTicket({ ID: 3, Accion: 'ACTUALIZA VERSION' }),
    rawActivoTicket({ ID: 4, Accion: 'ACTUALIZAR VERSION' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const calidad = mapper.buildSegundoNivel(tickets, { accion: 'REVISION CALIDAD' });
  assert.equal(calidad.kpis.total, 1);

  const version = mapper.buildSegundoNivel(tickets, { accion: 'ACTUALIZAR VERSION' });
  assert.equal(version.kpis.total, 2); // both alias spellings match

  const noFilter = mapper.buildSegundoNivel(tickets, { accion: 'all' });
  assert.equal(noFilter.kpis.total, 4);
});

/* -------- buildSegundoNivel: rows + selectedResource + insight -------- */

test('buildSegundoNivel exposes ID/Recurso/Cliente/Producto/Accion/Asunto rows for the whole filtered universe when no resource is selected', () => {
  const rows = [rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Ana', Cliente: 'Acme', Producto: 'NOMINA WEB' })];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.insight, null);
  assert.deepEqual(result.rows, [{
    id: 1, recurso: 'Ana', cliente: 'ACME', producto: 'NOMINA WEB', accion: 'REVISION CALIDAD', asunto: null
  }]);
});

test('buildSegundoNivel selectedResource narrows rows + computes the insight panel, without narrowing porRecurso itself', () => {
  const rows = [
    rawActivoTicket({ ID: 1, Accion: 'REVISION CALIDAD', Recurso_Accion: 'Ana', Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 2, Accion: 'REVISION DEV', Recurso_Accion: 'Ana', Producto: 'NOMINA WEB' }),
    rawActivoTicket({ ID: 3, Accion: 'REVISION SOLUCION', Recurso_Accion: 'Luis', Producto: 'CONTABILIDAD WEB' })
  ];
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, { selectedResource: 'Ana' });

  // The bar chart data (porRecurso) keeps every resource -- clicking a bar
  // never removes the other bars.
  assert.deepEqual(result.porRecurso, [
    { label: 'Ana', value: 2 },
    { label: 'Luis', value: 1 }
  ]);
  // Only rows/insight narrow to the selected resource.
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((r) => r.recurso === 'Ana'));
  assert.deepEqual(result.insight, {
    recurso: 'Ana',
    total: 2,
    topProducto: { label: 'NOMINA WEB', value: 2 },
    topDiagnostico: null, // Diagnostico absent from this fixture -> graceful degradation
    topAccion: { label: 'REVISION CALIDAD', value: 1 } // tie REVISION CALIDAD/REVISION DEV, first in sortedCounts order
  });
});

/* -------- buildSegundoNivel: integration against the real sample fixture -------- */

test('buildSegundoNivel on data/sample-tickets.json matches the confirmed business numbers (total=15, matching Activos\' calidad bucket minus REVISION EN PLANTA)', () => {
  const rows = require(path.join('..', 'data', 'sample-tickets.json'));
  const tickets = mapper.normalizeTickets(rows);
  const result = mapper.buildSegundoNivel(tickets, {});
  assert.equal(result.kpis.total, 15);
  assert.equal(result.hasCliente, true);
  assert.equal(result.hasDiagnostico, false); // Diagnostico not present in the live feed nor the fixture
  assert.deepEqual(result.porRecurso, [
    { label: 'JESUS EDUARDO HORTA NINCO', value: 5 },
    { label: 'ALIETH ELISA POLO QUESADA', value: 4 },
    { label: 'LUZ KARINE SEGURA ESPINOSA', value: 2 },
    { label: 'LEIDY JOHANNA COLLAZOS GUTIERREZ', value: 2 },
    { label: 'Rubén Darío Cantor Villarreal', value: 1 },
    { label: 'OSCAR MAURICIO LOPEZ MORALES', value: 1 }
  ]);
});
