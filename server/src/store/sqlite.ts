import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  EMPTY_PROFILE,
  MemoryFactSchema,
  ProfileSchema,
  type MemoryFact,
  type NewMemoryFact,
  type Profile,
  type ResumeMeta,
} from '@hirepilot/shared';
import type { NewResume, ResumeRecord, Store } from './types';

/*
 * Node's built-in SQLite (no native npm package to compile).
 * Schema changes are numbered migrations tracked with PRAGMA user_version.
 */
const MIGRATIONS: string[] = [
  // 1: profile (single row, JSON validated by zod) + memory facts
  `CREATE TABLE profile (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE memory_facts (
     id TEXT PRIMARY KEY,
     text TEXT NOT NULL,
     category TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // 2: resumes (file bytes live in the FileStore under file_key)
  `CREATE TABLE resumes (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     text TEXT NOT NULL,
     file_key TEXT NOT NULL,
     is_default INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );`,
];

interface FactRow {
  id: string;
  text: string;
  category: string;
  created_at: string;
  updated_at: string;
}

interface ResumeRow {
  id: string;
  label: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  text: string;
  file_key: string;
  is_default: number;
  created_at: string;
}

function toResume(row: ResumeRow): ResumeRecord {
  return {
    id: row.id,
    label: row.label,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    textChars: row.text.length,
    isDefault: Number(row.is_default) === 1,
    createdAt: row.created_at,
    text: row.text,
    fileKey: row.file_key,
  };
}

function toMeta({ text: _text, fileKey: _fileKey, ...meta }: ResumeRecord): ResumeMeta {
  return meta;
}

function toFact(row: FactRow): MemoryFact {
  return MemoryFactSchema.parse({
    id: row.id,
    text: row.text,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SqliteProfileStore implements Store {
  private readonly db: DatabaseSync;

  /** `path` is a file path, or ':memory:' for tests. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  getProfile(): Profile {
    const row = this.db.prepare('SELECT data FROM profile WHERE id = 1').get() as { data: string } | undefined;
    if (!row) return EMPTY_PROFILE;
    // Re-validate on read: old rows pick up defaults for fields added later.
    const parsed = ProfileSchema.safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data : EMPTY_PROFILE;
  }

  saveProfile(profile: Profile): Profile {
    const valid = ProfileSchema.parse(profile);
    this.db
      .prepare(
        `INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(valid), new Date().toISOString());
    return valid;
  }

  listFacts(): MemoryFact[] {
    const rows = this.db.prepare('SELECT * FROM memory_facts ORDER BY created_at ASC').all() as unknown as FactRow[];
    return rows.map(toFact);
  }

  addFact({ text, category }: NewMemoryFact): MemoryFact {
    const now = new Date().toISOString();
    const fact = MemoryFactSchema.parse({ id: randomUUID(), text, category, createdAt: now, updatedAt: now });
    this.db
      .prepare('INSERT INTO memory_facts (id, text, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(fact.id, fact.text, fact.category, fact.createdAt, fact.updatedAt);
    return fact;
  }

  updateFact(id: string, { text, category }: NewMemoryFact): MemoryFact | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE memory_facts SET text = ?, category = ?, updated_at = ? WHERE id = ?')
      .run(text.trim(), category, now, id);
    if (result.changes === 0) return null;
    const row = this.db.prepare('SELECT * FROM memory_facts WHERE id = ?').get(id) as unknown as FactRow;
    return toFact(row);
  }

  deleteFact(id: string): boolean {
    return this.db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id).changes > 0;
  }

  /* ---------- resumes ---------- */

  listResumes(): ResumeMeta[] {
    const rows = this.db.prepare('SELECT * FROM resumes ORDER BY created_at DESC').all() as unknown as ResumeRow[];
    return rows.map((r) => toMeta(toResume(r)));
  }

  getResume(id: string): ResumeRecord | null {
    const row = this.db.prepare('SELECT * FROM resumes WHERE id = ?').get(id) as unknown as ResumeRow | undefined;
    return row ? toResume(row) : null;
  }

  getDefaultResume(): ResumeRecord | null {
    const row = this.db.prepare('SELECT * FROM resumes WHERE is_default = 1 LIMIT 1').get() as unknown as ResumeRow | undefined;
    return row ? toResume(row) : null;
  }

  addResume(r: NewResume): ResumeMeta {
    const id = randomUUID();
    const hasAny = (this.db.prepare('SELECT COUNT(*) AS n FROM resumes').get() as { n: number }).n > 0;
    this.db
      .prepare(
        `INSERT INTO resumes (id, label, file_name, mime_type, size_bytes, text, file_key, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, r.label, r.fileName, r.mimeType, r.sizeBytes, r.text, r.fileKey, hasAny ? 0 : 1, new Date().toISOString());
    return toMeta(this.getResume(id)!);
  }

  renameResume(id: string, label: string): ResumeMeta | null {
    const changed = this.db.prepare('UPDATE resumes SET label = ? WHERE id = ?').run(label, id).changes;
    return changed ? toMeta(this.getResume(id)!) : null;
  }

  setDefaultResume(id: string): boolean {
    if (!this.getResume(id)) return false;
    this.transaction(() => {
      this.db.prepare('UPDATE resumes SET is_default = 0').run();
      this.db.prepare('UPDATE resumes SET is_default = 1 WHERE id = ?').run(id);
    });
    return true;
  }

  deleteResume(id: string): ResumeRecord | null {
    const existing = this.getResume(id);
    if (!existing) return null;
    this.transaction(() => {
      this.db.prepare('DELETE FROM resumes WHERE id = ?').run(id);
      if (existing.isDefault) {
        this.db
          .prepare('UPDATE resumes SET is_default = 1 WHERE id = (SELECT id FROM resumes ORDER BY created_at DESC LIMIT 1)')
          .run();
      }
    });
    return existing;
  }

  private transaction(fn: () => void) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}
