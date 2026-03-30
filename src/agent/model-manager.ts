/**
 * Model manager — handles switching between local LLM models.
 * Restarts llama-server when the model changes.
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface ModelDef {
  id: string;
  name: string;
  file: string;        // filename in models/ directory
  paramCount: string;   // e.g. "9B", "4B"
  quantization: string; // e.g. "Q4_K_M"
}

const MODELS: ModelDef[] = [
  {
    id: 'qwen3.5-4b',
    name: 'Qwen 3.5 4B',
    file: 'Qwen3.5-4B.Q4_K_M.gguf',
    paramCount: '4B',
    quantization: 'Q4_K_M',
  },
];

const modelsDir = path.join(import.meta.dirname, '../../models');
const serverBin = path.join(import.meta.dirname, '../../bin/llama-server');

let currentModelId: string = MODELS[0].id;
let llamaProcess: ChildProcess | null = null;
let llamaPort = parseInt(process.env.LLM_PORT || '8080', 10);

/** Kill any llama-server process listening on our port */
async function killExternalLlamaServer(): Promise<void> {
  try {
    const output = execSync(`lsof -ti tcp:${llamaPort}`, { encoding: 'utf-8' }).trim();
    if (output) {
      const pids = output.split('\n').map(p => p.trim()).filter(Boolean);
      for (const pid of pids) {
        console.log(`[ModelManager] Killing external process on port ${llamaPort} (pid ${pid})...`);
        process.kill(parseInt(pid), 'SIGTERM');
      }
      // Wait for port to be free
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch { /* no process on port — that's fine */ }
}

export function getModels(): (ModelDef & { active: boolean; available: boolean })[] {
  return MODELS.map(m => ({
    ...m,
    active: m.id === currentModelId,
    available: fs.existsSync(path.join(modelsDir, m.file)),
  }));
}

export function getCurrentModel(): ModelDef {
  return MODELS.find(m => m.id === currentModelId) || MODELS[0];
}

/** Check if llama-server is managed by us */
export function isManaged(): boolean {
  return llamaProcess !== null;
}

/** Wait for llama-server health endpoint */
async function waitForReady(port: number, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Switch to a different model. Kills current llama-server and starts a new one.
 * If llama-server wasn't started by us, starts managing it.
 */
export async function switchModel(modelId: string): Promise<{ success: boolean; error?: string }> {
  const model = MODELS.find(m => m.id === modelId);
  if (!model) return { success: false, error: `Unknown model: ${modelId}` };

  const modelPath = path.join(modelsDir, model.file);
  if (!fs.existsSync(modelPath)) {
    return { success: false, error: `Model file not found: ${model.file}` };
  }

  if (!fs.existsSync(serverBin)) {
    return { success: false, error: `llama-server binary not found at ${serverBin}` };
  }

  // Kill existing llama-server — managed or external
  if (llamaProcess) {
    console.log(`[ModelManager] Stopping managed llama-server (pid ${llamaProcess.pid})...`);
    llamaProcess.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        llamaProcess?.kill('SIGKILL');
        resolve();
      }, 5000);
      llamaProcess?.on('exit', () => { clearTimeout(timeout); resolve(); });
    });
    llamaProcess = null;
  } else {
    // Kill any external llama-server on our port
    await killExternalLlamaServer();
  }

  // Start new llama-server
  const ctxSize = process.env.LLM_CTX_SIZE || '16384';
  console.log(`[ModelManager] Starting llama-server with ${model.name} on port ${llamaPort}...`);

  llamaProcess = spawn(serverBin, [
    '--model', modelPath,
    '--host', '0.0.0.0',
    '--port', String(llamaPort),
    '--ctx-size', ctxSize,
    '--n-gpu-layers', '99',
    '--flash-attn', 'on',
    '--parallel', '1',
    '--slots',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  llamaProcess.stdout?.on('data', () => {});
  llamaProcess.stderr?.on('data', () => {});
  llamaProcess.on('exit', () => { llamaProcess = null; });

  // Wait for health
  const ready = await waitForReady(llamaPort);
  if (!ready) {
    llamaProcess?.kill('SIGKILL');
    llamaProcess = null;
    return { success: false, error: 'llama-server failed to start within timeout' };
  }

  currentModelId = modelId;
  console.log(`[ModelManager] ${model.name} ready on port ${llamaPort}`);
  return { success: true };
}

/** Detect current model from env or running llama-server process */
export function detectCurrentModel(): void {
  // Check env var first
  const envModel = process.env.LLM_MODEL_PATH;
  if (envModel) {
    const match = MODELS.find(m => envModel.includes(m.file));
    if (match) { currentModelId = match.id; return; }
  }

  // Check running llama-server process args
  try {
    const output = execSync(`ps aux | grep llama-server | grep -v grep`, { encoding: 'utf-8' });
    const match = MODELS.find(m => output.includes(m.file));
    if (match) { currentModelId = match.id; return; }
  } catch { /* no running process */ }
}

/** Cleanup on shutdown */
export function cleanup(): void {
  if (llamaProcess) {
    llamaProcess.kill('SIGTERM');
    llamaProcess = null;
  }
}
