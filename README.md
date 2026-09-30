# Comparación presupuestaria · Presupuesto CABA

Tablero estático para comparar el presupuesto **Vigente** de la Ciudad
Autónoma de Buenos Aires entre años, en pesos corrientes y a precios
constantes de 2027: cuánto aumenta o cae, qué jurisdicciones, funciones e
incisos explican el cambio, cómo cambia la composición del gasto y qué
categorías aparecen o desaparecen.

Construido según el documento *Especificaciones para rearmar el tablero de
Presupuesto CABA* (v1.0, 30/9/2026), con una única fuente de datos:
`presupuesto_caba_historico_real_2027_limpio.csv`.

## Cómo se leen los números

- **Los montos son siempre nominales**: pesos corrientes de cada año, tal
  como figuran en las partidas presupuestarias.
- **Sólo las variaciones** se pueden ver en términos **reales** (a precios de
  2027, con el IPC promedio de cada año) o **nominales**. Los montos reales
  se calculan en `build_data.py`; la página sólo los usa para las variaciones.
- **Los años se eligen libremente**: Año A y Año B pueden ser cualquier par.
  La variación siempre va de A a B. Cada año tiene un color fijo (A gris
  azulado, B ocre) que se repite en tarjetas, gráficos, tablas y encabezados,
  y cada monto lleva la etiqueta de su año, su tipo (Vigente o Proyecto) y su
  corte (T4 o T2).
- El Proyecto 2027 todavía no está cargado: hoy se puede comparar entre 2023
  y 2026. Cuando se cargue, 2027 aparece como una opción más y pasa a ser el
  Año B por defecto (con 2026 como Año A), como pide la especificación.

## Qué incluye

Tres pestañas, con los mismos controles arriba (años, variaciones reales o
nominales y filtros de Jurisdicción, Función, Inciso y Comuna o ubicación).
El estado se guarda en la URL (`?tab=comunas&a=2023&b=2026&modo=nominal`)
para compartir una vista.

- **Comparación entre dos años**: montos de A y B, variación nominal y real,
  frase de síntesis; rankings de aumentos y caídas por jurisdicción, función,
  inciso o comuna; composición al 100 %; los tres cruces (Jurisdicción ×
  Inciso, Función × Inciso, Jurisdicción × Función) como matriz con detalle
  por celda; tabla completa exportable a CSV (incluye Comuna ×
  Jurisdicción).
- **Evolución**: todos los años juntos (nunca sumados). Total o apertura por
  jurisdicción, función, inciso o comuna; gráfico de montos nominales por
  año, gráfico de variación acumulada (real o nominal) con el total como
  referencia, y tabla con los montos de cada año, la variación interanual y
  la acumulada. Se pueden marcar hasta 8 filas para graficar.
- **Comunas**: monto registrado en comunas en A y B, cuánto concentran las
  dos comunas con más monto, gráficos de montos y de variación por comuna,
  tabla por comuna, desglose de cada comuna por jurisdicción, función o
  inciso (con la contribución de cada una al cambio) y una tabla aparte con
  las otras ubicaciones registradas (distritos escolares, zona externa a la
  Ciudad, etc.).

## Estructura

```
├── index.html          → página
├── style.css           → estilos
├── app.js              → interfaz (render, filtros, URL, exportación)
├── metrics.js          → funciones puras de comparación (compartidas con las pruebas)
├── chart.umd.min.js    → Chart.js 4.4.4 vendorizado (sin CDN)
├── presupuesto.json    → datos generados por build_data.py (unos 240 KB)
├── build_data.py       → fuentes CSV → presupuesto.json, con validaciones
├── test_build.py       → pruebas del build (Python)
├── test_metrics.js     → pruebas de las métricas (Node)
├── DICCIONARIO.md      → contrato de datos y metodología
└── fuentes/            → CSV de origen (no se versiona, ver abajo)
```

## Cómo actualizar los datos

1. Copiá `presupuesto_caba_historico_real_2027_limpio.csv` en `fuentes/`.
   Pesa unos 130 MB: GitHub rechaza archivos de más de 100 MB, por eso
   `fuentes/*.csv` está en `.gitignore`. El sitio publicado sólo necesita
   `presupuesto.json` (unos 240 KB).
2. Corré `python3 build_data.py` (Python 3.9 o superior, sin dependencias).
   Imprime el resumen de validación y termina con error si algo falla.
3. Corré las pruebas: `python3 test_build.py` y `node test_metrics.js`.
4. Commiteá el `presupuesto.json` resultante.

## Cómo cargar el Proyecto 2027

En `build_data.py`, reemplazá `2027: None` en `SOURCES` por la
configuración del archivo, con el nombre real del archivo y de la columna de
monto del Proyecto:

```python
2027: {"archivo": "<archivo_proyecto_2027>.csv", "tipo": "proyecto",
       "columna_monto": "<columna_del_proyecto>", "columna_anio": "anio"},
```

El archivo tiene que traer las mismas columnas de dimensión que la fuente
histórica (`Jur`, `Desc_Jur`, `Fin`, `Desc_Fin`, `Fun`, `Desc_Fun`,
`Inciso`, `Desc_Inc`) y una columna de año. Si el formato es distinto, hay
que ajustar el mapeo antes de construir. Después corré
`python3 build_data.py --requerir-2027`: con esa opción, el build falla si
falta la fuente del Proyecto, como exige la especificación.

## Publicación en GitHub Pages

Subí el contenido de la carpeta (sin `fuentes/*.csv`) a la rama `main`, y
en **Settings → Pages** elegí *Deploy from a branch*, rama `main`, carpeta
`/ (root)`. No hay build en producción, backend ni base de datos.

Para verlo en local: `python3 -m http.server 8000` y abrí
`http://localhost:8000` (con `file://` el navegador bloquea la carga de
`presupuesto.json`).

## Limitaciones conocidas

- **2026 es Vigente al T2** (corte del segundo trimestre), mientras que
  2023–2025 son T4. La página muestra el corte en los selectores de año, en
  las tarjetas y en los encabezados de Evolución.
- **Comunas**: se usa la ubicación geográfica que registra cada partida
  (`Geo` / `Desc_Geo`). Toda la fuente tiene ubicación, así que la suma de
  ubicaciones es igual al total. La pestaña agrupa como "comunas" las
  ubicaciones cuyo nombre empieza con "Comuna" (la fuente incluye una
  "Comuna 16" con montos mínimos en 2024) y muestra el resto aparte.
- La metodología completa (IPC, fórmulas, procedencia y controles del
  build) no se muestra en la página: está en este README, en
  `DICCIONARIO.md` y en `meta` dentro de `presupuesto.json`.
- **Jurisdicción 31** figura como "Min.Infraestructura" en 2024–2025 y como
  "Ministerio De Movilidad E Infraestructura" en 2026. Se agrupa por código
  (se muestra el nombre más reciente) y queda listada para revisión.
- Hay jurisdicciones con códigos distintos entre años (por ejemplo, 26
  "Ministerio De Justicia Y Seguridad" sólo en 2023, y 24 "Ministerio De
  Justicia" y 29 "Ministerio De Seguridad" desde 2024). No se fusionaron:
  aparecen como nuevas o sin asignación según el año base. Si se confirma
  una equivalencia, se carga en `EQUIVALENCIAS` dentro de `build_data.py`.
- La tabla 6.1 de la especificación muestra un factor 2026
  aproximado de 1.2079; el cálculo exacto con los IPC de la misma
  especificación (3020.12 / 2501.96) es 1.2071, que es el que se usa y el
  que trae el CSV.
- El CSV exportado usa coma como separador y punto decimal. Para abrirlo en
  Excel con configuración regional argentina, importalo con
  *Datos → Desde texto/CSV*.

## Licencia

Código bajo licencia MIT (ver `LICENSE`). Los datos presupuestarios son de
origen público (Gobierno de la Ciudad de Buenos Aires).
