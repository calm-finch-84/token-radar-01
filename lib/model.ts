// radar-5: reproducible category-peer estimates from a sealed snapshot.
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}
export interface ModelConstants {
  peer_shrink_k: number;
  ratio_floor: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}
export const MODEL: ModelConstants = {
  peer_shrink_k: 24, ratio_floor: 0.02, ratio_cap: 3,
  multiple_floor: 0.03, multiple_cap: 2,
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120,
  maturity_floor: 0.6, maturity_range: 0.4,
  maturity_days: 1095, unknown_age_days: 365,
};
export const MODEL_VERSION = 'radar-5';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;
export interface FarmStep { text: string; cost: string; time: string }
export interface BoardRow extends SnapshotProtocol {
  rank: number;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_sample: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    confidence: number;
  };
  why: string[];
  farm_steps: string[];
}
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_sample: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  confidence: number;
  why: string[];
  farm_steps: string[];
}
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}
export interface RadarData extends BoardSummary {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  peer_table: { category: string; sample: number; multiple: number; raw_median: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const bound = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));
const precise = (n: number): number => Math.round(n * 10000) / 10000;
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nullableText = (v: unknown): string | null => typeof v === 'string' ? v : null;
function dateStamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : NaN;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  const elapsed = listedAt === null ? NaN : dateStamp(asOf) - dateStamp(listedAt);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 86400000)) : null;
}
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !/\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i.test(p.name);
}
function midpoint(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  const ordered = [...values].sort((a, b) => a - b);
  const half = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[half]! : (ordered[half - 1]! + ordered[half]!) / 2;
}
interface PeerBasis { multiple: number; raw_median: number; sample: number }
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): {
  global_multiple: number; byCategory: Map<string | null, PeerBasis>;
} {
  const groups = new Map<string | null, number[]>();
  const universe: number[] = [];
  for (const protocol of snapshot.protocols) {
    let bucket = groups.get(protocol.category);
    if (!bucket) { bucket = []; groups.set(protocol.category, bucket); }
    if (isPreToken(protocol) || protocol.mcap_usd === null || protocol.tvl_usd <= 0) continue;
    const ratio = bound(protocol.mcap_usd / protocol.tvl_usd, model.ratio_floor, model.ratio_cap);
    bucket.push(ratio);
    universe.push(ratio);
  }
  const global = midpoint(universe, model.multiple_floor);
  const byCategory = new Map<string | null, PeerBasis>();
  for (const [category, values] of groups) {
    const sample = values.length;
    const raw = midpoint(values, global);
    const estimate = sample ? (raw * sample + global * model.peer_shrink_k) / (sample + model.peer_shrink_k) : global;
    byCategory.set(category, {
      sample, raw_median: precise(raw),
      multiple: precise(bound(estimate, model.multiple_floor, model.multiple_cap)),
    });
  }
  return { global_multiple: precise(global), byCategory };
}
export function impliedValue(p: SnapshotProtocol, asOf: string, peerMultiple: number, model: ModelConstants = MODEL): {
  implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = bound(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthMult = precise(1 + model.growth_weight * growthPct / 100);
  const maturityMult = precise(model.maturity_floor + model.maturity_range * bound(age ?? model.unknown_age_days, 0, model.maturity_days) / model.maturity_days);
  return {
    implied: Math.max(1, Math.round(p.tvl_usd * precise(peerMultiple) * growthMult * maturityMult)),
    growthPct, growthMult, maturityMult, age,
  };
}

// Confidence measures input coverage, not the probability of a token or a payout.
// Half the score comes from peer support; date and growth coverage add a quarter each.
function coverage(sample: number, age: number | null, growth: number | null, model: ModelConstants): number {
  return precise(bound(0.5 * sample / (sample + model.peer_shrink_k) + (age === null ? 0 : 0.25) + (growth === null ? 0 : 0.25), 0, 1));
}
function explanations(p: SnapshotProtocol, basis: PeerBasis, growth: number, age: number | null, model: ModelConstants, globalMultiple: number): string[] {
  return [
    `${basis.sample} live category ${basis.sample === 1 ? 'peer' : 'peers'}; raw median ${basis.raw_median.toFixed(4)}x pulled toward the ${globalMultiple.toFixed(4)}x global median (shrinkage k=${model.peer_shrink_k}), giving ${basis.multiple.toFixed(4)}x TVL.`,
    p.change_7d === null ? 'Weekly growth unreported; neutral growth applied.'
      : `Weekly TVL ${growth > 0 ? 'expansion' : growth < 0 ? 'contraction' : 'unchanged'}: ${growth.toFixed(2)}% after limits.`,
    age === null ? `Listing date unavailable; maturity uses ${model.unknown_age_days} days.`
      : `${age} days since listing; maturity reaches its ceiling at ${model.maturity_days} days.`,
  ];
}
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map(p => [p.slug, p]));
  const selected = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (!protocol) throw new SnapshotError(`Watchlist record missing: ${slug}`);
    if (!isPreToken(protocol)) throw new SnapshotError(`Watchlist contains a live token: ${slug}`);
    selected.set(slug, protocol);
  }
  // Keep the watchlist plus the highest model-valued early protocols: selection follows the model, not raw TVL.
  const early = snapshot.protocols.filter(p => !selected.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map(protocol => ({
      protocol,
      implied: impliedValue(protocol, snapshot.as_of, peers.byCategory.get(protocol.category)!.multiple, model).implied,
    }))
    .sort((a, b) => b.implied - a.implied || lexical(a.protocol.slug, b.protocol.slug)).slice(0, EARLY_ROWS);
  for (const { protocol } of early) selected.set(protocol.slug, protocol);
  const rows: BoardRow[] = [...selected.values()].map(p => {
    const basis = peers.byCategory.get(p.category)!;
    const value = impliedValue(p, snapshot.as_of, basis.multiple, model);
    return {
      ...p, chains: [...p.chains], rank: 0, token_status: 'pre-token', age_days: value.age,
      implied_value_usd: value.implied,
      model: {
        peer_multiple: basis.multiple, peer_sample: basis.sample, global_multiple: peers.global_multiple,
        growth_pct: value.growthPct, growth_multiplier: precise(value.growthMult),
        maturity_multiplier: precise(value.maturityMult), age_days: value.age,
        confidence: coverage(basis.sample, value.age, p.change_7d, model),
      },
      why: explanations(p, basis, value.growthPct, value.age, model, peers.global_multiple),
      farm_steps: farmSteps(p, value.age).map(stepText),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || lexical(a.slug, b.slug));
  // Allocate distinct positive dollars from the bottom up. Only collisions need an uplift.
  let lower = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    row.implied_value_usd = Math.max(row.implied_value_usd, lower + 1);
    row.rank = i + 1;
    lower = row.implied_value_usd;
  }
  return rows;
}

interface NetworkBudget { label: string; dollars: number; setup: string }
function networkBudget(chain: string): NetworkBudget {
  const key = chain.toLowerCase();
  if (key === 'ethereum') return { label: 'about $6', dollars: 6, setup: 'keep ETH for mainnet gas and inspect approval limits' };
  if (key === 'solana') return { label: 'under $0.10', dollars: 0.1, setup: 'keep SOL for signatures and token-account rent' };
  if (key === 'bitcoin') return { label: 'about $6', dollars: 6, setup: 'reserve BTC for miner fees and allow several confirmations' };
  if (/arbitrum|optimism|base|zksync|linea|scroll|blast|mantle|starknet/.test(key)) {
    return { label: 'about $0.50', dollars: 0.5, setup: 'fund the rollup gas asset and check bridge settlement delays' };
  }
  return { label: 'about $0.50', dollars: 0.5, setup: 'reserve the native fee asset and check wallet compatibility' };
}
export function gasFor(chain: string): { label: string; dollars: number } {
  const { label, dollars } = networkBudget(chain);
  return { label, dollars };
}
export function stepText(step: FarmStep): string {
  return `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
}
interface ActivityRecipe { open: string; revisit: string; monitor: string; hold: string; close: string; extra: string }
function activity(category: string | null, capital: number): ActivityRecipe {
  const kind = (category ?? '').toLowerCase();
  if (/lend|cdp|collateral/.test(kind)) return {
    open: `Supply $${capital} of an accepted asset; record the collateral settings and receipt balance`,
    revisit: 'Review the supply rate and add a small amount only after checking available withdrawal liquidity',
    monitor: 'Inspect collateral health and interest rates; repay existing debt if the buffer narrows',
    hold: 'track collateral buffers and supply/borrow rates over the interval; exit early if the buffer stays below its starting level.',
    close: 'Repay outstanding debt and interest, then redeem the supplied collateral',
    extra: 'any approval fee and variable borrowing interest',
  };
  if (/dex/.test(kind)) return {
    open: `Allocate $${capital} across both assets of a supported liquidity pool; save its address and fee tier`,
    revisit: `Quote a $${capital / 10} swap and execute it only after inspecting price impact and the minimum received`,
    monitor: 'Inspect pool balances and accumulated fees; adjust the liquidity range only when justified',
    hold: 'compare accumulated pool fees with price drift over the interval; withdraw if fees no longer cover the drift.',
    close: 'Remove liquidity, collect fees and exchange the returned assets into the desired settlement asset',
    extra: 'pool trading fees and possible slippage',
  };
  if (/bridge/.test(kind)) return {
    open: `Send $${capital} through a supported bridge route after checking the destination and quoted receipt`,
    revisit: 'Send a small portion back over the supported return route and verify both explorer receipts',
    monitor: 'Check message finality and destination balances before using any bridged funds',
    hold: 're-verify route finality and destination liquidity during the interval before relying on the return route at exit.',
    close: 'Return the remaining balance through a supported route and confirm source-chain receipt',
    extra: 'bridge fees and gas on both networks',
  };
  if (/stak/.test(kind)) return {
    open: `Stake $${capital} of a supported asset and record the receipt-token conversion rate`,
    revisit: 'Inspect the reward balance and compound only if the claim exceeds transaction fees',
    monitor: 'Review validator exposure, receipt backing and the current unstaking queue',
    hold: 'watch validator performance, receipt backing and the unstaking queue over the interval; start unstaking early if the queue lengthens.',
    close: 'Submit an unstaking request, wait for the queue and redeem the receipt balance',
    extra: 'staking service fees and any redemption charge',
  };
  if (/perp|derivative|option/.test(kind)) return {
    open: `Transfer $${capital} into the margin account; inspect contract terms before placing any order`,
    revisit: `Place and close a position of at most $${capital / 10} notional without leverage; record execution prices`,
    monitor: 'Review margin, funding and open orders; close exposure when the planned loss limit is reached',
    hold: 'total funding paid and margin used over the interval against the planned loss limit; flatten the position if that limit nears.',
    close: 'Cancel orders, close all positions and withdraw the released margin',
    extra: 'execution fees, funding and possible trading losses',
  };
  if (/yield|vault|curator|allocator|farm/.test(kind)) return {
    open: `Subscribe $${capital} to a supported vault after reading its strategy and redemption terms`,
    revisit: 'Compare share value with the initial receipt and test redemption of a small portion',
    monitor: 'Inspect vault allocation, share value and withdrawal availability each week',
    hold: 'compare share growth with the initial receipt and watch strategy/allocation changes; redeem if share value stalls or terms change.',
    close: 'Redeem the remaining shares and collect assets after any withdrawal queue',
    extra: 'vault management, performance and redemption fees',
  };
  return {
    open: `Use $${capital} in the smallest supported deposit workflow after reviewing the asset and withdrawal terms`,
    revisit: 'Test a partial withdrawal and confirm that the wallet received the expected asset',
    monitor: 'Compare the position balance with the initial receipt and inspect available withdrawals',
    hold: 'compare ending terms and balance with the start; note any fee or withdrawal-term changes during the interval.',
    close: 'Withdraw the remaining position and verify the final wallet balance',
    extra: 'the application fees displayed before signing',
  };
}
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'the supported network';
  const network = networkBudget(chain);
  const capital = p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
  const days = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const recipe = activity(p.category, capital);
  const fee = `${network.label} per network action on ${chain}`;
  const ageReview = age === null
    ? 'Listing age unreported: probationary hold; re-check app terms at midpoint.'
    : age < 180
      ? 'Young protocol: re-check terms and TVL direction at midpoint before continuing.'
      : age < 365
        ? 'Re-check app terms once at midpoint.'
        : 'Longer record: review at the end unless weekly checks flag a change.';
  const growthReview = p.change_7d === null
    ? 'Weekly TVL change unreported: judge the hold on recorded balances alone;'
    : p.change_7d >= 0
      ? 'Snapshot weekly TVL did not contract: watch for continued steadiness;'
      : 'Snapshot weekly TVL contracted: review sooner if contraction deepens;';
  return [
    { text: `Prepare a wallet for ${p.name} on ${chain}; ${network.setup}. Verify the application address using its published documentation.`, cost: `wallet setup is free; reserve ${fee}`, time: '10 minutes' },
    { text: `${recipe.open} through ${p.name} on ${chain}. Save the transaction receipt.`, cost: `$${capital} principal plus ${fee}, plus ${recipe.extra}`, time: '15 minutes plus network confirmation' },
    { text: `${recipe.revisit} in ${p.name}; save the before and after balances.`, cost: `existing position capital plus ${fee}, plus ${recipe.extra}`, time: '15 minutes during the following week' },
    { text: `${recipe.monitor} in ${p.name}. Record a weekly balance check and skip unnecessary transactions.`, cost: `balance checks are free; changes incur ${fee} and application fees`, time: '10 minutes each week' },
    { text: `Maintain the ${p.name} position for ${days} days if its risk remains acceptable; ${recipe.hold} ${ageReview} ${growthReview} record balances at the start and end of the interval.`, cost: `$${capital} remains exposed to asset and contract losses; no extra fee for holding`, time: `${days} days with weekly reviews` },
    { text: `Check ${p.name}'s published rewards documentation and save any eligibility rules; compare them with the recorded wallet activity before submitting a claim.`, cost: `reading is free; a legitimate on-chain claim may require ${fee}`, time: '10 minutes after the holding interval' },
    { text: `${recipe.close} through ${p.name}. Save receipts and reconcile principal, proceeds and all fees in a local activity log.`, cost: `budget up to three actions at ${fee}, plus ${recipe.extra}`, time: '20 minutes plus any settlement or withdrawal queue' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols.filter(p => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || lexical(a.slug, b.slug))
    .slice(0, LIVE_ROWS).map(p => ({
      slug: p.slug, name: p.name, category: p.category, chains: [...p.chains],
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
    }));
}
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd,
    listed_at: row.listed_at, age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple, peer_sample: row.model.peer_sample,
    growth_multiplier: row.model.growth_multiplier, maturity_multiplier: row.model.maturity_multiplier,
    confidence: row.model.confidence, why: [...row.why],
    farm_steps: [...row.farm_steps],
  };
}
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watched = new Set(snapshot.watchlist);
  const peers = peerMultiples(snapshot, model);
  const table = new Map<string | null, RadarData['peer_table'][number]>();
  for (const row of board) {
    const basis = peers.byCategory.get(row.category)!;
    table.set(row.category, {
      category: row.category ?? 'Uncategorised', sample: basis.sample,
      multiple: basis.multiple, raw_median: basis.raw_median,
    });
  }
  return { board, radar: {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model: { ...model }, model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter(row => !watched.has(row.slug)).length, live_size: live.length,
    global_multiple: peers.global_multiple,
    peer_table: [...table.values()].sort((a, b) => b.sample - a.sample || lexical(a.category, b.category)),
    rows: board.map(radarRow), live,
  } };
}

export function parseSnapshot(text: string): Snapshot {
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { throw new SnapshotError('Cannot decode snapshot JSON'); }
  if (!record(input)) throw new SnapshotError('Snapshot must be an object');
  if (typeof input.as_of !== 'string' || !Number.isFinite(dateStamp(input.as_of))) throw new SnapshotError('Snapshot needs a valid as_of calendar date');
  if (typeof input.source !== 'string') throw new SnapshotError('Snapshot needs a source string');
  if (!numeric(input.floor_usd) || !Number.isSafeInteger(input.floor_usd) || input.floor_usd <= 0) throw new SnapshotError('Snapshot floor must be a positive integer');
  if (!Array.isArray(input.watchlist) || input.watchlist.some(slug => typeof slug !== 'string')) throw new SnapshotError('Watchlist must contain slug strings');
  if (!Array.isArray(input.protocols)) throw new SnapshotError('Protocols must be an array');
  const seen = new Set<string>();
  const protocols = input.protocols.map((item, position): SnapshotProtocol => {
    if (!record(item) || typeof item.slug !== 'string' || typeof item.name !== 'string' || !numeric(item.tvl_usd) || item.tvl_usd < 0) {
      throw new SnapshotError(`Invalid protocol record at index ${position}`);
    }
    if (seen.has(item.slug)) throw new SnapshotError(`Duplicate protocol slug: ${item.slug}`);
    seen.add(item.slug);
    return {
      slug: item.slug, name: item.name, tvl_usd: item.tvl_usd,
      category: nullableText(item.category),
      chains: Array.isArray(item.chains) ? item.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      change_7d: numeric(item.change_7d) ? item.change_7d : null,
      mcap_usd: numeric(item.mcap_usd) ? item.mcap_usd : null,
      listed_at: nullableText(item.listed_at), gecko_id: nullableText(item.gecko_id), symbol: nullableText(item.symbol),
    };
  });
  return {
    as_of: input.as_of, source: input.source, floor_usd: input.floor_usd,
    watchlist: input.watchlist as string[], protocols,
  };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const present = new Set(board.map(row => row.slug));
  const absent = snapshot.watchlist.filter(slug => !present.has(slug));
  if (absent.length) return `Missing watchlist records: ${absent.slice(0, 5).join(', ')}`;
  if (present.size !== board.length) return 'Board contains duplicate slugs';
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `Expected rank ${i + 1}, received ${row.rank}`;
    if (!isPreToken(row)) return `${row.slug} already records a token`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has an invalid implied value`;
    if (i > 0 && row.implied_value_usd >= board[i - 1]!.implied_value_usd) return `Values must strictly decrease at rank ${i + 1}`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} needs 3–12 farm steps`;
    if (row.farm_steps.some(step => typeof step !== 'string' || step.length < 20 || step.length > 600)) return `${row.slug} has an invalid farm-step string`;
    if (!numeric(row.model.confidence) || row.model.confidence < 0 || row.model.confidence > 1) return `${row.slug} has invalid confidence`;
    if (!Array.isArray(row.why) || row.why.length < 2 || row.why.length > 3 || row.why.some(reason => typeof reason !== 'string' || !reason.trim())) return `${row.slug} needs 2–3 reasons`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
