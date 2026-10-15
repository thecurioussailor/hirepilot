import { LIMITS, PageContextSchema, type PageContext } from '@hirepilot/shared';
import { parseJobPostings } from './jobPosting';

/** Origins we ask for the first time the user shares a page. */
export const ALL_SITES = ['https://*/*', 'http://*/*'];

export class PageAccessError extends Error {
  constructor(
    message: string,
    /** true → the user can fix it by granting site access. */
    readonly needsPermission: boolean,
  ) {
    super(message);
    this.name = 'PageAccessError';
  }
}

interface RawSnapshot {
  url: string;
  title: string;
  selection: string;
  text: string;
  truncated: boolean;
  jsonLd: string[];
}

/**
 * Runs INSIDE the web page via chrome.scripting.executeScript.
 * Chrome serialises this function's source, so it must be self-contained:
 * no imports, no outer variables — only its arguments.
 * It only reads; it never modifies the page.
 */
function readPageInPage(maxText: number, maxSelection: number): RawSnapshot {
  const clean = (s: string) =>
    s
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  // Prefer the main content region if it has real content; otherwise the whole body.
  const main = document.querySelector<HTMLElement>('main, [role="main"], article');
  const root = main && main.innerText.trim().length > 300 ? main : document.body;
  // innerText (not textContent) skips hidden elements, <script> and <style>.
  const full = clean(root?.innerText ?? '');

  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => s.textContent ?? '')
    .filter((s) => s.length > 0 && s.length < 200_000)
    .slice(0, 10);

  return {
    url: location.href,
    title: document.title,
    selection: clean(window.getSelection()?.toString() ?? '').slice(0, maxSelection),
    text: full.slice(0, maxText),
    truncated: full.length > maxText,
    jsonLd,
  };
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new PageAccessError('No active tab found.', false);
  return tab;
}

export async function hasSiteAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ALL_SITES });
}

/**
 * Must be called directly from a click handler (Chrome requires a user
 * gesture), with no `await` before it.
 */
export function requestSiteAccess(): Promise<boolean> {
  return chrome.permissions.request({ origins: ALL_SITES });
}

function explain(err: unknown): PageAccessError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/cannot be scripted|chrome:\/\/|chrome-extension:\/\/|edge:\/\/|about:|webstore/i.test(msg)) {
    return new PageAccessError("Chrome doesn't let extensions read browser pages (chrome://, New Tab, Web Store).", false);
  }
  if (/permission|Cannot access contents/i.test(msg)) {
    return new PageAccessError('HirePilot needs permission to read web pages.', true);
  }
  if (/Frame with ID 0 is showing error page|error page/i.test(msg)) {
    return new PageAccessError('The page failed to load, so there is nothing to read.', false);
  }
  return new PageAccessError(`Couldn't read the page: ${msg}`, false);
}

/** Capture the active tab as a validated PageContext. */
export async function capturePage(): Promise<PageContext> {
  const tab = await getActiveTab();

  let raw: RawSnapshot | undefined;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: readPageInPage,
      args: [LIMITS.pageTextChars, LIMITS.selectionChars],
    });
    raw = result?.result as RawSnapshot | undefined;
  } catch (err) {
    throw explain(err);
  }
  if (!raw) throw new PageAccessError('The page returned nothing. Try reloading it.', false);
  if (!/^https?:/.test(raw.url)) {
    throw new PageAccessError('Only regular http(s) web pages can be read.', false);
  }

  const context: PageContext = {
    url: raw.url,
    title: raw.title.slice(0, 500),
    selection: raw.selection,
    text: raw.text,
    truncated: raw.truncated,
    jobPostings: parseJobPostings(raw.jsonLd),
    capturedAt: new Date().toISOString(),
  };
  // Validate before it leaves the browser layer — same schema the server uses.
  return PageContextSchema.parse(context);
}
