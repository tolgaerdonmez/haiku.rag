const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

const WORD = /[\p{L}\p{N}]+/gu;

/** Lowercased query words worth emphasising. */
export function queryTerms(query: string): string[] {
  const terms = (query.toLowerCase().match(WORD) ?? []).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(terms)];
}

function matches(word: string, terms: string[]): boolean {
  const w = word.toLowerCase();
  return terms.some((t) => w.startsWith(t) || (w.length >= 4 && t.startsWith(w)));
}

export interface Span {
  text: string;
  match: boolean;
}

/** Splits text into runs, marking the words a query term prefixes. */
export function splitMatches(text: string, query: string): Span[] {
  const terms = queryTerms(query);
  const spans: Span[] = [];
  let last = 0;
  const push = (t: string, match: boolean) => {
    if (!t) return;
    const prev = spans[spans.length - 1];
    if (prev && prev.match === match) prev.text += t;
    else spans.push({ text: t, match });
  };
  if (terms.length > 0) {
    for (const m of text.matchAll(WORD)) {
      if (!matches(m[0], terms)) continue;
      push(text.slice(last, m.index), false);
      push(m[0], true);
      last = m.index + m[0].length;
    }
  }
  push(text.slice(last), false);
  return spans;
}

/** Splits text at `[start, end)` highlight offsets; overlapping or out-of-range ranges are clipped. */
export function splitHighlights(text: string, highlights: [number, number][]): Span[] {
  const ranges = highlights
    .map(([s, e]) => [Math.max(0, s), Math.min(text.length, e)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const spans: Span[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    const start = Math.max(s, pos);
    if (start >= e) continue;
    if (start > pos) spans.push({ text: text.slice(pos, start), match: false });
    spans.push({ text: text.slice(start, e), match: true });
    pos = e;
  }
  if (pos < text.length) spans.push({ text: text.slice(pos), match: false });
  return spans;
}

/** The service's highlights when it sent any, else the query words found in the text. */
export function snippetSpans(text: string, query: string, highlights?: [number, number][]): Span[] {
  return highlights && highlights.length > 0 ? splitHighlights(text, highlights) : splitMatches(text, query);
}

const MARKDOWN_SPECIAL = /([\\`*_{}[\]()#+\-.!|>~<])/g;

export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, "\\$1");
}

/** Markdown with the matched words in bold. */
export function emphasiseMarkdown(spans: Span[]): string {
  return spans.map((s) => (s.match ? `**${escapeMarkdown(s.text)}**` : escapeMarkdown(s.text))).join("");
}

const BOLD_UPPER = 0x1d5d4;
const BOLD_LOWER = 0x1d5ee;
const BOLD_DIGIT = 0x1d7ec;

/** Mathematical sans-serif bold for ASCII letters and digits; plain text rows cannot carry markup. */
export function toBoldUnicode(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(BOLD_UPPER + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(BOLD_LOWER + c - 97);
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(BOLD_DIGIT + c - 48);
    else out += ch;
  }
  return out;
}

export function emphasisePlain(spans: Span[]): string {
  return spans.map((s) => (s.match ? toBoldUnicode(s.text) : s.text)).join("");
}

/** Removes markdown markup that chunk text carries, keeping the words. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|?[-:| ]+\|[-:| ]*$/gm, " ")
    .replace(/[*_`|>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function singleLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The 1-based line where the passage starts, by matching its first words against each line.
 * Tries the first eight words, then fewer, so a passage rewrapped by the chunker still lands.
 */
export function locateLine(content: string, passage: string): number | undefined {
  const lines = content.split(/\r?\n/);
  const normLines = lines.map(normalise);
  const words = normalise(stripMarkdown(passage)).split(" ").filter(Boolean);
  if (words.length === 0) return undefined;
  const fewest = words.length === 1 ? 1 : 2;
  for (let n = Math.min(8, words.length); n >= fewest; n--) {
    const needle = words.slice(0, n).join(" ");
    const idx = normLines.findIndex((l) => ` ${l} `.includes(` ${needle} `));
    if (idx >= 0) return idx + 1;
  }
  return undefined;
}
