(function () {
  'use strict';

  // Adapted from the reference project's parametrizacion.js, trimmed down
  // hard: no admin/session gate, no multi-area template picker, no
  // "Cargar plantillas" browse step — sofia talks to exactly one entity set
  // (ID12086_Tickets_medidor), so the panel is just URL + credentials +
  // template name + "Probar conexión" + "Guardar".

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensurePanel() {
    if (document.getElementById('param-panel')) return;

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

        '<div style="flex:1;overflow-y:auto;padding:18px 22px;" class="scrollbar">',
          '<label style="font-size:12px;color:#475569;display:block;">URL base del servicio OData</label>',
          '<input id="param-url" class="input-base" type="url" placeholder="https://..." style="margin-top:6px;"/>',

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">',
            '<label style="font-size:12px;color:#475569;">Usuario<input id="param-user" class="input-base" type="text" placeholder="usuario" style="margin-top:6px;display:block;"/></label>',
            '<label style="font-size:12px;color:#475569;">Contraseña<input id="param-pass" class="input-base" type="password" placeholder="Dejar en blanco para mantener la actual" style="margin-top:6px;display:block;"/></label>',
          '</div>',

          '<label style="font-size:12px;color:#475569;display:block;margin-top:12px;">Nombre de la plantilla / entidad</label>',
          '<input id="param-template" class="input-base" type="text" value="ID12086_Tickets_medidor" style="margin-top:6px;"/>',

          '<div style="margin-top:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
            '<button id="param-test" class="btn-secondary">Probar conexión</button>',
            '<span id="param-status" style="font-size:12px;color:#64748B;"></span>',
          '</div>',
        '</div>',

        '<footer style="padding:14px 20px;border-top:1px solid #E2E8F0;display:flex;align-items:center;justify-content:flex-end;gap:8px;">',
          '<button id="param-cancel" class="btn-secondary">Cancelar</button>',
          '<button id="param-save" class="btn-primary">Guardar</button>',
        '</footer>',
      '</aside>'
    ].join('');

    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) document.body.appendChild(tmp.firstChild);

    document.getElementById('param-close').addEventListener('click', closePanel);
    document.getElementById('param-cancel').addEventListener('click', closePanel);
    document.getElementById('param-backdrop').addEventListener('click', closePanel);
    document.getElementById('param-test').addEventListener('click', onTest);
    document.getElementById('param-save').addEventListener('click', onSave);
  }

  function readForm() {
    return {
      endpointUrl: document.getElementById('param-url').value.trim(),
      authUser: document.getElementById('param-user').value.trim(),
      authPass: document.getElementById('param-pass').value,
      templateName: document.getElementById('param-template').value.trim() || 'ID12086_Tickets_medidor'
    };
  }

  async function openPanel() {
    ensurePanel();
    document.getElementById('param-status').textContent = 'Cargando configuración guardada...';
    document.getElementById('param-panel').classList.add('open');
    document.getElementById('param-backdrop').classList.add('show');
    document.getElementById('param-panel').setAttribute('aria-hidden', 'false');

    try {
      var res = await fetch('/api/config');
      if (res.ok) {
        var cfg = await res.json();
        document.getElementById('param-url').value = cfg.endpointUrl || '';
        document.getElementById('param-user').value = cfg.authUser || '';
        document.getElementById('param-template').value = cfg.templateName || 'ID12086_Tickets_medidor';
      }
    } catch (err) {
      console.error('[param] Error cargando configuración:', err);
    }
    document.getElementById('param-status').textContent = '';
  }

  function closePanel() {
    var panel = document.getElementById('param-panel');
    var bd = document.getElementById('param-backdrop');
    if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
    if (bd) bd.classList.remove('show');
  }

  async function onTest() {
    var form = readForm();
    var statusEl = document.getElementById('param-status');
    var btn = document.getElementById('param-test');
    if (!form.endpointUrl) { statusEl.innerHTML = '<span class="tag-warn">Ingresa una URL válida.</span>'; return; }

    btn.disabled = true;
    statusEl.textContent = 'Probando conexión...';
    try {
      var res = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      var body = await res.json();
      statusEl.innerHTML = body.ok
        ? '<span class="tag-ok">Conexión exitosa</span>'
        : '<span class="tag-warn">No se pudo conectar. Verifica URL/credenciales.</span>';
    } catch (err) {
      statusEl.innerHTML = '<span class="tag-warn">Error: ' + escapeHtml(err.message) + '</span>';
    } finally {
      btn.disabled = false;
    }
  }

  async function onSave() {
    var form = readForm();
    var statusEl = document.getElementById('param-status');
    var saveBtn = document.getElementById('param-save');
    if (!form.endpointUrl) { statusEl.innerHTML = '<span class="tag-warn">Ingresa una URL válida.</span>'; return; }

    saveBtn.disabled = true;
    statusEl.textContent = 'Guardando...';
    try {
      var res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      var body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || 'No se pudo guardar la configuración.');
      statusEl.innerHTML = '<span class="tag-ok">Configuración guardada</span>';
    } catch (err) {
      statusEl.innerHTML = '<span class="tag-warn">Error: ' + escapeHtml(err.message) + '</span>';
      saveBtn.disabled = false;
      return;
    }
    saveBtn.disabled = false;
    closePanel();

    // Guardado exitoso -> dispara automáticamente "Actualizar datos".
    if (window.SOFIA_APP && window.SOFIA_APP.actualizarDatos) window.SOFIA_APP.actualizarDatos();
  }

  window.SOFIA_PARAM = { open: openPanel, close: closePanel };
})();
