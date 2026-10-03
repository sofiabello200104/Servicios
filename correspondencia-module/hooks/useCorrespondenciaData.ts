'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiResponse, CorrespondenciaItem, CountEntry, Filters, Kpis } from '@/types/correspondencia';
import {
  applyFilters, computeKpis, countBy, hasDates, normalizeRows, uniqueSorted,
} from '@/lib/correspondencia-utils';

const EMPTY: Filters = { from: '', to: '', cliente: '', recurso: '' };

export interface CorrespondenciaData {
  loading: boolean;
  error: string | null;
  items: CorrespondenciaItem[];
  filtered: CorrespondenciaItem[];
  kpis: Kpis;
  porAccion: CountEntry[];
  porRecurso: CountEntry[];
  porCliente: CountEntry[];
  clientes: string[];
  recursos: string[];
  dateEnabled: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  refresh: () => Promise<void>;
  fetchedAt: string | null;
}

export function useCorrespondenciaData(): CorrespondenciaData {
  const [items, setItems] = useState<CorrespondenciaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/correspondencia', { cache: 'no-store' });
      const json = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar los datos.');
      setItems(normalizeRows(json.rows));
      setFetchedAt(json.fetchedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => applyFilters(items, filters), [items, filters]);
  const kpis = useMemo(() => computeKpis(filtered), [filtered]);
  const porAccion = useMemo(() => countBy(filtered, (i) => i.accion), [filtered]);
  const porRecurso = useMemo(() => countBy(filtered, (i) => i.recurso), [filtered]);
  const porCliente = useMemo(() => countBy(filtered, (i) => i.cliente), [filtered]);
  const clientes = useMemo(() => uniqueSorted(items.map((i) => i.cliente)), [items]);
  const recursos = useMemo(() => uniqueSorted(items.map((i) => i.recurso)), [items]);
  const dateEnabled = useMemo(() => hasDates(items), [items]);

  return {
    loading, error, items, filtered, kpis, porAccion, porRecurso, porCliente,
    clientes, recursos, dateEnabled, filters, setFilters, refresh, fetchedAt,
  };
}
