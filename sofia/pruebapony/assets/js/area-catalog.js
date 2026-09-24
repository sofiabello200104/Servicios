(function(){
  window.CMI_AREA_CATALOG = {
    comercial: {
      label: 'Dirección Comercial',
      valueScale: 1e-6,  // valores en COP → almacenar en millones
      targets: [
        { id: 'nuevos',       label: 'Ingresos nuevos',        aliases: ['vr_nueva','nueva','new','ingreso_nuevo'] },
        { id: 'cruzada',      label: 'Venta cruzada',          aliases: ['vr_cruzada','cruzada','cross'] },
        { id: 'renovaciones', label: 'Renovaciones',           aliases: ['vr_renovacion','renovacion','renewal'] },
        { id: 'greenywave',   label: 'Greenywave',             aliases: ['valor_total_comercial','valor_total','greenywave'],
          filter: { col: 'GreenyWave', val: 'si' } },
        { id: 'pipeline',     label: 'Cobertura de pipeline',  aliases: ['pipeline','cobertura'] }
      ]
    },
    financiera: {
      label: 'Gestión Adm. y Financiera',
      valueScale: 1,
      targets: [
        { id: 'ebitda',      label: 'Margen EBITDA',               aliases: ['ebitda'] },
        { id: 'utilOp',      label: 'Margen utilidad operacional', aliases: ['utilop','util_op','utilidad_operacional','util_operacional'] },
        { id: 'utilBruta',   label: 'Margen utilidad bruta',       aliases: ['utilbruta','util_bruta','utilidad_bruta'] },
        { id: 'facturacion', label: 'Facturación',                 aliases: ['facturacion','factura','billing'] },
        { id: 'recaudo',     label: 'Recaudo',                     aliases: ['recaudo','recaudado','collected'] },
        { id: 'personal',    label: 'Personal competente',         aliases: ['personal','staff','empleado','competente'] }
      ]
    },
    proyectos: {
      label: 'Proyectos',
      valueScale: 1,
      targets: [
        { id: 'ejecucion', label: 'Plan de ejecución',        aliases: ['ejecucion','execution','plan_ejec','plan_ejecucion'] },
        { id: 'horas',     label: 'Consumo horas',            aliases: ['horas','hours','consumo_horas','horas_desarrollo'] },
        { id: 'avance',    label: 'Avance económico',         aliases: ['avance','advance','avance_economico'] },
        { id: 'habilit',   label: 'Habilitación facturación', aliases: ['habilit','habilitacion','billing_enable','habilitacion_facturacion'] }
      ]
    },
    soluciones: {
      label: 'Soluciones',
      valueScale: 1,
      targets: [
        // Tabla de hechos de tickets (ID12046_73_Tablero_Indicadores_MCI): una fila
        // = un ticket, sin columna de "KPI" ni una única columna de valor — no
        // calza con el detector tidy/ancho genérico (ver mapper.js#buildKpiBundle/
        // buildWideBundle). A diferencia de 'single'/'grouped' en IDS (que sí se
        // procesan en parametrizacion.js), esta forma ya no se agrega en el
        // navegador: el resumen se calcula server-side (server.js#handleSolucionesKpisGet,
        // ver filtros.js#runActualizarDatos) porque la plantilla pesa ~7,5MB/miles
        // de filas. Este target solo queda para que el panel de Parametrización
        // siga permitiendo elegir la(s) plantilla(s) de esta área.
        { id: 'tickets', label: 'Tickets', metricShape: 'tickets',
          estadoAliases:      ['estado','status'],
          accionAliases:      ['accion','action'],
          clienteAliases:     ['cliente','client'],
          productoAliases:    ['producto','product'],
          recursoAliases:     ['recurso_accion','recurso','resource'],
          diagnosticoAliases: ['diagnostico','diagnosis'],
          fechaAliases:       ['fecha_soporte_inicial','fecha_soporte','fechasoporte'] }
      ]
    },
    ids: {
      label: 'IDS',
      valueScale: 1,
      targets: [
        // Indicador #1 (ID11947_PBIndicadoresIDS): fila = evento único, sin columna de
        // nombre de KPI ni de producto — META y PORCENTAJE propios por fila. No calza
        // con el formato tidy/ancho genérico (ver mapper.js#buildMetricBundle).
        { id: 'confiabilidad',  label: 'Confiabilidad',  aliases: ['confiabilidad','reliability','conf'],
          metricShape: 'single',
          // La fila trae FECHAINI y FECHAFINAL — el detector genérico de fecha
          // matchea cualquiera de las dos por contener "fecha", así que acá se
          // fija explícitamente cuál es la que corresponde (ver populateIds()).
          dateAliases:  ['fechafinal','fecha_final'],
          valueAliases: ['porcentaje','pct','cumplimiento'],
          metaAliases:  ['meta','objetivo','target','goal'] },
        // Indicador #2/#3 (ID11948_PBIndicadorNiveldeServicio): misma forma que 'single'
        // más una columna de producto (NOMPRODUCTO) — se agrega el promedio global
        // (ansGlobal) y el detalle por producto (groupDataKey → CMI_DATA.IDS.ansPorProducto).
        // Los nombres de producto se detectan dinámicamente, no se hardcodean acá.
        { id: 'ansGlobal', label: 'Cumplimiento ANS', aliases: ['ans','cumplimiento_ans','nivel_ans'],
          metricShape: 'grouped',
          dateAliases:  ['fecha'],
          valueAliases: ['porcentaje','pct','cumplimiento'],
          metaAliases:  ['meta','objetivo','target','goal'],
          groupAliases: ['nomproducto','producto','product','nombreproducto'],
          groupDataKey: 'ansPorProducto' }
      ]
    }
  };
  window.CMI_AREA_IDS = Object.keys(window.CMI_AREA_CATALOG);
})();
