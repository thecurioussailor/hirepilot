import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, ProfileSchema } from './profile';
import { applyImport, planImport } from './resume';

const current = ProfileSchema.parse({
  basics: { fullName: 'Ashutosh Sagar' },
  skills: ['Rust', 'TypeScript'],
  experience: [{ id: 'a', company: 'Unboxed Softwares', title: 'Software Engineer' }],
});
const proposed = ProfileSchema.parse({
  basics: { fullName: 'A. Sagar', email: 'a@example.com' },
  links: { github: 'https://github.com/thecurioussailor' },
  skills: ['rust', 'Solana', 'Next.js', 'Solana'],
  experience: [
    { id: 'x', company: 'unboxed softwares', title: 'software engineer' },
    { id: 'y', company: 'Acme', title: 'Backend Dev' },
  ],
  projects: [{ id: 'p', name: 'Assetra' }],
});

describe('planImport', () => {
  it('only lists genuinely new information', () => {
    const plan = Object.fromEntries(planImport(current, proposed).map((p) => [p.section, p.changes]));
    expect(plan.basics).toEqual(['Email: a@example.com']); // name already set → not overwritten
    expect(plan.links).toEqual(['GitHub: https://github.com/thecurioussailor']);
    expect(plan.skills).toEqual(['Solana, Next.js']);
    expect(plan.experience).toEqual(['Backend Dev at Acme']);
    expect(plan.projects).toEqual(['Assetra']);
    expect(plan.education).toBeUndefined();
  });

  it('is empty when importing into an identical profile', () => {
    expect(planImport(proposed, proposed)).toEqual([]);
  });
});

describe('applyImport', () => {
  it('applies only chosen sections and never overwrites', () => {
    const next = applyImport(current, proposed, ['basics', 'skills']);
    expect(next.basics.fullName).toBe('Ashutosh Sagar');
    expect(next.basics.email).toBe('a@example.com');
    expect(next.skills).toEqual(['Rust', 'TypeScript', 'Solana', 'Next.js']);
    expect(next.experience).toHaveLength(1); // not chosen
    expect(next.links.github).toBe('');
  });

  it('fills an empty profile completely', () => {
    const next = applyImport(EMPTY_PROFILE, proposed, ['basics', 'links', 'skills', 'experience', 'education', 'projects']);
    expect(next.basics.fullName).toBe('A. Sagar');
    expect(next.experience).toHaveLength(2);
    expect(next.skills).toEqual(['rust', 'Solana', 'Next.js']);
  });
});
