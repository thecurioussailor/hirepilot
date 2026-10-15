import { z } from 'zod';
import { ResumeMetaSchema } from './resume';

/*
 * Everything in the Profile and in MemoryFacts is VERIFIED: the user typed it
 * or explicitly confirmed it. AI output only ever becomes a MemorySuggestion,
 * which the user must accept before it lands here.
 */

const text = (max = 300) => z.string().trim().max(max).default('');
const list = (maxItems: number, maxLen = 200) => z.array(z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);

export const ExperienceSchema = z.object({
  id: z.string().min(1),
  company: text(),
  title: text(),
  location: text(),
  startDate: text(40),
  endDate: text(40),
  current: z.boolean().default(false),
  highlights: list(20, 1000),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const EducationSchema = z.object({
  id: z.string().min(1),
  institution: text(),
  degree: text(),
  field: text(),
  startDate: text(40),
  endDate: text(40),
  grade: text(60),
});
export type Education = z.infer<typeof EducationSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: text(),
  url: text(500),
  description: text(2000),
  tech: list(30, 100),
});
export type Project = z.infer<typeof ProjectSchema>;

export const WORK_MODES = ['any', 'remote', 'hybrid', 'onsite'] as const;

export const ProfileSchema = z.object({
  basics: z
    .object({
      fullName: text(),
      email: text(),
      phone: text(40),
      location: text(),
      headline: text(),
      summary: text(2000),
    })
    .default({}),
  links: z
    .object({
      linkedin: text(500),
      github: text(500),
      portfolio: text(500),
      x: text(500),
      other: list(10, 500),
    })
    .default({}),
  experience: z.array(ExperienceSchema).max(30).default([]),
  education: z.array(EducationSchema).max(10).default([]),
  projects: z.array(ProjectSchema).max(30).default([]),
  skills: list(100, 100),
  preferences: z
    .object({
      roles: list(20),
      locations: list(20),
      workMode: z.enum(WORK_MODES).default('any'),
      noticePeriod: text(100),
      currentCompensation: text(100),
      expectedCompensation: text(100),
      workAuthorization: text(300),
    })
    .default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const EMPTY_PROFILE: Profile = ProfileSchema.parse({});

export const MEMORY_CATEGORIES = ['personal', 'career', 'preference', 'application_answer', 'other'] as const;
export const MemoryCategorySchema = z.enum(MEMORY_CATEGORIES);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

/** A free-form note the user confirmed, for things that don't fit a profile field. */
export const MemoryFactSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1).max(1000),
  category: MemoryCategorySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;

export const NewMemoryFactSchema = MemoryFactSchema.pick({ text: true, category: true });
export type NewMemoryFact = z.infer<typeof NewMemoryFactSchema>;

/* ---------- Suggestions: what the AI proposes, pending the user's OK ---------- */

export const PROFILE_FIELD_KEYS = [
  'fullName',
  'email',
  'phone',
  'location',
  'headline',
  'linkedin',
  'github',
  'portfolio',
  'x',
] as const;
export const ProfileFieldKeySchema = z.enum(PROFILE_FIELD_KEYS);
export type ProfileFieldKey = z.infer<typeof ProfileFieldKeySchema>;

export const PROFILE_FIELD_LABELS: Record<ProfileFieldKey, string> = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  headline: 'Headline',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  portfolio: 'Portfolio',
  x: 'X (Twitter)',
};

export const MemorySuggestionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profile'), field: ProfileFieldKeySchema, value: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('fact'), text: z.string().trim().min(1).max(500), category: MemoryCategorySchema.default('other') }),
]);
export type MemorySuggestion = z.infer<typeof MemorySuggestionSchema>;

const BASICS_FIELDS = new Set<ProfileFieldKey>(['fullName', 'email', 'phone', 'location', 'headline']);

export function getProfileField(profile: Profile, field: ProfileFieldKey): string {
  return BASICS_FIELDS.has(field)
    ? profile.basics[field as keyof Profile['basics']]
    : String(profile.links[field as Exclude<keyof Profile['links'], 'other'>]);
}

/** Pure: returns a new profile with one field set. */
export function setProfileField(profile: Profile, field: ProfileFieldKey, value: string): Profile {
  if (BASICS_FIELDS.has(field)) return { ...profile, basics: { ...profile.basics, [field]: value } };
  return { ...profile, links: { ...profile.links, [field]: value } };
}

/* ---------- API shapes ---------- */

export const ProfileResponseSchema = z.object({ profile: ProfileSchema, facts: z.array(MemoryFactSchema) });
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const ExportSchema = z.object({
  exportedAt: z.string(),
  profile: ProfileSchema,
  facts: z.array(MemoryFactSchema),
  /** Metadata only; the PDFs themselves are in server/data/resumes/. */
  resumes: z.array(ResumeMetaSchema),
});
export type ExportData = z.infer<typeof ExportSchema>;
