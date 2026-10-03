'use strict';

// Copia automática: descarga del OData los tickets, las 4 fuentes extra de
// Capacidad y la correspondencia, y los deja comprimidos en SNAPSHOT_DIR
// (por defecto ./snapshot-out). El workflow .github/workflows/snapshot.yml
// publica esa carpeta en la rama `datos`, y SOFIA la lee desde
// raw.githubusercontent.com al abrir, mientras consulta el OData en vivo.
// Credenciales solo por variables de entorno (secretos de GitHub):
//   SOFIA_ODATA_URL, SOFIA_ODATA_USER, SOFIA_ODATA_PASS, [SOFIA_ODATA_TEMPLATE]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const DS = require('../assets/js/data-sources.js');

const OUT = path.resolve(process.env.SNAPSHOT_DIR || 'snapshot-out');
const URL_BASE = (process.env.SOFIA_ODATA_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from((process.env.SOFIA_ODATA_USER || '') + ':' + (process.env.SOFIA_ODATA_PASS || '')).toString('base64');
const TEMPLATE = process.env.SOFIA_ODATA_TEMPLATE || 'ID12086_Tickets_medidor';
const TIMEOUT_MS = 12 * 60 * 1000;

if (!URL_BASE || !process.env.SOFIA_ODATA_USER) { console.log('::error::Faltan los secretos SOFIA_ODATA_URL / SOFIA_ODATA_USER / SOFIA_ODATA_PASS en GitHub (Settings > Secrets and variables > Actions)'); process.exit(1); }

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

function note(level, msg) { console.log('::' + level + '::' + String(msg).replace(/\r?\n/g, ' ')); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const metaPath = path.join(OUT, 'meta.json');
  const prev = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const hashes = Object.assign({}, prev.hashes);
  let failed = null;

  function commitMeta() {
    if (JSON.stringify(hashes) !== JSON.stringify(prev.hashes)) {
      fs.writeFileSync(metaPath, JSON.stringify({ updatedAt: new Date().toISOString(), hashes }, null, 2) + '\n');
      console.log('Snapshot actualizado.');
    } else console.log('Sin cambios.');
  }

  // 1) Correspondencia (tabla pequeña): sirve también de diagnóstico de
  //    conectividad y se guarda aunque los tickets fallen.
  const t0 = Date.now();
  try {
    const corr = await get('ID12019_Correo');
    note('notice', 'Correspondencia: ' + corr.length + ' filas en ' + Math.round((Date.now() - t0) / 1000) + ' s');
    hashes.correspondencia = save('correspondencia', { value: corr });
  } catch (e) { note('error', 'Correspondencia falló: ' + e.message); failed = e; }

  // 2) Tickets + 4 fuentes de Capacidad: si fallan se conserva el último snapshot bueno.
  try {
    const t1 = Date.now();
    const tickets = await get(TEMPLATE);
    note('notice', 'Tickets: ' + tickets.length + ' filas en ' + Math.round((Date.now() - t1) / 1000) + ' s');
    const extraRows = [], failedSources = [];
    for (const def of DS.CAPACIDAD_EXTRA_SOURCES) {
      try {
        const sel = [def.recursoField, def.fechaInicialField, def.horaInicialField, def.horaFinalField].join(',');
        const rows = await get(def.templateName, sel);
        rows.forEach((r) => extraRows.push(DS.normalizeExtraRow(r, def)));
        console.log(def.fuente + ':', rows.length);
      } catch (e) { note('warning', def.fuente + ' falló: ' + e.message); failedSources.push(def.fuente); }
    }
    hashes.tickets = save('tickets', { rows: tickets, extraRows, failedSources });
  } catch (e) { note('error', 'Tickets falló: ' + e.message); failed = e; }

  commitMeta();
  if (failed) process.exit(1);
})().catch((e) => { note('error', e.message); process.exit(1); });
