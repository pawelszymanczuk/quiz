(() => {
  // ---------- Dane ----------
  const world = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries).features;
  const byName = new Map(world.map(f => [f.properties.name, f]));

  const COUNTRY_ITEMS = {};
  for (const [key, cont] of Object.entries(CONTINENTS)) {
    COUNTRY_ITEMS[key] = cont.countries.map(c => {
      const feats = [].concat(c.e).map(n => byName.get(n)).filter(Boolean);
      if (!feats.length && !c.p) console.warn('Brak obrysu dla', c.n);
      return { ...c, type: 'country', cont: key, key: 'country:' + key + ':' + c.n, feats };
    });
  }

  const CITY_ITEMS = {};
  for (const [key, reg] of Object.entries(CITY_REGIONS)) {
    CITY_ITEMS[key] = reg.cities.map(c => ({
      ...c,
      type: 'city',
      cont: key,
      key: 'city:' + key + ':' + c.n,
      feats: []
    }));
  }

  let category = 'countries';
  const activeRegions = () => (category === 'cities' ? CITY_REGIONS : CONTINENTS);
  const activeItems = () => (category === 'cities' ? CITY_ITEMS : COUNTRY_ITEMS);

  // ---------- Elementy UI ----------
  const $ = id => document.getElementById(id);
  const contSel = $('continent'), modeSel = $('mode');
  const nameIn = $('nameIn'), capIn = $('capIn'), nameLabel = $('nameLabel');
  const feedback = $('feedback'), statsEl = $('stats'), summary = $('summary');
  const catRadios = document.querySelectorAll('input[name="category"]');

  function populateContinents(preferKey) {
    const regs = activeRegions();
    const items = activeItems();
    contSel.innerHTML = '';
    let totalAll = 0;
    for (const [key, reg] of Object.entries(regs)) {
      const count = items[key].length;
      totalAll += count;
      contSel.add(new Option(`${reg.label} (${count})`, key));
    }
    if (category === 'cities') {
      contSel.add(new Option('Cały świat – losowe 30 miast', 'random30'));
      contSel.add(new Option(`Wszystkie regiony (${totalAll})`, 'all'));
    } else {
      contSel.add(new Option('Cały świat – losowe 30 państw', 'random30'));
      contSel.add(new Option('Wszystkie kontynenty (cały świat)', 'all'));
    }

    let mapped = preferKey;
    if (mapped === 'ameryka_pd' && category === 'cities') mapped = 'ameryka_lac';
    if (mapped === 'ameryka_lac' && category === 'countries') mapped = 'ameryka_pd';
    if (mapped && (regs[mapped] || mapped === 'all' || mapped === 'random30')) {
      contSel.value = mapped;
    }
  }

  // Odczyt hash z URL (np. #cities, #cities:azja, #europa, #random30)
  const rawHash = location.hash.slice(1);
  let initRegion = '';
  if (rawHash.startsWith('cities')) {
    category = 'cities';
    initRegion = rawHash.split(':')[1] || '';
  } else if (rawHash) {
    initRegion = rawHash;
  }
  catRadios.forEach(r => { r.checked = r.value === category; });
  modeSel.classList.toggle('hidden', category === 'cities');
  populateContinents(initRegion);

  // ---------- Mapa ----------
  const svg = d3.select('#map');
  const g = svg.append('g');
  let projection, path, countriesSel, markerG, featItem = new Map();
  let currentView = null, currentCont = null, k = 1, curTransform = d3.zoomIdentity;

  const zoom = d3.zoom().scaleExtent([1, 60]).on('zoom', e => {
    curTransform = e.transform;
    g.attr('transform', e.transform);
    k = e.transform.k;
    if (!markerG) return;
    markerG.selectAll('circle.ring').attr('r', 14 / k);
    markerG.selectAll('line.cross').each(function(d) {
      d3.select(this)
        .attr('x1', d.cx + d.dx1 / k).attr('y1', d.cy + d.dy1 / k)
        .attr('x2', d.cx + d.dx2 / k).attr('y2', d.cy + d.dy2 / k);
    });
    markerG.selectAll('circle.dot').attr('r', d => d.r / k);
  });
  svg.call(zoom).on('dblclick.zoom', null);

  svg.on('click', e => {
    if (!learnMode || category !== 'cities' || !currentCont || !projection) return;
    const [mx, my] = d3.pointer(e, svg.node());
    let best = null, bestDist = 24;
    for (const it of CITY_ITEMS[currentCont]) {
      const [cx, cy] = projection(it.p);
      const dist = Math.hypot(curTransform.applyX(cx) - mx, curTransform.applyY(cy) - my);
      if (dist < bestDist) { bestDist = dist; best = it; }
    }
    if (best) onMapClick(best);
  });

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
    currentCont = contKey;
    currentView = category + ':' + contKey;
    const regs = activeRegions();
    const items = activeItems()[contKey];
    const cont = regs[contKey];
    const [w, h] = size();
    projection = d3.geoAzimuthalEqualArea().rotate(cont.rotate).clipAngle(110);
    const fitFeatures = cont.fitPoints
      ? [{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: cont.fitPoints } }]
      : items.flatMap(i => i.feats.length ? i.feats : [{ type: 'Feature', geometry: { type: 'Point', coordinates: i.p } }]);
    projection.fitExtent([[18, 18], [w - 18, h - 18]], { type: 'FeatureCollection', features: fitFeatures });
    path = d3.geoPath(projection);

    featItem = new Map();
    if (category === 'countries') {
      for (const it of items) for (const f of it.feats) featItem.set(f, it);
    }

    g.selectAll('*').remove();
    countriesSel = g.append('g').selectAll('path').data(world).join('path')
      .attr('d', path)
      .on('click', (e, f) => {
        if (category === 'countries') onMapClick(featItem.get(f));
      });
    markerG = g.append('g');
    svg.call(zoom.transform, d3.zoomIdentity);
    updateMap();
  }

  function focusItem() { return learnMode ? learnPick : current; }

  function drawTargetCrosshair(x, y) {
    markerG.append('circle').attr('class', 'ring marker').attr('cx', x).attr('cy', y).attr('r', 14 / k);
    const ticks = [
      { cx: x, cy: y, dx1: 0, dy1: -14, dx2: 0, dy2: -20 },
      { cx: x, cy: y, dx1: 0, dy1: 14, dx2: 0, dy2: 20 },
      { cx: x, cy: y, dx1: -14, dy1: 0, dx2: -20, dy2: 0 },
      { cx: x, cy: y, dx1: 14, dy1: 0, dx2: 20, dy2: 0 }
    ];
    markerG.selectAll('line.cross').data(ticks).join('line')
      .attr('class', 'cross marker')
      .attr('x1', d => d.cx + d.dx1 / k).attr('y1', d => d.cy + d.dy1 / k)
      .attr('x2', d => d.cx + d.dx2 / k).attr('y2', d => d.cy + d.dy2 / k);
  }

  function updateMap() {
    if (!countriesSel || !currentCont) return;
    const fi = focusItem();
    const isCityMode = category === 'cities';
    const target = !isCityMode && fi && fi.cont === currentCont ? new Set(fi.feats) : new Set();

    countriesSel.attr('class', f => {
      if (isCityMode) return 'country city-bg';
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

    markerG.selectAll('*').remove();

    if (isCityMode) {
      const list = CITY_ITEMS[currentCont];
      const others = list.filter(it => it !== fi).map(it => ({
        it,
        c: projection(it.p),
        r: learnMode ? 4 : 3.2,
        target: false
      }));

      markerG.selectAll('circle.other').data(others).join('circle')
        .attr('class', 'dot marker-dot')
        .attr('cx', d => d.c[0]).attr('cy', d => d.c[1]).attr('r', d => d.r / k)
        .style('fill', d => {
          const st = results.get(d.it.key);
          if (st === 'ok') return '#22c55e';
          if (st === 'bad') return '#fb7185';
          return learnMode ? '#f59e0b' : '#64748b';
        })
        .style('stroke', '#ffffff')
        .style('cursor', learnMode ? 'pointer' : null)
        .on('click', (e, d) => { e.stopPropagation(); onMapClick(d.it); });

      if (fi && fi.cont === currentCont) {
        const [x, y] = projection(fi.p);
        drawTargetCrosshair(x, y);
        markerG.append('circle')
          .datum({ it: fi, c: [x, y], r: 4.8 })
          .attr('class', 'dot city-target-dot')
          .attr('cx', x).attr('cy', y).attr('r', 4.8 / k)
          .style('cursor', learnMode ? 'pointer' : null)
          .on('click', e => { e.stopPropagation(); onMapClick(fi); });
      }
      return;
    }

    // Tryb państw: kropki dla bardzo małych państw
    const dots = [];
    for (const it of COUNTRY_ITEMS[currentCont]) {
      const b = itemBounds(it);
      if (isTiny(b)) dots.push({ it, c: center(b), r: it === fi ? 4.5 : 3 });
    }
    markerG.selectAll('circle.dot').data(dots).join('circle')
      .attr('class', 'dot marker-dot')
      .attr('cx', d => d.c[0]).attr('cy', d => d.c[1]).attr('r', d => d.r / k)
      .style('fill', d => d.it === fi ? '#ef4444' : (results.get(d.it.key) === 'ok' ? '#22c55e' : results.get(d.it.key) === 'bad' ? '#f87171' : '#f59e0b'))
      .style('cursor', learnMode ? 'pointer' : null)
      .on('click', (e, d) => onMapClick(d.it));

    if (fi && fi.cont === currentCont) {
      const b = itemBounds(fi);
      if (isTiny(b)) {
        const [x, y] = center(b);
        drawTargetCrosshair(x, y);
      }
    }
  }

  function zoomToTarget() {
    const fi = focusItem();
    if (!fi || fi.cont !== currentCont) return;
    const [w, h] = size();
    const b = itemBounds(fi);
    const [cx, cy] = center(b);
    let s;
    if (fi.type === 'city') {
      s = k < 4.5 ? 5.5 : (k < 11 ? 12 : 5.5);
    } else {
      const dx = Math.max(b[1][0] - b[0][0], 1), dy = Math.max(b[1][1] - b[0][1], 1);
      s = Math.max(1, Math.min(16, 0.5 / Math.max(dx / w, dy / h)));
    }
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(w / 2 - s * cx, h / 2 - s * cy).scale(s));
  }

  $('zIn').onclick = () => svg.transition().call(zoom.scaleBy, 1.8);
  $('zOut').onclick = () => svg.transition().call(zoom.scaleBy, 1 / 1.8);
  $('zReset').onclick = () => svg.transition().call(zoom.transform, d3.zoomIdentity);
  $('zTarget').onclick = zoomToTarget;

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => currentCont && renderMap(currentCont), 200);
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
    const dict = activeItems();
    let pool;
    if (items) {
      pool = items;
    } else if (key === 'random30') {
      const all = Object.values(dict).flat();
      pool = d3.shuffle(all.slice()).slice(0, 30);
    } else if (key === 'all') {
      pool = Object.values(dict).flat();
    } else {
      pool = dict[key];
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
    const targetView = category + ':' + current.cont;
    if (targetView !== currentView) renderMap(current.cont);
    else { svg.call(zoom.transform, d3.zoomIdentity); updateMap(); }

    if (category === 'cities') {
      nameLabel.textContent = 'Miasto';
      $('nameField').classList.remove('hidden');
      $('capField').classList.add('hidden');
      $('given').classList.add('hidden');
      nameIn.setAttribute('enterkeyhint', 'done');
    } else {
      const mode = modeSel.value;
      nameLabel.textContent = 'Państwo';
      $('nameField').classList.toggle('hidden', mode === 'capital');
      $('capField').classList.toggle('hidden', mode === 'name');
      $('given').classList.toggle('hidden', mode !== 'capital');
      $('given').textContent = mode === 'capital' ? current.n : '';
      nameIn.setAttribute('enterkeyhint', mode === 'both' ? 'next' : 'done');
    }
    nameIn.value = ''; capIn.value = '';
    nameIn.disabled = capIn.disabled = false;
    $('checkBtn').parentElement.classList.remove('hidden');
    $('nextRow').classList.add('hidden');
    feedback.innerHTML = '';
    renderStats();
    ((category !== 'cities' && modeSel.value === 'capital') ? capIn : nameIn).focus();
  }

  function check(giveUp) {
    if (answered) return next();
    answered = true;
    let ok = true, html = '';

    if (category === 'cities') {
      const r = giveUp ? 'bad' : match(nameIn.value, [current.n, ...(current.an || [])]);
      if (r === 'bad') ok = false;
      html += line('Miasto', r, current.n, nameIn.value);
      if (current.k) html += `<div style="color:#cbd5e1;font-size:14px;margin-top:2px">Państwo: <b>${esc(current.k)}</b></div>`;
    } else {
      const mode = modeSel.value;
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
    }

    if (!firstTry.has(current.key)) firstTry.set(current.key, ok);
    if (ok) { stats.ok++; results.set(current.key, 'ok'); }
    else {
      stats.bad++; results.set(current.key, 'bad');
      queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 4)), 0, current);
      const noun = category === 'cities' ? 'miasto' : 'państwo';
      html += `<div style="color:#94a3b8;font-size:13px;margin-top:4px">To ${noun} wróci za chwilę.</div>`;
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
    const regLabel = activeRegions()[current.cont].label;
    statsEl.innerHTML = `${regLabel} · opanowane <b>${mastered}/${total}</b> · <span class="ok">✔ ${stats.ok}</span> · <span class="bad">✘ ${stats.bad}</span>`;
  }

  function finish() {
    current = null;
    updateMap();
    const wrong = Object.values(activeItems()).flat().filter(it => firstTry.get(it.key) === false);
    const good = [...firstTry.values()].filter(Boolean).length;
    $('quizBox').classList.add('hidden');
    feedback.innerHTML = '';
    summary.classList.remove('hidden');
    const formatWrong = w => w.type === 'city'
      ? `<li>${esc(w.n)} <span style="color:#94a3b8">(${esc(w.k)})</span></li>`
      : `<li>${esc(w.n)} – ${esc(w.c)}</li>`;
    summary.innerHTML = `<h3 style="margin:0 0 6px">🎉 Koniec!</h3>
      <div>Za pierwszym razem dobrze: <b>${good}/${total}</b> (${Math.round(100 * good / total)}%)</div>
      ${wrong.length ? `<div style="margin-top:8px">Do powtórki:</div><ul>${wrong.map(formatWrong).join('')}</ul>
      <div class="row"><button id="retryBad" type="button" class="primary">Powtórz tylko błędne</button></div>` : '<div class="ok">Bezbłędnie!</div>'}
      <div class="row" style="margin-top:8px"><button id="retryAll" type="button">Jeszcze raz wszystko</button></div>`;
    if (wrong.length) $('retryBad').onclick = () => start(wrong);
    $('retryAll').onclick = () => start();
  }

  // ---------- Tryb nauki ----------
  function learnPromptText() {
    return category === 'cities'
      ? 'Kliknij kropkę miasta na mapie, aby zobaczyć jego nazwę i państwo.'
      : 'Kliknij państwo na mapie, aby zobaczyć jego nazwę i stolicę.';
  }

  function toggleLearn() {
    learnMode = !learnMode;
    learnPick = null;
    $('learnBtn').textContent = learnMode ? '✍️ Wróć do quizu' : '📖 Tryb nauki';
    $('learnInfo').classList.toggle('hidden', !learnMode);
    $('learnInfo').innerHTML = learnPromptText();
    summary.classList.toggle('hidden', learnMode || !!current || !firstTry.size);
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
    if (it.type === 'city') {
      $('learnInfo').innerHTML = `<div style="font-size:22px;font-weight:600">${esc(it.n)}</div><div style="font-size:16px;color:#cbd5e1">Państwo: <b>${esc(it.k)}</b></div>`;
    } else {
      $('learnInfo').innerHTML = `<div style="font-size:22px;font-weight:600">${esc(it.n)}</div><div style="font-size:17px">Stolica: <b>${esc(it.c)}</b></div>`;
    }
    updateMap();
  }

  // ---------- Zdarzenia ----------
  $('checkBtn').onclick = () => check(false);
  $('skipBtn').onclick = () => check(true);
  $('nextBtn').onclick = () => next();
  $('restart').onclick = () => start();
  $('learnBtn').onclick = toggleLearn;

  catRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      const prevRegion = contSel.value;
      category = r.value;
      modeSel.classList.toggle('hidden', category === 'cities');
      populateContinents(prevRegion);
      learnPick = null;
      if (learnMode) {
        $('learnInfo').innerHTML = learnPromptText();
        const isMulti = contSel.value === 'all' || contSel.value === 'random30';
        renderMap(isMulti ? 'europa' : contSel.value);
      } else {
        start();
      }
    });
  });

  contSel.onchange = () => {
    const isMulti = contSel.value === 'all' || contSel.value === 'random30';
    if (learnMode) {
      learnPick = null;
      $('learnInfo').innerHTML = learnPromptText();
      renderMap(isMulti ? 'europa' : contSel.value);
    } else {
      start();
    }
  };
  modeSel.onchange = () => { if (!learnMode) start(); };

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || learnMode || !current) return;
    e.preventDefault();
    if (answered) return next();
    if (category === 'countries' && document.activeElement === nameIn && modeSel.value === 'both') {
      return capIn.focus();
    }
    check(false);
  });

  start();
})();
