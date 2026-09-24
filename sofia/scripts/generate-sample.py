#!/usr/bin/env python3
"""Generate data/sample-tickets.json from Libro1.xlsx.

Dev fixture generator: reads the ID12086_Tickets_medidor sheet and writes a
JSON array of plain objects (same column names as keys) so the dashboard UI
can be exercised without real OData credentials. Not part of the served
application logic - re-run any time Libro1.xlsx changes.

Usage: python scripts/generate-sample.py
"""
import datetime
import json
import os

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_XLSX = os.path.join(ROOT, "Libro1.xlsx")
OUTPUT_JSON = os.path.join(ROOT, "data", "sample-tickets.json")


def convert_cell(value):
    """Convert one openpyxl cell value to a JSON-safe value.

    - datetime.datetime -> ISO string "YYYY-MM-DDTHH:MM:SS"
    - datetime.date (no time component) -> ISO string at midnight
    - datetime.time -> "HH:MM"
    - empty/blank string or None -> None (JSON null)
    - everything else (numbers, non-blank strings) -> unchanged
    """
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(value, datetime.date):
        return value.strftime("%Y-%m-%dT00:00:00")
    if isinstance(value, datetime.time):
        return value.strftime("%H:%M")
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped != "" else None
    return value


def main():
    wb = openpyxl.load_workbook(SOURCE_XLSX, read_only=True, data_only=True)
    sheet_name = wb.sheetnames[0]
    ws = wb[sheet_name]

    rows_iter = ws.iter_rows(values_only=True)
    header = [str(h).strip() for h in next(rows_iter)]

    records = []
    for row in rows_iter:
        if row is None or all(v is None for v in row):
            continue
        record = {}
        for key, raw_value in zip(header, row):
            record[key] = convert_cell(raw_value)
        records.append(record)

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    print("Sheet: {}".format(sheet_name))
    print("Rows written: {}".format(len(records)))
    print("Output: {}".format(OUTPUT_JSON))


if __name__ == "__main__":
    main()
