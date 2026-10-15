import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, getProfileField, ProfileSchema, setProfileField } from './profile';

describe('ProfileSchema', () => {
  it('fills every section with defaults from an empty object', () => {
    expect(EMPTY_PROFILE.basics.fullName).toBe('');
    expect(EMPTY_PROFILE.preferences.workMode).toBe('any');
    expect(EMPTY_PROFILE.experience).toEqual([]);
  });

  it('keeps partial data and defaults the rest', () => {
    const p = ProfileSchema.parse({ basics: { fullName: '  Ashutosh Sagar ' }, skills: ['Rust'] });
    expect(p.basics.fullName).toBe('Ashutosh Sagar');
    expect(p.basics.email).toBe('');
    expect(p.skills).toEqual(['Rust']);
  });
});

describe('profile field helpers', () => {
  it('sets basics and links without mutating', () => {
    const a = setProfileField(EMPTY_PROFILE, 'fullName', 'Ashutosh');
    const b = setProfileField(a, 'github', 'https://github.com/x');
    expect(getProfileField(b, 'fullName')).toBe('Ashutosh');
    expect(getProfileField(b, 'github')).toBe('https://github.com/x');
    expect(EMPTY_PROFILE.basics.fullName).toBe('');
  });
});
