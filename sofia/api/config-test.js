'use strict';

// Vercel API function for POST /api/config/test (aliased as /api/config-test
// in vercel.json because Vercel file-based routing doesn't support
// subdirectory nesting for nested routes like config/test).
//
// Probes the OData endpoint with $top=1 and returns { ok: true/false }.
// Reads credentials from the submitted form body OR falls back to env vars
// (so "Probar conexión" still works even in read-only Vercel mode).

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const DEFAULT_ODATA_HOSTS = [
  '172.16.16.171', '172.16.16.175', '172.16.16.199',
  '190.145.254.194', 'bpm.webapidashboard.integrasoftsas.co'
];
const ALLOWED_ODATA_HOSTS = DEFAULT_ODATA_HOSTS.concat(
  (process.env.SOFIA_ODATA_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)
);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  // Use body values; fall back to env vars so the UI "Probar conexión" button
  // still works when the config comes from env (Vercel read-only mode).
  const endpointUrl  = String(body.endpointUrl  || process.env.SOFIA_ODATA_URL      || '').trim();
  const authUser     = String(body.authUser     || process.env.SOFIA_ODATA_USER     || '').trim();
  const authPass     = String(body.authPass     || process.env.SOFIA_ODATA_PASS     || '');
  const templateName = String(body.templateName || process.env.SOFIA_ODATA_TEMPLATE || 'ID12086_Tickets_medidor').trim();

  if (!endpointUrl) return res.status(400).json({ error: 'Falta la URL del endpoint.' });

  let target;
  try { target = new URL(endpointUrl); }
  catch (e) { return res.status(400).json({ error: 'URL inválida.' }); }

  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    return res.status(403).json({ error: 'Host no permitido.' });
  }

  const base = endpointUrl.replace(/\/+$/, '');
  const testUrl = base + '/' + encodeURIComponent(templateName) + '?$format=json&$top=1';
  const parsedTest = new URL(testUrl);
  const isHttps = parsedTest.protocol === 'https:';
  const transport = isHttps ? https : http;

  const fwdHeaders = { Accept: 'application/json', 'User-Agent': 'SOFIA-Dashboard/1.0' };
  if (authUser) {
    fwdHeaders['Authorization'] = 'Basic ' + Buffer.from(authUser + ':' + authPass).toString('base64');
  }

  const options = {
    hostname: parsedTest.hostname,
    port: parsedTest.port ? parseInt(parsedTest.port, 10) : (isHttps ? 443 : 80),
    path: parsedTest.pathname + (parsedTest.search || ''),
    method: 'GET',
    headers: fwdHeaders,
    timeout: 20000
  };

  return new Promise((resolve) => {
    const testReq = transport.request(options, (testRes) => {
      testRes.resume();
      const ok = testRes.statusCode >= 200 && testRes.statusCode < 300;
      res.status(200).json({ ok });
      resolve();
    });
    testReq.on('timeout', () => { testReq.destroy(); res.status(200).json({ ok: false }); resolve(); });
    testReq.on('error',   () => { res.status(200).json({ ok: false }); resolve(); });
    testReq.end();
  });
};
