// Build one offline research bundle from one sealed protocol snapshot.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import type { BoardRow, RadarData, Snapshot } from './lib/model.ts';
import { buildDossier, DOSSIER_MAX_BYTES } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CAPS = {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
};
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
interface Options { input: string; output: string }
interface CopiedAssets { dashboard: string[]; screenshots: string[] }
class RunFailure extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function parseArguments(args: string[], environment: NodeJS.ProcessEnv): Options {
  function option(name: string, fallback: string): string {
    const flag = `--${name}`;
    const separate = args.indexOf(flag);
    if (separate >= 0 && separate + 1 < args.length) return args[separate + 1]!;
    const inline = args.find(value => value.startsWith(`${flag}=`));
    return inline === undefined ? fallback : inline.slice(flag.length + 1);
  }
  return { input: option('input', '/input'), output: option('output', environment.MAKEFUN_OUTPUT_DIR ?? '/output') };
}

function loadSnapshot(input: string): Snapshot {
  const path = input.endsWith('.json') || (existsSync(input) && statSync(input).isFile())
    ? input : join(input, 'snapshot.json');
  if (!existsSync(path)) {
    throw new RunFailure(`snapshot missing at ${path}; supply --input <file|directory> or mount /input/snapshot.json`, 2);
  }
  return parseSnapshot(readFileSync(path, 'utf8'));
}

function validateBoard(board: BoardRow[], snapshot: Snapshot): void {
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new RunFailure(`board validation failed: ${issue}`);
}

function writeScoredOutput(output: string, board: BoardRow[], radar: RadarData): void {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(output, 'data.js'), dataScript(radar));
}

// Flat asset directories match the submission layout; hidden entries are excluded.
function copyDirectoryFiles(source: string, destination: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(destination, { recursive: true });
  const names = readdirSync(source).filter(name => !name.startsWith('.') && statSync(join(source, name)).isFile()).sort();
  for (const name of names) copyFileSync(join(source, name), join(destination, name));
  return names;
}

// Check the container signature and its closing marker, without trusting extensions.
// These checks catch empty, renamed and common truncated captures; they are not an image decoder.
function validateScreenshot(path: string, name: string): void {
  if (!SCREENSHOT_NAME.test(name)) throw new RunFailure(`invalid screenshot name ${name}; use 1–128 letters, digits, dots, underscores or hyphens, starting with a letter, digit or underscore`);
  const size = statSync(path).size;
  if (size > CAPS.screenshots.max_bytes) throw new RunFailure(`screenshot ${name} is ${size} bytes; limit is ${CAPS.screenshots.max_bytes}`);
  const bytes = readFileSync(path);
  const png = bytes.length >= 45
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (!png && !jpeg) throw new RunFailure(`screenshot ${name} lacks a complete PNG or JPEG signature and end marker`);
}

function copyDashboardAndScreenshots(output: string): CopiedAssets {
  const dashboard = copyDirectoryFiles(join(ROOT, 'dashboard'), join(output, 'dashboard'));
  const screenshots = copyDirectoryFiles(join(ROOT, 'screenshots'), join(output, 'screenshots'));
  if (screenshots.length < 3) throw new RunFailure(`only ${screenshots.length} screenshots supplied; provide at least 3: board, protocol detail and filtered board`);
  if (screenshots.length > CAPS.screenshots.max) throw new RunFailure(`supplied ${screenshots.length} screenshots; limit is ${CAPS.screenshots.max}`);
  for (const name of screenshots) validateScreenshot(join(output, 'screenshots', name), name);
  return { dashboard, screenshots };
}

function writeDossier(output: string): number {
  const bytes = buildDossier(output, CAPS);
  if (bytes.byteLength > DOSSIER_MAX_BYTES) throw new RunFailure(`dossier exceeds ${DOSSIER_MAX_BYTES} bytes`);
  const path = join(output, 'dossier.json');
  // This is the final artifact write. Everything it describes is already in place.
  writeFileSync(path, bytes);
  const saved = readFileSync(path);
  if (saved.length !== bytes.byteLength || !saved.equals(Buffer.from(bytes))) throw new RunFailure('dossier read-back differs from the generated bytes');
  return saved.length;
}

function reportSummary(snapshot: Snapshot, board: BoardRow[], radar: RadarData, output: string, assets: CopiedAssets, dossierBytes: number): void {
  const leader = board[0];
  const top = leader ? `${leader.name} ($${leader.implied_value_usd.toLocaleString('en-US')})` : 'none';
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside), model ${radar.model_version}, global peer multiple ${radar.global_multiple.toFixed(4)}x; top row: ${top}\n` +
    `token radar: wrote ${join(output, 'board.json')}, ${join(output, 'data.js')}, ${join(output, 'dashboard')} (${assets.dashboard.length} files), ${join(output, 'screenshots')} (${assets.screenshots.length} images), ${join(output, 'dossier.json')} (${dossierBytes} bytes; read-back verified)\n`,
  );
}

function main(): void {
  const options = parseArguments(process.argv.slice(2), process.env);
  const snapshot = loadSnapshot(options.input);
  const { board, radar } = buildRadar(snapshot);
  validateBoard(board, snapshot);
  writeScoredOutput(options.output, board, radar);
  const assets = copyDashboardAndScreenshots(options.output);
  const dossierBytes = writeDossier(options.output);
  reportSummary(snapshot, board, radar, options.output, assets, dossierBytes);
}

try {
  main();
} catch (error) {
  process.stderr.write(`token radar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof RunFailure ? error.exitCode : 1;
}
