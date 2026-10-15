import { describe, expect, it } from 'vitest';
import { chunkForSpeech, toSpeakable } from './useSpeechSynthesis';

describe('toSpeakable', () => {
  it('strips markdown and urls', () => {
    expect(toSpeakable('**Must have:**\n- Rust\n- See [docs](https://x.com) or https://y.com')).toBe(
      'Must have: Rust See docs or link',
    );
  });
});

describe('chunkForSpeech', () => {
  it('groups sentences under the max length without losing text', () => {
    const text = 'One. Two is here! Three? Four.';
    const chunks = chunkForSpeech(text, 12);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
    expect(chunks.every((c) => c.length <= 18)).toBe(true);
  });
});
