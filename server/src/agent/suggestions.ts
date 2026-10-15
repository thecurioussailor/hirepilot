import {
  getProfileField,
  MemorySuggestionSchema,
  type MemoryFact,
  type MemorySuggestion,
  type Profile,
} from '@hirepilot/shared';

const BLOCK = /<memory_suggestions>([\s\S]*?)(?:<\/memory_suggestions>|$)/gi;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The model may append <memory_suggestions>[...]</memory_suggestions> to its reply.
 * We strip it from the visible text and turn it into validated suggestions.
 * Anything malformed is dropped silently — suggestions are a bonus, never required.
 * Nothing here saves data: the user accepts each suggestion in the UI.
 */
export function extractSuggestions(
  raw: string,
  profile: Profile,
  facts: MemoryFact[],
): { reply: string; suggestions: MemorySuggestion[] } {
  const blocks = [...raw.matchAll(BLOCK)].map((m) => m[1] ?? '');
  const reply = raw.replace(BLOCK, '').trim();

  const known = new Set(facts.map((f) => norm(f.text)));
  const seen = new Set<string>();
  const suggestions: MemorySuggestion[] = [];

  for (const block of blocks) {
    let items: unknown;
    try {
      items = JSON.parse(block.trim());
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const parsed = MemorySuggestionSchema.safeParse(item);
      if (!parsed.success) continue;
      const s = parsed.data;
      // Skip things we already know.
      if (s.type === 'profile' && norm(getProfileField(profile, s.field)) === norm(s.value)) continue;
      if (s.type === 'fact' && known.has(norm(s.text))) continue;
      const key = s.type === 'profile' ? `p:${s.field}` : `f:${norm(s.text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(s);
      if (suggestions.length === 3) return { reply, suggestions };
    }
  }
  return { reply, suggestions };
}
