import type {
  CorrespondenciaItem, CorrespondenciaRow, CountEntry, Filters, Kpis, SortState,
} from '@/types/correspondencia';

export const SIN_CLIENTE = 'Sin cliente registrado';
export const SIN_ACCION = 'Sin acción';
export const SIN_RECURSO = 'Sin responsable';

const clean = (v: string | null | undefined, fallback: string): string => {
  const t = (v ?? '').trim();
  return t === '' ? fallback : t;
};

export function normalizeRows(rows: CorrespondenciaRow[]): CorrespondenciaItem[] {
  return rows.map((r) => {
    const raw = r.FechaRadicacion ?? r.Fecha ?? null;
    const d = raw ? new Date(raw) : null;
    return {
      id: String(r.ID),
      accion: clean(r.Accion, SIN_ACCION),
      recurso: clean(r.Recurso_Accion, SIN_RECURSO),
      cliente: clean(r.Cliente, SIN_CLIENTE),
      fecha: d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null,
    };
  });
}

export const hasDates = (items: CorrespondenciaItem[]): boolean => items.some((i) => i.fecha);

export function applyFilters(items: CorrespondenciaItem[], f: Filters): CorrespondenciaItem[] {
  return items.filter((i) => {
    if (f.cliente && i.cliente !== f.cliente) return false;
    if (f.recurso && i.recurso !== f.recurso) return false;
    if (f.from && (!i.fecha || i.fecha < f.from)) return false;
    if (f.to && (!i.fecha || i.fecha > f.to)) return false;
    return true;
  });
}

export function countBy(items: CorrespondenciaItem[], pick: (i: CorrespondenciaItem) => string): CountEntry[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(pick(i), (m.get(pick(i)) ?? 0) + 1);
  return Array.from(m, ([name, value]) => ({ name, value })).sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name),
  );
}

export function computeKpis(items: CorrespondenciaItem[]): Kpis {
  const total = items.length;
  const acciones = countBy(items, (i) => i.accion);
  const remitentes = countBy(items.filter((i) => i.cliente !== SIN_CLIENTE), (i) => i.cliente);
  return {
    total,
    topAccion: acciones[0]
      ? { ...acciones[0], pct: total ? (acciones[0].value / total) * 100 : 0 }
      : null,
    topRemitente: remitentes[0] ?? null,
  };
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function searchItems(items: CorrespondenciaItem[], q: string): CorrespondenciaItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  return items.filter((i) =>
    [i.id, i.accion, i.recurso, i.cliente, i.fecha ?? ''].some((v) => v.toLowerCase().includes(t)),
  );
}

export function sortItems(items: CorrespondenciaItem[], s: SortState): CorrespondenciaItem[] {
  const mul = s.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (s.key === 'id') {
      const na = Number(a.id), nb = Number(b.id);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * mul;
    }
    return (a[s.key] ?? '').toString().localeCompare((b[s.key] ?? '').toString()) * mul;
  });
}
