'use strict';
// Construye data/pbix/tickets.json.gz (respaldo "copia del Power BI") a partir
// del JSON que genera scripts/pbix_to_json.py. Une los tickets de ejemplo
// (data/sample-tickets.json) con los tickets que trae el .pbix (el .pbix solo
// guarda los más recientes) y normaliza las fuentes extra de Capacidad.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DS = require('../assets/js/data-sources.js');
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sample-tickets.json'), 'utf8'));
const base = Array.isArray(sample) ? sample : sample.value;

const byId = new Map(base.map((r) => [String(r.ID), r]));
src.tickets.forEach((r) => byId.set(String(r.ID), r));
const rows = Array.from(byId.values());

const extraRows = [], failedSources = [];
DS.CAPACIDAD_EXTRA_SOURCES.forEach((def) => {
  const raw = src[def.templateName];
  if (!raw) { failedSources.push(def.fuente); return; }
  raw.forEach((r) => extraRows.push(DS.normalizeExtraRow(r, def)));
});

const out = { rows, extraRows, failedSources, updatedAt: '2026-10-01T23:59:00.000Z', origen: 'pbix' };
fs.mkdirSync(path.join(__dirname, '..', 'data', 'pbix'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'data', 'pbix', 'tickets.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }));
console.log('tickets', rows.length, '(pbix:', src.tickets.length + ')', 'extras', extraRows.length, 'sin fuente:', failedSources);
