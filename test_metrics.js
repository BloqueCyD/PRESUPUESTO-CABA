// test_metrics.js — pruebas de las funciones de comparación contra presupuesto.json.
// Uso: node test_metrics.js   (sale con código 1 si alguna prueba falla)
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const M = require('./metrics.js');

const D = M.decode(JSON.parse(fs.readFileSync(path.join(__dirname, 'presupuesto.json'), 'utf8')));
const COMP = D.meta.default_compared_year;
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}
const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

console.log('Reglas de base cero');
t('base > 0: porcentaje normal', () => close(M.pctChange(100, 150), 50, 1e-12));
t('base = 0 y comparado > 0: null + nueva', () => { assert.strictEqual(M.pctChange(0, 5), null); assert.strictEqual(M.estadoOf(0, 5), 'nueva'); });
t('base > 0 y comparado = 0: −100 % + eliminada', () => { assert.strictEqual(M.pctChange(5, 0), -100); assert.strictEqual(M.estadoOf(5, 0), 'eliminada'); });
t('ambos 0: null + sin movimiento', () => { assert.strictEqual(M.pctChange(0, 0), null); assert.strictEqual(M.estadoOf(0, 0), 'sin_movimiento'); });

console.log('Datos reales');
// Filas utilizables para una vista con esas dimensiones (2027 llega en cruces: nunca se suman capas).
const R = (...need) => M.pickRows(D, need).rows;
const all = R();
t('continua: Jurisdicción 40 (Salud) 2025 → ' + COMP, () => {
  const it = M.compare(R(...['jur']), 2025, COMP, ['jur']).items.find(i => i.key === '40');
  assert.strictEqual(it.estado, 'continua');
  close(it.real.abs, it.comp.real - it.base.real);
  close(it.real.pct, (it.comp.real / it.base.real - 1) * 100, 1e-9);
});
t('nueva: Función 2.3 (Sistema penal) aparece en 2026', () => {
  const it = M.compare(R(...['fun']), 2025, 2026, ['fun']).items.find(i => i.key === '2.3');
  assert.strictEqual(it.estado, 'nueva'); assert.strictEqual(it.real.pct, null);
});
t('eliminada: Jurisdicción 26 (Justicia y Seguridad) 2023 → 2026', () => {
  const it = M.compare(R(...['jur']), 2023, 2026, ['jur']).items.find(i => i.key === '26');
  assert.strictEqual(it.estado, 'eliminada'); assert.strictEqual(it.real.pct, -100);
});
t('sin Infinity/NaN en ninguna métrica (todas las bases y cruces)', () => {
  for (const b of D.years.filter(y => y < COMP)) for (const dims of [['jur'], ['fun'], ['inc'], ['jur', 'inc'], ['fun', 'inc'], ['jur', 'fun']]) {
    for (const it of M.compare(R(...dims), b, COMP, dims).items) for (const m of ['nominal', 'real']) for (const k of ['abs', 'pct', 'partBase', 'partComp', 'pp']) {
      const v = it[m][k]; assert.ok(v === null || Number.isFinite(v), `${dims} ${it.key} ${m}.${k}=${v}`);
    }
  }
});
t('unión completa: claves = unión de claves con filas en base y comparado', () => {
  const keys = new Set(all.filter(r => r.year === 2023 || r.year === COMP).map(r => r.jur));
  assert.strictEqual(M.compare(R(...['jur']), 2023, COMP, ['jur']).items.length, keys.size);
});
t('cruces reconcilian con totales simples (nominal y real, todas las bases)', () => {
  for (const b of D.years.filter(y => y < COMP)) for (const [a, x] of [['jur', 'inc'], ['fun', 'inc'], ['jur', 'fun']]) {
    const simple = new Map(M.compare(R(a), b, COMP, [a]).items.map(i => [i.key, i]));
    const sub = new Map();
    for (const it of M.compare(R(a, x), b, COMP, [a, x]).items) {
      const s = sub.get(it.parts[0]) || { bn: 0, cn: 0, br: 0, cr: 0 };
      s.bn += it.base.nominal; s.cn += it.comp.nominal; s.br += it.base.real; s.cr += it.comp.real; sub.set(it.parts[0], s);
    }
    for (const [k, s] of sub) { const i = simple.get(k); close(s.bn, i.base.nominal); close(s.cn, i.comp.nominal); close(s.br, i.base.real); close(s.cr, i.comp.real); }
  }
});
t('participaciones suman 100 %', () => {
  const items = M.compare(R(...['inc']), 2024, COMP, ['inc']).items;
  close(items.reduce((s, i) => s + i.real.partBase, 0), 1, 1e-9);
  close(items.reduce((s, i) => s + i.real.partComp, 0), 1, 1e-9);
});
t('cambiar año base recalcula totales', () => {
  const a = M.compare(R(...['jur']), 2025, COMP, ['jur']).totals, b = M.compare(R(...['jur']), 2023, COMP, ['jur']).totals;
  assert.notStrictEqual(a.base.nominal, b.base.nominal); assert.strictEqual(a.comp.nominal, b.comp.nominal);
});
t('Real y Nominal dan valores distintos (años distintos)', () => {
  const tt = M.compare(R(...['jur']), 2025, COMP, ['jur']).totals;
  assert.notStrictEqual(Math.round(tt.real.pct * 1e6), Math.round(tt.nominal.pct * 1e6));
});
t('real = nominal × factor de la especificación', () => {
  for (const y of D.years) {
    const tot = M.totalsOf(all, y);
    close(tot.real, tot.nominal * (3020.12 / D.meta.ipc_average[String(y)]), 0.05);
  }
});
t('comuna: suma de ubicaciones = total, y filtro por comuna', () => {
  const it = M.compare(R(...['geo']), 2025, 2026, ['geo']);
  close(it.items.reduce((s, i) => s + i.comp.nominal, 0), it.totals.comp.nominal);
  const c1 = M.applyFilters(R('geo'), { geo: it.items[0].key });
  assert.ok(c1.length > 0 && c1.every(r => r.geo === it.items[0].key));
});
t('cualquier par de años (incluido A > B) da métricas coherentes', () => {
  const x = M.compare(R(...['jur']), 2026, 2024, ['jur']).totals, y = M.compare(R(...['jur']), 2024, 2026, ['jur']).totals;
  close(x.real.abs, -y.real.abs); close((1 + x.real.pct / 100) * (1 + y.real.pct / 100), 1, 1e-12);
});
t('evolución: acumulada del total = variación directa primer→último año', () => {
  const e = M.evolution(all, D.years, [])[0];
  const d = M.compare(all, D.years[0], D.years[D.years.length - 1], ['jur']).totals;
  close(e.real.total, d.real.pct, 1e-9); close(e.nominal.total, d.nominal.pct, 1e-9);
});
t('evolución: categoría que aparece después acumula desde su primer año', () => {
  const g = M.evolution(R('jur'), D.years, ['jur']).find(i => i.key === '29');
  assert.strictEqual(g.firstYear, 2024); assert.strictEqual(g.real.cum[2023], null); assert.strictEqual(g.real.cum[2024], 0);
});
t('filtro: ambos años usan el mismo recorte', () => {
  const f = M.applyFilters(R('jur', 'inc'), { jur: '40' });
  assert.ok(f.every(r => r.jur === '40'));
  const tt = M.compare(f, 2025, COMP, ['inc']).totals;
  const s = M.compare(R(...['jur']), 2025, COMP, ['jur']).items.find(i => i.key === '40');
  close(tt.base.nominal, s.base.nominal); close(tt.comp.nominal, s.comp.nominal);
});
t('totales = total nominal de la fuente (meta.sources)', () => {
  for (const s of D.meta.sources) close(M.totalsOf(all, s.periodo).nominal, Number(s.total_nominal));
});
t('rankings excluyen nuevas y eliminadas', () => {
  const RK = M.rankings(M.compare(R(...['jur']), 2023, COMP, ['jur']).items, 'real', 'abs', 50);
  assert.ok(RK.up.concat(RK.down).every(i => i.estado === 'continua'));
  assert.ok(RK.nuevas.length > 0 && RK.eliminadas.length > 0);
});

console.log('Proyecto 2027 (cruces)');
t('2027 está cargado y es el Año B por defecto, con 2026 como A', () => {
  assert.ok(D.years.includes(2027)); assert.strictEqual(D.meta.proyecto_2027_disponible, true);
  assert.strictEqual(D.meta.default_compared_year, 2027); assert.strictEqual(D.meta.default_base_year, 2026);
  assert.strictEqual(D.typeOf[2027], 'proyecto');
});
t('2027: real = nominal (factor 1)', () => { const x = M.totalsOf(R(), 2027); close(x.real, x.nominal, 1e-6); });
t('2027: el total es el mismo desde cualquiera de los tres cruces', () => {
  const tot = ['jur_fun', 'jur_inc', 'fun_inc'].map(c => D.rows.filter(r => r.year === 2027 && r.layer === c).reduce((s, r) => s + r.nominal, 0));
  close(tot[0], tot[1]); close(tot[0], tot[2]); close(tot[0], Number(D.meta.sources.find(s => s.periodo === 2027).total_nominal));
});
t('2027: pickRows usa una sola capa por año (no triplica el total)', () => {
  close(M.totalsOf(R(), 2027).nominal, Number(D.meta.sources.find(s => s.periodo === 2027).total_nominal));
  for (const need of [['jur'], ['fun'], ['inc'], ['jur', 'inc'], ['fun', 'inc'], ['jur', 'fun']]) {
    const p = M.pickRows(D, need); const ls = new Set(p.rows.filter(r => r.year === 2027).map(r => r.layer));
    assert.strictEqual(ls.size, 1, need + ': ' + [...ls]); assert.deepStrictEqual(p.missing, []);
  }
});
t('2027: capa elegida contiene las dimensiones pedidas', () => {
  assert.strictEqual(M.layerFor(D, 2027, ['jur', 'inc']), 'jur_inc');
  assert.strictEqual(M.layerFor(D, 2027, ['fun', 'inc']), 'fun_inc');
  assert.strictEqual(M.layerFor(D, 2027, ['jur', 'fun']), 'jur_fun');
  assert.strictEqual(M.layerFor(D, 2026, ['jur', 'fun', 'inc', 'geo']), 'grano');
});
t('2027: sin comunas ni cruce triple → año faltante, no ceros', () => {
  assert.deepStrictEqual(M.missingYears(D, ['geo']), [2027]);
  assert.deepStrictEqual(M.missingYears(D, ['jur', 'fun', 'inc']), [2027]);
  assert.strictEqual(M.pickRows(D, ['geo']).rows.some(r => r.year === 2027), false);
});
t('2027: los subtotales coinciden entre cruces (jur, fun, inc)', () => {
  for (const [d, c1, c2] of [['jur', 'jur_fun', 'jur_inc'], ['fun', 'jur_fun', 'fun_inc'], ['inc', 'jur_inc', 'fun_inc']]) {
    const sum = c => { const m = new Map(); for (const r of D.rows) if (r.year === 2027 && r.layer === c) m.set(r[d], (m.get(r[d]) || 0) + r.nominal); return m; };
    const a = sum(c1), b = sum(c2); for (const k of new Set([...a.keys(), ...b.keys()])) close(a.get(k) || 0, b.get(k) || 0);
  }
});
t('2027: filtro jurisdicción + agrupar por inciso = cruce Jur × Inciso', () => {
  const f = M.applyFilters(R('jur', 'inc'), { jur: '40' });
  const x = M.compare(f, 2026, 2027, ['inc']).totals;
  const s = M.compare(R('jur'), 2026, 2027, ['jur']).items.find(i => i.key === '40');
  close(x.comp.nominal, s.comp.nominal); close(x.base.nominal, s.base.nominal);
});
t('evolución con 2027: acumulada del total 2023 → 2027 = variación directa', () => {
  const e = M.evolution(R(), D.years, [])[0];
  const d = M.compare(R(), 2023, 2027, []).totals;
  close(e.real.total, d.real.pct, 1e-9); assert.strictEqual(e.lastYear, 2027);
});

console.log(`\n${pass} ok, ${fail} con error`);
process.exit(fail ? 1 : 0);
