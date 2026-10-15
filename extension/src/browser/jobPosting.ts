import { LIMITS, type JobPosting } from '@hirepilot/shared';

/**
 * Many ATS pages (Greenhouse, Lever, Ashby, Workday, LinkedIn job pages…)
 * embed a schema.org JobPosting as JSON-LD for Google Jobs. When present it is
 * far more reliable than scraping text — and costs zero LLM tokens.
 *
 * Pure function over raw <script type="application/ld+json"> contents, so it's
 * unit-testable without a browser.
 */
export function parseJobPostings(rawJsonLd: string[]): JobPosting[] {
  const found: JobPosting[] = [];
  for (const raw of rawJsonLd) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue; // Malformed JSON-LD is common in the wild; skip it.
    }
    for (const node of walk(data)) {
      const posting = toJobPosting(node);
      if (posting) found.push(posting);
      if (found.length >= 5) return found;
    }
  }
  return found;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function* walk(value: unknown, depth = 0): Generator<Obj> {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const v of value) yield* walk(v, depth + 1);
  } else if (isObj(value)) {
    yield value;
    if (value['@graph']) yield* walk(value['@graph'], depth + 1);
  }
}

function hasType(node: Obj, type: string): boolean {
  const t = node['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

function toJobPosting(node: Obj): JobPosting | null {
  if (!hasType(node, 'JobPosting')) return null;
  const title = str(node.title);
  if (!title) return null;

  const org = node.hiringOrganization;
  const company = isObj(org) ? str(org.name) : str(org);
  const employmentType = Array.isArray(node.employmentType)
    ? node.employmentType.filter((x): x is string => typeof x === 'string').join(', ') || undefined
    : str(node.employmentType);
  const description = str(node.description);

  return {
    title: decodeEntities(title),
    company: company && decodeEntities(company),
    location: formatLocation(node.jobLocation, node.jobLocationType),
    employmentType,
    datePosted: str(node.datePosted),
    description: description ? htmlToText(description).slice(0, LIMITS.jobDescriptionChars) : undefined,
  };
}

function formatLocation(jobLocation: unknown, locationType: unknown): string | undefined {
  const places = (Array.isArray(jobLocation) ? jobLocation : [jobLocation]).filter(isObj);
  const names = places
    .map((p) => {
      const a = isObj(p.address) ? p.address : undefined;
      if (!a) return str(p.name);
      return [a.addressLocality, a.addressRegion, a.addressCountry]
        .map((x) => (isObj(x) ? str(x.name) : str(x)))
        .filter(Boolean)
        .join(', ');
    })
    .filter((s): s is string => !!s);
  if (locationType === 'TELECOMMUTE') names.push('Remote');
  return names.length ? [...new Set(names)].join(' | ') : undefined;
}

/** Job descriptions in JSON-LD are usually (sometimes double-escaped) HTML. */
export function htmlToText(html: string): string {
  const once = decodeEntities(html); // handles "&lt;p&gt;" double-encoding
  return decodeEntities(
    once
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}
