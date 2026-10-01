(function () {
  'use strict';

  // Adapted from the reference project's store.js. Renamed CMI_STORE ->
  // SOFIA_STORE and CMI_RAW_DATA -> SOFIA_RAW_TICKETS. Simplified for a
  // single-entity dashboard: one config object (no per-area templates), one
  // raw-tickets cache (no per-template map), one "last updated" timestamp
  // (no per-area map). Kept the localStorage-with-memory-fallback pattern:
  // if localStorage throws (quota, private mode) the app keeps working with
  // the in-memory copy for the rest of the session.

  const RAW_KEY = 'sofia.rawtickets.v1';
  const UPD_KEY = 'sofia.updatedat.v1';

  // Last successful load (raw tickets + Capacidad's extra-source rows), kept
  // in IndexedDB rather than localStorage: the live tickets payload is ~5 MB,
  // over localStorage's per-origin quota. Lets the app show the previous data
  // instantly on boot and keep showing it when the slow OData feed (~3 min,
  // sometimes timing out) fails, instead of a blank error screen.
  const SNAP_DB = 'sofia-snapshot';
  const SNAP_STORE = 'snapshots';
  const SNAP_KEY = 'latest';

  let _configCache = null;
  let _rawMemoryFallback = null;

  // Resolves with an open DB, or null when IndexedDB is unavailable
  // (private mode, blocked storage) -- callers then just skip the snapshot.
  function openSnapDb() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(SNAP_DB, 1); }
      catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(SNAP_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  function safeGetItem(key) {
    try { return localStorage.getItem(key); }
    catch (e) { return null; }
  }
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { console.warn('[store] No se pudo persistir en localStorage:', e.message); return false; }
  }

  window.SOFIA_STORE = {
    getConfig() { return _configCache; },
    saveConfig(cfg) { _configCache = cfg || null; return _configCache; },
    clearConfig() { _configCache = null; },

    // ── Ticket crudos (en memoria + localStorage con fallback) ──
    getRawTickets() {
      const raw = safeGetItem(RAW_KEY);
      if (raw) {
        try { return JSON.parse(raw); }
        catch (e) { /* falls through to memory fallback */ }
      }
      return _rawMemoryFallback || [];
    },
    saveRawTickets(rows) {
      _rawMemoryFallback = rows;
      try {
        safeSetItem(RAW_KEY, JSON.stringify(rows));
      } catch (e) {
        // JSON.stringify itself failed (circular etc.) — keep memory copy only.
        console.warn('[store] No se pudo serializar los datos crudos:', e.message);
      }
    },
    clearRawTickets() {
      _rawMemoryFallback = null;
      try { localStorage.removeItem(RAW_KEY); } catch (e) { /* ignore */ }
    },

    // ── Última carga exitosa completa (IndexedDB) ──
    // snapshot = { rows, extraRows, failedSources, updatedAt }. Both methods
    // never reject: a storage failure only means no snapshot.
    async saveSnapshot(snapshot) {
      const db = await openSnapDb();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(SNAP_STORE, 'readwrite');
          tx.objectStore(SNAP_STORE).put(snapshot, SNAP_KEY);
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = tx.onabort = () => {
            console.warn('[store] No se pudo guardar la copia local de los datos.');
            db.close();
            resolve(false);
          };
        } catch (e) { db.close(); resolve(false); }
      });
    },
    async loadSnapshot() {
      const db = await openSnapDb();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const req = db.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE).get(SNAP_KEY);
          req.onsuccess = () => { db.close(); resolve(req.result || null); };
          req.onerror = () => { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      });
    },

    // ── Fecha de última actualización exitosa ──
    saveUpdatedAt(isoString) { safeSetItem(UPD_KEY, isoString); },
    getUpdatedAt() { return safeGetItem(UPD_KEY); },
    formatUpdatedAt(iso) {
      if (!iso) return 'Sin datos aún';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return 'Sin datos aún';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const h24 = d.getHours();
      const period = h24 < 12 ? 'a.m.' : 'p.m.';
      const h12 = h24 % 12 || 12;
      const hh = String(h12).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min + ' ' + period;
    }
  };
})();
