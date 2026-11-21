// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// radar-2 uses medians of live peers' market-cap/TVL in the same category, winsorized
// and shrunk by weighting the category median by its sample size against eight parts of the
// global median. The rounded peer multiple multiplies TVL, growth and maturity to give implied
// value. No protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
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
  peer_shrink_k: 8,
  ratio_floor: 0.02,
  ratio_cap: 3,
  multiple_floor: 0.03,
  multiple_cap: 2,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  peer_table: { category: string; sample: number; multiple: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Live peer statistics; Map keys are category labels, with null kept in its own bucket. */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): {
  global_multiple: number;
  byCategory: Map<string | null, { multiple: number; raw_median: number; sample: number }>;
} {
  const buckets = new Map<string | null, number[]>();
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (!buckets.has(p.category)) buckets.set(p.category, []);
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = Math.min(model.ratio_cap, Math.max(model.ratio_floor, p.mcap_usd / p.tvl_usd));
    ratios.push(ratio);
    buckets.get(p.category)!.push(ratio);
  }
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  // An empty live universe falls back to the minimum peer multiple, never NaN.
  const global = ratios.length ? median(ratios) : model.multiple_floor;
  const byCategory = new Map<string | null, { multiple: number; raw_median: number; sample: number }>();
  for (const [category, values] of buckets) {
    const sample = values.length;
    const raw = sample ? median(values) : global;
    const shrunk = sample ? (sample * raw + model.peer_shrink_k * global) / (sample + model.peer_shrink_k) : global;
    byCategory.set(category, {
      multiple: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk))),
      raw_median: round4(raw), sample,
    });
  }
  return { global_multiple: round4(global), byCategory };
}

/** Score with a rounded peer multiple; growth and maturity retain full precision for valuation. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, peerMultiple: number, model: ModelConstants = MODEL): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * round4(peerMultiple);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const bucket = peers.byCategory.get(p.category);
    const peer = p.category === null
      ? round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, peers.global_multiple)))
      : bucket!.multiple;
    const sample = p.category === null ? 0 : bucket!.sample;
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, peer, model);
    return { p, peer, sample, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.peer,
      peer_sample: s.sample,
      global_multiple: peers.global_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Network fee estimate for one action on the primary chain. */
export function gasFor(chain: string): { label: string; dollars: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum' || c === 'bitcoin') return { label: 'about $6', dollars: 6 };
  if (c === 'solana') return { label: 'under $0.10', dollars: 0.1 };
  return { label: 'about $0.50', dollars: 0.5 };
}

/** Seven steps selected only from the record's category, primary chain, TVL and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
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
  const fees = (actions: number): string => actions === 1
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
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_sample: row.model.peer_sample,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: peerMultiples(snapshot, model).global_multiple,
    peer_table: [...new Set(board.map((r) => r.category ?? 'Uncategorised'))].map((category) => {
      const row = board.find((r) => (r.category ?? 'Uncategorised') === category)!;
      return { category, sample: row.model.peer_sample, multiple: row.model.peer_multiple };
    }).sort((a, b) => b.sample - a.sample || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0)),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
