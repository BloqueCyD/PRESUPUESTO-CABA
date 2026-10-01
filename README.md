# ¿A dónde va la plata de la Ciudad? · Presupuesto CABA

Tablero estático para comparar el presupuesto de la Ciudad Autónoma de
Buenos Aires entre años (**Vigente** 2023–2026 y **Proyecto** 2027), en pesos corrientes y a precios
constantes de 2027: cuánto aumenta o cae, qué jurisdicciones, funciones e
incisos explican el cambio, cómo cambia la composición del gasto y qué
categorías aparecen o desaparecen.

Construido según el documento *Especificaciones para rearmar el tablero de
Presupuesto CABA* (v1.0, 30/9/2026), con dos fuentes de datos:
`presupuesto_caba_historico_real_2027_comparable.csv` (Vigente 2023–2026,
sin las filas de *Gastos no clasificados*, `Fin = 9` y `Fun = 1`; ver
`DICCIONARIO.md`) y
`presupuesto_2027_tablero.csv` (Proyecto de Ley 2027, crédito inicial).

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
- El Proyecto 2027 está cargado: la página abre comparando Vigente 2026 (A)
  con Proyecto 2027 (B), como pide la especificación. Ver *Cómo funciona el
  Proyecto 2027* más abajo.

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
  Ciudad, etc.). Incluye además un gráfico de la **asignación nominal de cada
  comuna** en el año que se elija, con su participación en el total de las
  comunas y el promedio, para comparar cuánta plata recibe cada una.

### Ordenar los datos

Los rankings, la tabla de composición, los cruces, la tabla de Evolución y
las tablas y gráficos de Comunas tienen un selector de orden: asignación de
mayor a menor, de menor a mayor, o alfabético (con orden natural de números:
Comuna 2 antes que Comuna 10). Donde tiene sentido se mantiene también el
orden por tamaño del cambio en pesos. Se quitó el orden por cambio
porcentual.

### Pestaña Ingresos

Cuarta pestaña, con **fuente propia e independiente** de las de gastos:
`fuentes/ingresos_tributarios_caba_2026_2027.csv` (Mensaje del Proyecto de
Presupuesto 2027, Cuadro 3.4 — Composición de los Recursos Tributarios). No
usa `presupuesto.json`, `metrics.js` ni el estado de `app.js`; los archivos de
gastos no se modificaron.

- **Bases**: 2026 = *Vigente al 30/06/2026*; 2027 = *Proyecto de Ley*. Se
  muestran en las tarjetas, en los encabezados de la tabla y en el recuadro
  *Qué se compara*.
- **Columnas**: `recurso_id` (clave estable), `recurso` (nombre visible),
  `anio`, `monto_nominal` (modo nominal) y `monto_real_2027` (modo real, a
  precios de 2027). A diferencia de gastos, acá los **montos** también cambian
  con el modo: en real se ven a precios de 2027.
- **Variación**: `(valor_2027 / valor_2026 − 1) × 100`, con los montos del
  modo elegido.
- **Orden**: mayor aumento real, mayor caída real (estos dos usan siempre la
  variación real), mayor cambio en pesos (valor absoluto, en el modo elegido)
  y mayor monto (del año elegido, en el modo elegido).
- **Deflactores**: los mismos del tablero (IPC promedio 2026 = 2501,96; 2027 =
  3020,12; factor 2026 a precios de 2027 = 1,2071016323). El build verifica que
  coincidan con los de `presupuesto.json`.
- **Advertencia** visible: la comparación enfrenta recursos vigentes al
  30/06/2026 con los proyectados para 2027; no son recaudación efectivamente
  percibida.
- URL: `?tab=ingresos&modo=real&anio=2027&orden=aumento_real`.

## Estructura

```
├── index.html          → página
├── style.css           → estilos
├── app.js              → interfaz (render, filtros, URL, exportación)
├── metrics.js          → funciones puras de comparación (compartidas con las pruebas)
├── chart.umd.min.js    → Chart.js 4.4.4 vendorizado (sin CDN)
├── presupuesto.json    → datos generados por build_data.py (unos 270 KB)
├── ingresos.js         → pestaña Ingresos (cálculos + interfaz), independiente de app.js
├── ingresos.css        → estilos de la pestaña Ingresos
├── ingresos.json       → datos de ingresos generados por build_ingresos.py (unos 7 KB)
├── build_ingresos.py   → CSV de ingresos → ingresos.json, con validaciones
├── test_ingresos.js    → pruebas de la pestaña Ingresos (Node)
├── build_data.py       → fuentes CSV → presupuesto.json, con validaciones
├── test_build.py       → pruebas del build (Python)
├── test_metrics.js     → pruebas de las métricas (Node)
├── DICCIONARIO.md      → contrato de datos y metodología
└── fuentes/            → CSV de origen (el histórico no se versiona; el de 2027 sí)
```

## Cómo actualizar los datos

1. Copiá `presupuesto_caba_historico_real_2027_comparable.csv` en `fuentes/`.
   Pesa unos 130 MB: GitHub rechaza archivos de más de 100 MB, por eso
   `fuentes/*.csv` está en `.gitignore` (salvo `presupuesto_2027_tablero.csv`,
   que pesa unos 100 KB y sí se versiona). El sitio publicado sólo necesita
   `presupuesto.json`.
2. Corré `python3 build_data.py --requerir-2027` (Python 3.9 o superior, sin
   dependencias). Imprime el resumen de validación y termina con error si algo
   falla.
   - Si no tenés a mano el CSV histórico y sólo cambió el Proyecto 2027, corré
     `python3 build_data.py --base-json presupuesto.json --requerir-2027`:
     toma 2023–2026 del `presupuesto.json` ya publicado y rearma 2027. Da el
     mismo resultado que el build completo.
3. Corré las pruebas: `python3 test_build.py` y `node test_metrics.js`.
4. Commiteá el `presupuesto.json` resultante.

**Ingresos** (independiente de los pasos anteriores): reemplazá
`fuentes/ingresos_tributarios_caba_2026_2027.csv`, corré
`python3 build_ingresos.py` (falla si cambian las bases, los deflactores, los
montos de control de Ingresos Brutos o si las variaciones del CSV no cumplen
la fórmula), después `node test_ingresos.js`, y commiteá `ingresos.json`.

## Cómo funciona el Proyecto 2027

La fuente del Proyecto (`fuentes/presupuesto_2027_tablero.csv`, columna
`Credito_Inicial`) no viene al mismo nivel de detalle que 2023–2026. Trae
tres cruces de dos dimensiones, tal como las planillas del Proyecto de Ley:

| Cruce | Planilla | Filas |
|---|---|---|
| Función × Inciso | Planilla 3 | 160 |
| Jurisdicción × Inciso | Planilla 4 | 176 |
| Jurisdicción × Función | Planilla 8 | 440 |

y **no tiene ubicación geográfica**. Por eso 2027 no se mete en el grano
completo (sería inventar la distribución): se publica aparte, en
`rows_cruces`, y cada vista usa el cruce que contiene las dimensiones que
necesita (las que agrupa más las de los filtros activos):

- Totales, rankings, composición y tabla por jurisdicción, función o inciso;
  los tres cruces; y la evolución 2023–2027: **disponibles**.
- Cualquier filtro o agrupación de a dos dimensiones (por ejemplo, filtrar
  una jurisdicción y ver sus incisos): **disponible**.
- Todo lo que usa comuna o ubicación, o combina jurisdicción, función e
  inciso a la vez (por ejemplo, filtrar jurisdicción y función y abrir por
  inciso): **no disponible para 2027**. La tarjeta lo explica y ofrece un
  botón para quitar el filtro que lo impide o pasar a comparar dos años con
  comunas. En Evolución, esos casos omiten la columna 2027 en vez de
  mostrarla en cero.

El build verifica que los tres cruces sumen el mismo total
($ 24.094.340.599.263) y que los subtotales por jurisdicción, función e
inciso coincidan entre los dos cruces que comparte cada dimensión, así que
el resultado no depende de qué cruce use cada vista. Los códigos
(`Jur`, `Fin`.`Fun`, `Inciso`) son los mismos que en el histórico.

Si en el futuro llega una versión con el detalle completo (con `Geo`),
alcanza con cambiar `SOURCES[2027]` en `build_data.py` a formato `grano`
(como los años Vigente) y 2027 pasa a funcionar en todas las vistas.

## Publicación en GitHub Pages

Subí el contenido de la carpeta (sin `fuentes/*.csv`) a la rama `main`, y
en **Settings → Pages** elegí *Deploy from a branch*, rama `main`, carpeta
`/ (root)`. No hay build en producción, backend ni base de datos.

Para verlo en local: `python3 -m http.server 8000` y abrí
`http://localhost:8000` (con `file://` el navegador bloquea la carga de
`presupuesto.json`).

## Limitaciones conocidas

- **2027 es Proyecto (crédito inicial)** y llega en tres cruces sin comunas
  (ver arriba). Comparar un Proyecto contra un Vigente mide la diferencia
  entre lo que se propone gastar y lo que está autorizado, no ejecución.
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
