(function(){
  'use strict';

  var errorEl   = document.getElementById('error');
  var stepLogin = document.getElementById('step-login');
  var stepChange= document.getElementById('step-change');
  var titleEl   = document.getElementById('title');
  var subEl     = document.getElementById('subtitle');

  function showError(msg){
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
  function clearError(){
    errorEl.style.display = 'none';
  }
  function showChangeStep(){
    stepLogin.classList.remove('active');
    stepChange.classList.add('active');
    titleEl.textContent = 'Elegí una nueva contraseña';
    subEl.textContent = 'Tu contraseña actual es temporal. Definí una nueva para continuar.';
    updatePasswordChecklist();
  }

  var ICON_EYE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
  var ICON_EYE_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>';

  document.querySelectorAll('.pw-toggle').forEach(function(btn){
    btn.innerHTML = ICON_EYE;
    btn.addEventListener('click', function(){
      var input = document.getElementById(btn.dataset.toggleTarget);
      var reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.innerHTML = reveal ? ICON_EYE_OFF : ICON_EYE;
      btn.setAttribute('aria-label', reveal ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  });

  // Si ya hay sesión, saltar directo (o continuar el cambio de contraseña pendiente)
  fetch('/api/session').then(function(res){
    if(res.status === 200) return res.json().then(function(json){
      if(json.mustChangePassword) showChangeStep();
      else window.location.href = '/';
    });
  }).catch(function(){});

  stepLogin.addEventListener('submit', function(e){
    e.preventDefault();
    clearError();
    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    var btn = document.getElementById('btn-login');
    btn.disabled = true;
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
      .then(function(r){
        if(r.status !== 200){ showError(r.json.error || 'No se pudo iniciar sesión.'); return; }
        if(r.json.mustChangePassword) showChangeStep();
        else window.location.href = '/';
      })
      .catch(function(){ showError('Error de red al iniciar sesión.'); })
      .finally(function(){ btn.disabled = false; });
  });

  // Checklist en vivo: recalcula cada criterio en cada tecla y pinta de verde/rojo
  // según se cumpla o no (incluida "Coincidencia" contra la confirmación).
  var newPasswordEl  = document.getElementById('new-password');
  var confirmEl      = document.getElementById('new-password-confirm');
  var pwChecklist    = document.getElementById('pw-checklist');

  function updatePasswordChecklist(){
    var pw      = newPasswordEl.value;
    var confirm = confirmEl.value;
    var checks = {
      length : pw.length >= 8,
      lower  : /[a-z]/.test(pw),
      upper  : /[A-Z]/.test(pw),
      number : /[0-9]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw),
      match  : pw.length > 0 && pw === confirm
    };
    Object.keys(checks).forEach(function(key){
      var el = pwChecklist.querySelector('[data-check="'+key+'"]');
      if(!el) return;
      el.classList.toggle('pw-check-ok', checks[key]);
      el.classList.toggle('pw-check-bad', !checks[key]);
    });
  }
  newPasswordEl.addEventListener('input', updatePasswordChecklist);
  confirmEl.addEventListener('input', updatePasswordChecklist);

  // Misma política mínima que exige el servidor (server.js: passwordPolicyError) —
  // se valida acá también para avisar al instante, sin esperar la ida y vuelta al servidor.
  function passwordPolicyError(password){
    // Mensaje genérico a propósito: el checklist de arriba ya marca en rojo/verde
    // cada requisito puntual, listarlos de nuevo acá sería redundante y, devolviendo
    // solo el primero que falla, hasta engañoso (parecería que solo falta ese).
    var ok = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) &&
             /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
    if(!ok) return 'La contraseña no cumple con los parámetros de seguridad.';
    return null;
  }

  stepChange.addEventListener('submit', function(e){
    e.preventDefault();
    clearError();
    var newPassword = document.getElementById('new-password').value;
    var confirm     = document.getElementById('new-password-confirm').value;
    if(newPassword !== confirm){ showError('Las contraseñas no coinciden.'); return; }
    var policyError = passwordPolicyError(newPassword);
    if(policyError){ showError(policyError); return; }

    var btn = document.getElementById('btn-change');
    btn.disabled = true;
    fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPassword })
    }).then(function(res){ return res.json().then(function(json){ return { status: res.status, json: json }; }); })
      .then(function(r){
        if(r.status !== 200){ showError(r.json.error || 'No se pudo cambiar la contraseña.'); return; }
        window.location.href = '/';
      })
      .catch(function(){ showError('Error de red al cambiar la contraseña.'); })
      .finally(function(){ btn.disabled = false; });
  });
})();
