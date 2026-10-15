import type { MemoryFact, Profile } from '@hirepilot/shared';

const MAX_PROFILE_CHARS = 8_000;
const MAX_RESUME_CHARS = 8_000;

const line = (label: string, value: string) => (value ? `${label}: ${value}` : null);
const range = (start: string, end: string, current = false) =>
  [start, current ? 'present' : end].filter(Boolean).join(' – ');

/**
 * Compact, model-friendly view of the user's VERIFIED data.
 * Empty fields are skipped so we don't pay tokens for blanks.
 */
export function formatUserContext(
  profile: Profile,
  facts: MemoryFact[],
  resume?: { label: string; text: string } | null,
): string {
  const { basics: b, links: l, preferences: p } = profile;
  const out: (string | null)[] = [
    line('Name', b.fullName),
    line('Email', b.email),
    line('Phone', b.phone),
    line('Location', b.location),
    line('Headline', b.headline),
    line('Summary', b.summary),
    line('LinkedIn', l.linkedin),
    line('GitHub', l.github),
    line('Portfolio', l.portfolio),
    line('X', l.x),
    l.other.length ? `Other links: ${l.other.join(', ')}` : null,
    profile.skills.length ? `Skills: ${profile.skills.join(', ')}` : null,
  ];

  if (profile.experience.length) {
    out.push('Experience:');
    for (const e of profile.experience) {
      const when = range(e.startDate, e.endDate, e.current);
      out.push(`- ${[e.title, e.company].filter(Boolean).join(' at ')}${when ? ` (${when})` : ''}${e.location ? `, ${e.location}` : ''}`);
      for (const h of e.highlights) out.push(`  • ${h}`);
    }
  }
  if (profile.education.length) {
    out.push('Education:');
    for (const e of profile.education) {
      const what = [e.degree, e.field].filter(Boolean).join(' in ');
      const when = range(e.startDate, e.endDate);
      out.push(`- ${[what, e.institution].filter(Boolean).join(', ')}${when ? ` (${when})` : ''}${e.grade ? `, ${e.grade}` : ''}`);
    }
  }
  if (profile.projects.length) {
    out.push('Projects:');
    for (const pr of profile.projects) {
      out.push(`- ${pr.name}${pr.url ? ` (${pr.url})` : ''}${pr.tech.length ? ` [${pr.tech.join(', ')}]` : ''}`);
      if (pr.description) out.push(`  ${pr.description}`);
    }
  }

  const prefs = [
    p.roles.length ? `roles: ${p.roles.join(', ')}` : null,
    p.locations.length ? `locations: ${p.locations.join(', ')}` : null,
    p.workMode !== 'any' ? `work mode: ${p.workMode}` : null,
    p.noticePeriod ? `notice period: ${p.noticePeriod}` : null,
    p.currentCompensation ? `current compensation: ${p.currentCompensation}` : null,
    p.expectedCompensation ? `expected compensation: ${p.expectedCompensation}` : null,
    p.workAuthorization ? `work authorization: ${p.workAuthorization}` : null,
  ].filter(Boolean);
  if (prefs.length) out.push(`Job preferences: ${prefs.join('; ')}`);

  if (facts.length) {
    out.push('Saved notes:');
    for (const f of facts) out.push(`- [${f.category}] ${f.text}`);
  }

  let body = out.filter((x): x is string => x !== null).join('\n');
  if (body.length > MAX_PROFILE_CHARS) body = `${body.slice(0, MAX_PROFILE_CHARS)}\n…(truncated)`;

  // The user's own default resume: their document, so it counts as their facts.
  if (resume?.text) {
    const text = resume.text.length > MAX_RESUME_CHARS ? `${resume.text.slice(0, MAX_RESUME_CHARS)}\n…(truncated)` : resume.text;
    body += `${body ? '\n\n' : ''}Default resume ("${resume.label}"):\n${text}`;
  }
  return body || 'The user has not saved any profile information or resume yet.';
}
