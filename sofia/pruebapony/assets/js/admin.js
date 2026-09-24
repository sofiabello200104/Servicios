(function(){
'use strict';

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

var AREA_LABELS = {
  comercial:  'Dirección Comercial',
  financiera: 'Gestión Adm. y Fin.',
  proyectos:  'Proyectos',
  soluciones: 'Soluciones',
  ids:        'IDS',
  todas:      'Todas las áreas'
};
var AREA_OPTIONS = ['comercial', 'financiera', 'proyectos', 'soluciones', 'ids', 'todas'];
var _editingId = null;

function mountAdminView(){
  var root = document.getElementById('view-admin');
  if(!root || root._mounted) return;
  root._mounted = true;

  root.innerHTML =
    '<div class="card p-5">' +
      '<h3 class="font-semibold text-slate-800">Crear usuario</h3>' +
      '<p class="text-xs text-slate-500" style="margin-bottom:14px;">El sistema genera una contraseña temporal — el usuario deberá cambiarla en su primer ingreso.</p>' +
      '<form id="admin-create-form" style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;">' +
        '<label style="font-size:12px;font-weight:600;color:#475569;">Usuario' +
          '<input id="admin-new-username" class="input-base" type="text" required style="margin-top:4px;min-width:200px;"/>' +
        '</label>' +
        '<label style="font-size:12px;font-weight:600;color:#475569;">Área' +
          '<select id="admin-new-area" class="input-base" required style="margin-top:4px;min-width:180px;">' +
            AREA_OPTIONS.map(function(a){ return '<option value="'+a+'">'+AREA_LABELS[a]+'</option>'; }).join('') +
          '</select>' +
        '</label>' +
        '<label id="admin-new-isadmin-label" style="font-size:12px;font-weight:600;color:#475569;display:flex;align-items:center;gap:6px;padding-bottom:9px;">' +
          '<input id="admin-new-isadmin" type="checkbox" /> Administrador' +
        '</label>' +
        '<button type="submit" class="btn-primary">Crear usuario</button>' +
      '</form>' +
      '<p class="text-xs text-slate-500" style="margin-top:8px;">El usuario solo va a poder guardar comentarios de Análisis en el área elegida (o en todas, si se marca "Todas las áreas"). Los administradores no tienen esta restricción.</p>' +
      '<div id="admin-temp-password" style="display:none;margin-top:14px;font-size:12px;background:#DCFCE7;color:#15803D;border-radius:8px;padding:10px 12px;"></div>' +
    '</div>' +
    '<div class="card p-5 mt-6">' +
      '<div class="flex items-center justify-between">' +
        '<h3 class="font-semibold text-slate-800">Usuarios</h3>' +
        '<span class="text-xs text-slate-500">Actualizado: <span id="updated-at-admin" class="font-semibold text-slate-700">Sin datos aún</span></span>' +
      '</div>' +
      '<div style="overflow-x:auto;margin-top:12px;">' +
        '<table class="w-full text-sm" style="min-width:520px;">' +
          '<thead><tr class="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">' +
            '<th class="py-2">Usuario</th><th class="py-2">Área</th><th class="py-2">Admin</th><th class="py-2">Estado</th><th class="py-2">Creado</th><th class="py-2"></th>' +
          '</tr></thead>' +
          '<tbody id="admin-users-body"></tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

  document.getElementById('admin-create-form').addEventListener('submit', onCreateUser);
  document.getElementById('admin-users-body').addEventListener('click', onTableAction);
  document.getElementById('admin-temp-password').addEventListener('click', onCopyTempPassword);

  applyCreateFormAreaScope();
}

// Un "jefe de área" (admin acotado, area !== "todas") solo puede crear/gestionar
// líderes dentro de su propia área: no puede reasignar a otra área ni otorgar
// permisos de administrador. Esto refleja en la UI lo que el servidor ya exige
// (ver canManageUser / handleAdminUsersPost en server.js) para no depender solo
// del rechazo del backend.
function isScopedAdmin(session){
  return !!(session && session.isAdmin && session.area !== 'todas');
}

function applyCreateFormAreaScope(){
  var session = window.CMI_AUTH && window.CMI_AUTH.getSession();
  var areaSelect = document.getElementById('admin-new-area');
  var adminLabel = document.getElementById('admin-new-isadmin-label');
  var adminCheckbox = document.getElementById('admin-new-isadmin');
  if(!areaSelect) return;

  if(isScopedAdmin(session)){
    areaSelect.innerHTML = '<option value="'+session.area+'" selected>'+(AREA_LABELS[session.area] || session.area)+'</option>';
    areaSelect.value = session.area;
    areaSelect.disabled = true;
    if(adminLabel) adminLabel.style.display = 'none';
    if(adminCheckbox) adminCheckbox.checked = false;
  } else {
    if(areaSelect.options.length !== AREA_OPTIONS.length){
      areaSelect.innerHTML = AREA_OPTIONS.map(function(a){ return '<option value="'+a+'">'+AREA_LABELS[a]+'</option>'; }).join('');
    }
    areaSelect.disabled = false;
    if(adminLabel) adminLabel.style.display = '';
  }
}

function showTempPassword(username, tempPassword){
  var el = document.getElementById('admin-temp-password');
  el.style.display = 'block';
  el.innerHTML = 'Contraseña temporal para "' + escapeHtml(username) + '": ' +
    '<code class="temp-pw-copy" data-copy="'+escapeHtml(tempPassword)+'" title="Clic para copiar">'+escapeHtml(tempPassword)+'</code>' +
    ' <span style="color:#64748B;">(clic en la contraseña para copiarla; no vuelve a mostrarse)</span>';
}

function onCopyTempPassword(e){
  var el = e.target.closest('.temp-pw-copy');
  if(!el) return;
  var text = el.dataset.copy;
  navigator.clipboard.writeText(text).then(function(){
    var original = el.textContent;
    el.textContent = 'Copiado ✓';
    setTimeout(function(){ el.textContent = original; }, 1200);
  }).catch(function(){
    alert('No se pudo copiar automáticamente. Contraseña: ' + text);
  });
}

function onCreateUser(e){
  e.preventDefault();
  var username = document.getElementById('admin-new-username').value.trim();
  var area     = document.getElementById('admin-new-area').value;
  var isAdmin  = document.getElementById('admin-new-isadmin').checked;
  if(!username) return;

  fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, area: area, isAdmin: isAdmin })
  }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
    .then(function(r){
      if(r.status !== 200){ alert(r.json.error || 'No se pudo crear el usuario.'); return; }
      showTempPassword(username, r.json.tempPassword);
      document.getElementById('admin-new-username').value = '';
      document.getElementById('admin-new-isadmin').checked = false;
      refreshUsers();
    });
}

function onTableAction(e){
  var resetBtn  = e.target.closest('[data-reset-id]');
  var toggleBtn = e.target.closest('[data-toggle-id]');

  if(resetBtn){
    var username = resetBtn.dataset.username;
    if(!confirm('¿Generar una contraseña temporal nueva para "'+username+'"?')) return;
    fetch('/api/admin/users/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resetBtn.dataset.resetId })
    }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
      .then(function(r){
        if(r.status !== 200){ alert(r.json.error || 'No se pudo restablecer la contraseña.'); return; }
        showTempPassword(username, r.json.tempPassword);
        refreshUsers();
      });
  }

  if(toggleBtn){
    fetch('/api/admin/users/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: toggleBtn.dataset.toggleId })
    }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
      .then(function(r){
        if(r.status !== 200){ alert(r.json.error || 'No se pudo cambiar el estado.'); return; }
        refreshUsers();
      });
  }

  var deleteBtn = e.target.closest('[data-delete-id]');
  if(deleteBtn){
    var delUsername = deleteBtn.dataset.username;
    if(!confirm('¿Eliminar definitivamente al usuario "'+delUsername+'"? Esta acción no se puede deshacer.')) return;
    fetch('/api/admin/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteBtn.dataset.deleteId })
    }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
      .then(function(r){
        if(r.status !== 200){ alert(r.json.error || 'No se pudo eliminar el usuario.'); return; }
        refreshUsers();
      });
  }

  var editBtn = e.target.closest('[data-edit-id]');
  if(editBtn){
    _editingId = parseInt(editBtn.dataset.editId, 10);
    refreshUsers();
  }

  var cancelBtn = e.target.closest('[data-cancel-edit]');
  if(cancelBtn){
    _editingId = null;
    refreshUsers();
  }

  var saveBtn = e.target.closest('[data-save-edit]');
  if(saveBtn){
    var row = saveBtn.closest('tr');
    var newUsername = row.querySelector('[data-edit-username]').value.trim();
    var newArea     = row.querySelector('[data-edit-area]').value;
    var newIsAdmin  = row.querySelector('[data-edit-isadmin]').checked;
    if(!newUsername) return;
    fetch('/api/admin/users/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: saveBtn.dataset.saveEdit, username: newUsername, area: newArea, isAdmin: newIsAdmin })
    }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
      .then(function(r){
        if(r.status !== 200){ alert(r.json.error || 'No se pudo editar el usuario.'); return; }
        _editingId = null;
        refreshUsers();
      });
  }
}

function refreshUsers(){
  var body = document.getElementById('admin-users-body');
  if(!body) return;
  var currentSession = window.CMI_AUTH && window.CMI_AUTH.getSession();
  var currentId = currentSession ? currentSession.id : null;
  var scoped = isScopedAdmin(currentSession);

  applyCreateFormAreaScope();

  fetch('/api/admin/users').then(function(res){ return res.json(); }).then(function(json){
    var users = (json && json.users) || [];
    body.innerHTML = users.map(function(u){
      var isSelf = currentId != null && u.id === currentId;

      if(_editingId === u.id){
        // Un jefe de área no puede reasignar de área ni otorgar permisos de
        // administrador (ver handleAdminEditPost en server.js) — el select de
        // área queda fijo a su propia área y el checkbox de admin se oculta.
        var areaCell = scoped
          ? '<select class="input-base" data-edit-area disabled style="min-width:160px;"><option value="'+currentSession.area+'" selected>'+(AREA_LABELS[currentSession.area] || currentSession.area)+'</option></select>'
          : '<select class="input-base" data-edit-area style="min-width:160px;">' +
              AREA_OPTIONS.map(function(a){ return '<option value="'+a+'"'+(a===u.area?' selected':'')+'>'+AREA_LABELS[a]+'</option>'; }).join('') +
            '</select>';
        var adminCell = scoped
          ? '<input type="checkbox" data-edit-isadmin style="display:none;" />'
          : '<input type="checkbox" data-edit-isadmin'+(u.is_admin ? ' checked' : '')+' />';

        return '<tr style="border-bottom:1px solid #F1F5F9;background:#F8FAFC;">' +
          '<td class="py-2"><input class="input-base" type="text" value="'+escapeHtml(u.username)+'" data-edit-username style="min-width:160px;"/></td>' +
          '<td class="py-2">'+areaCell+'</td>' +
          '<td class="py-2">'+adminCell+'</td>' +
          '<td class="py-2">'+(u.is_active ? '<span class="tag-ok">Activo</span>' : '<span class="tag-warn">Inactivo</span>')+'</td>' +
          '<td class="py-2 text-xs text-slate-500">'+escapeHtml(window.CMI_STORE.parseUtc(u.created_at).toLocaleString('es-CO'))+'</td>' +
          '<td class="py-2" style="white-space:nowrap;">' +
            '<button class="btn-primary" style="padding:4px 10px;font-size:11px;" data-save-edit="'+u.id+'">Guardar</button> ' +
            '<button class="btn-secondary" style="padding:4px 10px;font-size:11px;" data-cancel-edit>Cancelar</button>' +
          '</td>' +
        '</tr>';
      }

      return '<tr style="border-bottom:1px solid #F1F5F9;">' +
        '<td class="py-2">'+escapeHtml(u.username)+(isSelf ? ' <span class="tag-mute">tú</span>' : '')+'</td>' +
        '<td class="py-2">'+escapeHtml(AREA_LABELS[u.area] || u.area)+'</td>' +
        '<td class="py-2">'+(u.is_admin ? '<span class="tag-ok">Sí</span>' : '<span class="tag-mute">No</span>')+'</td>' +
        '<td class="py-2">'+(u.is_active ? '<span class="tag-ok">Activo</span>' : '<span class="tag-warn">Inactivo</span>')+'</td>' +
        '<td class="py-2 text-xs text-slate-500">'+escapeHtml(window.CMI_STORE.parseUtc(u.created_at).toLocaleString('es-CO'))+'</td>' +
        '<td class="py-2" style="white-space:nowrap;">' +
          '<button class="btn-secondary" style="padding:4px 10px;font-size:11px;" data-edit-id="'+u.id+'">Editar</button> ' +
          '<button class="btn-secondary" style="padding:4px 10px;font-size:11px;" data-reset-id="'+u.id+'" data-username="'+escapeHtml(u.username)+'">Restablecer contraseña</button> ' +
          (u.username === 'admin' ? '' : '<button class="btn-secondary" style="padding:4px 10px;font-size:11px;" data-toggle-id="'+u.id+'">'+(u.is_active ? 'Desactivar' : 'Activar')+'</button> ') +
          (isSelf ? '' : '<button class="btn-secondary" style="padding:4px 10px;font-size:11px;color:#B91C1C;" data-delete-id="'+u.id+'" data-username="'+escapeHtml(u.username)+'">Eliminar</button>') +
        '</td>' +
      '</tr>';
    }).join('');
  });
}

document.addEventListener('DOMContentLoaded', mountAdminView);

document.addEventListener('click', function(e){
  var navAdmin = e.target.closest('#nav-admin');
  if(navAdmin) refreshUsers();
});
})();
