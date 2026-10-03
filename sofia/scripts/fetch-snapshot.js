'use strict';

// Descarga los datos del OData (tickets, 4 fuentes extra de Capacidad y
// correspondencia) y los guarda comprimidos en data/snapshot/. El dashboard
// los usa como respaldo inmediato mientras el servidor OData (lento: ~3 min
// por consulta) responde. Pensado para correr en GitHub Actions; credenciales
// por variables de entorno, nunca en el repo:
//   SOFIA_ODATA_URL, SOFIA_ODATA_USER, SOFIA_ODATA_PASS, [SOFIA_ODATA_TEMPLATE]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const DS = require('../assets/js/data-sources.js');

const OUT = path.join(__dirname, '..', 'data', 'snapshot');
const URL_BASE = (process.env.SOFIA_ODATA_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from((process.env.SOFIA_ODATA_USER || '') + ':' + (process.env.SOFIA_ODATA_PASS || '')).toString('base64');
const TEMPLATE = process.env.SOFIA_ODATA_TEMPLATE || 'ID12086_Tickets_medidor';
const TIMEOUT_MS = 12 * 60 * 1000;

if (!URL_BASE || !process.env.SOFIA_ODATA_USER) { console.error('Faltan SOFIA_ODATA_URL / SOFIA_ODATA_USER / SOFIA_ODATA_PASS'); process.exit(1); }

function toRows(d) {
  if (Array.isArray(d)) return d;
  if (d && d.d && Array.isArray(d.d.results)) return d.d.results;
  if (d && Array.isArray(d.value)) return d.value;
  return [];
}

// http/https en vez de fetch(): el fetch global (undici) corta a los 5 min
// sin recibir cabeceras, y este servidor tarda más que eso en responder.
function request(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : require('https');
    const req = mod.request(u, { method: 'GET', headers: { Authorization: AUTH, Accept: 'application/json', 'Accept-Encoding': 'gzip' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode));
        let buf = Buffer.concat(chunks);
        try { if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf); resolve(JSON.parse(buf.toString('utf8'))); }
        catch (e) { reject(new Error('Respuesta no válida: ' + e.message)); }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('tiempo de espera agotado (' + TIMEOUT_MS / 60000 + ' min)')));
    req.on('error', reject);
    req.end();
  });
}

async function get(entity, select) {
  let url = URL_BASE + '/' + encodeURIComponent(entity) + '?$format=json' + (select ? '&$select=' + encodeURIComponent(select) : '');
  const rows = [];
  for (let page = 0; url && page < 100; page++) {
    const t0 = Date.now();
    let json;
    try { json = await request(url); } catch (e) { throw new Error(entity + ': ' + e.message + ' tras ' + Math.round((Date.now() - t0) / 1000) + ' s'); }
    rows.push(...toRows(json));
    url = json['@odata.nextLink'] || json['odata.nextLink'] || null;
  }
  return rows;
}

function save(name, obj) {
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
  fs.writeFileSync(path.join(OUT, name + '.json.gz'), buf);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const metaPath = path.join(OUT, 'meta.json');
  const prev = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const hashes = {};

  // Tickets: si falla no se toca nada (se conserva el último snapshot bueno).
  const tickets = await get(TEMPLATE);
  console.log('tickets:', tickets.length);

  const extraRows = [], failedSources = [];
  for (const def of DS.CAPACIDAD_EXTRA_SOURCES) {
    try {
      const sel = [def.recursoField, def.fechaInicialField, def.horaInicialField, def.horaFinalField].join(',');
      const rows = await get(def.templateName, sel);
      rows.forEach((r) => extraRows.push(DS.normalizeExtraRow(r, def)));
      console.log(def.fuente + ':', rows.length);
    } catch (e) { console.error('Falló', def.fuente, e.message); failedSources.push(def.fuente); }
  }
  hashes.tickets = save('tickets', { rows: tickets, extraRows, failedSources });

  try {
    const corr = await get('ID12019_Correo');
    console.log('correspondencia:', corr.length);
    hashes.correspondencia = save('correspondencia', { value: corr });
  } catch (e) { console.error('Correspondencia no actualizada:', e.message); hashes.correspondencia = prev.hashes && prev.hashes.correspondencia; }

  const changed = JSON.stringify(hashes) !== JSON.stringify(prev.hashes);
  if (changed) fs.writeFileSync(metaPath, JSON.stringify({ updatedAt: new Date().toISOString(), hashes }, null, 2) + '\n');
  console.log(changed ? 'Snapshot actualizado.' : 'Sin cambios.');
})().catch((e) => { console.error(e.message); process.exit(1); });
