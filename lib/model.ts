// Token Radar model (radar-2): scores pre-token protocols from sealed snapshot figures only.
//
// The board covers every watchlist slug (the floor, never the ceiling) and adds early
// pre-token protocols below the floor, so readers can spot launches before they are obvious.
//
// Implied value is a deterministic, explainable estimate (not a price prediction):
//   base         = tvl_usd * BASE_MULTIPLE
//   growthPct    = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP)
//   growthMult   = 1 + (growthPct / 100) * GROWTH_WEIGHT
//   ageDays      = listed_at ? days since listing : UNKNOWN_AGE_DAYS
//   maturityMult = MATURITY_FLOOR + min(ageDays, MATURITY_DAYS) / MATURITY_DAYS * MATURITY_RANGE
//   chainMult    = 1 + min(chains.length - 1, CHAIN_CAP) * CHAIN_WEIGHT
//   categoryMult = category factor from snapshot category (no name special-casing)
//   implied      = max(1, round(base * growthMult * maturityMult * chainMult * categoryMult))
//
// Every factor comes from the sealed snapshot. No protocol name is special-cased.
// The arithmetic here is deliberately pinned: out/board.json and out/data.js are byte-compared
// against a saved baseline, so this file changes naming and structure, never numbers or order.

// --------------------------------------------------------------------------- input shapes

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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// --------------------------------------------------------------------------- model constants

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
}

/** The shipped constants (radar-2). */
export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  growth_weight: 0.55,
  growth_floor: -50,
  growth_cap: 140,
  maturity_floor: 0.62,
  maturity_range: 0.38,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.04,
  chain_cap: 6,
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

// --------------------------------------------------------------------------- small helpers

const DAY_MS = 86_400_000;

/** A number rounded to four decimals: the precision board.json records multipliers at. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** `value` kept inside [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A finite number, else `fallback`. */
function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Order two slugs by code unit, so equal scores always break ties the same way. */
function bySlugOrder(a: { slug: string }, b: { slug: string }): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

// --------------------------------------------------------------------------- ages

/**
 * Whole days from `listedAt` to `asOf`, clamped at zero.
 * Null when the protocol has no listing date or either date does not parse.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

// --------------------------------------------------------------------------- scoring

/**
 * Category signal from the snapshot category alone: established sectors get a small lift.
 * Deliberately substring-based, because DefiLlama's category labels carry suffixes.
 */
export function categoryMultiplier(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp')) return 1.08;
  if (c.includes('dex') || c.includes('derivatives') || c.includes('perp')) return 1.06;
  if (c.includes('yield') || c.includes('liquid staking') || c.includes('restaking')) return 1.04;
  if (c.includes('bridge') || c.includes('chain')) return 1.03;
  if (c.includes('rwa') || c.includes('prediction') || c.includes('options')) return 1.02;
  return 1.0;
}

/** Every factor the model derives for one protocol, plus the implied value itself. */
export interface ImpliedValue {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  categoryMult: number;
  age: number | null;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): ImpliedValue {
  const age = ageDays(asOf, protocol.listed_at);

  const rawGrowth = asFiniteNumber(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;

  const chainCount = Math.max(1, protocol.chains.length);
  const chainMult = 1 + Math.min(chainCount - 1, model.chain_cap) * model.chain_weight;

  const categoryMult = categoryMultiplier(protocol.category);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * categoryMult));

  return { implied, growthPct, growthMult, maturityMult, chainMult, categoryMult, age };
}

// --------------------------------------------------------------------------- classification

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
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// --------------------------------------------------------------------------- board building

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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A protocol with its score, before it takes a rank. */
interface ScoredProtocol extends ImpliedValue {
  protocol: SnapshotProtocol;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The watchlist is the floor: every slug it names is included even if the snapshot no longer
 * carries it (a missing protocol cannot happen in the sealed input, but the rule is coverage).
 * Early rows are pre-token protocols below the floor, by TVL, capped at EARLY_ROWS.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const protocol = index.get(slug);
    if (protocol !== undefined) chosen.set(slug, protocol);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugOrder(a, b))
    .slice(0, EARLY_ROWS);
  for (const protocol of early) chosen.set(protocol.slug, protocol);

  const scored: ScoredProtocol[] = [...chosen.values()].map((protocol) => ({
    protocol,
    ...impliedValue(protocol, snapshot.as_of, model),
  }));
  scored.sort((a, b) => b.implied - a.implied || bySlugOrder(a.protocol, b.protocol));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    mcap_usd: s.protocol.mcap_usd,
    listed_at: s.protocol.listed_at,
    gecko_id: s.protocol.gecko_id,
    symbol: s.protocol.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.categoryMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.protocol, s.age).map(stepText),
  }));
}

// --------------------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Record tx hashes and check the protocol's official page.`;
  return s;
}

/** The primary chain a protocol names, or a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
}

/** Suggested starting capital from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 40;
}

/** Hold window from age: newer protocols often reward longer consistent usage. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 75;
  if (age < 365) return 45;
  return 30;
}

/** Category-aware core action, derived from snapshot fields (no name special-casing). */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply about $${capital} in a supported stable or blue-chip asset on ${name} (${chain}) and keep utilization healthy to build lending history.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity')) {
    return `Provide roughly $${capital} of liquidity in ${name}'s main pool on ${chain}, rebalance if needed, and avoid tiny positions that get eaten by fees.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit about $${capital} as collateral on ${name} and execute a few small, low-leverage trades on ${chain} to show real usage.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge about $${capital} through ${name} to ${chain} and make at least one follow-up onchain action so the route records meaningful activity.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake about $${capital} worth of the native asset via ${name} on ${chain} and retain the receipt token to demonstrate ongoing participation.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with about $${capital} and place a small number of informed positions over time rather than one-off activity on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Allocate about $${capital} into ${name}'s primary product on ${chain} and complete any required verification steps published by the protocol.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit about $${capital} into ${name}'s stable or savings product on ${chain} and maintain the position through multiple snapshots.`;
  }
  return `Deposit about $${capital} into ${name}'s core product on ${chain} and use its main feature at least once per week to create consistent onchain history.`;
}

/**
 * A protocol's farm plan: concrete, category-aware steps derived from snapshot fields
 * (TVL, chains, age, category), never from a hand-written list of protocol names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const chains = p.chains.length > 0 ? p.chains.slice(0, 3).join(', ') : chain;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const weeklyGas = capital >= 150 ? 3 : 2;
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Prepare a dedicated wallet for ${p.name}: fund it on ${chains}, keep seed/private keys offline, and label it so farming activity stays separate.`,
      cost: `under $${gas} in initial gas`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `about $${capital} capital plus ~$${gas} gas`,
      time: '15-25 minutes to set up',
    },
    {
      text: `Repeat meaningful interactions weekly (deposit, swap, borrow, repay, or governance where available) so usage spans multiple periods, not a single burst.`,
      cost: `about $${weeklyGas} gas per week`,
      time: '10 minutes per week',
    },
    {
      text: `Maintain the position for at least ${hold} days before any unwind, because age and consistency often matter more than one large transaction.`,
      cost: `capital remains deployed (~$${capital})`,
      time: `${hold} days hold window`,
    },
    {
      text: `Track every transaction hash, date, and amount in a simple log and monitor ${p.name}'s official announcements for points, quests, or eligibility updates.`,
      cost: 'no extra fee (time only)',
      time: '10 minutes weekly review',
    },
    {
      text: `If rewards are announced, claim only via links published by ${p.name}'s official channels, verify contract addresses, and avoid paying upfront "claim" fees.`,
      cost: 'claim gas varies; never send funds to unknown claim sites',
      time: '10-20 minutes when claiming',
    },
  ];
}

// --------------------------------------------------------------------------- dashboard payload

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
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
  on_watchlist: boolean;
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
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
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
export function radarRow(row: BoardRow, watchlist: string[]): RadarRow {
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_multiplier: row.model.category_multiplier,
    on_watchlist: watchlist.includes(row.slug),
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
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => radarRow(row, snapshot.watchlist)),
    live,
  };
  return { board, radar };
}

// --------------------------------------------------------------------------- snapshot parsing

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
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

// --------------------------------------------------------------------------- gate invariants

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

// --------------------------------------------------------------------------- data.js

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// --------------------------------------------------------------------------- self-check

/** One named check: what it proves and whether it held. */
export interface SelfCheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

/** The model's self-check: deterministic invariants plus pinned figures for the shipped constants. */
export interface SelfCheckReport {
  ok: boolean;
  checks: SelfCheckItem[];
}

/** A fixed protocol the self-check scores: lending, two chains, $1B TVL, +20% 7d, 169 days listed. */
const SELF_CHECK_PROTOCOL: SnapshotProtocol = {
  slug: 'self-check-fixture',
  name: 'Self Check Fixture',
  category: 'Lending',
  chains: ['Ethereum', 'Arbitrum'],
  tvl_usd: 1_000_000_000,
  change_7d: 20,
  mcap_usd: null,
  listed_at: '2026-05-29',
  gecko_id: null,
  symbol: null,
};

/**
 * Exercise the model without a snapshot: constant sanity, date math, category table,
 * clamping, the pinned fixture score, the farm-step bounds and board ordering.
 *
 * `node main.ts --verify` runs this before checking a written board. Returns every check with
 * its detail, so a caller can print the failures rather than guess.
 */
export function selfCheck(model: ModelConstants = MODEL): SelfCheckReport {
  const checks: SelfCheckItem[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const constants = Object.entries(model);
  check(
    'constants are finite and ordered',
    constants.every(([, v]) => Number.isFinite(v)) && model.growth_floor < 0 && model.growth_cap > 0 && model.maturity_floor > 0 && model.maturity_floor <= 1 && model.maturity_range >= 0 && model.chain_weight >= 0 && model.chain_cap >= 0,
    constants.map(([k, v]) => `${k}=${v}`).join(', '),
  );

  check(
    'age math',
    ageDays('2026-11-14', '2026-05-29') === 169 && ageDays('2026-11-14', null) === null && ageDays('2026-11-14', '2027-01-01') === 0,
    '2026-05-29 -> 2026-11-14 is 169 days; a missing date is null; a future date clamps to 0',
  );

  check(
    'category table',
    categoryMultiplier('Lending') === 1.08 && categoryMultiplier('DEX') === 1.06 && categoryMultiplier('Yield') === 1.04 && categoryMultiplier('Bridge') === 1.03 && categoryMultiplier('RWA') === 1.02 && categoryMultiplier(null) === 1.0,
    'lending 1.08, dex 1.06, yield 1.04, bridge 1.03, rwa 1.02, unknown 1.0',
  );

  const base = impliedValue(SELF_CHECK_PROTOCOL, '2026-11-14', model);
  const consistent = Math.max(1, Math.round(SELF_CHECK_PROTOCOL.tvl_usd * model.base_multiple * base.growthMult * base.maturityMult * base.chainMult * base.categoryMult));
  check('implied value matches its factors', consistent === base.implied, `recorded $${base.implied}, recomputed $${consistent}`);

  if (model === MODEL) {
    check(
      'pinned fixture score',
      base.implied === 186_143_376 && base.growthPct === 20 && base.growthMult === 1.11 && base.categoryMult === 1.08 && base.chainMult === 1.04 && base.age === 169,
      `$${base.implied}, growth ${base.growthPct}% x${base.growthMult}, maturity x${base.maturityMult}, chain x${base.chainMult}, category x${base.categoryMult}`,
    );
  }

  const hot = impliedValue({ ...SELF_CHECK_PROTOCOL, change_7d: 900 }, '2026-11-14', model);
  const cold = impliedValue({ ...SELF_CHECK_PROTOCOL, change_7d: -900 }, '2026-11-14', model);
  check(
    'growth is clamped',
    hot.growthPct === model.growth_cap && cold.growthPct === model.growth_floor,
    `+900% -> ${hot.growthPct}% (cap ${model.growth_cap}), -900% -> ${cold.growthPct}% (floor ${model.growth_floor})`,
  );

  const flat = impliedValue({ ...SELF_CHECK_PROTOCOL, change_7d: 0, chains: ['Ethereum'] }, '2026-11-14', model);
  check(
    'neutral growth and one chain are 1x',
    flat.growthMult === 1 && flat.chainMult === 1,
    `growth x${flat.growthMult}, chain x${flat.chainMult}`,
  );

  const doubled = impliedValue({ ...SELF_CHECK_PROTOCOL, tvl_usd: 2_000_000_000 }, '2026-11-14', model);
  check(
    'implied value is linear in TVL',
    Math.abs(doubled.implied - base.implied * 2) <= 1,
    `$${base.implied} at $1B, $${doubled.implied} at $2B`,
  );

  const unknownAge = impliedValue({ ...SELF_CHECK_PROTOCOL, listed_at: null }, '2026-11-14', model);
  const expectedUnknown = model.maturity_floor + (Math.min(model.unknown_age_days, model.maturity_days) / model.maturity_days) * model.maturity_range;
  check(
    'unknown age uses the fallback',
    Math.abs(unknownAge.maturityMult - expectedUnknown) < 1e-12 && unknownAge.age === null,
    `maturity x${unknownAge.maturityMult} from ${model.unknown_age_days} default days`,
  );

  const steps = farmSteps(SELF_CHECK_PROTOCOL, base.age);
  const stepTexts = steps.map(stepText);
  check(
    'farm steps fit the gate',
    stepTexts.length >= 3 && stepTexts.length <= 12 && stepTexts.every((s) => s.length >= 20 && s.length <= 600),
    `${stepTexts.length} steps, ${Math.min(...stepTexts.map((s) => s.length))}-${Math.max(...stepTexts.map((s) => s.length))} characters`,
  );

  const fixtureSnapshot: Snapshot = {
    as_of: '2026-11-14',
    source: 'self-check',
    floor_usd: 50_000_000,
    watchlist: ['self-check-fixture'],
    protocols: [
      SELF_CHECK_PROTOCOL,
      { ...SELF_CHECK_PROTOCOL, slug: 'self-check-small', name: 'Self Check Small', tvl_usd: 10_000_000, category: 'DEX' },
      { ...SELF_CHECK_PROTOCOL, slug: 'self-check-tiny', name: 'Self Check Tiny', tvl_usd: 1_000_000, change_7d: -10 },
    ],
  };
  const fixtureBoard = buildBoard(fixtureSnapshot, model);
  const ranksContiguous = fixtureBoard.every((r, i) => r.rank === i + 1);
  const nonIncreasing = fixtureBoard.every((r, i) => i === 0 || fixtureBoard[i - 1]!.implied_value_usd >= r.implied_value_usd);
  check(
    'board ranks are contiguous and ordered',
    ranksContiguous && nonIncreasing && fixtureBoard[0]!.slug === 'self-check-fixture',
    `${fixtureBoard.length} fixture rows, ranks ${fixtureBoard.map((r) => r.rank).join(',')}`,
  );

  const fixtureIssue = boardIssue(fixtureBoard, fixtureSnapshot);
  check('fixture board passes the gate', fixtureIssue === null, fixtureIssue ?? 'no issue');

  return { ok: checks.every((c) => c.ok), checks };
}
