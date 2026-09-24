const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function getSecret() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    return fs.readFileSync(SECRET_FILE);
  } catch (e) {
    const secret = crypto.randomBytes(32);
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

const SECRET = getSecret();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// Contraseña/salt fijos usados SOLO para igualar el costo de CPU cuando el username
// no existe (o está inactivo) y por lo tanto verifyPassword nunca se ejecuta — sin esto,
// la respuesta de login sería medible más rápida para usernames inexistentes, filtrando
// qué usuarios son válidos (username enumeration por timing).
const DUMMY_PASSWORD = 'dummy-password-para-igualar-tiempos';
const DUMMY_SALT = 'dummy-salt-fija-no-secreta';

function dummyHash() {
  crypto.scryptSync(DUMMY_PASSWORD, DUMMY_SALT, 64);
}

function sign(username) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = username + '|' + expiry;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

// Tokens revocados (logout) antes de su vencimiento natural. Se guarda el expiry ya
// embebido en el propio token para poder podar entradas vencidas y que el Set nunca
// crezca más allá de "sesiones deslogueadas dentro de su ventana de TTL restante".
const revokedTokens = new Map(); // token completo -> expiry (ms epoch)

function pruneRevokedTokens() {
  const now = Date.now();
  for (const [token, expiry] of revokedTokens) {
    if (expiry <= now) revokedTokens.delete(token);
  }
}

function revoke(token) {
  if (!token) return;
  const parts = token.split('.');
  let expiry = Date.now() + SESSION_TTL_MS; // fallback conservador si el payload no parsea
  if (parts.length === 2) {
    try {
      const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
      const sep = payload.lastIndexOf('|');
      if (sep !== -1) {
        const parsedExpiry = parseInt(payload.slice(sep + 1), 10);
        if (!isNaN(parsedExpiry)) expiry = parsedExpiry;
      }
    } catch (e) { /* se mantiene el fallback */ }
  }
  pruneRevokedTokens();
  revokedTokens.set(token, expiry);
}

function verify(token) {
  if (!token) return null;
  pruneRevokedTokens();
  if (revokedTokens.has(token)) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const sep = payload.lastIndexOf('|');
  if (sep === -1) return null;
  const username = payload.slice(0, sep);
  const expiry = parseInt(payload.slice(sep + 1), 10);
  if (isNaN(expiry) || Date.now() > expiry) return null;
  return username;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionCookie(token) {
  return 'sid=' + encodeURIComponent(token) + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000);
}

function clearCookie() {
  return 'sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

module.exports = { hashPassword, verifyPassword, dummyHash, sign, verify, revoke, parseCookies, sessionCookie, clearCookie };
