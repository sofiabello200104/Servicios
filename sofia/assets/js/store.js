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

  let _configCache = null;
  let _rawMemoryFallback = null;

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
