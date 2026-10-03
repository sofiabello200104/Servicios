export interface CorrespondenciaRow {
  ID: number | string;
  Accion: string | null;
  Recurso_Accion: string | null;
  Cliente: string | null;
  FechaRadicacion?: string | null;
  Fecha?: string | null;
}

export interface CorrespondenciaItem {
  id: string;
  accion: string;
  recurso: string;
  cliente: string;
  fecha: string | null; // ISO yyyy-mm-dd
}

export interface ApiResponse {
  rows: CorrespondenciaRow[];
  fetchedAt: string;
}

export interface CountEntry {
  name: string;
  value: number;
}

export interface Kpis {
  total: number;
  topAccion: { name: string; value: number; pct: number } | null;
  topRemitente: { name: string; value: number } | null;
}

export interface Filters {
  from: string; // yyyy-mm-dd or ''
  to: string;
  cliente: string; // '' = todos
  recurso: string;
}

export type SortKey = 'id' | 'accion' | 'recurso' | 'cliente' | 'fecha';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}
