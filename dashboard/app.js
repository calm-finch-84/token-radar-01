// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: '', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtMultiple(n) { return n.toFixed(4) + 'x'; }
  function categoryOf(row) { return row.category ?? 'Uncategorised'; }

  var tvlOptions = [[0, 'All TVL'], [50e6, '$50M+'], [100e6, '$100M+'], [500e6, '$500M+']];
  var chainCounts = new Map();
  DATA.rows.forEach(function (row) {
    new Set(row.chains).forEach(function (chain) {
      chainCounts.set(chain, (chainCounts.get(chain) || 0) + 1);
    });
  });
  var chains = Array.from(chainCounts.keys()).sort();

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Keep this derivation in sync with lib/model.ts, which writes board.json.
  /** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
  function stepText(step) {
    let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
    return s;
  }

  /** The first chain a protocol names, or a neutral phrase. */
  function chainOf(p) {
    return p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  /** How much capital one farm position needs, from the protocol's own TVL. */
  function capitalFor(p) {
    if (p.tvl_usd >= 5_000_000_000) return 250;
    if (p.tvl_usd >= 1_000_000_000) return 150;
    if (p.tvl_usd >= 100_000_000) return 100;
    return 50;
  }

  /** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
  function holdDaysFor(age) {
    if (age === null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  /** Network fee estimate for one action on the primary chain. */
  function gasFor(chain) {
    const c = chain.toLowerCase();
    if (c === 'ethereum' || c === 'bitcoin') return { label: 'about $6', dollars: 6 };
    if (c === 'solana') return { label: 'under $0.10', dollars: 0.1 };
    return { label: 'about $0.50', dollars: 0.5 };
  }

  /** Seven steps selected only from the record's category, primary chain, TVL and age. */
  function farmSteps(p) {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const gas = gasFor(chain);
    const c = (p.category ?? '').toLowerCase();
    let main = `Deposit $${capital} of USDC into ${p.name} on ${chain}.`;
    let follow = `Make a second deposit of $${capital * 0.2}, 20% of the first deposit, into the same position.`;
    let weekly = 'Rebalance a small part of the deposit once each week';
    let exit = 'Withdraw the deposits and convert the proceeds to USDC';
    let followCapital = `$${capital * 0.2} additional capital`;
    let followActions = 1;
    let exitActions = 2;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
      main = `Supply $${capital} of USDC or supported collateral to ${p.name} on ${chain}.`;
      follow = `Borrow $${capital * 0.1} against the supply only if the app shows a safe collateral buffer; repay it with interest a week later.`;
      weekly = 'Repay any small outstanding borrow each week and check the collateral buffer';
      exit = 'Repay all debt and accrued interest before withdrawing collateral, then convert proceeds to USDC';
      followCapital = `$${capital * 0.1} borrowed, plus variable interest`;
      followActions = 2;
      exitActions = 3;
    } else if (c.includes('dex')) {
      main = `Provide $${capital} total liquidity to a supported pool on ${p.name} on ${chain}; record both assets and the pool address.`;
      follow = `Use $${capital * 0.1} to make a swap through the pool you funded; check price impact before signing.`;
      weekly = 'Make one small swap through the funded pool each week';
      exit = 'Remove all liquidity, collect accrued fees and swap the returned assets back to USDC';
      followCapital = `$${capital * 0.1} swap capital plus the displayed trading fee`;
      exitActions = 3;
    } else if (c.includes('bridge')) {
      main = `Bridge $${capital} of USDC through ${p.name} to ${chain} if supported; otherwise choose a supported destination and record it.`;
      follow = `Transact with $${capital * 0.1} on the destination chain, then bridge that small amount back; reserve gas on both chains.`;
      weekly = 'Make one small swap on the destination chain each week';
      exit = 'Bridge the remaining funds back, wait for finality and verify receipt on the source chain';
      followCapital = 'existing bridged capital plus displayed bridge fees and destination gas';
      followActions = 2;
    } else if (c.includes('stak')) {
      main = `Stake $${capital} of a supported staking asset through ${p.name} on ${chain} and record the receipt token.`;
      follow = 'Open the receipt position and claim or compound its accrued rewards once the app shows rewards available.';
      weekly = 'Claim or compound available receipt rewards once each week';
      exit = 'Request unstaking, respect the unbonding queue, then redeem the receipt and convert proceeds to USDC';
      followCapital = 'no additional principal';
      exitActions = 3;
    } else if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('farm')) {
      main = `Deposit $${capital} into a supported ${p.name} vault on ${chain} and record the vault shares.`;
      follow = `Move $${capital * 0.2} of the position into a second vault after comparing assets, withdrawal terms and fees.`;
      weekly = 'Rebalance a small part between the two vaults each week after checking withdrawal terms';
      exit = 'Redeem shares from both vaults, wait out any withdrawal queue and convert proceeds to USDC';
      followCapital = 'existing position capital plus displayed vault fees';
      followActions = 2;
      exitActions = 3;
    } else if (c.includes('perp') || c.includes('derivative')) {
      main = `Deposit $${capital} of USDC as margin into ${p.name} on ${chain}; keep leverage at or below 1x.`;
      follow = `Open and close one small hedged position with at most $${capital * 0.1} notional per leg; include both legs' fees and funding in the log.`;
      weekly = 'Rebalance the margin allocation once each week after checking funding and available collateral';
      exit = 'Close every margin position and cancel open orders first, then withdraw the released margin to USDC';
      followCapital = 'existing margin plus variable trading fees and funding';
      followActions = 4;
      exitActions = 3;
    }
    const fees = (actions) => actions === 1
      ? `${gas.label} of network fees per action on ${chain}`
      : `${gas.dollars === 0.1 ? 'under' : 'about'} $${(gas.dollars * actions).toFixed(2)} for ${actions} network actions on ${chain}`;
    return [
      { text: `Set up a fresh wallet for ${p.name} on ${chain}, keep its seed offline and reserve gas: ${gas.label} of network fees per action.`, cost: 'wallet creation is free; reserve gas separately', time: '5 minutes' },
      { text: main, cost: `$${capital} capital plus ${fees(1)}; check any approval or app fees`, time: '15 minutes' },
      { text: follow, cost: `${followCapital}; ${fees(followActions)}`, time: c.includes('lend') || c.includes('cdp') || c.includes('collateral') ? '10 minutes now and 5 minutes a week later' : '15 minutes' },
      { text: `${weekly} on ${p.name}; record the transaction and skip it if fees exceed the amount involved.`, cost: `${fees(1)} per week, plus any app fees`, time: '10 minutes per week' },
      { text: `Keep the ${p.name} position open for at least ${hold} days so activity spans more than one snapshot; check its health each week.`, cost: `$${capital} remains exposed in the position; variable asset and protocol risk`, time: `${hold} days` },
      { text: `Open ${p.name}'s own points or rewards page. Claim only from the link it publishes and never pay to claim.`, cost: 'free to check; never pay a claim fee or send funds to unlock rewards', time: '10 minutes' },
      { text: `${exit}. Write the wallet, dates, amounts, fees and every transaction hash in the ${p.name} farm log.`, cost: `${fees(exitActions)} plus any displayed exit fees`, time: '15 minutes plus any withdrawal or bridge wait' },
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (chainCounts.has(params.get('chain'))) state.chain = params.get('chain');
    var minTvl = Number(params.get('minTvl'));
    if (tvlOptions.some(function (option) { return option[0] === minTvl; })) state.minTvl = minTvl;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', state.minTvl);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && categoryOf(r) !== state.category) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, categoryOf(r), (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(categoryOf))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      if (state.tab === 'pre-token') {
        document.getElementById('pre-token-board').replaceWith(boardTable());
        document.getElementById('row-count').textContent = rows().length + ' rows shown';
      }
    });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain' },
      el('option', { value: '', text: 'All chains' }),
      chains.map(function (chain) {
        return el('option', { value: chain, text: chain + ' (' + chainCounts.get(chain) + ')', selected: chain === state.chain ? 'selected' : null });
      })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlSelect = el('select', { id: 'min-tvl' }, tvlOptions.map(function (option) {
      return el('option', { value: option[0], text: option[1], selected: option[0] === state.minTvl ? 'selected' : null });
    }));
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      state.tab === 'pre-token' ? el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect) : null,
      state.tab === 'pre-token' ? el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'Minimum TVL' }), tvlSelect) : null,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', id: 'row-count', role: 'status', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel', id: 'pre-token-board' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Change a filter or clear them all to see more protocols.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = ''; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = Math.max(1, ...list.map(function (r) { return r.implied_value_usd; }));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: categoryOf(r) + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'peer-cell' },
          el('span', { class: 'num', text: fmtMultiple(r.peer_multiple) }),
          el('span', { class: 'sub peer-sample', text: 'n=' + r.peer_sample + (r.peer_sample === 1 ? ' peer' : ' peers') })
        ),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel board-panel', id: 'pre-token-board' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Select a protocol to see its valuation and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('peer', 'Peer x'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('div', { class: 'formula', text: 'implied = max(1, round(tvl_usd × peer_multiple(category) × growth × maturity))' }),
      el('p', { text: 'Each category starts with the median market cap divided by TVL across its live peers, with each ratio winsorized to [' + m.ratio_floor + ', ' + m.ratio_cap + ']. The category median is weighted by its sample size and shrunk toward the global median of ' + fmtMultiple(DATA.global_multiple) + ' (shrink_k = ' + m.peer_shrink_k + '). Categories without a peer sample use the global median. The final multiple is clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + '] and rounded to four decimals.' }),
      el('p', { class: 'sub', text: 'Growth = 1 + seven-day growth (clamped to ' + m.growth_floor + '% through ' + m.growth_cap + '%) × ' + m.growth_weight + '. Maturity starts at ' + m.maturity_floor + ' and rises by up to ' + m.maturity_range + ' over ' + m.maturity_days + ' days. Unknown ages use ' + m.unknown_age_days + ' days.' }),
      el('div', { class: 'table-wrap peer-table' }, el('table', null,
        el('thead', null, el('tr', null, ['Category', 'Live peers', 'Peer multiple'].map(function (label) {
          return el('th', { scope: 'col', text: label });
        }))),
        el('tbody', null, DATA.peer_table.map(function (peer) {
          return el('tr', null,
            el('th', { scope: 'row', text: peer.category }),
            el('td', { class: 'num', text: String(peer.sample) }),
            el('td', { class: 'num', text: fmtMultiple(peer.multiple) })
          );
        }))
      ))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var implied = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: categoryOf(row) + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Category peer multiple' }), el('b', { class: 'num', text: fmtMultiple(row.peer_multiple) })),
        el('p', { class: 'sub peer-note', text: row.peer_sample
          ? 'Median of ' + row.peer_sample + ' live ' + (row.peer_sample === 1 ? 'peer' : 'peers') + ', shrunk toward the global median.'
          : 'Uses the global median because no category peer sample applies.' }),
        el('div', null, el('span', { text: 'Global peer median' }), el('b', { class: 'num', text: fmtMultiple(DATA.global_multiple) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + usd.format(implied) + (implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
