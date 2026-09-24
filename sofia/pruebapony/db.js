const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const auth = require('./auth-lib');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'users.db'));
db.pragma('journal_mode = WAL');

const AREAS = ['comercial', 'financiera', 'proyectos', 'soluciones', 'ids'];
const UNRESTRICTED_AREA = 'todas';
const VALID_AREAS = AREAS.concat(UNRESTRICTED_AREA);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT NOT NULL,
    password_salt        TEXT NOT NULL,
    is_admin             INTEGER NOT NULL DEFAULT 0,
    is_active            INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migración: agrega la columna "area" si la base ya existía de una versión anterior.
const existingCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!existingCols.includes('area')) {
  db.exec(`ALTER TABLE users ADD COLUMN area TEXT NOT NULL DEFAULT '${UNRESTRICTED_AREA}'`);
}

// Configuración OData centralizada (endpoint + credenciales + plantillas por área).
// Fila única (id = 1): el admin la configura una sola vez y todos los demás usuarios
// la heredan al iniciar sesión, sin volver a ingresar nada. Las credenciales NUNCA
// se exponen a sesiones no-admin (ver /api/odata-config vs /api/admin/odata-config).
const DEFAULT_AREA_TEMPLATES = AREAS.reduce((acc, area) => {
  acc[area] = { templates: [] };
  return acc;
}, {});

db.exec(`
  CREATE TABLE IF NOT EXISTS odata_config (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    endpoint_url   TEXT NOT NULL DEFAULT '',
    auth_user      TEXT NOT NULL DEFAULT '',
    auth_pass      TEXT NOT NULL DEFAULT '',
    area_templates TEXT NOT NULL DEFAULT '{}',
    updated_at     TEXT,
    updated_by     TEXT
  );
`);

const stmts = {
  getByUsername:  db.prepare('SELECT * FROM users WHERE username = ?'),
  getById:        db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser:     db.prepare('INSERT INTO users (username, password_hash, password_salt, is_admin, must_change_password, area) VALUES (?, ?, ?, ?, ?, ?)'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = ? WHERE id = ?'),
  setActive:      db.prepare('UPDATE users SET is_active = ? WHERE id = ?'),
  updateDetails:  db.prepare('UPDATE users SET username = ?, area = ?, is_admin = ? WHERE id = ?'),
  deleteUser:     db.prepare('DELETE FROM users WHERE id = ?'),
  listUsers:      db.prepare('SELECT id, username, is_admin, is_active, must_change_password, area, created_at FROM users ORDER BY username'),
  countUsers:     db.prepare('SELECT COUNT(*) AS n FROM users'),
  getODataConfig: db.prepare('SELECT * FROM odata_config WHERE id = 1'),
  upsertODataConfig: db.prepare(`
    INSERT INTO odata_config (id, endpoint_url, auth_user, auth_pass, area_templates, updated_at, updated_by)
    VALUES (1, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET
      endpoint_url   = excluded.endpoint_url,
      auth_user      = excluded.auth_user,
      auth_pass      = excluded.auth_pass,
      area_templates = excluded.area_templates,
      updated_at     = excluded.updated_at,
      updated_by     = excluded.updated_by
  `),
};

function getByUsername(username) { return stmts.getByUsername.get(username); }
function getById(id) { return stmts.getById.get(id); }
function listUsers() { return stmts.listUsers.all(); }
function countUsers() { return stmts.countUsers.get().n; }

function insertUser({ username, password, isAdmin, mustChange, area }) {
  const safeArea = VALID_AREAS.includes(area) ? area : UNRESTRICTED_AREA;
  const { hash, salt } = auth.hashPassword(password);
  const info = stmts.insertUser.run(username, hash, salt, isAdmin ? 1 : 0, mustChange ? 1 : 0, safeArea);
  return getById(info.lastInsertRowid);
}

function canAccessArea(user, area) {
  return !!user.is_admin || user.area === UNRESTRICTED_AREA || user.area === area;
}

// Regla de permisos específica para editar plantillas de área (panel de Parametrización,
// editor inline por área): a diferencia de canAccessArea, NO da bypass a is_admin —
// solo el jefe del área (o un usuario con área "todas") puede editar sus propias plantillas.
function canEditAreaTemplates(user, area) {
  return user.area === UNRESTRICTED_AREA || user.area === area;
}

// Regla de permisos para la gestión de usuarios (crear/editar/eliminar/resetear/activar):
// distinta de canAccessArea y canEditAreaTemplates a propósito, mismo patrón de este
// archivo (una función por caso de uso, sin consolidar). Un admin "todas" (super admin
// o cualquier admin con área "todas") puede gestionar a cualquiera; un admin de área
// (jefe de área) solo puede gestionar líderes (no-admin) de su misma área; siempre se
// puede tocar la propia fila (p.ej. para renombrarse a sí mismo).
function canManageUser(actingUser, targetUser) {
  if (!actingUser.is_admin) return false;
  if (actingUser.id === targetUser.id) return true; // siempre puede tocar su propia fila; la auto-eliminación se bloquea aparte
  if (actingUser.area === UNRESTRICTED_AREA) return true;
  return targetUser.area === actingUser.area && !targetUser.is_admin;
}

function updatePassword(id, password, mustChange) {
  const { hash, salt } = auth.hashPassword(password);
  stmts.updatePassword.run(hash, salt, mustChange ? 1 : 0, id);
}

function setActive(id, active) {
  stmts.setActive.run(active ? 1 : 0, id);
}

function updateDetails(id, { username, area, isAdmin }) {
  const safeArea = VALID_AREAS.includes(area) ? area : UNRESTRICTED_AREA;
  stmts.updateDetails.run(username, safeArea, isAdmin ? 1 : 0, id);
  return getById(id);
}

function deleteUser(id) {
  stmts.deleteUser.run(id);
}

function getODataConfig() {
  const row = stmts.getODataConfig.get();
  if (!row) {
    return {
      endpointUrl: '',
      authUser: '',
      authPass: '',
      areaTemplates: JSON.parse(JSON.stringify(DEFAULT_AREA_TEMPLATES)),
      updatedAt: null,
      updatedBy: null,
    };
  }
  let areaTemplates;
  try { areaTemplates = JSON.parse(row.area_templates); }
  catch (e) { areaTemplates = JSON.parse(JSON.stringify(DEFAULT_AREA_TEMPLATES)); }
  // Completa cualquier área ausente del blob guardado (p.ej. una fila escrita por una
  // versión anterior con el bug de "credenciales pisan plantillas") para que quien
  // consuma esto (modal admin, editor por área) siempre tenga las 5 áreas con
  // `.templates`, sin importar qué haya quedado persistido.
  AREAS.forEach((a) => { if (!areaTemplates[a]) areaTemplates[a] = { templates: [] }; });
  return {
    endpointUrl: row.endpoint_url,
    authUser: row.auth_user,
    authPass: row.auth_pass,
    areaTemplates,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function saveODataConfig({ endpointUrl, authUser, authPass, areaTemplates, updatedBy }) {
  stmts.upsertODataConfig.run(
    endpointUrl || '',
    authUser || '',
    authPass || '',
    JSON.stringify(areaTemplates || DEFAULT_AREA_TEMPLATES),
    updatedBy || null
  );
  return getODataConfig();
}

// Guarda solo las plantillas de UN área, sin tocar endpoint/credenciales ni las
// plantillas de las demás áreas — usado por el endpoint que cada jefe de área
// puede llamar para editar su propia área (ver canAccessArea).
function saveAreaTemplates(area, templates, updatedBy) {
  const current = getODataConfig();
  const areaTemplates = Object.assign({}, current.areaTemplates);
  areaTemplates[area] = { templates };
  stmts.upsertODataConfig.run(
    current.endpointUrl || '',
    current.authUser || '',
    current.authPass || '',
    JSON.stringify(areaTemplates),
    updatedBy || null
  );
  return getODataConfig();
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

function bootstrapAdmin() {
  if (countUsers() > 0) return;
  const tempPassword = generateTempPassword();
  insertUser({ username: 'admin', password: tempPassword, isAdmin: true, mustChange: true, area: UNRESTRICTED_AREA });
  console.log('');
  console.log('  ================================================================');
  console.log('  Primer arranque: se creó el usuario administrador "admin".');
  console.log('  Contraseña temporal (solo se muestra esta vez): ' + tempPassword);
  console.log('  Se pedirá cambiarla en el primer inicio de sesión.');
  console.log('  ================================================================');
  console.log('');
}

module.exports = {
  getByUsername, getById, listUsers, countUsers,
  insertUser, updatePassword, setActive, updateDetails, deleteUser, generateTempPassword, bootstrapAdmin,
  canAccessArea, canEditAreaTemplates, canManageUser, AREAS, UNRESTRICTED_AREA, VALID_AREAS,
  getODataConfig, saveODataConfig, saveAreaTemplates,
};
