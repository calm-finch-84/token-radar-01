/* The page is a view of the sealed dataset. It never changes the scored values. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const data = window.RADAR;
  if (!data || !Array.isArray(data.rows)) {
    byId('coverage').textContent = 'Local data is missing. Run the snapshot builder and open the output dashboard.';
    return;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dollars = value => value === null || value === undefined ? 'Unreported' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  const compact = value => value === null || value === undefined ? 'Unreported' : '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  const percent = value => value === null ? 'Unreported' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  const confidence = value => `${(value * 100).toFixed(1)}%`;
  const multiple = value => `${value.toFixed(4)}x`;
  const categoryOf = row => row.category ?? 'Uncategorised';
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const recompute = row => Math.round(row.tvl_usd * row.peer_multiple * row.growth_multiplier * row.maturity_multiplier);
  const matches = row => recompute(row) === row.implied_value_usd;
  const rows = [...data.rows];
  // The export contains the whole watchlist plus only below-floor early additions.
  const isWatchlist = row => row.tvl_usd >= data.floor_usd;
  let sort = { key: 'rank', direction: 1 };
  let selectedSlug = null;
  let opener = null;
  const confidenceText = 'Confidence measures snapshot coverage, not the chance of a token launch: 50% × n/(n + 8) for category peers, plus 25% for a known listing date and 25% for reported weekly growth.';
  function options(id, values) {
    for (const value of [...new Set(values)].sort(lexical)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      byId(id).append(option);
    }
  }
  options('category', rows.map(categoryOf));
  options('chain', rows.flatMap(row => row.chains));
  byId('as-of').textContent = data.as_of;
  byId('universe').textContent = data.board_size;
  byId('coverage').textContent = `${data.watchlist_size} watchlist · ${data.early_size} early · ${data.live_size} live set aside`;
  byId('source').textContent = `${data.source} · ${data.as_of}`;
  byId('metrics').innerHTML = [
    ['WATCHLIST FLOOR', compact(data.floor_usd), 'The starting universe'],
    ['GLOBAL PEER MULTIPLE', multiple(data.global_multiple), 'Median live market cap / TVL'],
    ['MODEL RELEASE', data.model_version, 'Category peers + growth + maturity'],
    ['INPUT COVERAGE', `${data.watchlist_size} + ${data.early_size}`, 'Watchlist and early discoveries'],
  ].map(([label, value, note]) => `<div class="metric"><span class="eyebrow">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');

  function renderBoard() {
    const query = byId('search').value.trim().toLowerCase();
    const category = byId('category').value;
    const chain = byId('chain').value;
    const min = Number(byId('minimum').value);
    const watched = byId('watchlist').checked;
    const visible = rows.filter(row =>
      (!query || `${row.name} ${row.slug} ${categoryOf(row)} ${row.chains.join(' ')}`.toLowerCase().includes(query)) &&
      (!category || categoryOf(row) === category) && (!chain || row.chains.includes(chain)) &&
      row.tvl_usd >= min && (!watched || isWatchlist(row))
    ).sort((a, b) => {
      const left = sort.key === 'category' ? categoryOf(a) : a[sort.key];
      const right = sort.key === 'category' ? categoryOf(b) : b[sort.key];
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      const order = typeof left === 'string' ? lexical(left.toLowerCase(), right.toLowerCase()) : (left ?? 0) - (right ?? 0);
      return order * sort.direction || a.rank - b.rank;
    });
    byId('visible').textContent = `${visible.length} / ${rows.length} protocols visible`;
    byId('empty').hidden = visible.length !== 0;
    byId('board-rows').innerHTML = visible.map(row => {
      const okay = matches(row);
      return `<tr tabindex="0" data-slug="${esc(row.slug)}" aria-label="Rank ${row.rank}: ${esc(row.name)}. Open detail." class="${okay ? '' : 'check-failed'}">
        <td class="rank">${row.rank.toString().padStart(2, '0')}</td>
        <td><strong class="protocol-name">${esc(row.name)}</strong><small>${isWatchlist(row) ? 'WATCHLIST' : 'EARLY SIGNAL'}${okay ? '' : ' · CHECK DIFFERENCE'}</small></td>
        <td>${esc(categoryOf(row))}</td><td><span class="chains">${esc(row.chains.join(' · ') || 'Unreported')}</span></td>
        <td class="number" title="${esc(dollars(row.tvl_usd))}">${compact(row.tvl_usd)}</td>
        <td class="number ${row.change_7d > 0 ? 'positive' : row.change_7d < 0 ? 'negative' : 'muted'}">${percent(row.change_7d)}</td>
        <td class="number peer-value">${multiple(row.peer_multiple)} <span class="muted">· n=${row.peer_sample}</span></td>
        <td class="number value" title="${esc(dollars(row.implied_value_usd))}">${compact(row.implied_value_usd)}${okay ? '' : ' <span class="warning-dot" title="Rounded factors do not reproduce the exported value">!</span>'}</td>
        <td class="number"><span class="confidence-track" aria-hidden="true"><i style="width:${row.confidence * 100}%"></i></span>${confidence(row.confidence)}</td>
      </tr>`;
    }).join('');
    for (const button of document.querySelectorAll('[data-sort]')) {
      const active = button.dataset.sort === sort.key;
      button.parentElement.setAttribute('aria-sort', active ? sort.direction === 1 ? 'ascending' : 'descending' : 'none');
    }
  }
  for (const id of ['search', 'category', 'chain', 'minimum', 'watchlist']) {
    byId(id).addEventListener(id === 'search' ? 'input' : 'change', renderBoard);
  }
  byId('reset').addEventListener('click', () => {
    for (const id of ['search', 'category', 'chain']) byId(id).value = '';
    byId('minimum').value = '0';
    byId('watchlist').checked = false;
    sort = { key: 'rank', direction: 1 };
    renderBoard();
  });
  for (const button of document.querySelectorAll('[data-sort]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      sort = { key, direction: sort.key === key ? -sort.direction : ['rank', 'name', 'category'].includes(key) ? 1 : -1 };
      renderBoard();
    });
  }
  const failed = rows.filter(row => !matches(row)).length;
  byId('check-summary').textContent = `Recomputation audit: ${rows.length - failed} exact matches; ${failed} differences using exported rounded multipliers. Estimates retain their original values. Differences can reflect factor precision or the model's distinct-dollar ordering.`;

  const detail = byId('detail');
  function openDetail(slug, trigger) {
    const row = rows.find(item => item.slug === slug);
    if (!row) return;
    selectedSlug = slug;
    opener = trigger;
    const exact = matches(row);
    byId('detail-content').innerHTML = `
      <p class="eyebrow">RANK ${row.rank} / ${esc(categoryOf(row))} / ${esc(row.chains.join(' · ') || 'CHAIN UNREPORTED')}</p>
      <h2 id="detail-title">${esc(row.name)}</h2>
      <p class="detail-value">${dollars(row.implied_value_usd)}<span>implied launch value</span></p>
      <section class="detail-section"><h3>Valuation working</h3>
      <div class="equation"><span>${dollars(row.tvl_usd)}<small>TVL</small></span><b>×</b><span>${multiple(row.peer_multiple)}<small>Category peer</small></span><b>×</b><span>${multiple(row.growth_multiplier)}<small>Growth</small></span><b>×</b><span>${multiple(row.maturity_multiplier)}<small>Maturity</small></span><b>=</b><span>${dollars(row.implied_value_usd)}<small>Exported value</small></span></div>
      <p class="audit ${exact ? 'audit-pass' : 'audit-warning'}">${exact ? 'Recomputation matches the exported value.' : `Recomputation difference: rounded exported factors produce ${dollars(recompute(row))}; the board records ${dollars(row.implied_value_usd)}. The exported value is shown without adjustment.`}</p></section>
      <section class="detail-section"><h3>Why this estimate</h3><ul class="reasons">${row.why.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></section>
      <div class="detail-grid"><section class="detail-section"><h3>Confidence · ${confidence(row.confidence)}</h3><p>${esc(confidenceText)}</p><p class="muted">Listing: ${esc(row.listed_at ?? 'unreported')} · Weekly growth: ${percent(row.change_7d)}</p></section>
      <section class="detail-section"><h3>Peer basis</h3><dl><dt>Category</dt><dd>${esc(categoryOf(row))}</dd><dt>Live category observations</dt><dd>${row.peer_sample}</dd><dt>Category multiple</dt><dd>${multiple(row.peer_multiple)}</dd><dt>Global median</dt><dd>${multiple(data.global_multiple)}</dd></dl></section></div>
      <section class="detail-section"><p class="eyebrow">ACTIVITY WORKBOOK</p><h3>Seven steps, straight from the board</h3><p class="muted">Costs are planning estimates. Check current application terms before acting; participation does not guarantee rewards.</p><ol class="farm-plan">${row.farm_steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></section>`;
    detail.showModal();
    detail.scrollTop = 0;
  }
  byId('board-rows').addEventListener('click', event => {
    const row = event.target.closest('tr[data-slug]');
    if (row) openDetail(row.dataset.slug, row);
  });
  byId('board-rows').addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr[data-slug]');
    if (row) { event.preventDefault(); openDetail(row.dataset.slug, row); }
  });
  byId('close-detail').addEventListener('click', () => detail.close());
  detail.addEventListener('close', () => {
    selectedSlug = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  detail.addEventListener('click', event => { if (event.target === detail && event.offsetX < 0) detail.close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selectedSlug && detail.open) { event.preventDefault(); detail.close(); }
  });

  const model = data.model;
  byId('model-version').textContent = `Running ${data.model_version} · snapshot ${data.as_of}`;
  byId('global-peer').textContent = `${multiple(data.global_multiple)} global`;
  byId('model-rules').textContent = `Live market-cap / TVL ratios are winsorized to ${model.ratio_floor}–${model.ratio_cap}x. Category medians are blended with ${model.peer_shrink_k} parts of the global median, then bounded to ${model.multiple_floor}–${model.multiple_cap}x. Weekly change is limited to ${model.growth_floor}% through ${model.growth_cap}% with weight ${model.growth_weight}. Maturity starts at ${model.maturity_floor}x and adds up to ${model.maturity_range}x over ${model.maturity_days} days; missing dates use ${model.unknown_age_days} days. Dollar collisions are resolved deterministically for a strictly descending board.`;
  byId('confidence-rule').textContent = confidenceText;
  byId('peer-rows').innerHTML = data.peer_table.map(peer => `<tr><td>${esc(peer.category)}</td><td class="number">${peer.sample}</td><td class="number">${multiple(peer.multiple)}</td></tr>`).join('');
  byId('live-cards').innerHTML = data.live.map(row => `<article class="live-card"><div><h3>${esc(row.name)}</h3><p>${esc(categoryOf(row))} · ${esc(row.chains.join(' · ') || 'Chain unreported')}</p></div><strong>${compact(row.mcap_usd)}</strong><small>REPORTED MARKET CAP</small></article>`).join('');
  renderBoard();
})();
