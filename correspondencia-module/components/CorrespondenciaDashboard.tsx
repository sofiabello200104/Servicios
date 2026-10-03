'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCorrespondenciaData } from '@/hooks/useCorrespondenciaData';
import { searchItems, sortItems } from '@/lib/correspondencia-utils';
import type { CountEntry, SortKey, SortState } from '@/types/correspondencia';

const PAGE_SIZE = 10;
const fmt = new Intl.NumberFormat('es-CO');

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 truncate text-2xl font-semibold text-slate-900" title={value}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

function HBar({ title, data, color, action }: { title: string; data: CountEntry[]; color: string; action?: React.ReactNode }) {
  const height = Math.max(160, data.length * 34 + 30);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-slate-900">{title}</h3>
        {action}
      </div>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin datos para mostrar.</p>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 36 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} interval={0} />
              <Tooltip />
              <Bar dataKey="value" name="Correspondencias" fill={color} radius={[0, 4, 4, 0]}>
                <LabelList dataKey="value" position="right" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

const COLS: { key: SortKey; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'accion', label: 'Acción' },
  { key: 'recurso', label: 'Responsable' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'fecha', label: 'Fecha' },
];

export default function CorrespondenciaDashboard() {
  const d = useCorrespondenciaData();
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: 'id', dir: 'desc' });

  const rows = useMemo(() => sortItems(searchItems(d.filtered, q), sort), [d.filtered, q, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const slice = rows.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const clientes = showAll ? d.porCliente : d.porCliente.slice(0, 10);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const input = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const set = (patch: Partial<typeof d.filters>) => { d.setFilters({ ...d.filters, ...patch }); setPage(1); };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Correspondencia Recibida</h1>
          {d.fetchedAt && <p className="text-xs text-slate-500">Actualizado: {new Date(d.fetchedAt).toLocaleString('es-CO')}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {d.dateEnabled && (
            <>
              <label className="text-xs text-slate-500">Desde
                <input type="date" className={`${input} mt-1 block`} value={d.filters.from} onChange={(e) => set({ from: e.target.value })} />
              </label>
              <label className="text-xs text-slate-500">Hasta
                <input type="date" className={`${input} mt-1 block`} value={d.filters.to} onChange={(e) => set({ to: e.target.value })} />
              </label>
            </>
          )}
          <label className="text-xs text-slate-500">Cliente
            <select className={`${input} mt-1 block max-w-[14rem]`} value={d.filters.cliente} onChange={(e) => set({ cliente: e.target.value })}>
              <option value="">Todos</option>
              {d.clientes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Responsable
            <select className={`${input} mt-1 block max-w-[14rem]`} value={d.filters.recurso} onChange={(e) => set({ recurso: e.target.value })}>
              <option value="">Todos</option>
              {d.recursos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button onClick={() => void d.refresh()} disabled={d.loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {d.loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {d.error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {d.error} <button className="ml-2 underline" onClick={() => void d.refresh()}>Reintentar</button>
        </div>
      )}
      {!d.loading && !d.error && d.filtered.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No hay correspondencia para los filtros seleccionados.
        </div>
      )}

      {d.loading && d.items.length === 0 ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi title="Total Correspondencia" value={fmt.format(d.kpis.total)} />
            <Kpi title="Top Acción" value={d.kpis.topAccion?.name ?? '—'}
              sub={d.kpis.topAccion ? `${fmt.format(d.kpis.topAccion.value)} · ${d.kpis.topAccion.pct.toFixed(1)}%` : undefined} />
            <Kpi title="Top Remitente" value={d.kpis.topRemitente?.name ?? '—'}
              sub={d.kpis.topRemitente ? `${fmt.format(d.kpis.topRemitente.value)} correspondencias` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <HBar title="Distribución por Acción" data={d.porAccion} color="#0099FF" />
            <HBar title="Correspondencia por Responsable" data={d.porRecurso} color="#002299" />
          </div>
          <HBar title={showAll ? 'Clientes (todos)' : 'Top 10 Clientes'} data={clientes} color="#0099FF"
            action={d.porCliente.length > 10 && (
              <button className="text-sm text-blue-600 hover:underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Ver top 10' : `Ver todos (${d.porCliente.length})`}
              </button>
            )} />

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium text-slate-900">Detalle ({fmt.format(rows.length)})</h3>
              <input className={`${input} w-64`} placeholder="Buscar…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    {COLS.filter((c) => c.key !== 'fecha' || d.dateEnabled).map((c) => (
                      <th key={c.key} className="cursor-pointer select-none px-3 py-2 font-medium" onClick={() => toggleSort(c.key)}>
                        {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">{r.id}</td>
                      <td className="px-3 py-2">{r.accion}</td>
                      <td className="px-3 py-2">{r.recurso}</td>
                      <td className="px-3 py-2">{r.cliente}</td>
                      {d.dateEnabled && <td className="px-3 py-2">{r.fecha ?? '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>Página {cur} de {pages}</span>
              <div className="space-x-2">
                <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Anterior</button>
                <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Siguiente</button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
