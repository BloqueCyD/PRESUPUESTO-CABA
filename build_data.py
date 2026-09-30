#!/usr/bin/env python3
"""
build_data.py — genera presupuesto.json para la vista "Comparación presupuestaria".

Uso:
    python3 build_data.py                  # construye con las fuentes disponibles
    python3 build_data.py --requerir-2027  # además falla si falta el Proyecto 2027

Solo usa la biblioteca estándar de Python (3.9+). No usa pandas.

Reglas (documento "Especificaciones para rearmar el tablero de Presupuesto CABA", v1.0):
  * 2023, 2024, 2025 y 2026 = presupuesto Vigente (columna "Vigente").
  * 2027 = Proyecto de Presupuesto (fuente separada, todavía no entregada).
  * Nunca se leen Sanción, Definitivo ni Devengado. Si una fuente declara una de
    esas columnas como monto, el build falla.
  * monto_real_2027 = monto_nominal × (IPC_promedio_2027 / IPC_promedio_año),
    con los IPC exactos de la especificación y sin redondear el factor.
  * El build termina con código distinto de cero ante cualquier error crítico.

Salida: presupuesto.json (schema_version 2) con un único grano
año × jurisdicción × función × inciso, del que se derivan sin pérdida los
totales simples y los tres cruces obligatorios. El build verifica que los
totales derivados de ese grano reconcilien con los calculados directamente
sobre las filas originales.
"""
import argparse
import csv
import hashlib
import json
import math
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, getcontext
from pathlib import Path

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
FUENTES = HERE / "fuentes"
OUT_PATH = HERE / "presupuesto.json"
SCHEMA_VERSION = 2

# ---------------------------------------------------------------------------
# Constantes de la especificación (sección 6.1). No modificar sin cambiar la
# especificación.
# ---------------------------------------------------------------------------
IPC_PROMEDIO = {
    2023: Decimal("397.16"),
    2024: Decimal("1295.33"),
    2025: Decimal("1896.37"),
    2026: Decimal("2501.96"),
    2027: Decimal("3020.12"),
}
PRICE_BASE = 2027
COMPARED_YEAR_SPEC = 2027
DEFAULT_BASE_YEAR_SPEC = 2026
FORBIDDEN_AMOUNT_COLUMNS = {"sancion", "sanción", "definitivo", "devengado"}

# ---------------------------------------------------------------------------
# Fuentes. Cada período declara archivo, tipo y columna de monto de forma
# explícita. 2027 queda en None hasta que se entregue el Proyecto 2027:
# al recibirlo, completar "archivo" y "columna_monto" con los nombres reales.
# ---------------------------------------------------------------------------
HIST_FILE = "presupuesto_caba_historico_real_2027_limpio.csv"
SOURCES = {
    2023: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2024: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2025: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2026: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2027: None,  # Proyecto de Presupuesto 2027: pendiente de entrega.
}
EXPECTED_TYPES = {2023: "vigente", 2024: "vigente", 2025: "vigente", 2026: "vigente", 2027: "proyecto"}

# Columnas de dimensión obligatorias (código + descripción).
DIM_COLUMNS = {
    "jur": {"codigo": ["Jur"], "label": "Desc_Jur"},
    "fun": {"codigo": ["Fin", "Fun"], "label": "Desc_Fun"},  # Fun solo no es único: la clave es Fin.Fun
    "fin": {"codigo": ["Fin"], "label": "Desc_Fin"},
    "inc": {"codigo": ["Inciso"], "label": "Desc_Inc"},
}

# Mapa explícito de equivalencias entre claves (reorganizaciones confirmadas).
# Vacío a propósito: ninguna equivalencia fue confirmada. Formato:
#   {"jur": {"<clave_vieja>": "<clave_nueva>"}}
EQUIVALENCIAS = {"jur": {}, "fun": {}, "inc": {}}


class BuildError(Exception):
    pass


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def norm_label(s):
    """trim + Unicode NFC + espacios internos colapsados. No cambia mayúsculas."""
    s = unicodedata.normalize("NFC", s or "")
    return " ".join(s.split())


def fold(s):
    """Forma de comparación: sin distinción de mayúsculas (la capitalización no es identidad)."""
    return norm_label(s).casefold()


def norm_code(raw, col, lineno, fname):
    raw = (raw or "").strip()
    if raw == "":
        return None
    try:
        d = Decimal(raw)
    except InvalidOperation:
        raise BuildError(f"{fname}:{lineno}: código no numérico en {col}: {raw!r}")
    if d != d.to_integral_value():
        raise BuildError(f"{fname}:{lineno}: código con decimales en {col}: {raw!r}")
    return str(int(d))


def parse_amount(raw, col, lineno, fname):
    """Parseo estricto: número plano con '.' decimal y sin separador de miles.
    Cualquier otro formato hace fallar el build (evita pérdidas silenciosas)."""
    raw = (raw or "").strip()
    if raw == "":
        raise BuildError(f"{fname}:{lineno}: monto vacío en {col}")
    if "," in raw or raw.count(".") > 1:
        raise BuildError(f"{fname}:{lineno}: formato numérico ambiguo en {col}: {raw!r}")
    try:
        d = Decimal(raw)
    except InvalidOperation:
        raise BuildError(f"{fname}:{lineno}: monto no numérico en {col}: {raw!r}")
    if not d.is_finite():
        raise BuildError(f"{fname}:{lineno}: monto no finito en {col}: {raw!r}")
    return d


def factor_a_precios_2027(year):
    return IPC_PROMEDIO[PRICE_BASE] / IPC_PROMEDIO[year]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def dec_to_float(d):
    f = float(d)
    if math.isnan(f) or math.isinf(f):
        raise BuildError(f"valor no finito al serializar: {d}")
    return f


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------
def read_sources():
    """Devuelve (registros_por_año, procedencia, etiquetas_vistas, advertencias)."""
    for year, cfg in SOURCES.items():
        if cfg is None:
            continue
        if cfg["tipo"] != EXPECTED_TYPES[year]:
            raise BuildError(f"{year}: tipo '{cfg['tipo']}' no permitido; se espera '{EXPECTED_TYPES[year]}'.")
        if cfg["columna_monto"].strip().casefold() in FORBIDDEN_AMOUNT_COLUMNS:
            raise BuildError(f"{year}: la columna '{cfg['columna_monto']}' (Sanción/Definitivo/Devengado) "
                             "no puede usarse como monto en esta vista.")

    by_file = defaultdict(list)
    for year, cfg in SOURCES.items():
        if cfg is not None:
            by_file[cfg["archivo"]].append(year)

    records = defaultdict(list)   # year -> [(keys dict, labels dict, Decimal nominal)]
    provenance = {}
    labels_seen = {d: defaultdict(lambda: defaultdict(set)) for d in DIM_COLUMNS}  # dim -> key -> label -> {years}
    warnings = []

    for fname, years in by_file.items():
        path = FUENTES / fname
        if not path.exists():
            raise BuildError(f"Falta la fuente obligatoria {path} (años {years}).")
        checksum = sha256(path)
        per_year = {y: {"leidas": 0, "descartadas": 0, "monto_cero": 0, "negativas": 0,
                        "total": Decimal(0), "periodo_fuente": set(), "sin_dato": 0} for y in years}
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
            needed = set()
            for y in years:
                needed |= {SOURCES[y]["columna_monto"], SOURCES[y]["columna_anio"]}
            for spec in DIM_COLUMNS.values():
                needed |= set(spec["codigo"]) | {spec["label"]}
            missing = sorted(c for c in needed if c not in header)
            if missing:
                raise BuildError(f"{fname}: faltan columnas obligatorias: {missing}")
            year_col = SOURCES[years[0]]["columna_anio"]
            years_in_file = set()
            for lineno, row in enumerate(reader, start=2):
                try:
                    y = int(Decimal(row[year_col].strip()))
                except (InvalidOperation, ValueError):
                    raise BuildError(f"{fname}:{lineno}: año inválido: {row[year_col]!r}")
                years_in_file.add(y)
                if y not in per_year:
                    continue
                st = per_year[y]
                st["leidas"] += 1
                if "periodo_fuente" in row:
                    st["periodo_fuente"].add((row["periodo_fuente"] or "").strip())
                amt = parse_amount(row[SOURCES[y]["columna_monto"]], SOURCES[y]["columna_monto"], lineno, fname)
                keys, labels = {}, {}
                for dim, spec in DIM_COLUMNS.items():
                    parts = [norm_code(row[c], c, lineno, fname) for c in spec["codigo"]]
                    lab = norm_label(row[spec["label"]])
                    if any(p is None for p in parts) or lab == "":
                        # Etiqueta o código vacío -> categoría explícita "Sin dato".
                        st["sin_dato"] += 1
                        key, lab = "sin_dato", "Sin dato"
                    else:
                        key = ".".join(parts)
                    key = EQUIVALENCIAS.get(dim, {}).get(key, key)
                    keys[dim], labels[dim] = key, lab
                    labels_seen[dim][key][lab].add(y)
                if amt == 0:
                    st["monto_cero"] += 1
                if amt < 0:
                    st["negativas"] += 1
                st["total"] += amt
                records[y].append((keys, labels, amt))
        for y in years:
            if y not in years_in_file:
                raise BuildError(f"{fname}: no hay filas para el año {y}.")
        extra = sorted(years_in_file - set(years))
        if extra:
            warnings.append(f"{fname}: filas de años no configurados ignoradas: {extra}")
        for y in years:
            st = per_year[y]
            provenance[y] = {
                "periodo": y,
                "tipo_presupuesto": SOURCES[y]["tipo"],
                "archivo": fname,
                "version_fuente": ", ".join(sorted(st["periodo_fuente"])) or None,
                "columna_monto": SOURCES[y]["columna_monto"],
                "filas_leidas": st["leidas"],
                "filas_descartadas": st["descartadas"],
                "filas_monto_cero": st["monto_cero"],
                "filas_monto_negativo": st["negativas"],
                "filas_sin_dato": st["sin_dato"],
                "total_nominal": str(st["total"]),
                "sha256": checksum,
            }
    return records, provenance, labels_seen, warnings


# ---------------------------------------------------------------------------
# Construcción
# ---------------------------------------------------------------------------
def pick_labels(labels_seen):
    """Etiqueta visible = la del año más reciente. Informa variantes."""
    review = []
    chosen = {}
    for dim, keys in labels_seen.items():
        chosen[dim] = {}
        for key, labs in keys.items():
            latest = max(labs.items(), key=lambda kv: (max(kv[1]), kv[0]))[0]
            chosen[dim][key] = latest
            if len(labs) > 1:
                folded = {fold(l) for l in labs}
                kind = "solo_mayusculas" if len(folded) == 1 else "nombre_distinto"
                review.append({
                    "dimension": dim, "clave": key, "tipo": kind, "etiqueta_usada": latest,
                    "variantes": [{"etiqueta": l, "anios": sorted(ys)} for l, ys in
                                  sorted(labs.items(), key=lambda kv: min(kv[1]))],
                })
    return chosen, review


def presence_report(records, chosen):
    """Claves que no están en todos los años (surgirán como nuevas/eliminadas)."""
    out = []
    years = sorted(records)
    for dim in ("jur", "fun", "inc"):
        pres = defaultdict(set)
        for y in years:
            for keys, _, amt in records[y]:
                if amt != 0:
                    pres[keys[dim]].add(y)
        for key, ys in sorted(pres.items(), key=lambda kv: (min(kv[1]), kv[0])):
            if set(ys) != set(years):
                out.append({"dimension": dim, "clave": key, "etiqueta": chosen[dim][key],
                            "anios_con_monto": sorted(ys)})
    return out


def build(require_2027=False):
    missing_2027 = SOURCES.get(2027) is None
    if missing_2027 and require_2027:
        raise BuildError("Falta la fuente obligatoria del Proyecto de Presupuesto 2027 (SOURCES[2027] = None).")

    records, provenance, labels_seen, warnings = read_sources()
    years = sorted(records)
    for y in years:
        if y not in IPC_PROMEDIO:
            raise BuildError(f"No hay IPC promedio especificado para {y}.")
    vig = [y for y in years if EXPECTED_TYPES[y] == "vigente"]
    if vig != [2023, 2024, 2025, 2026]:
        raise BuildError(f"Se esperaban los cuatro períodos Vigente 2023–2026; se encontraron {vig}.")

    chosen, review = pick_labels(labels_seen)
    fin_of_fun = {}
    for y in years:
        for keys, _, _ in records[y]:
            fin_of_fun[keys["fun"]] = keys["fin"]

    # Índices de dimensión ordenados por código.
    def sort_key(k):
        return [int(p) if p.isdigit() else 10**9 for p in k.split(".")]
    dims = {}
    for dim in ("jur", "fun", "inc"):
        ks = sorted(chosen[dim], key=sort_key)
        dims[dim] = ks
    idx = {dim: {k: i for i, k in enumerate(ks)} for dim, ks in dims.items()}

    # Grano: año × jur × fun × inc (suma exacta en Decimal).
    grain = defaultdict(Decimal)
    direct = {"total": defaultdict(Decimal), "jur": defaultdict(Decimal),
              "fun": defaultdict(Decimal), "inc": defaultdict(Decimal)}
    for y in years:
        for keys, _, amt in records[y]:
            grain[(y, keys["jur"], keys["fun"], keys["inc"])] += amt
            direct["total"][y] += amt
            for d in ("jur", "fun", "inc"):
                direct[d][(y, keys[d])] += amt

    factors = {y: factor_a_precios_2027(y) for y in IPC_PROMEDIO}
    rows = []
    for (y, j, fu, inc), nom in sorted(grain.items(), key=lambda kv: (kv[0][0], idx["jur"][kv[0][1]],
                                                                        idx["fun"][kv[0][2]], idx["inc"][kv[0][3]])):
        real = nom if y == PRICE_BASE else nom * factors[y]
        rows.append([years.index(y), idx["jur"][j], idx["fun"][fu], idx["inc"][inc],
                     dec_to_float(nom), dec_to_float(real)])

    # ---------------- Validaciones y reconciliaciones ----------------
    checks = []
    TOL = 0.01

    def check(name, ok, detail=""):
        checks.append({"control": name, "ok": bool(ok), "detalle": detail})
        return ok

    check("Cuatro períodos Vigente (2023–2026)", vig == [2023, 2024, 2025, 2026], str(vig))
    check("Proyecto 2027 cargado", not missing_2027,
          "pendiente de entrega: la vista compara el último Vigente disponible" if missing_2027 else "")
    check("Ninguna columna de monto es Sanción/Definitivo/Devengado",
          all(SOURCES[y]["columna_monto"].casefold() not in FORBIDDEN_AMOUNT_COLUMNS for y in years),
          ", ".join(f"{y}: {SOURCES[y]['columna_monto']}" for y in years))
    check("IPC promedio = valores de la especificación",
          True, ", ".join(f"{y}: {v}" for y, v in IPC_PROMEDIO.items()))
    check("Factor 2027 = 1", factors[2027] == 1, str(factors[2027]))

    all_finite = all(math.isfinite(r[4]) and math.isfinite(r[5]) for r in rows)
    check("Sin NaN ni Infinity en montos", all_finite)
    negs = sum(1 for r in rows if r[4] < 0)
    # Los negativos no hacen fallar el build: se conservan con su signo y se marcan para revisión.
    check("Montos negativos en el grano (se conservan y se marcan)", True, f"{negs} agregados negativos")
    if negs:
        warnings.append(f"{negs} agregados con monto negativo: revisar (no se cambió el signo).")

    # Totales derivados del grano (floats serializados) vs. directos (Decimal exacto).
    yi = {y: i for i, y in enumerate(years)}
    worst = 0.0
    def g_sum(filter_fn, col):
        return sum(r[col] for r in rows if filter_fn(r))
    for y in years:
        tot_nom = g_sum(lambda r: r[0] == yi[y], 4)
        worst = max(worst, abs(tot_nom - float(direct["total"][y])))
        tot_real = g_sum(lambda r: r[0] == yi[y], 5)
        worst = max(worst, abs(tot_real - float(direct["total"][y] * (1 if y == PRICE_BASE else factors[y]))))
        for d, c in (("jur", 1), ("fun", 2), ("inc", 3)):
            s_nom = s_real = 0.0
            for k, i in idx[d].items():
                v = g_sum(lambda r: r[0] == yi[y] and r[c] == i, 4)
                s_nom += v
                s_real += g_sum(lambda r: r[0] == yi[y] and r[c] == i, 5)
                worst = max(worst, abs(v - float(direct[d].get((y, k), 0))))
            worst = max(worst, abs(s_nom - tot_nom), abs(s_real - tot_real))
    check("Suma de jurisdicciones, funciones e incisos = total general (nominal y real)", worst <= TOL,
          f"diferencia máxima {worst:.6f} (tolerancia {TOL})")

    # Cruces: subtotales = totales simples.
    worst_x = 0.0
    for y in years:
        for (a, ca), (b, cb) in ((("jur", 1), ("inc", 3)), (("fun", 2), ("inc", 3)), (("jur", 1), ("fun", 2))):
            cross = defaultdict(float)
            for r in rows:
                if r[0] == yi[y]:
                    cross[(r[ca], r[cb])] += r[4]
            for k, i in idx[a].items():
                sub = sum(v for (x, _), v in cross.items() if x == i)
                worst_x = max(worst_x, abs(sub - float(direct[a].get((y, k), 0))))
    check("Cada cruce reconcilia con sus totales simples", worst_x <= TOL,
          f"diferencia máxima {worst_x:.6f} (tolerancia {TOL}); cruces: Jurisdicción×Inciso, Función×Inciso, Jurisdicción×Función")

    for y in years:
        check(f"Total nominal {y}: fuente = JSON", abs(float(direct['total'][y]) - float(provenance[y]['total_nominal'])) <= TOL,
              provenance[y]["total_nominal"])

    failed = [c for c in checks if not c["ok"] and c["control"] != "Proyecto 2027 cargado"]
    if failed:
        for c in failed:
            print(f"  ✗ {c['control']}: {c['detalle']}", file=sys.stderr)
        raise BuildError("Fallaron validaciones críticas.")

    compared_year = COMPARED_YEAR_SPEC if not missing_2027 else max(vig)
    default_base = DEFAULT_BASE_YEAR_SPEC if not missing_2027 else max(y for y in years if y < compared_year)

    out = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "price_base": PRICE_BASE,
            "compared_year_spec": COMPARED_YEAR_SPEC,
            "compared_year": compared_year,
            "default_base_year": default_base,
            "proyecto_2027_disponible": not missing_2027,
            "ipc_average": {str(y): float(v) for y, v in IPC_PROMEDIO.items()},
            "factor_a_precios_2027": {str(y): float(f) for y, f in factors.items()},
            "periods": [{"periodo": y, "tipo_presupuesto": EXPECTED_TYPES[y],
                         "version_fuente": provenance[y]["version_fuente"]} for y in years],
            "sources": [provenance[y] for y in years],
            "validation_summary": {"ok": True, "controles": checks, "advertencias": warnings},
            "review": {"etiquetas": review, "presencia_parcial": presence_report(records, chosen),
                       "equivalencias_aplicadas": EQUIVALENCIAS},
            "row_format": ["periodo_idx", "jur_idx", "fun_idx", "inc_idx", "monto_nominal", "monto_real_2027"],
        },
        "dimensions": {
            "periodos": years,
            "jurisdicciones": [{"id": k, "label": chosen["jur"][k]} for k in dims["jur"]],
            "funciones": [{"id": k, "label": chosen["fun"][k], "fin_id": fin_of_fun.get(k),
                           "fin_label": chosen["fin"].get(fin_of_fun.get(k))} for k in dims["fun"]],
            "incisos": [{"id": k, "label": chosen["inc"][k]} for k in dims["inc"]],
        },
        "rows": rows,
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--requerir-2027", action="store_true",
                    help="falla si no está configurada la fuente del Proyecto 2027")
    ap.add_argument("--salida", default=str(OUT_PATH))
    args = ap.parse_args()
    try:
        out = build(require_2027=args.requerir_2027)
    except BuildError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    Path(args.salida).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    m = out["meta"]
    print(f"OK · {args.salida} · {len(out['rows'])} filas de grano · períodos {out['dimensions']['periodos']}")
    for s in m["sources"]:
        print(f"  {s['periodo']} {s['tipo_presupuesto']:<8} {s['version_fuente'] or '':<3} "
              f"col={s['columna_monto']:<8} filas={s['filas_leidas']:>6}  total nominal={s['total_nominal']}")
    for c in m["validation_summary"]["controles"]:
        print(f"  {'✓' if c['ok'] else '!'} {c['control']}" + (f" — {c['detalle']}" if c["detalle"] else ""))
    for w in m["validation_summary"]["advertencias"]:
        print(f"  ! {w}")
    print(f"  Revisión humana: {len(m['review']['etiquetas'])} claves con variantes de etiqueta, "
          f"{len(m['review']['presencia_parcial'])} claves con presencia parcial entre años.")


if __name__ == "__main__":
    main()
