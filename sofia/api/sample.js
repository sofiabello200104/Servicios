'use strict';

// Vercel API function for GET /api/sample.
//
// Serves the sample-tickets.json fixture from the data/ directory.
// In Vercel, static files that live in the project root are accessible
// at build time — fs.readFile works fine for read-only fixtures.

const fs   = require('fs');
const path = require('path');

const SAMPLE_PATH = path.join(process.cwd(), 'data', 'sample-tickets.json');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const entity = new URL(req.url, 'http://x').searchParams.get('entity');
  const file = entity === 'correspondencia' ? path.join(process.cwd(), 'data', 'sample-correspondencia.json') : SAMPLE_PATH;
  fs.readFile(file, (err, data) => {
    if (err) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(404).json({ error: 'No hay datos de ejemplo generados.' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(data);
  });
};
