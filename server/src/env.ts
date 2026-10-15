import { z } from 'zod';

const EnvSchema = z.object({
  HIREPILOT_TOKEN: z.string().min(16, 'HIREPILOT_TOKEN must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Where the SQLite database and resume files live (relative to server/). */
  DATA_DIR: z.string().min(1).default('data'),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required (use any non-empty value for Ollama)'),
});
export type Env = z.infer<typeof EnvSchema>;

/** Fail fast at startup with a readable message instead of a 500 on first request. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server/.env:\n${lines.join('\n')}\nSee server/.env.example.`);
  }
  return parsed.data;
}
