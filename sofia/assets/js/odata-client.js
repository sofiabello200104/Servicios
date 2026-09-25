(function () {
  'use strict';

  // Adapted from the reference project's odata-client.js. Renamed
  // CMI_ODATA -> SOFIA_ODATA. Kept getJson()/getJsonPreview()/
  // buildTemplateUrl() and their behavior: getJson() always goes through
  // the server-side proxy (the browser never sees stored credentials),
  // getJsonPreview() is for testing unsaved credentials from the
  // Parametrización panel.

  function trimSlash(u) { return u.replace(/\/+$/, ''); }

  function ensureProtocol(u) {
    u = u.trim();
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  async function getJson(targetUrl) {
    var res;
    try {
      res = await fetch(targetUrl, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Verifica que esté disponible.');
    }
    if (res.status === 401) throw new Error('HTTP 401 — Sin acceso. Verifica las credenciales.');
    if (res.status === 409) throw new Error('OData no configurado. Configúralo en Parametrización.');
    if (!res.ok) throw new Error('HTTP ' + res.status + ' al consultar el endpoint OData.');
    return res.json();
  }

  // Prueba de conexión con credenciales/URL aún no guardadas (panel de
  // Parametrización, botón "Probar conexión"). Nunca construye el header de
  // Authorization en el navegador para la ruta normal — solo acá, donde el
  // usuario está probando explícitamente antes de guardar.
  async function getJsonPreview(endpointUrl, templateName, auth) {
    var res;
    try {
      res = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: endpointUrl,
          templateName: templateName,
          authUser: (auth && auth.username) || '',
          authPass: (auth && auth.password) || ''
        })
      });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Verifica que esté disponible.');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' al probar la conexión.');
    return res.json();
  }

  function buildTemplateUrl(baseUrl, templateName, opts) {
    opts = opts || {};
    var base = trimSlash(ensureProtocol(baseUrl));
    var params = new URLSearchParams();
    params.set('$format', 'json');
    if (opts.top) params.set('$top', String(opts.top));
    return base + '/' + encodeURIComponent(templateName) + '?' + params.toString();
  }

  function toRows(data) {
    // Handles both OData v2 ({ d: { results: [...] } }) and v4
    // ({ value: [...] }) response shapes, plus a bare array fallback.
    if (Array.isArray(data)) return data;
    if (data && data.d && Array.isArray(data.d.results)) return data.d.results;
    if (data && Array.isArray(data.value)) return data.value;
    return [];
  }

  // Sin argumentos: pide al servidor los datos de la plantilla ya
  // configurada (endpoint + credenciales viven solo en data/config.json,
  // nunca en el navegador). El servidor arma la URL final vía
  // buildTemplateRequestUrl() y adjunta el Authorization Basic él mismo.
  async function fetchTemplate() {
    return toRows(await getJson('/api/odata-proxy'));
  }

  window.SOFIA_ODATA = {
    getJson: getJson,
    getJsonPreview: getJsonPreview,
    buildTemplateUrl: buildTemplateUrl,
    toRows: toRows,
    fetchTemplate: fetchTemplate
  };
})();
