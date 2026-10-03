"""Extrae del INDICADORES.pbix las tablas que SOFIA usa y las deja como JSON crudo
(mismos nombres de columna que el OData). Uso: python3 scripts/pbix_to_json.py > /tmp/pbix.json
Requiere: pip install pbixray. Luego: node scripts/build-pbix-fallback.js /tmp/pbix.json"""
import json, sys, datetime
from pbixray import PBIXRay
import pandas as pd

m = PBIXRay('INDICADORES.pbix')

def hhmm(v):
    if pd.isna(v): return None
    t = pd.Timestamp(v).round('min')
    return t.strftime('%H:%M')

def iso(v):
    return None if pd.isna(v) else pd.Timestamp(v).round('s').strftime('%Y-%m-%dT%H:%M:%S')

def table(name):
    df = m.get_table(name)
    rows = []
    for rec in df.to_dict('records'):
        out = {}
        for k, v in rec.items():
            if k.startswith('Hora_Cal'): out[k] = hhmm(v)
            elif isinstance(v, (pd.Timestamp, datetime.datetime)): out[k] = iso(v)
            elif pd.isna(v) if not isinstance(v, (list, dict)) else False: out[k] = None
            else: out[k] = v.item() if hasattr(v, 'item') else v
        rows.append(out)
    return rows

json.dump({
  'tickets': table('ID12086_Tickets_medidor'),
  'ID12097_Plantilla_tarea': table('ID12097_Plantilla_tarea'),
  'ID12098_Plantilla_seguimiento_cliente': table('ID12098_Plantilla_seguimiento_cliente'),
  'ID12095_Plantilla_capacitacion': table('ID12095_Plantilla_capacitacion'),
}, sys.stdout, ensure_ascii=False)
