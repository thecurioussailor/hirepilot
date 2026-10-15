import { describe, expect, it } from 'vitest';
import { htmlToText, parseJobPostings } from './jobPosting';

describe('parseJobPostings', () => {
  it('parses a typical Greenhouse-style JobPosting', () => {
    const raw = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Senior Backend Engineer',
      hiringOrganization: { '@type': 'Organization', name: 'Acme &amp; Co' },
      datePosted: '2026-10-01',
      employmentType: ['FULL_TIME', 'CONTRACTOR'],
      jobLocation: { '@type': 'Place', address: { addressLocality: 'Bengaluru', addressCountry: 'IN' } },
      description: '&lt;p&gt;Build &lt;b&gt;APIs&lt;/b&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Rust&lt;/li&gt;&lt;/ul&gt;',
    });
    const [job] = parseJobPostings([raw]);
    expect(job).toEqual({
      title: 'Senior Backend Engineer',
      company: 'Acme & Co',
      location: 'Bengaluru, IN',
      employmentType: 'FULL_TIME, CONTRACTOR',
      datePosted: '2026-10-01',
      description: 'Build APIs\n• Rust',
    });
  });

  it('finds postings inside @graph and arrays, and ignores other types', () => {
    const raw = JSON.stringify({
      '@graph': [{ '@type': 'Organization', name: 'X' }, { '@type': ['JobPosting'], title: 'Dev' }],
    });
    expect(parseJobPostings([raw, '[{"@type":"WebPage"}]']).map((j) => j.title)).toEqual(['Dev']);
  });

  it('marks remote jobs and skips malformed JSON', () => {
    const raw = JSON.stringify({ '@type': 'JobPosting', title: 'SWE', jobLocationType: 'TELECOMMUTE' });
    const [job] = parseJobPostings(['{not json', raw]);
    expect(job?.location).toBe('Remote');
  });

  it('skips postings without a title', () => {
    expect(parseJobPostings([JSON.stringify({ '@type': 'JobPosting' })])).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('keeps paragraph structure', () => {
    expect(htmlToText('<p>One</p><p>Two<br>Three</p>')).toBe('One\nTwo\nThree');
  });
});
