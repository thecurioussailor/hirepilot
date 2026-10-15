import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, setProfileField } from '@hirepilot/shared';
import { extractSuggestions } from './suggestions';

describe('extractSuggestions', () => {
  it('strips the block and returns valid suggestions', () => {
    const raw = `Nice to meet you, Ashutosh! I can save that.
<memory_suggestions>[{"type":"profile","field":"fullName","value":"Ashutosh Sagar"},{"type":"fact","category":"preference","text":"Prefers remote roles"}]</memory_suggestions>`;
    const { reply, suggestions } = extractSuggestions(raw, EMPTY_PROFILE, []);
    expect(reply).toBe('Nice to meet you, Ashutosh! I can save that.');
    expect(suggestions).toEqual([
      { type: 'profile', field: 'fullName', value: 'Ashutosh Sagar' },
      { type: 'fact', category: 'preference', text: 'Prefers remote roles' },
    ]);
  });

  it('drops invalid items, unknown fields, and things already known', () => {
    const profile = setProfileField(EMPTY_PROFILE, 'fullName', 'Ashutosh Sagar');
    const facts = [{ id: '1', text: 'Prefers remote roles', category: 'preference' as const, createdAt: '', updatedAt: '' }];
    const raw = `ok<memory_suggestions>[
      {"type":"profile","field":"fullName","value":"ashutosh  sagar"},
      {"type":"profile","field":"password","value":"x"},
      {"type":"fact","text":"prefers remote roles"},
      {"type":"fact","text":"Has 4 years of experience","category":"career"}
    ]</memory_suggestions>`;
    const { suggestions } = extractSuggestions(raw, profile, facts);
    expect(suggestions).toEqual([{ type: 'fact', text: 'Has 4 years of experience', category: 'career' }]);
  });

  it('survives malformed or unterminated blocks', () => {
    expect(extractSuggestions('hi <memory_suggestions>[{oops', EMPTY_PROFILE, [])).toEqual({ reply: 'hi', suggestions: [] });
    expect(extractSuggestions('plain reply', EMPTY_PROFILE, [])).toEqual({ reply: 'plain reply', suggestions: [] });
  });

  it('caps at 3 suggestions', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ type: 'fact', text: `fact ${i}` }));
    const { suggestions } = extractSuggestions(`x<memory_suggestions>${JSON.stringify(items)}</memory_suggestions>`, EMPTY_PROFILE, []);
    expect(suggestions).toHaveLength(3);
  });
});
