'use strict';

// SOFIA dashboard server — plain Node http module, no dependencies, no build
// step. Deliberately simpler than the pruebapony reference: no login, no
// sessions, no SQLite — config is a single JSON file on disk, and every
// visitor of this app sees the same OData connection.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SAMPLE_PATH = path.join(DATA_DIR, 'sample-tickets.json');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// TLS: when certs/key.pem + certs/cert.pem exist the server speaks HTTPS,
// otherwise it falls back to plain HTTP. The bundled cert is self-signed with
// SAN = 190.145.254.194, 172.16.16.171, 127.0.0.1, localhost (same cert as
// the pruebapony reference), so browsers show a one-time trust warning.
const CERT_DIR = path.join(ROOT, 'certs');
const TLS_KEY_PATH = path.join(CERT_DIR, 'key.pem');
const TLS_CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const TLS_ENABLED = fs.existsSync(TLS_KEY_PATH) && fs.existsSync(TLS_CERT_PATH);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Allowlist of OData hosts this server is willing to proxy to. Copied
// verbatim from the reference's ALLOWED_ODATA_HOSTS (same organization's
// OData infrastructure serves this ticket feed) and additionally
// extensible via SOFIA_ODATA_HOSTS (comma-separated) for other deployments.
const DEFAULT_ODATA_HOSTS = ['172.16.16.171', '172.16.16.175', '172.16.16.199', '190.145.254.194', 'bpm.webapidashboard.integrasoftsas.co'];
const ALLOWED_ODATA_HOSTS = DEFAULT_ODATA_HOSTS.concat(
  (process.env.SOFIA_ODATA_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)
);

// CSP tuned for: Tailwind Play CDN script, Chart.js CDN script, Google Fonts
// stylesheet + font host. Same posture as the reference (unsafe-eval is
// required by the Tailwind Play CDN, which compiles utility classes in the
// browser; unsafe-inline on style-src covers the inline style="" attributes
// the render code generates for chart containers/badges).
const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'";

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': CSP
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/* ==================== Config persistence ==================== */

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { endpointUrl: '', authUser: '', authPass: '', templateName: 'ID12086_Tickets_medidor', updatedAt: null };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function stripPassword(cfg) {
  const { authPass, ...rest } = cfg;
  return rest;
}

/* ==================== Static file serving ====================
   Same path-traversal fix as the reference resolveStaticPath/
   isAllowedStaticPath: decode + resolve the URL BEFORE checking the prefix,
   so the allowlist check always runs against the real resolved destination
   (never the raw "/assets/../whatever" string, which would pass a naive
   startsWith('/assets/') check). */
function resolveStaticPath(rawUrl) {
  const rawPath = rawUrl.split('?')[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch (e) {
    return null;
  }
  const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const resolvedPath = path.resolve(path.join(ROOT, normalizedPath));
  const relativePath = path.relative(ROOT, resolvedPath);
  return { relativePath, resolvedPath };
}

function isAllowedStaticPath(relativePath) {
  return relativePath === 'index.html' || relativePath.startsWith('assets' + path.sep);
}

function serveStatic(req, res) {
  const resolved = resolveStaticPath(req.url);
  if (!resolved || resolved.relativePath.startsWith('..') || !isAllowedStaticPath(resolved.relativePath)) {
    res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
    res.end('No encontrado.');
    return;
  }
  fs.readFile(resolved.resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
      res.end('No encontrado.');
      return;
    }
    const ext = path.extname(resolved.resolvedPath).toLowerCase();
    // no-cache forces the browser to revalidate every asset; without it, the
    // heuristic cache kept serving stale JS/HTML after deployments.
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    }, SECURITY_HEADERS));
    res.end(data);
  });
}

/* ==================== JSON helpers ==================== */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('Body demasiado grande.')); req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

/* ==================== OData proxy core ====================
   Adapted from the reference performODataRequest: same host-allowlist +
   "never echo upstream error text to the client" posture. Dials out over
   https OR http depending on the target URL's own protocol.

   Measured on 2026-09-30 against the live feed: the full
   ID12086_Tickets_medidor entity (5,415 rows, 26 columns, ~5 MB) takes
   ~165s before the first byte, and the upstream ignores both $top and
   $select, so the payload can't be trimmed at the source. Hence:
   - a 280s upstream timeout (above the measured ~165s);
   - an in-memory cache per target URL: answers come from the last good
     copy, which is refreshed in the background once older than
     ODATA_CACHE_FRESH_MS, so only the very first load waits ~3 minutes;
   - one shared in-flight request per target URL, so concurrent visitors
     never fire duplicate upstream requests (the upstream cannot handle
     concurrent requests under the same credentials);
   - gzip on the way to the browser (~5 MB -> ~0.3 MB). */
const ODATA_UPSTREAM_TIMEOUT_MS = 280000;
const ODATA_CACHE_FRESH_MS = 15 * 60 * 1000;
const _odataCache = new Map();    // key -> { gzBody, contentType, fetchedAt }
const _odataInFlight = new Map(); // key -> Promise<{ ok, entry } | { ok: false, status, error }>

// Validates a target URL against the host allowlist. Returns the parsed URL,
// or { status, error } for the caller to send.
function validateODataTarget(targetUrl) {
  let target;
  try { target = new URL(targetUrl); }
  catch (e) { return { status: 400, error: 'URL inválida.' }; }
  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) return { status: 403, error: 'Host no permitido.' };
  return { target };
}

// Fetches one target from the upstream and resolves (never rejects) with
// { ok: true, entry } on 2xx, or { ok: false, status, error } otherwise.
function fetchODataUpstream(target, authUser, authPass) {
  return new Promise((resolve) => {
    const isHttps = target.protocol === 'https:';
    const transport = isHttps ? https : http;

    const fwdHeaders = { Accept: 'application/json', 'User-Agent': 'SOFIA-Dashboard/1.0' };
    if (authUser) {
      fwdHeaders['Authorization'] = 'Basic ' + Buffer.from(authUser + ':' + (authPass || '')).toString('base64');
    }

    const proxyReq = transport.request({
      hostname: target.hostname,
      port: target.port ? parseInt(target.port, 10) : (isHttps ? 443 : 80),
      path: target.pathname + (target.search || ''),
      method: 'GET',
      headers: fwdHeaders,
      timeout: ODATA_UPSTREAM_TIMEOUT_MS
    }, (proxyRes) => {
      const status = proxyRes.statusCode;
      if (status === 401) {
        proxyRes.resume();
        return resolve({ ok: false, status: 401, error: 'HTTP 401 — Credenciales incorrectas o no proporcionadas.' });
      }
      if (status < 200 || status >= 300) {
        // Never echo upstream error text to the client — just the status.
        proxyRes.resume();
        return resolve({ ok: false, status, error: 'El servidor OData respondió con un error.' });
      }
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        resolve({
          ok: true,
          entry: {
            gzBody: zlib.gzipSync(Buffer.concat(chunks)),
            contentType: proxyRes.headers['content-type'] || 'application/json; charset=utf-8',
            fetchedAt: Date.now()
          }
        });
      });
      proxyRes.on('error', () => resolve({ ok: false, status: 502, error: 'Error de red al conectar con el servidor OData.' }));
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      resolve({ ok: false, status: 504, error: 'Timeout al conectar con el servidor OData.' });
    });
    proxyReq.on('error', () => resolve({ ok: false, status: 502, error: 'Error de red al conectar con el servidor OData.' }));
    proxyReq.end();
  });
}

// Refreshes one cache key, sharing a single upstream request among all
// callers while it is in flight. Only successful answers are cached.
function refreshODataCache(key, target, authUser, authPass) {
  if (_odataInFlight.has(key)) return _odataInFlight.get(key);
  const p = fetchODataUpstream(target, authUser, authPass).then((result) => {
    if (result.ok) _odataCache.set(key, result.entry);
    _odataInFlight.delete(key);
    return result;
  });
  _odataInFlight.set(key, p);
  return p;
}

function sendODataEntry(req, res, entry) {
  const headers = Object.assign({
    'Content-Type': entry.contentType,
    'X-Data-Fetched-At': new Date(entry.fetchedAt).toISOString()
  }, SECURITY_HEADERS);
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    res.end(entry.gzBody);
  } else {
    res.writeHead(200, headers);
    res.end(zlib.gunzipSync(entry.gzBody));
  }
}

async function performODataRequest(req, targetUrl, authUser, authPass, res) {
  const v = validateODataTarget(targetUrl);
  if (!v.target) return sendJson(res, v.status, { error: v.error });

  // The user is part of the key so a credentials change never serves data
  // fetched under the previous user.
  const key = (authUser || '') + '|' + v.target.toString();
  const cached = _odataCache.get(key);
  if (cached) {
    if (Date.now() - cached.fetchedAt > ODATA_CACHE_FRESH_MS) {
      refreshODataCache(key, v.target, authUser, authPass); // background, errors keep the old copy
    }
    return sendODataEntry(req, res, cached);
  }

  const result = await refreshODataCache(key, v.target, authUser, authPass);
  if (!result.ok) return sendJson(res, result.status, { error: result.error });
  sendODataEntry(req, res, result.entry);
}

function buildTemplateRequestUrl(cfg, extraQuery) {
  const base = cfg.endpointUrl.replace(/\/+$/, '');
  const url = new URL(base + '/' + encodeURIComponent(cfg.templateName || 'ID12086_Tickets_medidor'));
  url.searchParams.set('$format', 'json');
  if (extraQuery) {
    Object.keys(extraQuery).forEach((k) => url.searchParams.set(k, extraQuery[k]));
  }
  return url.toString();
}

/* ==================== Route handlers ==================== */

function handleConfigGet(req, res) {
  const cfg = readConfig();
  const safe = stripPassword(cfg);
  sendJson(res, 200, Object.assign({}, safe, { configured: !!cfg.endpointUrl }));
}

async function handleConfigPost(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const endpointUrl = String(body.endpointUrl || '').trim();
  const authUser = String(body.authUser || '').trim();
  const templateName = String(body.templateName || '').trim() || 'ID12086_Tickets_medidor';
  const authPassIncoming = body.authPass != null ? String(body.authPass) : '';

  if (!endpointUrl) return sendJson(res, 400, { error: 'Falta la URL del endpoint.' });

  let target;
  try { target = new URL(endpointUrl); }
  catch (e) { return sendJson(res, 400, { error: 'URL inválida.' }); }

  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    return sendJson(res, 400, { error: 'Host no permitido.' });
  }

  const existing = readConfig();
  // If the client sends an empty password, keep the previously stored one —
  // otherwise a plain "save URL/user" edit would silently wipe credentials.
  const authPass = authPassIncoming !== '' ? authPassIncoming : (existing.authPass || '');

  const saved = writeConfig({
    endpointUrl,
    authUser,
    authPass,
    templateName,
    updatedAt: new Date().toISOString()
  });

  sendJson(res, 200, { ok: true, config: Object.assign({}, stripPassword(saved), { configured: true }) });
}

async function handleConfigTestPost(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const endpointUrl = String(body.endpointUrl || '').trim();
  const authUser = String(body.authUser || '');
  const authPass = String(body.authPass || '');
  const templateName = String(body.templateName || '').trim() || 'ID12086_Tickets_medidor';
  if (!endpointUrl) return sendJson(res, 400, { error: 'Falta la URL del endpoint.' });

  let target;
  try { target = new URL(endpointUrl); }
  catch (e) { return sendJson(res, 400, { error: 'URL inválida.' }); }
  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    return sendJson(res, 403, { error: 'Host no permitido.' });
  }

  const base = endpointUrl.replace(/\/+$/, '');
  const testUrl = base + '/' + encodeURIComponent(templateName) + '?$format=json&$top=1';

  // Reuse performODataRequest's transport, but only report ok/not-ok, never
  // forward upstream body text to the client.
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;
  const fwdHeaders = { Accept: 'application/json', 'User-Agent': 'SOFIA-Dashboard/1.0' };
  if (authUser) fwdHeaders['Authorization'] = 'Basic ' + Buffer.from(authUser + ':' + authPass).toString('base64');

  const parsedTest = new URL(testUrl);
  const options = {
    hostname: parsedTest.hostname,
    port: parsedTest.port ? parseInt(parsedTest.port, 10) : (isHttps ? 443 : 80),
    path: parsedTest.pathname + (parsedTest.search || ''),
    method: 'GET',
    headers: fwdHeaders,
    timeout: 20000
  };

  const testReq = transport.request(options, (testRes) => {
    testRes.resume();
    const ok = testRes.statusCode >= 200 && testRes.statusCode < 300;
    sendJson(res, 200, { ok });
  });
  testReq.on('timeout', () => { testReq.destroy(); sendJson(res, 200, { ok: false }); });
  testReq.on('error', () => { sendJson(res, 200, { ok: false }); });
  testReq.end();
}

function handleODataProxyGet(req, res) {
  const cfg = readConfig();
  if (!cfg.endpointUrl) return sendJson(res, 409, { error: 'OData no configurado.' });

  const parsed = new URL(req.url, 'http://localhost');
  const rawTarget = parsed.searchParams.get('url');
  const targetUrl = rawTarget || buildTemplateRequestUrl(cfg);

  performODataRequest(req, targetUrl, cfg.authUser, cfg.authPass, res);
}

function handleSnapshotGet(req, res) {
  const zlib = require('zlib');
  const entity = new URL(req.url, 'http://x').searchParams.get('entity') || 'tickets';
  const files = { tickets: 'tickets.json.gz', correspondencia: 'correspondencia.json.gz' };
  if (!files[entity]) return sendJson(res, 400, { error: 'Entidad no válida.' });
  try {
    const dir = path.join(DATA_DIR, 'snapshot');
    let data, updatedAt = null;
    try {
      data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, files[entity]))).toString('utf8'));
      try { updatedAt = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).updatedAt; } catch (e) { /* sin meta */ }
    } catch (e) {
      // Sin snapshot del workflow: copia del Power BI INDICADORES.pbix (solo tickets).
      if (entity !== 'tickets') throw e;
      data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, 'pbix', 'tickets.json.gz'))).toString('utf8'));
      updatedAt = data.updatedAt;
    }
    sendJson(res, 200, Object.assign({}, data, { updatedAt }));
  } catch (e) { sendJson(res, 404, { error: 'Aún no hay snapshot de datos.' }); }
}

function handleSampleGet(req, res) {
  const entity = new URL(req.url, 'http://x').searchParams.get('entity');
  const file = entity === 'correspondencia' ? path.join(DATA_DIR, 'sample-correspondencia.json') : SAMPLE_PATH;
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'No hay datos de ejemplo generados.' });
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
    res.end(data);
  });
}

/* ==================== Router ==================== */

function requestHandler(req, res) {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/config' && req.method === 'GET') return handleConfigGet(req, res);
  if (urlPath === '/api/config' && req.method === 'POST') return handleConfigPost(req, res);
  if (urlPath === '/api/config/test' && req.method === 'POST') return handleConfigTestPost(req, res);
  // /api/odata-proxy is the path the frontend calls (it matches the Vercel
  // function at api/odata-proxy.js); /odata-proxy is kept for older callers.
  if ((urlPath === '/odata-proxy' || urlPath === '/api/odata-proxy') && req.method === 'GET') return handleODataProxyGet(req, res);
  if (urlPath === '/api/sample' && req.method === 'GET') return handleSampleGet(req, res);
  if (urlPath === '/api/snapshot' && req.method === 'GET') return handleSnapshotGet(req, res);

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);

  res.writeHead(405, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
  res.end('Método no permitido.');
}

const server = TLS_ENABLED
  ? https.createServer(
      { key: fs.readFileSync(TLS_KEY_PATH), cert: fs.readFileSync(TLS_CERT_PATH) },
      requestHandler
    )
  : http.createServer(requestHandler);

if (require.main === module) {
  const scheme = TLS_ENABLED ? 'https' : 'http';
  server.listen(PORT, '0.0.0.0', () => {
    console.log('SOFIA dashboard listening on ' + scheme + '://0.0.0.0:' + PORT);
    console.log('  ► ' + scheme + '://localhost:' + PORT);
    console.log('  ► ' + scheme + '://172.16.16.171:' + PORT);
    console.log('  ► ' + scheme + '://190.145.254.194:' + PORT);
  });
}

module.exports = server;
