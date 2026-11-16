// Token Radar dashboard: one static page over window.RADAR (from ../data.js).
// No fetch, no external URL, no framework: every number comes from the sealed snapshot.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var root = document.getElementById('board');
  var announcer = document.getElementById('status');
  var MODEL = DATA.model;

  /** All UI state that the URL hash round-trips. */
  var state = {
    tab: 'pre', // 'pre' (ranked pre-token board) or 'live' (protocols that already trade)
    q: '',
    category: 'all',
    chain: 'all',
    minTvl: 0,
    sort: 'rank',
    dir: 1, // 1 = ascending, -1 = descending
    selected: null // slug of the row whose detail dialog is open
  };

  var DEFAULT_DIR = { rank: 1, name: 1, tvl: -1, growth: -1, age: -1, implied: -1 };
  var MIN_TVL_OPTIONS = [
    [0, 'Any TVL'],
    [5000000, '$5M+'],
    [10000000, '$10M+'],
    [50000000, '$50M+ (watchlist floor)'],
    [100000000, '$100M+']
  ];

  // ------------------------------------------------------------------ DOM + formatting helpers

  /** Append a child: strings become text, arrays are flattened, null/undefined/false skipped. */
  function appendChild(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (item) { appendChild(node, item); });
      return;
    }
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }

  /**
   * el('td', { class: 'num', 'data-label': 'TVL' }, '$1.2B')
   * `text` sets textContent; keys starting with `on` add listeners; `true` sets a bare attribute.
   */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) appendChild(node, arguments[i]);
    return node;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e12) return sign + '$' + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + '$' + Math.round(a / 1e3) + 'K';
    return sign + '$' + Math.round(a);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function fmtInt(n) {
    return Number(n).toLocaleString('en-US');
  }

  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return String(Number(n.toFixed(4)));
  }

  function median(values) {
    if (!values.length) return null;
    var sortedValues = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2 ? sortedValues[mid] : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
  }

  function sum(values) {
    return values.reduce(function (total, value) { return total + value; }, 0);
  }

  function compareSlug(a, b) {
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  }

  function markSelected(slug) {
    var rows = root.querySelectorAll('tr[data-slug]');
    for (var i = 0; i < rows.length; i++) rows[i].setAttribute('data-selected', rows[i].getAttribute('data-slug') === slug ? 'true' : 'false');
  }

  // ------------------------------------------------------------------ farm plan (page-side, same rules as the model)

  function primaryChain(row) {
    return row.chains && row.chains.length ? row.chains[0] : 'its primary chain';
  }

  function capitalFor(row) {
    if (row.tvl_usd >= 5e9) return 300;
    if (row.tvl_usd >= 1e9) return 200;
    if (row.tvl_usd >= 25e7) return 120;
    if (row.tvl_usd >= 5e7) return 75;
    return 40;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 120) return 75;
    if (age < 365) return 45;
    return 30;
  }

  function actionFor(row, capital, chain) {
    var category = (row.category || '').toLowerCase();
    var name = row.name;
    if (category.indexOf('lend') >= 0 || category.indexOf('cdp') >= 0 || category.indexOf('collateral') >= 0) return 'Supply about $' + capital + ' in a supported stable or blue-chip asset on ' + name + ' (' + chain + ') and keep utilization healthy to build lending history.';
    if (category.indexOf('dex') >= 0 || category.indexOf('yield') >= 0 || category.indexOf('leveraged farm') >= 0 || category.indexOf('liquidity') >= 0) return "Provide roughly $" + capital + ' of liquidity in ' + name + "'s main pool on " + chain + ', rebalance if needed, and avoid tiny positions that get eaten by fees.';
    if (category.indexOf('perpetual') >= 0 || category.indexOf('derivative') >= 0 || category.indexOf('options') >= 0) return 'Deposit about $' + capital + ' as collateral on ' + name + ' and execute a few small, low-leverage trades on ' + chain + ' to show real usage.';
    if (category.indexOf('bridge') >= 0 || category.indexOf('cross chain') >= 0) return 'Bridge about $' + capital + ' through ' + name + ' to ' + chain + ' and make at least one follow-up onchain action so the route records meaningful activity.';
    if (category.indexOf('staking') >= 0 || category.indexOf('restak') >= 0) return 'Stake about $' + capital + ' worth of the native asset via ' + name + ' on ' + chain + ' and retain the receipt token to demonstrate ongoing participation.';
    if (category.indexOf('prediction') >= 0) return 'Fund ' + name + ' with about $' + capital + ' and place a small number of informed positions over time rather than one-off activity on ' + chain + '.';
    if (category.indexOf('rwa') >= 0) return "Allocate about $" + capital + " into " + name + "'s primary product on " + chain + ' and complete any required verification steps published by the protocol.';
    if (category.indexOf('stable') >= 0) return "Mint or deposit about $" + capital + " into " + name + "'s stable or savings product on " + chain + ' and maintain the position through multiple snapshots.';
    return "Deposit about $" + capital + " into " + name + "'s core product on " + chain + ' and use its main feature at least once per week to create consistent onchain history.';
  }

  /** Six concrete steps: action text, cost, and time, derived from snapshot fields only. */
  function farmSteps(row) {
    var chain = primaryChain(row);
    var chains = row.chains && row.chains.length ? row.chains.slice(0, 3).join(', ') : chain;
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = capital >= 150 ? 8 : 4;
    var weeklyGas = capital >= 150 ? 3 : 2;
    return [
      { t: 'Prepare a dedicated wallet for ' + row.name + ': fund it on ' + chains + ', keep seed/private keys offline, and label it so farming activity stays separate.', c: 'under $' + gas + ' in initial gas', m: '10 minutes' },
      { t: actionFor(row, capital, chain), c: 'about $' + capital + ' capital plus ~$' + gas + ' gas', m: '15-25 minutes to set up' },
      { t: 'Repeat meaningful interactions weekly (deposit, swap, borrow, repay, or governance where available) so usage spans multiple periods, not a single burst.', c: 'about $' + weeklyGas + ' gas per week', m: '10 minutes per week' },
      { t: 'Maintain the position for at least ' + hold + ' days before any unwind, because age and consistency often matter more than one large transaction.', c: 'capital remains deployed (~$' + capital + ')', m: hold + ' days hold window' },
      { t: "Track every transaction hash, date, and amount in a simple log and monitor " + row.name + "'s official announcements for points, quests, or eligibility updates.", c: 'no extra fee (time only)', m: '10 minutes weekly review' },
      { t: 'If rewards are announced, claim only via links published by ' + row.name + "'s official channels, verify contract addresses, and avoid paying upfront \"claim\" fees.", c: 'claim gas varies; never send funds to unknown claim sites', m: '10-20 minutes when claiming' }
    ];
  }

  /** The page recomputes the model's score from the row's factors, as a visible cross-check. */
  function impliedValue(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var chainCount = Math.max(1, (row.chains || []).length);
    var chainMult = 1 + Math.min(chainCount - 1, MODEL.chain_cap) * MODEL.chain_weight;
    var category = (row.category || '').toLowerCase();
    var categoryMult = 1.0;
    if (category.indexOf('lending') >= 0 || category.indexOf('cdp') >= 0) categoryMult = 1.08;
    else if (category.indexOf('dex') >= 0 || category.indexOf('derivatives') >= 0 || category.indexOf('perp') >= 0) categoryMult = 1.06;
    else if (category.indexOf('yield') >= 0 || category.indexOf('liquid staking') >= 0 || category.indexOf('restaking') >= 0) categoryMult = 1.04;
    else if (category.indexOf('bridge') >= 0 || category.indexOf('chain') >= 0) categoryMult = 1.03;
    else if (category.indexOf('rwa') >= 0 || category.indexOf('prediction') >= 0 || category.indexOf('options') >= 0) categoryMult = 1.02;
    return Math.max(1, Math.round(row.tvl_usd * MODEL.base_multiple * growthMult * maturity * chainMult * categoryMult));
  }

  /** The clipboard text for a row: header, figures, then the numbered plan. */
  function planText(row) {
    var steps = farmSteps(row);
    var lines = [
      'Token Radar farm plan: ' + row.name + ' (rank #' + row.rank + ', ' + (row.category || 'Other') + ')',
      'Snapshot ' + DATA.as_of + ' · implied value ' + fmtUsd(row.implied_value_usd) + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) + ' · age ' + fmtAge(row.age_days),
      'Watchlist: ' + (row.on_watchlist ? 'yes (must-cover)' : 'no (early find below floor)'),
      ''
    ];
    steps.forEach(function (step, index) {
      lines.push(index + 1 + '. ' + step.t);
      lines.push('   Cost: ' + step.c + '. Time: ' + step.m + '.');
    });
    lines.push('');
    lines.push('Model estimate from snapshot figures only, not a price prediction. Verify official links and contracts before interacting.');
    return lines.join('\n');
  }

  /** Clipboard write with a same-document fallback for browsers without the async API. */
  function copyText(text, host) {
    function fallback() {
      try {
        var area = el('textarea', { class: 'sr-only', readonly: true, 'aria-hidden': 'true' });
        area.value = text;
        host.appendChild(area);
        area.select();
        var ok = document.execCommand('copy');
        host.removeChild(area);
        return ok;
      } catch (err) {
        return false;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    }
    return Promise.resolve(fallback());
  }

  // ------------------------------------------------------------------ derived indexes + filters

  var rowsBySlug = new Map(DATA.rows.map(function (row) { return [row.slug, row]; }));
  var categories = Array.from(new Set(DATA.rows.map(function (row) { return row.category || 'Other'; }))).sort();
  var chains = Array.from(new Set(DATA.rows.reduce(function (all, row) { return all.concat(row.chains || []); }, []))).sort();
  var boardMedian = median(DATA.rows.map(function (row) { return row.implied_value_usd; }));
  var watchedCount = DATA.rows.filter(function (row) { return row.on_watchlist; }).length;

  function isFiltered() {
    return state.q !== '' || state.category !== 'all' || state.chain !== 'all' || state.minTvl !== 0;
  }

  function filteredRows() {
    var query = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category !== 'all' && (row.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && row.tvl_usd < state.minTvl) return false;
      if (!query) return true;
      var haystack = [row.name, row.slug, row.category || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(query) >= 0;
    });
  }

  /** Sort keys map to [value, nullsAllowed]; nulls always sink to the bottom. */
  function sortValue(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null || row.change_7d === undefined ? null : row.change_7d;
    if (key === 'age') return row.age_days === null || row.age_days === undefined ? null : row.age_days;
    if (key === 'implied') return row.implied_value_usd;
    return row.rank;
  }

  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, state.sort);
      var bv = sortValue(b, state.sort);
      if (av === null && bv === null) return compareSlug(a, b);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return compareSlug(a, b);
    });
  }

  // ------------------------------------------------------------------ URL hash state

  function readHash() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var tab = params.get('tab');
    if (tab === 'live' || tab === 'pre') state.tab = tab;
    if (params.get('q') !== null) state.q = params.get('q');
    var category = params.get('category');
    if (category && categories.indexOf(category) >= 0) state.category = category;
    var chain = params.get('chain');
    if (chain && chains.indexOf(chain) >= 0) state.chain = chain;
    var sort = params.get('sort');
    if (sort && Object.prototype.hasOwnProperty.call(DEFAULT_DIR, sort)) state.sort = sort;
    var dir = params.get('dir');
    if (dir === 'desc') state.dir = -1;
    else if (dir === 'asc') state.dir = 1;
    var minTvl = Number(params.get('minTvl'));
    var knownTvl = MIN_TVL_OPTIONS.some(function (option) { return option[0] === minTvl; });
    if (knownTvl) state.minTvl = minTvl;
    var selected = params.get('p');
    if (selected && rowsBySlug.has(selected)) state.selected = selected;
  }

  function syncHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 1) params.set('dir', state.dir < 0 ? 'desc' : 'asc');
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.selected) params.set('p', state.selected);
    var hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  }

  // ------------------------------------------------------------------ focus plumbing

  var pendingFocus = null;

  /** Re-render, then put focus back where the user left it (selector plus optional caret). */
  function rerender(selector, caret) {
    pendingFocus = selector ? { selector: selector, caret: caret === undefined ? null : caret } : null;
    render();
  }

  function focusRow(slug) {
    var rows = root.querySelectorAll('tr[data-slug]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-slug') === slug) {
        rows[i].tabIndex = 0;
        rows[i].focus();
        return;
      }
    }
  }

  // ------------------------------------------------------------------ detail dialog

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title', 'aria-modal': 'true' });

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      onDialogClose();
    }
  }

  function onDialogClose() {
    var slug = state.selected;
    state.selected = null;
    syncHash();
    render();
    if (slug) focusRow(slug);
  }

  dialog.addEventListener('close', onDialogClose);
  dialog.addEventListener('click', function (event) {
    if (event.target !== dialog) return;
    var box = dialog.getBoundingClientRect();
    var outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) closeDialog();
  });

  function kv(label, value) {
    return el('div', null, el('span', { text: label }), el('b', { text: value }));
  }

  /** Fill the drawer for one row; the caller opens it and focuses the heading. */
  function fillDialog(row) {
    var steps = farmSteps(row);
    var recomputed = impliedValue(row);

    var copyButton = el('button', { class: 'copy', type: 'button', text: 'Copy farm plan' });
    var copyStatus = el('span', { class: 'copy-status', role: 'status', 'aria-live': 'polite' });
    copyButton.addEventListener('click', function () {
      copyText(planText(row), dialog).then(function (ok) {
        copyButton.textContent = ok ? 'Copied' : 'Copy failed';
        copyStatus.textContent = ok ? 'Farm plan copied to the clipboard.' : 'Could not use the clipboard; select the steps and copy them manually.';
        if (ok) window.setTimeout(function () { copyButton.textContent = 'Copy farm plan'; }, 2400);
      });
    });

    dialog.textContent = '';
    dialog.appendChild(
      el('div', { class: 'dh' },
        el('div', { class: 'dh-text' },
          el('div', { class: 'brand-name', text: 'Rank #' + row.rank + ' · ' + (row.category || 'Other') }),
          el('h2', { id: 'detail-title', tabindex: '-1', text: row.name }),
          el('div', { class: 'sub', text: (row.chains && row.chains.length ? row.chains.join(', ') : 'No chain listed') + ' · listed ' + (row.listed_at || 'unknown') })
        ),
        el('div', { class: 'dh-actions' },
          copyButton,
          el('button', { class: 'close', type: 'button', text: 'Close', onclick: closeDialog })
        )
      )
    );
    dialog.appendChild(
      el('div', { class: 'db' },
        copyStatus,
        el('section', { class: 'sec' },
          el('h3', { text: 'Implied value model (snapshot-derived)' }),
          el('div', { class: 'kv' },
            kv('TVL (USD)', fmtUsd(row.tvl_usd)),
            kv('7d change', fmtPct(row.change_7d)),
            kv('Age with no token', fmtAge(row.age_days)),
            kv('Base multiple', String(MODEL.base_multiple)),
            kv('Growth multiplier', fmtMult(row.growth_multiplier)),
            kv('Maturity multiplier', fmtMult(row.maturity_multiplier)),
            kv('Chain multiplier', fmtMult(row.chain_multiplier || 1)),
            kv('Category multiplier', fmtMult(row.category_multiplier || 1)),
            kv('Implied value', fmtUsd(row.implied_value_usd)),
            kv('Recomputed in page', fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' ✓' : ' (mismatch)'))
          ),
          el('p', { class: 'note', text: 'Implied value follows snapshot figures only (TVL, 7d growth, age/listing, chain breadth, category). It is a model estimate, not a price or a promise of a token launch.' })
        ),
        el('section', { class: 'sec' },
          el('h3', { text: 'How to farm this protocol' }),
          el('ol', { class: 'steps' }, steps.map(function (step) {
            return el('li', null, el('b', { text: step.t }), el('div', { class: 'sub', text: 'Cost: ' + step.c + ' · Time: ' + step.m }));
          })),
          el('p', { class: 'note', text: 'The plan is generated from the snapshot fields above. Verify the protocol’s official links and contracts before moving funds.' })
        ),
        el('section', { class: 'sec' },
          el('h3', { text: 'Protocol facts (from snapshot)' }),
          el('div', { class: 'kv' },
            kv('Slug', row.slug),
            kv('Watchlist', row.on_watchlist ? 'yes (must-cover)' : 'no (early find below floor)'),
            kv('Market cap recorded', row.mcap_usd === null || row.mcap_usd === undefined ? 'none (pre-token)' : fmtUsd(row.mcap_usd)),
            kv('Token symbol/id', (row.symbol || row.gecko_id) ? ((row.symbol || '-') + ' / ' + (row.gecko_id || '-')) : 'none recorded'),
            kv('Snapshot as of', DATA.as_of)
          )
        )
      )
    );
  }

  /** Open the drawer for a slug, mark its row, and focus the drawer heading. */
  function openDetail(slug) {
    var row = rowsBySlug.get(slug);
    if (!row) return;
    state.selected = slug;
    markSelected(slug);
    syncHash();
    fillDialog(row);
    if (!dialog.isConnected) document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    var heading = dialog.querySelector('#detail-title');
    if (heading) heading.focus();
  }

  // ------------------------------------------------------------------ tables

  /** A sortable column header: aria-sort names the active column's direction. */
  function sortTh(key, label, className) {
    var active = state.sort === key;
    var arrow = active ? (state.dir > 0 ? '↑' : '↓') : '↕';
    return el('th', { scope: 'col', class: className || null, 'aria-sort': active ? (state.dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', 'data-sort': key, title: 'Sort by ' + label, onclick: function () { setSort(key); } },
        el('span', { text: label }),
        el('span', { class: 'sort-arrow', 'aria-hidden': 'true', text: arrow })
      )
    );
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else {
      state.sort = key;
      state.dir = DEFAULT_DIR[key] || 1;
    }
    syncHash();
    rerender('th button[data-sort="' + key + '"]');
  }

  /** Keyboard navigation over the body: arrows move, Home/End jump, Enter/Space opens. */
  function onRowKeydown(event) {
    var row = event.target.closest ? event.target.closest('tr[data-slug]') : null;
    if (!row) return;
    var rows = Array.prototype.slice.call(row.parentNode.querySelectorAll('tr[data-slug]'));
    var at = rows.indexOf(row);
    function focusAt(index) {
      var next = rows[Math.max(0, Math.min(rows.length - 1, index))];
      rows.forEach(function (item) { item.tabIndex = item === next ? 0 : -1; });
      next.focus();
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail(row.getAttribute('data-slug'));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(at + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(at - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(rows.length - 1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      focusAt(at + 10);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      focusAt(at - 10);
    }
  }

  /** The pre-token board: one row per ranked protocol, roving tabindex for keyboard use. */
  function boardTable(list) {
    if (!list.length) {
      return el('div', { class: 'empty' },
        el('p', { text: 'No protocols match the current filters.' }),
        el('button', { type: 'button', class: 'clear', text: 'Clear filters', onclick: clearFilters })
      );
    }

    var maxImplied = list.reduce(function (max, row) { return Math.max(max, row.implied_value_usd); }, 1);
    var tbody = el('tbody', { onkeydown: onRowKeydown });

    list.forEach(function (row, index) {
      var tr = el('tr', {
        'data-slug': row.slug,
        'data-selected': state.selected === row.slug ? 'true' : 'false',
        tabindex: index === 0 ? '0' : '-1',
        onclick: function () { openDetail(row.slug); }
      },
        el('td', { class: 'num', 'data-label': 'Rank' }, String(row.rank)),
        el('td', { class: 'wrap', 'data-label': 'Protocol' },
          el('div', { class: 'name' }, el('b', { text: row.name }), el('span', { class: 'sub', text: row.slug }))
        ),
        el('td', { 'data-label': 'Category' }, row.category || 'Other'),
        el('td', { class: 'wrap sub', 'data-label': 'Chains' }, (row.chains || []).slice(0, 3).join(', ') || '—'),
        el('td', { class: 'num', 'data-label': 'TVL' }, fmtUsd(row.tvl_usd)),
        el('td', { class: 'num ' + (row.change_7d === null || row.change_7d === undefined ? '' : row.change_7d >= 0 ? 'pos' : 'neg'), 'data-label': '7d' }, fmtPct(row.change_7d)),
        el('td', { class: 'num', 'data-label': 'Age' }, fmtAge(row.age_days)),
        el('td', { class: 'barcell', 'data-label': 'Implied value' },
          el('div', { class: 'num' }, fmtUsd(row.implied_value_usd)),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((row.implied_value_usd / maxImplied) * 100)) + '%' }))
        ),
        el('td', { 'data-label': 'Status' },
          el('span', { class: row.on_watchlist ? 'badge watch' : 'badge early' }, row.on_watchlist ? 'watchlist' : 'early find')
        )
      );
      tbody.appendChild(tr);
    });

    return el('div', { class: 'table-wrap' },
      el('table', { class: 'board-table' },
        el('caption', { class: 'sr-only', text: 'Pre-token protocols ranked by implied value. Use arrow keys to move between rows and Enter to open a row.' }),
        el('thead', null,
          el('tr', null,
            sortTh('rank', '#', 'col-rank'),
            sortTh('name', 'Protocol', 'col-name'),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Chains' }),
            sortTh('tvl', 'TVL', 'num'),
            sortTh('growth', '7d', 'num'),
            sortTh('age', 'Age', 'num'),
            sortTh('implied', 'Implied value', 'col-implied'),
            el('th', { scope: 'col', text: 'Status' })
          )
        ),
        tbody
      )
    );
  }

  /** The live-token set: market figures only, no model, no rose-tinted estimate. */
  function liveTable() {
    var tbody = el('tbody');
    (DATA.live || []).forEach(function (row, index) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', 'data-label': '#' }, String(index + 1)),
        el('td', { class: 'wrap', 'data-label': 'Protocol' },
          el('div', { class: 'name' }, el('b', { text: row.name }), el('span', { class: 'sub', text: row.slug }))
        ),
        el('td', { 'data-label': 'Category' }, row.category || 'Other'),
        el('td', { class: 'num', 'data-label': 'TVL' }, fmtUsd(row.tvl_usd)),
        el('td', { class: 'num', 'data-label': 'Market cap' }, fmtUsd(row.mcap_usd)),
        el('td', { class: 'num ' + (row.change_7d === null || row.change_7d === undefined ? '' : row.change_7d >= 0 ? 'pos' : 'neg'), 'data-label': '7d' }, fmtPct(row.change_7d)),
        el('td', { 'data-label': 'Status' }, el('span', { class: 'badge live' }, 'token live'))
      ));
    });
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'live-table' },
        el('caption', { class: 'sr-only', text: 'Protocols that already record a token, set aside from the pre-token ranking.' }),
        el('thead', null,
          el('tr', null,
            el('th', { scope: 'col', text: '#' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Status' })
          )
        ),
        tbody
      )
    );
  }

  // ------------------------------------------------------------------ control panel

  function clearFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.minTvl = 0;
    syncHash();
    rerender('#search-input', 0);
  }

  function controls() {
    var panel = el('section', { class: 'panel', 'aria-label': 'Board filters' });

    var search = el('input', { id: 'search-input', type: 'search', value: state.q, placeholder: 'Search protocol, slug, chain, category', autocomplete: 'off', spellcheck: 'false' });
    search.addEventListener('input', function () {
      state.q = search.value;
      var caret = search.selectionStart === null || search.selectionStart === undefined ? search.value.length : search.selectionStart;
      syncHash();
      rerender('#search-input', caret);
    });

    var category = el('select', { id: 'category-select' });
    category.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (name) { category.appendChild(el('option', { value: name, text: name })); });
    category.value = state.category;
    category.addEventListener('change', function () {
      state.category = category.value;
      syncHash();
      rerender('#category-select');
    });

    var chain = el('select', { id: 'chain-select' });
    chain.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (name) { chain.appendChild(el('option', { value: name, text: name })); });
    chain.value = state.chain;
    chain.addEventListener('change', function () {
      state.chain = chain.value;
      syncHash();
      rerender('#chain-select');
    });

    var tvl = el('select', { id: 'tvl-select' });
    MIN_TVL_OPTIONS.forEach(function (option) { tvl.appendChild(el('option', { value: String(option[0]), text: option[1] })); });
    tvl.value = String(state.minTvl);
    tvl.addEventListener('change', function () {
      state.minTvl = Number(tvl.value) || 0;
      syncHash();
      rerender('#tvl-select');
    });

    var tabPre = el('button', { id: 'tab-pre', type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre'; syncHash(); rerender('#tab-pre'); } });
    var tabLive = el('button', { id: 'tab-live', type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token set', onclick: function () { state.tab = 'live'; syncHash(); rerender('#tab-live'); } });

    panel.appendChild(el('div', { class: 'controls' },
      el('div', { class: 'row' },
        el('div', { class: 'field grow' }, el('label', { for: 'search-input', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category-select', text: 'Category' }), category),
        el('div', { class: 'field' }, el('label', { for: 'chain-select', text: 'Chain' }), chain),
        el('div', { class: 'field' }, el('label', { for: 'tvl-select', text: 'Minimum TVL' }), tvl),
        el('div', { class: 'field' }, el('span', { class: 'label', text: 'View' }), el('div', { class: 'tabs', role: 'group', 'aria-label': 'Board view' }, tabPre, tabLive))
      )
    ));

    var list = state.tab === 'pre' ? sortedRows(filteredRows()) : [];
    var resultText = state.tab === 'pre'
      ? fmtInt(list.length) + ' of ' + fmtInt(DATA.board_size) + ' ranked rows match'
      : fmtInt(DATA.live_size) + ' live-token protocols';

    var clear = el('button', { id: 'clear-filters', type: 'button', class: 'clear', text: 'Clear filters', disabled: isFiltered() ? null : true, onclick: clearFilters });

    var summaryText;
    if (state.tab === 'pre') {
      var impliedValues = list.map(function (row) { return row.implied_value_usd; });
      summaryText = 'Median implied ' + fmtUsd(median(impliedValues)) + ' (board ' + fmtUsd(boardMedian) + ') · total TVL of filtered rows ' + fmtUsd(sum(list.map(function (row) { return row.tvl_usd; })));
    } else {
      var liveRows = DATA.live || [];
      var mcapValues = liveRows.map(function (row) { return row.mcap_usd || 0; });
      summaryText = 'Median market cap ' + fmtUsd(median(mcapValues)) + ' · total TVL ' + fmtUsd(sum(liveRows.map(function (row) { return row.tvl_usd; })));
    }

    panel.appendChild(el('div', { class: 'controls-foot' },
      el('div', { class: 'pills' },
        el('span', { class: 'pill', id: 'result-count', text: resultText }),
        el('span', { class: 'pill', text: 'Watchlist coverage: ' + fmtInt(watchedCount) + ' / ' + fmtInt(DATA.watchlist_size) }),
        el('span', { class: 'pill pill-hint', text: 'Click or Enter opens a row · ↑ ↓ move · columns sort' })
      ),
      clear
    ));
    panel.appendChild(el('p', { class: 'summary', text: summaryText }));
    panel.appendChild(state.tab === 'pre' ? boardTable(list) : liveTable());
    return panel;
  }

  // ------------------------------------------------------------------ page

  function render() {
    var list = state.tab === 'pre' ? sortedRows(filteredRows()) : [];
    root.textContent = '';

    var shell = el('div', { class: 'shell' });
    shell.appendChild(el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar · ' + DATA.model_version })),
      el('div', { class: 'meta' },
        el('span', { text: 'Snapshot: ' + DATA.as_of }),
        el('span', { text: 'Source: DefiLlama protocols index' }),
        el('span', { text: 'Watchlist floor: ' + fmtUsd(DATA.floor_usd) })
      )
    ));

    shell.appendChild(el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Pre-token launch radar ranked by implied value' }),
        el('p', { text: 'This dashboard ranks protocols that still record no token in the sealed snapshot. It covers every watchlist protocol and adds early pre-token candidates below the floor. Implied value is derived from snapshot figures only and is an estimate, not a launch prediction or price target.' })
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: fmtInt(watchedCount) + ' / ' + fmtInt(DATA.watchlist_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Ranked pre-token rows' }), el('b', { text: fmtInt(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below floor' }), el('b', { text: fmtInt(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: fmtInt(DATA.live_size) }))
      )
    ));

    shell.appendChild(controls());

    if (state.tab === 'pre') {
      shell.appendChild(el('div', { class: 'grid2' },
        el('section', { class: 'panel card' },
          el('h2', { text: 'Implied value model (' + DATA.model_version + ')' }),
          el('p', { text: 'Implied value is computed from snapshot fields only: TVL, 7-day change, listing age, chain breadth, and category. No protocol name is special-cased and no external data is used.' }),
          el('div', { class: 'formula', text: 'implied = round(TVL × base × (1 + clamp(7d%, floor, cap)/100 × growthWeight) × maturity(age) × chainMult × categoryMult)\n\nbase=' + MODEL.base_multiple + ', growthWeight=' + MODEL.growth_weight + ', 7d clamp=[' + MODEL.growth_floor + ',' + MODEL.growth_cap + '], maturity=' + MODEL.maturity_floor + '+age/' + MODEL.maturity_days + '×' + MODEL.maturity_range + ', chain=1+min(chains-1,' + MODEL.chain_cap + ')×' + MODEL.chain_weight + ', unknown age=' + MODEL.unknown_age_days + 'd' })
        ),
        el('section', { class: 'panel card' },
          el('h2', { text: 'How to read this radar' }),
          el('p', { text: 'Pre-token means DefiLlama records no token/symbol/market cap for the protocol in this snapshot. A protocol can still issue a token later or be misclassified; treat ranks as a farming research priority, not a guarantee.' }),
          el('p', { class: 'card-note', text: 'Each detail view includes a concrete farm plan with costs and time estimates derived from protocol category, chain, TVL, and age. Always verify official links and contracts before interacting.' })
        )
      ));
    }

    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');

    if (announcer) {
      announcer.textContent = state.tab === 'pre'
        ? fmtInt(list.length) + ' of ' + fmtInt(DATA.board_size) + ' ranked rows shown'
        : fmtInt(DATA.live_size) + ' live-token protocols shown';
    }

    if (pendingFocus) {
      var target = root.querySelector(pendingFocus.selector);
      if (target) {
        target.focus();
        if (pendingFocus.caret !== null && typeof target.setSelectionRange === 'function') {
          try { target.setSelectionRange(pendingFocus.caret, pendingFocus.caret); } catch (err) { /* some inputs reject it */ }
        }
      }
      pendingFocus = null;
    }

    if (state.tab === 'pre' && state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
