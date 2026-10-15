import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadEnv } from './env';
import { resolve } from 'node:path';
import { OpenAICompatibleProvider } from './llm/openaiCompatible';
import { extractPdfText } from './resume/pdf';
import { LocalFileStore } from './store/files';
import { SqliteProfileStore } from './store/sqlite';

const env = loadEnv();
const provider = new OpenAICompatibleProvider({
  baseUrl: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
  model: env.LLM_MODEL,
});
const dbPath = resolve(env.DATA_DIR, 'hirepilot.db');
const store = new SqliteProfileStore(dbPath);
const files = new LocalFileStore(resolve(env.DATA_DIR, 'resumes'));
const app = createApp({ provider, store, files, extractText: extractPdfText, token: env.HIREPILOT_TOKEN });

// 127.0.0.1 only: nothing else on your network can reach this.
serve({ fetch: app.fetch, port: env.PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`HirePilot server on http://127.0.0.1:${info.port}  (model: ${env.LLM_MODEL})`);
  console.log(`Data: ${dbPath}`);
});

// Close the database cleanly on Ctrl+C / tsx restarts.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.close();
    process.exit(0);
  });
}
