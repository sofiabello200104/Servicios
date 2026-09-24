(function(){
  const ALIAS = {
    kpi:     ['kpi','indicador','nombre','name','metric'],
    periodo: ['periodo','mes','fecha','period','date','month'],
    valor:   ['valor','real','value','actual','medicion'],
    meta:    ['meta','objetivo','target','goal'],
    unidad:  ['unidad','unit','formato','format'],
    op:      ['operador','op','direccion']
  };
  const MONTHS_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  function norm(s){ return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }

  function detectColumns(sampleRow){
    if(!sampleRow) return null;
    const keys = Object.keys(sampleRow);
    const lookup = {};
    for(const concept of Object.keys(ALIAS)){
      const aliases = ALIAS[concept];
      // 1st pass: exact match (highest confidence)
      let hit = keys.find(k => aliases.includes(norm(k)));
      // 2nd pass: column name contains any alias, or alias contains column name
      if(!hit) hit = keys.find(k => {
        const nk = norm(k);
        return aliases.some(a => nk.includes(a) || a.includes(nk));
      });
      if(hit) lookup[concept] = hit;
    }
    return lookup;
  }

  function isAutoMapComplete(map){
    return !!(map && map.kpi && map.periodo && map.valor);
  }

  function parseMonthIndex(raw){
    if(raw == null) return null;
    if(typeof raw === 'number'){
      if(raw >= 1 && raw <= 12) return raw - 1;
      return null;
    }
    const s = norm(raw);
    // OData /Date(ms)/ — use UTC epoch, no local drift
    const odataMatch = String(raw).match(/\/[Dd]ate\((-?\d+)\)\//i);
    if(odataMatch){ return new Date(parseInt(odataMatch[1], 10)).getUTCMonth(); }
    // ISO YYYY-MM-DD — regex only, never new Date() (UTC-5 drift risk)
    const isoMatch = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(isoMatch){ const m = parseInt(isoMatch[2], 10); return m >= 1 && m <= 12 ? m - 1 : null; }
    // DD/MM/YYYY — regex only, never new Date()
    const dmyMatch = String(raw).match(/^(\d{1,2})\/(\d{2})\/(\d{4})/);
    if(dmyMatch){ const m = parseInt(dmyMatch[2], 10); return m >= 1 && m <= 12 ? m - 1 : null; }
    const ix = MONTHS_ES.findIndex(m => s.startsWith(m) || s.includes(' '+m) || s.includes('-'+m) || s.includes('/'+m));
    if(ix >= 0) return ix;
    // No new Date(raw) fallback — engine-dependent with ambiguous strings;
    // OData/ISO/DD-MM-YYYY/month-name branches cover all real formats.
    // Avoid false positives from large numbers in non-date strings
    const match = s.match(/^(\d{1,2})$/);
    if(match){ const n = parseInt(match[1],10); if(n>=1 && n<=12) return n-1; }
    return null;
  }

  function buildKpiBundle(rows, mapping){
    const kpis = {};
    if(!Array.isArray(rows) || !mapping) return { kpis };
    for(const r of rows){
      const label = r[mapping.kpi];
      if(label == null) continue;
      const key = norm(label);
      const valor = Number(r[mapping.valor]);
      if(isNaN(valor)) continue;
      const ix = parseMonthIndex(r[mapping.periodo]);
      if(ix == null) continue;
      if(!kpis[key]){
        kpis[key] = {
          label: String(label),
          serie: Array(12).fill(null),
          meta: mapping.meta ? Number(r[mapping.meta]) : null,
          unidad: mapping.unidad ? r[mapping.unidad] : null,
          op: mapping.op ? norm(r[mapping.op]) : 'gte'
        };
      }
      kpis[key].serie[ix] = valor;
      if(mapping.meta){ const m = Number(r[mapping.meta]); if(!isNaN(m)) kpis[key].meta = m; }
    }
    return { kpis };
  }

  function matchCanonical(bundle, canonicalList){
    const out = {};
    for(const can of canonicalList){
      const canKey = norm(can.label);
      const found = Object.entries(bundle.kpis).find(function([k, v]){
        return k.includes(canKey) || canKey.includes(k) || norm(v.label).includes(canKey);
      });
      out[can.id] = found ? found[1] : null;
    }
    return out;
  }

  // Encuentra una columna cuyo nombre normalizado calce con alguno de los alias dados
  // (mismo criterio en 2 pasadas que detectColumns: match exacto primero, luego "contiene").
  function findAliasColumn(sampleRow, aliases){
    if(!sampleRow || !aliases || !aliases.length) return null;
    const keys = Object.keys(sampleRow);
    let hit = keys.find(k => aliases.some(a => norm(k) === a));
    if(!hit) hit = keys.find(k => {
      const nk = norm(k);
      return aliases.some(a => nk.includes(a) || a.includes(nk));
    });
    return hit || null;
  }

  // Encuentra la columna de fecha en una fila de muestra
  function findDateColumn(sampleRow){
    return findAliasColumn(sampleRow, ['fecha','date','periodo','mes','month','time']);
  }

  // Agrega datos transaccionales anchos (una fila por evento) en series mensuales.
  // targets: array de { id, label, aliases, filter? }
  // filter: { col, val } — solo suma filas donde norm(row[col]) === val
  function buildWideBundle(rows, targets){
    if(!rows || !rows.length) return { kpis: {} };
    const sampleRow = rows[0];
    const dateCol = findDateColumn(sampleRow);
    if(!dateCol) return { kpis: {} };

    const colMap = []; // [{ col, target }]
    for(const k of Object.keys(sampleRow)){
      if(k === dateCol) continue;
      const nk = norm(k);
      for(const t of targets){
        const allAliases = [norm(t.id), norm(t.label), ...(t.aliases || []).map(norm)];
        if(allAliases.some(a => nk === a || nk.includes(a) || a.includes(nk))){
          colMap.push({ col: k, target: t });
          break;
        }
      }
    }

    const kpis = {};
    const init = t => { if(!kpis[t.id]) kpis[t.id] = { label: t.label, serie: Array(12).fill(null), meta: null }; };

    for(const row of rows){
      const ix = parseMonthIndex(row[dateCol]);
      if(ix == null) continue;
      for(const { col, target } of colMap){
        if(target.filter){
          if(norm(String(row[target.filter.col] || '')) !== target.filter.val) continue;
        }
        const val = Number(row[col]);
        if(isNaN(val)) continue;
        init(target);
        kpis[target.id].serie[ix] = (kpis[target.id].serie[ix] || 0) + val;
      }
    }

    return { kpis };
  }

  // Agrega filas transaccionales en series mensuales para indicadores IDS de
  // "métrica única por fila" (sin columna de KPI, meta propia por fila) o
  // "agrupados" (misma forma + una dimensión extra, ej. producto). A diferencia
  // de buildWideBundle, los valores del mismo mes se PROMEDIAN, no se suman
  // (varios eventos de PORCENTAJE en un mes deben promediarse, no acumularse).
  // cols: { fecha, valor, meta?, grupo? } — nombres de columna ya resueltos.
  function buildMetricBundle(rows, cols){
    const empty = { serie: Array(12).fill(null), meta: null, groups: {} };
    if(!Array.isArray(rows) || !cols || !cols.fecha || !cols.valor) return empty;

    const sums = Array(12).fill(0), counts = Array(12).fill(0), metaVotes = {};
    const groups = {};

    for(const row of rows){
      const ix = parseMonthIndex(row[cols.fecha]);
      if(ix == null) continue;
      const val = Number(row[cols.valor]);
      if(isNaN(val)) continue;
      sums[ix] += val; counts[ix] += 1;

      if(cols.meta){
        const m = Number(row[cols.meta]);
        if(!isNaN(m)) metaVotes[m] = (metaVotes[m] || 0) + 1;
      }
      if(cols.grupo){
        let g = row[cols.grupo];
        g = (g == null) ? '' : String(g).trim();
        if(!g) continue;
        if(!groups[g]) groups[g] = { sums: Array(12).fill(0), counts: Array(12).fill(0) };
        groups[g].sums[ix] += val; groups[g].counts[ix] += 1;
      }
    }

    const toSerie = (sums, counts) => sums.map((s,i) => counts[i] ? s/counts[i] : null);
    const pickMeta = votes => {
      const keys = Object.keys(votes);
      if(!keys.length) return null;
      keys.sort((a,b) => votes[b]-votes[a]); // más frecuente primero
      return Number(keys[0]);
    };

    const out = { serie: toSerie(sums, counts), meta: pickMeta(metaVotes), groups: {} };
    for(const g of Object.keys(groups)){
      out.groups[g] = { serie: toSerie(groups[g].sums, groups[g].counts) };
    }
    return out;
  }

  // Año de ciclo de reporte del tablero — fijo, no new Date().getFullYear(): todas
  // las etiquetas de periodo de este CMI ya están fijadas a 2026 en legacy-render.js
  // (Q_RANGES, TITLES, etc.). Usar el año del reloj del navegador rompería el corte
  // apenas cambie el calendario, aunque el ciclo de reporte siga siendo 2026.
  const REPORT_YEAR = 2026;

  // Acciones que definen backlog abierto en la plantilla de tickets de Soluciones
  // (ID12046_73_Tablero_Indicadores_MCI) — CIERRE y CREAR quedan fuera a propósito,
  // no son trabajo pendiente.
  const TICKET_BACKLOG_ACTIONS = ['REALIZAR','REVISION DEV','ENTREGA FINAL','REVISION CALIDAD','AGENDA ENTREGA FINAL','REVISION SOLUCION','ACTUALIZA VERSION'];

  // Fecha completa (día+mes+año) a partir de un valor crudo de fila transaccional.
  // A diferencia de parseMonthIndex (que solo devuelve el mes), acá hace falta
  // también el año: la extracción de tickets trae más de un año de historial, y sin
  // filtrar por año el "mes 1" mezclaría enero de 2024/2025/2026 y desviaría el %
  // de confiabilidad real.
  function parseFechaCompleta(raw){
    if(raw == null) return null;
    if(typeof raw === 'number'){
      // Serial de fecha de Excel/OLE (día, sin hora; época 1899-12-30). Rango
      // 20000–80000 cubre ~1954–2119 — suficiente margen para no confundirlo con
      // un "mes número" (1-12) como el que sí maneja parseMonthIndex().
      if(raw > 20000 && raw < 80000) return new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
      return null;
    }
    const s = String(raw);
    const odataMatch = s.match(/\/[Dd]ate\((-?\d+)\)\//i);
    if(odataMatch) return new Date(parseInt(odataMatch[1], 10));
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(isoMatch){
      const y = parseInt(isoMatch[1],10), m = parseInt(isoMatch[2],10), d = parseInt(isoMatch[3],10);
      return (m>=1 && m<=12) ? new Date(Date.UTC(y, m-1, d)) : null;
    }
    const dmyMatch = s.match(/^(\d{1,2})\/(\d{2})\/(\d{4})/);
    if(dmyMatch){
      const d2 = parseInt(dmyMatch[1],10), m2 = parseInt(dmyMatch[2],10), y2 = parseInt(dmyMatch[3],10);
      return (m2>=1 && m2<=12) ? new Date(Date.UTC(y2, m2-1, d2)) : null;
    }
    return null;
  }

  function pad2(n){ return String(n).padStart(2,'0'); }
  function formatFechaCorte(d){ return pad2(d.getUTCDate())+'/'+pad2(d.getUTCMonth()+1)+'/'+d.getUTCFullYear(); }

  // Paleta categórica validada para accesibilidad en daltonismo (ver skill dataviz):
  // 8 tonos con separación garantizada + gris neutro reservado para 'OTROS'. Se emite
  // SIEMPRE junto a los datos de productos: la dona de Soluciones la lee en su
  // generateLabels, y sin un arreglo de colores del mismo largo que los datos, ese
  // callback revienta al construirse el chart y deja el canvas inutilizable.
  const PRODUCTO_COLORS = ['#0EA5E9','#6D28D9','#F97316','#1D4ED8','#EC4899','#0D9488','#84CC16','#B45309'];
  const PRODUCTO_COLOR_OTROS = '#94A3B8';

  // Agrega la tabla de hechos de tickets (una fila = un ticket) de la plantilla
  // ID12046_73_Tablero_Indicadores_MCI en el snapshot de Soluciones: backlog abierto
  // por recurso/acción/cliente/producto + confiabilidad mensual del año de reporte.
  // cols: nombres de columna ya resueltos { estado, accion, cliente, producto,
  // recurso, diagnostico, fecha }.
  function buildTicketStats(rows, cols){
    const empty = {
      abiertos:0, calidad:0, servicios:0,
      recursos:{labels:[],data:[]}, acciones:{labels:[],data:[]},
      clientes:{labels:[],data:[]}, productos:{labels:[],data:[],colors:[]},
      confiabilidad:Array(12).fill(null), defectos:Array(12).fill(null),
      corte:null
    };
    if(!Array.isArray(rows) || !cols || !cols.estado || !cols.accion || !cols.diagnostico || !cols.fecha) return empty;

    const backlogSet = {};
    TICKET_BACKLOG_ACTIONS.forEach(a => { backlogSet[a] = true; });

    let abiertos = 0, calidad = 0, servicios = 0, maxFecha = null;
    const recursoCount = {}, accionCount = {}, clienteCount = {}, productoCount = {};
    const totalByMonth = Array(12).fill(0), calByMonth = Array(12).fill(0);

    rows.forEach(row => {
      const estado      = String(row[cols.estado]).trim();
      const accion      = String(row[cols.accion] || '').trim().toUpperCase();
      const diagnostico = String(row[cols.diagnostico] || '').trim();
      const isBacklog   = estado === '1' && backlogSet[accion];

      if(isBacklog){
        abiertos++;
        if(diagnostico === 'Calidad') calidad++; else servicios++;
        if(cols.recurso){  const r = String(row[cols.recurso]  || '').trim(); if(r) recursoCount[r]   = (recursoCount[r]  ||0)+1; }
        accionCount[accion] = (accionCount[accion]||0)+1;
        if(cols.cliente){  const c = String(row[cols.cliente]  || '').trim(); if(c) clienteCount[c]   = (clienteCount[c]  ||0)+1; }
        if(cols.producto){ const p = String(row[cols.producto] || '').trim(); if(p) productoCount[p]  = (productoCount[p] ||0)+1; }
      }

      // Confiabilidad: TODAS las filas del año de reporte (no solo backlog) — "TS
      // que cumplen niveles de servicio en calidad" se mide contra el universo
      // completo de tickets atendidos, no contra el subconjunto aún abierto.
      const fecha = parseFechaCompleta(row[cols.fecha]);
      if(fecha){
        if(!maxFecha || fecha > maxFecha) maxFecha = fecha;
        if(fecha.getUTCFullYear() === REPORT_YEAR){
          const mi = fecha.getUTCMonth();
          totalByMonth[mi]++;
          if(diagnostico === 'Calidad') calByMonth[mi]++;
        }
      }
    });

    const sortedDesc  = counts => Object.keys(counts).sort((a,b) => counts[b]-counts[a]);
    const toLabelsData = (keys, counts) => ({ labels: keys, data: keys.map(k => counts[k]) });

    const recursos = toLabelsData(sortedDesc(recursoCount), recursoCount);
    const acciones  = toLabelsData(sortedDesc(accionCount),  accionCount);
    // Todos los clientes (sin tope): la tarjeta usa scroll horizontal, así que no hace
    // falta recortar a un top-N — se ordenan desc por backlog y se muestran completos.
    const clientes  = toLabelsData(sortedDesc(clienteCount), clienteCount);

    // Productos: top 8 + resto plegado en 'OTROS' (siempre al final, sin reordenar).
    const prodKeys  = sortedDesc(productoCount);
    const top8      = prodKeys.slice(0, 8);
    const restoSum  = prodKeys.slice(8).reduce((s,k) => s+productoCount[k], 0);
    const productos = { labels: top8.slice(), data: top8.map(k => productoCount[k]),
      colors: top8.map((_, i) => PRODUCTO_COLORS[i % PRODUCTO_COLORS.length]) };
    if(restoSum > 0){ productos.labels.push('OTROS'); productos.data.push(restoSum); productos.colors.push(PRODUCTO_COLOR_OTROS); }

    // Meses sin ninguna fila → null (no 0: un 0 se leería como 0% de confiabilidad,
    // no como "todavía sin datos").
    const confiabilidad = totalByMonth.map((t,i) => t>0 ? +(100 - (calByMonth[i]/t*100)).toFixed(1) : null);
    const defectos      = confiabilidad.map(v => v==null ? null : +(100-v).toFixed(1));

    return { abiertos, calidad, servicios, recursos, acciones, clientes, productos, confiabilidad, defectos,
      corte: maxFecha ? formatFechaCorte(maxFecha) : null };
  }

  /* ==================== Control de cuotas / PMO (ID11887_Contro_de_cuotas) ====================
     Forma propia: una fila = un proyecto, y CADA indicador se abre en 12 columnas
     sufijadas por mes (89 columnas en total). No calza con el detector tidy ni con
     buildWideBundle (no hay columna de KPI, ni de periodo, ni una única columna de
     valor), igual que 'single'/'grouped' en IDS o 'tickets' en Soluciones.

     Grupos de columnas (prefijo -> significado), 12 columnas cada uno:
       aaVr<Mes>       -> valor proyectado de la cuota, CON IVA incluido
       aaVrIVA<Mes>    -> porcion de IVA de esa cuota
       aaVrFact<Mes>   -> valor facturado por la PMO  (= "Vr Ejecutado PMO")
       aaVrAbo<Mes>    -> valor abonado por el cliente (= "Recaudado")
       FL<Mes>         -> fecha limite
       Doc<Mes>        -> numero de documento/factura
       SN<Mes>         -> "Si"/"No" — el slicer CUMPLE del tablero Power BI

     Medidas del tablero (definiciones confirmadas por el area de Proyectos):
       Valor total con IVA = suma Vr             <- las columnas Vr YA incluyen IVA
       Valor total sin IVA = suma Vr - suma VrIVA
       Vr Ejecutado PMO    = suma VrFact con SN = "Si"
       Pendiente PMO       = conIVA - ejecutadoPMO
       %PMO                = ejecutadoPMO / conIVA
       Valor Facturado     = suma VrFact (todas las cuotas con factura)
       Recaudado           = suma VrAbo
       Pendiente Recaudo   = facturado - recaudado
       %Recaudado          = recaudado / facturado
     El barrido mensual del grafico usa Saldo por Ejecutar = Proyectado - EjecutadoPMO,
     cuya suma anual reproduce exactamente Pendiente PMO — es el chequeo interno de
     coherencia entre tarjetas, grafico y tabla de detalle.

     'ivaTotal' (suma VrIVA) se expone aparte porque el resumen lateral lo muestra;
     no confundir con 'totalSinIva', que es la base gravable (Vr menos IVA). */

  const CUOTAS_MONTH_TOKENS = (function(){
    const byMonth = [
      ['enero'], ['febrero','feb'], ['marzo'], ['abril'], ['mayo'], ['junio'],
      ['julio'], ['agosto'], ['septiembre','sept','sep'], ['octubre','oct'],
      ['noviembre','nov'], ['diciembre','dic']
    ];
    const flat = [];
    byMonth.forEach(function(toks, i){ toks.forEach(function(t){ flat.push({ t: t, i: i }); }); });
    // Token mas largo primero: si no, 'oct' se comeria 'octubre' y 'feb' a 'febrero'.
    return flat.sort(function(a, b){ return b.t.length - a.t.length; });
  })();

  function cuotasMonthIndex(normalizedKey){
    for(const m of CUOTAS_MONTH_TOKENS){
      if(normalizedKey.indexOf(m.t) !== -1) return m.i;
    }
    return null;
  }

  // El orden importa: aeVrIVAFactMayo lleva IVA y Fact en el nombre, pero es la
  // columna de IVA; aeVrFactFactMayo duplica "Fact" y es la de facturacion.
  function cuotasGroup(nk){
    if(nk.indexOf('fl')  === 0) return 'fl';
    if(nk.indexOf('doc') === 0) return 'doc';
    if(nk.indexOf('sn')  === 0) return 'sn';
    if(nk.indexOf('iva')  !== -1) return 'iva';
    if(nk.indexOf('abo')  !== -1) return 'abo';
    if(nk.indexOf('fact') !== -1) return 'fact';
    if(/^a[a-l]vr/.test(nk)) return 'vr';
    return null;
  }

  const CUOTAS_IDENT = {
    id:          ['id'],
    cliente:     ['cliente','client'],
    responsable: ['respproyecto','responsable','resp'],
    estado:      ['estados','estado'],
    cuotas:      ['cantcuotas','cuotas']
  };

  /* Resuelve los nombres reales de columna de una fila de muestra. Devuelve null si
     la fila no tiene la forma de la plantilla de cuotas — asi el llamador puede
     detectar la plantilla sin hardcodear su nombre. */
  function resolveCuotasColumns(sampleRow){
    if(!sampleRow) return null;
    const keys = Object.keys(sampleRow);
    const cols = {};
    ['vr','iva','fact','abo','doc','sn','fl'].forEach(function(g){ cols[g] = Array(12).fill(null); });

    const ident = {};
    for(const key of keys){
      const nk = norm(key);
      for(const concept of Object.keys(CUOTAS_IDENT)){
        if(!ident[concept] && CUOTAS_IDENT[concept].indexOf(nk) !== -1) ident[concept] = key;
      }
      const mi = cuotasMonthIndex(nk);
      if(mi == null) continue;
      const g = cuotasGroup(nk);
      if(g && cols[g] && cols[g][mi] == null) cols[g][mi] = key;
    }

    const filled = function(arr){ return arr.filter(Boolean).length; };
    // Sin proyectado ni facturado no hay nada que medir: no es esta plantilla.
    if(filled(cols.vr) < 12 || filled(cols.fact) < 12) return null;
    if(!ident.cliente) return null;

    cols.id          = ident.id          || null;
    cols.cliente     = ident.cliente;
    cols.responsable = ident.responsable || null;
    cols.estado      = ident.estado      || null;
    cols.cuotas      = ident.cuotas      || null;
    return cols;
  }

  // Los montos pueden llegar como number (OData/JSON) o como texto con separadores
  // de miles en formato es-CO ("5.663.766,00") segun como exponga el feed la columna.
  function cuotasNum(v){
    if(v == null || v === '') return 0;
    if(typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/[^0-9.,-]/g, '');
    if(s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }

  /* La plataforma origen convive con dos formatos del mismo nombre ("Daniela Moreno
     Anzola" y "DANIELA MORENO ANZOLA"). El slicer de Power BI los muestra duplicados;
     aca se agrupan por clave normalizada y se rotulan en Titulo. */
  function cuotasTitleCase(s){
    return String(s || '').trim().toLowerCase().split(/(\s+)/)
      .map(function(w){ return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; })
      .join('');
  }

  /* rows -> celdas (una por proyecto x mes con movimiento). Es la unica granularidad
     que necesitan las tarjetas, el grafico y la tabla de detalle, asi que los filtros
     del tablero se aplican despues sobre esta lista (summarizeCuotas). */
  function buildCuotasCells(rows){
    const empty = { celdas: [], responsables: [] };
    if(!Array.isArray(rows) || !rows.length) return empty;
    const cols = resolveCuotasColumns(rows[0]);
    if(!cols) return empty;

    const celdas = [];
    const respSeen = {};

    for(const row of rows){
      const rawResp = cols.responsable ? String(row[cols.responsable] || '').trim() : '';
      const respKey = norm(rawResp);
      if(respKey && !respSeen[respKey]) respSeen[respKey] = cuotasTitleCase(rawResp);

      for(let i = 0; i < 12; i++){
        const proyectado = cuotasNum(cols.vr[i]   ? row[cols.vr[i]]   : 0);
        const iva        = cuotasNum(cols.iva[i]  ? row[cols.iva[i]]  : 0);
        const ejecutado  = cuotasNum(cols.fact[i] ? row[cols.fact[i]] : 0);
        const abonado    = cuotasNum(cols.abo[i]  ? row[cols.abo[i]]  : 0);
        if(!proyectado && !iva && !ejecutado && !abonado) continue;

        const snRaw  = cols.sn[i]  ? row[cols.sn[i]]  : '';
        const docRaw = cols.doc[i] ? String(row[cols.doc[i]] || '').trim() : '';
        celdas.push({
          id         : cols.id ? String(row[cols.id] || '').trim() : '',
          cliente    : String(row[cols.cliente] || '').trim(),
          responsable: respSeen[respKey] || rawResp,
          respKey    : respKey,
          estado     : cols.estado ? String(row[cols.estado] || '').trim() : '',
          cuotas     : cols.cuotas ? String(row[cols.cuotas] || '').trim() : '',
          mes        : i,
          proyectado : proyectado,
          iva        : iva,
          ejecutado  : ejecutado,
          abonado    : abonado,
          cumple     : norm(snRaw) === 'si',
          doc        : (docRaw && docRaw !== '0') ? docRaw : ''
        });
      }
    }

    const responsables = Object.keys(respSeen)
      .map(function(k){ return { key: k, label: respSeen[k] }; })
      .sort(function(a, b){ return a.label.localeCompare(b.label, 'es'); });

    return { celdas: celdas, responsables: responsables };
  }

  /* Agrega las celdas ya filtradas en las medidas del tablero.
     filtro: { meses:[ix]|null, cumple:'todos'|'si'|'no', responsable:respKey|'todos', cliente:'texto' } */
  function summarizeCuotas(celdas, filtro){
    filtro = filtro || {};
    const meses  = Array.isArray(filtro.meses) ? filtro.meses : null;
    const cumple = filtro.cumple || 'todos';
    const resp   = filtro.responsable || 'todos';
    const cli    = norm(filtro.cliente || '');

    const zeros = function(){ return Array(12).fill(0); };
    const out = {
      proyectado: zeros(), ejecutado: zeros(), facturado: zeros(), saldo: zeros(),
      iva: zeros(), recaudado: zeros(),
      totalConIva: 0, ivaTotal: 0, totalSinIva: 0,
      ejecutadoPmo: 0, pendientePmo: 0, pctPmo: 0,
      facturadoTotal: 0, recaudadoTotal: 0, pendienteRecaudo: 0, pctRecaudado: 0,
      filas: [], proyectos: 0
    };

    const idsVistos = {};
    for(const c of (celdas || [])){
      if(meses && meses.indexOf(c.mes) === -1) continue;
      if(cumple === 'si' && !c.cumple) continue;
      if(cumple === 'no' && c.cumple) continue;
      if(resp !== 'todos' && c.respKey !== resp) continue;
      if(cli && norm(c.cliente).indexOf(cli) === -1) continue;

      out.proyectado[c.mes] += c.proyectado;
      out.iva[c.mes]        += c.iva;
      out.recaudado[c.mes]  += c.abonado;
      // Valor Facturado: toda cuota con factura emitida.
      out.facturado[c.mes]  += c.ejecutado;
      // Ejecutado PMO: solo las cuotas que ademas cumplen (SN = "Si").
      if(c.cumple) out.ejecutado[c.mes] += c.ejecutado;
      if(c.id) idsVistos[c.id] = true;
      out.filas.push(c);
    }

    for(let i = 0; i < 12; i++){
      out.saldo[i]        = out.proyectado[i] - out.ejecutado[i];
      out.totalConIva    += out.proyectado[i];
      out.ivaTotal       += out.iva[i];
      out.totalSinIva    += out.proyectado[i] - out.iva[i];
      out.ejecutadoPmo   += out.ejecutado[i];
      out.facturadoTotal += out.facturado[i];
      out.recaudadoTotal += out.recaudado[i];
    }
    out.pendientePmo     = out.totalConIva - out.ejecutadoPmo;
    out.pendienteRecaudo = out.facturadoTotal - out.recaudadoTotal;
    out.pctPmo           = out.totalConIva    ? (out.ejecutadoPmo   / out.totalConIva)    * 100 : 0;
    out.pctRecaudado     = out.facturadoTotal ? (out.recaudadoTotal / out.facturadoTotal) * 100 : 0;
    out.proyectos        = Object.keys(idsVistos).length;

    // Mismo orden que la tabla del tablero: mayor saldo pendiente primero.
    out.filas.sort(function(a, b){ return (b.proyectado - b.ejecutado) - (a.proyectado - a.ejecutado); });
    return out;
  }

  /* ==================== Hitos PMO (ID11920_Hitos_PMO) ====================
     Forma propia: una fila = un contrato, con 12 grupos de 4 columnas sufijadas por
     numero de hito:
       Hito<N>              -> descripcion del hito
       FechaHito<N>         -> fecha ESTIMADA
       FechaRealHito<N>     -> fecha REAL de cumplimiento
       CumplimientoHito<N>  -> "SI" / "NO" / vacio
     Mas los identificadores: ID, Cliente, CoordinadorProyecto (responsable),
     TipoLicencia, NumeroContrato, Proyecto, Estados.

     Indicador principal pedido por el area:
       % Cumplimiento = (Hitos habilitados para facturacion / Hitos facturables) x 100
       - habilitados = CumplimientoHito<N> = "SI"
       - facturables = CumplimientoHito<N> en ("SI", "NO")
     Los hitos con cumplimiento vacio NO entran en la formula: son hitos que todavia
     no se evaluaron, no un incumplimiento.

     Semaforo de fechas: si FechaReal <= FechaEstimada el hito se cumplio en fecha o
     antes (verde); si es posterior, va en rojo con los dias de atraso.

     Que un hito EXISTA lo define su DESCRIPCION, no sus fechas: un grupo con fecha
     pero sin descripcion es una columna suelta del ancho fijo de 12 (validado con el
     contrato 488730, que trae fechas duplicadas en el grupo 4 pero solo tiene 3 hitos
     reales).

     OJO — el EXPORT XLSX de muestra no trae las descripciones (columnas Hito<N>
     corridas: Hito1..5 con numeros, Hito6 con "SI"/"NO", solo Hito7+ con texto; se
     verifico que el texto no esta en ninguna celda del archivo). El FEED ODATA REAL
     si las entrega — es contra ese feed que corre la app. Si algun dia un feed llega
     sin descripciones, esta regla vacia la vista: ese es el sintoma a mirar. */

  const HITO_IDENT = {
    id:          ['id'],
    cliente:     ['cliente','client'],
    responsable: ['coordinadorproyecto','responsable','coordinador','respproyecto'],
    licencia:    ['tipolicencia','licencia'],
    contrato:    ['numerocontrato','contrato'],
    proyecto:    ['proyecto'],
    estado:      ['estados','estado']
  };

  const HITO_MAX = 12;

  /* Resuelve los nombres reales de columna. Devuelve null si la fila no tiene la forma
     de la plantilla de hitos — asi la plantilla se detecta por forma, no por nombre. */
  function resolveHitosColumns(sampleRow){
    if(!sampleRow) return null;
    const keys = Object.keys(sampleRow);
    const cols = { hito: [], fecha: [], real: [], cumple: [] };
    Object.keys(cols).forEach(function(g){ cols[g] = Array(HITO_MAX).fill(null); });

    const setCol = function(g, nRaw, key){
      const i = parseInt(nRaw, 10) - 1;
      if(i >= 0 && i < HITO_MAX) cols[g][i] = key;
    };

    const ident = {};
    for(const key of keys){
      const nk = norm(key);
      for(const concept of Object.keys(HITO_IDENT)){
        if(!ident[concept] && HITO_IDENT[concept].indexOf(nk) !== -1) ident[concept] = key;
      }
      // Anclados: 'fecharealhito1' no debe caer en la rama de 'hito1'.
      let m;
      if((m = nk.match(/^hito(\d{1,2})$/)))                   setCol('hito', m[1], key);
      else if((m = nk.match(/^fechahito(\d{1,2})$/)))         setCol('fecha', m[1], key);
      else if((m = nk.match(/^fecharealhito(\d{1,2})$/)))     setCol('real', m[1], key);
      else if((m = nk.match(/^cumplimientohito(\d{1,2})$/)))  setCol('cumple', m[1], key);
    }

    // Minimo para considerarla la plantilla de hitos: el primer grupo completo de
    // fecha + cumplimiento, y un cliente al que colgar el hito.
    if(!cols.fecha[0] || !cols.cumple[0] || !ident.cliente) return null;

    cols.id          = ident.id          || null;
    cols.cliente     = ident.cliente;
    cols.responsable = ident.responsable || null;
    cols.licencia    = ident.licencia    || null;
    cols.contrato    = ident.contrato    || null;
    cols.proyecto    = ident.proyecto    || null;
    cols.estado      = ident.estado      || null;
    return cols;
  }

  const DIA_MS = 86400000;

  /* Devuelve '' cuando el valor no es una descripcion utilizable: vacio, puramente
     numerico o "SI"/"NO" — los tres casos que produce el export corrido de esta
     plantilla (ver nota de arriba). */
  function hitoDescripcion(raw){
    // _x000D_ / _x000A_: escapes de CR/LF que Excel deja crudos en el texto exportado.
    const s = (raw == null) ? ''
      : String(raw).replace(/_x00(0D|0A|09)_/gi, ' ').replace(/\s+/g, ' ').trim();
    if(!s) return '';
    if(/^\d+([.,]\d+)?$/.test(s)) return '';   // "9", "500"
    if(/^(si|no)$/i.test(s))      return '';   // "SI" corrido de otra columna
    return s;
  }


  function hitosTitleCase(s){
    return String(s || '').trim().toLowerCase().split(/(\s+)/)
      .map(function(w){ return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; })
      .join('');
  }

  /* rows -> celdas (una por contrato x hito con dato). Misma estrategia que las cuotas:
     una lista plana y los filtros del tablero se aplican despues (summarizeHitos). */
  function buildHitosCells(rows){
    const empty = { celdas: [], responsables: [], licencias: [] };
    if(!Array.isArray(rows) || !rows.length) return empty;
    const cols = resolveHitosColumns(rows[0]);
    if(!cols) return empty;

    const celdas = [];
    const respSeen = {}, licSeen = {};

    for(const row of rows){
      const rawResp = cols.responsable ? String(row[cols.responsable] || '').trim() : '';
      const respKey = norm(rawResp);
      if(respKey && !respSeen[respKey]) respSeen[respKey] = hitosTitleCase(rawResp);

      const rawLic = cols.licencia ? String(row[cols.licencia] || '').trim() : '';
      const licKey = norm(rawLic);
      if(licKey && !licSeen[licKey]) licSeen[licKey] = rawLic;

      for(let i = 0; i < HITO_MAX; i++){
        const cumpleRaw = cols.cumple[i] ? norm(row[cols.cumple[i]]) : '';
        const fecha = cols.fecha[i] ? parseFechaCompleta(row[cols.fecha[i]]) : null;
        const real  = cols.real[i]  ? parseFechaCompleta(row[cols.real[i]])  : null;
        const esSi  = cumpleRaw === 'si';
        const esNo  = cumpleRaw === 'no';
        // La descripcion es lo que define que el hito EXISTA: un grupo con fechas pero
        // sin descripcion es una columna suelta del ancho fijo de 12, no un hito del
        // contrato (validado con el 488730: trae fechas en el grupo 4 — duplicadas del
        // grupo 1 — pero solo tiene 3 hitos reales).
        const desc = hitoDescripcion(cols.hito[i] ? row[cols.hito[i]] : '');
        if(!desc) continue;

        const dias = (fecha && real) ? Math.round((real - fecha) / DIA_MS) : null;
        const base = fecha || real;
        celdas.push({
          id         : cols.id ? String(row[cols.id] || '').trim() : '',
          cliente    : String(row[cols.cliente] || '').trim(),
          responsable: respSeen[respKey] || rawResp,
          respKey    : respKey,
          licencia   : licSeen[licKey] || rawLic,
          licKey     : licKey,
          contrato   : cols.contrato ? String(row[cols.contrato] || '').trim() : '',
          proyecto   : cols.proyecto ? String(row[cols.proyecto] || '').trim() : '',
          n          : i + 1,
          hito       : desc,
          fecha      : fecha ? fecha.toISOString().slice(0, 10) : '',
          fechaReal  : real  ? real.toISOString().slice(0, 10)  : '',
          cumple     : esSi,
          facturable : esSi || esNo,
          dias       : dias,
          mes        : base ? base.getUTCMonth() : null,
          anio       : base ? base.getUTCFullYear() : null
        });
      }
    }

    const responsables = Object.keys(respSeen)
      .map(function(k){ return { key: k, label: respSeen[k] }; })
      .sort(function(a, b){ return a.label.localeCompare(b.label, 'es'); });
    const licencias = Object.keys(licSeen)
      .map(function(k){ return { key: k, label: licSeen[k] }; })
      .sort(function(a, b){ return a.label.localeCompare(b.label, 'es'); });

    return { celdas: celdas, responsables: responsables, licencias: licencias };
  }

  /* Agrega las celdas ya filtradas.
     filtro: { meses:[ix]|null, cumple:'todos'|'si'|'no'|'sinevaluar', responsable, licencia, cliente }
     'sinevaluar' aisla los hitos con CumplimientoHito<N> vacio: no facturables todavia. */
  function summarizeHitos(celdas, filtro){
    filtro = filtro || {};
    const meses = Array.isArray(filtro.meses) ? filtro.meses : null;
    const cump  = filtro.cumple || 'todos';
    const resp  = filtro.responsable || 'todos';
    const lic   = filtro.licencia || 'todos';
    const cli   = norm(filtro.cliente || '');

    const zeros = function(){ return Array(12).fill(0); };
    const out = {
      habilitados: 0, noHabilitados: 0, facturables: 0, sinEvaluar: 0, pctCumplimiento: 0,
      aTiempo: 0, conAtraso: 0, diasAtrasoProm: 0, diasAtrasoMax: 0,
      porMesHabilitados: zeros(), porMesNo: zeros(), porMesSinEvaluar: zeros(),
      pctPorMes: Array(12).fill(null),
      porCliente: [], clientesSinFacturables: 0,
      filas: [], contratos: 0
    };

    let sumAtraso = 0;
    const contratosVistos = {};
    for(const c of (celdas || [])){
      if(meses && (c.mes == null || meses.indexOf(c.mes) === -1)) continue;
      if(cump === 'si' && !(c.facturable && c.cumple)) continue;
      if(cump === 'no' && !(c.facturable && !c.cumple)) continue;
      if(cump === 'sinevaluar' && c.facturable) continue;
      if(resp !== 'todos' && c.respKey !== resp) continue;
      if(lic  !== 'todos' && c.licKey  !== lic)  continue;
      if(cli && norm(c.cliente).indexOf(cli) === -1) continue;

      if(c.facturable){
        out.facturables++;
        if(c.cumple){ out.habilitados++;   if(c.mes != null) out.porMesHabilitados[c.mes]++; }
        else        { out.noHabilitados++; if(c.mes != null) out.porMesNo[c.mes]++; }
      } else {
        out.sinEvaluar++;
        if(c.mes != null) out.porMesSinEvaluar[c.mes]++;
      }

      if(c.dias != null){
        if(c.dias > 0){
          out.conAtraso++;
          sumAtraso += c.dias;
          if(c.dias > out.diasAtrasoMax) out.diasAtrasoMax = c.dias;
        } else {
          out.aTiempo++;
        }
      }
      if(c.id) contratosVistos[c.id] = true;
      out.filas.push(c);
    }

    /* Ranking por cliente: "cantidad de hitos" son los FACTURABLES (Si + No), la misma
       poblacion que el denominador del %, para que cantidad y porcentaje hablen de lo
       mismo. Orden: cantidad desc y, a igual cantidad, % de cumplimiento desc.
       Los clientes sin ningun hito facturable quedan afuera (barra de largo 0 no dice
       nada); se cuentan aparte en 'clientesSinFacturables'. */
    const acum = {};
    for(const c of out.filas){
      const k = c.cliente || '(sin cliente)';
      if(!acum[k]) acum[k] = { cliente: k, hitos: 0, cumplidos: 0, porCumplir: 0, sinEvaluar: 0, pct: 0 };
      if(!c.facturable) { acum[k].sinEvaluar++; continue; }
      acum[k].hitos++;
      if(c.cumple) acum[k].cumplidos++; else acum[k].porCumplir++;
    }
    const todos = Object.keys(acum).map(function(k){
      const a = acum[k];
      a.pct = a.hitos ? (a.cumplidos / a.hitos) * 100 : 0;
      return a;
    });
    out.clientesSinFacturables = todos.filter(function(a){ return a.hitos === 0; }).length;
    out.porCliente = todos.filter(function(a){ return a.hitos > 0; }).sort(function(a, b){
      if(b.hitos !== a.hitos) return b.hitos - a.hitos;
      if(b.pct   !== a.pct)   return b.pct - a.pct;
      return a.cliente.localeCompare(b.cliente, 'es');   // desempate estable
    });

    out.pctCumplimiento = out.facturables ? (out.habilitados / out.facturables) * 100 : 0;
    out.diasAtrasoProm  = out.conAtraso   ? sumAtraso / out.conAtraso : 0;
    out.contratos       = Object.keys(contratosVistos).length;
    for(let i = 0; i < 12; i++){
      const fact = out.porMesHabilitados[i] + out.porMesNo[i];
      out.pctPorMes[i] = fact ? (out.porMesHabilitados[i] / fact) * 100 : null;
    }

    /* Orden: agrupado por requerimiento y, dentro de cada uno, por numero de hito —
       asi se lee la secuencia real del contrato (hito 1, 2, 3...). Los requerimientos
       entre si se ordenan por su PEOR atraso, para que los problematicos sigan
       quedando arriba sin romper la secuencia interna. */
    const peorAtraso = {};
    out.filas.forEach(function(c){
      const d = c.dias == null ? -1e9 : c.dias;
      if(peorAtraso[c.id] == null || d > peorAtraso[c.id]) peorAtraso[c.id] = d;
    });
    out.filas.sort(function(a, b){
      if(a.id !== b.id){
        const pa = peorAtraso[a.id], pb = peorAtraso[b.id];
        if(pa !== pb) return pb - pa;
        return String(a.id).localeCompare(String(b.id));   // empate: orden estable por ID
      }
      return a.n - b.n;
    });
    return out;
  }

  // Dual-entorno: mismo archivo se usa en el navegador (window.CMI_MAPPER) y en
  // server.js vía require() (Node no tiene window/document) — así el cálculo de
  // buildTicketStats() para Soluciones vive en un único lugar en vez de duplicarse
  // client/server y desincronizarse con el tiempo.
  var _root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  var CMI_MAPPER = { norm, detectColumns, isAutoMapComplete, parseMonthIndex, buildKpiBundle, matchCanonical, findDateColumn, findAliasColumn, buildWideBundle, buildMetricBundle, buildTicketStats, resolveCuotasColumns, buildCuotasCells, summarizeCuotas, resolveHitosColumns, buildHitosCells, summarizeHitos };
  _root.CMI_MAPPER = CMI_MAPPER;
  if(typeof module !== 'undefined' && module.exports) module.exports = CMI_MAPPER;
})();
