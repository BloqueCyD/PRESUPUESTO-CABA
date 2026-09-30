# Comparación presupuestaria · Presupuesto CABA

Tablero estático para comparar el presupuesto **Vigente** de la Ciudad
Autónoma de Buenos Aires entre años, en pesos corrientes y a precios
constantes de 2027: cuánto aumenta o cae, qué jurisdicciones, funciones e
incisos explican el cambio, cómo cambia la composición del gasto y qué
categorías aparecen o desaparecen.

Construido según el documento *Especificaciones para rearmar el tablero de
Presupuesto CABA* (v1.0, 30/9/2026), con una única fuente de datos:
`presupuesto_caba_historico_real_2027_limpio.csv`.

## Estado actual: Proyecto 2027 pendiente

La especificación compara el Vigente 2023–2026 contra el **Proyecto de
Presupuesto 2027**. Ese archivo todavía no fue entregado, así que:

- el año comparado es, por ahora, el último Vigente disponible (**2026**);
- el año base se elige entre 2023, 2024 y 2025 (por defecto, **2025**);
- los montos reales ya están expresados a precios de 2027 con los IPC de la
  especificación, así que no cambian cuando se cargue el Proyecto;
- la página lo avisa con una franja visible debajo del encabezado.

Cuando se cargue el Proyecto 2027, el año comparado pasa a ser 2027 y el año
base por defecto 2026, tal como pide la especificación, sin tocar el
frontend (ver "Cómo cargar el Proyecto 2027").

## Qué incluye

- **Controles persistentes**: año base, Real o Nominal (Real por defecto) y
  filtros de Jurisdicción, Función e Inciso aplicados a ambos años. El
  estado se guarda en la URL (`?base=2024&modo=nominal&jur=40`) para
  compartir un recorte.
- **Grandes números**: base, comparado, variación nominal y variación real
  (con mayor jerarquía) y una frase de síntesis automática.
- **¿Dónde aumenta y dónde cae?**: rankings de aumentos y caídas por
  jurisdicción, función o inciso, ordenados por cambio absoluto (o
  porcentual, con advertencia de bases chicas), y listas de categorías
  nuevas y sin asignación.
- **Composición**: barras apiladas al 100 % y tabla con el cambio de
  participación en puntos porcentuales.
- **Tres cruces**: Jurisdicción × Inciso, Función × Inciso y Jurisdicción ×
  Función, como matriz de calor con panel de detalle por celda (en móvil,
  lista expandible), búsqueda, top N y orden.
- **Tabla completa** ordenable, buscable y exportable a CSV con valores
  completos, unidad, tipo de presupuesto y recorte en cada fila.
- **Metodología y fuentes**: IPC, factores, fórmulas, procedencia de cada
  período, controles del build y casos para revisión humana.

## Estructura

```
├── index.html          → página
├── style.css           → estilos
├── app.js              → interfaz (render, filtros, URL, exportación)
├── metrics.js          → funciones puras de comparación (compartidas con las pruebas)
├── chart.umd.min.js    → Chart.js 4.4.4 vendorizado (sin CDN)
├── presupuesto.json    → datos generados por build_data.py
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
   `presupuesto.json` (unos 72 KB).
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
  2023–2025 son T4. La página muestra el corte de cada año junto a cada
  monto base y comparado.
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
