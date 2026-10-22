// test_programas.js — pruebas de la pestaña Programas (Node, sin dependencias).
// Uso: node test_programas.js
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./programas.js');

const here = f => path.join(__dirname, f);
const json = JSON.parse(fs.readFileSync(here('programas.json'), 'utf8'));
const gastos = JSON.parse(fs.readFileSync(here('presupuesto.json'), 'utf8'));
const D = P.decode(json);

let ok = 0, bad = 0;
function t(name, fn) {
  try { fn(); ok++; console.log('  ✓ ' + name); } catch (e) { bad++; console.log('  ✗ ' + name + ': ' + e.message); }
}
const eq = (a, b, tol = 0.01, msg = '') => { if (Math.abs(a - b) > tol) throw new Error(`${msg} ${a} ≠ ${b}`); };

// Totales del tablero de gastos (2026: rows; 2027: cruce Jur × Inciso).
const per = gastos.dimensions.periodos, J = gastos.dimensions.jurisdicciones;
const g26 = {}, g27 = {};
for (const r of gastos.rows) if (per[r[0]] === 2026) g26[J[r[1]].id] = (g26[J[r[1]].id] || 0) + r[5];
for (const r of gastos.rows_cruces) if (per[r[0]] === 2027 && r[1] === 'jur_inc') g27[J[r[2]].id] = (g27[J[r[2]].id] || 0) + r[5];
const F = gastos.meta.factor_a_precios_2027['2026'];

t('factor = el de presupuesto.json', () => eq(D.F, F, 1e-15));
t('total del gasto comparable = totales de gastos 2026 y 2027', () => {
  const c = P.compare(D.progs, D.F, '');
  eq(c.total.v26, Object.values(g26).reduce((s, v) => s + v, 0));
  eq(c.total.p27, Object.values(g27).reduce((s, v) => s + v, 0));
});
t('cada jurisdicción coincide al peso con presupuesto.json', () => {
  for (const j of D.jurisdicciones) {
    const c = P.compare(D.progs, D.F, j.id);
    eq(c.total.v26, g26[j.id] || 0, 0.01, j.id + ' 2026');
    eq(c.total.p27, g27[j.id] || 0, 0.01, j.id + ' 2027');
  }
});
t('variación real total = la del tablero de gastos (B − A × factor, pesos de 2027)', () => {
  const c = P.compare(D.progs, D.F, '');
  let r26 = 0;
  for (const r of gastos.rows) if (per[r[0]] === 2026) r26 += r[6];
  eq(c.total.real.abs, c.total.p27 - r26, 1);
  eq(c.total.real.pct, (c.total.p27 / r26 - 1) * 100, 1e-9);
});
t('las filas fuera del gasto comparable no entran en los totales', () => {
  const c = P.compare(D.progs, D.F, '');
  if (c.items.some(i => i.estado === 'fuera')) throw new Error('hay filas fuera en items');
  if (c.fuera.length !== 2) throw new Error('se esperaban 2 filas fuera, hay ' + c.fuera.length);
});
t('los aportes suman la variación % del recorte (todas y cada jurisdicción, en los dos modos)', () => {
  for (const jur of [''].concat(D.jurisdicciones.map(j => j.id))) {
    const c = P.compare(D.progs, D.F, jur);
    for (const m of ['nominal', 'real']) {
      if (c.total[m].pct == null) continue;
      eq(c.items.reduce((s, i) => s + i.aporte[m], 0), c.total[m].pct, 1e-8, `${jur || 'todas'} ${m}`);
    }
  }
});
t('montos nominales del CSV publicados sin cambios (suma de fuentes = proyecto 2027)', () => {
  for (const p of D.progs) if (p.fte && p.fte.reduce((s, v) => s + v, 0) !== p.p27) throw new Error(p.key);
});
t('fuentes del recorte suman el proyecto 2027 comparable', () => {
  const c = P.compare(D.progs, D.F, '');
  eq(c.fuentes.reduce((s, v) => s + v, 0), c.total.p27);
});
t('estados: 412 continúan, 8 nuevos, 59 suprimidos, 2 fuera', () => {
  const n = {}; for (const p of D.progs) n[p.estado] = (n[p.estado] || 0) + 1;
  if (n.continua !== 412 || n.nuevo !== 8 || n.suprimido !== 59 || n.fuera !== 2) throw new Error(JSON.stringify(n));
});
t('programas nuevos: porcentaje "No aplica" (sin base 2026)', () => {
  const c = P.compare(D.progs, D.F, '');
  for (const i of c.items.filter(x => x.estado === 'nuevo')) if (i.nominal.pct !== null || i.real.pct !== null) throw new Error(i.key);
});
t('rankings sólo con programas que continúan y ordenados por cambio en pesos', () => {
  const c = P.compare(D.progs, D.F, '');
  for (const m of ['nominal', 'real']) {
    const R = P.rankings(c.items, m, 10);
    for (const i of R.up.concat(R.down)) if (i.estado !== 'continua') throw new Error(i.key);
    for (let k = 1; k < R.up.length; k++) if (R.up[k][m].abs > R.up[k - 1][m].abs) throw new Error('orden up');
    for (let k = 1; k < R.down.length; k++) if (R.down[k][m].abs < R.down[k - 1][m].abs) throw new Error('orden down');
  }
});
t('todos los órdenes de la tabla funcionan', () => {
  const c = P.compare(D.progs, D.F, '55');
  for (const o of P.ORDERS) if (P.sortItems(c.items, o, 'real').length !== c.items.length) throw new Error(o);
});

console.log(`\n${ok} ok, ${bad} con error`);
process.exit(bad ? 1 : 0);
