const STORY_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;

/** Story keys such as ACME-12 found in a pull-request title, body, or branch name. Branch names are matched case-insensitively. */
export function extractStoryKeys(...texts: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const candidate of [text, text.toUpperCase()]) {
      for (const m of candidate.matchAll(STORY_KEY)) keys.add(`${m[1]}-${Number(m[2])}`);
    }
  }
  return [...keys];
}

export function projectKeyOf(storyKey: string): string {
  return storyKey.slice(0, storyKey.lastIndexOf('-'));
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /(?<!\w)\+?\d[\d ().-]{7,}\d(?!\w)/g;

/** Removes contact and card details from merchant messages and log lines before they are stored or indexed. */
export function redactPii(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const mark = (label: string) => () => {
    redacted = true;
    return `[${label} removed]`;
  };
  const out = text.replace(EMAIL, mark('email')).replace(CARD, mark('number')).replace(PHONE, mark('phone'));
  return { text: out, redacted };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Word-set similarity used for duplicate detection on drafted stories and meeting actions. */
export function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}
