/* metrics.js — funciones puras de la Comparación presupuestaria.
 * Sin dependencias ni acceso al DOM: las usa app.js en el navegador y
 * test_metrics.js en Node. Ningún cálculo de inflación ocurre acá: los montos
 * reales ya vienen calculados por build_data.py (monto_real_2027).
 */
(function (root) {
  'use strict';

  /** Decodifica presupuesto.json (schema_version 2) a objetos legibles. */
  function decode(json) {
    if (!json || !json.meta || json.meta.schema_version !== 3) {
      throw new Error('presupuesto.json no tiene schema_version 3.');
    }
    const d = json.dimensions;
    const years = d.periodos;
    const rows = json.rows.map(r => ({
      year: years[r[0]],
      jur: d.jurisdicciones[r[1]].id,
      fun: d.funciones[r[2]].id,
      inc: d.incisos[r[3]].id,
      geo: d.ubicaciones[r[4]].id,
      nominal: r[5],
      real: r[6],
    }));
    const label = {
      jur: Object.fromEntries(d.jurisdicciones.map(x => [x.id, x.label])),
      fun: Object.fromEntries(d.funciones.map(x => [x.id, x.label])),
      inc: Object.fromEntries(d.incisos.map(x => [x.id, x.label])),
      geo: Object.fromEntries(d.ubicaciones.map(x => [x.id, x.label])),
    };
    const typeOf = Object.fromEntries(json.meta.periods.map(p => [p.periodo, p.tipo_presupuesto]));
    return { meta: json.meta, dims: d, years, rows, label, typeOf };
  }

  /** Mismo recorte para todos los años: filtros {jur, fun, inc, geo} ('' = todas). */
  function applyFilters(rows, filters) {
    const f = filters || {};
    return rows.filter(r =>
      (!f.jur || r.jur === f.jur) && (!f.fun || r.fun === f.fun) && (!f.inc || r.inc === f.inc) && (!f.geo || r.geo === f.geo));
  }

  /** Clave de agrupación. dims: ['jur'] | ['jur','inc'] | ... */
  function keyOf(row, dims) { return dims.map(d => row[d]).join('|'); }

  function totalsOf(rows, year) {
    let nominal = 0, real = 0;
    for (const r of rows) if (r.year === year) { nominal += r.nominal; real += r.real; }
    return { nominal, real };
  }

  /** Estado según la especificación (sección 7), evaluado sobre montos. */
  function estadoOf(base, comp) {
    if (base === 0 && comp === 0) return 'sin_movimiento';
    if (base === 0 && comp !== 0) return 'nueva';
    if (base !== 0 && comp === 0) return 'eliminada';
    return 'continua';
  }

  /** Variación porcentual con reglas de base cero (6.3). Devuelve null si no aplica. */
  function pctChange(base, comp) {
    if (base === 0) return null;          // nueva o sin movimiento: nunca Infinity
    if (comp === 0) return -100;          // eliminada
    return (comp / base - 1) * 100;
  }

  /**
   * Compara dos años sobre la UNIÓN de claves (no inner join).
   * Devuelve { items, totals } con todas las métricas nominales y reales.
   */
  function compare(rows, baseYear, compYear, dims) {
    const acc = new Map();
    const get = k => {
      let v = acc.get(k);
      if (!v) { v = { key: k, parts: k.split('|'), base: { nominal: 0, real: 0 }, comp: { nominal: 0, real: 0 } }; acc.set(k, v); }
      return v;
    };
    for (const r of rows) {
      if (r.year !== baseYear && r.year !== compYear) continue;
      const it = get(keyOf(r, dims));
      const side = r.year === baseYear ? it.base : it.comp;
      side.nominal += r.nominal; side.real += r.real;
    }
    const totals = { base: totalsOf(rows, baseYear), comp: totalsOf(rows, compYear) };
    const items = [];
    for (const it of acc.values()) {
      it.estado = estadoOf(it.base.nominal, it.comp.nominal);
      it.negativo = it.base.nominal < 0 || it.comp.nominal < 0;
      for (const mode of ['nominal', 'real']) {
        const b = it.base[mode], c = it.comp[mode];
        const tb = totals.base[mode], tc = totals.comp[mode];
        const totalChange = tc - tb;
        const partBase = tb !== 0 ? b / tb : null;
        const partComp = tc !== 0 ? c / tc : null;
        it[mode] = {
          abs: c - b,
          pct: pctChange(b, c),
          partBase, partComp,
          pp: partBase != null && partComp != null ? (partComp - partBase) * 100 : null,
          contrib: totalChange !== 0 ? (c - b) / totalChange : null,
        };
      }
      items.push(it);
    }
    for (const mode of ['nominal', 'real']) {
      const b = totals.base[mode], c = totals.comp[mode];
      totals[mode] = { abs: c - b, pct: pctChange(b, c) };
    }
    return { items, totals };
  }

  /** Rankings: sólo categorías que continúan; nuevas y eliminadas van aparte. */
  function rankings(items, mode, order, n) {
    const cont = items.filter(i => i.estado === 'continua');
    const val = i => order === 'pct' ? i[mode].pct : i[mode].abs;
    const up = cont.filter(i => i[mode].abs > 0).sort((a, b) => val(b) - val(a));
    const down = cont.filter(i => i[mode].abs < 0).sort((a, b) => val(a) - val(b));
    const nuevas = items.filter(i => i.estado === 'nueva').sort((a, b) => b.comp[mode] - a.comp[mode]);
    const eliminadas = items.filter(i => i.estado === 'eliminada').sort((a, b) => b.base[mode] - a.base[mode]);
    return { up: up.slice(0, n), down: down.slice(0, n), nuevas, eliminadas, upCount: up.length, downCount: down.length };
  }

  /**
   * Evolución de todos los años. dims = [] da el total.
   * Para cada categoría: montos por año y variaciones interanuales y acumuladas
   * (desde el primer año con asignación), en nominal y en real.
   */
  function evolution(rows, years, dims) {
    const acc = new Map();
    for (const r of rows) {
      const k = dims.length ? keyOf(r, dims) : 'total';
      let v = acc.get(k);
      if (!v) { v = { key: k, parts: k.split('|'), byYear: Object.fromEntries(years.map(y => [y, { nominal: 0, real: 0 }])) }; acc.set(k, v); }
      const b = v.byYear[r.year]; if (!b) continue;
      b.nominal += r.nominal; b.real += r.real;
    }
    const items = [];
    for (const it of acc.values()) {
      const first = years.find(y => it.byYear[y].nominal !== 0);
      if (first === undefined) continue;                 // sin movimiento en todo el período
      it.firstYear = first;
      it.lastYear = years[years.length - 1];
      for (const mode of ['nominal', 'real']) {
        it[mode] = {
          yoy: years.slice(1).map((y, i) => pctChange(it.byYear[years[i]][mode], it.byYear[y][mode])),
          cum: Object.fromEntries(years.map(y => [y, years.indexOf(y) < years.indexOf(first) ? null
            : pctChange(it.byYear[first][mode], it.byYear[y][mode])])),
          total: pctChange(it.byYear[first][mode], it.byYear[it.lastYear][mode]),
        };
      }
      items.push(it);
    }
    return items;
  }

  const M = { decode, evolution, applyFilters, keyOf, totalsOf, estadoOf, pctChange, compare, rankings };
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.Metrics = M;
})(typeof self !== 'undefined' ? self : this);
