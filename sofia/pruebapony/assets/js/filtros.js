(function(){
'use strict';

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mountFiltros(){
  var root = document.getElementById('view-filtros');
  if(!root) return;
  root.innerHTML =
    '<div class="space-y-6">' +
      '<div class="card p-5">' +
        '<div style="display:flex;align-items:start;justify-content:space-between;">' +
          '<div>' +
            '<h3 class="font-semibold text-slate-800">Configuración OData</h3>' +
            '<p class="text-xs text-slate-500">Endpoint y plantillas activas para cada área.</p>' +
            '<p class="text-xs text-slate-500 mt-1">Actualizado: <span id="updated-at-filtros" class="font-semibold text-slate-700">Sin datos aún</span></p>' +
          '</div>' +
          '<div style="display:flex;gap:8px;">' +
            '<button id="f-clear-cfg" class="btn-secondary" style="color:#B91C1C;">Borrar parametrización</button>' +
            '<button id="filtros-open-param" class="btn-primary">Actualizar datos</button>' +
          '</div>' +
        '</div>' +
        '<div id="filtros-config-info" style="margin-top:14px;font-size:13px;color:#475569;"></div>' +
      '</div>' +
    '</div>';

  refreshConfigInfo();

  document.getElementById('filtros-open-param').addEventListener('click', function(){
    runActualizarDatos(document.getElementById('filtros-open-param'), 'Actualizar datos');
  });

  document.getElementById('f-clear-cfg').addEventListener('click', onClearParametrizacion);
}

// Mapeo área → clave de window.CMI_DATA (misma tabla que usa populateData en parametrizacion.js).
var AREA_DATA_KEY = { comercial: 'COM', financiera: 'FIN', proyectos: 'PRY', soluciones: 'SOL', ids: 'IDS' };

// "Borrar parametrización" solo debe quitar las plantillas del área del usuario que
// aprieta el botón (mismo alcance que canEditAreaTemplates: un jefe de área no debe
// poder afectar procesos de otras áreas) y NUNCA debe tocar el endpoint/credenciales
// OData — reutiliza el mismo endpoint por área que ya usa el editor inline "Editar",
// solo que guardando una lista vacía en vez de agregar/quitar plantillas puntuales.
async function onClearParametrizacion(){
  var session = window.CMI_AUTH && window.CMI_AUTH.getSession();
  var cfg     = window.CMI_STORE && window.CMI_STORE.getConfig();
  if(!session || !cfg) return;

  var scoped       = session.area !== 'todas';
  var areasToClear = scoped ? [session.area] : window.CMI_AREA_IDS.slice();

  var msg = scoped
    ? '¿Borrar las plantillas configuradas de "'+session.area+'"? El endpoint, la autenticación y las demás áreas no se ven afectados.'
    : '¿Borrar las plantillas configuradas de TODAS las áreas? El endpoint y la autenticación OData se mantienen.';
  if(!confirm(msg)) return;

  var btn = document.getElementById('f-clear-cfg');
  btn.disabled = true;
  try{
    for(var i=0; i<areasToClear.length; i++){
      var area = areasToClear[i];
      var res  = await fetch('/api/odata-config/area-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: area, templates: [] })
      });
      var body = await res.json();
      if(!res.ok || !body.ok) throw new Error(body.error || ('No se pudo borrar la parametrización de "'+area+'".'));
      cfg.areas[area] = body.areaTemplates;
    }
    window.CMI_STORE.saveConfig(cfg);

    // Solo pone en cero los KPIs de las áreas efectivamente borradas — el resto queda intacto.
    areasToClear.forEach(function(areaId){
      var dataObj = window.CMI_DATA && window.CMI_DATA[AREA_DATA_KEY[areaId]];
      if(!dataObj) return;
      Object.keys(dataObj).forEach(function(k){
        if(Array.isArray(dataObj[k])) dataObj[k] = dataObj[k].map(function(){ return 0; });
      });
      // IDS: 'ansPorProducto' es un objeto de series por producto (no un array, así
      // que el bucle de arriba no lo toca) y 'metas' guarda metas derivadas del dato
      // (a diferencia de COM.metas, que son constantes) — limpiar ambos para no dejar
      // valores de una parametrización anterior.
      if(areaId === 'ids'){
        dataObj.ansPorProducto = {};
        dataObj.metas = {};
      }
      // Proyectos: 'pmo' guarda las celdas del control de cuotas en un objeto
      // {celdas, responsables} — no es un array plano, así que el bucle genérico de
      // arriba no lo toca y hay que vaciarlo acá para no dejar un tablero PMO con
      // datos de una parametrización ya borrada.
      if(areaId === 'proyectos'){
        if(dataObj.pmo){
          dataObj.pmo.celdas       = [];
          dataObj.pmo.responsables = [];
        }
        if(dataObj.hitos){
          dataObj.hitos.celdas       = [];
          dataObj.hitos.responsables = [];
          dataObj.hitos.licencias    = [];
        }
      }
      // Soluciones: abiertos/calidad/servicios son escalares y recursos/acciones/
      // clientes/productos son objetos agrupados {labels,data[,colors]} — ninguno
      // de los dos calza con el bucle genérico de arrays de arriba (que solo pone
      // en cero arrays planos), así que se resetean acá para no dejar un snapshot
      // de backlog obsoleto tras "Borrar parametrización". confiabilidad SÍ es un
      // array (el bucle de arriba ya lo puso en ceros), pero acá se sobreescribe a
      // null: un 0 se leería como "0% de confiabilidad" en vez de "sin datos".
      if(areaId === 'soluciones'){
        dataObj.abiertos = 0;
        dataObj.calidad = 0;
        dataObj.servicios = 0;
        dataObj.recursos  = { labels: [], data: [] };
        dataObj.acciones  = { labels: [], data: [] };
        dataObj.clientes  = { labels: [], data: [] };
        dataObj.productos = { labels: [], data: [], colors: [] };
        dataObj.confiabilidad = Array(12).fill(null);
        dataObj.defectos      = Array(12).fill(null);
        dataObj.corte = null;
      }
    });

    if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();
    refreshConfigInfo();
  }catch(err){
    alert('Error al borrar la parametrización: ' + err.message);
  }finally{
    btn.disabled = false;
  }
}

// Trae los datos crudos de todas las plantillas configuradas (todas las áreas) y
// repinta — misma lógica usada por el botón de Parámetros y por el botón del topbar
// "Actualizar datos" (para no repetir cada vez que alguien inicia sesión en un equipo
// nuevo y su localStorage todavía no tiene los datos, solo la configuración).
async function runActualizarDatos(btn, idleLabel, silent){
  var cfg = window.CMI_STORE && window.CMI_STORE.getConfig();
  if(!cfg || !cfg.odataUrl){
    // En carga automática (silent) sin config no hay nada que traer: se conserva la
    // fotografía estática sin abrir el panel ni molestar al usuario.
    if(silent) return;
    if(window.CMI_PARAM) window.CMI_PARAM.open();
    return;
  }
  if(btn){ btn.disabled = true; btn.textContent = 'Actualizando...'; }
  try {
    // Soluciones queda afuera de este fetch de filas crudas a propósito: su
    // plantilla de tickets pesa ~7,5MB/miles de filas y el navegador ya no necesita
    // esas filas para nada (renderSoluciones() solo lee CMI_DATA.SOL) — el resumen
    // agregado se trae aparte, más abajo, vía CMI_ODATA.fetchSolucionesKpis()
    // (server.js#handleSolucionesKpisGet hace el fetch + la agregación del lado
    // del servidor). El resto de las áreas sigue igual que antes.
    var allTemplates = [];
    window.CMI_AREA_IDS.forEach(function(areaId){
      if(areaId === 'soluciones') return;
      var tpls = (cfg.areas[areaId] && cfg.areas[areaId].templates) || [];
      tpls.forEach(function(n){ if(allTemplates.indexOf(n) === -1) allTemplates.push(n); });
    });
    var rawToSave     = {};
    var templateFailed = {};
    await Promise.all(allTemplates.map(async function(tplName){
      try {
        var rows = await window.CMI_ODATA.fetchTemplate(cfg.odataUrl, tplName, {});
        var headers = rows.length ? Object.keys(rows[0]) : [];
        rawToSave[tplName] = { rows: rows, headers: headers };
      } catch(err) {
        templateFailed[tplName] = true;
        var existing = (window.CMI_RAW_DATA || {})[tplName];
        if(existing) rawToSave[tplName] = existing;
        console.warn('[actualizar] Error en plantilla '+tplName+':', err.message);
      }
    }));
    window.CMI_RAW_DATA = rawToSave;
    window.CMI_STORE.saveRawData(rawToSave);
    window.CMI_STORE.saveConfig(cfg);

    // El fetch de arriba corre por plantilla, no por área (una plantilla puede
    // pertenecer a más de un área) — un área solo se marca "actualizada" si TODAS
    // sus plantillas configuradas trajeron datos sin error; así una falla puntual
    // no le pone fecha nueva a un área cuyos datos en realidad no cambiaron.
    window.CMI_AREA_IDS.forEach(function(areaId){
      if(areaId === 'soluciones') return;
      var tpls = (cfg.areas[areaId] && cfg.areas[areaId].templates) || [];
      if(!tpls.length) return;
      var allOk = tpls.every(function(n){ return !templateFailed[n]; });
      if(allOk) window.CMI_STORE.saveAreaUpdatedAt(areaId, new Date().toISOString());
    });

    if(window.CMI_PARAM && window.CMI_PARAM.populateData) window.CMI_PARAM.populateData({});

    // Soluciones: resumen agregado server-side. Si falla (OData sin configurar,
    // sin plantilla asignada a esta área, columnas no resueltas, red caída) se
    // deja la fotografía estática de CMI_DATA.SOL intacta — nunca rompe la
    // actualización de las demás áreas ni el render.
    var solKpis = await window.CMI_ODATA.fetchSolucionesKpis();
    if(solKpis && solKpis.ok){
      var SOL = window.CMI_DATA.SOL;
      SOL.abiertos      = solKpis.abiertos;
      SOL.calidad       = solKpis.calidad;
      SOL.servicios     = solKpis.servicios;
      SOL.recursos      = solKpis.recursos;
      SOL.acciones      = solKpis.acciones;
      SOL.clientes      = solKpis.clientes;
      SOL.productos     = solKpis.productos;
      SOL.confiabilidad = solKpis.confiabilidad;
      SOL.defectos      = solKpis.defectos;
      SOL.corte         = solKpis.corte;
      window.CMI_STORE.saveAreaUpdatedAt('soluciones', new Date().toISOString());
    } else {
      console.warn('[actualizar] Resumen de Soluciones no disponible ('+((solKpis && solKpis.reason) || 'error')+'), se conserva la fotografía estática.');
    }

    // El resumen de Soluciones ya se resolvió (llegó o falló): quitar el esqueleto de
    // carga para que renderAll pinte el resultado real (o el fallback estático).
    if(window.CMI_RENDER && window.CMI_RENDER.markSolReady) window.CMI_RENDER.markSolReady();
    if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();
    if(window.CMI_RENDER && window.CMI_RENDER.paintUpdatedAtBadges) window.CMI_RENDER.paintUpdatedAtBadges();
    refreshConfigInfo();
  } catch(err) {
    // En carga automática al abrir no bloqueamos con un alert: si el OData falla, se
    // deja la fotografía estática y se registra en consola. El alert queda solo para
    // la acción manual del botón "Actualizar datos".
    if(silent) console.error('[actualizar] Error en carga automática:', err.message);
    else alert('Error al actualizar datos: ' + err.message);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = idleLabel; }
  }
}

(function(){
  var btnTopbar = document.getElementById('btn-actualizar-datos');
  if(btnTopbar){
    var idleHTML = btnTopbar.innerHTML;
    btnTopbar.addEventListener('click', async function(){
      btnTopbar.disabled = true;
      btnTopbar.innerHTML = 'Actualizando...';
      try { await runActualizarDatos(null); }
      finally { btnTopbar.disabled = false; btnTopbar.innerHTML = idleHTML; }
    });
  }
})();

// Estado de los editores inline de plantillas por área (Parámetros → fila de área).
// Un jefe de área puede editar SOLO su propia área; un usuario con área "todas" puede
// editar cualquiera (misma regla que canEditAreaTemplates en el servidor, replicada acá
// solo para mostrar/ocultar UI).
var areaEditTemplates = null; // lista de plantillas disponibles del feed, cacheada tras el primer fetch
var areaEditState     = {};   // area -> { open: bool, templates: [...] }

function canEditArea(area){
  var session = window.CMI_AUTH && window.CMI_AUTH.getSession();
  if(!session) return false;
  return session.area === 'todas' || session.area === area;
}

function refreshConfigInfo(){
  var cont = document.getElementById('filtros-config-info');
  if(!cont) return;
  var cfg     = window.CMI_STORE.getConfig();
  var rawData = window.CMI_RAW_DATA || {};
  if(!cfg){
    cont.innerHTML = '<span style="color:#B45309;">⚠ Sin parametrización guardada. Usa "Editar parametrización" para configurar.</span>';
    return;
  }
  var rows = Object.entries(cfg.areas).map(function(entry){
    var k = entry[0], v = entry[1];
    var tpls = v.templates || [];
    var tplCell = tpls.length === 0
      ? '<em style="color:#94A3B8;">sin plantillas</em>'
      : tpls.map(function(n){
          var d = rawData[n];
          var tag = d ? '<span class="tag-ok">'+d.rows.length+' filas</span>' : '<span class="tag-warn">sin datos</span>';
          return '<div style="margin-bottom:2px;">'+escapeHtml(n)+' '+tag+'</div>';
        }).join('');
    var editBtn = canEditArea(k)
      ? ' <button class="area-edit-btn" data-area="'+k+'" style="flex-shrink:0;font-size:11px;color:#0EA5E9;background:none;border:none;cursor:pointer;padding:0;font-weight:600;">Editar</button>'
      : '';
    return '<tr style="vertical-align:top;"><td style="padding:4px 12px 4px 0;font-weight:600;color:#334155;white-space:nowrap;">'+k+'</td>'+
      '<td style="padding:4px 0;font-size:12px;"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;"><div>'+tplCell+'</div>'+editBtn+'</div></td></tr>'+
      '<tr class="area-editor-row" data-area="'+k+'" style="display:none;"><td colspan="2" style="padding:6px 0 12px;"><div class="area-editor" data-area="'+k+'"></div></td></tr>';
  }).join('');
  cont.innerHTML =
    '<div style="font-size:12px;color:#64748B;margin-bottom:4px;">URL: <code style="background:#F1F5F9;padding:1px 5px;border-radius:4px;">'+escapeHtml(cfg.odataUrl)+'</code></div>'+
    '<div style="font-size:12px;color:#64748B;margin-bottom:10px;">Guardado: '+window.CMI_STORE.parseUtc(cfg.savedAt).toLocaleString('es-CO')+'</div>'+
    '<table style="font-size:13px;width:100%;">'+rows+'</table>';

  document.querySelectorAll('.area-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ toggleAreaEditor(btn.dataset.area); });
  });
}

/* ── Editor inline de plantillas de UN área (jefe de área o admin) ── */
function areaEditorRow(area){
  return document.querySelector('.area-editor-row[data-area="'+area+'"]');
}

async function toggleAreaEditor(area){
  var row = areaEditorRow(area);
  if(!row) return;
  var isOpen = row.style.display !== 'none';
  if(isOpen){ row.style.display = 'none'; return; }

  var cfg = window.CMI_STORE.getConfig();
  var current = (cfg.areas[area] && cfg.areas[area].templates) || [];
  areaEditState[area] = { templates: current.slice() };

  var container = row.querySelector('.area-editor');
  container.innerHTML = '<span style="font-size:12px;color:#64748B;">Cargando plantillas disponibles...</span>';
  row.style.display = '';

  if(!areaEditTemplates){
    try{ areaEditTemplates = await window.CMI_ODATA.listTemplates(cfg.odataUrl); }
    catch(err){
      container.innerHTML = '<span class="tag-warn">Error al listar plantillas: '+escapeHtml(err.message)+'</span>';
      return;
    }
  }

  renderAreaEditor(area);
}

function areaChipHTML(area, tplName){
  var safeName = escapeHtml(tplName);
  return [
    '<div class="area-chip" data-tpl="'+safeName+'" style="display:flex;align-items:center;gap:8px;padding:5px 9px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:4px;">',
      '<div style="flex:1;min-width:0;font-size:12px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="'+safeName+'">'+safeName+'</div>',
      '<button class="area-chip-remove" data-area="'+area+'" data-tpl="'+safeName+'" style="flex-shrink:0;color:#94A3B8;background:none;border:none;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;" title="Quitar">×</button>',
    '</div>'
  ].join('');
}

function renderAreaEditor(area){
  var row       = areaEditorRow(area);
  var container = row.querySelector('.area-editor');
  var templates = areaEditState[area].templates;
  var opts = (areaEditTemplates || []).map(function(t){
    var safeName = escapeHtml(t.name);
    return '<option value="'+safeName+'">'+safeName+'</option>';
  }).join('');

  container.innerHTML = [
    '<div class="area-chips" style="margin-bottom:6px;">',
      templates.map(function(n){ return areaChipHTML(area, n); }).join(''),
    '</div>',
    '<div style="display:flex;gap:8px;align-items:center;">',
      '<select class="input-base area-add-sel" style="flex:1;font-size:12px;">',
        '<option value="">— Agregar plantilla —</option>'+opts,
      '</select>',
      '<button class="btn-primary area-add-btn" style="padding:6px 10px;font-size:12px;white-space:nowrap;">+ Agregar</button>',
      '<button class="btn-primary area-save-btn" style="padding:6px 10px;font-size:12px;white-space:nowrap;">Guardar</button>',
      '<span class="area-editor-status" style="font-size:11px;color:#64748B;"></span>',
    '</div>'
  ].join('');

  container.querySelectorAll('.area-chip-remove').forEach(function(btn){
    btn.addEventListener('click', function(){
      areaEditState[area].templates = areaEditState[area].templates.filter(function(n){ return n !== btn.dataset.tpl; });
      renderAreaEditor(area);
    });
  });
  container.querySelector('.area-add-btn').addEventListener('click', function(){
    var sel = container.querySelector('.area-add-sel');
    var tplName = sel.value;
    if(!tplName) return;
    if(areaEditState[area].templates.indexOf(tplName) === -1) areaEditState[area].templates.push(tplName);
    renderAreaEditor(area);
  });
  container.querySelector('.area-save-btn').addEventListener('click', function(){ saveAreaTemplates(area); });
}

async function saveAreaTemplates(area){
  var row       = areaEditorRow(area);
  var container = row.querySelector('.area-editor');
  var statusEl  = container.querySelector('.area-editor-status');
  var saveBtn   = container.querySelector('.area-save-btn');
  saveBtn.disabled = true;
  statusEl.textContent = 'Guardando...';

  var templates = areaEditState[area].templates;
  try{
    var res = await fetch('/api/odata-config/area-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: area, templates: templates })
    });
    var body = await res.json();
    if(!res.ok || !body.ok) throw new Error(body.error || 'No se pudo guardar la parametrización del área.');

    var cfg = window.CMI_STORE.getConfig();
    cfg.areas[area] = body.areaTemplates;
    window.CMI_STORE.saveConfig(cfg);

    // Traer datos crudos de las plantillas vigentes del área (nuevas y existentes),
    // igual que hace "Actualizar datos" para todas las áreas.
    var rawToSave = Object.assign({}, window.CMI_RAW_DATA || {});
    await Promise.all(templates.map(async function(tplName){
      try{
        var rows = await window.CMI_ODATA.fetchTemplate(cfg.odataUrl, tplName, {});
        rawToSave[tplName] = { rows: rows, headers: rows.length ? Object.keys(rows[0]) : [] };
      }catch(err){
        console.warn('[area-editor] Error en plantilla '+tplName+':', err.message);
      }
    }));
    window.CMI_RAW_DATA = rawToSave;
    window.CMI_STORE.saveRawData(rawToSave);

    if(window.CMI_PARAM && window.CMI_PARAM.populateData) window.CMI_PARAM.populateData({});
    if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();

    refreshConfigInfo();
  }catch(err){
    statusEl.innerHTML = '<span class="tag-warn">Error: '+escapeHtml(err.message)+'</span>';
    saveBtn.disabled = false;
  }
}

window.CMI_FILTROS_MOD = { mount: mountFiltros, refreshConfigInfo: refreshConfigInfo, actualizar: runActualizarDatos };

/* ══════════════════════════════════════════════════════════
   PANEL DE FILTROS RÁPIDOS EN EL SIDEBAR
   ══════════════════════════════════════════════════════════ */
(function(){
'use strict';

// IIFE separada del resto del archivo (scope propio) — necesita su propia copia de
// escapeHtml, no puede ver la del primer IIFE de este mismo archivo.
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Columna de "responsable" por área.
// Puede ser null (sin filtro), string (misma columna en todas las plantillas),
// u objeto { nombrePlantilla: columna } cuando cada plantilla usa una columna distinta.
var RESP_COL = {
  comercial : {
    'ID11856_comercial_Gral_2026': 'Vendedor',
    'ID11672_Pipeline'           : 'Recurso_Accion'
  },
  financiera: null,
  proyectos : null,
  soluciones: null,
  ids       : null
};

/* Normaliza un texto: minúsculas, sin acentos, sin espacios extremos.
   Usa comparación code-point para evitar bugs de encoding en regex de rango. */
function normStr(s){
  if(s == null) return '';
  var nfd = String(s).toLowerCase().normalize('NFD');
  var out = '';
  for(var ci=0; ci<nfd.length; ci++){
    var cp = nfd.charCodeAt(ci);
    if(cp < 0x0300 || cp > 0x036f) out += nfd[ci];
  }
  return out.trim();
}

/* Devuelve la columna de responsable para una plantilla específica */
function getColForTemplate(colConfig, tplName){
  if(!colConfig) return null;
  if(typeof colConfig === 'string') return colConfig;
  if(colConfig[tplName]) return colConfig[tplName];
  // Coincidencia parcial (nombre plantilla ↔ clave del mapa)
  var normTpl = normStr(tplName);
  var keys = Object.keys(colConfig);
  for(var i = 0; i < keys.length; i++){
    var normKey = normStr(keys[i]);
    if(normTpl.indexOf(normKey) !== -1 || normKey.indexOf(normTpl) !== -1){
      return colConfig[keys[i]];
    }
  }
  return null;
}

/* Busca el nombre real de una columna escaneando las primeras N filas
   (campos null pueden estar ausentes en rows[0] en respuestas OData). */
function resolveActualCol(rows, desiredCol){
  if(!rows || !rows.length || !desiredCol) return null;
  var norm = normStr(desiredCol);
  var keySet = {};
  var limit = Math.min(30, rows.length);
  for(var s=0; s<limit; s++){
    var rkeys = Object.keys(rows[s]);
    for(var rk=0; rk<rkeys.length; rk++) keySet[rkeys[rk]] = true;
  }
  // 1) Nombre exacto
  if(keySet[desiredCol]) return desiredCol;
  // 2) Case-insensitive sin acentos
  var keys = Object.keys(keySet);
  for(var i=0; i<keys.length; i++){
    if(normStr(keys[i]) === norm) return keys[i];
  }
  return null;
}

// Meses de cada trimestre (índice 0-base)
var Q_MONTHS = {
  q1: [{v:0,l:'Enero'},{v:1,l:'Febrero'},{v:2,l:'Marzo'}],
  q2: [{v:3,l:'Abril'},{v:4,l:'Mayo'},{v:5,l:'Junio'}],
  q3: [{v:6,l:'Julio'},{v:7,l:'Agosto'},{v:8,l:'Septiembre'}],
  q4: [{v:9,l:'Octubre'},{v:10,l:'Noviembre'},{v:11,l:'Diciembre'}]
};

function getEls(){
  return {
    resp : document.getElementById('sf-responsable'),
    trim : document.getElementById('sf-trimestre'),
    mes  : document.getElementById('sf-mes')
  };
}

/* Actualiza las opciones de "Mes corte" según el trimestre elegido */
function syncMes(){
  var e = getEls();
  if(!e.trim || !e.mes) return;
  var q = e.trim.value;
  if(q === 'ytd'){
    e.mes.innerHTML = '<option value="">—</option>';
    e.mes.disabled  = true;
  } else {
    var months = Q_MONTHS[q] || [];
    e.mes.innerHTML = '<option value="all">Todo el trimestre</option>' +
      months.map(function(m){
        return '<option value="'+m.v+'">'+m.l+'</option>';
      }).join('');
    e.mes.value    = 'all';
    e.mes.disabled = false;
  }
}

/* La plataforma origen migró los nombres de responsable a mayúscula sostenida;
   el histórico OData todavía trae filas viejas en formato capitalizado para la
   misma persona (ej. "Duvan Camilo Perdomo Arango" vs "DUVAN CAMILO PERDOMO
   ARANGO"), lo que duplicaba la entrada en el combo. Solo el formato nuevo
   (mayúscula sostenida) se considera vigente. */
function isFullUpper(s){
  return typeof s === 'string' && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s);
}

/* Obtiene los nombres únicos de responsable para el área activa, ya
   restringidos al formato vigente (mayúscula sostenida).
   Combina responsables de todas las plantillas cargadas usando la columna
   correcta para cada plantilla (tolerante a mayúsculas/acentos). */
function getResponsableOptions(viewId){
  var colConfig = RESP_COL[viewId];
  if(!colConfig) return [];
  var raw = window.CMI_RAW_DATA || {};
  var cfg = window.CMI_STORE && window.CMI_STORE.getConfig();
  if(!cfg) return [];
  var templates = (cfg.areas[viewId] && cfg.areas[viewId].templates) || [];
  var seen = {};
  templates.forEach(function(tpl){
    var desiredCol = getColForTemplate(colConfig, tpl);
    if(!desiredCol) return;
    var d = raw[tpl];
    if(!d || !d.rows || !d.rows.length) return;
    // Resolver el nombre real de la columna en los datos (tolerante a acentos/casing)
    var actualCol = resolveActualCol(d.rows, desiredCol);
    if(!actualCol){
      console.warn('[RESP] Columna "'+desiredCol+'" no encontrada en '+tpl+
        '. Columnas disponibles: '+Object.keys(d.rows[0]).join(', '));
      return;
    }
    d.rows.forEach(function(r){
      var v = r[actualCol];
      if(v != null && v !== '' && isFullUpper(v)) seen[v] = true;
    });
  });
  return Object.keys(seen).sort();
}

/* Rellena el select de responsable según la vista */
function populateResponsable(viewId){
  var e = getEls();
  if(!e.resp) return;
  var opts = getResponsableOptions(viewId);
  if(!opts.length){
    e.resp.innerHTML = '<option value="todos">Todos</option>';
    e.resp.disabled  = true;
  } else {
    e.resp.innerHTML = '<option value="todos">Todos</option>' +
      opts.map(function(n){ var safe = escapeHtml(n); return '<option value="'+safe+'">'+safe+'</option>'; }).join('');
    e.resp.disabled = false;
  }
}

/* Aplica los filtros: recalcula datos + re-renderiza */
function applyFilters(){
  var e = getEls();
  if(!e.trim) return;

  // Mes corte → cur + mesCorte
  var q        = e.trim.value;
  var mesVal   = (e.mes && !e.mes.disabled) ? e.mes.value : 'all';
  var cur;
  if(q === 'ytd'){
    cur = 11; mesVal = 'all';
  } else if(mesVal === 'all'){
    var qMos = Q_MONTHS[q] || [];
    cur = qMos.length ? qMos[qMos.length - 1].v : 11;
  } else {
    cur = parseInt(mesVal, 10);
    if(isNaN(cur)) cur = 11;
  }

  // Responsable → pre-filtro de filas
  var resp      = e.resp ? e.resp.value : 'todos';
  var viewId    = window.CMI_CURRENT_VIEW || 'comercial';
  var colConfig = RESP_COL[viewId];
  var areaRowFilter = {};
  if(resp && resp !== 'todos' && colConfig){
    var _resp = resp;
    // Resolver los nombres reales de columna de cada plantilla del área
    var _raw  = window.CMI_RAW_DATA || {};
    var _cfg2 = window.CMI_STORE && window.CMI_STORE.getConfig();
    var _tpls = (_cfg2 && _cfg2.areas[viewId] && _cfg2.areas[viewId].templates) || [];
    var _resolvedCols = [];
    _tpls.forEach(function(tpl){
      var desired = getColForTemplate(colConfig, tpl);
      if(!desired) return;
      var d = _raw[tpl];
      if(!d || !d.rows || !d.rows.length) return;
      var actual = resolveActualCol(d.rows, desired);
      if(actual && _resolvedCols.indexOf(actual) === -1) _resolvedCols.push(actual);
    });
    if(_resolvedCols.length){
      var _normResp = normStr(_resp);
      areaRowFilter[viewId] = function(row){
        return _resolvedCols.some(function(c){ return normStr(row[c]) === _normResp; });
      };
    }
  }

  // Guardar estado global
  window.CMI_FILTROS = { cur: cur, trimestre: q, responsable: resp, mesCorte: mesVal };

  // Repoblar datos con pre-filtro y re-renderizar
  if(window.CMI_PARAM && window.CMI_PARAM.populateData){
    window.CMI_PARAM.populateData({ areaRowFilter: areaRowFilter });
  }
  if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();
}

/* Restablece todos los filtros del sidebar a su estado inicial */
function clearFilters(){
  var e = getEls();
  if(e.resp) { e.resp.value = 'todos'; }
  if(e.trim) { e.trim.value = 'ytd'; syncMes(); }
  window.CMI_FILTROS = null;
  if(window.CMI_PARAM && window.CMI_PARAM.populateData) window.CMI_PARAM.populateData({});
  if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();
}

/* Monta los listeners del panel lateral */
function mountSidebarFilters(){
  var e = getEls();
  if(!e.trim) return;

  e.trim.addEventListener('change', function(){ syncMes(); applyFilters(); });
  if(e.mes)  e.mes.addEventListener('change', applyFilters);
  if(e.resp) e.resp.addEventListener('change', applyFilters);

  var clearBtn = document.getElementById('sf-clear');
  if(clearBtn) clearBtn.addEventListener('click', clearFilters);

  // Estado inicial
  syncMes();
  populateResponsable(window.CMI_CURRENT_VIEW || 'comercial');
}

window.CMI_SIDEBAR_FILTERS = {
  mount       : mountSidebarFilters,
  onViewChange: function(viewId){ populateResponsable(viewId); }
};
})();
})();
