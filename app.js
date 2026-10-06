(() => {
  // ---------- Dane ----------
  const world = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries).features;
  const byName = new Map(world.map(f => [f.properties.name, f]));

  const ITEMS = {};
  for (const [key, cont] of Object.entries(CONTINENTS)) {
    ITEMS[key] = cont.countries.map(c => {
      const feats = [].concat(c.e).map(n => byName.get(n)).filter(Boolean);
      if (!feats.length && !c.p) console.warn('Brak obrysu dla', c.n);
      return { ...c, cont: key, key: key + ':' + c.n, feats };
    });
  }

  // ---------- Elementy UI ----------
  const $ = id => document.getElementById(id);
  const contSel = $('continent'), modeSel = $('mode');
  const nameIn = $('nameIn'), capIn = $('capIn');
  const feedback = $('feedback'), statsEl = $('stats'), summary = $('summary');

  for (const [key, cont] of Object.entries(CONTINENTS)) contSel.add(new Option(`${cont.label} (${cont.countries.length})`, key));
  contSel.add(new Option('Cały świat – losowe 30 państw', 'random30'));
  contSel.add(new Option('Wszystkie kontynenty (cały świat)', 'all'));
  const hash = location.hash.slice(1);
  if (CONTINENTS[hash] || hash === 'all' || hash === 'random30') contSel.value = hash;

  // ---------- Mapa ----------
  const svg = d3.select('#map');
  const g = svg.append('g');
  let projection, path, countriesSel, markerG, featItem = new Map(), currentView = null, k = 1;

  const zoom = d3.zoom().scaleExtent([1, 60]).on('zoom', e => {
    g.attr('transform', e.transform);
    k = e.transform.k;
    markerG.selectAll('circle.ring').attr('r', 16 / k);
    markerG.selectAll('circle.dot').attr('r', d => d.r / k);
  });
  svg.call(zoom).on('dblclick.zoom', null);

  function size() {
    const r = svg.node().getBoundingClientRect();
    return [Math.max(r.width, 200), Math.max(r.height, 200)];
  }

  function itemBounds(it) {
    if (!it.feats.length) {
      const [x, y] = projection(it.p);
      return [[x, y], [x, y]];
    }
    let b = [[Infinity, Infinity], [-Infinity, -Infinity]];
    for (const f of it.feats) {
      const fb = path.bounds(f);
      b = [[Math.min(b[0][0], fb[0][0]), Math.min(b[0][1], fb[0][1])], [Math.max(b[1][0], fb[1][0]), Math.max(b[1][1], fb[1][1])]];
    }
    return b;
  }
  const isTiny = b => Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1]) < 8;
  const center = b => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];

  function renderMap(contKey) {
    currentView = contKey;
    const cont = CONTINENTS[contKey];
    const [w, h] = size();
    projection = d3.geoAzimuthalEqualArea().rotate(cont.rotate).clipAngle(100);
    const fitFeatures = cont.fitPoints
      ? [{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: cont.fitPoints } }]
      : ITEMS[contKey].flatMap(i => i.feats.length ? i.feats : [{ type: 'Feature', geometry: { type: 'Point', coordinates: i.p } }]);
    projection.fitExtent([[15, 15], [w - 15, h - 15]], { type: 'FeatureCollection', features: fitFeatures });
    path = d3.geoPath(projection);

    featItem = new Map();
    for (const it of ITEMS[contKey]) for (const f of it.feats) featItem.set(f, it);

    g.selectAll('*').remove();
    countriesSel = g.append('g').selectAll('path').data(world).join('path')
      .attr('d', path)
      .on('click', (e, f) => onMapClick(featItem.get(f)));
    markerG = g.append('g');
    svg.call(zoom.transform, d3.zoomIdentity);
    updateMap();
  }

  function focusItem() { return learnMode ? learnPick : current; }

  function updateMap() {
    if (!countriesSel) return;
    const fi = focusItem();
    const target = fi && fi.cont === currentView ? new Set(fi.feats) : new Set();
    countriesSel.attr('class', f => {
      let c = 'country';
      const it = featItem.get(f);
      if (it) {
        c += ' quiz';
        const r = results.get(it.key);
        if (r) c += ' done-' + r;
        if (learnMode) c += ' learn';
      }
      if (target.has(f)) c += ' target';
      return c;
    });

    // kropki dla bardzo małych państw (żeby było je widać / dało się kliknąć)
    markerG.selectAll('*').remove();
    const dots = [];
    for (const it of ITEMS[currentView]) {
      const b = itemBounds(it);
      if (isTiny(b)) dots.push({ it, c: center(b), r: it === fi ? 4.5 : 3 });
    }
    markerG.selectAll('circle.dot').data(dots).join('circle')
      .attr('class', 'dot marker-dot')
      .attr('cx', d => d.c[0]).attr('cy', d => d.c[1]).attr('r', d => d.r / k)
      .style('fill', d => d.it === fi ? '#ef4444' : (results.get(d.it.key) === 'ok' ? '#22c55e' : results.get(d.it.key) === 'bad' ? '#f87171' : '#f59e0b'))
      .style('cursor', learnMode ? 'pointer' : null)
      .on('click', (e, d) => onMapClick(d.it));

    if (fi && fi.cont === currentView) {
      const b = itemBounds(fi);
      if (isTiny(b)) {
        const [x, y] = center(b);
        markerG.append('circle').attr('class', 'ring marker').attr('cx', x).attr('cy', y).attr('r', 16 / k);
      }
    }
  }

  function zoomToTarget() {
    const fi = focusItem();
    if (!fi || fi.cont !== currentView) return;
    const [w, h] = size();
    const b = itemBounds(fi);
    const dx = Math.max(b[1][0] - b[0][0], 1), dy = Math.max(b[1][1] - b[0][1], 1);
    const s = Math.max(1, Math.min(16, 0.5 / Math.max(dx / w, dy / h)));
    const [cx, cy] = center(b);
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(w / 2 - s * cx, h / 2 - s * cy).scale(s));
  }

  $('zIn').onclick = () => svg.transition().call(zoom.scaleBy, 1.8);
  $('zOut').onclick = () => svg.transition().call(zoom.scaleBy, 1 / 1.8);
  $('zReset').onclick = () => svg.transition().call(zoom.transform, d3.zoomIdentity);
  $('zTarget').onclick = zoomToTarget;

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => currentView && renderMap(currentView), 200);
  });

  // ---------- Sprawdzanie odpowiedzi ----------
  const norm = s => s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  function match(input, answers) {
    const x = norm(input);
    if (!x) return 'bad';
    let best = 'bad';
    for (const a of answers) {
      const y = norm(a);
      if (x === y) return 'ok';
      const tol = y.length >= 8 ? 2 : y.length >= 5 ? 1 : 0;
      if (lev(x, y) <= tol) best = 'typo';
    }
    return best;
  }

  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function line(label, res, correct, typed) {
    if (res === 'ok') return `<div class="ok">✔ ${label}: <b>${esc(correct)}</b></div>`;
    if (res === 'typo') return `<div class="warn">✔ ${label}: <b>${esc(correct)}</b> (literówka: „${esc(typed)}”)</div>`;
    return `<div class="bad">✘ ${label}: poprawnie <b>${esc(correct)}</b>${typed.trim() ? ` (wpisano: „${esc(typed)}”)` : ''}</div>`;
  }

  // ---------- Quiz ----------
  let queue = [], current = null, answered = false, results = new Map(), firstTry = new Map(), stats = { ok: 0, bad: 0 }, total = 0;
  let learnMode = false, learnPick = null;

  function start(items) {
    if (learnMode) toggleLearn();
    const key = contSel.value;
    let pool;
    if (items) {
      pool = items;
    } else if (key === 'random30') {
      const all = Object.values(ITEMS).flat();
      pool = d3.shuffle(all.slice()).slice(0, 30);
    } else if (key === 'all') {
      pool = Object.values(ITEMS).flat();
    } else {
      pool = ITEMS[key];
    }
    queue = d3.shuffle(pool.slice());
    total = pool.length;
    results = new Map(); firstTry = new Map(); stats = { ok: 0, bad: 0 };
    summary.classList.add('hidden');
    $('quizBox').classList.remove('hidden');
    next();
  }

  function next() {
    if (!queue.length) return finish();
    current = queue.shift();
    answered = false;
    if (current.cont !== currentView) renderMap(current.cont);
    else { svg.call(zoom.transform, d3.zoomIdentity); updateMap(); }

    const mode = modeSel.value;
    $('nameField').classList.toggle('hidden', mode === 'capital');
    $('capField').classList.toggle('hidden', mode === 'name');
    $('given').classList.toggle('hidden', mode !== 'capital');
    $('given').textContent = mode === 'capital' ? current.n : '';
    nameIn.value = ''; capIn.value = '';
    nameIn.disabled = capIn.disabled = false;
    $('checkBtn').parentElement.classList.remove('hidden');
    $('nextRow').classList.add('hidden');
    feedback.innerHTML = '';
    renderStats();
    (mode === 'capital' ? capIn : nameIn).focus();
  }

  function check(giveUp) {
    if (answered) return next();
    answered = true;
    const mode = modeSel.value;
    let ok = true, html = '';
    if (mode !== 'capital') {
      const r = giveUp ? 'bad' : match(nameIn.value, [current.n, ...(current.an || [])]);
      if (r === 'bad') ok = false;
      html += line('Państwo', r, current.n, nameIn.value);
    } else html += `<div>Państwo: <b>${esc(current.n)}</b></div>`;
    if (mode !== 'name') {
      const r = giveUp ? 'bad' : match(capIn.value, [current.c, ...(current.ac || [])]);
      if (r === 'bad') ok = false;
      html += line('Stolica', r, current.c, capIn.value);
    } else html += `<div>Stolica: <b>${esc(current.c)}</b></div>`;

    if (!firstTry.has(current.key)) firstTry.set(current.key, ok);
    if (ok) { stats.ok++; results.set(current.key, 'ok'); }
    else {
      stats.bad++; results.set(current.key, 'bad');
      // błędne wraca za kilka pytań
      queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 4)), 0, current);
      html += `<div style="color:#94a3b8;font-size:13px;margin-top:4px">To państwo wróci za chwilę.</div>`;
    }
    feedback.innerHTML = html;
    nameIn.disabled = capIn.disabled = true;
    $('checkBtn').parentElement.classList.add('hidden');
    $('nextRow').classList.remove('hidden');
    $('nextBtn').focus();
    updateMap();
    renderStats();
  }

  function renderStats() {
    const mastered = [...results.values()].filter(v => v === 'ok').length;
    statsEl.innerHTML = `${CONTINENTS[current.cont].label} · opanowane <b>${mastered}/${total}</b> · <span class="ok">✔ ${stats.ok}</span> · <span class="bad">✘ ${stats.bad}</span>`;
  }

  function finish() {
    current = null;
    updateMap();
    const wrong = Object.values(ITEMS).flat().filter(it => firstTry.get(it.key) === false);
    const good = [...firstTry.values()].filter(Boolean).length;
    $('quizBox').classList.add('hidden');
    feedback.innerHTML = '';
    summary.classList.remove('hidden');
    summary.innerHTML = `<h3 style="margin:0 0 6px">🎉 Koniec!</h3>
      <div>Za pierwszym razem dobrze: <b>${good}/${total}</b> (${Math.round(100 * good / total)}%)</div>
      ${wrong.length ? `<div style="margin-top:8px">Do powtórki:</div><ul>${wrong.map(w => `<li>${esc(w.n)} – ${esc(w.c)}</li>`).join('')}</ul>
      <div class="row"><button id="retryBad" class="primary">Powtórz tylko błędne</button></div>` : '<div class="ok">Bezbłędnie!</div>'}
      <div class="row" style="margin-top:8px"><button id="retryAll">Jeszcze raz wszystko</button></div>`;
    if (wrong.length) $('retryBad').onclick = () => start(wrong);
    $('retryAll').onclick = () => start();
  }

  // ---------- Tryb nauki ----------
  function toggleLearn() {
    learnMode = !learnMode;
    learnPick = null;
    $('learnBtn').textContent = learnMode ? '✍️ Wróć do quizu' : '📖 Tryb nauki';
    $('learnInfo').classList.toggle('hidden', !learnMode);
    $('learnInfo').innerHTML = 'Kliknij państwo na mapie, aby zobaczyć jego nazwę i stolicę.';
    $('quizBox').classList.toggle('hidden', learnMode || !current);
    feedback.classList.toggle('hidden', learnMode);
    if (learnMode) {
      const isMulti = contSel.value === 'all' || contSel.value === 'random30';
      renderMap(isMulti ? (current ? current.cont : 'europa') : contSel.value);
    } else if (current) {
      renderMap(current.cont);
    } else updateMap();
  }

  function onMapClick(it) {
    if (!learnMode || !it) return;
    learnPick = it;
    $('learnInfo').innerHTML = `<div style="font-size:22px;font-weight:600">${esc(it.n)}</div><div style="font-size:17px">Stolica: <b>${esc(it.c)}</b></div>`;
    updateMap();
  }

  // ---------- Zdarzenia ----------
  $('checkBtn').onclick = () => check(false);
  $('skipBtn').onclick = () => check(true);
  $('nextBtn').onclick = () => next();
  $('restart').onclick = () => start();
  $('learnBtn').onclick = toggleLearn;
  contSel.onchange = () => {
    const isMulti = contSel.value === 'all' || contSel.value === 'random30';
    learnMode ? renderMap(isMulti ? 'europa' : contSel.value) : start();
  };
  modeSel.onchange = () => { if (!learnMode) start(); };

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || learnMode || !current) return;
    e.preventDefault();
    if (answered) return next();
    if (document.activeElement === nameIn && modeSel.value === 'both') return capIn.focus();
    check(false);
  });

  start();
})();
