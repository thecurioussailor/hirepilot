import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { z } from 'zod';
import {
  ChatRequestSchema,
  MemorySuggestionSchema,
  NewMemoryFactSchema,
  ProfileSchema,
  RESUME_LIMITS,
  setProfileField,
  UpdateResumeSchema,
  type ChatResponse,
  type ExportData,
  type HealthResponse,
  type ProfileResponse,
} from '@hirepilot/shared';
import { buildMessages } from './agent/prompt';
import { extractSuggestions } from './agent/suggestions';
import { formatUserContext } from './agent/userContext';
import { LLMError, type LLMProvider } from './llm/types';
import { extractProfileFromResume } from './resume/extractProfile';
import { looksLikePdf, type TextExtractor } from './resume/pdf';
import type { FileStore } from './store/files';
import type { Store } from './store/types';

export interface AppDeps {
  provider: LLMProvider;
  store: Store;
  files: FileStore;
  /** PDF → text. Injected so tests don't need real PDFs. */
  extractText: TextExtractor;
  token: string;
}

function llmErrorResponse(c: Context, err: unknown, where: string) {
  if (err instanceof LLMError) {
    console.error(`[${where}] LLM error:`, err.message);
    return c.json({ error: err.message }, 502);
  }
  throw err;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Parse + validate a JSON body; returns the data or a ready-made 400 response. */
async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<{ data: z.infer<T> } | { error: Response }> {
  const json: unknown = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { error: c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400) };
  return { data: parsed.data };
}

/** Routes only — no network listener — so tests can call app.request() directly. */
export function createApp({ provider, store, files, extractText, token }: AppDeps) {
  const app = new Hono();

  // Only Chrome extensions may call us from a browser. (Requests from normal
  // websites are blocked by CORS; the token blocks everything else.)
  app.use(
    '/api/*',
    cors({
      origin: (origin) => (origin.startsWith('chrome-extension://') ? origin : undefined),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use('/api/*', async (c, next) => {
    if (!tokenMatches(c.req.header('Authorization'), token)) {
      return c.json({ error: 'Unauthorized: token missing or wrong. Check extension Settings.' }, 401);
    }
    await next();
  });

  app.get('/api/health', (c) =>
    c.json<HealthResponse>({ ok: true, provider: provider.name, model: provider.model }),
  );

  /* ---------- chat ---------- */

  app.post('/api/chat', async (c) => {
    const req = await body(c, ChatRequestSchema);
    if ('error' in req) return req.error;
    const { messages, pageContext } = req.data;

    const profile = store.getProfile();
    const facts = store.listFacts();
    const resume = store.getDefaultResume();
    try {
      const context = formatUserContext(profile, facts, resume);
      const raw = await provider.complete(buildMessages(messages, pageContext, context), { signal: c.req.raw.signal });
      return c.json<ChatResponse>(extractSuggestions(raw, profile, facts));
    } catch (err) {
      return llmErrorResponse(c, err, 'chat');
    }
  });

  /* ---------- profile & memory ---------- */

  app.get('/api/profile', (c) => c.json<ProfileResponse>({ profile: store.getProfile(), facts: store.listFacts() }));

  app.put('/api/profile', async (c) => {
    const req = await body(c, ProfileSchema);
    if ('error' in req) return req.error;
    return c.json({ profile: store.saveProfile(req.data) });
  });

  app.post('/api/memory', async (c) => {
    const req = await body(c, NewMemoryFactSchema);
    if ('error' in req) return req.error;
    return c.json({ fact: store.addFact(req.data) }, 201);
  });

  app.put('/api/memory/:id', async (c) => {
    const req = await body(c, NewMemoryFactSchema);
    if ('error' in req) return req.error;
    const fact = store.updateFact(c.req.param('id'), req.data);
    return fact ? c.json({ fact }) : c.json({ error: 'Not found' }, 404);
  });

  app.delete('/api/memory/:id', (c) =>
    store.deleteFact(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
  );

  /** The user clicked "Save" on a suggestion card. This is the ONLY way AI output becomes memory. */
  app.post('/api/suggestions/accept', async (c) => {
    const req = await body(c, MemorySuggestionSchema);
    if ('error' in req) return req.error;
    const s = req.data;
    if (s.type === 'profile') {
      const profile = store.saveProfile(setProfileField(store.getProfile(), s.field, s.value));
      return c.json({ profile });
    }
    return c.json({ fact: store.addFact({ text: s.text, category: s.category }) }, 201);
  });

  /* ---------- resumes ---------- */

  app.get('/api/resumes', (c) => c.json({ resumes: store.listResumes() }));

  app.post(
    '/api/resumes',
    bodyLimit({
      maxSize: RESUME_LIMITS.maxBytes + 64 * 1024, // file + multipart overhead
      onError: (c) => c.json({ error: `File too large (max ${RESUME_LIMITS.maxBytes / 1024 / 1024} MB).` }, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => null);
      const file = form?.file;
      if (!(file instanceof File)) return c.json({ error: 'Send the PDF as multipart field "file".' }, 400);
      if (file.size > RESUME_LIMITS.maxBytes) return c.json({ error: 'File too large (max 5 MB).' }, 413);

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksLikePdf(bytes)) return c.json({ error: 'Only PDF resumes are supported for now.' }, 415);

      let text: string;
      try {
        text = await extractText(bytes);
      } catch (err) {
        console.error('[resumes] PDF parse failed:', err);
        return c.json({ error: "Couldn't read this PDF. Is it password-protected or damaged?" }, 422);
      }

      const fileName = file.name.replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'resume.pdf';
      const rawLabel = typeof form?.label === 'string' ? form.label : '';
      const label = rawLabel.trim().slice(0, 100) || fileName.replace(/\.pdf$/i, '');
      const fileKey = `${randomUUID()}.pdf`;

      await files.put(fileKey, bytes);
      const resume = store.addResume({ label, fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, text, fileKey });
      const warning =
        text.length < 200
          ? 'Almost no text could be read from this PDF (it may be a scanned image). HirePilot can still attach it to applications, but cannot read it.'
          : undefined;
      return c.json({ resume, warning }, 201);
    },
  );

  app.put('/api/resumes/:id', async (c) => {
    const req = await body(c, UpdateResumeSchema);
    if ('error' in req) return req.error;
    const resume = store.renameResume(c.req.param('id'), req.data.label);
    return resume ? c.json({ resume }) : c.json({ error: 'Not found' }, 404);
  });

  app.post('/api/resumes/:id/default', (c) =>
    store.setDefaultResume(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404),
  );

  app.delete('/api/resumes/:id', async (c) => {
    const deleted = store.deleteResume(c.req.param('id'));
    if (!deleted) return c.json({ error: 'Not found' }, 404);
    await files.delete(deleted.fileKey);
    return c.json({ ok: true });
  });

  /** The original PDF — for previewing now, and attaching to application forms later. */
  app.get('/api/resumes/:id/file', async (c) => {
    const resume = store.getResume(c.req.param('id'));
    const bytes = resume && (await files.get(resume.fileKey));
    if (!resume || !bytes) return c.json({ error: 'Not found' }, 404);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': resume.mimeType,
      'Content-Disposition': `inline; filename="${resume.fileName.replace(/"/g, '')}"`,
    });
  });

  /** Ask the model to read the resume into profile fields. Returns a PROPOSAL; nothing is saved. */
  app.post('/api/resumes/:id/extract-profile', async (c) => {
    const resume = store.getResume(c.req.param('id'));
    if (!resume) return c.json({ error: 'Not found' }, 404);
    if (resume.text.length < 200) return c.json({ error: 'This resume has no readable text to import.' }, 422);
    try {
      return c.json({ proposed: await extractProfileFromResume(provider, resume.text) });
    } catch (err) {
      return llmErrorResponse(c, err, 'extract-profile');
    }
  });

  app.get('/api/export', (c) =>
    c.json<ExportData>({
      exportedAt: new Date().toISOString(),
      profile: store.getProfile(),
      facts: store.listFacts(),
      resumes: store.listResumes(),
    }),
  );

  app.onError((err, c) => {
    console.error('[server] unexpected error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
