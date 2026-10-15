import type { MemoryFact, NewMemoryFact, Profile, ResumeMeta } from '@hirepilot/shared';

/**
 * Everything the app needs from storage. Today: SQLite on your Mac.
 * For SaaS: implement this against Postgres (plus a userId) — routes don't change.
 */
export interface ProfileStore {
  getProfile(): Profile;
  saveProfile(profile: Profile): Profile;

  listFacts(): MemoryFact[];
  addFact(fact: NewMemoryFact): MemoryFact;
  updateFact(id: string, fact: NewMemoryFact): MemoryFact | null;
  deleteFact(id: string): boolean;

  close(): void;
}

export interface ResumeRecord extends ResumeMeta {
  text: string;
  fileKey: string;
}

export interface NewResume {
  label: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  text: string;
  fileKey: string;
}

/** Resume metadata + extracted text. The file bytes live in a FileStore. */
export interface ResumeStore {
  listResumes(): ResumeMeta[];
  getResume(id: string): ResumeRecord | null;
  getDefaultResume(): ResumeRecord | null;
  /** The first resume you upload becomes the default. */
  addResume(resume: NewResume): ResumeMeta;
  renameResume(id: string, label: string): ResumeMeta | null;
  setDefaultResume(id: string): boolean;
  /** Returns the deleted record (so its file can be removed). If it was the default, the newest remaining one takes over. */
  deleteResume(id: string): ResumeRecord | null;
}

export type Store = ProfileStore & ResumeStore;
