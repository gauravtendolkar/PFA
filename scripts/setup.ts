/**
 * PFA Setup Wizard
 *
 * Interactive setup script that handles first-time installation:
 * 1. npm install (root + client)
 * 2. Download llama-server binary
 * 3. Download LLM model
 * 4. Create .env file
 * 5. Run database migration
 *
 * Each step is idempotent — safe to re-run.
 *
 * Usage: npm run setup
 */
import { createInterface } from 'readline';
import { existsSync, mkdirSync, createWriteStream, writeFileSync, readFileSync, chmodSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const ROOT = join(import.meta.dirname, '..');
const rl = createInterface({ input: process.stdin, output: process.stdout });

const LLAMA_RELEASE_TAG = 'b8578';
const MODEL_URL = 'https://huggingface.co/Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-v2-GGUF/resolve/main/Qwen3.5-4B.Q4_K_M.gguf';
const MODEL_PATH = join(ROOT, 'models', 'Qwen3.5-4B.Q4_K_M.gguf');
const BIN_PATH = join(ROOT, 'bin', 'llama-server');

// ── Helpers ────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

function log(msg: string) { console.log(`\x1b[36m▸\x1b[0m ${msg}`); }
function success(msg: string) { console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
function warn(msg: string) { console.log(`\x1b[33m!\x1b[0m ${msg}`); }
function header(msg: string) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

async function downloadFile(url: string, dest: string, label: string): Promise<void> {
  log(`Downloading ${label}...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const total = parseInt(res.headers.get('content-length') || '0', 10);
  const destStream = createWriteStream(dest);

  if (!res.body) throw new Error('No response body');

  let downloaded = 0;
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    destStream.write(value);
    downloaded += value.length;
    if (total > 0) {
      const pct = ((downloaded / total) * 100).toFixed(1);
      const mb = (downloaded / 1024 / 1024).toFixed(1);
      const totalMb = (total / 1024 / 1024).toFixed(1);
      process.stdout.write(`\r  ${mb} MB / ${totalMb} MB (${pct}%)`);
    } else {
      const mb = (downloaded / 1024 / 1024).toFixed(1);
      process.stdout.write(`\r  ${mb} MB downloaded`);
    }
  }

  destStream.end();
  await new Promise<void>((resolve, reject) => {
    destStream.on('finish', resolve);
    destStream.on('error', reject);
  });
  console.log(); // newline after progress
}

// ── Step 1: npm install ────────────────────────────────────────────

async function stepInstallDeps() {
  header('Step 1/5: Dependencies');

  const rootModules = join(ROOT, 'node_modules');
  const clientModules = join(ROOT, 'client', 'node_modules');

  if (existsSync(rootModules) && existsSync(clientModules)) {
    success('Dependencies already installed');
    return;
  }

  if (!existsSync(rootModules)) {
    log('Installing root dependencies...');
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  }

  if (!existsSync(clientModules)) {
    log('Installing client dependencies...');
    execSync('npm install', { cwd: join(ROOT, 'client'), stdio: 'inherit' });
  }

  success('Dependencies installed');
}

// ── Step 2: llama-server binary ────────────────────────────────────

async function stepDownloadBinary() {
  header('Step 2/5: LLM Server Binary');

  if (existsSync(BIN_PATH)) {
    success('llama-server binary already exists');
    return;
  }

  const platform = process.platform;
  const arch = process.arch;

  let assetPlatform: string;
  if (platform === 'darwin' && arch === 'arm64') assetPlatform = 'macos-arm64';
  else if (platform === 'darwin' && arch === 'x64') assetPlatform = 'macos-x64';
  else if (platform === 'linux' && arch === 'x64') assetPlatform = 'ubuntu-x64';
  else {
    warn(`No pre-built binary for ${platform}-${arch}. You'll need to build llama-server manually.`);
    warn('See: https://github.com/ggml-org/llama.cpp#build');
    return;
  }

  const tarName = `llama-${LLAMA_RELEASE_TAG}-bin-${assetPlatform}.tar.gz`;
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_RELEASE_TAG}/${tarName}`;
  const tarPath = join(ROOT, 'bin', tarName);

  mkdirSync(join(ROOT, 'bin'), { recursive: true });

  await downloadFile(url, tarPath, `llama-server (${assetPlatform})`);

  log('Extracting...');
  execSync(`tar -xzf "${tarPath}" -C "${join(ROOT, 'bin')}"`, { stdio: 'inherit' });

  // The binary is inside llama-{tag}/llama-server
  const extractedBin = join(ROOT, 'bin', `llama-${LLAMA_RELEASE_TAG}`, 'llama-server');
  if (existsSync(extractedBin)) {
    execSync(`mv "${extractedBin}" "${BIN_PATH}"`);
    // Also move shared libraries
    const extractedDir = join(ROOT, 'bin', `llama-${LLAMA_RELEASE_TAG}`);
    try {
      execSync(`mv "${extractedDir}"/lib* "${join(ROOT, 'bin')}/" 2>/dev/null || true`, { stdio: 'inherit' });
      execSync(`rm -rf "${extractedDir}"`, { stdio: 'inherit' });
    } catch { /* cleanup is best-effort */ }
  }

  chmodSync(BIN_PATH, 0o755);
  execSync(`rm -f "${tarPath}"`);

  success('llama-server binary installed');
}

// ── Step 3: Download model ─────────────────────────────────────────

async function stepDownloadModel() {
  header('Step 3/5: LLM Model');

  if (existsSync(MODEL_PATH)) {
    success('Model already downloaded');
    return;
  }

  const answer = await ask('  Download Qwen 3.5 4B model (~2.7 GB)? [Y/n] ');
  if (answer.toLowerCase() === 'n') {
    warn('Skipped model download. Place your model at: models/Qwen3.5-4B.Q4_K_M.gguf');
    return;
  }

  mkdirSync(join(ROOT, 'models'), { recursive: true });
  await downloadFile(MODEL_URL, MODEL_PATH, 'Qwen 3.5 4B (Q4_K_M)');
  success('Model downloaded');
}

// ── Step 4: Create .env ────────────────────────────────────────────

async function stepCreateEnv() {
  header('Step 4/5: Configuration');

  const envPath = join(ROOT, '.env');

  if (existsSync(envPath)) {
    const overwrite = await ask('  .env already exists. Overwrite? [y/N] ');
    if (overwrite.toLowerCase() !== 'y') {
      success('Keeping existing .env');
      return;
    }
  }

  log('Bank sync uses SimpleFIN — no API keys needed!');
  log('Connect your bank in-app after setup. ($1.50/month via SimpleFIN)\n');

  const envContent = [
    '# Bank Connection — SimpleFIN (no config needed)',
    '# Connect your bank in-app via the Connect Account button',
    '# SimpleFIN: https://bridge.simplefin.org ($1.50/month)',
    '',
    '# Server',
    'PFA_PORT=3120',
    `PFA_DATA_DIR=./.pfa`,
    '',
    '# LLM',
    'LLM_BASE_URL=http://localhost:8080',
    'LLM_PORT=8080',
    `LLM_MODEL_PATH=./models/Qwen3.5-4B.Q4_K_M.gguf`,
    'LLM_CTX_SIZE=16384',
    '',
  ].join('\n');

  writeFileSync(envPath, envContent);
  success('.env created');
}

// ── Step 5: Database migration ─────────────────────────────────────

async function stepMigrate() {
  header('Step 5/5: Database');

  log('Running migration...');
  execSync('npx tsx src/db/migrate.ts', { cwd: ROOT, stdio: 'inherit' });
  success('Database ready');
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`
\x1b[1m╔══════════════════════════════════╗
║       PFA Setup Wizard           ║
║  Personal Finance Agent          ║
╚══════════════════════════════════╝\x1b[0m
`);

  try {
    await stepInstallDeps();
    await stepDownloadBinary();
    await stepDownloadModel();
    await stepCreateEnv();
    await stepMigrate();

    console.log(`
\x1b[32m\x1b[1m Setup complete!\x1b[0m

  \x1b[1mStart:\x1b[0m    npm run dev
  \x1b[1mOpen:\x1b[0m     http://localhost:5173

  ${existsSync(BIN_PATH) ? '\x1b[32m✓\x1b[0m LLM binary' : '\x1b[33m!\x1b[0m LLM binary (missing)'}
  ${existsSync(MODEL_PATH) ? '\x1b[32m✓\x1b[0m Model' : '\x1b[33m!\x1b[0m Model (missing)'}
  \x1b[32m✓\x1b[0m Database
`);
  } catch (err) {
    console.error('\n\x1b[31mSetup failed:\x1b[0m', err);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
