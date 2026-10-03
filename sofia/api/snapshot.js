'use strict';

// GET /api/snapshot?entity=tickets|correspondencia
// Sirve la última copia descargada por el workflow (data/snapshot/*.json.gz)
// ya descomprimida, con { ...datos, updatedAt }.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(process.cwd(), 'data', 'snapshot');
const ENTITIES = { tickets: 'tickets.json.gz', correspondencia: 'correspondencia.json.gz' };

module.exports = function handler(req, res) {
  const entity = new URL(req.url, 'http://x').searchParams.get('entity') || 'tickets';
  const file = ENTITIES[entity];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!file) return res.status(400).end(JSON.stringify({ error: 'Entidad no válida.' }));
  try {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, file))).toString('utf8'));
    let updatedAt = null;
    try { updatedAt = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8')).updatedAt; } catch (e) { /* sin meta */ }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).end(JSON.stringify(Object.assign({}, data, { updatedAt })));
  } catch (e) {
    res.status(404).end(JSON.stringify({ error: 'Aún no hay snapshot de datos.' }));
  }
};
