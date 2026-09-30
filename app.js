/* app.js — Presupuesto CABA: comparación entre años, evolución y comunas.
 * Consume presupuesto.json (schema_version 3) generado por build_data.py.
 * Regla de presentación: los MONTOS se muestran siempre nominales (pesos
 * corrientes de cada año). Sólo las VARIACIONES pueden verse reales (a precios
 * de 2027) o nominales. Los montos reales llegan precalculados del build.
 */
(function () {
  'use strict';
  const M = window.Metrics;
  let D = null;
  const charts = {};

  const DIM_NAME = { jur: 'Jurisdicción', fun: 'Función', inc: 'Inciso', geo: 'Comuna o ubicación' };
  const CROSSES = { jur_inc: ['jur', 'inc'], fun_inc: ['fun', 'inc'], jur_fun: ['jur', 'fun'], geo_jur: ['geo', 'jur'] };
  const PALETTE = ['#B4791E', '#1F5C57', '#A23B2E', '#445066', '#6C7A4C', '#7E8FA6', '#C9A03F', '#2E6B4F', '#8B4A3B'];
  const COLOR_A = '#445066', COLOR_B = '#B4791E', UP = '#1F5C57', DOWN = '#A23B2E', REST = '#C8C2B0';
  const EVO_MAX = 8;

  const state = {
    tab: 'comparacion', a: null, b: null, mode: 'real',
    filters: { jur: '', fun: '', inc: '', geo: '' },
    rankDim: 'jur', rankOrder: 'abs', compDim: 'jur', compSort: 'desc',
    cross: 'jur_inc', crossSearch: '', crossTop: '15', crossSort: 'abs', crossSel: null,
    tableDim: 'jur', tableSearch: '', tableTop: 'all', tableZero: false, tableSort: { col: 'abs', dir: 'desc' },
    evoDim: 'total', evoSel: null, evoSort: 'desc',
    comSel: null, comDetDim: 'jur', comDetSort: 'abs', comSort: 'alfa', comNomSort: 'desc', comYear: null,
  };

  const $ = id => document.getElementById(id);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /* ---------------- orden ----------------
   * how: 'desc' (asignación mayor a menor), 'asc' (menor a mayor) o 'alfa' (alfabético,
   * con números en orden natural: Comuna 2 antes que Comuna 10). */
  const byText = (x, y) => x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' });
  function sortList(list, how, amount, label) {
    const al = (x, y) => byText(label(x), label(y));
    if (how === 'alfa') return list.sort(al);
    if (how === 'asc') return list.sort((x, y) => amount(x) - amount(y) || al(x, y));
    return list.sort((x, y) => amount(y) - amount(x) || al(x, y));
  }
  const SORT_TEXT = { desc: 'asignación, de mayor a menor', asc: 'asignación, de menor a mayor', alfa: 'orden alfabético' };

  /* ---------------- formato ---------------- */
  const nf = (n, d) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MINUS = '−';
  const sign = n => n > 0 ? '+' : n < 0 ? MINUS : '';
  function fmtFull(n) { return (n < 0 ? MINUS : '') + '$ ' + Math.round(Math.abs(n)).toLocaleString('es-AR'); }
  function fmtAbbrev(n) {
    const a = Math.abs(n), s = n < 0 ? MINUS : '';
    if (a >= 1e12) return s + '$ ' + nf(a / 1e12, 2) + ' billones';
    if (a >= 1e9) return s + '$ ' + nf(a / 1e9, 1) + ' mil M';
    if (a >= 1e6) return s + '$ ' + nf(a / 1e6, 1) + ' M';
    return fmtFull(n);
  }
  const fmtSignedAbbrev = n => (n > 0 ? '+' : '') + fmtAbbrev(n);
  const fmtSignedFull = n => (n > 0 ? '+' : '') + fmtFull(n);
  const fmtPct = p => p == null ? 'No aplica' : sign(p) + nf(Math.abs(p), 1) + ' %';
  const fmtPctPlain = p => p == null ? 'No aplica' : (p < 0 ? MINUS : '') + nf(Math.abs(p), 1) + ' %';
  const fmtShare = p => p == null ? '—' : nf(p * 100, 1) + ' %';
  const fmtPP = p => p == null ? '—' : sign(p) + nf(Math.abs(p), 1) + ' pp';
  const arrow = n => n > 0 ? '▲' : n < 0 ? '▼' : '=';
  const dirClass = n => n > 0 ? 'up-text' : n < 0 ? 'down-text' : '';

  /* ---------------- vocabulario ---------------- */
  const typeName = y => D.typeOf[y] === 'proyecto' ? 'Proyecto' : 'Vigente';
  const yearLabel = y => typeName(y) + ' ' + y;
  const versionOf = y => (D.meta.periods.find(p => p.periodo === y) || {}).version_fuente;
  const PB = () => D.meta.price_base;
  function chip(y) {
    const cls = y === state.a ? 'a' : y === state.b ? 'b' : 'plain';
    return `<span class="yr ${cls}">${esc(yearLabel(y))}</span>`;
  }
  const modeWord = (m = state.mode) => m === 'real' ? 'real' : 'nominal';
  const varUnit = (m = state.mode) => m === 'real'
    ? `Variación real: diferencia expresada en pesos a precios de ${PB()} (IPC promedio de cada año)`
    : 'Variación nominal: diferencia en pesos corrientes, sin ajustar por inflación';
  const labelOf = (dim, key) => D.label[dim][key] || key;
  const partsLabel = (dims, parts) => dims.map((d, i) => labelOf(d, parts[i])).join(' / ');
  function estadoText(e) {
    if (e === 'nueva') return `Nueva en ${state.b} (sin asignación en ${state.a})`;
    if (e === 'eliminada') return `Sin asignación en ${state.b}`;
    if (e === 'continua') return 'Con asignación en ambos años';
    return 'Sin movimiento';
  }
  const estadoShort = e => ({ nueva: `Nueva en ${state.b}`, eliminada: `Sin asignación en ${state.b}`, continua: 'Continúa', sin_movimiento: 'Sin movimiento' }[e]);
  const isComuna = key => /^comuna\b/i.test(labelOf('geo', key));

  /* ---------------- datos ---------------- */
  let cache = null;
  function filtered() {
    if (!cache) cache = { rows: M.applyFilters(D.rows, state.filters), cmp: {} };
    return cache.rows;
  }
  function cmp(dims, rows) {
    if (rows) return M.compare(rows, state.a, state.b, dims);
    filtered();
    const k = dims.join('_');
    if (!cache.cmp[k]) cache.cmp[k] = M.compare(cache.rows, state.a, state.b, dims);
    return cache.cmp[k];
  }
  function activeFilterText() {
    return ['jur', 'fun', 'inc', 'geo'].filter(d => state.filters[d])
      .map(d => `${DIM_NAME[d]} = ${labelOf(d, state.filters[d])}`).join('; ');
  }

  /* ---------------- gráficos ---------------- */
  function draw(id, cfg) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = $(id);
    if (typeof Chart === 'undefined') {
      el.parentElement.innerHTML = '<p class="empty">No se pudo cargar la librería de gráficos. La tabla tiene los mismos datos.</p>';
      return;
    }
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {});
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  const FONT = { family: 'Source Sans 3', size: 12 };
  const MONO = { family: 'IBM Plex Mono', size: 10.5 };

  /* ---------------- URL ---------------- */
  function readURL() {
    const p = new URLSearchParams(location.search);
    const a = parseInt(p.get('a'), 10), b = parseInt(p.get('b'), 10);
    if (D.years.includes(a)) state.a = a;
    if (D.years.includes(b)) state.b = b;
    if (state.a === state.b) { state.a = D.meta.default_base_year; state.b = D.meta.default_compared_year; }
    if (p.get('modo') === 'nominal' || p.get('modo') === 'real') state.mode = p.get('modo');
    for (const d of ['jur', 'fun', 'inc', 'geo']) if (p.get(d) && D.label[d][p.get(d)]) state.filters[d] = p.get(d);
    if (['comparacion', 'evolucion', 'comunas'].includes(p.get('tab'))) state.tab = p.get('tab');
    if (['total', 'jur', 'fun', 'inc', 'geo'].includes(p.get('evo'))) state.evoDim = p.get('evo');
  }
  function writeURL() {
    const p = new URLSearchParams();
    p.set('tab', state.tab); p.set('a', state.a); p.set('b', state.b); p.set('modo', state.mode);
    for (const d of ['jur', 'fun', 'inc', 'geo']) if (state.filters[d]) p.set(d, state.filters[d]);
    if (state.tab === 'evolucion' && state.evoDim !== 'total') p.set('evo', state.evoDim);
    try { history.replaceState(null, '', location.pathname + '?' + p.toString()); } catch (e) { /* sin history */ }
  }

  /* ---------------- controles ---------------- */
  function buildControls() {
    const opts = D.years.map(y => `<option value="${y}">${yearLabel(y)}${versionOf(y) ? ' (' + versionOf(y) + ')' : ''}</option>`).join('');
    $('year-a').innerHTML = opts; $('year-b').innerHTML = opts;
    const onYear = (which) => (e) => {
      const v = +e.target.value, other = which === 'a' ? 'b' : 'a';
      if (v === state[other]) state[other] = state[which];     // si coinciden, se intercambian
      state[which] = v; state.crossSel = null; update();
    };
    $('year-a').addEventListener('change', onYear('a'));
    $('year-b').addEventListener('change', onYear('b'));

    $('mode-seg').addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) { state.mode = b.dataset.mode; update(); } });
    $('mode-seg').addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      state.mode = state.mode === 'real' ? 'nominal' : 'real'; update();
      $('mode-seg').querySelector(`[data-mode="${state.mode}"]`).focus();
    });
    for (const d of ['jur', 'fun', 'inc', 'geo']) $('f-' + d).addEventListener('change', e => { state.filters[d] = e.target.value; state.crossSel = null; state.evoSel = null; update(); });
    $('clear-filters').addEventListener('click', () => { state.filters = { jur: '', fun: '', inc: '', geo: '' }; state.crossSel = null; state.evoSel = null; update(); });

    bindTabs('main-tabs', 'tab', v => { state.tab = v; });
    $('rank-dim').addEventListener('change', e => { state.rankDim = e.target.value; update(); });
    $('rank-order').addEventListener('change', e => { state.rankOrder = e.target.value; update(); });
    $('comp-sort').addEventListener('change', e => { state.compSort = e.target.value; renderComposition(); });
    $('evo-sort').addEventListener('change', e => { state.evoSort = e.target.value; renderEvolucion(); });
    $('com-sort').addEventListener('change', e => { state.comSort = e.target.value; renderComunas(); });
    $('com-nom-sort').addEventListener('change', e => { state.comNomSort = e.target.value; renderComunaNominal(); });
    $('com-year').addEventListener('change', e => { state.comYear = +e.target.value; renderComunaNominal(); });
    $('com-det-sort').addEventListener('change', e => { state.comDetSort = e.target.value; renderComunaDetail(); });
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

    $('evo-dim').addEventListener('change', e => { state.evoDim = e.target.value; state.evoSel = null; update(); });
    $('to-evo-geo').addEventListener('click', () => { state.tab = 'evolucion'; state.evoDim = 'geo'; state.evoSel = null; update(); window.scrollTo({ top: 0 }); });
    $('com-sel').addEventListener('change', e => { state.comSel = e.target.value; renderComunaDetail(); markComunaRow(); });
    bindTabs('com-det-tabs', 'dim', v => { state.comDetDim = v; });
  }

  function bindTabs(id, attr, set) {
    const wrap = $(id);
    const btns = [...wrap.querySelectorAll('button')];
    wrap.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { set(b.dataset[attr]); update(); } });
    wrap.addEventListener('keydown', e => {
      const i = btns.indexOf(document.activeElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); n.click();
    });
  }

  function syncControls() {
    $('year-a').value = state.a; $('year-b').value = state.b;
    const evo = state.tab === 'evolucion';
    $('years-box').classList.toggle('is-disabled', evo);
    $('year-a').disabled = evo; $('year-b').disabled = evo;
    $('years-note').innerHTML = evo
      ? 'En Evolución se muestran todos los años.'
      : `La variación va de ${chip(state.a)} a ${chip(state.b)}.`;
    for (const b of $('mode-seg').querySelectorAll('button')) { const on = b.dataset.mode === state.mode; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; }
    const setSel = (id, attr, val) => { for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset[attr] === val); };
    setSel('main-tabs', 'tab', state.tab); setSel('comp-tabs', 'dim', state.compDim); setSel('cross-tabs', 'cross', state.cross); setSel('com-det-tabs', 'dim', state.comDetDim);
    for (const t of ['comparacion', 'evolucion', 'comunas']) $('panel-' + t).hidden = state.tab !== t;
    $('rank-dim').value = state.rankDim; $('rank-order').value = state.rankOrder; $('evo-dim').value = state.evoDim;
    $('comp-sort').value = state.compSort; $('evo-sort').value = state.evoSort; $('com-sort').value = state.comSort;
    $('com-nom-sort').value = state.comNomSort; $('com-det-sort').value = state.comDetSort;
    $('evo-sort-wrap').hidden = state.evoDim === 'total';

    // Opciones de filtro: claves con monto en algún año visible (A y B, o todos en Evolución).
    const ys = evo ? D.years : [state.a, state.b];
    const present = { jur: new Set(), fun: new Set(), inc: new Set(), geo: new Set() };
    for (const r of D.rows) if (ys.includes(r.year) && r.nominal !== 0) for (const d in present) present[d].add(r[d]);
    const opt = x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`;
    const fill = (d, list, allLabel, sorter) => {
      const cur = state.filters[d];
      let html = `<option value="">${allLabel}</option>`;
      const avail = list.filter(x => present[d].has(x.id) || x.id === cur);
      if (d === 'fun') {
        const groups = new Map();
        for (const x of avail) { if (!groups.has(x.fin_label)) groups.set(x.fin_label, []); groups.get(x.fin_label).push(x); }
        for (const [g, xs] of groups) html += `<optgroup label="${esc(g)}">${xs.map(opt).join('')}</optgroup>`;
      } else html += avail.sort(sorter).map(opt).join('');
      $('f-' + d).innerHTML = html; $('f-' + d).value = cur;
    };
    const byLabel = (a, b) => a.label.localeCompare(b.label, 'es');
    fill('jur', D.dims.jurisdicciones, 'Todas', byLabel);
    fill('fun', D.dims.funciones, 'Todas');
    fill('inc', D.dims.incisos, 'Todos', (a, b) => +a.id - +b.id);
    fill('geo', D.dims.ubicaciones, 'Todas', (a, b) => +a.id - +b.id);
  }

  function renderHeader() {
    const t = state.tab === 'evolucion'
      ? `Evolución ${D.years[0]}–${D.years[D.years.length - 1]}`
      : `${yearLabel(state.b)} vs. ${yearLabel(state.a)}`;
    $('page-context').textContent = state.tab === 'comunas' ? 'Comunas: ' + t : t;
    document.title = '¿A dónde va la plata de la Ciudad? · ' + $('page-context').textContent;
    $('mode-badge').textContent = state.mode === 'real' ? `Variaciones reales (precios de ${PB()})` : 'Variaciones nominales';
    $('pending-note').hidden = !!D.meta.proyecto_2027_disponible;
    document.querySelectorAll('.js-ya').forEach(e => { e.innerHTML = chip(state.a); });
    document.querySelectorAll('.js-yb').forEach(e => { e.innerHTML = chip(state.b); });
    document.querySelectorAll('.js-range').forEach(e => { e.textContent = `${D.years[0]}–${D.years[D.years.length - 1]}`; });
    document.querySelectorAll('.js-first-year').forEach(e => { e.textContent = D.years[0]; });
    document.querySelectorAll('.js-last-year').forEach(e => { e.textContent = D.years[D.years.length - 1]; });
    const rec = activeFilterText();
    document.querySelectorAll('.js-filter-line').forEach(e => { e.hidden = !rec; e.textContent = rec ? 'Filtro aplicado a todos los años: ' + rec + '.' : ''; });
  }

  /* =============== COMPARACIÓN =============== */
  function renderKPIs() {
    const { totals } = cmp(['jur']);
    const a = state.a, b = state.b, pb = PB();
    const empty = totals.base.nominal === 0 && totals.comp.nominal === 0;
    const amountCard = (y, cls, v) => `<div class="kpi ${cls}"><p class="label">${chip(y)} <span class="ver">corte ${esc(versionOf(y) || 's/d')}</span></p>
      <p class="value">${fmtAbbrev(v)}</p><p class="full">${fmtFull(v)} nominales</p></div>`;
    const varCard = (m, title) => {
      const t = totals[m];
      const lead = m === state.mode ? 'lead' : 'dim';
      return `<div class="kpi ${lead}"><p class="label">${title}</p>
        <p class="value"><span class="${dirClass(t.abs)}">${t.pct == null ? 'No aplica' : arrow(t.abs) + ' ' + fmtPct(t.pct)}</span></p>
        <p class="sub">${fmtSignedAbbrev(t.abs)} ${m === 'real' ? `a precios de ${pb}` : 'corrientes'}</p></div>`;
    };
    $('kpi-grid').innerHTML = amountCard(a, 'a', totals.base.nominal) + amountCard(b, 'b', totals.comp.nominal)
      + varCard('nominal', 'Variación nominal') + varCard('real', `Variación real <span class="muted">(precios de ${pb})</span>`);
    const t = totals[state.mode];
    $('synthesis').innerHTML = empty
      ? 'No hay montos para este filtro en ninguno de los dos años. Probá quitar algún filtro.'
      : t.pct == null
        ? `${chip(b)} tiene ${fmtAbbrev(totals.comp.nominal)} y ${chip(a)} no tiene asignación en este filtro, así que la variación porcentual no aplica.`
        : `${chip(b)} representa una variación ${modeWord()} de <strong>${fmtPct(t.pct)}</strong> respecto de ${chip(a)}${activeFilterText() ? ' en este filtro' : ''}.`;
  }

  function renderRankings() {
    const dim = state.rankDim, m = state.mode, ord = state.rankOrder;
    const { items } = cmp([dim]);
    const byChange = ord === 'abs';
    const lab = i => labelOf(dim, i.parts[0]);
    let R;
    if (byChange) R = M.rankings(items, m, 'abs', 10);
    else {
      const cont = items.filter(i => i.estado === 'continua');
      const up = sortList(cont.filter(i => i[m].abs > 0), ord, i => i.comp.nominal, lab);
      const down = sortList(cont.filter(i => i[m].abs < 0), ord, i => i.comp.nominal, lab);
      R = { up, down, upCount: up.length, downCount: down.length,
        nuevas: sortList(items.filter(i => i.estado === 'nueva'), ord, i => i.comp.nominal, lab),
        eliminadas: sortList(items.filter(i => i.estado === 'eliminada'), ord, i => i.base.nominal, lab) };
    }
    $('up-title').textContent = byChange ? 'Mayores aumentos' : 'Aumentan';
    $('down-title').textContent = byChange ? 'Mayores caídas' : 'Caen';
    $('rank-unit').innerHTML = `Montos nominales de cada año. ${esc(varUnit())}. `
      + (byChange ? 'Ordenado por el cambio en pesos (las 10 categorías que más se mueven en cada sentido).'
        : `Todas las categorías que aumentan o caen, ordenadas por ${SORT_TEXT[ord]}${ord === 'alfa' ? '' : ` (monto de ${chip(state.b)})`}. La barra muestra la asignación de ${chip(state.b)}.`);
    // La barra refleja el criterio: cambio en pesos, o asignación de B.
    const val = i => byChange ? i[m].abs : i.comp.nominal;
    const max = Math.max(1e-9, ...R.up.map(i => Math.abs(val(i))), ...R.down.map(i => Math.abs(val(i))));
    const li = (i, dir) => `<li class="rank-item">
        <span class="ri-name">${esc(lab(i))}${i.negativo ? '<span class="flag">revisar: monto negativo</span>' : ''}</span>
        <span class="ri-bar" aria-hidden="true"><span class="${dir}" style="width:${Math.max(1.5, Math.abs(val(i)) / max * 100)}%"></span></span>
        <span class="ri-figs">
          <span class="${dirClass(i[m].abs)}"><strong>${arrow(i[m].abs)} ${fmtPct(i[m].pct)}</strong> (${fmtSignedAbbrev(i[m].abs)} ${modeWord()})</span>
          <span>${chip(state.a)} ${fmtAbbrev(i.base.nominal)} → ${chip(state.b)} ${fmtAbbrev(i.comp.nominal)}</span>
          <span>Participación ${fmtShare(i.nominal.partBase)} → ${fmtShare(i.nominal.partComp)}</span>
        </span></li>`;
    const none = t => `<li class="empty">${t}</li>`;
    $('rank-up').innerHTML = R.up.length ? R.up.map(i => li(i, 'up')).join('') : none('Ninguna categoría aumenta en este filtro.');
    $('rank-down').innerHTML = R.down.length ? R.down.map(i => li(i, 'down')).join('') : none('Ninguna categoría cae en este filtro.');
    $('up-count').textContent = byChange && R.upCount > 10 ? `(10 de ${R.upCount})` : `(${R.upCount})`;
    $('down-count').textContent = byChange && R.downCount > 10 ? `(10 de ${R.downCount})` : `(${R.downCount})`;
    const pl = (list, side, y) => list.length
      ? list.map(i => `<li><span>${esc(lab(i))}</span><span class="amt">${chip(y)} ${fmtAbbrev(i[side].nominal)}</span></li>`).join('')
      : '<li class="empty">Ninguna.</li>';
    $('rank-new').innerHTML = pl(R.nuevas, 'comp', state.b);
    $('rank-gone').innerHTML = pl(R.eliminadas, 'base', state.a);
    $('new-count').textContent = `(${R.nuevas.length})`;
    $('gone-count').textContent = `(${R.eliminadas.length})`;
  }

  function renderComposition() {
    const dim = state.compDim;
    const { items, totals } = cmp([dim]);
    const list = items.filter(i => i.estado !== 'sin_movimiento').sort((x, y) => y.comp.nominal - x.comp.nominal || y.base.nominal - x.base.nominal);
    const shareMax = i => Math.max(i.nominal.partBase || 0, i.nominal.partComp || 0);
    const top = [...list].sort((x, y) => shareMax(y) - shareMax(x)).slice(0, PALETTE.length);
    const color = new Map(top.map((i, k) => [i.key, PALETTE[k]]));
    const rest = list.filter(i => !color.has(i.key));
    const tb = totals.base.nominal, tc = totals.comp.nominal;
    const pct = (v, t) => t ? v / t * 100 : 0;
    const datasets = top.map(i => ({ label: labelOf(dim, i.parts[0]), backgroundColor: color.get(i.key), borderColor: '#fff', borderWidth: 1,
      data: [pct(i.base.nominal, tb), pct(i.comp.nominal, tc)], _amt: [i.base.nominal, i.comp.nominal] }));
    if (rest.length) {
      const rb = rest.reduce((s, i) => s + i.base.nominal, 0), rc = rest.reduce((s, i) => s + i.comp.nominal, 0);
      datasets.push({ label: `Resto (${rest.length} categorías)`, backgroundColor: REST, borderColor: '#fff', borderWidth: 1, data: [pct(rb, tb), pct(rc, tc)], _amt: [rb, rc] });
    }
    draw('comp-chart', {
      type: 'bar',
      data: { labels: [`A: ${yearLabel(state.a)}`, `B: ${yearLabel(state.b)}`], datasets },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.raw, 1)} % (${fmtAbbrev(c.dataset._amt[c.dataIndex])} nominales)` } } },
        scales: {
          x: { stacked: true, min: 0, max: 100, ticks: { callback: v => v + ' %', font: MONO }, title: { display: true, text: 'Participación en el total del año (%)', font: FONT }, grid: { color: '#E4E0D2' } },
          y: { stacked: true, ticks: { font: { ...FONT, weight: '600' }, color: c => c.index === 0 ? COLOR_A : '#8C5B12' }, grid: { display: false } },
        },
      },
    });
    const tableList = sortList([...list], state.compSort, i => i.comp.nominal, i => labelOf(dim, i.parts[0]));
    $('comp-table').innerHTML = `<thead><tr><th>${DIM_NAME[dim]}</th><th class="num">${chip(state.a)}</th><th class="num">${chip(state.b)}</th><th class="num">Cambio</th><th>Estado</th></tr></thead><tbody>${
      tableList.map(i => `<tr><td class="label" title="${esc(labelOf(dim, i.parts[0]))}"><span class="swatch" style="background:${color.get(i.key) || REST}"></span>${esc(labelOf(dim, i.parts[0]))}</td>
        <td class="num">${fmtShare(i.nominal.partBase)}</td><td class="num">${fmtShare(i.nominal.partComp)}</td>
        <td class="num ${dirClass(i.nominal.pp)}">${i.nominal.pp == null ? '—' : arrow(i.nominal.pp) + ' ' + fmtPP(i.nominal.pp)}</td>
        <td><span class="estado ${i.estado}">${estadoShort(i.estado)}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin datos para este filtro.</td></tr>'}</tbody>`;
  }

  function heat(v, max) {
    if (!v || !max) return { bg: 'transparent', fg: 'inherit' };
    const t = Math.sqrt(Math.min(1, Math.abs(v) / max));
    const [r, g, b] = v > 0 ? [31, 92, 87] : [162, 59, 46];
    const a = 0.08 + 0.82 * t;
    return { bg: `rgba(${r},${g},${b},${a.toFixed(3)})`, fg: a > 0.55 ? '#fff' : 'var(--ink)' };
  }

  function renderCross() {
    const [ra, cb] = CROSSES[state.cross], m = state.mode;
    const cross = cmp([ra, cb]), rowsT = cmp([ra]).items, colsT = cmp([cb]).items, totalAbs = cmp([ra]).totals[m].abs;
    $('cross-unit').innerHTML = `Cada celda muestra la variación ${modeWord()} de ${chip(state.a)} a ${chip(state.b)}${m === 'real' ? `, en pesos a precios de ${PB()}` : ', en pesos corrientes'}. Filas: ${DIM_NAME[ra]}. Columnas: ${DIM_NAME[cb]}.`;
    const cellMap = new Map(cross.items.map(i => [i.key, i]));
    const q = fold(state.crossSearch.trim());
    let rows = rowsT.filter(i => i.estado !== 'sin_movimiento' && (!q || fold(labelOf(ra, i.parts[0])).includes(q)));
    const sorters = {
      abs: (x, y) => Math.abs(y[m].abs) - Math.abs(x[m].abs), up: (x, y) => y[m].abs - x[m].abs, down: (x, y) => x[m].abs - y[m].abs,
      desc: (x, y) => y.comp.nominal - x.comp.nominal, asc: (x, y) => x.comp.nominal - y.comp.nominal,
      label: (x, y) => byText(labelOf(ra, x.parts[0]), labelOf(ra, y.parts[0])),
    };
    rows.sort(sorters[state.crossSort]);
    const nRows = rows.length;
    if (state.crossTop !== 'all') rows = rows.slice(0, +state.crossTop);
    const order = D.dims[cb === 'inc' ? 'incisos' : 'funciones'].map(x => x.id);
    const cols = colsT.filter(i => i.estado !== 'sin_movimiento').sort((x, y) => order.indexOf(x.parts[0]) - order.indexOf(y.parts[0]));
    let max = 0;
    for (const r of rows) for (const c of cols) { const it = cellMap.get(r.parts[0] + '|' + c.parts[0]); if (it) max = Math.max(max, Math.abs(it[m].abs)); }
    const ramp = [...Array(7)].map((_, k) => `<span style="background:${heat((k - 3) / 3 * max, max).bg}"></span>`).join('');
    $('cross-legend').innerHTML = `<span class="tag">Caída ▼</span><span class="ramp" aria-hidden="true">${ramp}</span><span class="tag">▲ Aumento</span>
      <span class="tag"><span class="cell nueva" style="display:inline-block;width:18px;min-height:12px;padding:0"></span> Nueva en ${state.b}</span>
      <span class="tag"><span class="cell eliminada" style="display:inline-block;width:18px;min-height:12px;padding:0"></span> Sin asignación en ${state.b}</span>
      <span>${rows.length} de ${nRows} filas</span>`;
    if (!rows.length || !cols.length) {
      $('matrix-wrap').innerHTML = $('matrix-mobile').innerHTML = '<p class="empty" style="padding:14px">Sin filas para este filtro o búsqueda.</p>';
      renderCellDetail(null, totalAbs); return;
    }
    const cellBtn = (it, rKey, cKey) => {
      if (!it || it.estado === 'sin_movimiento') return '<span class="cell empty-cell" aria-hidden="true">·</span>';
      const v = it[m].abs, h = heat(v, max);
      const sel = state.crossSel && state.crossSel.cross === state.cross && state.crossSel.key === it.key;
      const second = it.estado === 'nueva' ? 'Nueva' : it.estado === 'eliminada' ? 'Sin asig.' : fmtPct(it[m].pct);
      const aria = `${labelOf(ra, rKey)}, ${labelOf(cb, cKey)}: ${estadoShort(it.estado)}, variación ${modeWord()} ${fmtSignedAbbrev(v)} (${fmtPct(it[m].pct)}) de ${state.a} a ${state.b}`;
      return `<button type="button" class="cell ${it.estado}${sel ? ' is-selected' : ''}" data-key="${esc(it.key)}" style="background-color:${h.bg};color:${h.fg}" aria-label="${esc(aria)}" title="${esc(aria)}">${arrow(v)} ${fmtAbbrev(Math.abs(v))}<small>${second}</small></button>`;
    };
    const head = `<thead><tr><th class="corner">${DIM_NAME[ra]} \\ ${DIM_NAME[cb]}</th>${cols.map(c => `<th scope="col" title="${esc(labelOf(cb, c.parts[0]))}">${esc(labelOf(cb, c.parts[0]))}</th>`).join('')}<th scope="col">Total fila</th></tr></thead>`;
    const body = rows.map(r => `<tr><th scope="row">${esc(labelOf(ra, r.parts[0]))}</th>${cols.map(c => `<td>${cellBtn(cellMap.get(r.parts[0] + '|' + c.parts[0]), r.parts[0], c.parts[0])}</td>`).join('')}
      <td class="rowtotal"><span class="cell" style="cursor:default" title="${esc(fmtFull(r[m].abs))}"><span class="${dirClass(r[m].abs)}">${arrow(r[m].abs)} ${fmtAbbrev(Math.abs(r[m].abs))}</span><small>${fmtPct(r[m].pct)}</small></span></td></tr>`).join('');
    $('matrix-wrap').innerHTML = `<table class="matrix">${head}<tbody>${body}</tbody></table>`;
    $('matrix-wrap').querySelectorAll('button.cell').forEach(btn => btn.addEventListener('click', () => {
      state.crossSel = { cross: state.cross, key: btn.dataset.key };
      $('matrix-wrap').querySelectorAll('.is-selected').forEach(x => x.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      renderCellDetail(cellMap.get(btn.dataset.key), totalAbs, rowsT.find(x => x.key === btn.dataset.key.split('|')[0]));
    }));
    $('matrix-mobile').innerHTML = rows.map(r => {
      const kids = cols.map(c => cellMap.get(r.parts[0] + '|' + c.parts[0])).filter(it => it && it.estado !== 'sin_movimiento').sort((x, y) => Math.abs(y[m].abs) - Math.abs(x[m].abs));
      return `<details><summary><span>${esc(labelOf(ra, r.parts[0]))}</span><span class="amt ${dirClass(r[m].abs)}">${arrow(r[m].abs)} ${fmtSignedAbbrev(r[m].abs)}</span></summary>
        <ul>${kids.map(it => `<li><span>${esc(labelOf(cb, it.parts[1]))}${it.estado !== 'continua' ? ` <span class="estado ${it.estado}">${estadoShort(it.estado)}</span>` : ''}</span>
          <span class="amt ${dirClass(it[m].abs)}">${arrow(it[m].abs)} ${fmtSignedAbbrev(it[m].abs)}<br>${fmtPct(it[m].pct)}</span></li>`).join('')}</ul></details>`;
    }).join('');
    const selIt = state.crossSel && state.crossSel.cross === state.cross ? cellMap.get(state.crossSel.key) : null;
    renderCellDetail(selIt, totalAbs, selIt ? rowsT.find(x => x.key === selIt.parts[0]) : null);
  }

  function renderCellDetail(it, totalAbs, rowIt) {
    const box = $('cell-detail');
    if (!it) { box.innerHTML = '<p class="muted">Elegí una celda para ver el detalle: montos de cada año, cambio y contribución al cambio total.</p>'; return; }
    const [ra, cb] = CROSSES[state.cross], m = state.mode, o = m === 'real' ? 'nominal' : 'real';
    const rowShare = rowIt && rowIt[m].abs ? it[m].abs / rowIt[m].abs * 100 : null;
    box.innerHTML = `<h3>${esc(labelOf(ra, it.parts[0]))}<br><span class="muted" style="font-weight:500">${esc(labelOf(cb, it.parts[1]))}</span></h3>
      <p class="muted" style="margin:0 0 8px">${estadoText(it.estado)}</p>
      <dl>
        <dt>${chip(state.a)} nominal</dt><dd>${fmtFull(it.base.nominal)}</dd>
        <dt>${chip(state.b)} nominal</dt><dd>${fmtFull(it.comp.nominal)}</dd>
        <dt>Variación ${modeWord()}</dt><dd class="${dirClass(it[m].abs)}">${arrow(it[m].abs)} ${fmtSignedFull(it[m].abs)}</dd>
        <dt>Variación ${modeWord()} %</dt><dd>${fmtPct(it[m].pct)}</dd>
        <dt>Variación ${modeWord(o)}</dt><dd class="muted">${fmtSignedAbbrev(it[o].abs)} (${fmtPct(it[o].pct)})</dd>
        <dt>Contribución al cambio total</dt><dd>${it[m].contrib == null ? 'No aplica' : fmtPctPlain(it[m].contrib * 100)}</dd>
        <dt>Peso en el cambio de la fila</dt><dd>${fmtPctPlain(rowShare)}</dd>
      </dl>
      <p class="muted" style="font-size:12px;margin:10px 0 0">${m === 'real' ? `Variación real en pesos a precios de ${PB()}. ` : ''}Contribución = cambio de la celda ÷ cambio total del filtro (${fmtSignedAbbrev(totalAbs)}). Puede ser negativa o superar 100 % si otras partidas se mueven en sentido contrario.</p>`;
  }

  /* ---- tabla completa ---- */
  const tableDims = () => CROSSES[state.tableDim] || [state.tableDim];
  function tableRows() {
    const dims = tableDims(), m = state.mode;
    const { items, totals } = cmp(dims);
    const q = fold(state.tableSearch.trim());
    const rows = items.filter(i => (state.tableZero || i.estado !== 'sin_movimiento') && (!q || fold(partsLabel(dims, i.parts)).includes(q)));
    const { col, dir } = state.tableSort, k = dir === 'asc' ? 1 : -1;
    const v = {
      label: i => partsLabel(dims, i.parts), a: i => i.base.nominal, b: i => i.comp.nominal, abs: i => i[m].abs,
      pct: i => i[m].pct == null ? -Infinity : i[m].pct, pa: i => i.nominal.partBase ?? -1, pbb: i => i.nominal.partComp ?? -1,
      pp: i => i.nominal.pp ?? -Infinity, estado: i => i.estado,
    }[col];
    rows.sort((x, y) => { const p = v(x), q2 = v(y); return (typeof p === 'string' ? p.localeCompare(q2, 'es') : p - q2) * k; });
    return { dims, rows, shown: state.tableTop === 'all' ? rows : rows.slice(0, +state.tableTop), totals };
  }
  function renderTable() {
    const { dims, rows, shown, totals } = tableRows();
    const m = state.mode;
    $('table-unit').innerHTML = `Montos nominales completos de cada año. ${esc(varUnit())}. ${shown.length} de ${rows.length} filas.`;
    const cols = [
      ['label', dims.map(d => DIM_NAME[d]).join(' / '), false], ['a', `${chip(state.a)} nominal`, true], ['b', `${chip(state.b)} nominal`, true],
      ['abs', `Variación ${modeWord()} $`, true], ['pct', `Variación ${modeWord()} %`, true],
      ['pa', `Participación ${chip(state.a)}`, true], ['pbb', `Participación ${chip(state.b)}`, true], ['pp', 'Cambio (pp)', true], ['estado', 'Estado', false],
    ];
    const s = state.tableSort;
    const head = `<thead><tr>${cols.map(([k, t, num]) => `<th class="${num ? 'num' : ''}" aria-sort="${s.col === k ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-col="${k}">${t}</button></th>`).join('')}</tr></thead>`;
    const body = shown.map(i => `<tr>
      <td class="label" title="${esc(partsLabel(dims, i.parts))}">${esc(partsLabel(dims, i.parts))}${i.negativo ? '<span class="flag">revisar: negativo</span>' : ''}</td>
      <td class="num">${fmtFull(i.base.nominal)}</td><td class="num">${fmtFull(i.comp.nominal)}</td>
      <td class="num ${dirClass(i[m].abs)}">${arrow(i[m].abs)} ${fmtSignedFull(i[m].abs)}</td><td class="num">${fmtPct(i[m].pct)}</td>
      <td class="num">${fmtShare(i.nominal.partBase)}</td><td class="num">${fmtShare(i.nominal.partComp)}</td><td class="num">${fmtPP(i.nominal.pp)}</td>
      <td><span class="estado ${i.estado}">${estadoShort(i.estado)}</span></td></tr>`).join('');
    const foot = `<tfoot><tr><td>Total del filtro</td><td class="num">${fmtFull(totals.base.nominal)}</td><td class="num">${fmtFull(totals.comp.nominal)}</td>
      <td class="num">${fmtSignedFull(totals[m].abs)}</td><td class="num">${fmtPct(totals[m].pct)}</td><td class="num">100 %</td><td class="num">100 %</td><td></td><td></td></tr></tfoot>`;
    $('full-table').innerHTML = head + `<tbody>${body || '<tr><td colspan="9" class="empty">Sin filas para este filtro o búsqueda.</td></tr>'}</tbody>` + foot;
    $('full-table').querySelectorAll('th button').forEach(btn => btn.addEventListener('click', () => {
      const col = btn.dataset.col;
      state.tableSort = { col, dir: state.tableSort.col === col && state.tableSort.dir === 'desc' ? 'asc' : 'desc' };
      renderTable();
      const again = $('full-table').querySelector(`th button[data-col="${col}"]`); if (again) again.focus();
    }));
  }

  function exportCSV() {
    const { dims, shown, rows, totals } = tableRows();
    const a = state.a, b = state.b, pb = PB();
    const q = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const r2 = n => n == null ? '' : (Math.round(n * 100) / 100).toFixed(2);
    const r6 = n => n == null ? '' : n.toFixed(6);
    const header = ['anio_a', 'tipo_a', 'anio_b', 'tipo_b'].concat(dims.flatMap(d => [d + '_id', d + '_label'])).concat([
      'monto_nominal_a', 'monto_nominal_b', 'variacion_nominal_abs', 'variacion_nominal_pct',
      `variacion_real_abs_pesos_${pb}`, 'variacion_real_pct', 'participacion_a', 'participacion_b', 'cambio_participacion_pp',
      'estado', 'unidad_montos', 'unidad_variacion_real', 'filtro']);
    const meta = [a, typeName(a).toLowerCase(), b, typeName(b).toLowerCase()];
    const tail = ['pesos corrientes de cada año', `pesos a precios de ${pb}`, activeFilterText() || 'Sin filtros'];
    const line = (parts, x) => meta.concat(parts).concat([r2(x.base.nominal), r2(x.comp.nominal), r2(x.nominal.abs), r6(x.nominal.pct),
      r2(x.real.abs), r6(x.real.pct), r6(x.nominal.partBase), r6(x.nominal.partComp), r6(x.nominal.pp), x.estado]).concat(tail);
    const out = [header];
    for (const i of shown) out.push(line(dims.flatMap((d, k) => [i.parts[k], labelOf(d, i.parts[k])]), i));
    const blank = dims.flatMap(() => ['', '']);
    const agg = list => {
      const s = { base: { nominal: 0, real: 0 }, comp: { nominal: 0, real: 0 } };
      for (const i of list) for (const side of ['base', 'comp']) for (const mo of ['nominal', 'real']) s[side][mo] += i[side][mo];
      for (const mo of ['nominal', 'real']) s[mo] = { abs: s.comp[mo] - s.base[mo], pct: M.pctChange(s.base[mo], s.comp[mo]) };
      return s;
    };
    if (shown.length !== rows.length) {
      const sub = agg(shown); sub.estado = 'subtotal_filas_exportadas';
      sub.nominal.partBase = sub.nominal.partComp = sub.nominal.pp = null;
      const l = blank.slice(); l[1] = 'SUBTOTAL FILAS EXPORTADAS'; out.push(line(l, sub));
    }
    const tot = { base: totals.base, comp: totals.comp, estado: 'total_filtro', nominal: { ...totals.nominal, partBase: 1, partComp: 1, pp: 0 }, real: { ...totals.real } };
    const l = blank.slice(); l[1] = 'TOTAL DEL FILTRO'; out.push(line(l, tot));
    const csv = '\ufeff' + out.map(r => r.map(q).join(',')).join('\r\n');
    saveFile(`presupuesto_${state.tableDim}_${a}_a_${b}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
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
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob); el.download = name;
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  }

  /* =============== EVOLUCIÓN =============== */
  function renderEvolucion() {
    const years = D.years, m = state.mode, dim = state.evoDim, rows = filtered();
    const total = M.evolution(rows, years, [])[0];
    const items = dim === 'total' ? [] : M.evolution(rows, years, [dim]);
    const last = years[years.length - 1];
    items.sort((x, y) => y.byYear[last].nominal - x.byYear[last].nominal || y.byYear[x.firstYear].nominal - x.byYear[x.firstYear].nominal);
    if (dim !== 'total' && (!state.evoSel || ![...state.evoSel].every(k => items.some(i => i.key === k)))) {
      state.evoSel = new Set(items.slice(0, 5).map(i => i.key));   // por defecto, las 5 de mayor monto
    }
    const lbl = i => i.key === 'total' ? 'Total' : labelOf(dim, i.parts[0]);
    if (state.evoSort !== 'desc') sortList(items, state.evoSort, i => i.byYear[last].nominal, lbl);
    $('evo-intro').textContent = `Montos nominales de cada año (${years.map(y => `${y}: ${typeName(y)} ${versionOf(y) || ''}`.trim()).join(', ')}). ${varUnit()}. La variación acumulada se mide desde el primer año con asignación de cada categoría.${dim === 'total' ? '' : ` Tabla ordenada por ${SORT_TEXT[state.evoSort]}${state.evoSort === 'alfa' ? '' : ` (monto de ${last})`}.`}`;
    $('evo-var-title').innerHTML = `Variación ${modeWord()} acumulada <span class="muted">(desde el primer año con asignación${m === 'real' ? `, precios de ${PB()}` : ''})</span>`;

    if (!total) {
      for (const id of ['evo-nominal', 'evo-var']) if (charts[id]) { charts[id].destroy(); delete charts[id]; }
      $('evo-table').innerHTML = '<tbody><tr><td class="empty">Sin montos para este filtro.</td></tr></tbody>';
      $('evo-pick-note').textContent = ''; return;
    }
    const series = dim === 'total' ? [total] : items.filter(i => state.evoSel.has(i.key));
    const colorOf = new Map(series.map((s, k) => [s.key, dim === 'total' ? COLOR_B : PALETTE[k % PALETTE.length]]));
    const xLabels = years.map(y => [String(y), typeName(y) + (versionOf(y) ? ' ' + versionOf(y) : '')]);

    draw('evo-nominal', {
      type: 'bar',
      data: { labels: xLabels, datasets: series.map(s => ({ label: lbl(s), data: years.map(y => s.byYear[y].nominal), backgroundColor: colorOf.get(s.key) })) },
      options: {
        plugins: { legend: { display: dim !== 'total', position: 'bottom', labels: { font: FONT, boxWidth: 12 } },
          tooltip: { callbacks: { title: c => yearLabel(years[c[0].dataIndex]), label: c => `${c.dataset.label}: ${fmtAbbrev(c.raw)} nominales` } } },
        scales: { y: { ticks: { callback: v => fmtAbbrev(v), font: MONO }, title: { display: true, text: 'Pesos corrientes de cada año', font: FONT }, grid: { color: '#E4E0D2' } }, x: { ticks: { font: FONT }, grid: { display: false } } },
      },
    });
    draw('evo-var', {
      type: 'line',
      data: { labels: xLabels, datasets: series.map(s => ({ label: lbl(s), data: years.map(y => s[m].cum[y]), borderColor: colorOf.get(s.key), backgroundColor: colorOf.get(s.key), borderWidth: 2.5, pointRadius: 4, spanGaps: false, tension: 0 }))
        .concat(dim === 'total' ? [] : [{ label: 'Total del filtro', data: years.map(y => total[m].cum[y]), borderColor: '#1C2431', backgroundColor: '#1C2431', borderDash: [6, 4], borderWidth: 2, pointRadius: 3, tension: 0 }]) },
      options: {
        plugins: { legend: { display: dim !== 'total', position: 'bottom', labels: { font: FONT, boxWidth: 12 } },
          tooltip: { callbacks: { title: c => yearLabel(years[c[0].dataIndex]), label: c => `${c.dataset.label}: ${fmtPct(c.raw)} ${modeWord()} acumulada` } } },
        scales: {
          y: { ticks: { callback: v => (v > 0 ? '+' : '') + v + ' %', font: MONO }, title: { display: true, text: `Variación ${modeWord()} acumulada (%)`, font: FONT },
            grid: { color: c => c.tick.value === 0 ? '#1C2431' : '#E4E0D2', lineWidth: c => c.tick.value === 0 ? 1.5 : 1 } },
          x: { ticks: { font: FONT }, grid: { display: false } },
        },
      },
    });

    const pairs = years.slice(1).map((y, i) => [years[i], y]);
    $('evo-pick-note').textContent = dim === 'total' ? '' : `Marcá hasta ${EVO_MAX} filas para verlas en los gráficos (${state.evoSel.size} marcadas).`;
    const head = `<thead><tr>${dim === 'total' ? '' : '<th class="sel"><span class="sr-only">Graficar</span></th>'}<th>${dim === 'total' ? '' : DIM_NAME[dim]}</th>
      ${years.map(y => `<th class="num">${y}<br><span class="ver">${typeName(y)}${versionOf(y) ? ' ' + versionOf(y) : ''}, nominal</span></th>`).join('')}
      ${pairs.map(([p, n]) => `<th class="num">${p}→${n}<br><span class="ver">var. ${modeWord()}</span></th>`).join('')}
      <th class="num">Acumulada<br><span class="ver">var. ${modeWord()}</span></th></tr></thead>`;
    const row = (it, isTotal) => {
      const checked = !isTotal && state.evoSel.has(it.key);
      const disabled = !isTotal && !checked && state.evoSel.size >= EVO_MAX;
      return `<tr class="${isTotal ? 'total-row' : ''}">${dim === 'total' ? '' : `<td class="sel">${isTotal ? '' : `<input type="checkbox" data-key="${esc(it.key)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Graficar ${esc(lbl(it))}">`}</td>`}
        <td class="label" title="${esc(isTotal ? 'Total' : lbl(it))}">${checked ? `<span class="swatch" style="background:${colorOf.get(it.key)}"></span>` : ''}${esc(isTotal ? (dim === 'total' ? 'Total' : 'Total del filtro') : lbl(it))}</td>
        ${years.map(y => `<td class="num">${it.byYear[y].nominal ? fmtAbbrev(it.byYear[y].nominal) : '<span class="muted">—</span>'}</td>`).join('')}
        ${it[m].yoy.map(p => `<td class="num ${dirClass(p)}">${p == null ? '<span class="muted">—</span>' : arrow(p) + ' ' + fmtPct(p)}</td>`).join('')}
        <td class="num ${dirClass(it[m].total)}"><strong>${fmtPct(it[m].total)}</strong>${it.firstYear !== years[0] ? `<br><span class="ver">desde ${it.firstYear}</span>` : ''}</td></tr>`;
    };
    $('evo-table').innerHTML = head + `<tbody>${row(total, true)}${items.map(i => row(i, false)).join('')}</tbody>`;
    $('evo-table').querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) state.evoSel.add(cb.dataset.key); else state.evoSel.delete(cb.dataset.key);
      renderEvolucion();
      const again = $('evo-table').querySelector(`input[data-key="${CSS.escape(cb.dataset.key)}"]`); if (again) again.focus();
    }));
  }

  /* =============== COMUNAS =============== */
  function renderComunas() {
    const m = state.mode, a = state.a, b = state.b;
    const { items, totals } = cmp(['geo']);
    const live = items.filter(i => i.estado !== 'sin_movimiento');
    const gl = i => labelOf('geo', i.parts[0]);
    const comunas = sortList(live.filter(i => isComuna(i.parts[0])), state.comSort, i => i.comp.nominal, gl);
    const otras = sortList(live.filter(i => !isComuna(i.parts[0])), state.comSort, i => i.comp.nominal, gl);
    const sum = (list, side, mo) => list.reduce((s, i) => s + i[side][mo], 0);
    const cA = sum(comunas, 'base', 'nominal'), cB = sum(comunas, 'comp', 'nominal');
    const cVar = M.pctChange(sum(comunas, 'base', m), sum(comunas, 'comp', m));
    const kpi = (cls, label, v, sub) => `<div class="kpi ${cls}"><p class="label">${label}</p><p class="value">${v}</p>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;
    const shareB = totals.comp.nominal ? cB / totals.comp.nominal : null;
    let note = '';
    if (comunas.length && cB) {
      const top2 = [...comunas].sort((x, y) => y.comp.nominal - x.comp.nominal).slice(0, 2);
      const topShare = top2.reduce((s, i) => s + i.comp.nominal, 0) / cB;
      note = `<p class="com-note">En ${chip(b)}, ${top2.map(i => esc(labelOf('geo', i.parts[0]))).join(' y ')} concentran el <strong>${fmtShare(topShare)}</strong> del monto registrado en comunas. Elegí una comuna abajo para ver qué jurisdicciones, funciones o incisos explican su monto.</p>`;
    }
    $('com-summary').innerHTML = kpi('a', `${chip(a)} en comunas`, fmtAbbrev(cA), `${fmtShare(totals.base.nominal ? cA / totals.base.nominal : null)} del total, nominal`)
      + kpi('b', `${chip(b)} en comunas`, fmtAbbrev(cB), `${fmtShare(shareB)} del total, nominal`)
      + kpi('lead', `Variación ${modeWord()}`, `<span class="${dirClass(cVar)}">${cVar == null ? 'No aplica' : arrow(cVar) + ' ' + fmtPct(cVar)}</span>`, m === 'real' ? `precios de ${PB()}` : 'pesos corrientes');
    const noteEl = $('com-note-wrap') || (() => { const d = document.createElement('div'); d.id = 'com-note-wrap'; $('com-summary').after(d); return d; })();
    noteEl.innerHTML = note;

    const names = comunas.map(i => labelOf('geo', i.parts[0]));
    draw('com-amounts', {
      type: 'bar',
      data: { labels: names, datasets: [
        { label: `A: ${yearLabel(a)}`, data: comunas.map(i => i.base.nominal), backgroundColor: COLOR_A },
        { label: `B: ${yearLabel(b)}`, data: comunas.map(i => i.comp.nominal), backgroundColor: COLOR_B }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { position: 'top', labels: { font: FONT, boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtAbbrev(c.raw)} nominales` } } },
        scales: { x: { ticks: { callback: v => fmtAbbrev(v), font: MONO }, title: { display: true, text: 'Pesos corrientes de cada año', font: FONT }, grid: { color: '#E4E0D2' } }, y: { ticks: { font: FONT }, grid: { display: false } } },
      },
    });
    $('com-var-title').innerHTML = `Variación ${modeWord()} de ${chip(a)} a ${chip(b)} <span class="muted">(%)</span>`;
    draw('com-var', {
      type: 'bar',
      data: { labels: names, datasets: [{ label: `Variación ${modeWord()}`, data: comunas.map(i => i[m].pct), backgroundColor: comunas.map(i => (i[m].pct || 0) >= 0 ? UP : DOWN) }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const i = comunas[c.dataIndex]; return `${fmtPct(i[m].pct)} (${fmtSignedAbbrev(i[m].abs)} ${modeWord()})`; } } } },
        scales: { x: { ticks: { callback: v => (v > 0 ? '+' : '') + v + ' %', font: MONO }, title: { display: true, text: `Variación ${modeWord()} (%)${m === 'real' ? `, precios de ${PB()}` : ''}`, font: FONT },
          grid: { color: c => c.tick.value === 0 ? '#1C2431' : '#E4E0D2', lineWidth: c => c.tick.value === 0 ? 1.5 : 1 } }, y: { ticks: { font: FONT }, grid: { display: false } } },
      },
    });

    const tableFor = (list, selectable) => {
      const head = `<thead><tr><th>Comuna o ubicación</th><th class="num">${chip(a)} nominal</th><th class="num">${chip(b)} nominal</th>
        <th class="num">Variación ${modeWord()} $</th><th class="num">Variación ${modeWord()} %</th><th class="num">Participación ${chip(a)}</th><th class="num">Participación ${chip(b)}</th><th>Estado</th></tr></thead>`;
      const body = list.map(i => `<tr data-key="${esc(i.key)}">
        <td>${selectable ? `<button type="button" class="row-btn" data-key="${esc(i.key)}">${esc(labelOf('geo', i.parts[0]))}</button>` : esc(labelOf('geo', i.parts[0]))}</td>
        <td class="num">${fmtFull(i.base.nominal)}</td><td class="num">${fmtFull(i.comp.nominal)}</td>
        <td class="num ${dirClass(i[m].abs)}">${arrow(i[m].abs)} ${fmtSignedFull(i[m].abs)}</td><td class="num">${fmtPct(i[m].pct)}</td>
        <td class="num">${fmtShare(i.nominal.partBase)}</td><td class="num">${fmtShare(i.nominal.partComp)}</td>
        <td><span class="estado ${i.estado}">${estadoShort(i.estado)}</span></td></tr>`).join('');
      return head + `<tbody>${body || '<tr><td colspan="8" class="empty">Sin montos para este filtro.</td></tr>'}</tbody>`;
    };
    $('com-table').innerHTML = tableFor(comunas, true);
    $('com-other').innerHTML = tableFor(otras, false);
    $('com-table').querySelectorAll('tbody tr[data-key]').forEach(tr => tr.addEventListener('click', () => {
      state.comSel = tr.dataset.key; $('com-sel').value = state.comSel; renderComunaDetail(); markComunaRow();
      $('h-com-det').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));

    // Selector de comuna para el detalle.
    const all = comunas.concat(otras);
    if (!state.comSel || !all.some(i => i.key === state.comSel)) {
      const pick = [...comunas].sort((x, y) => y.comp.nominal - x.comp.nominal)[0] || all[0];
      state.comSel = pick ? pick.key : null;
    }
    $('com-sel').innerHTML = all.map(i => `<option value="${esc(i.key)}">${esc(labelOf('geo', i.parts[0]))}</option>`).join('');
    if (state.comSel) $('com-sel').value = state.comSel;
    markComunaRow();
    renderComunaDetail();
    renderComunaNominal();
  }

  /* ---- asignación nominal de cada comuna en un año (comparación entre comunas) ---- */
  // Plugin propio: escribe el monto y la participación al final de cada barra y marca el promedio.
  const barLabels = {
    id: 'barLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx, chartArea, scales: { x } } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      if (opts.avg != null) {
        const px = x.getPixelForValue(opts.avg);
        ctx.strokeStyle = '#1C2431'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(px, chartArea.top); ctx.lineTo(px, chartArea.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = '#1C2431'; ctx.font = '600 11px "Source Sans 3", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('Promedio ' + fmtAbbrev(opts.avg), px + 4, chartArea.top - 2);
      }
      ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#3A4252'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      meta.data.forEach((bar, k) => { const t = opts.text[k]; if (t) ctx.fillText(t, bar.x + 6, bar.y); });
      ctx.restore();
    },
  };

  function renderComunaNominal() {
    const years = D.years;
    if (state.comYear == null || !years.includes(state.comYear)) state.comYear = null;
    const y = state.comYear == null ? state.b : state.comYear;
    $('com-year').innerHTML = years.map(v => `<option value="${v}">${esc(yearLabel(v))}${versionOf(v) ? ' (' + versionOf(v) + ')' : ''}</option>`).join('');
    $('com-year').value = y;
    const evo = M.evolution(filtered(), years, ['geo']);
    const gl = i => labelOf('geo', i.parts[0]);
    const list = sortList(evo.filter(i => isComuna(i.parts[0]) && i.byYear[y].nominal !== 0), state.comNomSort, i => i.byYear[y].nominal, gl);
    const amt = i => i.byYear[y].nominal;
    const total = list.reduce((s, i) => s + amt(i), 0);
    const avg = list.length ? total / list.length : null;
    $('com-nom-unit').innerHTML = `Monto asignado a cada comuna en ${chip(y)}, en pesos corrientes de ese año (nominal), sin comparar contra otro año. Permite ver qué comunas reciben más y cuáles menos. Al lado de cada barra: monto y porcentaje sobre el total asignado a comunas. La línea punteada marca el promedio por comuna. Orden: ${SORT_TEXT[state.comNomSort]}.`;
    if (!list.length) {
      if (charts['com-nominal']) { charts['com-nominal'].destroy(); delete charts['com-nominal']; }
      $('com-nom-note').innerHTML = 'No hay montos asignados a comunas para este año y filtro.';
      return;
    }
    const colorFor = y === state.a ? COLOR_A : COLOR_B;
    draw('com-nominal', {
      type: 'bar',
      data: { labels: list.map(gl), datasets: [{ label: yearLabel(y), data: list.map(amt), backgroundColor: list.map(i => amt(i) >= avg ? colorFor : colorFor + '99'), borderRadius: 2, barPercentage: 0.82, categoryPercentage: 0.9 }] },
      plugins: [barLabels],
      options: {
        indexAxis: 'y',
        layout: { padding: { right: 150, top: 16 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => `${fmtFull(c.raw)} nominales (${fmtShare(total ? c.raw / total : null)} del total en comunas)` } },
          barLabels: { enabled: true, avg, text: list.map(i => `${fmtAbbrev(amt(i))} · ${fmtShare(total ? amt(i) / total : null)}`) },
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: v => fmtAbbrev(v), font: MONO, maxTicksLimit: 6 }, title: { display: true, text: `Pesos corrientes de ${y} (nominal)`, font: FONT }, grid: { color: '#E4E0D2' } },
          y: { ticks: { font: { ...FONT, weight: '600' } }, grid: { display: false } },
        },
      },
    });
    const byAmt = [...list].sort((p, q) => amt(q) - amt(p));
    const hi = byAmt[0], lo = byAmt[byAmt.length - 1];
    const above = list.filter(i => amt(i) >= avg).length;
    $('com-nom-note').innerHTML = list.length > 1
      ? `En ${chip(y)} las comunas suman <strong>${fmtAbbrev(total)}</strong> nominales. <strong>${esc(gl(hi))}</strong> es la de mayor asignación (${fmtAbbrev(amt(hi))}, ${fmtShare(amt(hi) / total)}) y <strong>${esc(gl(lo))}</strong> la de menor (${fmtAbbrev(amt(lo))}, ${fmtShare(amt(lo) / total)})${amt(lo) > 0 ? `: la primera recibe <strong>${nf(amt(hi) / amt(lo), 1)} veces</strong> lo que recibe la segunda` : ''}. ${above} de ${list.length} comunas están en el promedio o por encima (barras de color pleno).`
      : `En ${chip(y)} sólo ${esc(gl(hi))} tiene monto asignado en este filtro: ${fmtAbbrev(amt(hi))}.`;
  }

  function markComunaRow() {
    $('com-table').querySelectorAll('tbody tr').forEach(tr => tr.classList.toggle('is-selected', tr.dataset.key === state.comSel));
  }

  function renderComunaDetail() {
    const key = state.comSel, dim = state.comDetDim, m = state.mode;
    if (!key) { $('com-det-table').innerHTML = '<tbody><tr><td class="empty">Sin comunas para este filtro.</td></tr></tbody>'; $('com-det-unit').textContent = ''; return; }
    const rows = filtered().filter(r => r.geo === key);
    const { items, totals } = cmp([dim], rows);
    const ord = state.comDetSort;
    const list = items.filter(i => i.estado !== 'sin_movimiento');
    if (ord === 'abs') list.sort((x, y) => Math.abs(y[m].abs) - Math.abs(x[m].abs));
    else sortList(list, ord, i => i.comp.nominal, i => labelOf(dim, i.parts[0]));
    $('com-det-unit').innerHTML = `<strong>${esc(labelOf('geo', key))}</strong>: ${chip(state.a)} ${fmtAbbrev(totals.base.nominal)} → ${chip(state.b)} ${fmtAbbrev(totals.comp.nominal)} nominales; variación ${modeWord()} ${fmtPct(totals[m].pct)}. Ordenado por ${ord === 'abs' ? 'el tamaño del cambio' : SORT_TEXT[ord] + (ord === 'alfa' ? '' : ` (monto de ${state.b})`)}. ${esc(varUnit())}.`;
    const head = `<thead><tr><th>${DIM_NAME[dim]}</th><th class="num">${chip(state.a)} nominal</th><th class="num">${chip(state.b)} nominal</th>
      <th class="num">Variación ${modeWord()} $</th><th class="num">Variación ${modeWord()} %</th><th class="num">Peso en ${chip(state.b)}</th><th class="num">Contribución al cambio</th><th>Estado</th></tr></thead>`;
    const body = list.map(i => `<tr><td class="label" title="${esc(labelOf(dim, i.parts[0]))}">${esc(labelOf(dim, i.parts[0]))}</td>
      <td class="num">${fmtFull(i.base.nominal)}</td><td class="num">${fmtFull(i.comp.nominal)}</td>
      <td class="num ${dirClass(i[m].abs)}">${arrow(i[m].abs)} ${fmtSignedFull(i[m].abs)}</td><td class="num">${fmtPct(i[m].pct)}</td>
      <td class="num">${fmtShare(i.nominal.partComp)}</td><td class="num">${i[m].contrib == null ? 'No aplica' : fmtPctPlain(i[m].contrib * 100)}</td>
      <td><span class="estado ${i.estado}">${estadoShort(i.estado)}</span></td></tr>`).join('');
    $('com-det-table').innerHTML = head + `<tbody>${body || '<tr><td colspan="8" class="empty">Sin montos.</td></tr>'}</tbody>`;
  }

  /* ---------------- ciclo ---------------- */
  function update() {
    cache = null;
    syncControls(); renderHeader();
    if (state.tab === 'comparacion') { renderKPIs(); renderRankings(); renderComposition(); renderCross(); renderTable(); }
    else if (state.tab === 'evolucion') renderEvolucion();
    else renderComunas();
    writeURL();
  }

  async function init() {
    try {
      const json = window.__PRESUPUESTO__ || await fetch('presupuesto.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      D = M.decode(json);
      state.a = D.meta.default_base_year; state.b = D.meta.default_compared_year;
      readURL();
      buildControls();
      $('status').hidden = true; $('app').hidden = false;
      update();
    } catch (err) {
      const st = $('status'); st.classList.add('error');
      st.textContent = 'No se pudieron cargar los datos (presupuesto.json): ' + err.message + '. Si abriste index.html con doble clic, serví la carpeta por HTTP (por ejemplo, python3 -m http.server) y volvé a abrirla.';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
