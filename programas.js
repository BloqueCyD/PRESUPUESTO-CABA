/* programas.js — Pestaña "Programas" del tablero Presupuesto CABA.
 *
 * Fuente independiente: programas.json (generado por build_programas.py a partir de
 * fuentes/Consolidado_Jurisdicciones_2027.csv). No usa presupuesto.json, ni
 * metrics.js, ni el estado de app.js: las pestañas de gastos quedan intactas.
 * El build verifica que los totales por jurisdicción coincidan al peso con los de
 * presupuesto.json, así que esta pestaña no contradice ninguna comparación existente.
 *
 * Convención (la misma del tablero de gastos):
 *  - Los montos se muestran siempre nominales (pesos corrientes de cada año).
 *  - Variación nominal = proyecto_2027 − vigente_2026; % = (2027 / 2026 − 1) × 100.
 *  - Variación real (pesos de 2027) = proyecto_2027 − vigente_2026 × factor,
 *    factor = IPC 2027 / IPC 2026 (exacto, el de presupuesto.json).
 *  - Aporte (pp) = variación del programa / vigente 2026 del recorte × 100, en el modo
 *    elegido (en real, el vigente llevado a precios de 2027). Suma la variación % del recorte.
 *
 * Integración: el botón "Programas" vive en la barra de pestañas. Su clic se atiende
 * en el propio botón (no llega a app.js). Al elegir otra pestaña, esta se cierra antes
 * (fase de captura) para que la pestaña siguiente encuentre la cabecera original.
 */
(function (root) {
  'use strict';

  /* =================== cálculos (sin DOM; los usa test_programas.js) =================== */
  const Y0 = 2026, Y1 = 2027;
  const pctChange = (a, b) => (a === 0 ? null : (b / a - 1) * 100);

  function decode(json) {
    if (!json || !json.meta || json.meta.schema !== 'programas-1') throw new Error('programas.json no tiene schema programas-1.');
    const F = json.meta.factor_a_precios_2027[String(Y0)];
    const jurName = Object.fromEntries(json.jurisdicciones.map(j => [j.id, j.nombre]));
    const progs = json.programas.map(p => Object.assign({ key: p.jur + '/' + p.prog, jurNombre: jurName[p.jur] }, p));
    return { meta: json.meta, F, jurisdicciones: json.jurisdicciones, jurName, progs };
  }

  /** Variaciones de un programa (o de un total) en los dos modos. */
  function sides(v26, p27, F) {
    return {
      nominal: { base: v26, comp: p27, abs: p27 - v26, pct: pctChange(v26, p27) },
      real: { base: v26 * F, comp: p27, abs: p27 - v26 * F, pct: pctChange(v26 * F, p27) },
    };
  }

  /**
   * Comparación de un recorte (todas las jurisdicciones o una). Las filas "fuera del
   * gasto comparable" (amortización y aplicaciones financieras) quedan aparte y no
   * entran en los totales, como en el tablero de gastos.
   */
  function compare(progs, F, jur) {
    const sel = progs.filter(p => !jur || p.jur === jur);
    const comp = sel.filter(p => p.estado !== 'fuera');
    const v26 = comp.reduce((s, p) => s + p.v26, 0), p27 = comp.reduce((s, p) => s + p.p27, 0);
    const total = Object.assign({ v26, p27 }, sides(v26, p27, F));
    const items = comp.map(p => {
      const it = Object.assign({}, p, sides(p.v26, p.p27, F));
      it.aporte = {
        nominal: total.nominal.base ? it.nominal.abs / total.nominal.base * 100 : null,
        real: total.real.base ? it.real.abs / total.real.base * 100 : null,
      };
      it.share = { [Y0]: v26 ? p.v26 / v26 : null, [Y1]: p27 ? p.p27 / p27 : null };
      return it;
    });
    const withFte = sel.find(p => p.fte), fte = withFte ? withFte.fte.map(() => 0) : [];
    for (const p of comp) if (p.fte) p.fte.forEach((v, i) => { fte[i] += v; });
    return { items, total, fuentes: fte, fuera: sel.filter(p => p.estado === 'fuera') };
  }

  /** Mayores aumentos y caídas (sólo programas que continúan), por cambio en pesos del modo. */
  function rankings(items, mode, n = 10) {
    const cont = items.filter(i => i.estado === 'continua');
    const up = cont.filter(i => i[mode].abs > 0).sort((a, b) => b[mode].abs - a[mode].abs);
    const down = cont.filter(i => i[mode].abs < 0).sort((a, b) => a[mode].abs - b[mode].abs);
    return { up: up.slice(0, n), down: down.slice(0, n), upCount: up.length, downCount: down.length };
  }

  const byText = (x, y) => x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' });
  const ORDERS = ['abs', 'up', 'down', 'desc', 'asc', 'codigo', 'alfa'];
  function sortItems(items, orden, mode) {
    const by = {
      abs: (a, b) => Math.abs(b[mode].abs) - Math.abs(a[mode].abs),
      up: (a, b) => b[mode].abs - a[mode].abs,
      down: (a, b) => a[mode].abs - b[mode].abs,
      desc: (a, b) => b.p27 - a.p27 || b.v26 - a.v26,
      asc: (a, b) => a.p27 - b.p27 || a.v26 - b.v26,
      codigo: (a, b) => (+a.jur - +b.jur) || (a.prog - b.prog),
      alfa: (a, b) => byText(a.nombre, b.nombre),
    }[orden];
    if (!by) throw new Error('Orden desconocido: ' + orden);
    return items.slice().sort((a, b) => by(a, b) || byText(a.nombre, b.nombre) || (+a.jur - +b.jur) || (a.prog - b.prog));
  }

  const ProgramasMetrics = { Y0, Y1, pctChange, decode, sides, compare, rankings, sortItems, ORDERS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = ProgramasMetrics; return; }
  root.ProgramasMetrics = ProgramasMetrics;

  /* =================== interfaz =================== */
  const $ = id => document.getElementById(id);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MINUS = '−';
  const sign = n => (n > 0 ? '+' : n < 0 ? MINUS : '');
  const fmtFull = n => (n < 0 ? MINUS : '') + '$ ' + Math.round(Math.abs(n)).toLocaleString('es-AR');
  function fmtAbbrev(n) {
    const a = Math.abs(n), s = n < 0 ? MINUS : '';
    if (a >= 1e12) return s + '$ ' + nf(a / 1e12, 2) + ' billones';
    if (a >= 1e9) return s + '$ ' + nf(a / 1e9, 1) + ' mil M';
    if (a >= 1e6) return s + '$ ' + nf(a / 1e6, 1) + ' M';
    return fmtFull(n);
  }
  const fmtSignedAbbrev = n => (n > 0 ? '+' : '') + fmtAbbrev(n);
  const fmtSignedFull = n => (n > 0 ? '+' : '') + fmtFull(n);
  const fmtPct = p => (p == null ? 'No aplica' : sign(p) + nf(Math.abs(p), 1) + ' %');
  const fmtShare = p => (p == null ? '—' : nf(p * 100, 1) + ' %');
  const fmtPP = p => (p == null ? '—' : sign(p) + nf(Math.abs(p), 2) + ' pp');
  const arrow = n => (n > 0 ? '▲' : n < 0 ? '▼' : '=');
  const dirClass = n => (n > 0 ? 'up-text' : n < 0 ? 'down-text' : '');
  const COLOR_B = '#B4791E';
  const FONT = { family: 'Source Sans 3', size: 12 };
  const MONO = { family: 'IBM Plex Mono', size: 10.5 };

  let DATA = null, CMP = null, loadError = null;
  const charts = {};
  const state = { active: false, mode: 'real', jur: '', orden: 'abs', estado: '', q: '' };
  const ORDER_TEXT = {
    abs: 'mayor cambio en pesos', up: 'mayor aumento en pesos', down: 'mayor caída en pesos',
    desc: 'asignación de 2027, de mayor a menor', asc: 'asignación de 2027, de menor a mayor',
    codigo: 'código de jurisdicción y programa', alfa: 'orden alfabético',
  };
  const ESTADO_TXT = { continua: 'Continúa', nuevo: 'Nuevo en 2027', suprimido: 'Suprimido en 2027', fuera: 'Fuera del gasto comparable' };
  const ESTADO_CLS = { continua: 'continua', nuevo: 'nueva', suprimido: 'eliminada', fuera: '' };

  const chip = y => `<span class="yr ${y === Y0 ? 'a' : 'b'}">${y === Y0 ? 'Vigente' : 'Proyecto'} ${y}</span>`;
  const base = y => (y === Y0 ? 'Vigente al 30/06/2026' : 'Proyecto de Ley');
  const modeWord = () => (state.mode === 'real' ? 'real' : 'nominal');
  const varUnit = () => (state.mode === 'real'
    ? 'Variación real: diferencia expresada en pesos a precios de 2027 (IPC promedio de cada año)'
    : 'Variación nominal: diferencia en pesos corrientes, sin ajustar por inflación');
  const jurLabel = () => (state.jur ? DATA.jurName[state.jur] : 'Todas las jurisdicciones');

  /* ---- cabecera compartida: se cambia al entrar y se devuelve al salir ---- */
  const HEAD = {
    subtitle: 'Detalle por programa de cada jurisdicción: el Proyecto de Ley 2027 frente al crédito Vigente al 30/06/2026. Los montos se muestran en pesos corrientes de cada año (nominales); las variaciones se pueden ver en términos reales, a precios de 2027, o nominales.',
    'source-note': '2026: Vigente al 30/06/2026. 2027: Proyecto de Ley (cuadernillos por jurisdicción).',
    footer: 'Fuente: Proyecto de Ley de Presupuesto CABA 2027, cuadernillos por jurisdicción («Planillas desagregadas», Programa por Fuente de Financiamiento), y crédito vigente al 30/06/2026 (ejecutado oficial 2T-2026). Consolidado: Consolidado_Jurisdicciones_2027.csv. Variaciones reales a precios de 2027 con el IPC promedio de cada año.',
  };
  const headEls = () => ({
    subtitle: document.querySelector('.site-header .subtitle'),
    'source-note': document.querySelector('.site-header .source-note'),
    footer: document.querySelector('.site-footer p'),
  });
  let savedHead = null, savedDyn = null;
  function applyHeader() {
    const els = headEls();
    for (const [k, e] of Object.entries(els)) if (e && e.textContent !== HEAD[k]) e.textContent = HEAD[k];
    const ctx = `Programas: Proyecto ${Y1} vs. Vigente ${Y0}`;
    if ($('page-context').textContent !== ctx) $('page-context').textContent = ctx;
    const badge = state.mode === 'real' ? 'Variaciones reales (precios de 2027)' : 'Variaciones nominales';
    if ($('mode-badge').textContent !== badge) $('mode-badge').textContent = badge;
    const title = '¿A dónde va la plata de la Ciudad? · ' + ctx;
    if (document.title !== title) document.title = title;
  }
  function restoreHeader() {
    const els = headEls();
    if (savedHead) for (const [k, e] of Object.entries(els)) if (e && savedHead[k] != null) e.textContent = savedHead[k];
    if (savedDyn) { $('page-context').textContent = savedDyn.ctx; $('mode-badge').textContent = savedDyn.badge; document.title = savedDyn.title; }
  }

  /* ---- pestaña activa ---- */
  function setTabs() {
    for (const b of $('main-tabs').querySelectorAll('button[data-tab]')) {
      const on = b.dataset.tab === 'programas';
      if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on));
    }
  }
  function writeURL() {
    if (!state.active) return;
    const p = new URLSearchParams(location.search);
    for (const k of [...p.keys()]) if (!['a', 'b'].includes(k)) p.delete(k);   // se conservan los años de gastos
    p.set('tab', 'programas'); p.set('modo', state.mode);
    // pjur/porden: no se usan 'jur'/'orden' porque esos parámetros ya los leen app.js (filtro) e ingresos.js.
    if (state.jur) p.set('pjur', state.jur);
    if (state.orden !== 'abs') p.set('porden', state.orden);
    const q = '?' + p.toString();
    if (location.search !== q) try { history.replaceState(null, '', location.pathname + q); } catch (e) { /* sin history */ }
  }
  function readURL() {
    const p = new URLSearchParams(location.search);
    if (p.get('tab') !== 'programas') return false;
    if (p.get('modo') === 'real' || p.get('modo') === 'nominal') state.mode = p.get('modo');
    if (/^\d+$/.test(p.get('pjur') || '')) state.jur = p.get('pjur');
    if (ORDERS.includes(p.get('porden'))) state.orden = p.get('porden');
    return true;
  }
  function activate() {
    if (!state.active) {
      const els = headEls();
      savedHead = Object.fromEntries(Object.entries(els).map(([k, e]) => [k, e ? e.textContent : null]));
      savedDyn = { ctx: $('page-context').textContent, badge: $('mode-badge').textContent, title: document.title };
      const m = new URLSearchParams(location.search).get('modo');   // mismo modo que se venía viendo
      if (m === 'real' || m === 'nominal') state.mode = m;
    }
    state.active = true;
    document.body.classList.add('ver-programas');
    $('panel-programas').hidden = false;
    setTabs(); render();
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    document.body.classList.remove('ver-programas');
    $('panel-programas').hidden = true;
    restoreHeader();
  }

  /* ---- gráficos ---- */
  function draw(id, cfg) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = $(id);
    if (typeof Chart === 'undefined') { el.parentElement.innerHTML = '<p class="empty">No se pudo cargar la librería de gráficos. La tabla tiene los mismos datos.</p>'; return; }
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {});
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  const endLabels = fmt => ({
    id: 'endLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart, meta = chart.getDatasetMeta(0), ds = chart.data.datasets[0];
      ctx.save(); ctx.font = '600 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1C2431'; ctx.textAlign = 'left';
      meta.data.forEach((bar, i) => { if (ds.data[i] != null) ctx.fillText(fmt(ds.data[i], i), bar.x + 6, bar.y); });
      ctx.restore();
    },
  });

  /* ---- render ---- */
  function render() {
    applyHeader(); writeURL();
    if (loadError) { $('prg-status').hidden = false; $('prg-status').textContent = loadError; $('prg-body').hidden = true; return; }
    if (!DATA) { $('prg-status').hidden = false; $('prg-status').textContent = 'Cargando programas…'; $('prg-body').hidden = true; return; }
    $('prg-status').hidden = true; $('prg-body').hidden = false;
    CMP = compare(DATA.progs, DATA.F, state.jur);
    syncControls(); renderKPIs(); renderRankings(); renderAltasBajas(); renderFuentes(); renderTable(); renderFuera();
  }

  function syncControls() {
    for (const b of $('prg-mode-seg').querySelectorAll('button')) { const on = b.dataset.mode === state.mode; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; }
    $('prg-jur').value = state.jur; $('prg-order').value = state.orden; $('prg-estado').value = state.estado;
    if ($('prg-search').value !== state.q) $('prg-search').value = state.q;
  }

  function renderKPIs() {
    const t = CMP.total, m = state.mode;
    const amount = (y, cls, v) => `<div class="kpi ${cls}"><p class="label">${chip(y)} <span class="ver">${esc(base(y))}</span></p>
      <p class="value">${fmtAbbrev(v)}</p><p class="full">${fmtFull(v)} nominales</p></div>`;
    const vcard = (mm, title) => `<div class="kpi ${mm === m ? 'lead' : 'dim'}"><p class="label">${title}</p>
      <p class="value"><span class="${dirClass(t[mm].abs)}">${t[mm].pct == null ? 'No aplica' : arrow(t[mm].abs) + ' ' + fmtPct(t[mm].pct)}</span></p>
      <p class="sub">${fmtSignedAbbrev(t[mm].abs)} ${mm === 'real' ? 'a precios de 2027' : 'corrientes'}</p></div>`;
    $('prg-kpis').innerHTML = amount(Y0, 'a', t.v26) + amount(Y1, 'b', t.p27)
      + vcard('nominal', 'Variación nominal') + vcard('real', 'Variación real <span class="muted">(precios de 2027)</span>');
    const it = CMP.items, cont = it.filter(i => i.estado === 'continua');
    const up = cont.filter(i => i[m].abs > 0).length, down = cont.filter(i => i[m].abs < 0).length;
    const nNew = it.filter(i => i.estado === 'nuevo').length, nGone = it.filter(i => i.estado === 'suprimido').length;
    const where = state.jur ? `En ${esc(jurLabel())}, ${chip(Y1)}` : chip(Y1);
    $('prg-synthesis').innerHTML = `${where} representa una variación ${modeWord()} de <strong>${fmtPct(t[m].pct)}</strong> respecto de ${chip(Y0)}. `
      + `De ${cont.length} programas que continúan, ${up} ${up === 1 ? 'aumenta' : 'aumentan'} y ${down} ${down === 1 ? 'cae' : 'caen'} en términos ${m === 'real' ? 'reales' : 'nominales'}; `
      + `${nNew} ${nNew === 1 ? 'es nuevo' : 'son nuevos'} y ${nGone} ${nGone === 1 ? 'se suprime' : 'se suprimen'}.`;
    $('prg-filter-line').hidden = !state.jur;
    $('prg-filter-line').textContent = state.jur ? `Jurisdicción: ${jurLabel()}.` : '';
  }

  const jurTag = i => (state.jur ? '' : `<span class="prg-jur">${esc(i.jurNombre)}</span>`);
  function renderRankings() {
    const m = state.mode, R = rankings(CMP.items, m, 10);
    $('prg-rank-unit').innerHTML = `Montos nominales de cada año. ${esc(varUnit())}. Programas que continúan, ordenados por el cambio en pesos (los 10 que más se mueven en cada sentido). El aporte es la contribución del programa a la variación de ${state.jur ? 'la jurisdicción' : 'todo el gasto'}, en puntos porcentuales.`;
    const max = Math.max(1e-9, ...R.up.map(i => Math.abs(i[m].abs)), ...R.down.map(i => Math.abs(i[m].abs)));
    const li = (i, dir) => `<li class="rank-item">
        <span class="ri-name">${esc(i.nombre)} <span class="prg-code">prog. ${i.prog}</span>${jurTag(i)}</span>
        <span class="ri-bar" aria-hidden="true"><span class="${dir}" style="width:${Math.max(1.5, Math.abs(i[m].abs) / max * 100)}%"></span></span>
        <span class="ri-figs">
          <span class="${dirClass(i[m].abs)}"><strong>${arrow(i[m].abs)} ${fmtPct(i[m].pct)}</strong> (${fmtSignedAbbrev(i[m].abs)} ${modeWord()})</span>
          <span>${chip(Y0)} ${fmtAbbrev(i.v26)} → ${chip(Y1)} ${fmtAbbrev(i.p27)}</span>
          <span>Aporte ${fmtPP(i.aporte[m])}</span>
        </span></li>`;
    const none = t => `<li class="empty">${t}</li>`;
    $('prg-up').innerHTML = R.up.length ? R.up.map(i => li(i, 'up')).join('') : none('Ningún programa aumenta en este recorte.');
    $('prg-down').innerHTML = R.down.length ? R.down.map(i => li(i, 'down')).join('') : none('Ningún programa cae en este recorte.');
    $('prg-up-count').textContent = R.upCount > 10 ? `(10 de ${R.upCount})` : `(${R.upCount})`;
    $('prg-down-count').textContent = R.downCount > 10 ? `(10 de ${R.downCount})` : `(${R.downCount})`;
  }

  function renderAltasBajas() {
    const it = CMP.items;
    const altas = it.filter(i => i.estado === 'nuevo').sort((a, b) => b.p27 - a.p27);
    const bajas = it.filter(i => i.estado === 'suprimido').sort((a, b) => b.v26 - a.v26 || byText(a.nombre, b.nombre));
    const li = (i, y, v) => `<li><span class="prg-ab-name"><strong>${esc(i.nombre)}</strong> <span class="prg-code">prog. ${i.prog}</span>${jurTag(i)}${i.obs ? `<span class="prg-obs">${esc(i.obs)}</span>` : ''}</span>
      <span class="amt">${chip(y)} ${v ? fmtAbbrev(v) : '$ 0'}</span></li>`;
    $('prg-new').innerHTML = altas.length ? altas.map(i => li(i, Y1, i.p27)).join('') : '<li class="empty">Ninguno.</li>';
    $('prg-gone').innerHTML = bajas.length ? bajas.map(i => li(i, Y0, i.v26)).join('') : '<li class="empty">Ninguno.</li>';
    $('prg-new-count').textContent = `(${altas.length})`;
    $('prg-gone-count').textContent = `(${bajas.length})`;
    const sNew = altas.reduce((s, i) => s + i.p27, 0), sGone = bajas.reduce((s, i) => s + i.v26, 0);
    $('prg-ab-unit').innerHTML = `Según el código de programa: nuevo = con crédito en ${chip(Y1)} y sin fila en el vigente; suprimido = con fila en el vigente y sin crédito en ${chip(Y1)}. `
      + `Los nuevos suman ${fmtAbbrev(sNew)} en ${Y1}; los suprimidos tenían ${fmtAbbrev(sGone)} vigentes en ${Y0}. Las observaciones son las del consolidado (indican, por ejemplo, cuando un programa continúa con otro código).`;
  }

  function renderFuentes() {
    const names = DATA.meta.fuentes, f = CMP.fuentes, tot = f.reduce((s, v) => s + v, 0);
    const rows = names.map((n, i) => ({ id: n.id, nombre: n.nombre, v: f[i] || 0 })).sort((a, b) => b.v - a.v);
    $('prg-fte-unit').innerHTML = `Crédito de ${chip(Y1)} (${base(Y1)}) por fuente de financiamiento, en pesos corrientes. ${esc(jurLabel())}. La apertura por fuente sólo existe para ${Y1}: el consolidado no la trae para el vigente ${Y0}.`;
    draw('prg-fte-chart', {
      type: 'bar',
      data: { labels: rows.map(r => `${r.id} · ${r.nombre}`), datasets: [{ data: rows.map(r => r.v), backgroundColor: COLOR_B, barPercentage: 0.78, categoryPercentage: 0.9 }] },
      options: {
        indexAxis: 'y',
        scales: {
          x: { min: 0, grace: '22%', grid: { color: '#E4E0D2' }, ticks: { font: MONO, maxTicksLimit: 5, callback: v => (v === 0 ? '0' : fmtAbbrev(v)) } },
          y: { grid: { display: false }, ticks: { font: FONT, color: '#1C2431' } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtFull(c.raw)} · ${fmtShare(tot ? c.raw / tot : null)} del total` } } },
      },
      plugins: [endLabels(v => `${fmtAbbrev(v)} · ${fmtShare(tot ? v / tot : null)}`)],
    });
    $('prg-fte-table').innerHTML = `<thead><tr><th>Fuente</th><th class="num">${chip(Y1)}</th><th class="num">Participación</th></tr></thead><tbody>`
      + rows.map(r => `<tr><td>${esc(r.id)} · ${esc(r.nombre)}</td><td class="num">${fmtFull(r.v)}</td><td class="num">${fmtShare(tot ? r.v / tot : null)}</td></tr>`).join('')
      + `</tbody><tfoot><tr><td>Total</td><td class="num">${fmtFull(tot)}</td><td class="num">100,0 %</td></tr></tfoot>`;
  }

  function tableRows() {
    const q = state.q.trim().toLocaleLowerCase('es');
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
    const nq = norm(q);
    const rows = CMP.items.filter(i => (!state.estado || i.estado === state.estado)
      && (!nq || norm(i.nombre).includes(nq) || norm(i.jurNombre).includes(nq) || String(i.prog) === q));
    return sortItems(rows, state.orden, state.mode);
  }
  function renderTable() {
    const m = state.mode, rows = tableRows(), all = !state.jur;
    $('prg-table-unit').innerHTML = `Montos nominales completos de cada año. ${esc(varUnit())}. Ordenado por ${ORDER_TEXT[state.orden]}. ${rows.length} de ${CMP.items.length} programas.`;
    const cur = mm => (mm === m ? ' is-mode' : '');
    const head = `<thead><tr>${all ? '<th>Jurisdicción</th>' : ''}<th class="num">Prog.</th><th>Programa</th>
      <th class="num">${chip(Y0)}</th><th class="num">${chip(Y1)}</th>
      <th class="num">Cambio en pesos<br><span class="ver">${m === 'real' ? 'precios de 2027' : 'corrientes'}</span></th>
      <th class="num${cur('nominal')}">Variación<br>nominal</th><th class="num${cur('real')}">Variación<br>real</th>
      <th class="num">Aporte<br><span class="ver">${modeWord()}</span></th><th>Estado</th></tr></thead>`;
    const row = i => `<tr>${all ? `<td class="prg-jurcell">${esc(i.jurNombre)}</td>` : ''}<td class="num muted">${i.prog}</td>
      <td class="label prg-name"><strong>${esc(i.nombre)}</strong>${i.obs ? `<span class="prg-obs">${esc(i.obs)}</span>` : ''}</td>
      <td class="num">${fmtFull(i.v26)}</td><td class="num">${fmtFull(i.p27)}</td>
      <td class="num ${dirClass(i[m].abs)}">${arrow(i[m].abs)} ${fmtSignedFull(i[m].abs)}</td>
      <td class="num${cur('nominal')} ${dirClass(i.nominal.abs)}">${fmtPct(i.nominal.pct)}</td>
      <td class="num${cur('real')} ${dirClass(i.real.abs)}">${fmtPct(i.real.pct)}</td>
      <td class="num">${fmtPP(i.aporte[m])}</td>
      <td><span class="estado ${ESTADO_CLS[i.estado]}">${ESTADO_TXT[i.estado]}</span></td></tr>`;
    const sumOf = list => { const v26 = list.reduce((s, i) => s + i.v26, 0), p27 = list.reduce((s, i) => s + i.p27, 0); return Object.assign({ v26, p27 }, sides(v26, p27, DATA.F)); };
    const t = CMP.total;
    const foot = (s, label, ap) => `<tr class="total-row">${all ? '<td></td>' : ''}<td></td><td>${label}</td>
      <td class="num">${fmtFull(s.v26)}</td><td class="num">${fmtFull(s.p27)}</td>
      <td class="num ${dirClass(s[m].abs)}">${arrow(s[m].abs)} ${fmtSignedFull(s[m].abs)}</td>
      <td class="num${cur('nominal')}">${fmtPct(s.nominal.pct)}</td><td class="num${cur('real')}">${fmtPct(s.real.pct)}</td>
      <td class="num">${ap}</td><td></td></tr>`;
    const partial = rows.length !== CMP.items.length;
    const sub = sumOf(rows);
    $('prg-table').innerHTML = head + `<tbody>${rows.length ? rows.map(row).join('') : `<tr><td colspan="${all ? 10 : 9}" class="empty">Sin programas para esta búsqueda.</td></tr>`}</tbody><tfoot>`
      + (partial ? foot(sub, `Subtotal de las filas mostradas <span class="muted">(${rows.length})</span>`, fmtPP(t[m].base ? sub[m].abs / t[m].base * 100 : null)) : '')
      + foot(t, `Total ${esc(state.jur ? jurLabel() : 'del gasto comparable')} <span class="muted">(${CMP.items.length} programas)</span>`, fmtPP(t[m].pct)) + '</tfoot>';
  }

  function renderFuera() {
    const list = CMP.fuera;
    $('prg-fuera-card').hidden = !list.length;
    if (!list.length) return;
    $('prg-fuera').innerHTML = `<thead><tr><th>Jurisdicción</th><th class="num">Prog.</th><th>Programa</th><th class="num">${chip(Y1)}</th><th>Observación</th></tr></thead><tbody>`
      + list.map(i => `<tr><td>${esc(i.jurNombre)}</td><td class="num muted">${i.prog}</td><td>${esc(i.nombre)}</td><td class="num">${fmtFull(i.p27)}</td><td class="prg-obs-cell">${esc(i.obs)}</td></tr>`).join('') + '</tbody>';
  }

  /* ---- exportación ---- */
  function exportCSV() {
    const m = state.mode, rows = tableRows();
    const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const n = (v, d = 2) => (v == null ? '' : v.toFixed(d));
    const cols = ['jur', 'jur_nombre', 'prog', 'programa', 'estado', 'vigente_2026_30_06_pesos', 'proyecto_2027_pesos',
      'variacion_nominal_pesos', 'variacion_nominal_pct', 'variacion_real_pesos_2027', 'variacion_real_pct',
      'aporte_pp_' + m, ...DATA.meta.fuentes.map(f => 'fte' + f.id), 'observacion', 'recorte'];
    const lines = [cols.join(',')].concat(rows.map(i => [
      i.jur, q(i.jurNombre), i.prog, q(i.nombre), q(DATA.meta.estados[i.estado] || i.estado), i.v26, i.p27,
      i.nominal.abs, n(i.nominal.pct, 6), n(i.real.abs), n(i.real.pct, 6), n(i.aporte[m], 6),
      ...(i.fte || DATA.meta.fuentes.map(() => '')), q(i.obs), q(jurLabel()),
    ].join(',')));
    const blob = new Blob(['﻿' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `programas_${state.jur || 'todas'}_2026_a_2027.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---- eventos ---- */
  function bind() {
    const tabs = $('main-tabs');
    // Cualquier otra pestaña: esta se cierra primero (captura), así la siguiente encuentra la cabecera original.
    tabs.addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b && b.dataset.tab !== 'programas') deactivate(); }, true);
    $('tab-programas').addEventListener('click', e => { e.stopPropagation(); activate(); });   // no llega a app.js
    $('tab-programas').addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.stopPropagation(); e.preventDefault();
      const btns = [...tabs.querySelectorAll('button[data-tab]')], i = btns.indexOf(e.currentTarget);
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); n.click();
    });
    // Si app.js redibuja (p. ej., al terminar de cargar con ?tab=programas), se vuelve a marcar esta pestaña.
    new MutationObserver(() => { if (state.active) { setTabs(); applyHeader(); writeURL(); } })
      .observe(tabs, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });

    const seg = $('prg-mode-seg');
    seg.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) { state.mode = b.dataset.mode; render(); } });
    seg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      state.mode = state.mode === 'real' ? 'nominal' : 'real'; render();
      seg.querySelector(`[data-mode="${state.mode}"]`).focus();
    });
    $('prg-jur').addEventListener('change', e => { state.jur = e.target.value; render(); });
    $('prg-order').addEventListener('change', e => { state.orden = e.target.value; writeURL(); renderTable(); });
    $('prg-estado').addEventListener('change', e => { state.estado = e.target.value; renderTable(); });
    $('prg-search').addEventListener('input', e => { state.q = e.target.value; renderTable(); });
    $('prg-export').addEventListener('click', exportCSV);
  }

  function fillJur() {
    const opts = DATA.jurisdicciones.map(j => `<option value="${esc(j.id)}">${esc(j.nombre)}</option>`).join('');
    $('prg-jur').innerHTML = '<option value="">Todas</option>' + opts;
    if (state.jur && !DATA.jurName[state.jur]) state.jur = '';
  }

  async function init() {
    const start = readURL();
    bind();
    if (start) activate();
    try {
      const json = root.__PROGRAMAS__ || await fetch('programas.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      DATA = decode(json); fillJur();
    } catch (err) {
      loadError = 'No se pudieron cargar los datos de programas (programas.json): ' + err.message + '. Si abriste index.html con doble clic, serví la carpeta por HTTP (por ejemplo, python3 -m http.server).';
    }
    if (state.active) render();
  }
  document.addEventListener('DOMContentLoaded', init);
})(typeof self !== 'undefined' ? self : this);
