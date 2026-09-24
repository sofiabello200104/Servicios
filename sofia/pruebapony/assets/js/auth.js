(function(){
'use strict';

var _session = null;

// Redirige a /login ante cualquier 401 durante el uso normal de la app
// (sesión expirada o revocada mientras el usuario ya estaba adentro).
var _nativeFetch = window.fetch;
window.fetch = function(){
  return _nativeFetch.apply(this, arguments).then(function(res){
    if(res.status === 401) window.location.href = '/login';
    return res;
  });
};

// Mismo tono que los puntos de área del sidebar (index.html: bg-sky-400, bg-emerald-400,
// bg-amber-400, bg-violet-400, bg-pink-400) pero más clarito/desaturado (equivalente a
// -200) — con texto oscuro encima, look "faded" que igual deja leer bien la sigla.
var AREA_BADGE = {
  comercial : { label: 'DC',  color: '#BAE6FD' },
  financiera: { label: 'GAF', color: '#A7F3D0' },
  proyectos : { label: 'P',   color: '#FDE68A' },
  soluciones: { label: 'S',   color: '#DDD6FE' },
  ids       : { label: 'IDS',   color: '#FBCFE8' },
};
// "Todas las áreas" (Full Access): en vez de un solo color, una rueda con los 5
// colores de área a partes iguales — mezcla visual de todas en vez de un color inventado.
var TODAS_GRADIENT = 'conic-gradient(#BAE6FD 0deg 72deg, #A7F3D0 72deg 144deg, #FDE68A 144deg 216deg, #DDD6FE 216deg 288deg, #FBCFE8 288deg 360deg)';

function buildAreaBadge(area){
  var info = AREA_BADGE[area];
  var badge = document.createElement('span');
  badge.title = info ? area : 'Todas las áreas';
  badge.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;' +
    'width:28px;height:28px;border-radius:50%;font-size:10px;font-weight:800;color:#0F172A;' +
    'background:' + (info ? info.color : TODAS_GRADIENT) + ';';
  badge.textContent = info ? info.label : 'FA';
  return badge;
}

function renderUserBar(){
  var actions = document.querySelector('.topbar-actions');
  if(!actions || !_session) return;

  var usernameEl = document.createElement('span');
  usernameEl.style.cssText = 'font-size:12px;font-weight:600;color:#475569;';
  usernameEl.textContent = _session.username;
  actions.insertBefore(usernameEl, actions.firstChild);
  actions.insertBefore(buildAreaBadge(_session.area), usernameEl);

  var logoutBtn = document.createElement('button');
  logoutBtn.id = 'btn-logout';
  logoutBtn.className = 'btn-logout';
  logoutBtn.textContent = 'Cerrar sesión';
  actions.appendChild(logoutBtn);

  logoutBtn.addEventListener('click', function(){
    fetch('/api/logout', { method: 'POST' }).finally(function(){ window.location.href = '/login'; });
  });
}

function applyAdminVisibility(){
  var navAdmin = document.getElementById('nav-admin');
  if(navAdmin && _session && _session.isAdmin) navAdmin.style.display = '';

  // La parametrización OData ahora la administra un único admin para todos —
  // el resto de sesiones no necesita (ni puede) verla.
  var btnParam = document.getElementById('btn-parametrizacion');
  if(btnParam) btnParam.style.display = (_session && _session.isAdmin) ? '' : 'none';
}

function bootstrap(){
  fetch('/api/session').then(function(res){
    if(res.status !== 200) { window.location.href = '/login'; return null; }
    return res.json();
  }).then(function(session){
    if(!session) return;
    _session = session;
    renderUserBar();
    applyAdminVisibility();
  });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bootstrap);
}else{
  bootstrap();
}

window.CMI_AUTH = { getSession: function(){ return _session; } };
})();
