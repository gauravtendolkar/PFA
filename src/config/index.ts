import 'dotenv/config';
import path from 'path';
import os from 'os';
import fs from 'fs';

const dataDir = process.env.PFA_DATA_DIR || path.join(os.homedir(), '.pfa');
fs.mkdirSync(dataDir, { recursive: true });

export const config = {
  dataDir,
  dbPath: path.join(dataDir, 'pfa.db'),

  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'http://localhost:8080',
    model: process.env.LLM_MODEL || 'Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-v2-GGUF',
  },
};
