import { z } from 'zod';
import { MemorySuggestionSchema } from './profile';

/**
 * The API contract between the extension and the server.
 * Both sides validate with these schemas, so a change here is a compile
 * error on whichever side falls out of sync.
 */

export const LIMITS = {
  pageTextChars: 30_000,
  selectionChars: 10_000,
  jobDescriptionChars: 15_000,
  messageChars: 20_000,
  historyMessages: 30,
} as const;

/** A job posting found in the page's schema.org JSON-LD (many ATS pages include one). */
export const JobPostingSchema = z.object({
  title: z.string(),
  company: z.string().optional(),
  location: z.string().optional(),
  employmentType: z.string().optional(),
  datePosted: z.string().optional(),
  description: z.string().max(LIMITS.jobDescriptionChars).optional(),
});
export type JobPosting = z.infer<typeof JobPostingSchema>;

/** What the extension captured from the current tab. Always treated as untrusted. */
export const PageContextSchema = z.object({
  url: z.string().url(),
  title: z.string().max(500),
  selection: z.string().max(LIMITS.selectionChars),
  text: z.string().max(LIMITS.pageTextChars),
  truncated: z.boolean(),
  jobPostings: z.array(JobPostingSchema).max(5),
  capturedAt: z.string().datetime(),
});
export type PageContext = z.infer<typeof PageContextSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(LIMITS.messageChars),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  messages: z
    .array(ChatMessageSchema)
    .min(1)
    .max(LIMITS.historyMessages)
    .refine((m) => m[m.length - 1]?.role === 'user', 'Last message must be from the user'),
  /** Page snapshot attached to the latest user message, if the user chose to include it. */
  pageContext: PageContextSchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string(),
  /** Things the AI thinks are worth remembering. Nothing is saved until the user accepts. */
  suggestions: z.array(MemorySuggestionSchema).max(3).default([]),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const HealthResponseSchema = z.object({ ok: z.literal(true), provider: z.string(), model: z.string() });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ErrorResponseSchema = z.object({ error: z.string(), details: z.unknown().optional() });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
