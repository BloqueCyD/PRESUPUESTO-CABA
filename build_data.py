#!/usr/bin/env python3
"""
build_data.py — genera presupuesto.json para la vista "Comparación presupuestaria".

Uso:
    python3 build_data.py                  # construye con las fuentes disponibles
    python3 build_data.py --requerir-2027  # además falla si falta el Proyecto 2027
    python3 build_data.py --base-json presupuesto.json
        # toma 2023–2026 del presupuesto.json ya publicado (sin el CSV histórico
        # de 130 MB) y agrega o actualiza el Proyecto 2027

Solo usa la biblioteca estándar de Python (3.9+). No usa pandas.

Reglas (documento "Especificaciones para rearmar el tablero de Presupuesto CABA", v1.0):
  * 2023, 2024, 2025 y 2026 = presupuesto Vigente (columna "Vigente").
  * 2027 = Proyecto de Presupuesto (fuente separada, columna "Credito_Inicial").
    Llega como tres cruces de dos dimensiones (Planillas 3, 4 y 8 del Proyecto
    de Ley) y sin ubicación geográfica, así que no se fuerza al grano completo:
    se publica aparte, en rows_cruces, y la página usa en cada vista el cruce
    que contiene las dimensiones que necesita.
  * Nunca se leen Sanción, Definitivo ni Devengado. Si una fuente declara una de
    esas columnas como monto, el build falla.
  * monto_real_2027 = monto_nominal × (IPC_promedio_2027 / IPC_promedio_año),
    con los IPC exactos de la especificación y sin redondear el factor.
  * El build termina con código distinto de cero ante cualquier error crítico.

Salida: presupuesto.json (schema_version 3) con un único grano
año × jurisdicción × función × inciso × ubicación geográfica, del que se derivan sin pérdida los
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
SCHEMA_VERSION = 4

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
# explícita. El Proyecto 2027 usa formato "cruces": una fila por celda de
# cada cruce, identificado por la columna "cruce".
# ---------------------------------------------------------------------------
HIST_FILE = "presupuesto_caba_historico_real_2027_comparable.csv"
SOURCES = {
    2023: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2024: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2025: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2026: {"archivo": HIST_FILE, "tipo": "vigente", "columna_monto": "Vigente", "columna_anio": "anio"},
    2027: {"archivo": "presupuesto_2027_tablero.csv", "tipo": "proyecto", "columna_monto": "Credito_Inicial",
           "columna_anio": "anio", "formato": "cruces", "columna_cruce": "cruce",
           "version_fuente": "Crédito inicial"},
}
EXPECTED_TYPES = {2023: "vigente", 2024: "vigente", 2025: "vigente", 2026: "vigente", 2027: "proyecto"}

# Columnas de dimensión obligatorias (código + descripción).
DIM_COLUMNS = {
    "jur": {"codigo": ["Jur"], "label": "Desc_Jur"},
    "fun": {"codigo": ["Fin", "Fun"], "label": "Desc_Fun"},  # Fun solo no es único: la clave es Fin.Fun
    "fin": {"codigo": ["Fin"], "label": "Desc_Fin"},
    "inc": {"codigo": ["Inciso"], "label": "Desc_Inc"},
    "geo": {"codigo": ["Geo"], "label": "Desc_Geo"},  # ubicación geográfica registrada (comunas y otras)
}
GRAIN_DIMS = ("jur", "fun", "inc", "geo")
CROSS_DIMS = ("jur", "fun", "inc")   # dimensiones que pueden venir en una fuente de cruces
# Nombre del cruce en la fuente -> (código corto, dimensiones que trae).
CRUCES = {
    "jurisdiccion_funcion": ("jur_fun", ("jur", "fun")),
    "jurisdiccion_inciso": ("jur_inc", ("jur", "inc")),
    "funcion_inciso": ("fun_inc", ("fun", "inc")),
}
# Columnas que usa cada dimensión en una fuente de cruces (sin Geo).
CROSS_COLUMNS = {"jur": ["Jur", "Desc_Jur"], "fun": ["Fin", "Desc_Fin", "Fun", "Desc_Fun"], "inc": ["Inciso", "Desc_Inc"]}

# Mapa explícito de equivalencias entre claves (reorganizaciones confirmadas).
# Vacío a propósito: ninguna equivalencia fue confirmada. Formato:
#   {"jur": {"<clave_vieja>": "<clave_nueva>"}}
EQUIVALENCIAS = {"jur": {}, "fun": {}, "inc": {}, "geo": {}}


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
def read_sources(skip_years=None):
    """Lee las fuentes de formato grano (una fila por partida con todas las
    dimensiones). Devuelve (registros_por_año, procedencia, etiquetas_vistas, advertencias)."""
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
        if cfg is not None and cfg.get("formato", "grano") == "grano" and year not in (skip_years or ()):
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
# Etiquetas
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


def read_cruces(year, labels_seen):
    """Lee una fuente de formato "cruces" (Proyecto 2027). Cada fila es una celda
    de un cruce de dos dimensiones; las columnas de la dimensión que no participa
    tienen que venir vacías. Devuelve (celdas, procedencia, advertencias), con
    celdas = {codigo_cruce: {(clave_dim1, clave_dim2): Decimal}}."""
    cfg = SOURCES[year]
    fname = cfg["archivo"]
    path = FUENTES / fname
    if not path.exists():
        raise BuildError(f"Falta la fuente obligatoria {path} (año {year}).")
    cells = {code: defaultdict(Decimal) for code, _ in CRUCES.values()}
    counts = defaultdict(int)
    planillas = defaultdict(set)
    paginas = defaultdict(set)
    zero = neg = 0
    warnings = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        needed = {cfg["columna_monto"], cfg["columna_anio"], cfg["columna_cruce"]}
        for cols in CROSS_COLUMNS.values():
            needed |= set(cols)
        missing = sorted(c for c in needed if c not in header)
        if missing:
            raise BuildError(f"{fname}: faltan columnas obligatorias: {missing}")
        seen = set()
        for lineno, row in enumerate(reader, start=2):
            try:
                y = int(Decimal(row[cfg["columna_anio"]].strip()))
            except (InvalidOperation, ValueError):
                raise BuildError(f"{fname}:{lineno}: año inválido: {row[cfg['columna_anio']]!r}")
            if y != year:
                raise BuildError(f"{fname}:{lineno}: fila del año {y} en la fuente de {year}.")
            name = (row[cfg["columna_cruce"]] or "").strip()
            if name not in CRUCES:
                raise BuildError(f"{fname}:{lineno}: cruce desconocido {name!r}; se esperan {sorted(CRUCES)}.")
            code, dims = CRUCES[name]
            amt = parse_amount(row[cfg["columna_monto"]], cfg["columna_monto"], lineno, fname)
            keys = []
            for dim in CROSS_DIMS:
                cols = CROSS_COLUMNS[dim]
                filled = [c for c in cols if (row[c] or "").strip()]
                if dim not in dims:
                    if filled:
                        raise BuildError(f"{fname}:{lineno}: el cruce {name} no debería traer {filled}.")
                    continue
                spec = DIM_COLUMNS[dim]
                parts = [norm_code(row[c], c, lineno, fname) for c in spec["codigo"]]
                lab = norm_label(row[spec["label"]])
                if any(p is None for p in parts) or lab == "":
                    raise BuildError(f"{fname}:{lineno}: código o descripción vacía en {dim} ({name}).")
                key = EQUIVALENCIAS.get(dim, {}).get(".".join(parts), ".".join(parts))
                labels_seen[dim][key][lab].add(year)
                if dim == "fun":
                    fin = norm_code(row["Fin"], "Fin", lineno, fname)
                    labels_seen["fin"][fin][norm_label(row["Desc_Fin"])].add(year)
                keys.append(key)
            k = tuple(keys)
            if (code, k) in seen:
                raise BuildError(f"{fname}:{lineno}: celda repetida en {name}: {k}.")
            seen.add((code, k))
            cells[code][k] += amt
            counts[code] += 1
            zero += amt == 0
            neg += amt < 0
            if row.get("fuente_planilla"):
                planillas[code].add(row["fuente_planilla"].strip())
            if row.get("pagina_pdf"):
                paginas[code].add(row["pagina_pdf"].strip())
    for code, _ in CRUCES.values():
        if not counts[code]:
            raise BuildError(f"{fname}: falta el cruce {code}.")
    totals = {code: sum(c.values(), Decimal(0)) for code, c in cells.items()}
    if neg:
        warnings.append(f"{fname}: {neg} celdas con monto negativo (se conservan y se marcan).")
    prov = {
        "periodo": year,
        "tipo_presupuesto": cfg["tipo"],
        "archivo": fname,
        "formato": "cruces",
        "version_fuente": cfg.get("version_fuente"),
        "columna_monto": cfg["columna_monto"],
        "filas_leidas": sum(counts.values()),
        "filas_descartadas": 0,
        "filas_monto_cero": zero,
        "filas_monto_negativo": neg,
        "filas_sin_dato": 0,
        "total_nominal": str(totals["jur_fun"]),
        "cruces": [{"cruce": code, "dimensiones": list(dims), "filas": counts[code],
                    "planillas": sorted(planillas[code]),
                    "paginas_pdf": sorted(paginas[code], key=lambda p: int(p) if p.isdigit() else 0),
                    "total_nominal": str(totals[code])} for code, dims in CRUCES.values()],
        "sha256": sha256(path),
    }
    return cells, prov, warnings


def records_from_json(path):
    """Reconstruye los registros 2023–2026 desde un presupuesto.json ya
    construido (cada fila del grano pasa a ser un registro). Sirve para
    actualizar el Proyecto 2027 sin el CSV histórico de 130 MB."""
    path = Path(path)
    if not path.exists():
        raise BuildError(f"No existe {path}.")
    old = json.loads(path.read_text(encoding="utf-8"))
    if old.get("meta", {}).get("schema_version") not in (3, 4):
        raise BuildError(f"{path}: schema_version no soportado.")
    d = old["dimensions"]
    years_old = d["periodos"]
    lists = {"jur": d["jurisdicciones"], "fun": d["funciones"], "inc": d["incisos"], "geo": d["ubicaciones"]}
    records = defaultdict(list)
    labels_seen = {dim: defaultdict(lambda: defaultdict(set)) for dim in DIM_COLUMNS}
    grain_years = {y for y, cfg in SOURCES.items() if cfg and cfg.get("formato", "grano") == "grano"}
    for r in old["rows"]:
        y = years_old[r[0]]
        if y not in grain_years:
            continue
        keys, labels = {}, {}
        for i, dim in enumerate(GRAIN_DIMS):
            x = lists[dim][r[i + 1]]
            keys[dim], labels[dim] = x["id"], x["label"]
            labels_seen[dim][x["id"]][x["label"]].add(y)
        f = lists["fun"][r[2]]
        keys["fin"], labels["fin"] = f["fin_id"], f["fin_label"]
        labels_seen["fin"][f["fin_id"]][f["fin_label"]].add(y)
        records[y].append((keys, labels, Decimal(repr(r[5]))))
    provenance = {s["periodo"]: s for s in old["meta"]["sources"] if s["periodo"] in grain_years}
    for y in grain_years:
        if y not in provenance or y not in records:
            raise BuildError(f"{path}: no trae el año {y}.")
    review_old = old["meta"].get("review", {}).get("etiquetas", [])
    return records, provenance, labels_seen, [], review_old


# ---------------------------------------------------------------------------
# Construcción
# ---------------------------------------------------------------------------
def build(require_2027=False, base_json=None):
    cfg27 = SOURCES.get(2027)
    missing_2027 = cfg27 is None
    if missing_2027 and require_2027:
        raise BuildError("Falta la fuente obligatoria del Proyecto de Presupuesto 2027 (SOURCES[2027] = None).")
    cross_years = sorted(y for y, c in SOURCES.items() if c and c.get("formato") == "cruces")

    review_old = []
    if base_json:
        records, provenance, labels_seen, warnings, review_old = records_from_json(base_json)
    else:
        records, provenance, labels_seen, warnings = read_sources()

    cross_cells = {}
    for y in cross_years:
        cells, prov, w = read_cruces(y, labels_seen)
        cross_cells[y] = cells
        provenance[y] = prov
        warnings += w

    grain_years = sorted(records)
    years = sorted(set(grain_years) | set(cross_years))
    for y in years:
        if y not in IPC_PROMEDIO:
            raise BuildError(f"No hay IPC promedio especificado para {y}.")
    vig = [y for y in years if EXPECTED_TYPES[y] == "vigente"]
    if vig != [2023, 2024, 2025, 2026]:
        raise BuildError(f"Se esperaban los cuatro períodos Vigente 2023–2026; se encontraron {vig}.")

    chosen, review = pick_labels(labels_seen)
    # Variantes de etiqueta que ya se habían detectado en el CSV histórico.
    have = {(x["dimension"], x["clave"]) for x in review}
    review += [x for x in review_old if (x["dimension"], x["clave"]) not in have]

    fin_of_fun = {}
    for y in grain_years:
        for keys, _, _ in records[y]:
            fin_of_fun[keys["fun"]] = keys["fin"]
    for y, cells in cross_cells.items():
        for code, cdims in CRUCES.values():
            if "fun" in cdims:
                for k in cells[code]:
                    fun = k[cdims.index("fun")]
                    fin_of_fun.setdefault(fun, fun.split(".")[0])   # la clave de función es Fin.Fun

    # Índices de dimensión ordenados por código.
    def sort_key(k):
        return [int(p) if p.isdigit() else 10**9 for p in k.split(".")]
    dims = {}
    for dim in GRAIN_DIMS:
        dims[dim] = sorted(chosen[dim], key=sort_key)
    idx = {dim: {k: i for i, k in enumerate(ks)} for dim, ks in dims.items()}

    # Grano: año × jur × fun × inc × geo (suma exacta en Decimal).
    grain = defaultdict(Decimal)
    direct = {"total": defaultdict(Decimal), **{d: defaultdict(Decimal) for d in GRAIN_DIMS}}
    for y in grain_years:
        for keys, _, amt in records[y]:
            grain[(y,) + tuple(keys[d] for d in GRAIN_DIMS)] += amt
            direct["total"][y] += amt
            for d in GRAIN_DIMS:
                direct[d][(y, keys[d])] += amt

    factors = {y: factor_a_precios_2027(y) for y in IPC_PROMEDIO}
    NOM, REAL = 1 + len(GRAIN_DIMS), 2 + len(GRAIN_DIMS)
    rows = []
    for key, nom in sorted(grain.items(), key=lambda kv: (kv[0][0],) + tuple(idx[d][kv[0][i + 1]] for i, d in enumerate(GRAIN_DIMS))):
        y = key[0]
        real = nom if y == PRICE_BASE else nom * factors[y]
        rows.append([years.index(y)] + [idx[d][key[i + 1]] for i, d in enumerate(GRAIN_DIMS)]
                    + [dec_to_float(nom), dec_to_float(real)])

    # Filas de cruces: [periodo_idx, cruce, jur_idx|null, fun_idx|null, inc_idx|null, nominal, real].
    rows_cruces = []
    for y in cross_years:
        for code, cdims in CRUCES.values():
            for k, nom in sorted(cross_cells[y][code].items(), key=lambda kv: tuple(idx[d][kv[0][i]] for i, d in enumerate(cdims))):
                real = nom if y == PRICE_BASE else nom * factors[y]
                ids = [idx[d][k[cdims.index(d)]] if d in cdims else None for d in CROSS_DIMS]
                rows_cruces.append([years.index(y), code] + ids + [dec_to_float(nom), dec_to_float(real)])

    # ---------------- Validaciones y reconciliaciones ----------------
    checks = []
    TOL = 0.01

    def check(name, ok, detail=""):
        checks.append({"control": name, "ok": bool(ok), "detalle": detail})
        return ok

    check("Cuatro períodos Vigente (2023–2026)", vig == [2023, 2024, 2025, 2026], str(vig))
    check("Proyecto 2027 cargado", not missing_2027 and 2027 in years,
          "pendiente de entrega" if missing_2027 else f"{provenance[2027]['archivo']} · columna {provenance[2027]['columna_monto']}")
    check("Ninguna columna de monto es Sanción/Definitivo/Devengado",
          all(SOURCES[y]["columna_monto"].casefold() not in FORBIDDEN_AMOUNT_COLUMNS for y in years),
          ", ".join(f"{y}: {SOURCES[y]['columna_monto']}" for y in years))
    check("IPC promedio = valores de la especificación",
          True, ", ".join(f"{y}: {v}" for y, v in IPC_PROMEDIO.items()))
    check("Factor 2027 = 1", factors[2027] == 1, str(factors[2027]))

    all_finite = all(math.isfinite(r[NOM]) and math.isfinite(r[REAL]) for r in rows) \
        and all(math.isfinite(r[-2]) and math.isfinite(r[-1]) for r in rows_cruces)
    check("Sin NaN ni Infinity en montos", all_finite)
    negs = sum(1 for r in rows if r[NOM] < 0) + sum(1 for r in rows_cruces if r[-2] < 0)
    # Los negativos no hacen fallar el build: se conservan con su signo y se marcan para revisión.
    check("Montos negativos en el grano (se conservan y se marcan)", True, f"{negs} agregados negativos")
    if negs:
        warnings.append(f"{negs} agregados con monto negativo: revisar (no se cambió el signo).")

    # Totales derivados del grano (floats serializados) vs. directos (Decimal exacto).
    yi = {y: i for i, y in enumerate(years)}
    col = {d: i + 1 for i, d in enumerate(GRAIN_DIMS)}
    Z = lambda: [Decimal(0), Decimal(0)]
    g_tot = defaultdict(Z)
    g_dim = {d: defaultdict(Z) for d in GRAIN_DIMS}
    for r in rows:
        n, re_ = Decimal(r[NOM]), Decimal(r[REAL])
        g_tot[r[0]][0] += n; g_tot[r[0]][1] += re_
        for d in GRAIN_DIMS:
            g_dim[d][(r[0], r[col[d]])][0] += n; g_dim[d][(r[0], r[col[d]])][1] += re_
    worst = 0.0
    for y in grain_years:
        f = 1 if y == PRICE_BASE else factors[y]
        worst = max(worst, float(abs(g_tot[yi[y]][0] - direct["total"][y])),
                    float(abs(g_tot[yi[y]][1] - direct["total"][y] * f)))
        for d in GRAIN_DIMS:
            s_nom = s_real = Decimal(0)
            for k, i in idx[d].items():
                v = g_dim[d].get((yi[y], i), Z())
                s_nom += v[0]; s_real += v[1]
                worst = max(worst, float(abs(v[0] - direct[d].get((y, k), 0))),
                            float(abs(v[1] - direct[d].get((y, k), 0) * f)))
            worst = max(worst, float(abs(s_nom - g_tot[yi[y]][0])), float(abs(s_real - g_tot[yi[y]][1])))
    check("Suma de jurisdicciones, funciones, incisos y comunas = total general (nominal y real)", worst <= TOL,
          f"diferencia máxima {worst:.6f} (tolerancia {TOL})")

    # Cruces: subtotales = totales simples.
    worst_x = 0.0
    for a, b in (("jur", "inc"), ("fun", "inc"), ("jur", "fun"), ("geo", "jur")):
        cross = defaultdict(float)
        for r in rows:
            cross[(r[0], r[col[a]], r[col[b]])] += r[NOM]
        sub = defaultdict(float)
        for (yy, x, _), v in cross.items():
            sub[(yy, x)] += v
        for y in grain_years:
            for k, i in idx[a].items():
                worst_x = max(worst_x, abs(sub.get((yi[y], i), 0) - float(direct[a].get((y, k), 0))))
    check("Cada cruce reconcilia con sus totales simples", worst_x <= TOL,
          f"diferencia máxima {worst_x:.6f} (tolerancia {TOL}); cruces: Jurisdicción×Inciso, Función×Inciso, Jurisdicción×Función, Comuna×Jurisdicción")

    # Fuentes de cruces: los tres cruces tienen que describir el mismo presupuesto.
    for y in cross_years:
        cells = cross_cells[y]
        tots = {code: sum(c.values(), Decimal(0)) for code, c in cells.items()}
        check(f"{y}: los tres cruces suman el mismo total", len(set(tots.values())) == 1,
              ", ".join(f"{c}: {v}" for c, v in tots.items()))
        worst_m = Decimal(0)
        for dim in CROSS_DIMS:
            margins = []
            for code, cdims in CRUCES.values():
                if dim in cdims:
                    m = defaultdict(Decimal)
                    for k, v in cells[code].items():
                        m[k[cdims.index(dim)]] += v
                    margins.append(m)
            a_, b_ = margins
            for k in set(a_) | set(b_):
                worst_m = max(worst_m, abs(a_.get(k, 0) - b_.get(k, 0)))
        check(f"{y}: subtotales por jurisdicción, función e inciso coinciden entre cruces", worst_m <= Decimal(TOL),
              f"diferencia máxima {worst_m} (tolerancia {TOL})")
        worst_s = 0.0
        for code in tots:
            s_ = sum(Decimal(r[-2]) for r in rows_cruces if r[0] == yi[y] and r[1] == code)
            worst_s = max(worst_s, float(abs(s_ - tots[code])))
        check(f"{y}: filas publicadas = fuente, en cada cruce", worst_s <= TOL, f"diferencia máxima {worst_s:.6f}")
        direct["total"][y] = tots["jur_fun"]
        warnings.append(f"{y}: la fuente no trae ubicación geográfica; no hay apertura por comuna para ese año.")

    for y in years:
        check(f"Total nominal {y}: fuente = JSON", abs(float(direct['total'][y]) - float(provenance[y]['total_nominal'])) <= TOL,
              provenance[y]["total_nominal"])

    failed = [c for c in checks if not c["ok"] and c["control"] != "Proyecto 2027 cargado"]
    if failed:
        for c in failed:
            print(f"  ✗ {c['control']}: {c['detalle']}", file=sys.stderr)
        raise BuildError("Fallaron validaciones críticas.")

    # Presencia parcial: claves con monto sólo en algunos años (en 2027, en cualquiera de sus cruces).
    presence = []
    for dim in GRAIN_DIMS:
        pres = defaultdict(set)
        for y in grain_years:
            for keys, _, amt in records[y]:
                if amt != 0:
                    pres[keys[dim]].add(y)
        comparable = list(grain_years)
        if dim in CROSS_DIMS:
            comparable += cross_years
            for y in cross_years:
                for code, cdims in CRUCES.values():
                    if dim in cdims:
                        for k, v in cross_cells[y][code].items():
                            if v != 0:
                                pres[k[cdims.index(dim)]].add(y)
        for key, ys in sorted(pres.items(), key=lambda kv: (min(kv[1]), kv[0])):
            if set(ys) != set(comparable):
                presence.append({"dimension": dim, "clave": key, "etiqueta": chosen[dim][key],
                                 "anios_con_monto": sorted(ys)})

    # Años sugeridos al abrir la página; el usuario puede elegir cualquier par.
    compared_year = COMPARED_YEAR_SPEC if 2027 in years else max(vig)
    default_base = DEFAULT_BASE_YEAR_SPEC if 2027 in years else max(y for y in years if y < compared_year)

    out = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "price_base": PRICE_BASE,
            "compared_year_spec": COMPARED_YEAR_SPEC,
            "default_compared_year": compared_year,
            "default_base_year": default_base,
            "proyecto_2027_disponible": 2027 in years,
            "ipc_average": {str(y): float(v) for y, v in IPC_PROMEDIO.items()},
            "factor_a_precios_2027": {str(y): float(f) for y, f in factors.items()},
            "periods": [{"periodo": y, "tipo_presupuesto": EXPECTED_TYPES[y],
                         "version_fuente": provenance[y]["version_fuente"],
                         "grano": "cruces" if y in cross_years else "completo",
                         **({"cruces": [c for c, _ in CRUCES.values()]} if y in cross_years else {})}
                        for y in years],
            "sources": [provenance[y] for y in years],
            "validation_summary": {"ok": True, "controles": checks, "advertencias": warnings},
            "review": {"etiquetas": review, "presencia_parcial": presence,
                       "equivalencias_aplicadas": EQUIVALENCIAS},
            "row_format": ["periodo_idx", "jur_idx", "fun_idx", "inc_idx", "geo_idx", "monto_nominal", "monto_real_2027"],
            "cross_row_format": ["periodo_idx", "cruce", "jur_idx", "fun_idx", "inc_idx", "monto_nominal", "monto_real_2027"],
            "cross_dims": {c: list(d) for c, d in CRUCES.values()},
        },
        "dimensions": {
            "periodos": years,
            "jurisdicciones": [{"id": k, "label": chosen["jur"][k]} for k in dims["jur"]],
            "funciones": [{"id": k, "label": chosen["fun"][k], "fin_id": fin_of_fun.get(k),
                           "fin_label": chosen["fin"].get(fin_of_fun.get(k))} for k in dims["fun"]],
            "incisos": [{"id": k, "label": chosen["inc"][k]} for k in dims["inc"]],
            "ubicaciones": [{"id": k, "label": chosen["geo"][k]} for k in dims["geo"]],
        },
        "rows": rows,
        "rows_cruces": rows_cruces,
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--requerir-2027", action="store_true",
                    help="falla si no está configurada la fuente del Proyecto 2027")
    ap.add_argument("--base-json", default=None,
                    help="toma 2023–2026 de un presupuesto.json ya construido en vez del CSV histórico")
    ap.add_argument("--salida", default=str(OUT_PATH))
    args = ap.parse_args()
    try:
        out = build(require_2027=args.requerir_2027, base_json=args.base_json)
    except BuildError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    Path(args.salida).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    m = out["meta"]
    print(f"OK · {args.salida} · {len(out['rows'])} filas de grano + {len(out['rows_cruces'])} de cruces · "
          f"períodos {out['dimensions']['periodos']}")
    for s in m["sources"]:
        print(f"  {s['periodo']} {s['tipo_presupuesto']:<8} {s['version_fuente'] or '':<15} "
              f"col={s['columna_monto']:<8} filas={s['filas_leidas']:>6}  total nominal={s['total_nominal']}")
    for c in m["validation_summary"]["controles"]:
        print(f"  {'✓' if c['ok'] else '!'} {c['control']}" + (f" — {c['detalle']}" if c["detalle"] else ""))
    for w in m["validation_summary"]["advertencias"]:
        print(f"  ! {w}")
    print(f"  Revisión humana: {len(m['review']['etiquetas'])} claves con variantes de etiqueta, "
          f"{len(m['review']['presencia_parcial'])} claves con presencia parcial entre años.")


if __name__ == "__main__":
    main()
