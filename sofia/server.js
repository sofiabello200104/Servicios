'use strict';

// SOFIA dashboard server — plain Node http module, no dependencies, no build
// step. Deliberately simpler than the pruebapony reference: no login, no
// sessions, no SQLite — config is a single JSON file on disk, and every
// visitor of this app sees the same OData connection.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
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
   20s timeout + "never echo upstream error text to the client" posture.
   Adapted to a plain http Agent (this server never speaks https to a
   client — no certs here) but still dials out over https OR http depending
   on the target URL's own protocol, since the OData source may be either. */
function performODataRequest(targetUrl, authUser, authPass, res) {
  let target;
  try { target = new URL(targetUrl); }
  catch (e) {
    sendJson(res, 400, { error: 'URL inválida.' });
    return;
  }

  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    sendJson(res, 403, { error: 'Host no permitido.' });
    return;
  }

  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  const fwdHeaders = { Accept: 'application/json', 'User-Agent': 'SOFIA-Dashboard/1.0' };
  if (authUser) {
    fwdHeaders['Authorization'] = 'Basic ' + Buffer.from(authUser + ':' + (authPass || '')).toString('base64');
  }

  const options = {
    hostname: target.hostname,
    port: target.port ? parseInt(target.port, 10) : (isHttps ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method: 'GET',
    headers: fwdHeaders,
    // 45s, not 20s: ID12096_Plantilla_tarea_con_rev (one of Capacidad's
    // extra OData sources) alone was measured at ~20s from this upstream
    // even with no other request in flight, so 20s produced spurious 504s
    // on that entity regardless of concurrency.
    timeout: 45000
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const status = proxyRes.statusCode;
    if (status === 401) {
      sendJson(res, 401, { error: 'HTTP 401 — Credenciales incorrectas o no proporcionadas.' });
      proxyRes.resume();
      return;
    }
    if (status < 200 || status >= 300) {
      // Never echo upstream error text to the client — just the status.
      sendJson(res, status, { error: 'El servidor OData respondió con un error.' });
      proxyRes.resume();
      return;
    }
    const resHeaders = Object.assign(
      { 'Content-Type': proxyRes.headers['content-type'] || 'application/json; charset=utf-8' },
      SECURITY_HEADERS
    );
    res.writeHead(status, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (res.headersSent) { res.destroy(); return; }
    sendJson(res, 504, { error: 'Timeout al conectar con el servidor OData.' });
  });

  proxyReq.on('error', () => {
    if (res.headersSent) { res.destroy(); return; }
    sendJson(res, 502, { error: 'Error de red al conectar con el servidor OData.' });
  });

  proxyReq.end();
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

  performODataRequest(targetUrl, cfg.authUser, cfg.authPass, res);
}

function handleSampleGet(req, res) {
  fs.readFile(SAMPLE_PATH, (err, data) => {
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
  if (urlPath === '/odata-proxy' && req.method === 'GET') return handleODataProxyGet(req, res);
  if (urlPath === '/api/sample' && req.method === 'GET') return handleSampleGet(req, res);

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
