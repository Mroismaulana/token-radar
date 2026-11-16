(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('board');
  var state = { tab: 'pre', q: '', category: 'all', chain: 'all', sort: 'rank', dir: 1, minTvl: 0, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = n > 0 ? '+' : '';
    return s + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function num(n) { return Number(n).toLocaleString('en-US'); }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its primary chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 25e7) return 120;
    if (p.tvl_usd >= 5e7) return 75;
    return 40;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 120) return 75;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(), name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply about $' + capital + ' in a supported stable or blue-chip asset on ' + name + ' (' + chain + ') and keep utilization healthy to build lending history.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity') >= 0) return "Provide roughly $" + capital + " of liquidity in " + name + "'s main pool on " + chain + ', rebalance if needed, and avoid tiny positions that get eaten by fees.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit about $' + capital + ' as collateral on ' + name + ' and execute a few small, low-leverage trades on ' + chain + ' to show real usage.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge about $' + capital + ' through ' + name + ' to ' + chain + ' and make at least one follow-up onchain action so the route records meaningful activity.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake about $' + capital + ' worth of the native asset via ' + name + ' on ' + chain + ' and retain the receipt token to demonstrate ongoing participation.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with about $' + capital + ' and place a small number of informed positions over time rather than one-off activity on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Allocate about $" + capital + " into " + name + "'s primary product on " + chain + ' and complete any required verification steps published by the protocol.';
    if (c.indexOf('stable') >= 0) return "Mint or deposit about $" + capital + " into " + name + "'s stable or savings product on " + chain + ' and maintain the position through multiple snapshots.';
    return "Deposit about $" + capital + " into " + name + "'s core product on " + chain + ' and use its main feature at least once per week to create consistent onchain history.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var chains = p.chains && p.chains.length ? p.chains.slice(0, 3).join(', ') : chain;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var weeklyGas = capital >= 150 ? 3 : 2;
    return [
      { t: 'Prepare a dedicated wallet for ' + p.name + ': fund it on ' + chains + ', keep seed/private keys offline, and label it so farming activity stays separate.', c: 'under $' + gas + ' in initial gas', m: '10 minutes' },
      { t: actionFor(p, capital, chain), c: 'about $' + capital + ' capital plus ~$' + gas + ' gas', m: '15-25 minutes to set up' },
      { t: 'Repeat meaningful interactions weekly (deposit, swap, borrow, repay, or governance where available) so usage spans multiple periods, not a single burst.', c: 'about $' + weeklyGas + ' gas per week', m: '10 minutes per week' },
      { t: 'Maintain the position for at least ' + hold + ' days before any unwind, because age and consistency often matter more than one large transaction.', c: 'capital remains deployed (~$' + capital + ')', m: hold + ' days hold window' },
      { t: "Track every transaction hash, date, and amount in a simple log and monitor " + p.name + "'s official announcements for points, quests, or eligibility updates.", c: 'no extra fee (time only)', m: '10 minutes weekly review' },
      { t: 'If rewards are announced, claim only via links published by ' + p.name + "'s official channels, verify contract addresses, and avoid paying upfront \"claim\" fees.", c: 'claim gas varies; never send funds to unknown claim sites', m: '10-20 minutes when claiming' }
    ];
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function impliedOf(r, m) {
    var growth = clamp(r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = r.age_days === null || r.age_days === undefined ? m.unknown_age_days : r.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chainCount = Math.max(1, (r.chains || []).length);
    var chainMult = 1 + Math.min(chainCount - 1, m.chain_cap) * m.chain_weight;
    var cat = (r.category || '').toLowerCase();
    var catMult = 1.0;
    if (cat.indexOf('lending') >= 0 || cat.indexOf('cdp') >= 0) catMult = 1.08;
    else if (cat.indexOf('dex') >= 0 || cat.indexOf('derivatives') >= 0 || cat.indexOf('perp') >= 0) catMult = 1.06;
    else if (cat.indexOf('yield') >= 0 || cat.indexOf('liquid staking') >= 0 || cat.indexOf('restaking') >= 0) catMult = 1.04;
    else if (cat.indexOf('bridge') >= 0 || cat.indexOf('chain') >= 0) catMult = 1.03;
    else if (cat.indexOf('rwa') >= 0 || cat.indexOf('prediction') >= 0 || cat.indexOf('options') >= 0) catMult = 1.02;
    return Math.max(1, Math.round(r.tvl_usd * m.base_multiple * growthMult * maturity * chainMult * catMult));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail' });
  dialog.addEventListener('close', function () { state.selected = null; syncHash(); render(); });

  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = p.get('dir') === 'desc' ? -1 : 1;
    if (p.get('minTvl')) state.minTvl = Number(p.get('minTvl')) || 0;
    if (p.get('p')) state.selected = p.get('p');
  }
  function syncHash() {
    var p = new URLSearchParams();
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir !== 1) p.set('dir', state.dir < 0 ? 'desc' : 'asc');
    if (state.minTvl) p.set('minTvl', String(state.minTvl));
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  function categories() { return Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort(); }
  function chains() { var set = {}; DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { set[c] = true; }); }); return Object.keys(set).sort(); }

  function filteredPre() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = key === 'rank' ? 1 : state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d == null ? -1e18 : a.change_7d; bv = b.change_7d == null ? -1e18 : b.change_7d; }
      else if (key === 'age') { av = a.age_days == null ? 1e18 : a.age_days; bv = b.age_days == null ? 1e18 : b.age_days; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortTh(key, label) {
    var arrow = state.sort === key ? (state.dir > 0 ? ' ↑' : ' ↓') : '';
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; }
      syncHash(); render();
    } }, label + arrow));
  }

  function openDetail(slug) {
    var r = DATA.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    state.selected = slug; syncHash();
    var steps = farmSteps(r);
    var recomputed = impliedOf(r, DATA.model);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'dh' },
      el('div', null,
        el('div', { class: 'brand-name', text: 'Rank #' + r.rank + ' · ' + (r.category || 'Other') }),
        el('h2', { text: r.name }),
        el('div', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.join(', ') : 'No chain listed') + ' · listed ' + (r.listed_at || 'unknown') })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'db' },
      el('section', { class: 'sec' },
        el('h3', { text: 'Implied value model (snapshot-derived)' }),
        el('div', { class: 'kv' },
          kv('TVL (USD)', fmtUsd(r.tvl_usd)), kv('7d change', fmtPct(r.change_7d)),
          kv('Age with no token', fmtAge(r.age_days)), kv('Base multiple', String(DATA.model.base_multiple)),
          kv('Growth multiplier', String(r.growth_multiplier)), kv('Maturity multiplier', String(r.maturity_multiplier)),
          kv('Chain multiplier', String(r.chain_multiplier || 1)), kv('Category multiplier', String(r.category_multiplier || 1)),
          kv('Implied value', fmtUsd(r.implied_value_usd)), kv('Recomputed in page', fmtUsd(recomputed) + (recomputed === r.implied_value_usd ? ' ✓' : ''))
        ),
        el('p', { class: 'note', text: 'Implied value follows snapshot figures only (TVL, 7d growth, age/listing, chain breadth, category). It is a model estimate, not a price or a promise of a token launch.' })
      ),
      el('section', { class: 'sec' },
        el('h3', { text: 'How to farm this protocol' }),
        el('ol', { class: 'steps' }, steps.map(function (s) { return el('li', null, el('b', { text: s.t }), el('div', { class: 'sub', text: 'Cost: ' + s.c + ' · Time: ' + s.m })); }))
      ),
      el('section', { class: 'sec' },
        el('h3', { text: 'Protocol facts (from snapshot)' }),
        el('div', { class: 'kv' },
          kv('Slug', r.slug), kv('Watchlist', r.on_watchlist ? 'yes (must-cover)' : 'no (early find below floor)'),
          kv('Market cap recorded', r.mcap_usd == null ? 'none (pre-token)' : fmtUsd(r.mcap_usd)),
          kv('Token symbol/id', (r.symbol || r.gecko_id) ? ((r.symbol || '-') + ' / ' + (r.gecko_id || '-')) : 'none recorded'), kv('Snapshot as of', DATA.as_of)
        )
      )
    ));
    if (!dialog.isConnected) document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }
  function kv(k, v) { return el('div', null, el('span', { text: k }), el('b', { text: v })); }

  function tablePre() {
    var list = sorted(filteredPre());
    if (!list.length) return el('div', { class: 'empty' }, 'No protocols match the current filters. Clear search or loosen filters to see the ranked board.');
    var max = 1; list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tb = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { tabindex: '0', 'data-selected': state.selected === r.slug ? 'true' : 'false', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num' }, String(r.rank)),
        el('td', { class: 'wrap' }, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug }))),
        el('td', null, r.category || 'Other'),
        el('td', { class: 'wrap sub' }, (r.chains || []).slice(0, 3).join(', ') || '—'),
        el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'num ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d)),
        el('td', { class: 'num' }, fmtAge(r.age_days)),
        el('td', { class: 'barcell' }, el('div', { class: 'num' }, fmtUsd(r.implied_value_usd)), el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }))),
        el('td', null, el('span', { class: r.on_watchlist ? 'badge watch' : 'badge early' }, r.on_watchlist ? 'watchlist' : 'early find'))
      );
      tb.appendChild(tr);
    });
    return el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null, sortTh('rank','Rank'), sortTh('name','Protocol'), el('th', { scope:'col', text:'Category'}), el('th',{scope:'col',text:'Chains'}), sortTh('tvl','TVL'), sortTh('growth','7d'), sortTh('age','Age'), sortTh('implied','Implied value'), el('th',{scope:'col',text:'Status'}))),
      tb
    ));
  }

  function tableLive() {
    var tb = el('tbody');
    (DATA.live || []).forEach(function (r, i) {
      tb.appendChild(el('tr', null,
        el('td', { class: 'num' }, String(i + 1)),
        el('td', { class: 'wrap' }, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug }))),
        el('td', null, r.category || 'Other'),
        el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'num' }, fmtUsd(r.mcap_usd)),
        el('td', { class: 'num ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d)),
        el('td', null, el('span', { class: 'badge live' }, 'token live'))
      ));
    });
    return el('div', { class: 'table-wrap' }, el('table', null,
      el('thead', null, el('tr', null, el('th',{scope:'col',text:'#'}), el('th',{scope:'col',text:'Protocol'}), el('th',{scope:'col',text:'Category'}), el('th',{scope:'col',text:'TVL'}), el('th',{scope:'col',text:'Market cap'}), el('th',{scope:'col',text:'7d'}), el('th',{scope:'col',text:'Status'}))),
      tb
    ));
  }

  function render() {
    var preList = filteredPre();
    root.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar · ' + DATA.model_version })),
      el('div', { class: 'meta' }, el('span', { text: 'Snapshot: ' + DATA.as_of }), el('span', { text: 'Source: DefiLlama protocols index' }), el('span', { text: 'Watchlist floor: ' + fmtUsd(DATA.floor_usd) }))
    ));
    shell.appendChild(el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Pre-token launch radar ranked by implied value' }),
        el('p', { text: 'This dashboard ranks protocols that still record no token in the sealed snapshot. It covers every watchlist protocol and adds early pre-token candidates below the floor. Implied value is derived from snapshot figures only and is an estimate, not a launch prediction or price target.' })
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: num(DATA.watchlist_size) + ' / ' + num(DATA.watchlist_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Ranked pre-token rows' }), el('b', { text: num(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below floor' }), el('b', { text: num(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: num(DATA.live_size) }))
      )
    ));

    var panel = el('section', { class: 'panel' });
    var q = el('input', { type:'search', value: state.q, placeholder:'Search protocol, slug, chain, category' });
    q.addEventListener('input', function () {
      state.q = q.value;
      var caret = q.selectionStart == null ? q.value.length : q.selectionStart;
      syncHash(); render();
      var next = root.querySelector('input[type="search"]');
      if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch (e) {} }
    });
    var cat = el('select');
    cat.appendChild(el('option', { value:'all', text:'All categories' }));
    categories().forEach(function (c) { var o = el('option', { value:c, text:c }); if (state.category===c) o.selected=true; cat.appendChild(o); });
    cat.addEventListener('change', function () { state.category = cat.value; syncHash(); render(); });
    var chainSel = el('select');
    chainSel.appendChild(el('option', { value:'all', text:'All chains' }));
    chains().forEach(function (c) { var o = el('option', { value:c, text:c }); if (state.chain===c) o.selected=true; chainSel.appendChild(o); });
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; syncHash(); render(); });
    var tvl = el('select');
    [[0,'Any TVL'],[5000000,'$5M+'],[10000000,'$10M+'],[50000000,'$50M+ (watchlist floor)'],[100000000,'$100M+']].forEach(function (x) {
      var o = el('option', { value:String(x[0]), text:x[1] }); if (state.minTvl===x[0]) o.selected=true; tvl.appendChild(o);
    });
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value)||0; syncHash(); render(); });

    panel.appendChild(el('div', { class:'controls' },
      el('div', { class:'row' },
        el('div', { class:'field grow' }, el('label', { text:'Search' }), q),
        el('div', { class:'field' }, el('label', { text:'Category' }), cat),
        el('div', { class:'field' }, el('label', { text:'Chain' }), chainSel),
        el('div', { class:'field' }, el('label', { text:'Minimum TVL' }), tvl),
        el('div', { class:'field' }, el('label', { text:'View' }), el('div', { class:'tabs' },
          el('button', { type:'button', 'aria-pressed': state.tab==='pre'?'true':'false', text:'Pre-token board', onclick:function(){state.tab='pre'; syncHash(); render();} }),
          el('button', { type:'button', 'aria-pressed': state.tab==='live'?'true':'false', text:'Live token set', onclick:function(){state.tab='live'; syncHash(); render();} })
        ))
      ),
      el('div', { class:'pills' },
        el('span', { class:'pill', text: state.tab==='pre' ? (preList.length + ' rows shown / ' + DATA.board_size + ' ranked') : (DATA.live_size + ' live-token protocols') }),
        el('span', { class:'pill', text: 'Watchlist coverage: ' + DATA.watchlist_size + ' protocols included' }),
        el('span', { class:'pill', text: 'Sortable & filterable board; click a row for detail view and farm plan' })
      )
    ));
    panel.appendChild(state.tab === 'pre' ? tablePre() : tableLive());
    shell.appendChild(panel);

    if (state.tab === 'pre') {
      shell.appendChild(el('div', { class:'grid2' },
        el('section', { class:'panel card' },
          el('h2', { text:'Implied value model (' + DATA.model_version + ')' }),
          el('p', { text:'Implied value is computed from snapshot fields only: TVL, 7-day change, listing age, chain breadth, and category. No protocol name is special-cased and no external data is used.' }),
          el('div', { class:'formula', text:'implied = round(TVL × base × (1 + clamp(7d%, floor, cap)/100 × growthWeight) × maturity(age) × chainMult × categoryMult)\n\nbase=' + DATA.model.base_multiple + ', growthWeight=' + DATA.model.growth_weight + ', 7d clamp=[' + DATA.model.growth_floor + ',' + DATA.model.growth_cap + '], maturity=' + DATA.model.maturity_floor + '+age/' + DATA.model.maturity_days + '×' + DATA.model.maturity_range + ', chain=1+min(chains-1,' + DATA.model.chain_cap + ')×' + DATA.model.chain_weight + ', unknown age=' + DATA.model.unknown_age_days + 'd' })
        ),
        el('section', { class:'panel card' },
          el('h2', { text:'How to read this radar' }),
          el('p', { text:'Pre-token means DefiLlama records no token/symbol/market cap for the protocol in this snapshot. A protocol can still issue a token later or be misclassified; treat ranks as a farming research priority, not a guarantee.' }),
          el('p', { style:'margin-top:8px', text:'Each detail view includes a concrete farm plan with costs and time estimates derived from protocol category, chain, TVL, and age. Always verify official links and contracts before interacting.' })
        )
      ));
    }

    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (state.tab === 'pre' && state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
