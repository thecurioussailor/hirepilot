import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_PROFILE, setProfileField } from '@hirepilot/shared';
import { SqliteProfileStore } from './sqlite';

const stores: SqliteProfileStore[] = [];
const open = (path = ':memory:') => {
  const s = new SqliteProfileStore(path);
  stores.push(s);
  return s;
};
afterEach(() => stores.splice(0).forEach((s) => s.close()));

describe('SqliteProfileStore', () => {
  it('returns an empty profile before anything is saved', () => {
    expect(open().getProfile()).toEqual(EMPTY_PROFILE);
  });

  it('saves and reloads the profile', () => {
    const store = open();
    store.saveProfile(setProfileField(EMPTY_PROFILE, 'fullName', 'Ashutosh Sagar'));
    expect(store.getProfile().basics.fullName).toBe('Ashutosh Sagar');
  });

  it('adds, updates, lists and deletes facts', () => {
    const store = open();
    const a = store.addFact({ text: 'Prefers remote roles', category: 'preference' });
    store.addFact({ text: 'Notice period is 30 days', category: 'career' });
    expect(store.listFacts().map((f) => f.text)).toEqual(['Prefers remote roles', 'Notice period is 30 days']);

    const updated = store.updateFact(a.id, { text: 'Prefers remote or hybrid', category: 'preference' });
    expect(updated?.text).toBe('Prefers remote or hybrid');
    expect(store.updateFact('missing', { text: 'x', category: 'other' })).toBeNull();

    expect(store.deleteFact(a.id)).toBe(true);
    expect(store.deleteFact(a.id)).toBe(false);
    expect(store.listFacts()).toHaveLength(1);
  });

  it('persists to disk across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hirepilot-'));
    try {
      const path = join(dir, 'nested', 'test.db');
      const first = new SqliteProfileStore(path);
      first.addFact({ text: 'Remember me', category: 'other' });
      first.close();
      const second = open(path);
      expect(second.listFacts().map((f) => f.text)).toEqual(['Remember me']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('manages resumes: first is default, switching default, delete promotes another', async () => {
    const store = open();
    const base = { mimeType: 'application/pdf', sizeBytes: 10, text: 'resume text' };
    const a = store.addResume({ ...base, label: 'Backend', fileName: 'a.pdf', fileKey: 'a.pdf' });
    await new Promise((r) => setTimeout(r, 5)); // distinct created_at
    const b = store.addResume({ ...base, label: 'Web3', fileName: 'b.pdf', fileKey: 'b.pdf' });
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);
    expect(store.getDefaultResume()?.id).toBe(a.id);

    expect(store.setDefaultResume(b.id)).toBe(true);
    expect(store.getDefaultResume()?.id).toBe(b.id);
    expect(store.listResumes().filter((r) => r.isDefault)).toHaveLength(1);

    expect(store.renameResume(a.id, 'Backend v2')?.label).toBe('Backend v2');
    expect(store.deleteResume(b.id)?.fileKey).toBe('b.pdf');
    expect(store.getDefaultResume()?.id).toBe(a.id);
    expect(store.listResumes()[0]).not.toHaveProperty('text');
  });
});
