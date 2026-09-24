(function(){
'use strict';

var AREA = 'comercial';
var MONTH_NAMES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
var CARD_TITLES = {
  nuevos:       'Ingresos nuevos',
  cruzada:      'Venta cruzada',
  renovaciones: 'Renovaciones',
  greenywave:   'Greenywave',
  cobertura:    'Cobertura de pipeline',
  metaVendedor: 'Meta vendedor'
};
var PERIOD_LABELS = { ytd:'Acumulado YTD', q1:'Q1', q2:'Q2', q3:'Q3', q4:'Q4' };

var _cache = null;   // { [cardId]: { [month]: text } } para el área comercial
var _loading = null; // Promise en curso mientras se carga _cache
var _current = null; // cardId abierto en el panel

function ensurePanel(){
  if(document.getElementById('analisis-panel')) return;

  var html = [
    '<div id="analisis-backdrop"></div>',
    '<aside id="analisis-panel" aria-hidden="true">',
      '<header style="padding:16px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;">',
        '<div>',
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748B;font-weight:600;">Análisis · <span id="analisis-period"></span></div>',
          '<h2 id="analisis-title" style="font-size:18px;font-weight:800;color:#0F172A;margin-top:2px;"></h2>',
        '</div>',
        '<button id="analisis-close" style="width:36px;height:36px;border-radius:8px;background:#F1F5F9;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;" aria-label="Cerrar">',
          '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>',
        '</button>',
      '</header>',
      '<div style="flex:1;overflow-y:auto;padding:18px 22px;" class="scrollbar" id="analisis-months"></div>',
      '<footer style="padding:14px 20px;border-top:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;gap:8px;">',
        '<button id="analisis-cancel" class="btn-secondary">Cerrar</button>',
        '<div style="display:flex;align-items:center;gap:10px;">',
          '<span id="analisis-status" style="font-size:12px;color:#64748B;"></span>',
          '<button id="analisis-save" class="btn-primary">Guardar</button>',
        '</div>',
      '</footer>',
    '</aside>'
  ].join('');

  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  while(tmp.firstChild) document.body.appendChild(tmp.firstChild);

  document.getElementById('analisis-close').addEventListener('click', closePanel);
  document.getElementById('analisis-cancel').addEventListener('click', closePanel);
  document.getElementById('analisis-backdrop').addEventListener('click', closePanel);
  document.getElementById('analisis-save').addEventListener('click', onSave);
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function activeMonths(){
  var trim = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';
  var qIx  = (window.CMI_DATA && window.CMI_DATA.Q_IX) || { ytd:[0,1,2,3,4,5,6,7,8,9,10,11] };
  return (qIx[trim] || qIx.ytd).slice();
}

function loadCache(){
  if(_cache) return Promise.resolve(_cache);
  if(_loading) return _loading;
  _loading = fetch('/api/analisis')
    .then(function(res){ return res.json(); })
    .then(function(json){ _cache = (json && json[AREA]) || {}; return _cache; })
    .catch(function(e){
      console.warn('[analisis] No se pudo cargar comentarios guardados:', e.message);
      _cache = {};
      return _cache;
    })
    .finally(function(){ _loading = null; });
  return _loading;
}

function formatUpdatedAt(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function renderMonths(cardId){
  var months = activeMonths();
  var saved  = (_cache && _cache[cardId]) || {};
  document.getElementById('analisis-months').innerHTML = months.map(function(m){
    var entry = saved[m] || {};
    var val = entry.text || '';
    var when = entry.updatedAt ? ' · '+formatUpdatedAt(entry.updatedAt) : '';
    var meta = '';
    if(entry.deleted){
      meta = '<div style="font-size:11px;color:#B91C1C;margin-top:4px;">Eliminado por <strong>'+escapeHtml(entry.updatedBy)+'</strong>'+when+'</div>';
    } else if(entry.updatedBy){
      meta = '<div style="font-size:11px;color:#94A3B8;margin-top:4px;">Última edición: <strong>'+escapeHtml(entry.updatedBy)+'</strong>'+when+'</div>';
    }
    return '<div style="margin-bottom:16px;">' +
      '<label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">'+MONTH_NAMES_FULL[m]+'</label>' +
      '<textarea class="analisis-textarea input-base" data-month="'+m+'" rows="3" placeholder="Escribe el análisis de '+MONTH_NAMES_FULL[m]+'...">'+escapeHtml(val)+'</textarea>' +
      meta +
    '</div>';
  }).join('');
}

function openPanel(cardId){
  ensurePanel();
  _current = cardId;
  var trim = (window.CMI_FILTROS && window.CMI_FILTROS.trimestre) || 'ytd';

  document.getElementById('analisis-title').textContent  = CARD_TITLES[cardId] || cardId;
  document.getElementById('analisis-period').textContent = PERIOD_LABELS[trim] || 'Acumulado YTD';
  document.getElementById('analisis-status').textContent  = '';

  loadCache().then(function(){
    renderMonths(cardId);
    document.getElementById('analisis-panel').classList.add('open');
    document.getElementById('analisis-backdrop').classList.add('show');
    document.getElementById('analisis-panel').setAttribute('aria-hidden','false');
  });
}

function closePanel(){
  var panel = document.getElementById('analisis-panel');
  var bd    = document.getElementById('analisis-backdrop');
  if(panel){ panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
  if(bd) bd.classList.remove('show');
}

function onSave(){
  if(!_current) return;
  var statusEl = document.getElementById('analisis-status');
  var btn      = document.getElementById('analisis-save');
  var comments = {};
  document.querySelectorAll('#analisis-months .analisis-textarea').forEach(function(ta){
    comments[ta.dataset.month] = ta.value;
  });

  btn.disabled = true;
  statusEl.textContent = 'Guardando...';
  fetch('/api/analisis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ area: AREA, cardId: _current, comments: comments })
  })
    .then(function(res){
      return res.json().then(function(json){ return { ok: res.ok, json: json }; });
    })
    .then(function(r){
      if(!r.ok){ statusEl.textContent = r.json.error || 'Error al guardar'; return; }
      if(!_cache) _cache = {};
      _cache[_current] = (r.json && r.json.data) || {};
      statusEl.textContent = 'Guardado ✓';
    })
    .catch(function(e){
      statusEl.textContent = 'Error al guardar';
      console.error('[analisis] Error guardando:', e.message);
    })
    .finally(function(){ btn.disabled = false; });
}

document.addEventListener('click', function(e){
  var btn = e.target.closest('[data-analisis-card]');
  if(!btn) return;
  openPanel(btn.dataset.analisisCard);
});

window.CMI_ANALISIS = { open: openPanel };
})();
