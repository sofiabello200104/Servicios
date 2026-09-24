(function(){
'use strict';

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

var state              = null;   // copia editable del config
var availableTemplates = [];     // lista de plantillas del feed
var fetchCache         = {};     // tplName → { rows, headers } | { error }

function ensurePanel(){
  if(document.getElementById('param-panel')) return;

  var html = [
    '<div id="param-backdrop"></div>',
    '<aside id="param-panel" aria-hidden="true">',

      '<header style="padding:16px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;">',
        '<div>',
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748B;font-weight:600;">Configuración</div>',
          '<h2 style="font-size:18px;font-weight:800;color:#0F172A;margin-top:2px;">Parametrización OData</h2>',
        '</div>',
        '<button id="param-close" style="width:36px;height:36px;border-radius:8px;background:#F1F5F9;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" aria-label="Cerrar">',
          '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>',
        '</button>',
      '</header>',

      '<div style="flex:1;overflow-y:auto;" class="scrollbar">',

        /* ── PASO 1: URL + credenciales ── */
        '<section class="param-step">',
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748B;font-weight:600;margin-bottom:8px;">Paso 1 · URL OData</div>',
          '<label style="font-size:12px;color:#475569;display:block;">Endpoint del servicio OData</label>',
          '<input id="param-url" class="input-base" type="url" placeholder="https://..." style="margin-top:6px;"/>',
          '<div style="margin-top:10px;">',
            '<button id="param-toggle-auth" style="font-size:11px;color:#0EA5E9;background:none;border:none;cursor:pointer;padding:0;font-weight:600;">+ Autenticación (opcional)</button>',
            '<div id="param-auth-fields" style="display:none;margin-top:10px;">',
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">',
                '<label style="font-size:11px;color:#475569;">Usuario<input id="param-auth-user" class="input-base" type="text" placeholder="usuario" style="margin-top:3px;display:block;"/></label>',
                '<label style="font-size:11px;color:#475569;">Contraseña<input id="param-auth-pass" class="input-base" type="password" placeholder="••••••••" style="margin-top:3px;display:block;"/></label>',
              '</div>',
            '</div>',
          '</div>',
          '<div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
            '<button id="param-load" class="btn-primary">Cargar plantillas</button>',
            '<button id="param-save-creds" class="btn-secondary">Guardar credenciales</button>',
            '<span id="param-load-status" style="font-size:12px;color:#64748B;"></span>',
          '</div>',
        '</section>',

        /* ── PASO 2: Plantillas por área ── */
        '<section class="param-step" id="param-step-areas" style="display:none;">',
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748B;font-weight:600;margin-bottom:6px;">Paso 2 · Plantillas por área</div>',
          '<p style="font-size:12px;color:#64748B;margin-bottom:12px;">Asigna una o más plantillas del feed a cada área. Los datos se almacenarán para configurar los KPIs más adelante.</p>',
          '<div id="param-areas-list"></div>',
        '</section>',

      '</div>',

      '<footer style="padding:14px 20px;border-top:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;gap:8px;">',
        '<button id="param-cancel" class="btn-secondary">Cancelar</button>',
        '<button id="param-save" class="btn-primary" disabled>Guardar y cargar datos</button>',
      '</footer>',

    '</aside>'
  ].join('');

  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  while(tmp.firstChild) document.body.appendChild(tmp.firstChild);

  document.getElementById('param-close').addEventListener('click', closePanel);
  document.getElementById('param-cancel').addEventListener('click', closePanel);
  document.getElementById('param-backdrop').addEventListener('click', closePanel);
  document.getElementById('param-load').addEventListener('click', onLoadTemplates);
  document.getElementById('param-save-creds').addEventListener('click', saveCredentialsOnly);
  document.getElementById('param-save').addEventListener('click', onSave);
  document.getElementById('param-toggle-auth').addEventListener('click', function(){
    var fields = document.getElementById('param-auth-fields');
    var btn    = document.getElementById('param-toggle-auth');
    var hidden = fields.style.display === 'none' || fields.style.display === '';
    fields.style.display = hidden ? 'block' : 'none';
    btn.textContent = hidden ? '− Autenticación (opcional)' : '+ Autenticación (opcional)';
  });
}

/* ── Helpers ── */
function getAuth(){
  var u = document.getElementById('param-auth-user');
  var p = document.getElementById('param-auth-pass');
  return { username: u ? u.value.trim() : '', password: p ? p.value : '' };
}

/* ── Abrir / cerrar panel ──
   La config (incluidas credenciales) ya no vive en localStorage — este panel es
   admin-only, así que carga el estado actual desde /api/admin/odata-config. */
async function openPanel(){
  ensurePanel();
  state              = JSON.parse(JSON.stringify(window.CMI_STORE.emptyConfig()));
  availableTemplates = [];
  fetchCache         = {};

  document.getElementById('param-url').value = '';
  document.getElementById('param-step-areas').style.display = 'none';
  document.getElementById('param-save').disabled = true;
  document.getElementById('param-load-status').textContent = 'Cargando configuración guardada...';

  document.getElementById('param-panel').classList.add('open');
  document.getElementById('param-backdrop').classList.add('show');
  document.getElementById('param-panel').setAttribute('aria-hidden','false');

  try{
    var res = await fetch('/api/admin/odata-config');
    if(res.ok){
      var serverCfg = await res.json();
      state.odataUrl = serverCfg.endpointUrl || '';
      state.auth     = { username: serverCfg.authUser || '', password: serverCfg.authPass || '' };
      state.areas    = JSON.parse(JSON.stringify(serverCfg.areaTemplates || state.areas));
    }
  }catch(err){
    console.error('[param] Error cargando configuración admin:', err);
  }

  document.getElementById('param-url').value = state.odataUrl || '';

  var authUser = document.getElementById('param-auth-user');
  var authPass = document.getElementById('param-auth-pass');
  if(authUser && state.auth && state.auth.username){
    authUser.value = state.auth.username;
    authPass.value = state.auth.password || '';
    document.getElementById('param-auth-fields').style.display = 'block';
    document.getElementById('param-toggle-auth').textContent = '− Autenticación (opcional)';
  }

  document.getElementById('param-load-status').textContent = '';
}

function closePanel(){
  var panel = document.getElementById('param-panel');
  var bd    = document.getElementById('param-backdrop');
  if(panel){ panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
  if(bd)    bd.classList.remove('show');
}

/* ── Paso 1: cargar lista de plantillas ── */
async function onLoadTemplates(){
  var url = document.getElementById('param-url').value.trim();
  if(!url){ document.getElementById('param-load-status').textContent = 'Ingresa una URL válida.'; return; }
  state.odataUrl = url;
  state.auth     = getAuth();

  var statusEl = document.getElementById('param-load-status');
  statusEl.textContent = 'Cargando...';
  document.getElementById('param-load').disabled = true;
  try{
    availableTemplates = await window.CMI_ODATA.listTemplatesPreview(url, state.auth);
    if(!availableTemplates.length){
      statusEl.textContent = 'El feed no expone plantillas. Verifica la URL.';
      return;
    }
    statusEl.innerHTML = '<span class="tag-ok">'+availableTemplates.length+' plantillas detectadas</span>';
    renderAreasStep();
  }catch(err){
    statusEl.innerHTML = '<span class="tag-warn">Error: '+escapeHtml(err.message)+'</span>';
    console.error(err);
  }finally{
    document.getElementById('param-load').disabled = false;
  }
}

/* ── Guardar SOLO credenciales (sin tocar plantillas por área) ──
   Omite areaTemplates del body a propósito: el servidor preserva lo ya
   guardado cuando esa clave no viene en el request (ver handleAdminODataConfigPost). */
async function saveCredentialsOnly(){
  var url = document.getElementById('param-url').value.trim();
  if(!url){ document.getElementById('param-load-status').textContent = 'Ingresa una URL válida.'; return; }
  state.odataUrl = url;
  state.auth     = getAuth();

  var statusEl = document.getElementById('param-load-status');
  var btn      = document.getElementById('param-save-creds');
  btn.disabled = true;
  statusEl.textContent = 'Guardando credenciales...';
  try{
    var res = await fetch('/api/admin/odata-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpointUrl: state.odataUrl,
        authUser: state.auth.username,
        authPass: state.auth.password,
      })
    });
    var body = await res.json();
    if(!res.ok || !body.ok) throw new Error(body.error || 'No se pudo guardar las credenciales.');
    statusEl.innerHTML = '<span class="tag-ok">Credenciales guardadas</span>';
  }catch(err){
    statusEl.innerHTML = '<span class="tag-warn">Error: '+escapeHtml(err.message)+'</span>';
  }finally{
    btn.disabled = false;
  }
}

/* ── Paso 2: UI multi-plantilla por área ── */
function renderAreasStep(){
  var cat  = window.CMI_AREA_CATALOG;
  var ids  = window.CMI_AREA_IDS;

  var html = ids.map(function(a){
    var selected = (state.areas[a] && state.areas[a].templates) || [];
    var opts = availableTemplates.map(function(t){
      var safeName = escapeHtml(t.name);
      return '<option value="'+safeName+'">'+safeName+'</option>';
    }).join('');

    return [
      '<div class="param-area-block" data-area="'+a+'" style="border:1px solid #E2E8F0;border-radius:10px;padding:12px;margin-bottom:10px;">',
        '<div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:4px;">'+cat[a].label+'</div>',
        '<div id="chips-'+a+'" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">',
          selected.map(function(n){ return chipHTML(a, n); }).join(''),
        '</div>',
        '<div style="display:flex;gap:8px;align-items:center;">',
          '<select class="input-base param-add-sel" style="flex:1;font-size:12px;">',
            '<option value="">— Agregar plantilla —</option>'+opts,
          '</select>',
          '<button class="btn-primary param-add-btn" style="padding:7px 12px;font-size:12px;white-space:nowrap;">+ Agregar</button>',
        '</div>',
      '</div>'
    ].join('');
  }).join('');

  document.getElementById('param-areas-list').innerHTML = html;
  document.getElementById('param-step-areas').style.display = 'block';

  // Wire add buttons
  document.querySelectorAll('.param-area-block').forEach(function(block){
    var area   = block.dataset.area;
    var addBtn = block.querySelector('.param-add-btn');
    var addSel = block.querySelector('.param-add-sel');
    addBtn.addEventListener('click', function(){ addTemplate(area, addSel.value); addSel.value = ''; });
  });

  // Wire remove buttons on pre-existing chips
  document.querySelectorAll('.chip-remove').forEach(wireRemove);

  // Si ya hay plantillas seleccionadas de una config previa, re-fetch
  ids.forEach(function(a){
    (state.areas[a].templates||[]).forEach(function(n){ if(!fetchCache[n]) doFetch(a, n); });
  });

  refreshSave();
}

function chipHTML(area, tplName){
  var safeName = escapeHtml(tplName);
  var insp   = fetchCache[tplName];
  var status = '';
  var color  = '#64748B';
  if(insp){
    if(insp.error){ status = '⚠ '+escapeHtml(insp.error); color = '#EF4444'; }
    else           { status = insp.rows.length+' filas · '+insp.headers.length+' columnas'; color='#10B981'; }
  } else { status = 'pendiente...'; }

  return [
    '<div class="tpl-chip" data-tpl="'+safeName+'" style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">',
      '<div style="flex:1;min-width:0;">',
        '<div style="font-size:12px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="'+safeName+'">'+safeName+'</div>',
        '<div class="chip-status" style="font-size:11px;color:'+color+';">'+status+'</div>',
      '</div>',
      '<button class="chip-remove" data-area="'+area+'" data-tpl="'+safeName+'" style="flex-shrink:0;color:#94A3B8;background:none;border:none;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;" title="Quitar">×</button>',
    '</div>'
  ].join('');
}

function wireRemove(btn){
  btn.addEventListener('click', function(){
    var area    = btn.dataset.area;
    var tplName = btn.dataset.tpl;
    state.areas[area].templates = (state.areas[area].templates||[]).filter(function(n){ return n !== tplName; });
    var chipEl = btn.closest('.tpl-chip');
    if(chipEl) chipEl.remove();
    refreshSave();
  });
}

function addTemplate(area, tplName){
  if(!tplName) return;
  if(!state.areas[area].templates) state.areas[area].templates = [];
  if(state.areas[area].templates.indexOf(tplName) !== -1) return; // ya agregada

  state.areas[area].templates.push(tplName);

  var chipsList = document.getElementById('chips-'+area);
  var tmp = document.createElement('div');
  tmp.innerHTML = chipHTML(area, tplName);
  var chip = tmp.firstChild;
  chipsList.appendChild(chip);
  wireRemove(chip.querySelector('.chip-remove'));

  if(!fetchCache[tplName]) doFetch(area, tplName);
  refreshSave();
}

async function doFetch(area, tplName){
  var chip    = document.querySelector('#chips-'+area+' [data-tpl="'+tplName+'"] .chip-status');
  if(chip){ chip.style.color='#64748B'; chip.textContent='cargando...'; }
  try{
    var rows    = await window.CMI_ODATA.fetchTemplatePreview(state.odataUrl, tplName, {}, state.auth);
    var headers = rows.length ? Object.keys(rows[0]) : [];
    fetchCache[tplName] = { rows: rows, headers: headers };
    if(chip){ chip.style.color='#10B981'; chip.textContent=rows.length+' filas · '+headers.length+' columnas'; }
  }catch(err){
    fetchCache[tplName] = { rows:[], headers:[], error: err.message };
    if(chip){ chip.style.color='#EF4444'; chip.textContent='⚠ '+err.message; }
  }
  refreshSave();
}

function refreshSave(){
  var hasAny = window.CMI_AREA_IDS.some(function(a){
    return (state.areas[a].templates||[]).length > 0;
  });
  var saveBtn = document.getElementById('param-save');
  if(saveBtn) saveBtn.disabled = !hasAny;
}

/* ── Guardar: persiste config en el servidor (única fuente de verdad) + datos crudos ── */
async function onSave(){
  var saveBtn = document.getElementById('param-save');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='Guardando...'; }

  state.auth = getAuth();

  // Asegurarse de haber fetcheado todas las plantillas seleccionadas (vía preview, admin)
  var pending = [];
  window.CMI_AREA_IDS.forEach(function(a){
    (state.areas[a].templates||[]).forEach(function(n){
      if(!fetchCache[n]) pending.push(doFetch(a, n));
    });
  });
  if(pending.length) await Promise.all(pending);

  // Persistir datos crudos localmente — es solo cache de filas, no contiene credenciales
  var rawToSave = {};
  Object.keys(fetchCache).forEach(function(k){
    var d = fetchCache[k];
    if(!d.error) rawToSave[k] = { rows: d.rows, headers: d.headers };
  });
  window.CMI_RAW_DATA = rawToSave;
  window.CMI_STORE.saveRawData(rawToSave);

  // Persistir endpoint + credenciales + plantillas en el servidor. A partir de acá
  // cualquier sesión (incluida esta) obtiene los datos sin volver a ingresar nada.
  try{
    var res = await fetch('/api/admin/odata-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpointUrl: state.odataUrl,
        authUser: state.auth.username,
        authPass: state.auth.password,
        areaTemplates: state.areas,
      })
    });
    var body = await res.json();
    if(!res.ok || !body.ok) throw new Error(body.error || 'No se pudo guardar la configuración.');

    // Reflejar en el propio dashboard del admin — sin credenciales en memoria del cliente
    window.CMI_STORE.saveConfig({
      odataUrl: body.config.endpointUrl,
      areas: body.config.areaTemplates,
      savedAt: body.config.updatedAt,
    });
  }catch(err){
    alert('Error al guardar: ' + err.message);
    if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='Guardar y cargar datos'; }
    return;
  }

  closePanel();
  if(typeof window.CMI_FILTROS_MOD !== 'undefined') window.CMI_FILTROS_MOD.refreshConfigInfo();

  populateData();
  if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();

  if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='Guardar y cargar datos'; }
}

/* ── IDS: indicadores con forma "métrica única por fila" (ID11947_PBIndicadoresIDS)
   o "agrupada por producto" (ID11948_PBIndicadorNiveldeServicio) — cada plantilla
   puede traer columnas distintas (FECHAFINAL vs FECHA/NOMPRODUCTO), así que se
   procesan una por una en vez de concatenar filas como hace el resto de las áreas
   (el detector tidy/ancho genérico no cubre ninguna de las dos formas). ── */
function populateIds(dataObj, catalog, templates, raw, rowFn){
  var singleTarget  = catalog.targets.find(function(t){ return t.metricShape === 'single';  });
  var groupedTarget = catalog.targets.find(function(t){ return t.metricShape === 'grouped'; });

  // Mismo criterio que el resto de las áreas: si hay un pre-filtro de filas activo
  // (ej. responsable) y no deja filas, el indicador queda en "sin datos", no con el
  // valor de una config/filtro anterior.
  if(rowFn){
    catalog.targets.forEach(function(t){ dataObj[t.id] = [0,0,0,0,0,0,0,0,0,0,0,0]; });
    dataObj.metas = {};
  }
  // Se reconstruye por completo en cada llamada (a diferencia de las series planas,
  // que se sobreescriben target por target): si un producto deja de aparecer en el
  // dato más reciente, no debe quedar una barra obsoleta con su último valor.
  dataObj.ansPorProducto = {};

  templates.forEach(function(tplName){
    var d = raw[tplName];
    if(!d || !d.rows || !d.rows.length) return;
    var rows = rowFn ? d.rows.filter(rowFn) : d.rows;
    if(!rows.length) return;

    var sample   = rows[0];
    var groupCol = groupedTarget ? window.CMI_MAPPER.findAliasColumn(sample, groupedTarget.groupAliases) : null;
    var target   = groupCol ? groupedTarget : singleTarget;
    if(!target) return;

    var cols = {
      // Si el target define dateAliases (ver area-catalog.js), se usa esa columna
      // puntual en vez del detector genérico — evita ambigüedad cuando la fila
      // trae más de una columna de fecha (ej. FECHAINI y FECHAFINAL).
      fecha: (target.dateAliases && window.CMI_MAPPER.findAliasColumn(sample, target.dateAliases)) ||
             window.CMI_MAPPER.findDateColumn(sample),
      valor: window.CMI_MAPPER.findAliasColumn(sample, target.valueAliases),
      meta:  window.CMI_MAPPER.findAliasColumn(sample, target.metaAliases),
      grupo: (target === groupedTarget) ? groupCol : null
    };
    if(!cols.fecha || !cols.valor) return;

    var bundle = window.CMI_MAPPER.buildMetricBundle(rows, cols);
    dataObj[target.id] = bundle.serie.map(function(v){ return v == null ? 0 : v; });
    if(bundle.meta != null){
      dataObj.metas = dataObj.metas || {};
      dataObj.metas[target.id] = bundle.meta;
    }
    if(target.groupDataKey){
      Object.keys(bundle.groups).forEach(function(g){
        dataObj[target.groupDataKey][g] = bundle.groups[g].serie.map(function(v){ return v == null ? 0 : v; });
      });
    }
  });
}

/* ── Control de cuotas (PMO) → CMI_DATA.PRY.pmo ──
   La plantilla se detecta por su FORMA (resolveCuotasColumns), no por nombre: así
   sigue funcionando si el feed la renombra o si se asignan varias plantillas al área.
   Solo se toma la primera que calce — el tablero de cuotas es uno solo. */
function populateCuotas(dataObj, templates, raw){
  var M = window.CMI_MAPPER;
  if(!dataObj.pmo || !M || !M.resolveCuotasColumns) return;
  for(var i = 0; i < templates.length; i++){
    var d = raw[templates[i]];
    if(!d || !d.rows || !d.rows.length) continue;
    if(!M.resolveCuotasColumns(d.rows[0])) continue;
    var bundle = M.buildCuotasCells(d.rows);
    dataObj.pmo.celdas       = bundle.celdas;
    dataObj.pmo.responsables = bundle.responsables;
    return;
  }
}

/* ── Hitos PMO → CMI_DATA.PRY.hitos ──
   Misma estrategia que populateCuotas: se detecta por FORMA (resolveHitosColumns), no
   por nombre de plantilla, y se toma la primera que calce. */
function populateHitos(dataObj, templates, raw){
  var M = window.CMI_MAPPER;
  if(!dataObj.hitos || !M || !M.resolveHitosColumns) return;
  for(var i = 0; i < templates.length; i++){
    var d = raw[templates[i]];
    if(!d || !d.rows || !d.rows.length) continue;
    if(!M.resolveHitosColumns(d.rows[0])) continue;
    var bundle = M.buildHitosCells(d.rows);
    dataObj.hitos.celdas       = bundle.celdas;
    dataObj.hitos.responsables = bundle.responsables;
    dataObj.hitos.licencias    = bundle.licencias;
    return;
  }
}

/* ── Mapear CMI_RAW_DATA → window.CMI_DATA (series mensuales) ──
   opts.areaRowFilter: { areaId: fn(row) -> bool } — pre-filtra filas por área */
function populateData(opts){
  opts = opts || {};
  var areaRowFilter = opts.areaRowFilter || {};
  var cfg = window.CMI_STORE.getConfig();
  var raw = window.CMI_RAW_DATA || {};
  if(!cfg || !window.CMI_DATA || !window.CMI_MAPPER || !window.CMI_AREA_CATALOG) return;

  var areaDataMap = {
    comercial : window.CMI_DATA.COM,
    financiera: window.CMI_DATA.FIN,
    proyectos : window.CMI_DATA.PRY,
    soluciones: window.CMI_DATA.SOL,
    ids       : window.CMI_DATA.IDS
  };

  window.CMI_AREA_IDS.forEach(function(areaId){
    var dataObj = areaDataMap[areaId];
    if(!dataObj) return;
    var catalog  = window.CMI_AREA_CATALOG[areaId];
    var scale    = catalog.valueScale != null ? catalog.valueScale : 1;
    var templates = (cfg.areas[areaId] && cfg.areas[areaId].templates) || [];
    if(!templates.length) return;

    // Proyectos: la plantilla de control de cuotas (ID11887_Contro_de_cuotas) abre cada
    // indicador en 12 columnas sufijadas por mes — forma propia que no calza con el
    // detector tidy/ancho de más abajo (ver mapper.js#buildCuotasCells). Se procesa
    // aparte y NO reemplaza a los OKR del área, que siguen viniendo por la vía genérica
    // desde sus propias plantillas.
    if(areaId === 'proyectos'){
      populateCuotas(dataObj, templates, raw);
      populateHitos(dataObj, templates, raw);
    }

    // IDS: formas de datos propias (métrica única / agrupada por producto) —
    // se procesan aparte, no calzan con el detector tidy/ancho genérico de abajo.
    if(areaId === 'ids'){
      populateIds(dataObj, catalog, templates, raw, areaRowFilter[areaId]);
      return;
    }
    // Soluciones: la agregación (backlog + confiabilidad) corre ahora en el
    // servidor (server.js#handleSolucionesKpisGet, vía CMI_ODATA.fetchSolucionesKpis
    // en filtros.js) — la plantilla de tickets pesa ~7,5MB/miles de filas y
    // deliberadamente ya no se descarga cruda al navegador, así que populateData()
    // nunca debe tocar CMI_DATA.SOL acá (no hay window.CMI_RAW_DATA[<plantilla>]
    // que procesar del lado del cliente para esta área).
    if(areaId === 'soluciones') return;

    var allRows = [];
    templates.forEach(function(tplName){
      var d = raw[tplName];
      if(d && d.rows && d.rows.length) allRows = allRows.concat(d.rows);
    });
    if(!allRows.length) return;

    // Aplicar pre-filtro de filas (ej: filtrar por responsable)
    var rowFn = areaRowFilter[areaId];
    var rows  = rowFn ? allRows.filter(rowFn) : allRows;

    // Si hay filtro activo, limpiar las series a cero antes de procesar.
    // Así, si el mapper no encuentra datos para algún KPI, queda en cero (sin datos)
    // en lugar de mostrar datos obsoletos del responsable anterior.
    if(rowFn){
      catalog.targets.forEach(function(target){
        dataObj[target.id] = [0,0,0,0,0,0,0,0,0,0,0,0];
      });
      if(rows.length === 0) return;
    }

    // Formato tidy (columnas kpi + periodo + valor)
    var tidyMap = window.CMI_MAPPER.detectColumns(rows[0] || allRows[0]);
    if(window.CMI_MAPPER.isAutoMapComplete(tidyMap)){
      var bundle  = window.CMI_MAPPER.buildKpiBundle(rows, tidyMap);
      var matched = window.CMI_MAPPER.matchCanonical(bundle, catalog.targets);
      catalog.targets.forEach(function(target){
        var kpi = matched[target.id];
        if(kpi && Array.isArray(kpi.serie)){
          dataObj[target.id] = kpi.serie.map(function(v){ return v == null ? 0 : v * scale; });
        }
        if(kpi && kpi.meta != null && dataObj.metas && target.id in dataObj.metas){
          dataObj.metas[target.id] = kpi.meta;
        }
      });
      return;
    }

    // Formato ancho/transaccional (una fila por evento, agregar por fecha)
    var wideBundle = window.CMI_MAPPER.buildWideBundle(rows, catalog.targets);
    catalog.targets.forEach(function(target){
      var kpi = wideBundle.kpis[target.id];
      if(kpi && Array.isArray(kpi.serie)){
        dataObj[target.id] = kpi.serie.map(function(v){ return v == null ? 0 : v * scale; });
      }
    });
  });
}

/* ── applyConfig (boot): restaura datos y repinta ── */
async function applyConfig(cfg){
  if(!cfg) cfg = window.CMI_STORE.getConfig();
  if(!cfg) return;
  populateData();
  if(window.CMI_RENDER && window.CMI_RENDER.all) window.CMI_RENDER.all();
}

window.CMI_PARAM = { open: openPanel, close: closePanel, applyConfig: applyConfig, populateData: populateData };
})();
