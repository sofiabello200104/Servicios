(function(){
  function trimSlash(u){ return u.replace(/\/+$/,''); }

  function ensureProtocol(u){
    u = u.trim();
    if(u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  // Ruta normal (dashboard, cualquier usuario autenticado): el servidor adjunta las
  // credenciales guardadas — el cliente NUNCA construye un header de Authorization acá.
  async function getJson(targetUrl){
    var useProxy = window.location.protocol !== 'file:';
    var req = useProxy
      ? { url: window.location.origin + '/odata-proxy?url=' + encodeURIComponent(targetUrl), headers: { Accept: 'application/json' } }
      : { url: targetUrl, headers: { Accept: 'application/json' } };

    var res;
    try {
      res = await fetch(req.url, { headers: req.headers });
    } catch(e) {
      throw new Error('No se pudo conectar con el servidor OData. Verifica que esté disponible.');
    }
    if(res.status === 401) throw new Error('HTTP 401 — Sin acceso. Verifica credenciales.');
    if(res.status === 409) throw new Error('OData no configurado. Un administrador debe configurarlo en Parametrización.');
    if(!res.ok) throw new Error('HTTP ' + res.status + ' al consultar el endpoint OData.');
    return res.json();
  }

  // Ruta de PREVIEW (solo admin, panel de Parametrización): permite probar una URL +
  // credenciales que todavía NO se guardaron, sin exponer credenciales guardadas al
  // resto de sesiones. El servidor valida que la sesión sea admin antes de aceptarla.
  async function getJsonPreview(targetUrl, auth){
    var res;
    try {
      res = await fetch('/api/admin/odata-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          authUser: (auth && auth.username) || '',
          authPass: (auth && auth.password) || '',
        })
      });
    } catch(e) {
      throw new Error('No se pudo conectar con el servidor OData. Verifica que esté disponible.');
    }
    if(res.status === 401) throw new Error('HTTP 401 — Sin acceso. Verifica credenciales.');
    if(!res.ok) throw new Error('HTTP ' + res.status + ' al consultar el endpoint OData.');
    return res.json();
  }

  function buildTemplateUrl(baseUrl, templateName, opts){
    opts = opts || {};
    var base   = trimSlash(ensureProtocol(baseUrl));
    var params = new URLSearchParams();
    params.set('$format', 'json');
    if(opts.top) params.set('$top', String(opts.top));
    return base + '/' + encodeURIComponent(templateName) + '?' + params.toString();
  }

  function toTemplateList(data){
    var items = Array.isArray(data && data.value) ? data.value : [];
    return items
      .filter(function(it){ return !it.kind || it.kind === 'EntitySet'; })
      .map(function(it){ return { name: it.name || it.url, url: it.url || it.name }; });
  }

  function toRows(data){
    return Array.isArray(data && data.value) ? data.value : (Array.isArray(data) ? data : []);
  }

  // Resumen agregado de Soluciones — el servidor hace el fetch + la agregación
  // (buildTicketStats en mapper.js) y devuelve solo el resultado (unos pocos KB) en
  // vez de las ~7,5MB de filas crudas que trae la plantilla de tickets. Nunca lanza:
  // cualquier falla (red, sin config, sin plantilla, columnas no resueltas) vuelve
  // como {ok:false}, para que el llamador conserve la fotografía estática sin romper
  // el resto de la carga de datos.
  async function fetchSolucionesKpis(){
    try {
      var res = await fetch('/api/soluciones/kpis', { headers: { Accept: 'application/json' } });
      if(!res.ok) return { ok:false };
      return await res.json();
    } catch(e) {
      return { ok:false };
    }
  }

  window.CMI_ODATA = {
    async listTemplates(baseUrl){
      var u = trimSlash(ensureProtocol(baseUrl));
      return toTemplateList(await getJson(u));
    },
    async fetchTemplate(baseUrl, templateName, opts){
      return toRows(await getJson(buildTemplateUrl(baseUrl, templateName, opts)));
    },
    fetchSolucionesKpis: fetchSolucionesKpis,

    // Variantes admin-only para probar URL/credenciales antes de guardarlas.
    async listTemplatesPreview(baseUrl, auth){
      var u = trimSlash(ensureProtocol(baseUrl));
      return toTemplateList(await getJsonPreview(u, auth));
    },
    async fetchTemplatePreview(baseUrl, templateName, opts, auth){
      return toRows(await getJsonPreview(buildTemplateUrl(baseUrl, templateName, opts), auth));
    }
  };
})();
