(function () {
  'use strict';

  // Chart rendering helpers, adapted from the reference project's
  // legacy-render.js (makeChart registry, kpiCard, renderSpark, semaphore,
  // doughnut/barChart/gauge). Trimmed down to what the single Resumen view
  // needs — no multi-area nav, no analisis buttons, no vendor-specific
  // formatting helpers.

  const COLORS = { brand: '#0EA5E9', brandDeep: '#0369A1', ok: '#10B981', warn: '#F59E0B', bad: '#EF4444', violet: '#8B5CF6', pink: '#EC4899', ink: '#0F172A', mute: '#94A3B8', line: '#E2E8F0' };

  // Reference project's own categorical palette for products — single
  // source of truth lives in mapper.js (PRODUCTO_COLORS/PRODUCTO_COLOR_OTROS)
  // so the doughnut coloring and the aggregation that assigns top-8-vs-OTROS
  // never drift apart; re-exported here for convenience.
  const PRODUCTO_COLORS = window.SOFIA_MAPPER.PRODUCTO_COLORS;
  const PRODUCTO_COLOR_OTROS = window.SOFIA_MAPPER.PRODUCTO_COLOR_OTROS;

  function semaphore(value, meta, opMode) {
    opMode = opMode || 'gte';
    if (value == null || meta == null) return 'mute';
    if (opMode === 'gte') {
      if (value >= meta) return 'ok';
      if (value >= meta * 0.92) return 'warn';
      return 'bad';
    }
    if (value <= meta) return 'ok';
    if (value <= meta * 1.05) return 'warn';
    return 'bad';
  }
  const chipFor = (s) => s === 'ok' ? 'chip-ok' : s === 'warn' ? 'chip-warn' : s === 'bad' ? 'chip-bad' : 'chip-mute';
  const labelFor = (s) => s === 'ok' ? 'En meta' : s === 'warn' ? 'En riesgo' : s === 'bad' ? 'No cumple' : 'Sin meta';

  /* ============================ Chart registry ============================
     Destroys/recreates chart instances by canvas id so re-rendering (filter
     changes, "Actualizar datos") never leaks Chart.js instances or throws
     "Canvas is already in use". */
  const _charts = new Map();
  function makeChart(id, cfg) {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    const prev = (typeof Chart.getChart === 'function') ? Chart.getChart(ctx) : null;
    if (prev) { try { prev.destroy(); } catch (e) { /* ignore */ } }
    else if (_charts.has(id)) { try { _charts.get(id).destroy(); } catch (e) { /* ignore */ } }
    const c = new Chart(ctx, cfg);
    _charts.set(id, c);
    return c;
  }

  /* ============================ KPI cards ============================ */
  let _sparkSeq = 0;
  const _pendingSparks = [];

  function kpiCard(opts) {
    const title = opts.title, value = opts.value, meta = opts.meta;
    const status = opts.status, spark = opts.spark, sparkColor = opts.sparkColor || COLORS.brand;
    const variation = opts.variation, unit = opts.unit || '';
    const id = 'spk-' + (++_sparkSeq);
    const hasData = opts.hasData !== false;
    const hasVariation = hasData && variation != null;
    const arrow = variation > 0 ? '▲' : variation < 0 ? '▼' : '—';
    const varColor = variation > 0 ? 'text-emerald-600' : variation < 0 ? 'text-rose-600' : 'text-slate-500';
    const noChip = opts.noChip === true;
    const metaPrefix = opts.metaPrefix != null ? opts.metaPrefix : '';
    _pendingSparks.push({ id, spark, sparkColor, hasData });
    const stripeClass = noChip ? '' : status === 'ok' ? ' kpi-ok' : status === 'warn' ? ' kpi-warn' : status === 'bad' ? ' kpi-bad' : '';
    return '<div class="card p-4' + stripeClass + '">' +
      '<div class="flex items-start justify-between">' +
      '<div class="text-[12px] font-semibold text-slate-700 leading-tight pr-2">' + title + '</div>' +
      (noChip ? '' : '<span class="chip ' + chipFor(status) + '">' + labelFor(status) + '</span>') +
      '</div>' +
      '<div class="mt-3 flex items-baseline gap-2">' +
      '<div class="text-2xl font-extrabold text-slate-900 kpi-num">' + value + '<span class="text-base text-slate-400 font-bold">' + unit + '</span></div>' +
      (hasVariation ? '<div class="text-[11px] ' + varColor + ' font-semibold">' + arrow + ' ' + Math.abs(Number(variation) || 0).toFixed(1) + '%</div>' : '') +
      '</div>' +
      (meta != null ? '<div class="text-[11px] text-slate-500 mt-1">' + metaPrefix + '<span class="font-semibold text-slate-700">' + meta + '</span></div>' : '') +
      '<div class="spark-wrap mt-2"><canvas id="' + id + '"></canvas></div>' +
      '</div>';
  }

  function flushSparks() {
    while (_pendingSparks.length) {
      const s = _pendingSparks.shift();
      renderSpark(s.id, s.spark, s.sparkColor, s.hasData);
    }
  }

  function renderSpark(id, data, color, hasData) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const safe = Array.isArray(data) ? data.map((v) => Number.isFinite(v) ? v : null) : [];
    const noData = !hasData || safe.every((v) => !v);
    makeChart(id, {
      type: 'line',
      data: {
        labels: safe.map((_, i) => i),
        datasets: [{
          data: noData ? safe.map(() => 0) : safe,
          borderColor: noData ? '#CBD5E1' : color,
          backgroundColor: noData ? 'rgba(203,213,225,.15)' : color + '22',
          fill: true, tension: .35, pointRadius: 0, borderWidth: 2, spanGaps: true
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  }

  /* ============================ Chart helpers ============================ */
  Chart.defaults.font.family = "'Inter',sans-serif";
  Chart.defaults.color = '#475569';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  // chartjs-plugin-datalabels (Tickets Activos only) -- registered globally
  // but defaulted OFF, so it stays opt-in per chart via barChart()'s
  // dataLabels option instead of drawing on every existing Resumen/Capacidad
  // chart. Guarded: the app still works if the CDN script fails to load.
  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    Chart.defaults.set('plugins.datalabels', { display: false });
  }
  // Recessive gridlines per dataviz guidance: light, desaturated, never
  // competing with the data ink.
  const gridLight = { grid: { color: 'rgba(226,232,240,0.55)' }, border: { display: false }, ticks: { color: '#94A3B8' } };
  const tooltipBase = { backgroundColor: '#0F172A', padding: 10, titleFont: { size: 12 }, bodyFont: { size: 11 } };

  // opts.dataLabels: true, or a chartjs-plugin-datalabels config object to
  // merge over the default (value shown just past the bar's end). Only
  // Tickets Activos passes this today (see mapper.js buildActivos) --
  // Resumen/Capacidad bars omit it and render exactly as before.
  function dataLabelsOpts(opts) {
    if (!opts || !opts.dataLabels) return { display: false };
    const custom = opts.dataLabels === true ? {} : opts.dataLabels;
    return Object.assign({
      display: true,
      color: '#334155',
      font: { size: 10, weight: '600' },
      anchor: 'end',
      align: 'end',
      offset: 4,
      clamp: true
    }, custom);
  }

  function barChart(id, datasets, opts) {
    opts = opts || {};
    const legendLabels = { usePointStyle: true, boxWidth: 8, padding: 16 };
    // With data labels on, the longest bar's label needs headroom past the
    // bar's end or it clips against the chart edge -- add 10% grace to the
    // numeric (value) axis only, and only as a default the caller's own
    // xOpts/yOpts can still override (see Object.assign order below).
    const valueAxisGrace = opts.dataLabels ? { grace: '10%' } : {};
    const xGrace = opts.horizontal ? valueAxisGrace : {};
    const yGrace = opts.horizontal ? {} : valueAxisGrace;
    return makeChart(id, {
      type: 'bar',
      data: { labels: opts.labels || [], datasets: datasets },
      options: {
        indexAxis: opts.horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        layout: opts.layout || {},
        // opts.onClick(event, elements, chart): opt-in bar-click passthrough
        // (Segundo Nivel de Atención's Recurso_Accion chart) -- omitted by
        // every other bar chart in the app, which renders exactly as before.
        onClick: opts.onClick || undefined,
        plugins: {
          // Legend always present for 2+ series (dataviz rule).
          legend: { display: opts.legend !== false && datasets.length > 1, position: 'bottom', labels: legendLabels },
          tooltip: Object.assign({}, tooltipBase, opts.tooltipOpts || {}),
          datalabels: dataLabelsOpts(opts)
        },
        scales: {
          x: Object.assign({}, gridLight, { stacked: !!opts.stacked }, xGrace, opts.xOpts || {}),
          y: Object.assign({}, gridLight, { stacked: !!opts.stacked }, yGrace, opts.yOpts || {})
        }
      }
    });
  }

  // showPercent: adds value + percent-of-total to each legend entry's label
  // (top-8-plus-OTROS doughnut requirement from the dataviz guidance).
  function doughnut(id, labels, data, colors, opts) {
    opts = opts || {};
    const total = data.reduce((s, v) => s + (Number(v) || 0), 0);
    const legendLabels = { usePointStyle: true, boxWidth: 8, padding: 14, font: { size: 10 } };
    if (opts.showPercent) {
      legendLabels.generateLabels = function (chart) {
        // The generic default emits one entry per dataset; doughnut needs the
        // controller override, which emits one entry per slice.
        const base = Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart);
        return base.map((item, i) => {
          const v = data[i] || 0;
          const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
          item.text = labels[i] + ': ' + v + ' (' + pct + '%)';
          return item;
        });
      };
    }
    return makeChart(id, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: opts.cutout || '65%',
        plugins: {
          // legendPosition: only Tickets Activos' chart_tickets_producto asks
          // for a right-side legend today -- every other doughnut keeps the
          // existing bottom placement by omitting the option.
          legend: { display: opts.legend !== false, position: opts.legendPosition || 'bottom', labels: legendLabels },
          tooltip: Object.assign({}, tooltipBase, {
            callbacks: {
              label: function (ctx) {
                const v = ctx.parsed || 0;
                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                return ctx.label + ': ' + v + ' (' + pct + '%)';
              }
            }
          }, opts.tooltipOpts || {})
        }
      }
    });
  }

  // lineChart(id, datasets, opts): each dataset may set `fill: true` for an
  // area fill, or `dashed: true` (shorthand for borderDash:[6,4]) for a
  // reference line such as "Capacidad máxima". opts.labels are the x-axis
  // categories (bucket labels from buildCapacidad's tendencia.labels).
  function lineChart(id, datasets, opts) {
    opts = opts || {};
    const legendLabels = { usePointStyle: true, boxWidth: 8, padding: 16 };
    const prepared = datasets.map((ds) => {
      const out = Object.assign({ tension: 0.3, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2 }, ds);
      if (ds.dashed) out.borderDash = ds.borderDash || [6, 4];
      if (out.fill) out.backgroundColor = out.backgroundColor || (out.borderColor + '22');
      else out.fill = false;
      return out;
    });
    return makeChart(id, {
      type: 'line',
      data: { labels: opts.labels || [], datasets: prepared },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: opts.legend !== false && prepared.length > 1, position: 'bottom', labels: legendLabels },
          tooltip: Object.assign({}, tooltipBase, opts.tooltipOpts || {})
        },
        scales: {
          x: Object.assign({}, gridLight, opts.xOpts || {}),
          y: Object.assign({}, gridLight, opts.yOpts || {})
        }
      }
    });
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // segmentedGauge(id, value, segments, opts): a two-ring "tacómetro" —
  // segments = [{limite, color}, ...] in ascending `limite` order (max =
  // last segment's limite).
  //   - Outer ring (one dataset): the full 0..max range split into each
  //     segment's own span, painted in that segment's color at ~25% opacity
  //     — the static band map.
  //   - Inner ring (a second dataset, same circumference/rotation so both
  //     start/end at the same angle): the 0..value arc, painted solid in
  //     the color of whichever band the (clamped) value falls into.
  // opts.hasData: false renders an empty gray inner arc (e.g. "no Tiempo_de_
  // llamada logged for this resource/period" — a real 0% would be misleading).
  function segmentedGauge(id, value, segments, opts) {
    opts = opts || {};
    const max = segments[segments.length - 1].limite;
    const v = Number(value);
    const hasData = opts.hasData !== false && Number.isFinite(v);
    const clamped = hasData ? Math.max(0, Math.min(v, max)) : 0;

    let prevLimit = 0;
    const bgData = [];
    const bgColors = [];
    segments.forEach((seg) => {
      bgData.push(seg.limite - prevLimit);
      bgColors.push(hexToRgba(seg.color, 0.25));
      prevLimit = seg.limite;
    });

    const band = hasData ? (segments.find((seg) => v <= seg.limite) || segments[segments.length - 1]) : null;
    const valueColor = band ? band.color : '#CBD5E1';

    return makeChart(id, {
      type: 'doughnut',
      data: {
        datasets: [
          {
            data: bgData, backgroundColor: bgColors, borderWidth: 0,
            circumference: 270, rotation: 225, radius: '92%', cutout: '80%'
          },
          {
            data: [clamped, max - clamped], backgroundColor: [valueColor, 'transparent'], borderWidth: 0,
            circumference: 270, rotation: 225, radius: '76%', cutout: '52%'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  }

  function gauge(id, value, color) {
    const v = Number(value) || 0;
    return makeChart(id, {
      type: 'doughnut',
      data: { datasets: [{ data: [v, 100 - v], backgroundColor: [color, '#E2E8F0'], borderWidth: 0, circumference: 270, rotation: 225 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '78%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: () => v.toFixed(1) + '%' } }
        }
      }
    });
  }

  // Toggles a centered "no data" message over a chart container so an empty
  // dataset never renders as a bare 0..1 axis. The canvas stays in place
  // (and its Chart instance registered) for the next non-empty render.
  function chartEmptyState(canvasId, isEmpty, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.parentElement) return;
    const box = canvas.parentElement;
    let overlay = box.querySelector('.chart-empty');
    if (isEmpty) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'chart-empty';
        box.appendChild(overlay);
      }
      overlay.textContent = message || 'Sin datos para el período y filtros seleccionados';
    }
    if (overlay) overlay.hidden = !isEmpty;
    canvas.style.visibility = isEmpty ? 'hidden' : '';
  }

  window.SOFIA_CHARTS = {
    COLORS, PRODUCTO_COLORS, PRODUCTO_COLOR_OTROS,
    semaphore, makeChart, kpiCard, flushSparks, renderSpark,
    barChart, doughnut, gauge, lineChart, segmentedGauge, chartEmptyState
  };
})();
