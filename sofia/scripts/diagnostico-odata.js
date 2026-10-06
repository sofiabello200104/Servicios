'use strict';
// Diagnóstico: prueba varias formas de pedir la misma tabla pequeña al OData
// y reporta tiempo, estado y tamaño de cada una (anotaciones en Actions).
const https = require('https');
const zlib = require('zlib');
const BASE = (process.env.SOFIA_ODATA_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from((process.env.SOFIA_ODATA_USER || '') + ':' + (process.env.SOFIA_ODATA_PASS || '')).toString('base64');
const T = 600000;

function req(label, path, headers) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const u = new URL(BASE + path);
    const r = https.request(u, { method: 'GET', headers }, (res) => {
      let n = 0, first = Date.now() - t0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve(label + ' → HTTP ' + res.statusCode + ' · cabeceras ' + Math.round(first / 1000) + ' s · total ' + Math.round((Date.now() - t0) / 1000) + ' s · ' + n + ' bytes · ' + (res.headers['content-type'] || '')));
      res.on('error', (e) => resolve(label + ' → error ' + e.message));
    });
    // TCP keep-alive: algunos balanceadores cortan conexiones 'inactivas'
    // (~4-5 min) mientras el servidor prepara la respuesta.
    r.on('socket', (sock) => sock.setKeepAlive(true, 15000));
    r.setTimeout(T, () => r.destroy(new Error('sin respuesta en ' + T / 1000 + ' s')));
    r.on('error', (e) => resolve(label + ' → ' + e.message + ' tras ' + Math.round((Date.now() - t0) / 1000) + ' s'));
    r.end();
  });
}

(async () => {
  const e = 'ID12019_Correo';
  const pbi = { Authorization: AUTH, Accept: 'application/json;odata.metadata=minimal', 'OData-Version': '4.0', 'OData-MaxVersion': '4.0', 'Accept-Encoding': 'gzip' };
  const tests = process.env.SOLO_TICKETS ? [
    ['T ID12086_Tickets_medidor como SOFIA', '/ID12086_Tickets_medidor?$format=json', { Authorization: AUTH, Accept: 'application/json' }]
  ] : [
    ['A $metadata (Basic)', '/$metadata', { Authorization: AUTH }],
    ['B ' + e + ' como SOFIA ($format=json, Basic)', '/' + e + '?$format=json', { Authorization: AUTH, Accept: 'application/json' }],
    ['C ' + e + ' como Power BI (cabeceras OData v4, sin $format)', '/' + e, pbi],
    ['D ' + e + ' $top=5 (cabeceras Power BI)', '/' + e + '?$top=5', pbi],
    ['E ' + e + ' sin credenciales', '/' + e, { Accept: 'application/json' }]
  ];
  for (const [label, path, headers] of tests) {
    const line = await req(label, path, headers);
    console.log('::notice::' + line);
  }
})();
