/* ingresos.js — Pestaña "Ingresos" del tablero Presupuesto CABA.
 *
 * Fuente independiente: ingresos.json (generado por build_ingresos.py a partir de
 * fuentes/ingresos_tributarios_caba_2026_2027.csv). No usa presupuesto.json, ni
 * metrics.js, ni el estado de app.js: la sección de gastos queda intacta.
 *
 * Columnas: recurso_id (clave estable), recurso (nombre), anio (2026 | 2027),
 * monto_nominal (modo nominal) y monto_real_2027 (modo real, precios de 2027).
 * Variación: (valor_2027 / valor_2026 − 1) × 100, con los montos del modo elegido.
 *
 * Integración con la página: el botón "Ingresos" vive en la misma barra de
 * pestañas que las de gastos. Su clic se atiende en el propio botón (antes de que
 * llegue a la barra), así app.js nunca se entera; al volver a una pestaña de
 * gastos, app.js la dibuja como siempre.
 */
(function (root) {
  'use strict';

  /* =================== cálculos (sin DOM; los usa test_ingresos.js) =================== */
  const Y0 = 2026, Y1 = 2027;
  const pctChange = (a, b) => (a === 0 ? null : (b / a - 1) * 100);

  function decode(json) {
    if (!json || !json.meta || json.meta.schema !== 'ingresos-1') throw new Error('ingresos.json no tiene schema ingresos-1.');
    const recursos = json.recursos.map((r, i) => ({
      id: r.recurso_id || r.id, nombre: r.nombre, origen: r.origen, grupo: r.grupo, orden: i,
      v: {
        [Y0]: { nominal: r.anios[Y0].nominal, real: r.anios[Y0].real },
        [Y1]: { nominal: r.anios[Y1].nominal, real: r.anios[Y1].real },
      },
    }));
    return { meta: json.meta, recursos };
  }

  /** Comparación 2026 → 2027 de cada recurso, en los dos modos. */
  function compare(recursos) {
    const tot = { [Y0]: { nominal: 0, real: 0 }, [Y1]: { nominal: 0, real: 0 } };
    for (const r of recursos) for (const y of [Y0, Y1]) for (const m of ['nominal', 'real']) tot[y][m] += r.v[y][m];
    const side = (a, b) => ({ base: a, comp: b, abs: b - a, pct: pctChange(a, b) });
    const items = recursos.map(r => ({
      id: r.id, nombre: r.nombre, origen: r.origen, grupo: r.grupo, orden: r.orden, v: r.v,
      nominal: side(r.v[Y0].nominal, r.v[Y1].nominal),
      real: side(r.v[Y0].real, r.v[Y1].real),
      // La participación es la misma en los dos modos (un solo factor por año).
      share: { [Y0]: tot[Y0].nominal ? r.v[Y0].nominal / tot[Y0].nominal : null, [Y1]: tot[Y1].nominal ? r.v[Y1].nominal / tot[Y1].nominal : null },
    }));
    const sum = list => {
      const t = { [Y0]: { nominal: 0, real: 0 }, [Y1]: { nominal: 0, real: 0 } };
      for (const r of list) for (const y of [Y0, Y1]) for (const m of ['nominal', 'real']) t[y][m] += r.v[y][m];
      return { v: t, nominal: side(t[Y0].nominal, t[Y1].nominal), real: side(t[Y0].real, t[Y1].real) };
    };
    return { items, total: sum(recursos), propios: sum(recursos.filter(r => r.origen === 'Fuente propia')), sum };
  }

  /**
   * Orden de los recursos.
   *  aumento_real — mayor variación real primero
   *  caida_real   — mayor caída real primero (variación real más negativa)
   *  cambio_pesos — mayor cambio en pesos (valor absoluto, en el modo elegido)
   *  monto        — mayor monto del año elegido (en el modo elegido)
   */
  const ORDERS = ['aumento_real', 'caida_real', 'cambio_pesos', 'monto'];
  function sortItems(items, orden, mode, year) {
    const nul = (v, d) => (v == null ? d : v);
    const by = {
      aumento_real: (a, b) => nul(b.real.pct, -Infinity) - nul(a.real.pct, -Infinity),
      caida_real: (a, b) => nul(a.real.pct, Infinity) - nul(b.real.pct, Infinity),
      cambio_pesos: (a, b) => Math.abs(b[mode].abs) - Math.abs(a[mode].abs),
      monto: (a, b) => b.v[year][mode] - a.v[year][mode],
    }[orden];
    if (!by) throw new Error('Orden desconocido: ' + orden);
    return items.slice().sort((a, b) => by(a, b) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  const IngresosMetrics = { Y0, Y1, pctChange, decode, compare, sortItems, ORDERS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = IngresosMetrics; return; }
  root.IngresosMetrics = IngresosMetrics;

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
  const arrow = n => (n > 0 ? '▲' : n < 0 ? '▼' : '=');
  const dirClass = n => (n > 0 ? 'up-text' : n < 0 ? 'down-text' : '');
  const COLOR = { [Y0]: '#445066', [Y1]: '#B4791E' }, UP = '#1F5C57', DOWN = '#A23B2E';
  const FONT = { family: 'Source Sans 3', size: 12 };

  let DATA = null, CMP = null, loadError = null;
  const charts = {};
  const state = { active: false, mode: 'real', year: Y1, orden: 'aumento_real' };
  const ORDER_TEXT = {
    aumento_real: 'mayor aumento real', caida_real: 'mayor caída real',
    cambio_pesos: 'mayor cambio en pesos', monto: 'mayor monto',
  };

  const base = y => (DATA ? DATA.meta.bases[y] : (y === Y0 ? 'Vigente al 30/06/2026' : 'Proyecto de Ley'));
  const chip = y => `<span class="yr ${y === Y0 ? 'a' : 'b'}">${y}</span>`;
  const chipBase = y => `${chip(y)} <span class="ver">${esc(base(y))}</span>`;
  const modeWord = () => (state.mode === 'real' ? 'real' : 'nominal');
  const unitWord = () => (state.mode === 'real' ? 'a precios de 2027' : 'nominales');

  /* ---- cabecera compartida: se cambia al entrar y se devuelve al salir ---- */
  const HEAD = {
    'page-title': '¿De dónde vienen los recursos de la Ciudad?',
    subtitle: 'Recursos tributarios de la Ciudad: lo vigente al 30/06/2026 frente a lo que proyecta el Proyecto de Ley 2027. Los montos y las variaciones se ven en pesos de cada año (nominales) o a precios de 2027 (reales).',
    'source-note': '2026: Vigente al 30/06/2026. 2027: Proyecto de Ley de Presupuesto.',
    footer: 'Fuente: Mensaje del Proyecto de Presupuesto CABA 2027, Cuadro 3.4 (Composición de los Recursos Tributarios). Montos vigentes al 30/06/2026 y proyectados para 2027; no son recaudación percibida. Valores reales a precios de 2027 con el IPC promedio de cada año.',
  };
  const headEls = () => ({
    'page-title': $('page-title'),
    subtitle: document.querySelector('.site-header .subtitle'),
    'source-note': document.querySelector('.site-header .source-note'),
    footer: document.querySelector('.site-footer p'),
  });
  let savedHead = null, savedDyn = null;
  function applyHeader() {
    const els = headEls();
    if (!savedHead) savedHead = Object.fromEntries(Object.entries(els).map(([k, e]) => [k, e ? e.textContent : null]));
    for (const [k, e] of Object.entries(els)) if (e) e.textContent = HEAD[k];
    const ctx = `Ingresos tributarios: ${base(Y1)} ${Y1} vs. ${base(Y0)}`;
    if ($('page-context').textContent !== ctx) $('page-context').textContent = ctx;
    const badge = state.mode === 'real' ? 'Montos y variaciones reales (precios de 2027)' : 'Montos y variaciones nominales';
    if ($('mode-badge').textContent !== badge) $('mode-badge').textContent = badge;
    const title = '¿De dónde vienen los recursos de la Ciudad? · ' + ctx;
    if (document.title !== title) document.title = title;
  }
  function restoreHeader() {
    const els = headEls();
    if (savedHead) for (const [k, e] of Object.entries(els)) if (e && savedHead[k] != null) e.textContent = savedHead[k];
    // page-context, mode-badge y título los vuelve a escribir app.js al dibujar la pestaña de gastos;
    // se reponen igual por si app.js no llegó a cargar.
    if (savedDyn) { $('page-context').textContent = savedDyn.ctx; $('mode-badge').textContent = savedDyn.badge; document.title = savedDyn.title; }
  }

  /* ---- pestaña activa ---- */
  function setTabs() {
    for (const b of $('main-tabs').querySelectorAll('button[data-tab]')) {
      const on = (b.dataset.tab === 'ingresos') === state.active;
      if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on));
    }
  }
  function writeURL() {
    if (!state.active) return;
    const p = new URLSearchParams(location.search);
    p.set('tab', 'ingresos'); p.set('modo', state.mode); p.set('anio', state.year); p.set('orden', state.orden);
    const q = '?' + p.toString();
    if (location.search !== q) try { history.replaceState(null, '', location.pathname + q); } catch (e) { /* sin history */ }
  }
  function readURL() {
    const p = new URLSearchParams(location.search);
    if (p.get('modo') === 'real' || p.get('modo') === 'nominal') state.mode = p.get('modo');
    if (+p.get('anio') === Y0 || +p.get('anio') === Y1) state.year = +p.get('anio');
    if (ORDERS.includes(p.get('orden'))) state.orden = p.get('orden');
    return p.get('tab') === 'ingresos';
  }
  function activate() {
    if (!state.active) {
      savedDyn = { ctx: $('page-context').textContent, badge: $('mode-badge').textContent, title: document.title };
      // Mismo modo (real/nominal) que se venía viendo en gastos.
      const m = new URLSearchParams(location.search).get('modo');
      if (m === 'real' || m === 'nominal') state.mode = m;
    }
    state.active = true;
    document.body.classList.add('ver-ingresos');
    $('panel-ingresos').hidden = false;
    setTabs(); render();
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    document.body.classList.remove('ver-ingresos');
    $('panel-ingresos').hidden = true;
    restoreHeader();
  }

  /* ---- gráficos ---- */
  const endLabels = fmt => ({
    id: 'endLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart, meta = chart.getDatasetMeta(0), ds = chart.data.datasets[0];
      ctx.save(); ctx.font = '600 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle';
      meta.data.forEach((bar, i) => {
        const v = ds.data[i]; if (v == null) return;
        const neg = v < 0; ctx.fillStyle = '#1C2431'; ctx.textAlign = neg ? 'right' : 'left';
        ctx.fillText(fmt(v, i), bar.x + (neg ? -6 : 6), bar.y);
      });
      ctx.restore();
    },
  });
  function draw(id, cfg) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = $(id);
    if (typeof Chart === 'undefined') { el.parentElement.innerHTML = '<p class="empty">No se pudo cargar la librería de gráficos. La tabla tiene los mismos datos.</p>'; return; }
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {});
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  const shortName = s => (s.length > 34 ? s.slice(0, 32) + '…' : s);

  /* ---- render ---- */
  function render() {
    applyHeader(); writeURL();
    if (loadError) { $('ing-status').hidden = false; $('ing-status').textContent = loadError; $('ing-body').hidden = true; return; }
    if (!DATA) { $('ing-status').hidden = false; $('ing-status').textContent = 'Cargando ingresos…'; $('ing-body').hidden = true; return; }
    $('ing-status').hidden = true; $('ing-body').hidden = false;
    syncControls(); renderKPIs(); renderRecursos(); renderBases();
  }

  function syncControls() {
    for (const b of $('ing-mode-seg').querySelectorAll('button')) { const on = b.dataset.mode === state.mode; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; }
    $('ing-year').value = state.year; $('ing-order').value = state.orden;
  }

  function renderKPIs() {
    const m = state.mode, t = CMP.total;
    const amount = (y, cls) => `<div class="kpi ${cls}"><p class="label">Total ${chipBase(y)}</p>
      <p class="value">${fmtAbbrev(t.v[y][m])}</p><p class="full">${fmtFull(t.v[y][m])} ${unitWord()}</p></div>`;
    const vcard = (mm, title) => `<div class="kpi ${mm === m ? 'lead' : 'dim'}"><p class="label">${title}</p>
      <p class="value"><span class="${dirClass(t[mm].abs)}">${arrow(t[mm].abs)} ${fmtPct(t[mm].pct)}</span></p>
      <p class="sub">${fmtSignedAbbrev(t[mm].abs)} ${mm === 'real' ? 'a precios de 2027' : 'corrientes'}</p></div>`;
    $('ing-kpis').innerHTML = amount(Y0, 'a') + amount(Y1, 'b') + vcard('nominal', 'Variación nominal')
      + vcard('real', 'Variación real <span class="muted">(precios de 2027)</span>');
    const items = CMP.items, up = items.filter(i => i[m].abs > 0).length, down = items.filter(i => i[m].abs < 0).length;
    const top = items.slice().sort((a, b) => b.v[Y1].nominal - a.v[Y1].nominal)[0];
    $('ing-synthesis').innerHTML = `Lo proyectado para ${chip(Y1)} implica una variación ${modeWord()} de <strong>${fmtPct(t[m].pct)}</strong> respecto de lo vigente en ${chip(Y0)}: `
      + `${up} de los ${items.length} recursos ${up === 1 ? 'aumenta' : 'aumentan'} y ${down} ${down === 1 ? 'cae' : 'caen'}. `
      + `${esc(top.nombre)} explica el ${fmtShare(top.share[Y1])} del total de ${Y1}.`;
  }

  function renderRecursos() {
    const m = state.mode, y = state.year;
    const list = sortItems(CMP.items, state.orden, m, y);
    const realNote = state.orden === 'aumento_real' || state.orden === 'caida_real'
      ? (m === 'nominal' ? ' Este orden usa siempre la variación real, aunque la vista esté en nominal.' : '')
      : state.orden === 'monto' ? ` (monto ${m === 'real' ? 'real' : 'nominal'} de ${y})` : ` (${m === 'real' ? 'real' : 'nominal'}, en valor absoluto)`;
    $('ing-unit').innerHTML = `${m === 'real' ? 'Montos a precios de 2027 (columna <code>monto_real_2027</code>).' : 'Montos en pesos corrientes de cada año (columna <code>monto_nominal</code>).'} `
      + `Variación ${modeWord()}: (valor ${Y1} / valor ${Y0} − 1) × 100. Ordenado por ${ORDER_TEXT[state.orden]}${realNote}`;
    $('ing-var-title').textContent = `Variación ${modeWord()} ${Y0}–${Y1}`;
    $('ing-amt-title').innerHTML = `Monto por recurso en ${chip(y)} <span class="muted">(${m === 'real' ? 'precios de 2027' : 'pesos corrientes'})</span>`;

    const labels = list.map(i => shortName(i.nombre));
    const h = Math.max(260, list.length * 34 + 40);
    $('ing-var-box').style.height = h + 'px'; $('ing-amt-box').style.height = h + 'px';
    const vals = list.map(i => i[m].pct);
    const span = Math.max(5, ...vals.map(v => Math.abs(v || 0)));
    draw('ing-var', {
      type: 'bar',
      data: { labels, datasets: [{ data: vals, backgroundColor: vals.map(v => (v >= 0 ? UP : DOWN)), barPercentage: 0.78, categoryPercentage: 0.9 }] },
      options: {
        indexAxis: 'y', layout: { padding: { left: 4, right: 8 } },
        scales: {
          x: { suggestedMin: -span * 1.4, suggestedMax: span * 1.4, grid: { color: c => (c.tick.value === 0 ? '#1C2431' : '#ECE7D9') }, ticks: { font: FONT, callback: v => nf(v, 0) + ' %' } },
          y: { grid: { display: false }, ticks: { font: FONT, color: '#1C2431' } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtPct(c.raw)} · ${fmtSignedAbbrev(list[c.dataIndex][m].abs)} ${unitWord()}` } } },
      },
      plugins: [endLabels(v => fmtPct(v))],
    });
    const amts = list.map(i => i.v[y][m]);
    draw('ing-amt', {
      type: 'bar',
      data: { labels, datasets: [{ data: amts, backgroundColor: COLOR[y], barPercentage: 0.78, categoryPercentage: 0.9 }] },
      options: {
        indexAxis: 'y',
        scales: {
          x: { min: 0, grace: '22%', grid: { color: '#ECE7D9' }, ticks: { font: FONT, maxTicksLimit: 5, callback: v => (v === 0 ? '0' : fmtAbbrev(v).replace('$ ', '')) } },
          y: { grid: { display: false }, ticks: { font: FONT, color: '#1C2431' } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtFull(c.raw)} · ${fmtShare(list[c.dataIndex].share[y])} del total` } } },
      },
      plugins: [endLabels((v, i) => fmtShare(list[i].share[y]))],
    });

    const cur = mm => (mm === m ? ' is-mode' : '');
    const head = `<thead><tr><th class="num">#</th><th>Recurso</th>
      <th class="num">${chip(Y0)}<br><span class="ver">${esc(base(Y0))}</span></th>
      <th class="num">${chip(Y1)}<br><span class="ver">${esc(base(Y1))}</span></th>
      <th class="num">Cambio en pesos<br><span class="ver">${m === 'real' ? 'precios de 2027' : 'corrientes'}</span></th>
      <th class="num${cur('nominal')}">Variación<br>nominal</th><th class="num${cur('real')}">Variación<br>real</th>
      <th class="num">Participación<br>en ${chip(y)}</th></tr></thead>`;
    const row = (i, n) => `<tr><td class="num muted">${n}</td><td class="label"><strong>${esc(i.nombre)}</strong><span class="ing-origen">${esc(i.origen)}</span></td>
      <td class="num">${fmtFull(i.v[Y0][m])}</td><td class="num">${fmtFull(i.v[Y1][m])}</td>
      <td class="num ${dirClass(i[m].abs)}">${arrow(i[m].abs)} ${fmtSignedFull(i[m].abs)}</td>
      <td class="num${cur('nominal')} ${dirClass(i.nominal.abs)}">${fmtPct(i.nominal.pct)}</td>
      <td class="num${cur('real')} ${dirClass(i.real.abs)}">${fmtPct(i.real.pct)}</td>
      <td class="num">${fmtShare(i.share[y])}</td></tr>`;
    const tot = (t, label, share) => `<tr class="total-row"><td></td><td>${label}</td>
      <td class="num">${fmtFull(t.v[Y0][m])}</td><td class="num">${fmtFull(t.v[Y1][m])}</td>
      <td class="num ${dirClass(t[m].abs)}">${arrow(t[m].abs)} ${fmtSignedFull(t[m].abs)}</td>
      <td class="num${cur('nominal')}">${fmtPct(t.nominal.pct)}</td><td class="num${cur('real')}">${fmtPct(t.real.pct)}</td>
      <td class="num">${share}</td></tr>`;
    const nPropios = CMP.items.filter(i => i.origen === 'Fuente propia').length;
    const p = CMP.propios;
    $('ing-table').innerHTML = head + `<tbody>${list.map((i, k) => row(i, k + 1)).join('')}</tbody><tfoot>`
      + tot(p, `Subtotal de fuente propia <span class="muted">(${nPropios} recursos)</span>`, fmtShare(CMP.total.v[y].nominal ? p.v[y].nominal / CMP.total.v[y].nominal : null))
      + tot(CMP.total, `Total <span class="muted">(${CMP.items.length} recursos)</span>`, '100,0 %') + '</tfoot>';
  }

  function renderBases() {
    const mt = DATA.meta;
    $('ing-bases').innerHTML = `
      <div class="ing-base a"><p class="ing-base-y">${chip(Y0)}</p><p class="ing-base-t">${esc(mt.bases[Y0])}</p>
        <p class="ing-base-d">Recursos vigentes informados por el GCBA a esa fecha.</p></div>
      <div class="ing-base b"><p class="ing-base-y">${chip(Y1)}</p><p class="ing-base-t">${esc(mt.bases[Y1])}</p>
        <p class="ing-base-d">Recursos proyectados en el Proyecto de Ley de Presupuesto ${Y1}.</p></div>`;
  }

  /* ---- eventos ---- */
  function bind() {
    const tabs = $('main-tabs');
    for (const b of tabs.querySelectorAll('button[data-tab]')) {
      b.addEventListener('click', e => {
        if (b.dataset.tab === 'ingresos') { e.stopPropagation(); activate(); }   // no llega a app.js
        else deactivate();                                                       // app.js dibuja la pestaña de gastos
      });
    }
    // Teclado: app.js mueve el foco con ← → entre todos los botones de la barra (incluido éste).
    // Desde "Ingresos", el evento se atiende acá para no depender de cuándo cargó app.js.
    $('tab-ingresos').addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.stopPropagation(); e.preventDefault();
      const btns = [...tabs.querySelectorAll('button[data-tab]')], i = btns.indexOf(e.currentTarget);
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); n.click();
    });
    // Si app.js redibuja (p. ej., al terminar de cargar con ?tab=ingresos), se vuelve a marcar esta pestaña.
    new MutationObserver(() => { if (state.active) { setTabs(); applyHeader(); writeURL(); } })
      .observe(tabs, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });

    const seg = $('ing-mode-seg');
    seg.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) { state.mode = b.dataset.mode; render(); } });
    seg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      state.mode = state.mode === 'real' ? 'nominal' : 'real'; render();
      seg.querySelector(`[data-mode="${state.mode}"]`).focus();
    });
    $('ing-year').addEventListener('change', e => { state.year = +e.target.value; render(); });
    $('ing-order').addEventListener('change', e => { state.orden = e.target.value; render(); });
  }

  async function init() {
    const start = readURL();
    bind();
    if (start) activate();
    try {
      const json = root.__INGRESOS__ || await fetch('ingresos.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      DATA = decode(json); CMP = compare(DATA.recursos);
    } catch (err) {
      loadError = 'No se pudieron cargar los datos de ingresos (ingresos.json): ' + err.message + '. Si abriste index.html con doble clic, serví la carpeta por HTTP (por ejemplo, python3 -m http.server).';
    }
    if (state.active) render();
  }
  document.addEventListener('DOMContentLoaded', init);
})(typeof self !== 'undefined' ? self : this);
