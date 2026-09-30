/* app.js — Comparación presupuestaria (CABA).
 * Consume presupuesto.json (schema_version 2) generado por build_data.py.
 * Los montos reales llegan precalculados; acá sólo se suman y se comparan.
 */
(function () {
  'use strict';
  const M = window.Metrics;
  let D = null;                 // datos decodificados
  let chart = null;             // instancia Chart.js de composición

  const DIM_NAME = { jur: 'Jurisdicción', fun: 'Función', inc: 'Inciso' };
  const CROSSES = { jur_inc: ['jur', 'inc'], fun_inc: ['fun', 'inc'], jur_fun: ['jur', 'fun'] };
  const CROSS_NAME = { jur_inc: 'Jurisdicción × Inciso', fun_inc: 'Función × Inciso', jur_fun: 'Jurisdicción × Función' };
  const PALETTE = ['#B4791E', '#1F5C57', '#A23B2E', '#445066', '#6C7A4C', '#7E8FA6', '#C9A03F', '#2E6B4F', '#8B4A3B'];
  const REST_COLOR = '#C8C2B0';

  const state = {
    base: null, mode: 'real',
    filters: { jur: '', fun: '', inc: '' },
    rankDim: 'jur', rankOrder: 'abs',
    compDim: 'jur',
    cross: 'jur_inc', crossSearch: '', crossTop: '15', crossSort: 'abs', crossSel: null,
    tableDim: 'jur', tableSearch: '', tableTop: 'all', tableZero: false, tableSort: { col: 'abs', dir: 'desc' },
  };

  const $ = id => document.getElementById(id);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /* ---------------- formato ---------------- */
  const nf = (n, d) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MINUS = '−';
  function sign(n) { return n > 0 ? '+' : n < 0 ? MINUS : ''; }
  function fmtFull(n) { return (n < 0 ? MINUS : '') + '$ ' + Math.round(Math.abs(n)).toLocaleString('es-AR'); }
  function fmtAbbrev(n) {
    const a = Math.abs(n), s = n < 0 ? MINUS : '';
    if (a >= 1e12) return s + '$ ' + nf(a / 1e12, 2) + ' billones';
    if (a >= 1e9) return s + '$ ' + nf(a / 1e9, 1) + ' mil M';
    if (a >= 1e6) return s + '$ ' + nf(a / 1e6, 1) + ' M';
    return fmtFull(n);
  }
  function fmtSignedAbbrev(n) { return (n > 0 ? '+' : '') + fmtAbbrev(n); }
  function fmtPctSigned(p) { return p == null ? 'No aplica' : sign(p) + nf(Math.abs(p), 1) + ' %'; }
  function fmtPctPlain(p) { return (p < 0 ? MINUS : '') + nf(Math.abs(p), 1) + ' %'; }
  function fmtShare(p) { return p == null ? '—' : nf(p * 100, 1) + ' %'; }
  function fmtPP(p) { return p == null ? '—' : sign(p) + nf(Math.abs(p), 1) + ' pp'; }
  function arrow(n) { return n > 0 ? '▲' : n < 0 ? '▼' : '='; }
  function dirClass(n) { return n > 0 ? 'up-text' : n < 0 ? 'down-text' : ''; }

  /* ---------------- vocabulario de años ---------------- */
  const compYear = () => D.meta.compared_year;
  const typeName = y => D.typeOf[y] === 'proyecto' ? 'Proyecto' : 'Vigente';
  const yearLabel = y => D.typeOf[y] === 'proyecto' ? 'Proyecto ' + y : 'Vigente ' + y;
  const versionOf = y => (D.meta.periods.find(p => p.periodo === y) || {}).version_fuente;
  function unitLong(mode) {
    return (mode || state.mode) === 'real'
      ? 'Real: pesos a precios de ' + D.meta.price_base
      : 'Nominal: pesos corrientes de cada año';
  }
  const unitShort = mode => (mode || state.mode) === 'real' ? 'real, $ de ' + D.meta.price_base : 'nominal, $ corrientes';
  const labelOf = (dim, key) => D.label[dim][key] || key;
  const partsLabel = (dims, parts) => dims.map((d, i) => labelOf(d, parts[i])).join(' / ');
  const ESTADO = { nueva: 'Nueva en ', eliminada: 'Sin asignación en ', continua: 'Continúa', sin_movimiento: 'Sin movimiento' };
  const estadoText = e => (e === 'nueva' || e === 'eliminada') ? ESTADO[e] + compYear() : ESTADO[e];

  /* ---------------- datos filtrados ---------------- */
  let cache = null;
  function filtered() {
    if (!cache) cache = { rows: M.applyFilters(D.rows, state.filters), cmp: {} };
    return cache.rows;
  }
  function cmp(dims) {
    filtered();
    const k = dims.join('_');
    if (!cache.cmp[k]) cache.cmp[k] = M.compare(cache.rows, state.base, compYear(), dims);
    return cache.cmp[k];
  }

  /* ---------------- URL ---------------- */
  function readURL() {
    const p = new URLSearchParams(location.search);
    const b = parseInt(p.get('base'), 10);
    if (D.years.includes(b) && b < compYear()) state.base = b;
    if (p.get('modo') === 'nominal' || p.get('modo') === 'real') state.mode = p.get('modo');
    for (const d of ['jur', 'fun', 'inc']) if (p.get(d) && D.label[d][p.get(d)]) state.filters[d] = p.get(d);
    if (['jur', 'fun', 'inc'].includes(p.get('dim'))) state.rankDim = p.get('dim');
    if (CROSSES[p.get('cruce')]) state.cross = p.get('cruce');
  }
  function writeURL() {
    const p = new URLSearchParams();
    p.set('base', state.base); p.set('modo', state.mode);
    for (const d of ['jur', 'fun', 'inc']) if (state.filters[d]) p.set(d, state.filters[d]);
    if (state.rankDim !== 'jur') p.set('dim', state.rankDim);
    if (state.cross !== 'jur_inc') p.set('cruce', state.cross);
    try { history.replaceState(null, '', location.pathname + '?' + p.toString() + location.hash); } catch (e) { /* entornos sin history */ }
  }

  /* ---------------- controles ---------------- */
  function buildControls() {
    const bs = $('base-year');
    bs.innerHTML = D.years.filter(y => y < compYear()).map(y => `<option value="${y}">${yearLabel(y)}</option>`).join('');
    bs.value = state.base;
    bs.addEventListener('change', () => { state.base = +bs.value; state.crossSel = null; update(); });

    $('mode-seg').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]'); if (!b) return;
      state.mode = b.dataset.mode; update();
    });
    $('mode-seg').addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      state.mode = state.mode === 'real' ? 'nominal' : 'real'; update();
      $('mode-seg').querySelector(`[data-mode="${state.mode}"]`).focus();
    });

    for (const d of ['jur', 'fun', 'inc']) {
      $('f-' + d).addEventListener('change', e => { state.filters[d] = e.target.value; state.crossSel = null; update(); });
    }
    $('clear-filters').addEventListener('click', () => { state.filters = { jur: '', fun: '', inc: '' }; state.crossSel = null; update(); });

    $('rank-dim').addEventListener('change', e => { state.rankDim = e.target.value; update(); });
    $('rank-order').addEventListener('change', e => { state.rankOrder = e.target.value; update(); });

    bindTabs('comp-tabs', 'dim', v => { state.compDim = v; });
    bindTabs('cross-tabs', 'cross', v => { state.cross = v; state.crossSel = null; });

    $('cross-search').addEventListener('input', e => { state.crossSearch = e.target.value; renderCross(); });
    $('cross-top').addEventListener('change', e => { state.crossTop = e.target.value; renderCross(); });
    $('cross-sort').addEventListener('change', e => { state.crossSort = e.target.value; renderCross(); });

    $('table-dim').addEventListener('change', e => { state.tableDim = e.target.value; renderTable(); });
    $('table-search').addEventListener('input', e => { state.tableSearch = e.target.value; renderTable(); });
    $('table-top').addEventListener('change', e => { state.tableTop = e.target.value; renderTable(); });
    $('table-zero').addEventListener('change', e => { state.tableZero = e.target.checked; renderTable(); });
    $('export-csv').addEventListener('click', exportCSV);
  }

  function bindTabs(id, attr, set) {
    const wrap = $(id);
    const btns = [...wrap.querySelectorAll('button')];
    wrap.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      set(b.dataset[attr]); update();
    });
    wrap.addEventListener('keydown', e => {
      const i = btns.indexOf(document.activeElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); n.click();
    });
  }

  function syncControls() {
    $('base-year').value = state.base;
    for (const b of $('mode-seg').querySelectorAll('button')) {
      const on = b.dataset.mode === state.mode;
      b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1;
    }
    for (const b of $('comp-tabs').querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.dim === state.compDim);
    for (const b of $('cross-tabs').querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.cross === state.cross);
    $('rank-dim').value = state.rankDim; $('rank-order').value = state.rankOrder;

    // Opciones de filtro: claves con monto en el año base o en el comparado.
    const present = { jur: new Set(), fun: new Set(), inc: new Set() };
    for (const r of D.rows) {
      if ((r.year === state.base || r.year === compYear()) && r.nominal !== 0) {
        present.jur.add(r.jur); present.fun.add(r.fun); present.inc.add(r.inc);
      }
    }
    const opt = (d, x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`;
    const fill = (d, list, allLabel) => {
      const sel = $('f-' + d);
      const cur = state.filters[d];
      let html = `<option value="">${allLabel}</option>`;
      if (d === 'fun') {
        const groups = new Map();
        for (const x of list) {
          if (!present.fun.has(x.id) && x.id !== cur) continue;
          if (!groups.has(x.fin_label)) groups.set(x.fin_label, []);
          groups.get(x.fin_label).push(x);
        }
        for (const [g, xs] of groups) html += `<optgroup label="${esc(g)}">${xs.map(x => opt(d, x)).join('')}</optgroup>`;
      } else {
        html += list.filter(x => present[d].has(x.id) || x.id === cur)
          .sort((a, b) => a.label.localeCompare(b.label, 'es')).map(x => opt(d, x)).join('');
      }
      sel.innerHTML = html; sel.value = cur;
    };
    fill('jur', D.dims.jurisdicciones, 'Todas');
    fill('fun', D.dims.funciones, 'Todas');
    fill('inc', D.dims.incisos, 'Todos');
  }

  /* ---------------- encabezado y KPIs ---------------- */
  function renderHeader() {
    const c = compYear();
    const title = `${yearLabel(c)} vs. ${yearLabel(state.base)}`;
    $('page-title').textContent = D.typeOf[c] === 'proyecto' ? `Proyecto Presupuesto ${c} vs. Vigente ${state.base}` : title;
    document.title = $('page-title').textContent + ' · Presupuesto CABA';
    $('mode-badge').textContent = state.mode === 'real' ? `Real, a precios de ${D.meta.price_base}` : 'Nominal, pesos corrientes';
    $('pending-note').hidden = !!D.meta.proyecto_2027_disponible;
    document.querySelectorAll('.js-comp-year').forEach(e => { e.textContent = c; });
    document.querySelectorAll('.js-comp-version').forEach(e => { e.textContent = versionOf(c) || ''; });
    document.querySelectorAll('.js-unit').forEach(e => { e.textContent = unitLong() + '. Ordenado por cambio ' + (state.rankOrder === 'pct' ? 'porcentual' : 'absoluto') + '.'; });
  }

  function renderKPIs() {
    const { totals } = cmp(['jur']);
    const m = state.mode, o = m === 'real' ? 'nominal' : 'real';
    const c = compYear(), b = state.base;
    const empty = totals.base.nominal === 0 && totals.comp.nominal === 0;
    const card = (cls, label, value, sub) =>
      `<div class="kpi ${cls}"><p class="label">${label}</p><p class="value">${value}</p>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;
    const vr = totals.real, vn = totals.nominal;
    $('kpi-grid').innerHTML = [
      card('', `${yearLabel(b)} <span class="muted">(${unitShort()})</span>`, fmtAbbrev(totals.base[m]),
        `${o === 'real' ? 'Real' : 'Nominal'}: ${fmtAbbrev(totals.base[o])} · fuente ${esc(versionOf(b) || '')}`),
      card('', `${yearLabel(c)} <span class="muted">(${unitShort()})</span>`, fmtAbbrev(totals.comp[m]),
        `${o === 'real' ? 'Real' : 'Nominal'}: ${fmtAbbrev(totals.comp[o])} · fuente ${esc(versionOf(c) || '')}`),
      card('', 'Variación nominal <span class="muted">($ corrientes)</span>',
        `<span class="${dirClass(vn.abs)}">${fmtPctSigned(vn.pct)}</span>`, fmtSignedAbbrev(vn.abs)),
      card('lead', `Variación real <span class="muted">($ de ${D.meta.price_base})</span>`,
        `<span class="${dirClass(vr.abs)}">${vr.pct == null ? 'No aplica' : arrow(vr.abs) + ' ' + fmtPctSigned(vr.pct)}</span>`, fmtSignedAbbrev(vr.abs)),
    ].join('');

    const recorte = activeFilterText();
    const subj = D.typeOf[c] === 'proyecto' ? `El Proyecto ${c}` : `El Vigente ${c}`;
    $('synthesis').textContent = empty
      ? 'No hay montos para este recorte en ninguno de los dos años. Probá quitar algún filtro.'
      : vr.pct == null
        ? `${subj} tiene ${fmtAbbrev(totals.comp.real)} (a precios de ${D.meta.price_base}) y el Vigente ${b} no tiene asignación en este recorte, así que la variación porcentual no aplica.`
        : `${subj} representa una variación real de ${fmtPctSigned(vr.pct)} respecto del Vigente ${b}${recorte ? ' en este recorte' : ''}.`;
    $('filter-line').hidden = !recorte;
    $('filter-line').textContent = recorte ? 'Recorte aplicado a ambos años: ' + recorte + '.' : '';
  }

  function activeFilterText() {
    return ['jur', 'fun', 'inc'].filter(d => state.filters[d])
      .map(d => `${DIM_NAME[d]} = ${labelOf(d, state.filters[d])}`).join('; ');
  }

  /* ---------------- rankings ---------------- */
  function renderRankings() {
    const dim = state.rankDim, m = state.mode, ord = state.rankOrder;
    const { items } = cmp([dim]);
    const R = M.rankings(items, m, ord, 10);
    $('pct-warning').hidden = ord !== 'pct';
    const val = i => ord === 'pct' ? i[m].pct : i[m].abs;
    const max = Math.max(1e-9, ...R.up.map(i => Math.abs(val(i))), ...R.down.map(i => Math.abs(val(i))));
    const li = (i, dir) => {
      const w = Math.max(1.5, Math.abs(val(i)) / max * 100);
      const name = labelOf(dim, i.parts[0]);
      return `<li class="rank-item">
        <span class="ri-name">${esc(name)}${i.negativo ? '<span class="flag">revisar: monto negativo</span>' : ''}</span>
        <span class="ri-bar" aria-hidden="true"><span class="${dir}" style="width:${w}%"></span></span>
        <span class="ri-figs">
          <span class="${dirClass(i[m].abs)}"><strong>${arrow(i[m].abs)} ${fmtSignedAbbrev(i[m].abs)}</strong> (${fmtPctSigned(i[m].pct)})</span>
          <span>${state.base}: ${fmtAbbrev(i.base[m])} → ${compYear()}: ${fmtAbbrev(i.comp[m])}</span>
          <span>Participación ${fmtShare(i[m].partBase)} → ${fmtShare(i[m].partComp)}</span>
        </span></li>`;
    };
    const emptyMsg = t => `<li class="empty">${t}</li>`;
    $('rank-up').innerHTML = R.up.length ? R.up.map(i => li(i, 'up')).join('') : emptyMsg('Ninguna categoría aumenta en este recorte.');
    $('rank-down').innerHTML = R.down.length ? R.down.map(i => li(i, 'down')).join('') : emptyMsg('Ninguna categoría cae en este recorte.');
    $('up-count').textContent = R.upCount > 10 ? `(10 de ${R.upCount})` : `(${R.upCount})`;
    $('down-count').textContent = R.downCount > 10 ? `(10 de ${R.downCount})` : `(${R.downCount})`;
    const pl = (list, side) => list.length
      ? list.map(i => `<li><span>${esc(labelOf(dim, i.parts[0]))}</span><span class="amt">${side === 'comp' ? compYear() : state.base}: ${fmtAbbrev(i[side][m])}</span></li>`).join('')
      : `<li class="empty">Ninguna.</li>`;
    $('rank-new').innerHTML = pl(R.nuevas, 'comp');
    $('rank-gone').innerHTML = pl(R.eliminadas, 'base');
    $('new-count').textContent = `(${R.nuevas.length})`;
    $('gone-count').textContent = `(${R.eliminadas.length})`;
  }

  /* ---------------- composición ---------------- */
  function renderComposition() {
    const dim = state.compDim, m = state.mode;
    const { items, totals } = cmp([dim]);
    const list = items.filter(i => i.estado !== 'sin_movimiento')
      .sort((a, b) => (b.comp[m] || 0) - (a.comp[m] || 0) || (b.base[m] - a.base[m]));
    const shareMax = i => Math.max(i[m].partBase || 0, i[m].partComp || 0);
    const top = [...list].sort((a, b) => shareMax(b) - shareMax(a)).slice(0, PALETTE.length);
    const topKeys = new Set(top.map(i => i.key));
    const color = new Map(top.map((i, k) => [i.key, PALETTE[k]]));
    const rest = list.filter(i => !topKeys.has(i.key));

    const tb = totals.base[m], tc = totals.comp[m];
    const pct = (v, t) => t ? v / t * 100 : 0;
    const datasets = top.map(i => ({
      label: labelOf(dim, i.parts[0]), backgroundColor: color.get(i.key), borderColor: '#fff', borderWidth: 1,
      data: [pct(i.base[m], tb), pct(i.comp[m], tc)], _amt: [i.base[m], i.comp[m]],
    }));
    if (rest.length) {
      const rb = rest.reduce((s, i) => s + i.base[m], 0), rc = rest.reduce((s, i) => s + i.comp[m], 0);
      datasets.push({ label: `Resto (${rest.length} categorías)`, backgroundColor: REST_COLOR, borderColor: '#fff', borderWidth: 1,
        data: [pct(rb, tb), pct(rc, tc)], _amt: [rb, rc] });
    }
    const box = $('comp-chart').parentElement;
    if (typeof Chart === 'undefined') {
      box.innerHTML = '<p class="empty">No se pudo cargar la librería de gráficos. La tabla tiene los mismos datos.</p>';
    } else if (!tb && !tc) {
      if (chart) { chart.destroy(); chart = null; }
      $('comp-chart').hidden = true;
    } else {
      $('comp-chart').hidden = false;
      const cfg = {
        type: 'bar',
        data: { labels: [yearLabel(state.base), yearLabel(compYear())], datasets },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.raw, 1)} % (${fmtAbbrev(c.dataset._amt[c.dataIndex])}, ${unitShort()})` } },
          },
          scales: {
            x: { stacked: true, min: 0, max: 100, ticks: { callback: v => v + ' %', font: { family: 'IBM Plex Mono', size: 10 } },
              title: { display: true, text: 'Participación en el total del año (%)', font: { family: 'Source Sans 3', size: 11 }, color: '#4B5462' },
              grid: { color: '#E4E0D2' } },
            y: { stacked: true, ticks: { font: { family: 'Source Sans 3', size: 12, weight: '600' } }, grid: { display: false } },
          },
        },
      };
      if (chart) chart.destroy();
      chart = new Chart($('comp-chart').getContext('2d'), cfg);
    }

    const rows = list.map(i => `<tr>
      <td class="label" title="${esc(labelOf(dim, i.parts[0]))}"><span class="swatch" style="background:${color.get(i.key) || REST_COLOR}"></span>${esc(labelOf(dim, i.parts[0]))}</td>
      <td class="num">${fmtShare(i[m].partBase)}</td><td class="num">${fmtShare(i[m].partComp)}</td>
      <td class="num ${dirClass(i[m].pp)}">${i[m].pp == null ? '—' : arrow(i[m].pp) + ' ' + fmtPP(i[m].pp)}</td>
      <td><span class="estado ${i.estado}">${estadoText(i.estado)}</span></td></tr>`).join('');
    $('comp-table').innerHTML = `<thead><tr><th>${DIM_NAME[dim]}</th><th class="num">${yearLabel(state.base)}</th><th class="num">${yearLabel(compYear())}</th><th class="num">Cambio</th><th>Estado</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">Sin datos para este recorte.</td></tr>'}</tbody>`;
  }

  /* ---------------- cruces ---------------- */
  function heat(v, max) {
    if (!v || !max) return { bg: 'transparent', fg: 'inherit' };
    const t = Math.sqrt(Math.min(1, Math.abs(v) / max));
    const [r, g, b] = v > 0 ? [31, 92, 87] : [162, 59, 46];
    const a = 0.08 + 0.82 * t;
    return { bg: `rgba(${r},${g},${b},${a.toFixed(3)})`, fg: a > 0.55 ? '#fff' : 'var(--ink)' };
  }

  function renderCross() {
    const [ra, cb] = CROSSES[state.cross];
    const m = state.mode;
    const cross = cmp([ra, cb]);
    const rowsT = cmp([ra]).items, colsT = cmp([cb]).items;
    const totalAbs = cmp([ra]).totals[m].abs;
    $('cross-unit').textContent = `Cada celda muestra la variación ${m === 'real' ? 'real (pesos de ' + D.meta.price_base + ')' : 'nominal (pesos corrientes)'} entre ${yearLabel(state.base)} y ${yearLabel(compYear())}. Filas: ${DIM_NAME[ra]}. Columnas: ${DIM_NAME[cb]}.`;

    const cellMap = new Map(cross.items.map(i => [i.key, i]));
    const q = fold(state.crossSearch.trim());
    let rows = rowsT.filter(i => i.estado !== 'sin_movimiento' && (!q || fold(labelOf(ra, i.parts[0])).includes(q)));
    const sorters = {
      abs: (a, b) => Math.abs(b[m].abs) - Math.abs(a[m].abs),
      up: (a, b) => b[m].abs - a[m].abs,
      down: (a, b) => a[m].abs - b[m].abs,
      label: (a, b) => labelOf(ra, a.parts[0]).localeCompare(labelOf(ra, b.parts[0]), 'es'),
    };
    rows.sort(sorters[state.crossSort]);
    const nRows = rows.length;
    if (state.crossTop !== 'all') rows = rows.slice(0, +state.crossTop);
    const order = D.dims[cb === 'inc' ? 'incisos' : 'funciones'].map(x => x.id);
    const cols = colsT.filter(i => i.estado !== 'sin_movimiento').sort((a, b) => order.indexOf(a.parts[0]) - order.indexOf(b.parts[0]));

    let max = 0;
    for (const r of rows) for (const c of cols) {
      const it = cellMap.get(r.parts[0] + '|' + c.parts[0]);
      if (it) max = Math.max(max, Math.abs(it[m].abs));
    }
    const ramp = [...Array(7)].map((_, k) => { const v = (k - 3) / 3 * max; return `<span style="background:${heat(v, max).bg}"></span>`; }).join('');
    $('cross-legend').innerHTML = `<span class="tag">Caída ▼</span><span class="ramp" aria-hidden="true">${ramp}</span><span class="tag">▲ Aumento</span>
      <span class="tag"><span class="cell nueva" style="display:inline-block;width:18px;min-height:12px;padding:0"></span> Nueva en ${compYear()}</span>
      <span class="tag"><span class="cell eliminada" style="display:inline-block;width:18px;min-height:12px;padding:0"></span> Sin asignación en ${compYear()}</span>
      <span>${rows.length} de ${nRows} filas</span>`;

    if (!rows.length || !cols.length) {
      $('matrix-wrap').innerHTML = '<p class="empty" style="padding:14px">Sin filas para este recorte o búsqueda.</p>';
      $('matrix-mobile').innerHTML = $('matrix-wrap').innerHTML;
      renderCellDetail(null, totalAbs);
      return;
    }

    const cellBtn = (it, rKey, cKey) => {
      if (!it || it.estado === 'sin_movimiento') return `<span class="cell empty-cell" aria-hidden="true">·</span>`;
      const v = it[m].abs, h = heat(v, max);
      const sel = state.crossSel && state.crossSel.cross === state.cross && state.crossSel.key === it.key;
      const second = it.estado === 'nueva' ? 'Nueva' : it.estado === 'eliminada' ? 'Sin asig.' : fmtPctSigned(it[m].pct);
      const aria = `${labelOf(ra, rKey)}, ${labelOf(cb, cKey)}: ${estadoText(it.estado)}, variación ${fmtSignedAbbrev(v)} (${fmtPctSigned(it[m].pct)}), ${unitShort()}`;
      return `<button type="button" class="cell ${it.estado}${sel ? ' is-selected' : ''}" data-key="${esc(it.key)}" style="background-color:${h.bg};color:${h.fg}" aria-label="${esc(aria)}" title="${esc(aria)}">${arrow(v)} ${fmtAbbrev(Math.abs(v))}<small>${second}</small></button>`;
    };
    const head = `<thead><tr><th class="corner">${DIM_NAME[ra]} \\ ${DIM_NAME[cb]}</th>${cols.map(c => `<th scope="col" title="${esc(labelOf(cb, c.parts[0]))}">${esc(labelOf(cb, c.parts[0]))}</th>`).join('')}<th scope="col">Total fila</th></tr></thead>`;
    const body = rows.map(r => `<tr><th scope="row">${esc(labelOf(ra, r.parts[0]))}</th>${cols.map(c => `<td>${cellBtn(cellMap.get(r.parts[0] + '|' + c.parts[0]), r.parts[0], c.parts[0])}</td>`).join('')}
      <td class="rowtotal"><span class="cell" style="cursor:default" title="${esc(fmtFull(r[m].abs))}"><span class="${dirClass(r[m].abs)}">${arrow(r[m].abs)} ${fmtAbbrev(Math.abs(r[m].abs))}</span><small>${fmtPctSigned(r[m].pct)}</small></span></td></tr>`).join('');
    $('matrix-wrap').innerHTML = `<table class="matrix">${head}<tbody>${body}</tbody></table>`;
    $('matrix-wrap').querySelectorAll('button.cell').forEach(b => b.addEventListener('click', () => {
      state.crossSel = { cross: state.cross, key: b.dataset.key };
      $('matrix-wrap').querySelectorAll('.is-selected').forEach(x => x.classList.remove('is-selected'));
      b.classList.add('is-selected');
      renderCellDetail(cellMap.get(b.dataset.key), totalAbs, rowsT.find(x => x.key === b.dataset.key.split('|')[0]));
    }));

    // Vista móvil: tabla jerárquica expandible.
    $('matrix-mobile').innerHTML = rows.map(r => {
      const kids = cols.map(c => cellMap.get(r.parts[0] + '|' + c.parts[0])).filter(it => it && it.estado !== 'sin_movimiento')
        .sort((a, b) => Math.abs(b[m].abs) - Math.abs(a[m].abs));
      return `<details><summary><span>${esc(labelOf(ra, r.parts[0]))}</span><span class="amt ${dirClass(r[m].abs)}">${arrow(r[m].abs)} ${fmtSignedAbbrev(r[m].abs)}</span></summary>
        <ul>${kids.map(it => `<li><span>${esc(labelOf(cb, it.parts[1]))}${it.estado !== 'continua' ? ` <span class="estado ${it.estado}">${estadoText(it.estado)}</span>` : ''}</span>
          <span class="amt ${dirClass(it[m].abs)}">${arrow(it[m].abs)} ${fmtSignedAbbrev(it[m].abs)}<br>${fmtPctSigned(it[m].pct)}</span></li>`).join('')}</ul></details>`;
    }).join('');

    const selIt = state.crossSel && state.crossSel.cross === state.cross ? cellMap.get(state.crossSel.key) : null;
    renderCellDetail(selIt, totalAbs, selIt ? rowsT.find(x => x.key === selIt.parts[0]) : null);
  }

  function renderCellDetail(it, totalAbs, rowIt) {
    const box = $('cell-detail');
    if (!it) { box.innerHTML = '<p class="muted">Elegí una celda para ver el detalle: base, comparado, cambio y contribución al cambio total.</p>'; return; }
    const [ra, cb] = CROSSES[state.cross], m = state.mode, o = m === 'real' ? 'nominal' : 'real';
    const rowShare = rowIt && rowIt[m].abs ? it[m].abs / rowIt[m].abs : null;
    box.innerHTML = `<h3>${esc(labelOf(ra, it.parts[0]))}<br><span class="muted" style="font-weight:500">${esc(labelOf(cb, it.parts[1]))}</span></h3>
      <p class="muted" style="margin:0 0 8px">${estadoText(it.estado)} · ${unitShort()}</p>
      <dl>
        <dt>${yearLabel(state.base)}</dt><dd>${fmtFull(it.base[m])}</dd>
        <dt>${yearLabel(compYear())}</dt><dd>${fmtFull(it.comp[m])}</dd>
        <dt>Cambio</dt><dd class="${dirClass(it[m].abs)}">${arrow(it[m].abs)} ${fmtFull(it[m].abs)}</dd>
        <dt>Cambio %</dt><dd>${fmtPctSigned(it[m].pct)}</dd>
        <dt>Contribución al cambio total</dt><dd>${it[m].contrib == null ? 'No aplica' : fmtPctPlain(it[m].contrib * 100)}</dd>
        <dt>Peso en el cambio de la fila</dt><dd>${rowShare == null ? 'No aplica' : fmtPctPlain(rowShare * 100)}</dd>
        <dt>${o === 'real' ? 'Real' : 'Nominal'}</dt><dd class="muted">${fmtAbbrev(it.base[o])} → ${fmtAbbrev(it.comp[o])}</dd>
      </dl>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Contribución = cambio de la celda ÷ cambio total del recorte (${fmtSignedAbbrev(totalAbs)}). Puede ser negativa o superar 100 % cuando otras partidas se mueven en sentido contrario.</p>`;
  }

  /* ---------------- tabla completa ---------------- */
  function tableDims() { return CROSSES[state.tableDim] || [state.tableDim]; }
  function tableRows() {
    const dims = tableDims(), m = state.mode;
    const { items, totals } = cmp(dims);
    const q = fold(state.tableSearch.trim());
    let rows = items.filter(i => (state.tableZero || i.estado !== 'sin_movimiento') && (!q || fold(partsLabel(dims, i.parts)).includes(q)));
    const { col, dir } = state.tableSort;
    const k = dir === 'asc' ? 1 : -1;
    const v = {
      label: i => partsLabel(dims, i.parts), base_nom: i => i.base.nominal, comp_nom: i => i.comp.nominal,
      base_real: i => i.base.real, comp_real: i => i.comp.real, abs: i => i[m].abs,
      pct: i => i[m].pct == null ? -Infinity : i[m].pct, pb: i => i[m].partBase ?? -1, pc: i => i[m].partComp ?? -1,
      pp: i => i[m].pp ?? -Infinity, estado: i => i.estado,
    }[col];
    rows.sort((a, b) => { const x = v(a), y = v(b); return (typeof x === 'string' ? x.localeCompare(y, 'es') : x - y) * k; });
    const shown = state.tableTop === 'all' ? rows : rows.slice(0, +state.tableTop);
    return { dims, rows, shown, totals };
  }

  function renderTable() {
    const { dims, rows, shown, totals } = tableRows();
    const m = state.mode, b = state.base, c = compYear(), pb = D.meta.price_base;
    $('table-unit').textContent = `Montos completos en pesos. "Variación" y "Cambio %" siguen el modo elegido (${unitLong()}). ${shown.length} de ${rows.length} filas.`;
    const cols = [
      ['label', dims.map(d => DIM_NAME[d]).join(' / '), false],
      ['base_nom', `${yearLabel(b)} nominal ($ corrientes)`, true],
      ['comp_nom', `${yearLabel(c)} nominal ($ corrientes)`, true],
      ['base_real', `${yearLabel(b)} real ($ de ${pb})`, true],
      ['comp_real', `${yearLabel(c)} real ($ de ${pb})`, true],
      ['abs', `Variación ${m === 'real' ? 'real' : 'nominal'}`, true],
      ['pct', `Cambio % ${m === 'real' ? 'real' : 'nominal'}`, true],
      ['pb', `Participación ${b}`, true], ['pc', `Participación ${c}`, true], ['pp', 'Cambio (pp)', true],
      ['estado', 'Estado', false],
    ];
    const s = state.tableSort;
    const head = `<thead><tr>${cols.map(([k, t, num]) => `<th class="${num ? 'num' : ''}" aria-sort="${s.col === k ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-col="${k}">${t}</button></th>`).join('')}</tr></thead>`;
    const body = shown.map(i => `<tr>
      <td class="label" title="${esc(partsLabel(dims, i.parts))}">${esc(partsLabel(dims, i.parts))}${i.negativo ? '<span class="flag">revisar: negativo</span>' : ''}</td>
      <td class="num">${fmtFull(i.base.nominal)}</td><td class="num">${fmtFull(i.comp.nominal)}</td>
      <td class="num">${fmtFull(i.base.real)}</td><td class="num">${fmtFull(i.comp.real)}</td>
      <td class="num ${dirClass(i[m].abs)}">${arrow(i[m].abs)} ${fmtFull(i[m].abs)}</td>
      <td class="num">${fmtPctSigned(i[m].pct)}</td>
      <td class="num">${fmtShare(i[m].partBase)}</td><td class="num">${fmtShare(i[m].partComp)}</td>
      <td class="num">${fmtPP(i[m].pp)}</td><td><span class="estado ${i.estado}">${estadoText(i.estado)}</span></td></tr>`).join('');
    const t = totals;
    const foot = `<tfoot><tr><td>Total del recorte</td>
      <td class="num">${fmtFull(t.base.nominal)}</td><td class="num">${fmtFull(t.comp.nominal)}</td>
      <td class="num">${fmtFull(t.base.real)}</td><td class="num">${fmtFull(t.comp.real)}</td>
      <td class="num">${fmtFull(t[m].abs)}</td><td class="num">${fmtPctSigned(t[m].pct)}</td>
      <td class="num">100 %</td><td class="num">100 %</td><td></td><td></td></tr></tfoot>`;
    $('full-table').innerHTML = head + `<tbody>${body || '<tr><td colspan="11" class="empty">Sin filas para este recorte o búsqueda.</td></tr>'}</tbody>` + foot;
    $('full-table').querySelectorAll('th button').forEach(btn => btn.addEventListener('click', () => {
      const col = btn.dataset.col;
      state.tableSort = { col, dir: state.tableSort.col === col && state.tableSort.dir === 'desc' ? 'asc' : 'desc' };
      renderTable();
      const again = $('full-table').querySelector(`th button[data-col="${col}"]`); if (again) again.focus();
    }));
  }

  function exportCSV() {
    const { dims, shown, totals, rows } = tableRows();
    const b = state.base, c = compYear(), pb = D.meta.price_base;
    const q = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const r2 = n => n == null ? '' : (Math.round(n * 100) / 100).toFixed(2);
    const r6 = n => n == null ? '' : n.toFixed(6);
    const header = ['anio_base', 'tipo_base', 'anio_comparado', 'tipo_comparado']
      .concat(dims.flatMap(d => [d + '_id', d + '_label']))
      .concat(['base_nominal', 'comparado_nominal', `base_real_${pb}`, `comparado_real_${pb}`,
        'variacion_nominal_abs', 'variacion_nominal_pct', 'variacion_real_abs', 'variacion_real_pct',
        'participacion_base', 'participacion_comparado', 'cambio_participacion_pp', 'estado',
        'unidad_nominal', 'unidad_real', 'recorte']);
    const recorte = activeFilterText() || 'Sin filtros';
    const meta = [b, typeName(b).toLowerCase(), c, typeName(c).toLowerCase()];
    const tail = ['pesos corrientes de cada año', `pesos a precios de ${pb}`, recorte];
    const line = (parts, x) => meta.concat(parts).concat([
      r2(x.base.nominal), r2(x.comp.nominal), r2(x.base.real), r2(x.comp.real),
      r2(x.nominal.abs), r6(x.nominal.pct), r2(x.real.abs), r6(x.real.pct),
      r6(x.real.partBase), r6(x.real.partComp), r6(x.real.pp), x.estado]).concat(tail);
    const out = [header];
    for (const i of shown) out.push(line(dims.flatMap((d, k) => [i.parts[k], labelOf(d, i.parts[k])]), i));
    const sumSide = (side, mode) => shown.reduce((s, i) => s + i[side][mode], 0);
    const blank = dims.flatMap(() => ['', '']);
    if (shown.length !== rows.length) {
      const sub = { base: { nominal: sumSide('base', 'nominal'), real: sumSide('base', 'real') }, comp: { nominal: sumSide('comp', 'nominal'), real: sumSide('comp', 'real') } };
      for (const mo of ['nominal', 'real']) sub[mo] = { abs: sub.comp[mo] - sub.base[mo], pct: M.pctChange(sub.base[mo], sub.comp[mo]), partBase: null, partComp: null, pp: null };
      sub.estado = 'subtotal_filas_exportadas';
      const l = blank.slice(); l[1] = 'SUBTOTAL FILAS EXPORTADAS'; out.push(line(l, sub));
    }
    const tot = { base: totals.base, comp: totals.comp, estado: 'total_recorte',
      nominal: { ...totals.nominal, partBase: 1, partComp: 1, pp: 0 }, real: { ...totals.real, partBase: 1, partComp: 1, pp: 0 } };
    const l = blank.slice(); l[1] = 'TOTAL DEL RECORTE'; out.push(line(l, tot));
    const csv = '\ufeff' + out.map(r => r.map(q).join(',')).join('\r\n');
    const name = `comparacion_${state.tableDim}_${b}_vs_${c}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveFile(name, blob);
  }

  // En GitHub Pages descarga con un enlace; dentro de un Artifact de claude.ai usa la capacidad "downloads".
  async function saveFile(name, blob) {
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try { await dl.save({ filename: name, data: blob }); }
        catch (e) { if (e && e.code !== 'declined') alert('No se pudo descargar el CSV: ' + (e.message || e.code)); }
        return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- metodología ---------------- */
  function renderMethod() {
    const mt = D.meta, pb = mt.price_base;
    const ipcRows = Object.keys(mt.ipc_average).map(y => `<tr><td>${y}</td><td>${D.typeOf[+y] ? typeName(+y) : 'Proyecto (pendiente de carga)'}</td>
      <td class="num">${nf(mt.ipc_average[y], 2)}</td><td class="num">${mt.factor_a_precios_2027[y].toLocaleString('es-AR', { maximumFractionDigits: 10 })}</td></tr>`).join('');
    const src = mt.sources.map(s => `<tr><td>${s.periodo}</td><td>${s.tipo_presupuesto}</td><td><code>${esc(s.archivo)}</code></td><td>${esc(s.version_fuente || '')}</td>
      <td><code>${esc(s.columna_monto)}</code></td><td class="num">${s.filas_leidas.toLocaleString('es-AR')}</td><td class="num">${s.filas_descartadas}</td>
      <td class="num">${s.filas_monto_cero.toLocaleString('es-AR')}</td><td class="num">${fmtFull(+s.total_nominal)}</td></tr>`).join('');
    const checks = mt.validation_summary.controles.map(c => `<li><span class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '!'}</span> ${esc(c.control)}${c.detalle ? ` <span class="muted">— ${esc(c.detalle)}</span>` : ''}</li>`).join('');
    const rv = mt.review;
    const lab = rv.etiquetas.map(e => `<li><strong>${DIM_NAME[e.dimension]} ${esc(e.clave)}</strong> (${e.tipo === 'solo_mayusculas' ? 'sólo difiere en mayúsculas' : 'nombre distinto con el mismo código'}): ${e.variantes.map(v => `“${esc(v.etiqueta)}” (${v.anios.join(', ')})`).join('; ')}. Se muestra “${esc(e.etiqueta_usada)}”.</li>`).join('');
    const pres = rv.presencia_parcial.map(p => `<li>${DIM_NAME[p.dimension]} ${esc(p.clave)} “${esc(p.etiqueta)}”: con monto en ${p.anios_con_monto.join(', ')}.</li>`).join('');
    $('method-body').innerHTML = `
      <p>2023–2026 corresponden al presupuesto <strong>Vigente</strong>. 2027 corresponde al <strong>Proyecto de Presupuesto</strong>${mt.proyecto_2027_disponible ? '' : ', que todavía no está cargado; mientras tanto el año comparado es el último Vigente disponible (' + mt.compared_year + ')'}. La vista no usa Sanción, Definitivo ni Devengado en ningún cálculo.</p>
      <p>El Vigente ${mt.periods.map(p => `${p.periodo} proviene del corte ${esc(p.version_fuente || 's/d')}`).join(', ')} de la fuente.</p>
      <h3>Pesos reales a precios de ${pb}</h3>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Año</th><th>Tipo</th><th class="num">IPC promedio</th><th class="num">Factor a precios de ${pb}</th></tr></thead><tbody>${ipcRows}</tbody></table></div>
      <pre>factor_a_precios_${pb}(año) = IPC_promedio_${pb} / IPC_promedio_año
monto_real_${pb} = monto_nominal × factor_a_precios_${pb}(año)     (para ${pb}: real = nominal)
variación_abs = comparado − base          variación_% = (comparado / base − 1) × 100
participación = monto_categoría / total del mismo año (del recorte)
cambio_participación_pp = participación_comparada − participación_base</pre>
      <p>El factor se aplica en <code>build_data.py</code> sin redondear; los montos se redondean sólo al mostrarlos o exportarlos. Si la base es 0 y el comparado es mayor, la categoría es “Nueva” y el porcentaje no aplica; si el comparado es 0, es “Sin asignación” (−100 %); si ambos son 0, queda oculta. Las categorías se comparan por código oficial (Jurisdicción; Finalidad.Función; Inciso) sobre la unión de claves de ambos años.</p>
      <h3>Fuentes</h3>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Año</th><th>Tipo</th><th>Archivo</th><th>Corte</th><th>Columna</th><th class="num">Filas leídas</th><th class="num">Descartadas</th><th class="num">Con monto 0</th><th class="num">Total nominal</th></tr></thead><tbody>${src}</tbody></table></div>
      <p class="muted" style="font-size:12.5px">SHA-256 de la fuente: <code>${esc(mt.sources[0].sha256)}</code>. Datos generados el ${esc(mt.generated_at)} (UTC), schema_version ${mt.schema_version}.</p>
      <h3>Controles del build</h3><ul>${checks}</ul>
      <h3>Para revisión humana</h3>
      <p>Variantes de nombre dentro de un mismo código (se agrupan por código, sin fusionar códigos distintos):</p><ul>${lab || '<li>Ninguna.</li>'}</ul>
      <p>Códigos presentes sólo en algunos años (aparecen como nuevos o sin asignación según el año base). No se aplicó ninguna equivalencia entre códigos distintos:</p><ul>${pres || '<li>Ninguno.</li>'}</ul>`;
  }

  /* ---------------- ciclo ---------------- */
  function update() {
    cache = null;
    syncControls(); renderHeader(); renderKPIs(); renderRankings(); renderComposition(); renderCross(); renderTable();
    writeURL();
  }

  async function init() {
    try {
      const json = window.__PRESUPUESTO__ || await fetch('presupuesto.json', { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
      D = M.decode(json);
      state.base = D.meta.default_base_year;
      readURL();
      buildControls();
      renderMethod();
      $('status').hidden = true;
      $('app').hidden = false;
      update();
    } catch (err) {
      const st = $('status');
      st.classList.add('error');
      st.textContent = 'No se pudieron cargar los datos (presupuesto.json): ' + err.message +
        '. Si abriste index.html con doble clic, serví la carpeta por HTTP (por ejemplo, python3 -m http.server) y volvé a abrirla.';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
