import { useCallback, useEffect, useState } from 'react';

/** Make LLM text pleasant to hear: drop markdown symbols and read URLs as "link". */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chrome's speech synthesis can cut off long utterances after ~15 seconds,
 * so we queue one utterance per sentence group.
 */
export function chunkForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function useSpeechSynthesis(lang = 'en-IN') {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      const chunks = chunkForSpeech(toSpeakable(text));
      if (chunks.length === 0) return;
      setSpeaking(true);
      chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = lang;
        u.rate = 1.05;
        if (i === chunks.length - 1) {
          u.onend = () => setSpeaking(false);
          u.onerror = () => setSpeaking(false);
        }
        window.speechSynthesis.speak(u);
      });
    },
    [lang, supported],
  );

  useEffect(() => stop, [stop]);

  return { supported, speaking, speak, stop };
}
