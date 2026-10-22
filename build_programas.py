#!/usr/bin/env python3
"""build_programas.py — fuentes/Consolidado_Jurisdicciones_2027.csv → programas.json

Pestaña "Programas": Proyecto 2027 vs Vigente 30/06/2026, por jurisdicción ×
programa (cuadernillos "Planillas desagregadas" del Proyecto de Ley 2027).

Fuente independiente de la sección de gastos: no lee ni escribe nada de
build_data.py y sólo *consulta* presupuesto.json para verificar que los totales
por jurisdicción coincidan al peso con los que ya muestra el tablero (así la
pestaña nueva no puede contradecir ninguna comparación existente).

Qué se toma del CSV, sin modificar:
  jur, jur_nombre, prog, programa, ues_2027, fte11 … fte22,
  proyecto_2027_pesos, vigente_2026_30_06_pesos, estado, observacion.

Qué NO se publica:
  variacion_real_2027_pesos, var_pct_real y contribucion_pp_real_jur del CSV
  están calculadas como (2027 ÷ 1,2071) − 2026 (pesos de 2026, factor
  redondeado). El tablero expresa las variaciones reales en pesos de 2027 con
  el factor exacto (3020,12 / 2501,96). Para que todo sea comparable, la
  página recalcula la variación real con la convención del tablero a partir de
  los montos nominales del CSV. El build sí verifica que las columnas del CSV
  sean coherentes con su propia fórmula (control de integridad de la fuente).

Uso: python3 build_programas.py   (Python 3.9+, sin dependencias)
Termina con error si alguna validación falla; en ese caso no escribe programas.json.
"""
import csv
import hashlib
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "fuentes" / "Consolidado_Jurisdicciones_2027.csv"
OUT = ROOT / "programas.json"
GASTOS_JSON = ROOT / "presupuesto.json"

Y0, Y1 = 2026, 2027
F_CSV = 1.2071  # factor redondeado con el que el CSV calcula sus columnas reales
TOTAL_2027 = 24_094_340_599_263  # Planilla 2 = total 2027 de presupuesto.json
TOTAL_2026 = 19_877_152_039_294  # Vigente 2026 comparable = total 2026 de presupuesto.json

FUENTES = [
    ("fte11_rentas_generales", "11", "Rentas generales"),
    ("fte12_recursos_propios", "12", "Recursos propios"),
    ("fte13_recursos_afectados", "13", "Recursos afectados"),
    ("fte14_transferencias_afectadas", "14", "Transferencias afectadas"),
    ("fte15_transferencias_internas", "15", "Transferencias internas"),
    ("fte22_credito_publico", "22", "Crédito público"),
]
ESTADOS = {
    "comparable": "continua",
    "nuevo 2027": "nuevo",
    "suprimido 2027": "suprimido",
    "fuera del gasto comparable": "fuera",
}
COLS = ["jur", "jur_nombre", "prog", "programa", "ues_2027", *[c for c, _, _ in FUENTES],
        "proyecto_2027_pesos", "vigente_2026_30_06_pesos", "variacion_nominal_pesos",
        "variacion_real_2027_pesos", "var_pct_nominal", "var_pct_real",
        "contribucion_pp_real_jur", "estado", "observacion"]


class BuildError(Exception):
    pass


def to_int(s, ctx):
    s = (s or "").strip()
    try:
        v = float(s)
    except ValueError:
        raise BuildError(f"{ctx}: valor no numérico {s!r}.")
    if v != int(v):
        raise BuildError(f"{ctx}: se esperaba un monto entero en pesos: {s!r}.")
    return int(v)


def to_float(s, ctx):
    try:
        return float((s or "").strip())
    except ValueError:
        raise BuildError(f"{ctx}: valor no numérico {s!r}.")


def gastos_por_jur():
    """Totales por jurisdicción de presupuesto.json: 2026 desde rows, 2027 desde el cruce Jur × Inciso."""
    d = json.loads(GASTOS_JSON.read_text(encoding="utf-8"))
    per = d["dimensions"]["periodos"]
    jur = d["dimensions"]["jurisdicciones"]
    s26, s27 = defaultdict(float), defaultdict(float)
    for r in d["rows"]:
        if per[r[0]] == Y0:
            s26[jur[r[1]]["id"]] += r[5]
    for r in d["rows_cruces"]:
        if per[r[0]] == Y1 and r[1] == "jur_inc":
            s27[jur[r[2]]["id"]] += r[5]
    return d["meta"], s26, s27


def build(src=SRC):
    if not src.exists():
        raise BuildError(f"Falta la fuente {src}.")
    raw = src.read_bytes()
    with open(src, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        falta = [c for c in COLS if c not in (reader.fieldnames or [])]
        if falta:
            raise BuildError(f"Faltan columnas en el CSV: {', '.join(falta)}.")
        rows = list(reader)

    controles = []

    def ok(nombre, cond, detalle=""):
        controles.append({"control": nombre, "ok": bool(cond), "detalle": detalle})
        if not cond:
            raise BuildError(f"Control fallido: {nombre}. {detalle}")

    programas, jurs, vistos = [], {}, set()
    incoherentes = []
    for i, r in enumerate(rows, start=2):
        ctx = f"Fila {i}"
        jur = str(to_int(r["jur"], ctx + " jur"))
        prog = to_int(r["prog"], ctx + " prog")
        if (jur, prog) in vistos:
            raise BuildError(f"{ctx}: jurisdicción {jur} × programa {prog} repetido.")
        vistos.add((jur, prog))
        estado = r["estado"].strip()
        if estado not in ESTADOS:
            raise BuildError(f"{ctx}: estado desconocido {estado!r}.")
        nombre_jur = r["jur_nombre"].strip()
        if jurs.setdefault(jur, nombre_jur) != nombre_jur:
            raise BuildError(f"{ctx}: la jurisdicción {jur} tiene dos nombres.")
        p27 = to_int(r["proyecto_2027_pesos"], ctx + " proyecto_2027_pesos")
        v26 = to_int(r["vigente_2026_30_06_pesos"], ctx + " vigente_2026_30_06_pesos")
        if p27 < 0 or v26 < 0:
            raise BuildError(f"{ctx}: monto negativo.")
        tiene_fte = r["fte11_rentas_generales"].strip() != ""
        fte = [to_int(r[c], f"{ctx} {c}") for c, _, _ in FUENTES] if tiene_fte else None
        if fte is not None and sum(fte) != p27:
            raise BuildError(f"{ctx}: la suma de fuentes ({sum(fte)}) no es el proyecto 2027 ({p27}).")
        if fte is None and p27 != 0:
            raise BuildError(f"{ctx}: proyecto 2027 sin apertura por fuente.")

        # Coherencia interna del CSV con su propia fórmula (no se publican estas columnas).
        vn = to_float(r["variacion_nominal_pesos"], ctx)
        vr = to_float(r["variacion_real_2027_pesos"], ctx)
        if abs(vn - (p27 - v26)) > 1 or abs(vr - (p27 / F_CSV - v26)) > 1:
            incoherentes.append(f"{jur}/{prog}")
        if v26:
            if abs(to_float(r["var_pct_nominal"], ctx) - (p27 / v26 - 1)) > 1e-5 \
                    or abs(to_float(r["var_pct_real"], ctx) - (p27 / F_CSV / v26 - 1)) > 1e-5:
                incoherentes.append(f"{jur}/{prog} (%)")

        programas.append({
            "jur": jur, "prog": prog, "nombre": r["programa"].strip(),
            "ues": to_int(r["ues_2027"], ctx) if r["ues_2027"].strip() else None,
            "fte": fte, "v26": v26, "p27": p27,
            "estado": ESTADOS[estado], "estado_csv": estado,
            "obs": r["observacion"].strip(),
        })

    ok("Sin filas repetidas (jurisdicción × programa)", True, f"{len(programas)} filas")
    ok("Fuentes de financiamiento suman el proyecto 2027 en cada programa", True)
    ok("Columnas de variación del CSV coherentes con su fórmula (factor 1,2071)", not incoherentes,
       ", ".join(incoherentes[:10]))

    comp = [p for p in programas if p["estado"] != "fuera"]
    t27 = sum(p["p27"] for p in comp)
    t26 = sum(p["v26"] for p in comp)
    ok("Total 2027 comparable = 24.094.340.599.263", t27 == TOTAL_2027, f"leído: {t27}")
    ok("Total Vigente 2026 comparable = 19.877.152.039.294", t26 == TOTAL_2026, f"leído: {t26}")
    fuera = [p for p in programas if p["estado"] == "fuera"]
    ok("Filas fuera del gasto comparable sin vigente 2026", all(p["v26"] == 0 for p in fuera),
       ", ".join(f"{p['jur']}/{p['prog']}" for p in fuera))

    # Reconciliación con el tablero de gastos (sólo lectura de presupuesto.json).
    if not GASTOS_JSON.exists():
        raise BuildError("Falta presupuesto.json para reconciliar los totales por jurisdicción.")
    gmeta, s26, s27 = gastos_por_jur()
    c26, c27 = defaultdict(int), defaultdict(int)
    for p in comp:
        c26[p["jur"]] += p["v26"]
        c27[p["jur"]] += p["p27"]
    dif = [j for j in sorted(set(c26) | set(s26) | set(s27), key=int)
           if abs(c26[j] - s26[j]) > 0.01 or abs(c27[j] - s27[j]) > 0.01]
    ok("Totales por jurisdicción = presupuesto.json (2026 y 2027, al peso)", not dif, ", ".join(dif))
    factor = gmeta["factor_a_precios_2027"][str(Y0)]
    ok("Factor 2026 a precios de 2027 tomado de presupuesto.json", abs(factor - 3020.12 / 2501.96) < 1e-12, repr(factor))

    meta = {
        "schema": "programas-1",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "archivo": src.name,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "filas": len(programas),
        "years": [Y0, Y1],
        "bases": {str(Y0): "Vigente al 30/06/2026", str(Y1): "Proyecto de Ley"},
        "price_base": 2027,
        "factor_a_precios_2027": {str(Y0): factor, str(Y1): 1.0},
        "formula_real": "variación real = proyecto_2027 − vigente_2026 × factor (pesos de 2027)",
        "fuentes": [{"id": k, "nombre": n} for _, k, n in FUENTES],
        "estados": {v: k for k, v in ESTADOS.items()},
        "totales": {str(Y0): t26, str(Y1): t27},
        "validation_summary": {"ok": True, "controles": controles},
    }
    jur_list = [{"id": j, "nombre": jurs[j]} for j in sorted(jurs, key=int)]
    return {"meta": meta, "jurisdicciones": jur_list, "programas": programas}


def main():
    try:
        out = build()
    except BuildError as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for c in out["meta"]["validation_summary"]["controles"]:
        print(("✓ " if c["ok"] else "✗ ") + c["control"] + (f" ({c['detalle']})" if c["detalle"] else ""))
    print(f"→ {OUT.name}: {len(out['programas'])} programas, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
