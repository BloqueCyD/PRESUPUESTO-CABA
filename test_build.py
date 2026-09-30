#!/usr/bin/env python3
"""test_build.py — pruebas del build. Uso: python3 test_build.py"""
import copy
import unittest
from decimal import Decimal

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


class TestBuildCompleto(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = B.build()

    def test_validaciones_ok(self):
        vs = self.out["meta"]["validation_summary"]
        self.assertTrue(vs["ok"])
        criticos = [c for c in vs["controles"] if not c["ok"] and c["control"] != "Proyecto 2027 cargado"]
        self.assertEqual(criticos, [])

    def test_cuatro_vigente(self):
        self.assertEqual([p["periodo"] for p in self.out["meta"]["periods"]], [2023, 2024, 2025, 2026])
        self.assertTrue(all(p["tipo_presupuesto"] == "vigente" for p in self.out["meta"]["periods"]))

    def test_real_igual_nominal_por_factor(self):
        years = self.out["dimensions"]["periodos"]
        for r in self.out["rows"]:
            y = years[r[0]]
            self.assertAlmostEqual(r[5], r[4] * float(Decimal("3020.12") / B.IPC_PROMEDIO[y]), delta=max(0.01, abs(r[4]) * 1e-12))

    def test_funcion_clave_compuesta(self):
        ids = [f["id"] for f in self.out["dimensions"]["funciones"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all("." in i for i in ids))


if __name__ == "__main__":
    unittest.main(verbosity=2)
