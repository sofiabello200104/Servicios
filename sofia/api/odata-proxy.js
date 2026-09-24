'use strict';

// Vercel API function for GET /odata-proxy.
//
// Proxies requests to the upstream OData endpoint. Config is read from
// env vars (SOFIA_ODATA_URL, SOFIA_ODATA_USER, SOFIA_ODATA_PASS,
// SOFIA_ODATA_TEMPLATE) because Vercel functions are stateless.
//
// The optional ?url= query param lets data-sources.js request the 4 extra
// OData entities (Tarea, Tarea con Revisión, Seguimiento Cliente, Capacitación)
// from a different URL than the default ticket template — same host allowlist
// enforced regardless.

const https  = require('https');
const http   = require('http');
const { URL } = require('url');

const DEFAULT_ODATA_HOSTS = [
  '172.16.16.171', '172.16.16.175', '172.16.16.199',
  '190.145.254.194', 'bpm.webapidashboard.integrasoftsas.co'
];
const ALLOWED_ODATA_HOSTS = DEFAULT_ODATA_HOSTS.concat(
  (process.env.SOFIA_ODATA_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)
);

function getConfigFromEnv() {
  return {
    endpointUrl:  process.env.SOFIA_ODATA_URL      || '',
    authUser:     process.env.SOFIA_ODATA_USER     || '',
    authPass:     process.env.SOFIA_ODATA_PASS     || '',
    templateName: process.env.SOFIA_ODATA_TEMPLATE || 'ID12086_Tickets_medidor',
  };
}

function sendJson(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(obj);
}

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método no permitido.' });
  }

  const cfg = getConfigFromEnv();
  if (!cfg.endpointUrl) {
    return sendJson(res, 409, {
      error:
        'OData no configurado. Configurá las variables de entorno SOFIA_ODATA_URL, ' +
        'SOFIA_ODATA_USER, SOFIA_ODATA_PASS y SOFIA_ODATA_TEMPLATE en el panel de Vercel.'
    });
  }

  // Optional ?url= lets callers request a specific OData URL (e.g. extra
  // Capacidad sources). If absent, build the default tickets URL.
  const parsed = new URL(req.url, 'http://localhost');
  const rawTarget = parsed.searchParams.get('url');
  let targetUrl;
  if (rawTarget) {
    targetUrl = rawTarget;
  } else {
    const base = cfg.endpointUrl.replace(/\/+$/, '');
    const u = new URL(base + '/' + encodeURIComponent(cfg.templateName));
    u.searchParams.set('$format', 'json');
    targetUrl = u.toString();
  }

  let target;
  try { target = new URL(targetUrl); }
  catch (e) { return sendJson(res, 400, { error: 'URL inválida.' }); }

  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    return sendJson(res, 403, { error: 'Host no permitido.' });
  }

  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  const fwdHeaders = { Accept: 'application/json', 'User-Agent': 'SOFIA-Dashboard/1.0' };
  if (cfg.authUser) {
    fwdHeaders['Authorization'] = 'Basic ' +
      Buffer.from(cfg.authUser + ':' + (cfg.authPass || '')).toString('base64');
  }

  const options = {
    hostname: target.hostname,
    port: target.port ? parseInt(target.port, 10) : (isHttps ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method: 'GET',
    headers: fwdHeaders,
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
      sendJson(res, status, { error: 'El servidor OData respondió con un error.' });
      proxyRes.resume();
      return;
    }
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(status);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) sendJson(res, 504, { error: 'Timeout al conectar con el servidor OData.' });
  });
  proxyReq.on('error', () => {
    if (!res.headersSent) sendJson(res, 502, { error: 'Error de red al conectar con el servidor OData.' });
  });

  proxyReq.end();
};
