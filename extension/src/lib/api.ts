import {
  ChatResponseSchema,
  ErrorResponseSchema,
  ExportSchema,
  HealthResponseSchema,
  MemoryFactSchema,
  ProfileResponseSchema,
  ProfileSchema,
  ResumeListSchema,
  ResumeMetaSchema,
  UploadResumeResponseSchema,
  type ChatRequest,
  type ChatResponse,
  type ExportData,
  type HealthResponse,
  type MemoryFact,
  type MemorySuggestion,
  type NewMemoryFact,
  type Profile,
  type ProfileResponse,
  type ResumeMeta,
} from '@hirepilot/shared';
import { z } from 'zod';
import type { Settings } from './settings';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

// Generic over the schema (not its type) so we get the OUTPUT type, with defaults applied.
async function call<S extends z.ZodTypeAny>(
  settings: Settings,
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.output<S>> {
  if (!settings.token) throw new ApiError('Add your server token in Settings first.');
  const url = `${settings.serverUrl.replace(/\/+$/, '')}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        // FormData sets its own multipart Content-Type (with boundary).
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${settings.token}`,
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(`Can't reach the HirePilot server at ${settings.serverUrl}. Is it running? (npm run dev:server)`);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponseSchema.safeParse(body);
    throw new ApiError(err.success ? err.data.error : `Server error ${res.status}`, res.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('Server sent an unexpected response.');
  return parsed.data;
}

export function checkHealth(settings: Settings): Promise<HealthResponse> {
  return call(settings, '/api/health', HealthResponseSchema);
}

export function sendChat(settings: Settings, request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  return call(settings, '/api/chat', ChatResponseSchema, {
    method: 'POST',
    body: JSON.stringify(request),
    signal,
  });
}

/* ---------- profile & memory ---------- */

export function getProfile(settings: Settings): Promise<ProfileResponse> {
  return call(settings, '/api/profile', ProfileResponseSchema);
}

export async function saveProfile(settings: Settings, profile: Profile): Promise<Profile> {
  const res = await call(settings, '/api/profile', z.object({ profile: ProfileSchema }), {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
  return res.profile;
}

const FactResponse = z.object({ fact: MemoryFactSchema });

export async function addFact(settings: Settings, fact: NewMemoryFact): Promise<MemoryFact> {
  return (await call(settings, '/api/memory', FactResponse, { method: 'POST', body: JSON.stringify(fact) })).fact;
}

export async function updateFact(settings: Settings, id: string, fact: NewMemoryFact): Promise<MemoryFact> {
  const path = `/api/memory/${encodeURIComponent(id)}`;
  return (await call(settings, path, FactResponse, { method: 'PUT', body: JSON.stringify(fact) })).fact;
}

export async function deleteFact(settings: Settings, id: string): Promise<void> {
  await call(settings, `/api/memory/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), { method: 'DELETE' });
}

/** The user clicked Save on a suggestion card. */
export async function acceptSuggestion(settings: Settings, suggestion: MemorySuggestion): Promise<void> {
  await call(settings, '/api/suggestions/accept', z.object({}).passthrough(), {
    method: 'POST',
    body: JSON.stringify(suggestion),
  });
}

export function exportData(settings: Settings): Promise<ExportData> {
  return call(settings, '/api/export', ExportSchema);
}

/* ---------- resumes ---------- */

export async function listResumes(settings: Settings): Promise<ResumeMeta[]> {
  return (await call(settings, '/api/resumes', ResumeListSchema)).resumes;
}

export function uploadResume(settings: Settings, file: File, label?: string) {
  const form = new FormData();
  form.append('file', file);
  if (label) form.append('label', label);
  return call(settings, '/api/resumes', UploadResumeResponseSchema, { method: 'POST', body: form });
}

export async function renameResume(settings: Settings, id: string, label: string): Promise<ResumeMeta> {
  const path = `/api/resumes/${encodeURIComponent(id)}`;
  return (await call(settings, path, z.object({ resume: ResumeMetaSchema }), { method: 'PUT', body: JSON.stringify({ label }) })).resume;
}

export async function setDefaultResume(settings: Settings, id: string): Promise<void> {
  await call(settings, `/api/resumes/${encodeURIComponent(id)}/default`, z.object({ ok: z.literal(true) }), { method: 'POST' });
}

export async function deleteResume(settings: Settings, id: string): Promise<void> {
  await call(settings, `/api/resumes/${encodeURIComponent(id)}`, z.object({ ok: z.literal(true) }), { method: 'DELETE' });
}

/** The original PDF bytes (needs the auth header, so we can't just link to it). */
export async function fetchResumeFile(settings: Settings, id: string): Promise<Blob> {
  const url = `${settings.serverUrl.replace(/\/+$/, '')}/api/resumes/${encodeURIComponent(id)}/file`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${settings.token}` } }).catch(() => {
    throw new ApiError(`Can't reach the HirePilot server at ${settings.serverUrl}.`);
  });
  if (!res.ok) throw new ApiError(`Couldn't load the file (${res.status}).`, res.status);
  return res.blob();
}

/** Model reads the resume and PROPOSES profile fields. Nothing is saved. */
export async function extractProfileFromResume(settings: Settings, id: string): Promise<Profile> {
  const path = `/api/resumes/${encodeURIComponent(id)}/extract-profile`;
  return (await call(settings, path, z.object({ proposed: ProfileSchema }), { method: 'POST' })).proposed;
}
