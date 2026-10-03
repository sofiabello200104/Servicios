(function () {
  'use strict';

  // Boot sequence + top-level orchestration: talks to the server (config,
  // odata-proxy, sample data), hands normalized tickets to render.js, and
  // wires the topbar/sidebar controls. Adapted from the reference project's
  // app.js boot pattern, simplified to a single entity set and no
  // login/session gate.

  const M = window.SOFIA_MAPPER;

  const VIEW_META = {
    resumen: { title: 'Resumen', crumb: 'Panel' },
    capacidad: { title: 'Capacidad y Rendimiento', crumb: 'Panel' },
    // Sidebar label and topbar title both read "Primer Nivel de Atención",
    // to pair with the "segundo-nivel" entry below (orchestrator's naming
    // call -- see odd/tasks/primer-nivel-atencion.md's "Naming scope").
    activos: { title: 'Primer Nivel de Atención', crumb: 'Panel' },
    'segundo-nivel': { title: 'Segundo Nivel de Atención', crumb: 'Panel' }
  };
  const LAST_VIEW_KEY = 'sofia_last_view';

  let _currentTickets = [];
  // Capacidad multi-fuente (capacidad-multi-fuente-odata.md): hours from the
  // 4 extra OData sources (Tarea, Tarea con Revisión, Seguimiento Cliente,
  // Capacitación), already { recurso, fecha, horas, fuente } with recurso
  // run through M.normalizeRecurso() — always [] in sample-data mode (no
  // local fixture exists for these 4 entities).
  let _currentExtraRows = [];
  let _extraSourcesFailed = [];
  let _hasData = false;
  // ISO timestamp of the live data currently on screen (fresh or snapshot);
  // used by the "No se pudo actualizar · datos del ..." label.
  let _shownUpdatedAt = null;
  let _currentView = 'resumen';
  let _capacidadStale = true;
  let _activosStale = true;
  let _segundoNivelStale = true;

  function setUpdatingState(isUpdating) {
    const btn = document.getElementById('btn-actualizar-datos');
    if (!btn) return;
    btn.disabled = isUpdating;
    btn.classList.toggle('is-loading', isUpdating);
  }

  function setSkeletons(on) {
    document.querySelectorAll('.card-loading-target').forEach((el) => el.classList.toggle('card-loading', on));
  }

  function updateLastUpdatedText(text) {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = text;
  }

  function showEmptyState(message) {
    _hasData = false;
    document.getElementById('empty-state').style.display = '';
    document.getElementById('views-root').style.display = 'none';
    const msgEl = document.getElementById('empty-state-error');
    if (msgEl) msgEl.textContent = message || '';
  }

  function showContent() {
    _hasData = true;
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('views-root').style.display = '';
  }

  // Renders whichever view is currently active from freshly loaded tickets.
  // Capacidad is rendered lazily elsewhere (only when the user switches to
  // it) unless it's already the active view when data (re)loads, in which
  // case it must refresh immediately rather than show stale numbers.
  // extraRows/failedSources default to []/[] so callers that don't pass them
  // (there are none left, but keeps the signature safe) never crash render.js.
  function renderCurrentData(tickets, extraRows, failedSources) {
    _currentTickets = tickets;
    _currentExtraRows = Array.isArray(extraRows) ? extraRows : [];
    _extraSourcesFailed = Array.isArray(failedSources) ? failedSources : [];
    _capacidadStale = true;
    _activosStale = true;
    _segundoNivelStale = true;
    window.SOFIA_RENDER.renderResumen(tickets);
    if (_currentView === 'capacidad') {
      window.SOFIA_RENDER.renderCapacidad(tickets, _currentExtraRows, { failedSources: _extraSourcesFailed });
      _capacidadStale = false;
    } else if (_currentView === 'activos') {
      window.SOFIA_RENDER.renderActivos(tickets);
      _activosStale = false;
    } else if (_currentView === 'segundo-nivel') {
      window.SOFIA_RENDER.renderSegundoNivel(tickets);
      _segundoNivelStale = false;
    }
  }

  // Normalizes and draws one data set (fresh or from the saved snapshot).
  // extraRaw = data-sources.js rows ({ recursoRaw, fecha, horas, horaInicio, horaFin, fuente }).
  function renderLoadedData(rows, extraRaw, failedSources) {
    const tickets = M.normalizeTickets(rows);
    // Recurso alignment: Title-Case here (same normalizeRecurso() Tickets
    // already goes through); accent/casing fusion across all 5 sources
    // together happens inside buildCapacidad/buildRecursoTickets (mapper.js).
    const extraRows = (extraRaw || []).map((r) => ({
      recurso: M.normalizeRecurso(r.recursoRaw),
      fecha: r.fecha,
      horas: r.horas,
      horaInicio: r.horaInicio,
      horaFin: r.horaFin,
      fuente: r.fuente
    }));
    showContent();
    renderCurrentData(tickets, extraRows, failedSources || []);
  }

  // Shows the last successful load saved in this browser, if any. Returns
  // true when something was drawn.
  async function showSavedSnapshot(label) {
    const snap = await window.SOFIA_STORE.loadSnapshot();
    if (!snap || !Array.isArray(snap.rows) || !snap.rows.length) return false;
    renderLoadedData(snap.rows, snap.extraRows, snap.failedSources);
    _shownUpdatedAt = snap.updatedAt;
    updateLastUpdatedText(label + ' ' + window.SOFIA_STORE.formatUpdatedAt(snap.updatedAt));
    return true;
  }

  async function actualizarDatos() {
    setUpdatingState(true);
    // Skeletons only when there is nothing on screen yet -- with saved data
    // showing, the cards stay readable while the slow refresh runs.
    const hadData = _hasData;
    if (!hadData) setSkeletons(true);
    try {
      // Config (served locally from data/config.json, never touches the
      // upstream OData host) and Tickets are fetched concurrently. The 4
      // extra sources are fetched AFTER Tickets resolves, not overlapping
      // it: the upstream OData host cannot handle concurrent requests
      // under the same credentials — firing all 5 at once was measured to
      // time out 2 of them at the proxy's 20s limit even though each is
      // fast alone. See fetchAllExtraSources' own sequential-fetch note.
      const cfgPromise = fetch('/api/config')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      const ticketsPromise = window.SOFIA_ODATA.fetchTemplate();

      const [cfg, rows] = await Promise.all([cfgPromise, ticketsPromise]);
      const extra = (cfg && cfg.configured && cfg.endpointUrl)
        ? await window.SOFIA_DATA_SOURCES.fetchAllExtraSources(cfg.endpointUrl)
        : { rows: [], failedSources: [] };

      window.SOFIA_STORE.saveRawTickets(rows);
      const now = new Date().toISOString();
      window.SOFIA_STORE.saveUpdatedAt(now);
      renderLoadedData(rows, extra.rows, extra.failedSources);
      _shownUpdatedAt = now;
      updateLastUpdatedText('Actualizado: ' + window.SOFIA_STORE.formatUpdatedAt(now));
      window.SOFIA_STORE.saveSnapshot({ rows, extraRows: extra.rows, failedSources: extra.failedSources, updatedAt: now });
    } catch (err) {
      console.error('[app] Error actualizando datos:', err);
      // Keep whatever is on screen (or fall back to the saved snapshot)
      // instead of blanking the dashboard over a slow/failed refresh.
      if (hadData || await showSavedSnapshot('')) {
        updateLastUpdatedText('No se pudo actualizar · datos del ' + window.SOFIA_STORE.formatUpdatedAt(_shownUpdatedAt));
      } else {
        showEmptyState('No se pudieron cargar los datos: ' + err.message);
      }
    } finally {
      setUpdatingState(false);
      setSkeletons(false);
    }
  }

  async function cargarDatosEjemplo() {
    setSkeletons(true);
    try {
      const res = await fetch('/api/sample');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      const tickets = M.normalizeTickets(rows);
      showContent();
      // Sample-data mode has zero extra-source rows -- no local fixture
      // exists for the 4 extra entities and none should be invented.
      renderCurrentData(tickets, [], []);
      _shownUpdatedAt = null;
      updateLastUpdatedText('Datos de ejemplo (sin conexión OData)');
    } catch (err) {
      console.error('[app] Error cargando datos de ejemplo:', err);
      showEmptyState('No se pudieron cargar los datos de ejemplo: ' + err.message);
    } finally {
      setSkeletons(false);
    }
  }

  /* ==================== View switching ==================== */

  function switchView(view) {
    if (!VIEW_META[view]) return;
    _currentView = view;

    document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach((el) => {
      el.classList.toggle('active', el.id === view + '-content');
    });

    const meta = VIEW_META[view];
    const titleEl = document.querySelector('.page-title');
    const crumbEl = document.querySelector('.crumb');
    if (titleEl) titleEl.textContent = meta.title;
    if (crumbEl) crumbEl.textContent = meta.crumb;

    try { localStorage.setItem(LAST_VIEW_KEY, view); } catch (e) { /* ignore (private mode, etc.) */ }

    if (view === 'capacidad' && _hasData && _capacidadStale) {
      window.SOFIA_RENDER.renderCapacidad(_currentTickets, _currentExtraRows, { failedSources: _extraSourcesFailed });
      _capacidadStale = false;
    }
    if (view === 'activos' && _hasData && _activosStale) {
      window.SOFIA_RENDER.renderActivos(_currentTickets);
      _activosStale = false;
    }
    if (view === 'segundo-nivel' && _hasData && _segundoNivelStale) {
      window.SOFIA_RENDER.renderSegundoNivel(_currentTickets);
      _segundoNivelStale = false;
    }
  }

  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-backdrop').classList.add('show');
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('show');
  }

  function wireControls() {
    const ham = document.getElementById('hamburger');
    if (ham) ham.addEventListener('click', openSidebar);
    const bd = document.getElementById('sidebar-backdrop');
    if (bd) bd.addEventListener('click', closeSidebar);

    const btnParam = document.getElementById('btn-parametrizacion');
    if (btnParam) btnParam.addEventListener('click', () => window.SOFIA_PARAM.open());
    const btnParamEmpty = document.getElementById('btn-abrir-parametrizacion');
    if (btnParamEmpty) btnParamEmpty.addEventListener('click', () => window.SOFIA_PARAM.open());

    const btnActualizar = document.getElementById('btn-actualizar-datos');
    if (btnActualizar) btnActualizar.addEventListener('click', actualizarDatos);

    const btnSample = document.getElementById('btn-cargar-sample');
    if (btnSample) btnSample.addEventListener('click', cargarDatosEjemplo);

    ['filter-resumen-desde', 'filter-resumen-hasta', 'filter-resumen-periodo', 'filter-resumen-proceso', 'filter-resumen-producto'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => window.SOFIA_RENDER.rerenderWithCurrentFilters());
    });

    ['filter-cap-desde', 'filter-cap-hasta', 'filter-cap-proyecto'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => window.SOFIA_RENDER.rerenderCapWithCurrentFilters());
    });
    const btnCapLimpiar = document.getElementById('btn-cap-limpiar');
    if (btnCapLimpiar) btnCapLimpiar.addEventListener('click', () => window.SOFIA_RENDER.clearCapacidadFilters());

    // Cliente drives Proyecto's option list, so it gets its own handler
    // instead of the generic rerender-only loop above.
    const clienteSel = document.getElementById('filter-cap-cliente');
    if (clienteSel) clienteSel.addEventListener('change', () => window.SOFIA_RENDER.onCapClienteChange());

    window.SOFIA_RENDER.wireCapRecursosMultiSelect();
    window.SOFIA_RENDER.wireDrilldownModal();

    // Primer and Segundo Nivel share one template (createNivelView in
    // render.js), which wires its own filters, cards, pager and buttons.
    window.SOFIA_RENDER.wireActivos();
    window.SOFIA_RENDER.wireSegundoNivel();

    document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
      el.addEventListener('click', () => switchView(el.dataset.view));
    });
  }

  async function bootstrap() {
    wireControls();

    let lastView = 'resumen';
    try { lastView = localStorage.getItem(LAST_VIEW_KEY) || 'resumen'; } catch (e) { /* ignore */ }
    switchView(VIEW_META[lastView] ? lastView : 'resumen');

    let cfg;
    try {
      const res = await fetch('/api/config');
      cfg = res.ok ? await res.json() : null;
    } catch (err) {
      console.error('[app] Error consultando /api/config:', err);
      cfg = null;
    }

    if (cfg && cfg.configured) {
      // Saved data first (instant), then the slow live refresh behind it.
      const shown = await showSavedSnapshot('Actualizando… datos del');
      if (!shown) updateLastUpdatedText('Cargando...');
      await actualizarDatos();
    } else {
      showEmptyState();
    }
  }

  window.SOFIA_APP = { actualizarDatos, cargarDatosEjemplo };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
