# Diccionario de datos

## Fuente

| Período | Tipo | Archivo | Corte (`periodo_fuente`) | Columna de monto | Filas |
|---|---|---|---|---|---|
| 2023 | Vigente | `presupuesto_caba_historico_real_2027_comparable.csv` | T4 | `Vigente` | 50.999 |
| 2024 | Vigente | ídem | T4 | `Vigente` | 48.511 |
| 2025 | Vigente | ídem | T4 | `Vigente` | 45.439 |
| 2026 | Vigente | ídem | T2 | `Vigente` | 38.751 |
| 2027 | Proyecto | `presupuesto_2027_tablero.csv` | Crédito inicial (Proyecto de Ley) | `Credito_Inicial` | 776 (tres cruces) |

El CSV también trae `Sanción`, `Definitivo`, `Devengado`, `IPC_promedio`,
`factor_a_precios_2027` y `Vigente_real_2027`. El build **no lee** Sanción,
Definitivo ni Devengado, y falla si alguno se configura como columna de
monto. Los montos reales se recalculan en `build_data.py` con los IPC de la
especificación; la columna `Vigente_real_2027` del CSV coincide con ese
cálculo (diferencia máxima por fila: 0,0001 pesos) y sirve como control
independiente.

### Base histórica comparable

La base histórica es `presupuesto_caba_historico_real_2027_comparable.csv`:
una copia de `presupuesto_caba_historico_real_2027_limpio.csv` (que se
conserva como respaldo) con las mismas 49 columnas, en el mismo orden y con
las filas retenidas idénticas byte a byte. El único cambio es que se
eliminaron las 21 filas con `Fin = 9` y `Fun = 1` (*Gastos no clasificados*),
que contienen amortización de deuda y aplicaciones financieras no comparables
con el gasto presentado para 2027. Los demás componentes de los incisos 6 y 7
se conservan.

| Año | Filas excluidas | Vigente excluido |
|---|---:|---:|
| 2023 | 8 | $ 72.359.762.816 |
| 2024 | 3 | $ 208.124.519.412 |
| 2025 | 5 | $ 707.512.861.802 |
| 2026 | 5 | $ 1.001.708.004.139 |

Filas: 183.721 en el original, 183.700 en la base comparable.
SHA-256 original: `eddd83702d5cbbe307da0ab279d4e33cce5b94a4536d49ea22dd3d857d3f96a6`.
SHA-256 comparable: `71dd5432dda43c6ded8c04ffe4b57b9b806d4f98e5256b6318c354e34c179680`.

Totales nominales de la fuente (columna `Vigente`):

| Año | Vigente nominal | Vigente real a precios de 2027 |
|---|---|---|
| 2023 | $ 3.131.610.490.149 | $ 23.813.675.781.823 |
| 2024 | $ 10.203.519.394.921 | $ 23.789.963.171.538 |
| 2025 | $ 14.044.514.112.403 | $ 22.367.005.363.484 |
| 2026 | $ 19.877.152.039.294 | $ 23.993.742.672.510 |
| 2027 | $ 24.094.340.599.263 | $ 24.094.340.599.263 (factor 1) |

### Proyecto 2027 (formato cruces)

Columnas: `anio`, `etapa`, `cruce`, `Jur`, `Desc_Jur`, `Fin`, `Desc_Fin`,
`Fun`, `Desc_Fun`, `Inciso`, `Desc_Inc`, `Credito_Inicial`,
`fuente_planilla`, `pagina_pdf`. Cada fila es una celda de uno de tres
cruces (`cruce`): `funcion_inciso` (Planilla 3), `jurisdiccion_inciso`
(Planilla 4) y `jurisdiccion_funcion` (Planilla 8). Las columnas de la
dimensión que no participa del cruce vienen vacías; el build falla si no es
así, si aparece un cruce desconocido, si falta alguno o si una celda se
repite. No hay columna de ubicación geográfica.

## Dimensiones y claves

| Dimensión | Clave estable | Etiqueta | Nota |
|---|---|---|---|
| Jurisdicción | `Jur` | `Desc_Jur` | |
| Función | `Fin` + `.` + `Fun` (ej. `3.1`) | `Desc_Fun` | El código `Fun` solo se repite entre finalidades (el 1 es Legislativa, Salud, Deuda…), por eso la clave es compuesta. |
| Inciso | `Inciso` | `Desc_Inc` | |
| Comuna o ubicación | `Geo` | `Desc_Geo` | Ubicación geográfica que registra cada partida: comunas, distritos escolares y "Zona Externa A La Ciudad". |

Normalización de etiquetas: recorte de espacios, Unicode NFC y espacios
internos colapsados. La capitalización no define identidad. Si un mismo
código tiene varias etiquetas, se muestra la del año más reciente y el caso
queda en `meta.review.etiquetas`. Códigos o etiquetas vacías se convierten
en la categoría "Sin dato" (en esta fuente no hay ninguna).

No se aplica ninguna equivalencia entre códigos distintos
(`EQUIVALENCIAS` vacío). Las claves que sólo tienen monto en algunos años se
listan en `meta.review.presencia_parcial`.

## `presupuesto.json` (schema_version 4)

```json
{
  "meta": {
    "schema_version": 4, "generated_at": "…", "price_base": 2027,
    "compared_year_spec": 2027, "default_compared_year": 2027, "default_base_year": 2026,
    "proyecto_2027_disponible": true,
    "ipc_average": {"2023": 397.16, "2024": 1295.33, "2025": 1896.37, "2026": 2501.96, "2027": 3020.12},
    "factor_a_precios_2027": {"2023": 7.604…, …, "2027": 1.0},
    "periods": [{"periodo": 2023, "tipo_presupuesto": "vigente", "version_fuente": "T4", "grano": "completo"}, …,
                {"periodo": 2027, "tipo_presupuesto": "proyecto", "version_fuente": "Crédito inicial",
                 "grano": "cruces", "cruces": ["jur_fun", "jur_inc", "fun_inc"]}],
    "sources": [{"periodo", "tipo_presupuesto", "archivo", "version_fuente", "columna_monto",
                 "filas_leidas", "filas_descartadas", "filas_monto_cero", "filas_monto_negativo",
                 "filas_sin_dato", "total_nominal", "sha256"}, …],
    "validation_summary": {"ok": true, "controles": […], "advertencias": […]},
    "review": {"etiquetas": […], "presencia_parcial": […], "equivalencias_aplicadas": {…}},
    "row_format": ["periodo_idx", "jur_idx", "fun_idx", "inc_idx", "geo_idx", "monto_nominal", "monto_real_2027"],
    "cross_row_format": ["periodo_idx", "cruce", "jur_idx", "fun_idx", "inc_idx", "monto_nominal", "monto_real_2027"],
    "cross_dims": {"jur_fun": ["jur", "fun"], "jur_inc": ["jur", "inc"], "fun_inc": ["fun", "inc"]}
  },
  "dimensions": {
    "periodos": [2023, 2024, 2025, 2026],
    "jurisdicciones": [{"id": "1", "label": "…"}, …],
    "funciones": [{"id": "1.1", "label": "…", "fin_id": "1", "fin_label": "…"}, …],
    "incisos": [{"id": "1", "label": "…"}, …],
    "ubicaciones": [{"id": "1", "label": "Comuna 1"}, …]
  },
  "rows": [[0, 0, 0, 0, 0, 1234.0, 9383.6], …],
  "rows_cruces": [[4, "jur_fun", 0, 0, null, 265093707021.0, 265093707021.0], …]
}
```

Cada fila de `rows` es una celda del grano **año × jurisdicción × función ×
inciso × ubicación**. De ese único grano se derivan sin pérdida el total
general, los totales por jurisdicción, función, inciso y ubicación, los tres
cruces y el cruce Comuna × Jurisdicción. El build
verifica que esos agregados reconcilien con las sumas calculadas
directamente sobre las filas del CSV (tolerancia 0,01 pesos).

Los años de formato cruces (hoy, sólo 2027) no están en `rows`, sino en
`rows_cruces`: una fila por celda de cada cruce, con `null` en la dimensión
que no participa y sin ubicación. **Nunca se suman filas de distintos
cruces de un mismo año.** La página elige, para cada vista, un único cruce
que contenga todas las dimensiones que agrupa o filtra
(`Metrics.pickRows`); si ninguno alcanza, el año figura como no disponible
en esa vista (nunca como cero). El build controla que los tres cruces tengan
el mismo total y los mismos subtotales por dimensión.

`default_base_year` y `default_compared_year` son sólo los años que la página
propone al abrirse (Año A y Año B); el usuario puede elegir cualquier par.
Siguen la especificación: 2026 y 2027.

## Presentación

Los montos se muestran siempre nominales. `monto_real_2027` se usa sólo
para calcular variaciones reales. Las participaciones se calculan sobre
montos nominales (dentro de un mismo año coinciden con las reales).

## Metodología

```
factor_a_precios_2027(año) = IPC_promedio_2027 / IPC_promedio_año
monto_real_2027            = monto_nominal × factor_a_precios_2027(año)   (2027: real = nominal)
variacion_abs              = comparado − base
variacion_pct              = (comparado / base − 1) × 100
participacion              = monto_categoria / total del mismo año (del recorte filtrado)
cambio_participacion_pp    = participacion_comparada − participacion_base
contribucion               = variacion_abs de la categoría / variacion_abs del total del filtro
variacion_acumulada(año)   = monto(año) / monto(primer año con asignación) − 1   (pestaña Evolución)
```

El factor se calcula con aritmética decimal y no se redondea antes de
multiplicar. Los montos se redondean sólo al mostrarlos (al peso) o al
exportarlos (a centavos).

| Estado | Condición | Etiqueta |
|---|---|---|
| Nueva | A = 0 y B > 0 | Nueva en B (porcentaje: no aplica) |
| Sin asignación | A > 0 y B = 0 | Sin asignación en B (−100 %) |
| Continúa | A > 0 y B > 0 | Continúa |
| Sin movimiento | A = 0 y B = 0 | Oculta por defecto |

El estado se calcula sobre la unión de claves de ambos años, en cada
dimensión simple y en cada cruce con la clave compuesta completa. Los
rankings sólo incluyen categorías que continúan; las nuevas y sin
asignación van en listas propias. Los montos negativos se conservan con su
signo y se marcan para revisión (en esta fuente no hay ninguno).

## CSV exportado

Una fila por categoría o cruce visible, más el total del filtro (y un
subtotal de las filas exportadas cuando la búsqueda o el top N ocultan
filas). Columnas: `anio_a`, `tipo_a`, `anio_b`, `tipo_b`, id y etiqueta de
cada dimensión, montos nominales de A y B, variación nominal y real
(absoluta y porcentual; la real en pesos de 2027), participaciones, cambio
en pp, estado, unidades y filtro aplicado.
