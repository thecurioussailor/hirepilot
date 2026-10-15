import { extractText, getDocumentProxy } from 'unpdf';
import { RESUME_LIMITS } from '@hirepilot/shared';

export type TextExtractor = (bytes: Uint8Array) => Promise<string>;

export function looksLikePdf(bytes: Uint8Array): boolean {
  // Every PDF starts with "%PDF-" (sometimes after a few junk bytes).
  const head = new TextDecoder().decode(bytes.slice(0, 1024));
  return head.includes('%PDF-');
}

export function cleanResumeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, RESUME_LIMITS.maxTextChars);
}

/** Pure-JS PDF text extraction (pdf.js under the hood, no native binaries). */
export const extractPdfText: TextExtractor = async (bytes) => {
  // pdf.js may take ownership of the buffer, so give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return cleanResumeText(text);
};
