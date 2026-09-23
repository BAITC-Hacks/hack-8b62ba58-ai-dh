import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabase } from './database.ts';
import { createApp } from './app.ts';
import { configuredOrigins } from './config.ts';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createOpenAIProvider } from './ai_service.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, '.env'))) loadEnvFile(resolve(root, '.env'));
const aiMode = process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY?.trim() ? 'openai' : 'demo');
if (!['openai', 'demo'].includes(aiMode)) throw new Error('AI_PROVIDER must be openai or demo');
if (aiMode === 'openai' && !process.env.OPENAI_API_KEY?.trim()) throw new Error('Set OPENAI_API_KEY in backend/.env');
const aiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const filename = resolve(root, process.env.DATABASE_PATH || 'data/ai-sana.sqlite');
const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const host = process.env.HOST || '127.0.0.1';
const db = openDatabase(filename, process.env.SEED_DATA !== 'false');
const server = createApp(db, {
  origins: configuredOrigins(host, port, process.env.CORS_ORIGINS),
  staticDir: resolve(root, '..', 'frontend'),
  aiProvider: aiMode === 'openai' ? createOpenAIProvider({ model: aiModel }) : undefined,
  aiName: aiMode,
  aiModel: aiMode === 'openai' ? aiModel : undefined,
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(port, host, () => console.log('AI Sana Backend: http://' + host + ':' + port + '\nHealth: /api/health\nDatabase: ' + filename + '\nAI: ' + aiMode + (aiMode === 'openai' ? ' / ' + aiModel : '') + ' | Identity: demo headers (not authentication)'));
server.on('error', err => { console.error(err.message); db.close(); process.exitCode = 1; });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return; closing = true; server.close(() => db.close()); server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); }, 3000).unref();
});
