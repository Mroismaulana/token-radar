// Token Radar (make.fun bounty entry) — Node 22, standard library only.
//
// Reads a sealed DefiLlama snapshot, scores pre-token protocols with an explainable model,
// writes the ranked board and a static dashboard (no network), and builds dossier.json with
// the vendored makefun-board library for judging.
//
// Usage in grader: node /bot/main.ts (reads /input, writes /output)
// Local run:
//   node main.ts --input <snapshot.json> --output out
// Check a written board without touching it:
//   node main.ts --input <snapshot.json> --output out --verify

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, selfCheck, SnapshotError } from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** The entry promises a cover, a detail view and a filtered view. */
const REQUIRED_SCREENSHOTS = 3;

const USAGE = `Token Radar -- rank pre-token protocols by implied value.

Usage:
  node main.ts [--input <snapshot.json|directory>] [--output <directory>] [--verify] [--help]

Options:
  --input <path>    Sealed snapshot file, or a directory holding snapshot.json.
                    Default: /input
  --output <dir>    Where board.json, data.js, dashboard/, screenshots/ and
                    dossier.json are written. Default: $MAKEFUN_OUTPUT_DIR or /output
  --verify          Re-read <output>/board.json and check the gate invariants
                    (ranks, ordering, watchlist coverage). Writes nothing.
  --help, -h        Show this help and exit.

Exit codes:
  0  the build or verification passed
  1  the board breaks a gate invariant
  2  bad arguments, or no readable snapshot
`;

/** The parsed command line. */
interface Cli {
  input: string;
  output: string;
  verify: boolean;
  help: boolean;
}

/** An argument the command line cannot accept. */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * --input/--output take the next argument or an `=value`; --verify and --help are flags.
 * Unknown options and missing values are UsageErrors rather than silent fallbacks.
 */
function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    input: '/input',
    output: process.env.MAKEFUN_OUTPUT_DIR ?? '/output',
    verify: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      cli.help = true;
      continue;
    }
    if (arg === '--verify') {
      cli.verify = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals >= 0 ? arg.slice(0, equals) : arg;
    if (name !== '--input' && name !== '--output') throw new UsageError(`unknown option: ${arg}`);
    const value = equals >= 0 ? arg.slice(equals + 1) : argv[++i];
    if (value === undefined || value === '') throw new UsageError(`${name} needs a value`);
    if (name === '--input') cli.input = value;
    else cli.output = value;
  }
  return cli;
}

/** The snapshot file for an --input value: the file itself, or snapshot.json inside a directory. */
function snapshotPath(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/** A short USD figure for the console summary: $1.2M, $3.4B, $950K. */
function usd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The model's own invariants; a failure means the arithmetic or the fixture drifted. */
function modelCheck(): boolean {
  const report = selfCheck();
  if (report.ok) {
    process.stdout.write(`token-radar: model self-check: ${report.checks.length} / ${report.checks.length} checks passed\n`);
    return true;
  }
  process.stderr.write('token-radar: model self-check failed:\n');
  for (const check of report.checks) {
    if (!check.ok) process.stderr.write(`  ${check.name}: ${check.detail}\n`);
  }
  return false;
}

/** Write board.json, data.js, dashboard/, screenshots/ and dossier.json into `out`. */
function build(snapshot: Snapshot, out: string): number {
  if (!modelCheck()) return 1;

  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    return 1;
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < REQUIRED_SCREENSHOTS) {
    process.stderr.write(
      `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in ${REQUIRED_SCREENSHOTS}, the board, a detail view and a filtered view\n`,
    );
    return 1;
  }
  if (shots.length > SCREENSHOT_CAPS.max) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} images, over the ${SCREENSHOT_CAPS.max} a dossier takes\n`);
    return 1;
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      return 1;
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
  writeFileSync(join(out, 'dossier.json'), dossier);

  const top = board
    .slice(0, 3)
    .map((row) => `#${row.rank} ${row.name} ${usd(row.implied_value_usd)}`)
    .join(' · ');
  process.stdout.write(
    `token-radar: snapshot ${snapshot.as_of}: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist covered\n` +
      `token-radar: ${board.length} ranked rows (${radar.early_size} early additions, ${radar.live_size} live-token protocols set aside)\n` +
      `token-radar: top of the board: ${top}\n` +
      `token-radar: output -> ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard/, screenshots/ (${shots.length}), ${join(out, 'dossier.json')} (${dossier.length} bytes)\n`,
  );
  return 0;
}

/** One line of the --verify report. */
interface VerifyLine {
  label: string;
  ok: boolean;
  detail: string;
}

/** A readable rejection of a board.json that is not even the right shape. */
function boardShapeIssue(rows: unknown[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Partial<BoardRow> | null;
    if (typeof row !== 'object' || row === null) return `row ${i + 1} is not an object`;
    if (typeof row.rank !== 'number' || !Number.isSafeInteger(row.rank)) return `row ${i + 1} has no integer rank`;
    if (typeof row.slug !== 'string' || row.slug === '') return `row ${i + 1} has no slug`;
    if (typeof row.implied_value_usd !== 'number' || !Number.isFinite(row.implied_value_usd)) return `row ${i + 1} has no implied value`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.some((s) => typeof s !== 'string')) return `row ${i + 1} has no farm step list`;
  }
  return null;
}

/** The gate invariants, line by line: ranks, implied ordering, watchlist coverage, then the full gate. */
function boardChecks(rows: BoardRow[], snapshot: Snapshot): VerifyLine[] {
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const rankProblem = ranks.findIndex((rank, i) => rank !== i + 1);
  const contiguous =
    rankProblem === -1
      ? { ok: true, detail: rows.length === 0 ? 'no rows' : `1..${rows.length}` }
      : { ok: false, detail: `expected ${rankProblem + 1}, found ${ranks[rankProblem]}` };

  let orderProblem: string | null = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      orderProblem = `row ${i + 1} ($${rows[i]!.implied_value_usd}) outranks row ${i} ($${rows[i - 1]!.implied_value_usd})`;
      break;
    }
  }
  const values = rows.map((r) => r.implied_value_usd);
  const range = rows.length === 0 ? 'no rows' : `$${Math.max(...values)} .. $${Math.min(...values)}`;

  const covered = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((slug) => !covered.has(slug));

  const issue = boardIssue(rows, snapshot);

  return [
    { label: 'ranks contiguous', ...contiguous },
    { label: 'implied value non-increasing', ok: orderProblem === null, detail: orderProblem ?? range },
    {
      label: 'watchlist covered',
      ok: missing.length === 0,
      detail: missing.length === 0 ? `${snapshot.watchlist.length} / ${snapshot.watchlist.length}` : `missing ${missing.slice(0, 5).join(', ')}`,
    },
    { label: 'gate invariants', ok: issue === null, detail: issue ?? 'farm steps and implied values fit the gate' },
  ];
}

/** Re-read <out>/board.json and report the gate invariants; never write. */
function verify(snapshot: Snapshot, out: string): number {
  if (!modelCheck()) return 1;

  const boardPath = join(out, 'board.json');
  if (!existsSync(boardPath)) {
    process.stderr.write(`token radar: no board at ${boardPath}: run the build first (without --verify)\n`);
    return 2;
  }

  let rows: BoardRow[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(boardPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { rows?: unknown }).rows)) {
      process.stderr.write(`token radar: ${boardPath} has no rows array\n`);
      return 1;
    }
    const raw = (parsed as { rows: unknown[] }).rows;
    const shape = boardShapeIssue(raw);
    if (shape !== null) {
      process.stderr.write(`token radar: ${boardPath}: ${shape}\n`);
      return 1;
    }
    rows = raw as BoardRow[];
  } catch {
    process.stderr.write(`token radar: ${boardPath} is not JSON\n`);
    return 1;
  }

  const checks = boardChecks(rows, snapshot);
  for (const check of checks) {
    process.stdout.write(`token-radar:   ${check.ok ? 'ok  ' : 'FAIL'} ${check.label}: ${check.detail}\n`);
  }
  if (checks.every((c) => c.ok)) {
    process.stdout.write(
      `token-radar: ${boardPath} passes the gate (${rows.length} rows, watchlist ${snapshot.watchlist.length} / ${snapshot.watchlist.length} covered, snapshot ${snapshot.as_of})\n`,
    );
    return 0;
  }
  process.stderr.write(`token radar: ${boardPath} fails the gate; rebuild without --verify\n`);
  return 1;
}

/** Parse the command line, read the snapshot, then build or verify. */
function main(argv: string[]): number {
  let cli: Cli;
  try {
    cli = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    process.stderr.write(`token radar: ${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (cli.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const inputFile = snapshotPath(cli.input);
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    return 2;
  }

  let snapshot: Snapshot;
  try {
    snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  } catch (err) {
    if (!(err instanceof SnapshotError)) throw err;
    process.stderr.write(`token radar: ${inputFile}: ${err.message}\n`);
    return 2;
  }

  return cli.verify ? verify(snapshot, cli.output) : build(snapshot, cli.output);
}

process.exitCode = main(process.argv.slice(2));
