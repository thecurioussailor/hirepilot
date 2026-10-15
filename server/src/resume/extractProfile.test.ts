import { describe, expect, it } from 'vitest';
import { coerceExtractedProfile, parseJsonObject } from './extractProfile';
import { cleanResumeText, looksLikePdf } from './pdf';

describe('coerceExtractedProfile', () => {
  it('keeps known fields, fixes types, adds ids, drops junk', () => {
    const p = coerceExtractedProfile({
      basics: { fullName: ' Ashutosh Sagar ', phone: 9876543210, evil: 'x' },
      skills: ['Rust', '', 42, null],
      experience: [{ company: 'Unboxed', title: 'SWE', current: true, endDate: 'Present', highlights: ['Built X'] }, 'nonsense'],
      projects: 'not an array',
      extra: { whatever: true },
    });
    expect(p.basics.fullName).toBe('Ashutosh Sagar');
    expect(p.basics.phone).toBe('9876543210');
    expect(p.skills).toEqual(['Rust', '42']);
    expect(p.experience).toHaveLength(1);
    expect(p.experience[0]).toMatchObject({ company: 'Unboxed', current: true, endDate: '', highlights: ['Built X'] });
    expect(p.experience[0]?.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.projects).toEqual([]);
  });

  it('returns an empty profile for garbage', () => {
    expect(coerceExtractedProfile('hello').skills).toEqual([]);
  });
});

describe('parseJsonObject', () => {
  it('handles code fences and chatter', () => {
    expect(parseJsonObject('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonObject('no json')).toThrow();
  });
});

describe('pdf helpers', () => {
  it('detects PDFs by magic bytes', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7\n...'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('PK\u0003\u0004 docx'))).toBe(false);
  });

  it('cleans whitespace', () => {
    expect(cleanResumeText('  A\r\n\n\n\nB   C  ')).toBe('A\n\nB C');
  });
});
