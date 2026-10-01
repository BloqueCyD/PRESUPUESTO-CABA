/* test_ingresos.js — pruebas de la pestaña Ingresos (Node, sin dependencias).
 * Uso: node test_ingresos.js   (primero: python3 build_ingresos.py) */
'use strict';
const fs = require('fs');
const path = require('path');
const I = require('./ingresos.js');

let ok = 0, bad = 0;
function t(name, fn) { try { fn(); ok++; console.log('  ✓ ' + name); } catch (e) { bad++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} esperado ${b}, obtenido ${a}`); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m || ''} esperado ≈${b}, obtenido ${a}`); };

const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'ingresos.json'), 'utf8'));
const D = I.decode(json);
const C = I.compare(D.recursos);
const by = id => C.items.find(i => i.id === id);

// CSV leído directamente, para comparar sin pasar por el build.
const csv = fs.readFileSync(path.join(__dirname, 'fuentes', 'ingresos_tributarios_caba_2026_2027.csv'), 'utf8').replace(/^\uFEFF/, '');
function parseCSV(s) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  const [h, ...rs] = out.filter(r => r.length > 1);
  return rs.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const rows = parseCSV(csv);

console.log('Ingresos');
t('9 recursos, cada uno con 2026 y 2027', () => { eq(D.recursos.length, 9); eq(rows.length, 18); });
t('Montos idénticos a las columnas monto_nominal y monto_real_2027 del CSV', () => {
  for (const r of rows) {
    const it = D.recursos.find(x => x.id === r.recurso_id);
    eq(it.nombre, r.recurso, 'nombre');
    eq(it.v[+r.anio].nominal, +r.monto_nominal, r.recurso_id + ' nominal');
    eq(it.v[+r.anio].real, +r.monto_real_2027, r.recurso_id + ' real');
  }
});
t('Bases: 2026 Vigente al 30/06/2026, 2027 Proyecto de Ley', () => { eq(D.meta.bases['2026'], 'Vigente al 30/06/2026'); eq(D.meta.bases['2027'], 'Proyecto de Ley'); });
t('Deflactores: IPC 2501,96 y 3020,12; factor 1,2071016323', () => {
  eq(D.meta.ipc_average['2026'], 2501.96); eq(D.meta.ipc_average['2027'], 3020.12);
  eq(Number(D.meta.factor_a_precios_2027['2026'].toFixed(10)), 1.2071016323); eq(D.meta.factor_a_precios_2027['2027'], 1);
});
t('Ingresos Brutos 2026 = $10.938.684.600.000', () => eq(by('IIBB').v[2026].nominal, 10938684600000));
t('Ingresos Brutos 2027 = $13.279.892.300.000', () => eq(by('IIBB').v[2027].nominal, 13279892300000));
t('Ingresos Brutos: variación real ≈ +0,6 %', () => { near(by('IIBB').real.pct, 0.6, 0.05); near(by('IIBB').real.pct, 0.573975, 1e-5); });
t('Fórmula (v2027 / v2026 − 1) × 100 en los dos modos, igual a la del CSV', () => {
  for (const r of rows.filter(r => r.anio === '2027')) {
    const it = by(r.recurso_id);
    eq(it.nominal.pct, (it.v[2027].nominal / it.v[2026].nominal - 1) * 100);
    eq(it.real.pct, (it.v[2027].real / it.v[2026].real - 1) * 100);
    near(it.nominal.pct, +r.variacion_nominal_vs_2026_pct, 1e-5, r.recurso_id);
    near(it.real.pct, +r.variacion_real_vs_2026_pct, 1e-5, r.recurso_id);
  }
});
t('Total = suma de los recursos', () => {
  for (const y of [2026, 2027]) for (const m of ['nominal', 'real'])
    eq(C.total.v[y][m], rows.filter(r => +r.anio === y).reduce((s, r) => s + +r[m === 'real' ? 'monto_real_2027' : 'monto_nominal'], 0));
});
t('Orden: mayor aumento real', () => {
  const s = I.sortItems(C.items, 'aumento_real', 'nominal', 2027).map(i => i.real.pct);
  for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1]) throw new Error('no descendente');
});
t('Orden: mayor caída real (Vehículos primero)', () => {
  const s = I.sortItems(C.items, 'caida_real', 'real', 2027);
  eq(s[0].id, 'VEHICULOS');
  for (let i = 1; i < s.length; i++) if (s[i].real.pct < s[i - 1].real.pct) throw new Error('no ascendente');
});
t('Orden: mayor cambio en pesos (valor absoluto, según el modo)', () => {
  for (const m of ['nominal', 'real']) {
    const s = I.sortItems(C.items, 'cambio_pesos', m, 2027).map(i => Math.abs(i[m].abs));
    for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1]) throw new Error(m);
  }
  eq(I.sortItems(C.items, 'cambio_pesos', 'nominal', 2027)[0].id, 'IIBB');
  eq(I.sortItems(C.items, 'cambio_pesos', 'real', 2027)[0].id, 'VEHICULOS');
});
t('Orden: mayor monto (año y modo elegidos)', () => {
  for (const y of [2026, 2027]) for (const m of ['nominal', 'real']) {
    const s = I.sortItems(C.items, 'monto', m, y).map(i => i.v[y][m]);
    for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1]) throw new Error(`${y} ${m}`);
  }
});
t('Variación con base cero: No aplica (null)', () => eq(I.pctChange(0, 5), null));
t('La advertencia metodológica está en index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  if (!html.includes('La comparación enfrenta recursos vigentes al 30/06/2026 con los recursos proyectados para 2027. No son montos de recaudación efectivamente percibida.')) throw new Error('falta el texto');
});
console.log(`\n${ok} ok, ${bad} con error`);
process.exit(bad ? 1 : 0);
