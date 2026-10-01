#!/usr/bin/env python3
"""build_ingresos.py — fuentes/ingresos_tributarios_caba_2026_2027.csv → ingresos.json

Fuente independiente de la sección de gastos: no lee ni escribe nada de
build_data.py y sólo *consulta* presupuesto.json (si existe) para verificar que
los deflactores sean los mismos que usa el tablero de gastos.

Columnas que usa la página:
  recurso_id       identificador estable (clave de cada recurso)
  recurso          nombre visible
  anio             2026 (Vigente al 30/06/2026) o 2027 (Proyecto de Ley)
  monto_nominal    modo nominal
  monto_real_2027  modo real (pesos a precios de 2027)

Uso: python3 build_ingresos.py   (Python 3.9+, sin dependencias)
Termina con error si alguna validación falla; en ese caso no escribe ingresos.json.
"""
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "fuentes" / "ingresos_tributarios_caba_2026_2027.csv"
OUT = ROOT / "ingresos.json"
GASTOS_JSON = ROOT / "presupuesto.json"

YEARS = (2026, 2027)
PRICE_BASE = 2027
# Deflactores del tablero (los mismos que usa la sección de gastos).
IPC = {2026: 2501.96, 2027: 3020.12}
FACTOR = {2026: IPC[2027] / IPC[2026], 2027: 1.0}
FACTOR_2026_ESPERADO = 1.2071016323  # especificación, 10 decimales

BASES = {
    2026: {"etiqueta": "Vigente al 30/06/2026", "etapa_csv": "Vigente al 30/06", "periodo_csv": "30/06/2026"},
    2027: {"etiqueta": "Proyecto de Ley", "etapa_csv": "Proyecto de Ley", "periodo_csv": "2027"},
}
ADVERTENCIA = ("La comparación enfrenta recursos vigentes al 30/06/2026 con los recursos "
               "proyectados para 2027. No son montos de recaudación efectivamente percibida.")

# Controles fijos pedidos para publicar.
CONTROLES_FIJOS = {
    ("IIBB", 2026): 10_938_684_600_000,
    ("IIBB", 2027): 13_279_892_300_000,
}
IIBB_VAR_REAL_APROX = 0.6  # %, con tolerancia de ±0,05 pp


class BuildError(Exception):
    pass


def parse_int(s, ctx):
    s = (s or "").strip()
    if not s:
        raise BuildError(f"{ctx}: monto vacío.")
    try:
        v = float(s)
    except ValueError:
        raise BuildError(f"{ctx}: monto no numérico: {s!r}.")
    if not math.isfinite(v) or v != round(v):
        raise BuildError(f"{ctx}: se esperaba un monto entero en pesos: {s!r}.")
    return int(round(v))


def parse_float(s, ctx):
    try:
        return float((s or "").strip())
    except ValueError:
        raise BuildError(f"{ctx}: valor no numérico: {s!r}.")


def pct(a, b):
    return None if a == 0 else (b / a - 1) * 100


def build(src=SRC):
    if not src.exists():
        raise BuildError(f"Falta la fuente {src}.")
    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    need = ["anio", "recurso_id", "recurso", "monto_nominal", "monto_real_2027", "IPC_promedio",
            "factor_a_precios_2027", "etapa", "periodo_fuente", "origen", "grupo_recurso"]
    falta = [c for c in need if c not in (rows[0].keys() if rows else [])]
    if falta:
        raise BuildError(f"Faltan columnas en el CSV: {', '.join(falta)}.")

    controles = []

    def ok(nombre, cond, detalle=""):
        controles.append({"control": nombre, "ok": bool(cond), "detalle": detalle})
        if not cond:
            raise BuildError(f"Control fallido: {nombre}. {detalle}")

    recursos, orden = {}, []
    for i, r in enumerate(rows, start=2):
        ctx = f"Fila {i}"
        try:
            y = int(r["anio"])
        except ValueError:
            raise BuildError(f"{ctx}: año inválido {r['anio']!r}.")
        if y not in YEARS:
            raise BuildError(f"{ctx}: año {y} fuera de 2026–2027.")
        rid = r["recurso_id"].strip()
        if not rid:
            raise BuildError(f"{ctx}: recurso_id vacío.")
        base = BASES[y]
        if r["etapa"].strip() != base["etapa_csv"] or r["periodo_fuente"].strip() != base["periodo_csv"]:
            raise BuildError(f"{ctx}: la base de {y} no es «{base['etiqueta']}» "
                             f"(etapa={r['etapa']!r}, periodo={r['periodo_fuente']!r}).")
        ipc = parse_float(r["IPC_promedio"], ctx)
        fac = parse_float(r["factor_a_precios_2027"], ctx)
        if abs(ipc - IPC[y]) > 1e-9:
            raise BuildError(f"{ctx}: IPC {ipc} distinto del deflactor del tablero ({IPC[y]}).")
        if abs(fac - FACTOR[y]) > 1e-12:
            raise BuildError(f"{ctx}: factor {fac} distinto de {FACTOR[y]}.")
        nom = parse_int(r["monto_nominal"], ctx + " monto_nominal")
        real = parse_int(r["monto_real_2027"], ctx + " monto_real_2027")
        # monto_real_2027 debe ser el nominal llevado a precios de 2027 (redondeo a peso).
        if abs(real - nom * FACTOR[y]) > 1.0:
            raise BuildError(f"{ctx}: monto_real_2027 ({real}) no es monto_nominal × factor ({nom * FACTOR[y]:.0f}).")
        if rid not in recursos:
            recursos[rid] = {"id": rid, "nombre": r["recurso"].strip(), "origen": r["origen"].strip(),
                             "grupo": r["grupo_recurso"].strip(), "anios": {}}
            orden.append(rid)
        rec = recursos[rid]
        if rec["nombre"] != r["recurso"].strip():
            raise BuildError(f"{ctx}: {rid} tiene dos nombres: {rec['nombre']!r} y {r['recurso']!r}.")
        if str(y) in rec["anios"]:
            raise BuildError(f"{ctx}: {rid} aparece dos veces en {y}.")
        rec["anios"][str(y)] = {
            "nominal": nom, "real": real,
            "observacion": r.get("observacion", "").strip(),
            "var_nominal_csv": r.get("variacion_nominal_vs_2026_pct", "").strip(),
            "var_real_csv": r.get("variacion_real_vs_2026_pct", "").strip(),
        }

    ok("Factor 2026 a precios de 2027 = 1,2071016323",
       round(FACTOR[2026], 10) == FACTOR_2026_ESPERADO, f"{FACTOR[2026]!r}")
    incompletos = [k for k, v in recursos.items() if set(v["anios"]) != {"2026", "2027"}]
    ok("Cada recurso tiene 2026 y 2027", not incompletos, ", ".join(incompletos))

    # Las variaciones que trae el CSV deben coincidir con la fórmula (valor_2027 / valor_2026 − 1) × 100.
    for rid, rec in recursos.items():
        a, b = rec["anios"]["2026"], rec["anios"]["2027"]
        for modo, col in (("nominal", "var_nominal_csv"), ("real", "var_real_csv")):
            v = pct(a[modo], b[modo])
            if b[col]:
                if abs(v - float(b[col])) > 1e-5:
                    raise BuildError(f"{rid}: variación {modo} {v:.6f} % no coincide con la del CSV ({b[col]}).")
        for y in ("2026", "2027"):
            del rec["anios"][y]["var_nominal_csv"], rec["anios"][y]["var_real_csv"]
    ok("Variaciones del CSV = (valor_2027 / valor_2026 − 1) × 100", True, f"{len(recursos)} recursos, nominal y real")

    for (rid, y), esperado in CONTROLES_FIJOS.items():
        got = recursos.get(rid, {}).get("anios", {}).get(str(y), {}).get("nominal")
        ok(f"{rid} {y} nominal = {esperado:,}".replace(",", "."), got == esperado, f"leído: {got}")
    iibb = recursos["IIBB"]["anios"]
    vr = pct(iibb["2026"]["real"], iibb["2027"]["real"])
    ok("Ingresos Brutos: variación real ≈ +0,6 %", abs(vr - IIBB_VAR_REAL_APROX) < 0.05, f"{vr:.4f} %")

    # Mismos deflactores que la sección de gastos (sólo lectura de presupuesto.json).
    if GASTOS_JSON.exists():
        gm = json.loads(GASTOS_JSON.read_text(encoding="utf-8"))["meta"]
        for y in YEARS:
            ok(f"IPC {y} igual al de gastos", abs(gm["ipc_average"][str(y)] - IPC[y]) < 1e-9, str(gm["ipc_average"][str(y)]))
            ok(f"Factor {y} igual al de gastos", abs(gm["factor_a_precios_2027"][str(y)] - FACTOR[y]) < 1e-12,
               str(gm["factor_a_precios_2027"][str(y)]))

    totals = {y: {m: sum(r["anios"][str(y)][m] for r in recursos.values()) for m in ("nominal", "real")} for y in YEARS}
    first = rows[0]
    meta = {
        "schema": "ingresos-1",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "archivo": src.name,
        "fuente_documento": first.get("fuente_documento", ""),
        "cuadro_fuente": first.get("cuadro_fuente", ""),
        "pagina_pdf": first.get("pagina_pdf", ""),
        "pagina_documento": first.get("pagina_documento", ""),
        "unidad_fuente": first.get("unidad_fuente", ""),
        "precision_fuente": first.get("precision_fuente", ""),
        "years": list(YEARS),
        "price_base": PRICE_BASE,
        "ipc_average": {str(y): IPC[y] for y in YEARS},
        "factor_a_precios_2027": {str(y): FACTOR[y] for y in YEARS},
        "bases": {str(y): BASES[y]["etiqueta"] for y in YEARS},
        "advertencia": ADVERTENCIA,
        "formula": "(valor_2027 / valor_2026 - 1) × 100",
        "totales": {str(y): totals[y] for y in YEARS},
        "validation_summary": {"ok": True, "controles": controles},
    }
    return {"meta": meta, "recursos": [recursos[k] for k in orden]}


def main():
    try:
        out = build()
    except BuildError as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for c in out["meta"]["validation_summary"]["controles"]:
        print(("✓ " if c["ok"] else "✗ ") + c["control"] + (f" ({c['detalle']})" if c["detalle"] else ""))
    print(f"→ {OUT.name}: {len(out['recursos'])} recursos, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
