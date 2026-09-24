/**
 * Servidor local CMI SICSS.
 * Sirve archivos estáticos + proxy CORS hacia el endpoint OData.
 * Soporta: Basic Auth, NTLM (primer intento con credenciales dadas).
 * Uso: node server.js
 */
const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);
if (NODE_MAJOR < 20) {
  console.error('');
  console.error('  ✗ Este proyecto necesita Node 20 o superior (better-sqlite3 no carga en Node ' + process.versions.node + ').');
  console.error('  ✗ Corré primero:  nvm use 22.10.0');
  console.error('');
  process.exit(1);
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth-lib');
const CMI_MAPPER = require('./assets/js/mapper.js');

const PORT = 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const ANALISIS_FILE = path.join(DATA_DIR, 'analisis.json');
const ANALISIS_AREAS = ['comercial'];
const ANALISIS_CARDS = ['nuevos', 'cruzada', 'renovaciones', 'greenywave', 'cobertura', 'metaVendedor'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
};

// Headers de seguridad aplicados a TODA respuesta (JSON y estáticos).
//
// CSP: login.html ya no tiene JS inline (se movió a assets/js/login.js), así que
// script-src puede quedar sin 'unsafe-inline' — esto bloquea justo el vector de XSS
// encontrado en la auditoría (onerror=/onclick= inyectado vía nombres de plantilla),
// que dependía de ejecutar un atributo de evento inline. Sí se necesita:
//  - 'unsafe-eval' en script-src: el Tailwind Play CDN (cdn.tailwindcss.com) compila
//    utilidades en tiempo real en el navegador y la documentación oficial lo marca
//    "no apto para producción" justo por este tipo de fricción con CSP estrictas; no
//    hay forma de confirmar sin probarlo en un navegador real si lo necesita o no, así
//    que se deja habilitado a propósito — incluirlo de más nunca rompe nada, omitirlo
//    de menos sí podría dejar toda la app sin estilos si resulta que sí lo usa.
//  - 'unsafe-inline' en style-src: todo el HTML generado dinámicamente en assets/js/*
//    usa atributos style="..." en vez de clases — sacarlo requeriría reescribir esa
//    parte entera de la UI, fuera de alcance de este arreglo puntual.
// object-src/base-uri/form-action/frame-ancestors quedan restrictivos porque nada en
// la app usa <object>/<embed>, cambia el <base>, envía forms nativos a otro origen, ni
// necesita ser embebido en un iframe.
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
  'Content-Security-Policy': CSP,
};

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Acumula los chunks como Buffers y decodifica UTF-8 una sola vez al final —
    // concatenar con "body += chunk" convierte cada chunk a string por separado,
    // lo que puede partir un carácter multibyte (tildes, ñ) justo en el borde entre
    // dos chunks TCP y corromperlo. Con payloads chicos casi nunca se nota, pero es
    // un bug real de la versión anterior.
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > (maxBytes || 1e6)) { req.destroy(); reject(new Error('Carga demasiado grande.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS, extraHeaders || {}));
  res.end(JSON.stringify(obj));
}

function serveLoginPage(req, res) {
  // no-store: es la página de login de una app en una máquina posiblemente compartida —
  // no debe quedar en el caché de disco ni en el historial "atrás" del navegador.
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
  fs.createReadStream(path.join(ROOT, 'login.html')).pipe(res);
}

// Rate limiting de login en memoria: 5 intentos fallidos en una ventana de 15 minutos
// bloquean ese username (COLLATE NOCASE -> se clavea en minúsculas) por 15 minutos más.
// Map simple porque este es un proceso único, sin clustering — un reinicio del server
// resetea los contadores, lo cual es una compensación aceptable para no meter persistencia.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginAttempts = new Map(); // usernameLowerCase -> { count, windowStart, lockedUntil }

function getLoginLockout(usernameKey) {
  const entry = loginAttempts.get(usernameKey);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil && now < entry.lockedUntil) return entry.lockedUntil;
  // Lockout vencido o ventana vieja sin llegar al límite: no hay bloqueo activo.
  return 0;
}

function registerLoginFailure(usernameKey) {
  const now = Date.now();
  let entry = loginAttempts.get(usernameKey);
  if (!entry || (now - entry.windowStart) > LOGIN_WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: 0 };
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
  loginAttempts.set(usernameKey, entry);
}

function clearLoginAttempts(usernameKey) {
  loginAttempts.delete(usernameKey);
}

async function handleLoginPost(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const rateLimitKey = username.toLowerCase();

  if (getLoginLockout(rateLimitKey)) {
    return sendJson(res, 429, { error: 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.' });
  }

  const user = db.getByUsername(username);
  if (!user || !user.is_active) {
    // Username inexistente o inactivo: igualamos el costo de CPU con un scrypt dummy
    // para que el tiempo de respuesta no delate si el username existe o no.
    auth.dummyHash();
    registerLoginFailure(rateLimitKey);
    return sendJson(res, 401, { error: 'Usuario o contraseña incorrectos.' });
  }
  if (!auth.verifyPassword(password, user.password_hash, user.password_salt)) {
    registerLoginFailure(rateLimitKey);
    return sendJson(res, 401, { error: 'Usuario o contraseña incorrectos.' });
  }

  clearLoginAttempts(rateLimitKey);
  const token = auth.sign(user.username);
  sendJson(res, 200,
    { ok: true, isAdmin: !!user.is_admin, mustChangePassword: !!user.must_change_password },
    { 'Set-Cookie': auth.sessionCookie(token) });
}

function handleLogoutPost(req, res, rawToken) {
  auth.revoke(rawToken);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
}

function handleSessionGet(req, res, user) {
  sendJson(res, 200, { id: user.id, username: user.username, area: user.area, isAdmin: !!user.is_admin, mustChangePassword: !!user.must_change_password });
}

// Requisitos mínimos de seguridad para cualquier contraseña nueva que elija un usuario
// (primer ingreso con contraseña temporal, o cambio posterior): mínimo 8 caracteres,
// una minúscula, una mayúscula, un número y un carácter especial.
function passwordPolicyError(password) {
  // Mensaje genérico a propósito, en línea con el checklist del cliente (login.html):
  // listar acá solo el primer requisito que falla sería incompleto si faltan varios.
  const ok = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) &&
             /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
  return ok ? null : 'La contraseña no cumple con los parámetros de seguridad.';
}

async function handleChangePasswordPost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  // La cookie de sesión ya prueba que este usuario se autenticó (con la contraseña
  // temporal u otra) — no se vuelve a pedir la contraseña actual.
  const newPassword = String(body.newPassword || '');
  const policyError = passwordPolicyError(newPassword);
  if (policyError) return sendJson(res, 400, { error: policyError });
  db.updatePassword(user.id, newPassword, false);
  sendJson(res, 200, { ok: true });
}

function handleAdminUsersGet(req, res, user) {
  const users = db.listUsers();
  if (user.area === db.UNRESTRICTED_AREA) return sendJson(res, 200, { users });
  // Jefe de área (admin acotado a un área): solo ve su propia fila y las de los
  // líderes (no-admin) de su misma área — nunca usuarios de otras áreas ni otros admins.
  const scoped = users.filter((u) => u.id === user.id || (u.area === user.area && !u.is_admin));
  sendJson(res, 200, { users: scoped });
}

async function handleAdminUsersPost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const username = String(body.username || '').trim();
  if (!username) return sendJson(res, 400, { error: 'Falta el nombre de usuario.' });
  if (db.getByUsername(username)) return sendJson(res, 400, { error: 'Ese usuario ya existe.' });

  const area = String(body.area || '');
  if (!db.VALID_AREAS.includes(area)) return sendJson(res, 400, { error: 'Área inválida.' });

  if (user.area !== db.UNRESTRICTED_AREA) {
    // Un jefe de área solo puede crear líderes (no-admin) dentro de su propia área.
    if (area !== user.area) return sendJson(res, 403, { error: 'Solo podés crear usuarios en tu propia área.' });
    if (!!body.isAdmin) return sendJson(res, 403, { error: 'No tenés permiso para crear administradores.' });
  }

  const tempPassword = db.generateTempPassword();
  db.insertUser({ username, password: tempPassword, isAdmin: !!body.isAdmin, mustChange: true, area });
  sendJson(res, 200, { ok: true, tempPassword });
}

async function handleAdminResetPost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const target = db.getById(parseInt(body.id, 10));
  if (!target) return sendJson(res, 404, { error: 'Usuario no encontrado.' });
  if (!db.canManageUser(user, target)) return sendJson(res, 403, { error: 'No tenés permiso sobre este usuario.' });

  const tempPassword = db.generateTempPassword();
  db.updatePassword(target.id, tempPassword, true);
  sendJson(res, 200, { ok: true, tempPassword });
}

async function handleAdminToggleActivePost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const target = db.getById(parseInt(body.id, 10));
  if (!target) return sendJson(res, 404, { error: 'Usuario no encontrado.' });
  if (target.username === 'admin') return sendJson(res, 400, { error: 'No se puede desactivar al usuario super administrador.' });
  if (!db.canManageUser(user, target)) return sendJson(res, 403, { error: 'No tenés permiso sobre este usuario.' });

  db.setActive(target.id, !target.is_active);
  sendJson(res, 200, { ok: true, isActive: !target.is_active });
}

async function handleAdminEditPost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const target = db.getById(parseInt(body.id, 10));
  if (!target) return sendJson(res, 404, { error: 'Usuario no encontrado.' });
  if (!db.canManageUser(user, target)) return sendJson(res, 403, { error: 'No tenés permiso sobre este usuario.' });

  const username = String(body.username || '').trim();
  if (!username) return sendJson(res, 400, { error: 'Falta el nombre de usuario.' });

  const area = String(body.area || '');
  if (!db.VALID_AREAS.includes(area)) return sendJson(res, 400, { error: 'Área inválida.' });

  const collision = db.getByUsername(username);
  if (collision && collision.id !== target.id) return sendJson(res, 400, { error: 'Ese nombre de usuario ya está en uso.' });

  let isAdmin = !!body.isAdmin;
  let finalArea = area;

  if (target.username === 'admin') {
    // El super administrador "admin" siempre debe existir con máximo privilegio —
    // no se puede renombrar, degradar ni reasignar de área, ni siquiera por otro
    // admin con área "todas".
    if (username !== 'admin' || area !== db.UNRESTRICTED_AREA || !isAdmin) {
      return sendJson(res, 400, { error: 'No se puede modificar la identidad ni los privilegios del usuario super administrador.' });
    }
  } else if (user.id === target.id) {
    // Autoedición: el formulario solo debe poder cambiar el nombre de usuario. Nunca
    // confiar en el área/isAdmin que mande el cliente acá — un jefe de área editando
    // su propia fila podría autodegradarse por accidente (p.ej. checkbox oculto en la
    // UI para su rol) si tomáramos esos valores tal cual.
    finalArea = target.area;
    isAdmin = !!target.is_admin;
  } else if (user.area !== db.UNRESTRICTED_AREA) {
    // Jefe de área editando a un líder de su propia área: no puede reasignar de
    // área ni otorgar permisos de administrador.
    if (area !== user.area) return sendJson(res, 403, { error: 'No podés reasignar usuarios a otra área.' });
    if (isAdmin) return sendJson(res, 403, { error: 'No tenés permiso para otorgar permisos de administrador.' });
  }

  const updated = db.updateDetails(target.id, { username, area: finalArea, isAdmin });
  sendJson(res, 200, { ok: true, user: { id: updated.id, username: updated.username, area: updated.area, isAdmin: !!updated.is_admin } });
}

function handleAdminODataConfigGet(req, res) {
  sendJson(res, 200, db.getODataConfig());
}

async function handleAdminODataConfigPost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const endpointUrl = String(body.endpointUrl || '').trim();
  if (!endpointUrl) return sendJson(res, 400, { error: 'Falta la URL del endpoint OData.' });

  const authUser = String(body.authUser || '');
  const authPass = String(body.authPass || '');
  // Si el cliente no envía areaTemplates (guardado de solo credenciales), preservamos
  // lo ya guardado en vez de pisarlo con {} — de lo contrario un simple "Guardar
  // credenciales" borraría las plantillas configuradas por cada área.
  let areaTemplates;
  if (body.areaTemplates !== undefined && body.areaTemplates !== null) {
    areaTemplates = (typeof body.areaTemplates === 'object') ? body.areaTemplates : {};
  } else {
    areaTemplates = db.getODataConfig().areaTemplates;
  }

  const saved = db.saveODataConfig({ endpointUrl, authUser, authPass, areaTemplates, updatedBy: user.username });
  sendJson(res, 200, { ok: true, config: saved });
}

// Permite que el usuario de un área (jefe de área) edite ÚNICAMENTE las plantillas
// de SU área, sin tocar endpoint/credenciales ni las plantillas de otras áreas.
// Usa canEditAreaTemplates (área propia o "todas"), NO la misma regla que handleAnalisisPost:
// acá is_admin no da bypass automático — depende de que el área del usuario sea "todas".
async function handleODataAreaTemplatesPost(req, res, user) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const area = String(body.area || '');
  if (!db.VALID_AREAS.includes(area)) return sendJson(res, 400, { error: 'Área inválida.' });

  const templates = body.templates;
  if (!Array.isArray(templates) || !templates.every((t) => typeof t === 'string')) {
    return sendJson(res, 400, { error: 'Parámetros inválidos.' });
  }

  if (!db.canEditAreaTemplates(user, area)) {
    return sendJson(res, 403, { error: 'Tu usuario no pertenece a esta área.' });
  }

  const saved = db.saveAreaTemplates(area, templates, user.username);
  sendJson(res, 200, { ok: true, areaTemplates: saved.areaTemplates[area] });
}

// Variante admin-only del proxy: permite probar credenciales/URL SIN guardarlas todavía
// (paso "Cargar plantillas" del panel de parametrización, antes de pulsar Guardar).
// Es el único lugar donde el cliente puede seguir enviando credenciales explícitas,
// y solo llega hasta acá si la sesión ya pasó el chequeo de admin en requestHandler.
async function handleAdminODataTestPost(req, res) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const targetUrl = String(body.url || '');
  if (!targetUrl) return sendJson(res, 400, { error: 'Falta el parámetro url.' });

  performODataRequest(targetUrl, String(body.authUser || ''), String(body.authPass || ''), res, {});
}

function handleODataConfigGet(req, res) {
  const cfg = db.getODataConfig();
  sendJson(res, 200, { odataUrl: cfg.endpointUrl, areas: cfg.areaTemplates, savedAt: cfg.updatedAt });
}

async function handleAdminDeletePost(req, res, currentUser) {
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const target = db.getById(parseInt(body.id, 10));
  if (!target) return sendJson(res, 404, { error: 'Usuario no encontrado.' });
  if (target.username === 'admin') return sendJson(res, 400, { error: 'No se puede eliminar al usuario super administrador.' });
  if (target.id === currentUser.id) return sendJson(res, 400, { error: 'No podés eliminar tu propio usuario.' });
  if (!db.canManageUser(currentUser, target)) return sendJson(res, 403, { error: 'No tenés permiso sobre este usuario.' });

  db.deleteUser(target.id);
  sendJson(res, 200, { ok: true });
}

// Allowlist estricta de lo que este servidor tiene permitido servir. La app SOLO pide
// en tiempo de ejecución: "/", "/index.html", "/login.html" y cualquier cosa bajo
// "/assets/" (css + js) — todo lo demás en este directorio (data/, certs/, server.js,
// db.js, auth-lib.js, capturas, xlsx, mockups, etc.) es reservado o material suelto de
// referencia, nunca debe quedar expuesto por HTTP a una sesión autenticada.
//
// Resuelve una URL cruda a { relativePath, resolvedPath } SIEMPRE sobre la ruta ya
// decodificada y resuelta (nunca sobre el string crudo) — devuelve null si la URL trae
// una codificación inválida. Se usa acá Y en requestHandler para decidir si algo puede
// saltarse el chequeo de sesión: antes, ese chequeo comparaba el string crudo con
// startsWith('/assets/'), lo que dejaba pasar "/assets/../index.html" (la parte cruda
// arranca con "/assets/" aunque resuelva a otra cosa) directo a serveStatic sin sesión,
// sirviendo el dashboard completo sin login. Al compartir esta misma resolución en los
// dos lugares, la decisión siempre se toma sobre el destino REAL, no sobre el prefijo.
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
  return relativePath === 'index.html' ||
    relativePath === 'login.html' ||
    relativePath.startsWith('assets' + path.sep);
}

function serveStatic(req, res) {
  const resolved = resolveStaticPath(req.url);
  if (!resolved) {
    res.writeHead(400, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
    res.end('400 Bad Request');
    return;
  }
  const { relativePath, resolvedPath } = resolved;

  if (!isAllowedStaticPath(relativePath) || !fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const headers = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, SECURITY_HEADERS);
  if (relativePath === 'index.html' || relativePath === 'login.html') {
    // no-store: dashboard autenticado y página de login no deben quedar en caché de
    // disco/back-button en una máquina compartida. Los assets (css/js) NO llevan esto —
    // mantienen su cacheo normal, no hay beneficio de seguridad y sí costo de performance.
    headers['Cache-Control'] = 'no-store';
  }
  res.writeHead(200, headers);
  fs.createReadStream(resolvedPath).pipe(res);
}

function readAnalisis() {
  try {
    const raw = fs.readFileSync(ANALISIS_FILE, 'utf8');
    const data = JSON.parse(raw);
    // Migra comentarios viejos (texto plano, sin autor) al formato {text, updatedBy, updatedAt}.
    Object.keys(data).forEach((area) => {
      Object.keys(data[area] || {}).forEach((cardId) => {
        Object.keys(data[area][cardId] || {}).forEach((month) => {
          const entry = data[area][cardId][month];
          if (typeof entry === 'string') {
            data[area][cardId][month] = { text: entry, updatedBy: null, updatedAt: null };
          }
        });
      });
    });
    return data;
  } catch (e) {
    return {};
  }
}

function writeAnalisis(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ANALISIS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function handleAnalisisGet(req, res) {
  res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
  res.end(JSON.stringify(readAnalisis()));
}

async function handleAnalisisPost(req, res, user) {
  // Usa readJsonBody (acumula Buffers y decodifica UTF-8 una sola vez al final) en vez
  // de reimplementar su propio "body += chunk" — esa reimplementación reintroducía el
  // bug de corromper caracteres multibyte (á/ñ) partidos justo en el borde entre dos
  // chunks TCP, que ya se había arreglado para el resto de los handlers POST.
  let payload;
  try { payload = await readJsonBody(req, 1e6); }
  catch (e) {
    res.writeHead(400, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
    res.end(JSON.stringify({ error: 'JSON inválido.' }));
    return;
  }

  const area = payload.area;
  const cardId = payload.cardId;
  const comments = payload.comments;
  if (ANALISIS_AREAS.indexOf(area) === -1 || ANALISIS_CARDS.indexOf(cardId) === -1 || typeof comments !== 'object' || comments === null) {
    res.writeHead(400, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
    res.end(JSON.stringify({ error: 'Parámetros inválidos.' }));
    return;
  }

  if (!db.canAccessArea(user, area)) {
    res.writeHead(403, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
    res.end(JSON.stringify({ error: 'Tu usuario no pertenece a esta área.' }));
    return;
  }

  const store = readAnalisis();
  if (!store[area]) store[area] = {};
  if (!store[area][cardId]) store[area][cardId] = {};

  Object.keys(comments).forEach((monthKey) => {
    const m = parseInt(monthKey, 10);
    if (isNaN(m) || m < 0 || m > 11) return;
    const text = String(comments[monthKey] || '').slice(0, 5000);
    const existing = store[area][cardId][m];
    const hadContent = existing && existing.text && existing.text.trim() !== '';

    if (text.trim() === '') {
      // Solo dejamos rastro si efectivamente había algo para borrar —
      // evita generar registros de "borrado" en meses que nunca tuvieron texto.
      if (hadContent) {
        store[area][cardId][m] = { text: '', updatedBy: user.username, updatedAt: new Date().toISOString(), deleted: true };
      }
      return;
    }
    store[area][cardId][m] = { text, updatedBy: user.username, updatedAt: new Date().toISOString() };
  });

  writeAnalisis(store);
  res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
  res.end(JSON.stringify({ ok: true, data: store[area][cardId] }));
}

const ALLOWED_ODATA_HOSTS = ['172.16.16.171', '172.16.16.175', '172.16.16.199', '190.145.254.194', 'bpm.webapidashboard.integrasoftsas.co'];

// Núcleo del proxy OData, reutilizado por dos rutas:
//  - proxyOData(): ruta normal (/odata-proxy), usa SIEMPRE las credenciales guardadas
//    en el servidor (odata_config) — ignora cualquier header de auth del cliente.
//  - handleAdminODataTestPost(): ruta admin-only para probar credenciales aún no
//    guardadas (panel de parametrización, paso "Cargar plantillas").
function performODataRequest(targetUrl, authUser, authPass, res, extraHeaders) {
  extraHeaders = extraHeaders || {};

  let target;
  try { target = new URL(targetUrl); }
  catch (e) {
    res.writeHead(400, Object.assign({ 'Content-Type': 'text/plain' }, extraHeaders));
    res.end('URL inválida.');
    return;
  }

  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain' }, extraHeaders));
    res.end('Host no permitido.');
    return;
  }

  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  const fwdHeaders = { Accept: 'application/json', 'User-Agent': 'CMI-SICSS/1.0' };
  if (authUser) {
    fwdHeaders['Authorization'] = 'Basic ' + Buffer.from(authUser + ':' + (authPass || '')).toString('base64');
  }

  const options = {
    hostname: target.hostname,
    port: target.port ? parseInt(target.port, 10) : (isHttps ? 443 : 80),
    path: target.pathname + (target.search || ''),
    method: 'GET',
    headers: fwdHeaders,
    timeout: 20000,
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const status = proxyRes.statusCode;
    const resHeaders = Object.assign({ 'Content-Type': proxyRes.headers['content-type'] || 'application/json' }, extraHeaders);

    if (status === 401) {
      // Devolver el 401 tal cual para que el cliente muestre mensaje claro
      res.writeHead(401, resHeaders);
      res.end('{"error":"HTTP 401 — Credenciales incorrectas o no proporcionadas."}');
      return;
    }
    res.writeHead(status, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(504, Object.assign({ 'Content-Type': 'text/plain' }, extraHeaders));
    res.end('Timeout al conectar con el servidor OData.');
  });

  proxyReq.on('error', (e) => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, Object.assign({ 'Content-Type': 'text/plain' }, extraHeaders));
    res.end('Error de red: ' + e.message);
  });

  proxyReq.end();
}

function proxyOData(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const targetUrl = parsed.searchParams.get('url');

  if (!targetUrl) {
    res.writeHead(400, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
    res.end('Parámetro ?url= requerido.');
    return;
  }

  const cfg = db.getODataConfig();
  if (!cfg.endpointUrl) {
    res.writeHead(409, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
    res.end('OData no configurado. Un administrador debe configurarlo en Parametrización.');
    return;
  }

  // Nunca se lee ningún header de auth enviado por el cliente acá — las credenciales
  // siempre vienen del servidor (odata_config), sin importar quién sea el usuario.
  performODataRequest(targetUrl, cfg.authUser, cfg.authPass, res, CORS);
}

// Alias de columna de la tabla de hechos de tickets de Soluciones — mismos alias que
// el target 'tickets' de area-catalog.js (soluciones), duplicados acá a propósito:
// area-catalog.js es código de navegador (no se requiere desde server.js) y este
// endpoint necesita resolver las mismas columnas de forma independiente.
const SOLUCIONES_TICKET_ALIASES = {
  estado:      ['estado','status'],
  accion:      ['accion','action'],
  cliente:     ['cliente','client'],
  producto:    ['producto','product'],
  recurso:     ['recurso_accion','recurso','resource'],
  diagnostico: ['diagnostico','diagnosis'],
  fecha:       ['fecha_soporte_inicial','fecha_soporte','fechasoporte'],
};

// Trae las filas de UNA plantilla OData (JSON, sin pipe/streaming — a diferencia de
// performODataRequest(), acá necesitamos el body completo en memoria para poder
// agregarlo con CMI_MAPPER.buildTicketStats antes de responder). Reutiliza el mismo
// allowlist de hosts que el proxy — nunca lo debilita.
async function fetchODataRows(baseUrl, tplName, authUser, authPass) {
  const base = baseUrl.replace(/\/+$/, '');
  const url = base + '/' + encodeURIComponent(tplName) + '?$format=json';

  let target;
  try { target = new URL(url); }
  catch (e) { throw new Error('URL de plantilla inválida.'); }
  if (!ALLOWED_ODATA_HOSTS.includes(target.hostname)) {
    throw new Error('Host no permitido.');
  }

  const headers = { Accept: 'application/json', 'User-Agent': 'CMI-SICSS/1.0' };
  if (authUser) headers['Authorization'] = 'Basic ' + Buffer.from(authUser + ':' + (authPass || '')).toString('base64');

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al consultar la plantilla "' + tplName + '".');
  const data = await res.json();
  return Array.isArray(data && data.value) ? data.value : (Array.isArray(data) ? data : []);
}

// Agregación server-side del backlog/confiabilidad de Soluciones. A diferencia del
// resto de las áreas (que reciben filas crudas en el navegador vía /odata-proxy), la
// plantilla de tickets trae ~7,5MB / miles de filas — bajarla entera a cada sesión
// (incluido mobile) en cada carga de página no tiene sentido cuando lo único que se
// pinta es el resumen agregado. Este endpoint hace el fetch + la agregación acá
// (misma lógica exacta que antes corría en el navegador — buildTicketStats() vive en
// mapper.js, compartido) y devuelve solo el resumen, unos pocos KB. El resto de las
// áreas NO se toca: son chicas y Comercial necesita el detalle fila por fila para su
// drill-down (ver renderComercialDetalle()).
async function handleSolucionesKpisGet(req, res) {
  try {
    const cfg = db.getODataConfig();
    if (!cfg.endpointUrl) return sendJson(res, 200, { ok: false, reason: 'no-config' });

    const tpls = (cfg.areaTemplates.soluciones && cfg.areaTemplates.soluciones.templates) || [];
    if (!tpls.length) return sendJson(res, 200, { ok: false, reason: 'no-template' });

    let allRows = [];
    for (const tplName of tpls) {
      const rows = await fetchODataRows(cfg.endpointUrl, tplName, cfg.authUser, cfg.authPass);
      allRows = allRows.concat(rows);
    }
    if (!allRows.length) return sendJson(res, 200, { ok: false, reason: 'no-rows' });

    const sample = allRows[0];
    const cols = {
      estado:      CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.estado),
      accion:      CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.accion),
      cliente:     CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.cliente),
      producto:    CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.producto),
      recurso:     CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.recurso),
      diagnostico: CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.diagnostico),
      fecha:       CMI_MAPPER.findAliasColumn(sample, SOLUCIONES_TICKET_ALIASES.fecha),
    };
    if (!cols.estado || !cols.accion || !cols.diagnostico || !cols.fecha) {
      return sendJson(res, 200, { ok: false, reason: 'columns' });
    }

    const stats = CMI_MAPPER.buildTicketStats(allRows, cols);
    return sendJson(res, 200, Object.assign({ ok: true }, stats));
  } catch (err) {
    // Nunca reenviar el mensaje crudo del error al cliente: podría filtrar la URL del
    // endpoint OData, credenciales en la query string, o detalles de infraestructura
    // interna — el detalle completo solo va a la consola del servidor.
    console.error('[soluciones/kpis] Error:', err.message);
    return sendJson(res, 502, { ok: false, error: 'No se pudo calcular el resumen de Soluciones.' });
  }
}

const NO_SESSION_ROUTES_WHEN_MUST_CHANGE = [
  ['GET', '/api/session'],
  ['POST', '/api/logout'],
  ['POST', '/api/change-password'],
];

async function requestHandler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const urlPath = req.url.split('?')[0];
  const isApi = urlPath.startsWith('/api/') || urlPath.startsWith('/odata-proxy');

  // Rutas que no requieren sesión
  if (urlPath === '/login' && req.method === 'GET') return serveLoginPage(req, res);
  if (urlPath === '/api/login' && req.method === 'POST') return handleLoginPost(req, res);
  // login.html carga su JS desde /assets/js/login.js (antes era inline, se movió a un
  // archivo aparte para la CSP) — sin esta excepción, un usuario sin sesión pedía ese
  // archivo, caía en denyUnauthenticated() más abajo y recibía un 302 a /login en vez
  // del JS real, rompiendo el formulario de login. La excepción se resuelve sobre la
  // ruta YA DECODIFICADA Y RESUELTA (resolveStaticPath), NO sobre un startsWith del
  // string crudo — una versión anterior comparaba el prefijo crudo y dejaba pasar
  // "/assets/../index.html" (o su variante %2e%2e codificada) directo a serveStatic sin
  // sesión, sirviendo el dashboard completo sin login. Resolviendo primero, esa misma
  // URL da relativePath "index.html", que NO empieza con "assets" + separador, así que
  // cae al chequeo de sesión normal como corresponde.
  if (req.method === 'GET') {
    const resolved = resolveStaticPath(req.url);
    if (resolved && resolved.relativePath.startsWith('assets' + path.sep)) {
      return serveStatic(req, res);
    }
  }

  function denyUnauthenticated() {
    if (isApi) { sendJson(res, 401, { error: 'No autenticado.' }); return; }
    res.writeHead(302, { Location: '/login' });
    res.end();
  }

  const cookies = auth.parseCookies(req);
  const username = auth.verify(cookies.sid);
  if (!username) return denyUnauthenticated();

  const user = db.getByUsername(username);
  if (!user || !user.is_active) return denyUnauthenticated();

  if (user.must_change_password) {
    const allowed = NO_SESSION_ROUTES_WHEN_MUST_CHANGE.some(([m, p]) => m === req.method && p === urlPath);
    if (!allowed) {
      if (isApi) { sendJson(res, 403, { error: 'Debe cambiar la contraseña.', mustChangePassword: true }); return; }
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
  }

  if (urlPath === '/api/session' && req.method === 'GET') return handleSessionGet(req, res, user);
  if (urlPath === '/api/logout' && req.method === 'POST') return handleLogoutPost(req, res, cookies.sid);
  if (urlPath === '/api/change-password' && req.method === 'POST') return handleChangePasswordPost(req, res, user);
  if (urlPath === '/api/odata-config' && req.method === 'GET') return handleODataConfigGet(req, res);
  if (urlPath === '/api/soluciones/kpis' && req.method === 'GET') return handleSolucionesKpisGet(req, res);
  if (urlPath === '/api/odata-config/area-templates' && req.method === 'POST') return handleODataAreaTemplatesPost(req, res, user);

  if (urlPath.startsWith('/api/admin/')) {
    if (!user.is_admin) { sendJson(res, 403, { error: 'Requiere permisos de administrador.' }); return; }
    if (urlPath === '/api/admin/users' && req.method === 'GET') return handleAdminUsersGet(req, res, user);
    if (urlPath === '/api/admin/users' && req.method === 'POST') return handleAdminUsersPost(req, res, user);
    if (urlPath === '/api/admin/users/reset' && req.method === 'POST') return handleAdminResetPost(req, res, user);
    if (urlPath === '/api/admin/users/toggle' && req.method === 'POST') return handleAdminToggleActivePost(req, res, user);
    if (urlPath === '/api/admin/users/edit' && req.method === 'POST') return handleAdminEditPost(req, res, user);
    if (urlPath === '/api/admin/users/delete' && req.method === 'POST') return handleAdminDeletePost(req, res, user);
    if (urlPath === '/api/admin/odata-config' && req.method === 'GET') return handleAdminODataConfigGet(req, res);
    if (urlPath === '/api/admin/odata-config' && req.method === 'POST') return handleAdminODataConfigPost(req, res, user);
    if (urlPath === '/api/admin/odata-config/test' && req.method === 'POST') return handleAdminODataTestPost(req, res);
    sendJson(res, 404, { error: 'No encontrado.' });
    return;
  }

  if (urlPath.startsWith('/odata-proxy')) return proxyOData(req, res);

  if (urlPath.startsWith('/api/analisis')) {
    if (req.method === 'GET') return handleAnalisisGet(req, res);
    if (req.method === 'POST') return handleAnalisisPost(req, res, user);
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Método no permitido.');
    return;
  }

  return serveStatic(req, res);
}

db.bootstrapAdmin();

const httpsOptions = {
  key: fs.readFileSync(path.join(ROOT, 'certs', 'key.pem')),
  cert: fs.readFileSync(path.join(ROOT, 'certs', 'cert.pem')),
};

https.createServer(httpsOptions, (req, res) => {
  requestHandler(req, res).catch((err) => {
    console.error('[server] Error no manejado:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Error interno.' });
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  CMI SICSS 2026 — servidor local listo (HTTPS)');
  console.log('  ► https://localhost:' + PORT);
  console.log('  ► https://190.145.254.194:' + PORT);
  console.log('  ► https://172.16.16.171:' + PORT);
  console.log('');
  console.log('  Proxy OData activo (Basic Auth soportado)');
  console.log('  Ctrl+C para detener.');
  console.log('');
});
