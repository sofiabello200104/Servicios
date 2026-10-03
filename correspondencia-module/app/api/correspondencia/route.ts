import { NextResponse } from 'next/server';
import type { ApiResponse, CorrespondenciaRow } from '@/types/correspondencia';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';


export async function GET(): Promise<NextResponse> {
  const base = process.env.ODATA_BASE_URL;
  const token = process.env.ODATA_AUTH_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta.' }, { status: 500 });
  }

  const rows: CorrespondenciaRow[] = [];
  let url: string | null = `${base.replace(/\/$/, '')}/ID12019_Correo`;
  let pages = 0;

  try {
    // Sigue @odata.nextLink (máx. 50 páginas como salvaguarda).
    while (url && pages < 50) {
      const res: Response = await fetch(url, {
        headers: { Authorization: token.startsWith('Basic ') || token.startsWith('Bearer ') ? token : `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        return NextResponse.json({ error: `Error del origen de datos (${res.status}).` }, { status: 502 });
      }
      const json = (await res.json()) as { value?: CorrespondenciaRow[]; 'odata.nextLink'?: string; '@odata.nextLink'?: string };
      rows.push(...(json.value ?? []));
      url = json['@odata.nextLink'] ?? json['odata.nextLink'] ?? null;
      pages += 1;
    }
  } catch {
    return NextResponse.json({ error: 'No fue posible conectar con el origen de datos.' }, { status: 502 });
  }

  const body: ApiResponse = { rows, fetchedAt: new Date().toISOString() };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
