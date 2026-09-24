(function(){
  const DATA_KEY = 'cmi.rawdata.v1';
  const UPD_KEY  = 'cmi.updatedat.v1';

  function readUpdatedAtMap(){
    try{
      const raw = localStorage.getItem(UPD_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch{ return {}; }
  }

  // Config (URL del endpoint + plantillas por área) — vive SOLO en memoria.
  // Las credenciales OData ya no pasan por el navegador de usuarios no-admin:
  // el servidor las guarda y las adjunta él mismo en /odata-proxy. Ver /api/odata-config.
  let _configCache = null;

  window.CMI_STORE = {
    getConfig(){
      return _configCache;
    },
    // Reemplaza la config en memoria (ej: tras fetch a /api/odata-config o tras guardar
    // desde el panel de parametrización). No persiste nada en localStorage.
    saveConfig(cfg){
      _configCache = cfg || null;
      return _configCache;
    },
    clearConfig(){
      _configCache = null;
      localStorage.removeItem(DATA_KEY);
    },
    emptyConfig(){
      return {
        odataUrl : '',
        auth     : { username: '', password: '' },
        areas    : {
          comercial : { templates: [] },
          financiera: { templates: [] },
          proyectos : { templates: [] },
          soluciones: { templates: [] },
          ids       : { templates: [] },
        }
      };
    },

    // ── Datos crudos por plantilla (en memoria + localStorage) ───────────────
    getRawData(){
      try{
        const raw = localStorage.getItem(DATA_KEY);
        return raw ? JSON.parse(raw) : {};
      }catch{ return {}; }
    },
    saveRawData(dataObj){
      try{
        localStorage.setItem(DATA_KEY, JSON.stringify(dataObj));
      }catch(e){
        // localStorage lleno — guardamos solo en memoria
        console.warn('[store] No se pudo persistir datos crudos:', e.message);
      }
    },
    clearRawData(){ localStorage.removeItem(DATA_KEY); },

    // ── Fecha de última actualización exitosa, por área ───────────────────────
    saveAreaUpdatedAt(area, isoString){
      var map = readUpdatedAtMap();
      map[area] = isoString;
      try{
        localStorage.setItem(UPD_KEY, JSON.stringify(map));
      }catch(e){
        console.warn('[store] No se pudo persistir la fecha de actualización:', e.message);
      }
    },
    getAreaUpdatedAt(area){
      var map = readUpdatedAtMap();
      return map[area] || null;
    },
    getGlobalUpdatedAt(){
      var map = readUpdatedAtMap();
      var values = Object.keys(map).map(function(k){ return map[k]; });
      if(!values.length) return null;
      // Los ISO 8601 ordenan igual en comparación de texto que como fechas reales,
      // así que basta un max de strings — no hace falta parsear cada valor.
      return values.reduce(function(max, v){ return v > max ? v : max; });
    },
    formatUpdatedAt(iso){
      if(!iso) return 'Sin datos aún';
      var d = new Date(iso);
      if(isNaN(d.getTime())) return 'Sin datos aún';
      var dd   = String(d.getDate()).padStart(2, '0');
      var mm   = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      var h24  = d.getHours();
      var period = h24 < 12 ? 'a.m.' : 'p.m.';
      var h12  = h24 % 12 || 12;
      var hh   = String(h12).padStart(2, '0');
      var min  = String(d.getMinutes()).padStart(2, '0');
      return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min + ' ' + period;
    },

    // SQLite's datetime('now') devuelve "YYYY-MM-DD HH:MM:SS" en UTC, sin sufijo de
    // zona horaria. new Date() de un string así lo interpreta como hora LOCAL (no UTC)
    // en la mayoría de los navegadores, así que un guardado a las 13:44 UTC se mostraba
    // como "1:44 p.m." en vez de convertirlo a las 8:44 a.m. de Colombia (UTC-5).
    // Marcarlo explícitamente como UTC antes de parsear lo arregla para cualquier zona.
    parseUtc(s){
      if(!s) return null;
      var iso = s.indexOf('T') === -1 ? s.replace(' ', 'T') + 'Z' : (/Z|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z');
      return new Date(iso);
    }
  };

  // Exponer datos crudos en memoria para acceso rápido
  window.CMI_RAW_DATA = window.CMI_STORE.getRawData();
})();
