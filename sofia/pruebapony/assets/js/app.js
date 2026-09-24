(function(){
'use strict';

function bootstrap(){
  // Botón "Parametrización" en el topbar
  var btn = document.getElementById('btn-parametrizacion');
  if(btn) btn.addEventListener('click', function(){ window.CMI_PARAM.open(); });

  // Montar vista Filtros (main content)
  if(window.CMI_FILTROS_MOD) window.CMI_FILTROS_MOD.mount();
  // Montar panel de filtros rápidos del sidebar
  if(window.CMI_SIDEBAR_FILTERS) window.CMI_SIDEBAR_FILTERS.mount();

  // Pinta las fechas de "Actualizado" guardadas de una sesión anterior ANTES del
  // fetch de config/auto-actualización: si el usuario entra y el OData tarda o
  // falla, igual debe ver la última actualización real (no "Sin datos aún" ni un
  // valor inventado) desde el primer instante.
  if(window.CMI_RENDER && window.CMI_RENDER.paintUpdatedAtBadges) window.CMI_RENDER.paintUpdatedAtBadges();

  // Config OData (endpoint + plantillas por área) ahora vive del lado del servidor —
  // cada sesión la obtiene sin volver a ingresar nada (las credenciales nunca viajan
  // a sesiones no-admin, ver server.js /api/odata-config).
  // Quita el esqueleto de carga de Soluciones y repinta con lo que haya en CMI_DATA.SOL
  // (usado cuando no hay OData configurado o falla la config: sin esto el esqueleto
  // quedaría colgado para siempre en esas rutas que no llaman a runActualizarDatos).
  function releaseSol(){
    if(window.CMI_RENDER && window.CMI_RENDER.markSolReady){
      window.CMI_RENDER.markSolReady();
      if(window.CMI_RENDER.all) window.CMI_RENDER.all();
    }
  }

  // Config OData (endpoint + plantillas por área) ahora vive del lado del servidor —
  // cada sesión la obtiene sin volver a ingresar nada (las credenciales nunca viajan
  // a sesiones no-admin, ver server.js /api/odata-config).
  fetch('/api/odata-config').then(function(res){
    return res.ok ? res.json() : null;
  }).then(function(cfg){
    if(!cfg || !cfg.odataUrl){ releaseSol(); return; }
    window.CMI_STORE.saveConfig(cfg);
    // Auto-actualizar en cada carga: los datos crudos del OData (~7,5 MB solo para
    // Soluciones) no caben en el localStorage del navegador (~5 MB), así que no se
    // pueden persistir entre recargas. En vez de mostrar la fotografía estática, se
    // vuelven a consultar al abrir — misma ruta que el botón "Actualizar datos", en
    // modo silencioso (si el OData falla, queda la fotografía estática sin alertar).
    // runActualizarDatos() marca el fin de carga de Soluciones (markSolReady) al terminar.
    if(window.CMI_FILTROS_MOD && window.CMI_FILTROS_MOD.actualizar){
      return window.CMI_FILTROS_MOD.actualizar(null, null, true);
    }
    releaseSol();
  }).catch(function(err){ console.error('[app] Error aplicando config:', err); releaseSol(); });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bootstrap);
}else{
  bootstrap();
}
})();
