(function () {
  'use strict';

  // Copia automática de datos: el workflow "Copia automática de datos (OData)"
  // publica cada hora en la rama `datos` del repositorio (público) los
  // archivos tickets.json.gz, correspondencia.json.gz y meta.json. SOFIA los
  // lee de aquí al abrir, para mostrar datos al instante aunque el servidor
  // OData esté lento o caído. Nunca contiene credenciales.
  var BASE = 'https://raw.githubusercontent.com/sofiabello200104/Servicios/datos/';
  var TIMEOUT_MS = 20000;

  async function fetchWithTimeout(url) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    try { return await fetch(url + '?t=' + Math.floor(Date.now() / 300000), { signal: ctl.signal, cache: 'no-store' }); }
    finally { clearTimeout(t); }
  }

  // name: 'tickets' | 'correspondencia'. Devuelve { ...datos, updatedAt } o
  // null si no hay copia (o el navegador no puede descomprimirla).
  async function load(name) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      var metaRes = await fetchWithTimeout(BASE + 'meta.json');
      if (!metaRes.ok) return null;
      var meta = await metaRes.json();
      var res = await fetchWithTimeout(BASE + name + '.json.gz');
      if (!res.ok || !res.body) return null;
      var data = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();
      data.updatedAt = meta.updatedAt || null;
      return data;
    } catch (e) {
      console.warn('[copia] No se pudo leer la copia automática:', e && e.message);
      return null;
    }
  }

  window.SOFIA_COPIA = { load: load };
})();
