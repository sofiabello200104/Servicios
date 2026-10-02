# SOFIA — Dashboard de Tickets

Dashboard de cuatro vistas ("Resumen", "Capacidad y Rendimiento", "Primer
Nivel de Atención" y "Segundo Nivel de Atención") sobre la entidad OData
`ID12086_Tickets_medidor`. Sin build step, sin dependencias de npm — Node
`http` plano en el servidor, Tailwind Play CDN + Chart.js 4.4.1 CDN (+
chartjs-plugin-datalabels, solo para Primer Nivel de Atención) en el
cliente.

## Cómo ejecutar

```bash
npm start
```

Por defecto escucha en el puerto `3000` (configurable con `PORT`) en todas las
interfaces de red. Si existen `certs/key.pem` y `certs/cert.pem` el servidor
usa HTTPS; si no, HTTP plano.

URLs disponibles:

- `https://localhost:3000` (esta máquina)
- `https://172.16.16.171:30|00` (equipos de la misma red)
- `https://190.145.254.194:3000` (IP pública, requiere port forwarding en el router)

El certificado incluido es autofirmado (SAN: `190.145.254.194`, `172.16.16.171`,
`127.0.0.1`, `localhost`), por lo que el navegador mostrará una advertencia la
primera vez; acepta la excepción para continuar.

## Cómo configurar OData

1. Abre el dashboard y haz clic en **Parametrización** (topbar).
2. Completa la URL base del servicio OData, usuario/contraseña opcionales y
   el nombre de la plantilla (por defecto `ID12086_Tickets_medidor`).
3. Usa **Probar conexión** para validar antes de guardar.
4. Haz clic en **Guardar** — esto persiste la configuración en
   `data/config.json` (excluido de git) y dispara automáticamente
   "Actualizar datos".

Solo se permiten hosts en la allowlist del servidor (`ALLOWED_ODATA_HOSTS` en
`server.js`, extensible con la variable de entorno `SOFIA_ODATA_HOSTS`).

## Cómo cargar datos de ejemplo

Sin configurar OData, el estado vacío del dashboard ofrece un botón
**Cargar datos de ejemplo**, que consume `GET /api/sample`
(`data/sample-tickets.json`, generado a partir de `Libro1.xlsx` — ver
`scripts/generate-sample.py`). Útil para verificar la interfaz sin
credenciales reales.

## Estructura del proyecto

```
server.js                    Servidor Node http plano (config, proxy OData, estáticos)
index.html                   Shell de la app (sidebar + topbar + vistas Resumen / Capacidad y Rendimiento / Primer Nivel de Atención / Segundo Nivel de Atención)
assets/css/app.css           Paleta, cards, KPIs, slide-over, tabla, responsive, switch de vistas
assets/js/mapper.js          Capa pura de datos (fechas, normalización, buildResumen, buildCapacidad, buildActivos, buildSegundoNivel) — dual Node/browser
assets/js/data-sources.js    Registro + fetch + normalización de las 4 fuentes OData extra de Capacidad (Tarea, Tarea con Revisión, Seguimiento Cliente, Capacitación) — dual Node/browser
assets/js/charts.js          Helpers de Chart.js (registry, kpiCard, doughnut, barChart, gauge, lineChart, data labels)
assets/js/render.js          Renderizado de las cuatro vistas (filtros, KPIs, charts, tablas)
assets/js/odata-client.js    Cliente fetch hacia /odata-proxy y /api/config/test
assets/js/store.js           Cache en localStorage con fallback en memoria
assets/js/parametrizacion.js Panel slide-over de configuración OData
assets/js/app.js             Boot: wiring de botones, cambio de vista, orquestación de carga de datos
test/mapper.test.js          Tests con node:test (node --test / npm test)
test-runner.html             Harness de tests en navegador (abrir directo, sin servidor)
scripts/generate-sample.py   Genera data/sample-tickets.json desde Libro1.xlsx
data/sample-tickets.json     Fixture de desarrollo (trackeado en git)
data/config.json             Config OData guardada (NO trackeado en git)
```

## Vista: Capacidad y Rendimiento

Segunda vista del dashboard (`data-view="capacidad"` en el sidebar), agregada
sobre `especificacion_ui_dashboard` en `data.json`. Toda la lógica de cálculo
vive en `assets/js/mapper.js` (`JORNADA`, `UMBRALES`, `parseHHMM`,
`parseTiempoLlamada`, `ticketHours`, `colombianHolidays`, `easterSunday`,
`countWorkingDays`, `periodCapacity`, `capacityStatus`, `buildCapacidad`,
`buildRecursoGauges`, `buildRecursoTickets`, `hasClienteColumn`) —
`render.js` solo formatea y dibuja.

### Fuentes de datos (unificación multi-fuente OData)

"Horas Reservadas" ya no viene solo de Tickets (`ID12086_Tickets_medidor`) —
se unifica con **cuatro** entidades OData adicionales, todas servidas por la
MISMA conexión OData ya configurada (URL base + credenciales en
`data/config.json`), para que Capacidad refleje todo el tiempo que un
consultor tiene agendado, no solo tickets de soporte:

| Fuente | Template OData | Campo recurso | Fecha inicial | Horas |
|---|---|---|---|---|
| Tickets | `ID12086_Tickets_medidor` | `Recurso_Soporte` | `Fecha_Soporte_Inicial` (bloque 1) | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Tarea | `ID12097_Plantilla_tarea` | `Recurso` | `Fecha_Inicial` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Tarea con revisión | `ID12096_Plantilla_tarea_con_rev` | `Funcionario_que_Resuelve` | `Fecha_Incio` (sic, typo real de la columna en el feed en vivo) | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Seguimiento cliente | `ID12098_Plantilla_seguimiento_c` | `Responsable_de_Seguimiento` | `Fecha_Inicial` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |
| Capacitación | `ID12095_Plantilla_capacitacion` | `_Colaborador_en_formacion` | `Fecha_Inicial` | `Hora_Cal_Inicial`/`Hora_Cal_Final` |

`assets/js/data-sources.js` (`window.SOFIA_DATA_SOURCES`) trae el registro
(`CAPACIDAD_EXTRA_SOURCES`), el fetch por fuente (`fetchExtraSource`, vía
`SOFIA_ODATA.buildTemplateUrl` + `/odata-proxy?url=...`, el mismo proxy
host-allowlisted y firmado server-side que Tickets ya usa — `server.js` no
cambió) y la normalización de cada fila (`normalizeExtraRow`: un solo bloque
de horas, misma fórmula que el bloque 1 de `ticketHours`:
`Hora_Cal_Final − Hora_Cal_Inicial` cuando ambos están presentes y el final
es mayor al inicio).

- **Cadencia de fetch**: las 4 fuentes extra se piden en paralelo con
  Tickets, una sola vez por clic en "Actualizar Datos" — **no** se repiten
  en cada cambio de Desde/Hasta (esos siguen siendo un filtro puro del lado
  del cliente sobre los datos ya cargados, igual que el resto de la app).
  Cada fetch usa `$select` para pedir solo las ~4 columnas necesarias; no se
  aplica `$filter` por fecha en el servidor (eso rompería el filtrado
  instantáneo por rango de fechas que ya tiene el resto de la app).
- **Equipo (`porRecurso`)**: la regla "el equipo es cada recurso distinto en
  todo el dataset" se extiende a la unión de las 5 fuentes — un consultor
  con horas solo de Capacitación y cero tickets igual aparece en
  `porRecurso` con sus horas, no queda invisible.
- **Filtros Cliente/Proyecto**: las 4 fuentes extra no tienen columnas
  Cliente/Proyecto — sus horas quedan estructuralmente exentas de esos dos
  filtros (no es una elección, el dato no existe), pero sí respetan el
  filtro de Recursos y el período Desde/Hasta, igual que los tickets.
- **Alineación de nombres de recurso**: los valores de recurso de las 4
  fuentes extra pasan por el mismo `normalizeRecurso()` (Title Case) que
  Tickets, y luego `buildCapacidad`/`buildRecursoTickets` (`mapper.js`)
  fusionan variantes de acento/mayúsculas a través de las 5 fuentes juntas
  (`buildExtraSourcesResolver`), para que "Juan Perez" (Tarea) y "Juan
  Pérez" (Tickets) sumen en un solo consultor en vez de aparecer como dos
  filas distintas.
- **Degradación**: si OData no está configurado, o si una fuente extra falla
  o hace timeout, la vista Capacidad NO se rompe entera — esa fuente
  simplemente no aporta filas y se muestra un aviso pequeño, no bloqueante y
  descartable en la vista (nunca un sub-reporte silencioso sin ningún
  indicio). En modo "Cargar datos de ejemplo" las 4 fuentes extra siempre
  están vacías — no existe fixture local para ellas y no se inventó ninguno.
- **Drill-down**: el modal "Detalle por Recurso" (`buildRecursoTickets`)
  agrega una columna **Fuente** para que cada fila muestre si esa hora vino
  de un Ticket, Tarea, Tarea con Revisión, Seguimiento Cliente o
  Capacitación; las filas de fuentes extra no tienen Cliente/Proyecto/Hora
  Inicial-Final/Tiempo Real/Prioridad (esas columnas no existen en esas 4
  entidades) y se muestran como "—".

### Filtros

- **Desde / Hasta** (rango de fechas del período principal).
- **Recursos** — multi-select propio (checkboxes + toggle "Todos", sin
  librería) en vez de un `<select multiple>` nativo. `buildCapacidad` recibe
  `filters.recursos: string[]`; un array vacío o `['all']` significa "sin
  filtro" (`isAllSelector()` en `mapper.js`).
- **Cliente** (single-select) → **Proyecto** (single-select, dependiente): al
  elegir un cliente, Proyecto solo lista los proyectos de ese cliente
  (derivado de los tickets); cambiar Cliente resetea Proyecto a "Todos". Si
  la plantilla OData no trae la columna `Cliente` (caso actual del feed en
  vivo), el select de Cliente se deshabilita mostrando la opción "Sin
  columna Cliente en la plantilla" + un texto de ayuda, y Proyecto sigue
  listando todos los proyectos sin restricción — ver `hasClienteColumn()`.
- **Nota (spec v3)**: el filtro "Temporalidad" (Diario/Semanal/Mensual/Anual)
  de spec v1/v2 se eliminó junto con la gráfica "Tendencia de horas" que era
  su único consumidor — ver "Cambios de layout (spec v3)" más abajo.

### Tacómetros individuales: filtros LOCALES (spec v3)

El tacómetro (`fila_tacometros` en `modificaciones_layout`) tiene su **propio**
selector de recurso ("Seleccionar recurso") + su propio rango de fechas
Desde/Hasta ("filtros locales"), **totalmente independientes** de los
filtros principales de arriba (Recursos/Cliente/Proyecto/Desde/Hasta) — ni
los filtros principales afectan al tacómetro, ni el tacómetro afecta al
resto de la vista. Por defecto el rango local arranca en el mismo "mes a la
fecha" que el período principal, pero cada uno se mueve por separado a
partir de ahí. Debajo del selector se muestra un texto de ayuda: "Período
local: DD/MM/YYYY – DD/MM/YYYY · N días hábiles" (`countWorkingDays` sobre
ese mismo rango, festivos colombianos incluidos).

### Columna Cliente (degradación elegante)

El feed OData en vivo (verificado vía `/odata-proxy`) **no tiene** columna
`Cliente` hoy — solo 19 columnas, sin `Cliente`. `normalizeTickets` la
detecta igual que cualquier otra columna (alias `Cliente`, `Cliente_Nombre`,
`Nombre_Cliente`, `Client`): si no aparece en la primera fila, todo ticket
recibe `cliente: null` (no `'Sin dato'` — esa etiqueta es para "columna
presente pero vacía"); si aparece, un valor vacío se normaliza a `'Sin
cliente'`. `hasClienteColumn(tickets)` expone esa detección a la UI.

### Fórmulas

- **Horas por ticket**: `(Hora_Cal_Final − Hora_Cal_Inicial) + (Hora_Cal_Final_3 − Hora_Cal_Inicial_3)`,
  cada bloque solo cuando ambos extremos están presentes y el final es mayor
  al inicio. El bloque 1 se fecha con `Fecha_Soporte_Inicial`; el bloque 3
  con `Fecha_Entrega_Inicial` (si falta, `Fecha_Soporte_Inicial`, si falta,
  `Fecha`).
- **Capacidad neta agendable por jornada** (`configuracion_jornada` en
  `data.json`, copiada una sola vez en la constante `JORNADA`): Lunes–Jueves
  7.6667 h, Viernes 7.0 h, Sábado/Domingo 0 h, **y festivos colombianos 0 h**
  (spec v3 — ver "Calendario laboral colombiano" abajo).
- **Capacidad del período** (`periodCapacity`, por recurso) = `(#días Lun–Jue hábiles × 7.6667) + (#Viernes hábiles × 7.0)`,
  donde "hábil" excluye fines de semana y festivos colombianos. La capacidad
  total del equipo es esa cifra multiplicada por el número de recursos del
  equipo (todo el equipo, o solo los recursos filtrados).
- **% Utilización** = `Horas Reservadas / Capacidad Instalada × 100`.
- **Horas Disponibles** = `Capacidad − Reservadas` (puede ser negativo en el
  KPI). En el gráfico apilado se usa `max(0, Disponibles)` y una serie
  separada **Horas Saturadas** = `max(0, Reservadas − Capacidad)`.
- **Semáforo** (`capacityStatus`, umbrales copiados de `umbrales_semaforo`):
  `<70%` Alta Disponibilidad (`#3B82F6`) · `70–85%` Óptimo (`#10B981`) ·
  `85.01–100%` Límite (`#F59E0B`) · `>100%` Saturado (`#EF4444`). Las
  badges de la tabla y el KPI usan las clases Tailwind de
  `tabla_detalle.regla_badges` (`bg-blue-100 text-blue-800`, etc.) — ver
  `UMBRALES[i].badgeClass` en `mapper.js`.
- **Tacómetros individuales** (`buildRecursoGauges(tickets, {recurso, from,
  to})`, un recurso a la vez — `filters.recurso`/`from`/`to` vienen SIEMPRE
  de los filtros locales del tacómetro, nunca de los filtros principales):
  - **Horas Programadas por Recurso** = `Horas_Ticket_del_recurso /
    Capacidad_Instalada_del_recurso × 100`, segmentos 70/85/100/150
    (mismos colores del semáforo).
  - **Tiempo Real de Soporte vs Programado** = `SUM(Tiempo_de_llamada en
    horas) / SUM(Horas_Ticket) × 100` para ese recurso en el período,
    segmentos 80 "Cierre Rápido" / 105 "En Tiempo" / 150 "Excedido".
    `Tiempo_de_llamada` es texto libre en el feed: casi siempre minutos en
    string (`'60'`, `'120'`), a veces `'N Hora(s)'` o `'N min'`, y un puñado
    de filas con texto no numérico (nombres de área, ej. `'TALENTO
    HUMANO'`) que `parseTiempoLlamada` descarta como `null`. Cuando el
    recurso no tiene ningún `Tiempo_de_llamada` parseable en el período, el
    gauge se muestra vacío (arco gris) con la leyenda "Sin datos de tiempo
    real" en vez de un 0% engañoso.
  - `charts.js` dibuja ambos con `segmentedGauge(id, value, segments,
    opts)`: dos datasets de Chart.js concéntricos — un anillo exterior fino
    con las bandas del espectro completo (0..max) al 25% de opacidad, y un
    anillo interior más grueso con el arco 0..valor sólido, en el color de
    la banda donde cae el valor.

### Calendario laboral colombiano (Ley Emiliani, spec v3)

`colombianHolidays(year)` (`mapper.js`) calcula los festivos colombianos con
un algoritmo puro — sin API ni dependencia externa — cacheado por año
(`Map` interno). Tres tipos de festivo:

- **Fijos** (nunca se mueven): 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
- **Ley Emiliani** (se trasladan al lunes siguiente si no caen ya en lunes):
  6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov —
  `moveToMonday(date)` = `(8 - día_de_semana) % 7` días de más (0 si ya es
  lunes).
- **Basados en Pascua** (`easterSunday(year)`, algoritmo Gregoriano Anónimo /
  Meeus): Jueves Santo = Pascua−3, Viernes Santo = Pascua−2, Ascensión =
  Pascua+43, Corpus Christi = Pascua+64, Sagrado Corazón = Pascua+71 — estos
  tres últimos offsets ya son los trasladados a lunes (no el offset litúrgico
  +39/+60/+68), verificado contra los 18 festivos esperados de 2026.

`countWorkingDays(from, to)` excluye sábado, domingo **y** cualquier fecha en
`colombianHolidays(año-de-esa-fecha)` — `periodCapacity()` (y por lo tanto
`buildCapacidad`/`buildRecursoGauges`/el texto de ayuda del período local del
tacómetro) hereda esto automáticamente, sin tocar ningún otro punto de
cómputo. No hay calendario de festivos de otros países.

### Drill-down "Detalle por Recurso" (Power BI style, spec v4: modal)

Cada fila de recurso termina en una columna **"ID"** con un botón
**"Analizar"** (`tipo: boton_analizar_tickets`) — ÚNICO mecanismo de
drill-down (spec v3 probó primero un acordeón inline por click-en-la-fila;
spec v4 lo reemplazó por este botón + modal explícitos, sin fila-click, sin
Enter/Espacio en la fila, sin chevron). Al hacer click se abre un **modal
centrado** (`#drilldown-modal` + `#drilldown-backdrop` en `index.html` — un
único par de elementos en todo el documento, re-llenado en cada apertura)
con los tickets que sustentan la `Reservadas_h` de ese recurso, calculados
por `buildRecursoTickets(tickets, filters, recurso)` con los MISMOS filtros
principales (período/Cliente/Proyecto) que la tabla — nunca los filtros
locales del tacómetro. Reglas:

- Título del modal: "Tickets asociados a {recurso}". Subtítulo: período
  principal + cantidad de tickets + total, p. ej. "01/09/2026 – 13/09/2026 ·
  5 tickets · Total 45.0 h".
- Solo cuentan tickets con ≥1 bloque de horas fechado dentro del período;
  `Horas Consumidas` = la suma de los bloques de ESE ticket que cayeron en el
  período (bloque 1 + bloque 3), exactamente lo que alimenta `Reservadas_h`
  — por eso el test `buildRecursoTickets returns per-ticket rows whose total
  equals the parent porRecurso reservadas` compara ambos valores directo.
- Columnas: ID, Fecha (la fecha del bloque que contó, no `Fecha` del
  ticket), Cliente (`—` mientras la columna esté ausente), Proyecto,
  Producto, Hora Inicial/Final (siempre las del bloque 1), Horas Consumidas,
  Tiempo Llamada Real, Prioridad ANS. Cuando el bloque 3 también aportó
  horas al período se agrega una pista muted debajo de las horas: "+ bloque
  3: HH:MM–HH:MM". Fila de total en el `<tfoot>`: "Total: X h" —
  `buildRecursoTickets` garantiza que `X === reservadas` de la fila padre.
  Orden: por Fecha (la del bloque) ascendente.
- Modal centrado, `max-width: min(1100px, 95vw)`, `max-height: 85vh` con
  scroll interno en el cuerpo; `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` apuntando al título. Cierra con el botón X, con Escape
  (listener global que solo actúa si el modal está visible), o con click en
  el backdrop. El foco se mueve al botón de cerrar al abrir y vuelve al
  botón "Analizar" que lo abrió al cerrar (`_drilldownOpenerBtn` en
  `render.js`). Mismo peso visual (radio 14px, sombra fuerte) que el
  slide-over `#param-panel` de Parametrización, pero simétrico en vez de
  direccional por ser un diálogo centrado en vez de un panel lateral.

### Deviación documentada: capacidad semanal de referencia

`data.json` imprime `capacidad_semanal_neta_horas: 37.6667` como referencia,
pero `4 × 7.6667 + 1 × 7.0 = 37.6668` (0.0001 h de diferencia). Es un
artefacto de redondeo del propio `data.json`: esa cifra se calculó sobre el
valor sin redondear (23/3 = 7.6666...) y no sobre el 7.6667 ya redondeado a 4
decimales. `periodCapacity()` deriva de `JORNADA` (los valores de 4
decimales, que es lo que pide la consigna), así que una semana completa
reporta 37.6668 h, no 37.6667 h — ver el test
`periodCapacity derives from the JORNADA constant` en `test/mapper.test.js`.

### Supuestos

1. **Definición de equipo**: el equipo es cada `Recurso_Soporte` normalizado
   distinto que aparece en **todo el dataset** (excluyendo el bucket "Sin
   dato"), no solo los que tienen tickets dentro del período seleccionado —
   así un recurso sin tickets en el período igual aparece como disponible en
   vez de desaparecer. El filtro "Recursos" reduce ese equipo a los recursos
   seleccionados.
2. **Proyecto vacío**: se etiqueta `Sin proyecto` en esta vista (distinto
   del `Sin dato` genérico que usa la vista Resumen para el mismo campo
   `Proyecto` — evita tener que duplicar la normalización solo por la
   etiqueta). **Cliente vacío** (cuando la columna sí existe) se etiqueta
   `Sin cliente` — un `cliente` en `null` significa en cambio que la columna
   no existe en el dataset, ver `hasClienteColumn()`.
3. **Cliente/Proyecto no reducen el equipo**: solo filtran `Horas
   Agendadas` y todo lo derivado de eso (disponibles, % uso, `porProyecto`)
   — la Capacidad Instalada y el equipo del tacómetro reaccionan únicamente
   al filtro Recursos.

### Cambios de layout (spec v3)

Sobre `modificaciones_layout.eliminar_componentes` en `data.json`:

- Se eliminó por completo la gráfica **"Tendencia de horas"** — markup
  (`index.html`), renderizado (`renderCapCharts` en `render.js`) y el campo
  `tendencia` que devolvía `buildCapacidad` (junto con sus tests). Como el
  filtro **Temporalidad** (Diario/Semanal/Mensual/Anual) no tenía ningún otro
  consumidor, también se eliminó — de `index.html`, de `readCapFilters()`, y
  de `buildCapacidad` (ya no calcula ni devuelve `temporalidad`). Con eso,
  `bucketFnFor`/`bucketStepFor`/`buildBucketSequence`/`mondayOf` quedaron sin
  ningún otro llamador y también se eliminaron de `mapper.js` (el helper
  `lineChart` de `charts.js` se dejó intacto — sigue siendo inofensivo aunque
  hoy nada lo use).
- Se eliminó la columna **"Rol"** de "Detalle por Recurso" — `mapper.js` ya
  no agrega `rol: 'Soporte'` a las filas de `porRecurso`, y la tabla
  (`CAP_TABLE_COLUMNS` en `render.js`) pasó de 7 a 6 columnas.

## Vista: Primer Nivel de Atención

Tercera vista del dashboard (`data-view="activos"` en el sidebar y en
`VIEW_META` — el id/identificadores internos siguen siendo `activos`/`act*`
en todo el código, solo cambió el texto visible; ver "Cambio de nombre"
más abajo), sidebar y título de topbar ambos "Primer Nivel de Atención"
(hasta la versión anterior de esta vista el topbar decía "Centro de Control
de Tickets Activos" y el sidebar "Tickets Activos" — el usuario pidió
renombrarla para que combine con "Segundo Nivel de Atención"). Toda la
lógica de cálculo vive en `buildActivos(tickets, filters)`
(`assets/js/mapper.js`) — `render.js` solo formatea y dibuja, igual que en
Capacidad y Rendimiento.

### Universo (reglas de negocio confirmadas con el usuario)

Un ticket es "activo" cuando se cumplen **ambas** condiciones:

- **`Estado == 1`** (numérico o string numérico, p. ej. `"1"`) — `2` significa
  inactivo; cualquier otro valor simplemente se excluye del universo.
  `normalizeTickets` expone esto como `ticket.estado` (número o `null`,
  aliases `Estado` / `Activo` / `Estado_Ticket`, ver `parseEstado()`).
- **`Accion` (insensible a mayúsculas y con trim) != `CREAR`** — la
  comparación usa `accionNorm`, que `normalizeTickets` ya calcula en mayúsculas
  y sin espacios (el dataset trae variantes como `"Crear"`).

### Buckets (sobre el universo activo)

- **Servicios**: `Accion` en `REALIZAR`, `AGENDA ENTREGA FINAL`,
  `ENTREGA FINAL`, `CIERRE`.
- **Calidad**: `Accion` en `REVISION EN PLANTA`, `REVISION CALIDAD`,
  `REVISION DEV`, `REVISION SOLUCION`, `ACTUALIZA VERSION` (también se acepta
  `ACTUALIZAR VERSION` como alias del mismo bucket/color).
- Cualquier otra `Accion` activa cuenta para `kpis.total` pero no entra en
  ningún bucket (no se descarta el ticket, solo no aporta a Servicios/Calidad).

Sobre el fixture `data/sample-tickets.json` estos números dan
`total=103`, `servicios=88`, `calidad=15` — ver el test de integración
correspondiente en `test/mapper.test.js`.

### Recurso_Accion (no Recurso_Soporte)

Todo gráfico de esta vista usa **`Recurso_Accion`** como dimensión de
recurso — no `Recurso_Soporte` ni `Recurso_Entrega_Final` — expuesto como
`ticket.recursoAccion` (alias `Recurso_Accion` / `RecursoAccion` /
`Recurso_Acción`). A diferencia de `recursoSoporte`, este campo **no** aplica
Title Case ni fusión de variantes con/sin tilde: la regla de negocio solo
pide "vacío → `Sin recurso`", así que se mantiene el valor crudo (trimeado)
del feed.

### Columna Requerimiento_Opcion (degradación elegante, oculta por completo)

`Requerimiento_Opcion` (aliases `Requerimiento_Opcion` / `Requerimiento` /
`Opcion` / `Opciones`) **no existe todavía** en el feed en vivo ni en el
fixture de ejemplo. `normalizeTickets` la detecta con el mismo patrón que
`Cliente` en Capacidad: si la columna no aparece en la primera fila, todo
ticket recibe `requerimientoOpcion: null` (no `'Sin dato'`); si aparece, un
valor vacío se normaliza a `'Sin requerimiento'`. `buildActivos` expone esa
detección como `hasRequerimiento` — cuando es `false`, el filtro
"Requerimientos / Opciones" (multiselect buscable) se **oculta por completo**
en la UI en vez de mostrarse deshabilitado, y `requerimientoOptions` viene
vacío.

### Filtros (todos opcionales, se aplican sobre el universo activo)

- **Recurso** (`Recurso_Accion`): multi-select con buscador de texto libre
  (checkboxes + toggle "Todos", sin librería) — mismo patrón que "Recursos"
  en Segundo Nivel de Atención y Capacidad y Rendimiento (no un
  `<select multiple>` nativo), ubicado antes que los filtros de fecha.
  Narrows `filtered` (kpis, ambos gráficos de barras, la tabla y el panel de
  resumen de abajo, todos a la vez, porque todos derivan de `filtered`) — a
  diferencia de "Requerimientos / Opciones", nunca se oculta (`Recurso_Accion`
  siempre existe). Semántica `isAllSelector`: array vacío o `['all']` = sin
  filtro. Las opciones reflejan todo el universo activo, sin achicarse a
  medida que se filtra (mismo patrón que `requerimientoOptions`).
- **Fecha Soporte Inicial** (desde/hasta) sobre `Fecha_Soporte_Inicial`.
- **Fecha Entrega Inicial** (desde/hasta) sobre `Fecha_Entrega_Inicial`. Ambas
  fechas se exponen sin la cadena de fallback que usa Capacidad para fechar
  horas (`ticket.fechaSoporteInicial` / `ticket.fechaEntregaInicial` guardan
  el valor de columna tal cual, `null` si la fecha no parsea).
- **Requerimientos / Opciones**: multiselect con buscador de texto libre
  (mismo patrón sin librería que el multiselect de Recursos en Capacidad, con
  un `<input>` de búsqueda agregado) — oculto cuando `hasRequerimiento` es
  `false`. Semántica `isAllSelector`: array vacío o `['all']` = sin filtro.

### KPIs y gráficos

- KPIs (`COUNT DISTINCT` sobre `ID`, vía `Set` por bucket): **Tickets
  Abiertos** (total, `#1E293B`), **Abiertos Servicios** (`#2563EB`),
  **Abiertos Calidad** (`#7C3AED`).
- **Tickets Abiertos por Recurso (Servicios)**: barra horizontal, solo bucket
  Servicios agrupado por `recursoAccion`, orden desc, data labels,
  `#0284C7`.
- **Recuento de Tickets por Cliente**: barra horizontal, universo completo
  agrupado por `cliente`, orden desc, nombre completo del cliente en el eje Y,
  valor al final de cada barra, rampa de azules (oscuro = mayor conteo, ver
  `rankedBlue()` en `render.js`). La altura del contenedor crece con el número
  de clientes (`CLIENTE_ROW_PX` por fila, mínimo 340px). Si
  `hasCliente` es `false` (columna Cliente ausente, ver `hasClienteColumn()`
  en Capacidad) se muestra el mismo overlay "sin datos" (`chartEmptyState`)
  que usa Capacidad para sus propios gráficos vacíos.
- **Tickets Abiertos por Acción (General)**: barra horizontal, universo
  completo agrupado por `accionNorm`, orden desc, color por barra
  (`colorMapping` fijo por acción, fallback `#94A3B8` para cualquier acción
  activa fuera de ambos buckets). **Click en una barra** selecciona/
  deselecciona esa acción (mismo toggle que el gráfico de Recurso) y narrows
  la tabla de abajo — como cada color de barra ya es fijo por acción (no un
  único color como en el gráfico de Recurso), el "seleccionado" se marca
  atenuando (alpha `55` en hex) todas las demás barras en vez de resaltar
  una. Independiente del recurso seleccionado en el otro gráfico — ambas
  selecciones narrows la misma tabla con AND (ver "Tabla + panel de resumen"
  más abajo).
- **Distribución de Tickets por Producto**: doughnut, universo completo
  agrupado por `producto`, cutout 60%, porcentaje en tooltip/leyenda, leyenda
  a la derecha (única vista donde `doughnut()` no usa la leyenda inferior por
  defecto — ver `opts.legendPosition` en `charts.js`).

### Tabla + panel de resumen (spec "Primer Nivel de Atención")

- **Tabla** ("Requerimientos de Primer Nivel"): columnas ID, Recurso,
  Cliente, Producto, Accion, Asunto — mismo patrón de columnas y degradación
  "—" (`Cliente`/`Asunto` ausentes o vacíos) que la tabla de Segundo Nivel.
  Filas = `buildActivos(...).rows` (universo ya filtrado por
  Recurso/fechas/Requerimientos), narrowed además por **dos selecciones de
  gráfico independientes, combinadas con AND**: el recurso seleccionado en
  "Tickets Abiertos por Recurso (Servicios)" y la acción seleccionada en
  "Tickets Abiertos por Acción (General)" — elegir ambas muestra solo esa
  combinación puntual. Esa narrowing pasa en `render.js`, no en
  `buildActivos` (el filtro real de Recurso es `filters.recursos`; los
  clicks en las barras son narrowing secundaria, solo-render, exclusiva de
  la tabla) — como la tabla ya trae columna Recurso por fila, filtrar por
  acción alcanza para ver "el detalle de los recursos" detrás de esa acción
  sin necesitar un widget de agregación aparte. **Paginada**: 10 filas por
  página, etiqueta "Mostrando X–Y de N", botones Anterior/Siguiente —
  primera tabla paginada de la app; el paginado es una implementación local
  chica (una sola variable de página + slice + Prev/Next), no un componente
  genérico, porque ninguna otra tabla lo necesita todavía.
- **Panel de resumen** ("Detalle del recurso seleccionado", junto a la
  tabla): visible solo cuando hay un recurso seleccionado (click en una
  barra de "Tickets Abiertos por Recurso (Servicios)") — no reacciona a la
  selección de Acción, sus tres métricas son específicas de un recurso.
  Muestra el nombre del recurso, **Total Tickets en Realizar**
  (`accionNorm === 'REALIZAR'` entre las filas de ese recurso), **Total
  Tickets en Entrega Final** (`accionNorm === 'ENTREGA FINAL'`) y **Total
  Asignados (Servicios)**, leído directo de `recursosServicios` (el mismo
  número que ya muestra la barra de ese recurso, nunca recalculado aparte).
  Sin selección, muestra un texto guía. A diferencia del panel de insight de
  Segundo Nivel, no tiene frase narrativa ni "producto/diagnóstico más
  frecuente" — solo estos tres conteos, tal como lo especificó el usuario.
- **Click en las barras** ("Tickets Abiertos por Recurso (Servicios)" y
  "Tickets Abiertos por Acción (General)"): cada gráfico selecciona/
  deselecciona de forma independiente (mismo toggle que Segundo Nivel —
  click en la misma barra deselecciona) y resetea la tabla a la página 1.
  Ninguno de los dos clicks afecta a los gráficos en sí, solo a la tabla (y,
  el de Recurso, también al panel de abajo).

### Data labels (nueva dependencia CDN, solo para esta vista)

Los tres gráficos de barras de esta vista muestran el valor sobre cada barra,
para lo cual se agregó `chartjs-plugin-datalabels` vía CDN
(`index.html`) — se registra globalmente en `charts.js` pero queda
**apagado por defecto** (`Chart.defaults.set('plugins.datalabels', {display:
false})`) y solo se enciende por gráfico vía `barChart(..., {dataLabels:
true})`, así que Resumen y Capacidad siguen renderizando exactamente igual
que antes. `barChart()` también agrega un 10% de "grace" al eje numérico
cuando `dataLabels` está activo, para que la etiqueta de la barra más larga
no quede recortada contra el borde del gráfico.

## Vista: Segundo Nivel de Atención

Cuarta vista del dashboard (`data-view="segundo-nivel"` en el sidebar).
Toda la lógica de cálculo vive en `buildSegundoNivel(tickets, filters)`
(`assets/js/mapper.js`) — `render.js` solo formatea y dibuja, igual que en
las demás vistas.

### Universo (regla de negocio confirmada con el usuario)

Un ticket entra al universo de Segundo Nivel cuando se cumplen **ambas**
condiciones:

- **`Estado == 1`** — la misma puerta de "activo" que usa Primer Nivel de
  Atención (`mapper.js`, `t.estado === 1`), sin inventar una convención nueva.
- **`Accion` (vía `accionNorm`) en** `REVISION CALIDAD`, `REVISION DEV`,
  `REVISION SOLUCION`, `ACTUALIZA VERSION` (también se acepta
  `ACTUALIZAR VERSION` como alias del mismo valor). Es exactamente
  `ACTIVOS_CALIDAD_ACCIONES` **menos** `REVISION EN PLANTA`, que el usuario
  no incluyó en este catálogo.

Sobre el fixture `data/sample-tickets.json` el universo da `total=15` — ver
el test de integración correspondiente en `test/mapper.test.js`.

### Recurso_Accion (no Recurso_Soporte)

Todo gráfico de esta vista agrupa por **`Recurso_Accion`** (`recursoAccion`),
igual que Primer Nivel de Atención — nunca `Recurso_Soporte`.

### Filtros

- **Recurso** (`Recurso_Accion`): multi-select propio (checkboxes + toggle
  "Todos", sin librería) — mismo patrón que "Recursos" en Capacidad y
  Rendimiento (no un `<select multiple>` nativo). Las opciones reflejan todo
  el universo activo, sin achicarse a medida que se filtra (mismo patrón que
  `requerimientoOptions` en Primer Nivel de Atención). Semántica `isAllSelector`:
  array vacío o `['all']` = sin filtro.
- **Accion**: single-select, opciones restringidas al catálogo de segundo
  nivel — la opción "ACTUALIZAR VERSION" del dropdown agrupa ambas grafías
  del feed (`ACTUALIZA VERSION` / `ACTUALIZAR VERSION`), igual que el color
  compartido que `ACTIVOS_ACCION_COLORS` ya les asigna en Primer Nivel de Atención.
  "Todas" (por defecto) nunca se sale del universo de 5 valores porque el
  universo ya está confinado a ellos.

### KPI y gráficos

- **KPI**: "Total Requerimientos" — total del universo con los filtros
  Recurso/Accion aplicados.
- **Requerimientos por Recurso**: barra horizontal (mismo look
  "ranked list" que `chart_recursos_servicios` de Primer Nivel de Atención), con
  **click en una barra** para seleccionar/deseleccionar ese recurso (se
  resalta en un azul más oscuro). El click **no** afecta este gráfico ni los
  otros tres — solo filtra la tabla y el panel de insight de abajo (ver
  "División en dos etapas" más abajo). `barChart()` (`charts.js`) ganó un
  parámetro opcional `opts.onClick`, apagado por defecto, así que ningún
  otro gráfico de la app cambia.
- **Requerimientos por Cliente (Top 10)**: gráfico de columnas (vertical),
  universo filtrado agrupado por `cliente`, top 10. Si `hasCliente` es
  `false` (columna Cliente ausente, ver `hasClienteColumn()`) se muestra el
  mismo overlay "sin datos" (`chartEmptyState`) que usa Primer Nivel de Atención para
  su propio gráfico de Cliente.
- **Distribución por Diagnóstico**: doughnut, universo filtrado agrupado por
  `diagnostico`. **`Diagnostico` no existe todavía** ni en el feed OData en
  vivo ni en `data/sample-tickets.json` (verificado contra las 21 columnas
  reales del fixture) — degradación elegante idéntica a `hasClienteColumn`:
  `normalizeTickets` expone `hasDiagnostico`, y cuando es `false` el gráfico
  se oculta detrás del mismo overlay `chartEmptyState` en vez de dibujar un
  donut vacío y engañoso.
- **Distribución por Producto**: doughnut, universo filtrado agrupado por
  `producto` (columna siempre presente, sin degradación).

### Tabla + panel de insight

- **Tabla** ("Requerimientos de Segundo Nivel"): columnas ID, Recurso,
  Cliente, Producto, Accion, Asunto. **`Asunto` tampoco existe** en el feed
  ni en el fixture (mismo patrón de columna ausente que `Cliente`): la celda
  muestra "—" en vez de la columna completa oculta, igual que ya hace la
  columna Cliente del modal de drill-down de Capacidad
  (`r.cliente == null ? '—' : ...`) — un valor `null` por fila, no una
  etiqueta "Sin dato" engañosa.
- **Panel de insight** (junto a la tabla): visible solo cuando hay un
  recurso seleccionado (click en una barra) — muestra el total de
  requerimientos de ese recurso, su producto/diagnóstico/acción más
  frecuente y una frase narrativa. Sin selección, muestra un texto guía.

### División en dos etapas (`buildSegundoNivel`)

`buildSegundoNivel(tickets, filters)` filtra en dos pasos:

1. `universe` (Estado + Accion) → `filters.recursos` + `filters.accion` →
   `filtered`, que alimenta el KPI y los cuatro gráficos.
2. `filtered` → `filters.selectedResource` (el recurso clickeado en el
   gráfico de barras) → alimenta únicamente `rows` (la tabla) e `insight`
   (el panel lateral). Un recurso seleccionado que deja de aparecer en
   `filtered` tras cambiar Recurso/Accion se descarta automáticamente en
   `render.js` para no mostrar una selección obsoleta.

## Tests

```bash
npm test
```

Ejecuta `test/mapper.test.js` con el test runner integrado de Node
(`node:test` + `node:assert`), sin dependencias externas. También se puede
abrir `test-runner.html` directamente en el navegador para la misma
cobertura sobre `mapper.js` en ese entorno.
