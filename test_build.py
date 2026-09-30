#!/usr/bin/env python3
"""test_build.py — pruebas del build. Uso: python3 test_build.py"""
import copy
import csv
import tempfile
import unittest
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import build_data as B


class TestReglas(unittest.TestCase):
    def test_ipc_especificacion(self):
        self.assertEqual({y: str(v) for y, v in B.IPC_PROMEDIO.items()},
                         {2023: "397.16", 2024: "1295.33", 2025: "1896.37", 2026: "2501.96", 2027: "3020.12"})

    def test_factor_2027_es_1(self):
        self.assertEqual(B.factor_a_precios_2027(2027), 1)

    def test_factor_sin_redondear(self):
        self.assertEqual(B.factor_a_precios_2027(2026), Decimal("3020.12") / Decimal("2501.96"))

    def test_parseo_estricto(self):
        self.assertEqual(B.parse_amount("143529362.0", "Vigente", 2, "x"), Decimal("143529362.0"))
        for bad in ["143.529.362", "1,5", "", "abc", "inf", "nan"]:
            with self.assertRaises(B.BuildError, msg=bad):
                B.parse_amount(bad, "Vigente", 2, "x")

    def test_normalizacion_etiquetas(self):
        self.assertEqual(B.norm_label("  Ministerio   De\u00a0Salud "), "Ministerio De Salud")
        self.assertEqual(B.fold("Dirección Ejecutiva"), B.fold("Dirección ejecutiva"))

    def test_rechaza_columnas_prohibidas(self):
        orig = copy.deepcopy(B.SOURCES)
        try:
            for col in ["Sanción", "Definitivo", "Devengado"]:
                B.SOURCES[2025] = dict(orig[2025], columna_monto=col)
                with self.assertRaises(B.BuildError):
                    B.read_sources()
        finally:
            B.SOURCES.clear(); B.SOURCES.update(orig)

    def test_falla_si_falta_fuente(self):
        orig = copy.deepcopy(B.SOURCES)
        try:
            B.SOURCES[2024] = dict(orig[2024], archivo="no_existe.csv")
            with self.assertRaises(B.BuildError):
                B.read_sources()
        finally:
            B.SOURCES.clear(); B.SOURCES.update(orig)

    def test_requerir_2027(self):
        if B.SOURCES.get(2027) is None:
            with self.assertRaises(B.BuildError):
                B.build(require_2027=True)


def base_json():
    """Sin el CSV histórico (130 MB, no versionado) el build toma 2023–2026 de presupuesto.json."""
    return None if (B.FUENTES / B.HIST_FILE).exists() else str(B.OUT_PATH)


class TestBuildCompleto(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = B.build(require_2027=True, base_json=base_json())

    def test_validaciones_ok(self):
        vs = self.out["meta"]["validation_summary"]
        self.assertTrue(vs["ok"])
        criticos = [c for c in vs["controles"] if not c["ok"] and c["control"] != "Proyecto 2027 cargado"]
        self.assertEqual(criticos, [])

    def test_periodos(self):
        periods = self.out["meta"]["periods"]
        self.assertEqual([p["periodo"] for p in periods], [2023, 2024, 2025, 2026, 2027])
        self.assertTrue(all(p["tipo_presupuesto"] == "vigente" for p in periods[:4]))
        self.assertEqual(periods[4]["tipo_presupuesto"], "proyecto")
        self.assertEqual(periods[4]["grano"], "cruces")
        self.assertEqual(sorted(periods[4]["cruces"]), ["fun_inc", "jur_fun", "jur_inc"])

    def test_defaults_2026_a_2027(self):
        m = self.out["meta"]
        self.assertTrue(m["proyecto_2027_disponible"])
        self.assertEqual((m["default_base_year"], m["default_compared_year"]), (2026, 2027))

    def test_2027_tres_cruces_mismo_total(self):
        yi = self.out["dimensions"]["periodos"].index(2027)
        tot = defaultdict(float)
        for r in self.out["rows_cruces"]:
            if r[0] == yi:
                tot[r[1]] += r[5]
        self.assertEqual(sorted(tot), ["fun_inc", "jur_fun", "jur_inc"])
        self.assertAlmostEqual(tot["jur_fun"], tot["jur_inc"], delta=0.01)
        self.assertAlmostEqual(tot["jur_fun"], tot["fun_inc"], delta=0.01)

    def test_2027_real_igual_nominal(self):
        for r in self.out["rows_cruces"]:
            self.assertEqual(r[5], r[6])

    def test_2027_no_esta_en_el_grano(self):
        yi = self.out["dimensions"]["periodos"].index(2027)
        self.assertFalse(any(r[0] == yi for r in self.out["rows"]))

    def test_real_igual_nominal_por_factor(self):
        years = self.out["dimensions"]["periodos"]
        for r in self.out["rows"] + [[x[0], None, None, None, None, x[5], x[6]] for x in self.out["rows_cruces"]]:
            y = years[r[0]]
            self.assertAlmostEqual(r[6], r[5] * float(Decimal("3020.12") / B.IPC_PROMEDIO[y]), delta=max(0.01, abs(r[5]) * 1e-12))

    def test_ubicaciones(self):
        labels = [g["label"] for g in self.out["dimensions"]["ubicaciones"]]
        self.assertIn("Comuna 1", labels)
        self.assertEqual(self.out["meta"]["row_format"][4], "geo_idx")

    def test_funcion_clave_compuesta(self):
        ids = [f["id"] for f in self.out["dimensions"]["funciones"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all("." in i for i in ids))


class TestFuenteCruces(unittest.TestCase):
    """Validaciones de la lectura del Proyecto 2027 (formato cruces)."""
    HEADER = ["anio", "etapa", "cruce", "Jur", "Desc_Jur", "Fin", "Desc_Fin", "Fun", "Desc_Fun",
              "Inciso", "Desc_Inc", "Credito_Inicial", "fuente_planilla", "pagina_pdf"]
    OK = [
        ["2027", "Proyecto de Ley", "jurisdiccion_funcion", "1", "Legislatura", "1", "Adm", "1", "Legislativa", "", "", "100", "Planilla 8", "177"],
        ["2027", "Proyecto de Ley", "jurisdiccion_inciso", "1", "Legislatura", "", "", "", "", "1", "Personal", "100", "Planilla 4", "173"],
        ["2027", "Proyecto de Ley", "funcion_inciso", "", "", "1", "Adm", "1", "Legislativa", "1", "Personal", "100", "Planilla 3", "172"],
    ]

    def read(self, rows):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        with open(Path(tmp.name) / "p.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f); w.writerow(self.HEADER); w.writerows(rows)
        orig_f, orig_s = B.FUENTES, copy.deepcopy(B.SOURCES)
        try:
            B.FUENTES = Path(tmp.name)
            B.SOURCES[2027] = dict(orig_s[2027], archivo="p.csv")
            labels = {d: defaultdict(lambda: defaultdict(set)) for d in B.DIM_COLUMNS}
            return B.read_cruces(2027, labels)
        finally:
            B.FUENTES = orig_f; B.SOURCES.clear(); B.SOURCES.update(orig_s)

    def test_lee_los_tres_cruces(self):
        cells, prov, _ = self.read(self.OK)
        self.assertEqual(cells["jur_fun"][("1", "1.1")], Decimal(100))
        self.assertEqual(cells["fun_inc"][("1.1", "1")], Decimal(100))
        self.assertEqual(prov["filas_leidas"], 3)

    def test_cruce_desconocido(self):
        bad = copy.deepcopy(self.OK); bad[0][2] = "otra_cosa"
        with self.assertRaises(B.BuildError):
            self.read(bad)

    def test_columna_que_no_corresponde(self):
        bad = copy.deepcopy(self.OK); bad[0][9] = "1"   # inciso en un cruce Jur × Fun
        with self.assertRaises(B.BuildError):
            self.read(bad)

    def test_celda_repetida(self):
        with self.assertRaises(B.BuildError):
            self.read(self.OK + [self.OK[0]])

    def test_falta_un_cruce(self):
        with self.assertRaises(B.BuildError):
            self.read(self.OK[:2])

    def test_monto_con_separador_de_miles(self):
        bad = copy.deepcopy(self.OK); bad[0][11] = "1.000.000"
        with self.assertRaises(B.BuildError):
            self.read(bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
