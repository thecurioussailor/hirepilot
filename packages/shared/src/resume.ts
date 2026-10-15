import { z } from 'zod';
import type { Education, Experience, Profile, Project } from './profile';

export const RESUME_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  /** Text stored per resume (enough for any real resume). */
  maxTextChars: 50_000,
} as const;

export const ResumeMetaSchema = z.object({
  id: z.string(),
  label: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** How much text we could extract. ~0 means a scanned/image PDF. */
  textChars: z.number().int().nonnegative(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type ResumeMeta = z.infer<typeof ResumeMetaSchema>;

export const ResumeListSchema = z.object({ resumes: z.array(ResumeMetaSchema) });
export const UploadResumeResponseSchema = z.object({ resume: ResumeMetaSchema, warning: z.string().optional() });
export const UpdateResumeSchema = z.object({ label: z.string().trim().min(1).max(100) });

/* ---------- importing a resume into the profile ---------- */

export const IMPORT_SECTIONS = ['basics', 'links', 'skills', 'experience', 'education', 'projects'] as const;
export type ImportSection = (typeof IMPORT_SECTIONS)[number];

export interface ImportPlan {
  section: ImportSection;
  /** Human-readable lines describing what would be added. */
  changes: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const expKey = (e: Experience) => `${norm(e.company)}|${norm(e.title)}`;
const eduKey = (e: Education) => `${norm(e.institution)}|${norm(e.degree)}`;
const projKey = (p: Project) => norm(p.name);

const BASIC_LABELS: Record<keyof Profile['basics'], string> = {
  fullName: 'Name',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  headline: 'Headline',
  summary: 'Summary',
};
const LINK_LABELS = { linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Portfolio', x: 'X' } as const;

/**
 * Import rules — they protect what you typed yourself:
 * - Single fields (name, email, links…) are only filled when currently EMPTY.
 * - Lists (skills, experience, education, projects) only get NEW items appended.
 * Nothing you already have is ever overwritten or removed.
 */
function computeImport(current: Profile, proposed: Profile) {
  const basics: Partial<Profile['basics']> = {};
  for (const k of Object.keys(BASIC_LABELS) as (keyof Profile['basics'])[]) {
    if (!current.basics[k] && proposed.basics[k]) basics[k] = proposed.basics[k];
  }
  const links: Partial<Omit<Profile['links'], 'other'>> = {};
  for (const k of Object.keys(LINK_LABELS) as (keyof typeof LINK_LABELS)[]) {
    if (!current.links[k] && proposed.links[k]) links[k] = proposed.links[k];
  }
  const haveOther = new Set(current.links.other.map(norm));
  const otherLinks = proposed.links.other.filter((l) => !haveOther.has(norm(l)));

  const haveSkills = new Set(current.skills.map(norm));
  const skills = [...new Map(proposed.skills.filter((s) => !haveSkills.has(norm(s))).map((s) => [norm(s), s])).values()];

  const haveExp = new Set(current.experience.map(expKey));
  const experience = proposed.experience.filter((e) => (e.company || e.title) && !haveExp.has(expKey(e)));
  const haveEdu = new Set(current.education.map(eduKey));
  const education = proposed.education.filter((e) => (e.institution || e.degree) && !haveEdu.has(eduKey(e)));
  const haveProj = new Set(current.projects.map(projKey));
  const projects = proposed.projects.filter((p) => p.name && !haveProj.has(projKey(p)));

  return { basics, links, otherLinks, skills, experience, education, projects };
}

/** What importing would change, per section. Sections with nothing new are omitted. */
export function planImport(current: Profile, proposed: Profile): ImportPlan[] {
  const d = computeImport(current, proposed);
  const plans: ImportPlan[] = [
    {
      section: 'basics',
      changes: Object.entries(d.basics).map(([k, v]) => {
        const text = String(v);
        return `${BASIC_LABELS[k as keyof Profile['basics']]}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
      }),
    },
    {
      section: 'links',
      changes: [
        ...Object.entries(d.links).map(([k, v]) => `${LINK_LABELS[k as keyof typeof LINK_LABELS]}: ${v}`),
        ...d.otherLinks.map((l) => `Link: ${l}`),
      ],
    },
    { section: 'skills', changes: d.skills.length ? [d.skills.join(', ')] : [] },
    { section: 'experience', changes: d.experience.map((e) => [e.title, e.company].filter(Boolean).join(' at ')) },
    { section: 'education', changes: d.education.map((e) => [e.degree, e.institution].filter(Boolean).join(', ')) },
    { section: 'projects', changes: d.projects.map((p) => p.name) },
  ];
  return plans.filter((p) => p.changes.length > 0);
}

/** Pure: apply the chosen sections of an import. */
export function applyImport(current: Profile, proposed: Profile, sections: Iterable<ImportSection>): Profile {
  const pick = new Set(sections);
  const d = computeImport(current, proposed);
  return {
    ...current,
    basics: pick.has('basics') ? { ...current.basics, ...d.basics } : current.basics,
    links: pick.has('links')
      ? { ...current.links, ...d.links, other: [...current.links.other, ...d.otherLinks] }
      : current.links,
    skills: pick.has('skills') ? [...current.skills, ...d.skills] : current.skills,
    experience: pick.has('experience') ? [...current.experience, ...d.experience] : current.experience,
    education: pick.has('education') ? [...current.education, ...d.education] : current.education,
    projects: pick.has('projects') ? [...current.projects, ...d.projects] : current.projects,
  };
}
