import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { LLMError, type LLMMessage, type LLMProvider } from './llm/types';
import { MemoryFileStore } from './store/files';
import { SqliteProfileStore } from './store/sqlite';

const TOKEN = 'test-token-0123456789';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  lastMessages: LLMMessage[] = [];
  constructor(private readonly reply: string | Error = 'fake reply') {}
  async complete(messages: LLMMessage[]) {
    this.lastMessages = messages;
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

const stores: SqliteProfileStore[] = [];
function setup(reply?: string | Error) {
  const provider = new FakeProvider(reply);
  const store = new SqliteProfileStore(':memory:');
  stores.push(store);
  const files = new MemoryFileStore();
  // Fake extractor: "PDF" bytes after the header are the text.
  const extractText = async (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^%PDF-1\.7\n/, '');
  const app = createApp({ provider, store, files, extractText, token: TOKEN });
  const req = (method: string, path: string, body?: unknown, token = TOKEN) =>
    app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const upload = (name: string, content: string, label?: string) => {
    const form = new FormData();
    form.append('file', new File([content], name, { type: 'application/pdf' }));
    if (label) form.append('label', label);
    return app.request('/api/resumes', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
  };
  return { provider, store, files, req, upload };
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));

const hi = { messages: [{ role: 'user', content: 'hi' }] };

describe('auth & validation', () => {
  it('rejects a wrong token', async () => {
    const { req } = setup();
    expect((await req('POST', '/api/chat', hi, 'wrong')).status).toBe(401);
    expect((await req('GET', '/api/profile', undefined, 'wrong')).status).toBe(401);
  });

  it('rejects invalid chat bodies', async () => {
    const { req } = setup();
    expect((await req('POST', '/api/chat', { messages: [] })).status).toBe(400);
    expect((await req('POST', '/api/chat', { messages: [{ role: 'assistant', content: 'x' }] })).status).toBe(400);
  });

  it('health reports the model', async () => {
    const { req } = setup();
    expect(await (await req('GET', '/api/health')).json()).toEqual({ ok: true, provider: 'fake', model: 'fake-1' });
  });
});

describe('chat', () => {
  it('returns the reply with no suggestions', async () => {
    const { req } = setup();
    const res = await req('POST', '/api/chat', hi);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'fake reply', suggestions: [] });
  });

  it('sends the saved profile to the model as verified facts', async () => {
    const { req, provider, store } = setup();
    store.addFact({ text: 'Prefers remote roles', category: 'preference' });
    await req('POST', '/api/chat', hi);
    const profileMsg = provider.lastMessages[1];
    expect(profileMsg?.role).toBe('system');
    expect(profileMsg?.content).toContain('<user_profile>');
    expect(profileMsg?.content).toContain('Prefers remote roles');
  });

  it('turns a suggestions block into structured suggestions', async () => {
    const { req } = setup('Nice to meet you!\n<memory_suggestions>[{"type":"profile","field":"fullName","value":"Ashutosh Sagar"}]</memory_suggestions>');
    const res = await req('POST', '/api/chat', { messages: [{ role: 'user', content: 'my name is Ashutosh Sagar' }] });
    expect(await res.json()).toEqual({
      reply: 'Nice to meet you!',
      suggestions: [{ type: 'profile', field: 'fullName', value: 'Ashutosh Sagar' }],
    });
  });

  it('maps provider failures to 502', async () => {
    const { req } = setup(new LLMError('provider down', 503));
    const res = await req('POST', '/api/chat', hi);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'provider down' });
  });
});

describe('profile & memory', () => {
  it('saves and returns the profile', async () => {
    const { req } = setup();
    const put = await req('PUT', '/api/profile', { basics: { fullName: 'Ashutosh Sagar' }, skills: ['Rust', 'TypeScript'] });
    expect(put.status).toBe(200);
    const { profile, facts } = await (await req('GET', '/api/profile')).json();
    expect(profile.basics.fullName).toBe('Ashutosh Sagar');
    expect(profile.skills).toEqual(['Rust', 'TypeScript']);
    expect(facts).toEqual([]);
  });

  it('rejects an invalid profile', async () => {
    const { req } = setup();
    expect((await req('PUT', '/api/profile', { preferences: { workMode: 'moon' } })).status).toBe(400);
  });

  it('creates, updates and deletes memory facts', async () => {
    const { req } = setup();
    const created = await req('POST', '/api/memory', { text: 'Notice period 30 days', category: 'career' });
    expect(created.status).toBe(201);
    const { fact } = await created.json();

    const updated = await req('PUT', `/api/memory/${fact.id}`, { text: 'Notice period 15 days', category: 'career' });
    expect((await updated.json()).fact.text).toBe('Notice period 15 days');

    expect((await req('DELETE', `/api/memory/${fact.id}`)).status).toBe(200);
    expect((await req('DELETE', `/api/memory/${fact.id}`)).status).toBe(404);
  });

  it('accepting a suggestion is what saves it', async () => {
    const { req, store } = setup();
    await req('POST', '/api/suggestions/accept', { type: 'profile', field: 'github', value: 'https://github.com/thecurioussailor' });
    await req('POST', '/api/suggestions/accept', { type: 'fact', text: 'Prefers remote roles', category: 'preference' });
    expect(store.getProfile().links.github).toBe('https://github.com/thecurioussailor');
    expect(store.listFacts().map((f) => f.text)).toEqual(['Prefers remote roles']);
  });

  it('exports everything', async () => {
    const { req, store } = setup();
    store.addFact({ text: 'x', category: 'other' });
    const data = await (await req('GET', '/api/export')).json();
    expect(data.facts).toHaveLength(1);
    expect(data.profile.basics).toBeDefined();
    expect(typeof data.exportedAt).toBe('string');
  });
});

const RESUME_TEXT = 'Ashutosh Sagar\nSoftware Engineer\n' + 'Built Solana programs and TypeScript backends. '.repeat(10);

describe('resumes', () => {
  it('uploads a PDF, extracts text, and makes the first one default', async () => {
    const { upload, req, files } = setup();
    const res = await upload('Ashu Resume.pdf', `%PDF-1.7\n${RESUME_TEXT}`);
    expect(res.status).toBe(201);
    const { resume, warning } = await res.json();
    expect(resume).toMatchObject({ label: 'Ashu Resume', fileName: 'Ashu Resume.pdf', isDefault: true });
    expect(resume.textChars).toBeGreaterThan(200);
    expect(warning).toBeUndefined();
    expect(files.files.size).toBe(1);

    const list = await (await req('GET', '/api/resumes')).json();
    expect(list.resumes).toHaveLength(1);
  });

  it('rejects non-PDF files and warns on scanned PDFs', async () => {
    const { upload } = setup();
    expect((await upload('resume.docx', 'PK\u0003\u0004 not a pdf')).status).toBe(415);
    const scanned = await (await upload('scan.pdf', '%PDF-1.7\n')).json();
    expect(scanned.warning).toMatch(/scanned/);
  });

  it('serves the original file back', async () => {
    const { upload, req } = setup();
    const { resume } = await (await upload('a.pdf', `%PDF-1.7\n${RESUME_TEXT}`)).json();
    const file = await req('GET', `/api/resumes/${resume.id}/file`);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(await file.text()).toContain('Ashutosh Sagar');
  });

  it('switches default, renames, and deletes (removing the file)', async () => {
    const { upload, req, files } = setup();
    const a = (await (await upload('a.pdf', `%PDF-1.7\n${RESUME_TEXT}`)).json()).resume;
    const b = (await (await upload('b.pdf', `%PDF-1.7\n${RESUME_TEXT}`, 'Web3')).json()).resume;
    expect(b.label).toBe('Web3');
    await req('POST', `/api/resumes/${b.id}/default`);
    const list = (await (await req('GET', '/api/resumes')).json()).resumes as { id: string; isDefault: boolean }[];
    expect(list.find((r) => r.isDefault)?.id).toBe(b.id);

    expect((await (await req('PUT', `/api/resumes/${a.id}`, { label: 'Backend' })).json()).resume.label).toBe('Backend');
    expect((await req('DELETE', `/api/resumes/${a.id}`)).status).toBe(200);
    expect(files.files.size).toBe(1);
  });

  it('includes the default resume in the chat context', async () => {
    const { upload, req, provider } = setup();
    await upload('a.pdf', `%PDF-1.7\n${RESUME_TEXT}`);
    await req('POST', '/api/chat', hi);
    expect(provider.lastMessages[1]?.content).toContain('Default resume ("a")');
    expect(provider.lastMessages[1]?.content).toContain('Built Solana programs');
  });

  it('extract-profile returns a proposal and saves nothing', async () => {
    const json = JSON.stringify({ basics: { fullName: 'Ashutosh Sagar' }, skills: ['Rust', 'Solana'], experience: [{ company: 'Unboxed', title: 'SWE' }] });
    const { upload, req, store } = setup(json);
    const { resume } = await (await upload('a.pdf', `%PDF-1.7\n${RESUME_TEXT}`)).json();
    const res = await req('POST', `/api/resumes/${resume.id}/extract-profile`);
    const { proposed } = await res.json();
    expect(proposed.basics.fullName).toBe('Ashutosh Sagar');
    expect(proposed.experience[0].id).toBeTruthy();
    expect(store.getProfile().basics.fullName).toBe(''); // proposal only
  });

  it('extract-profile reports bad model output as 502', async () => {
    const { upload, req } = setup('sorry, I cannot do that');
    const { resume } = await (await upload('a.pdf', `%PDF-1.7\n${RESUME_TEXT}`)).json();
    expect((await req('POST', `/api/resumes/${resume.id}/extract-profile`)).status).toBe(502);
  });
});
