import { basename } from "path";
import { fileKind } from "./doctype";
import { DocumentGroup, SearchHit } from "./types";

export function pageLabel(hit: SearchHit): string | undefined {
  if (hit.pages.length === 0) return hit.line ? `line ${hit.line}` : undefined;
  const unit = fileKind(hit.path, hit.documentType) === "powerpoint" ? "slide" : "p.";
  const pages = [...new Set(hit.pages)].sort((a, b) => a - b);
  const first = pages[0];
  const last = pages[pages.length - 1];
  const plural = unit === "p." ? "pp." : "slides";
  return first === last ? `${unit} ${first}` : `${plural} ${first}–${last}`;
}

export function headingTrail(hit: SearchHit): string {
  return hit.headings.join(" › ");
}

/** `file, page, "heading trail"` on one line, then the full path. */
export function formatCitation(hit: SearchHit): string {
  const parts = [
    hit.title && hit.title !== basename(hit.path) ? `${hit.title} (${basename(hit.path)})` : basename(hit.path),
  ];
  const page = pageLabel(hit);
  if (page) parts.push(page);
  const trail = headingTrail(hit);
  if (trail) parts.push(`“${trail}”`);
  return `${parts.join(", ")}\n${hit.path}`;
}

/** Groups hits by document, keeping the service's ranking: a group sits where its best hit ranked. */
export function groupByDocument(hits: SearchHit[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>();
  for (const hit of hits) {
    const key = `${hit.database ?? ""}\u0000${hit.documentId || hit.path}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        path: hit.path,
        title: hit.title || basename(hit.path),
        documentType: hit.documentType,
        hits: [],
      };
      groups.set(key, group);
    }
    group.hits.push(hit);
  }
  return [...groups.values()];
}
