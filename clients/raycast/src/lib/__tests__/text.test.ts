import { describe, expect, it } from "vitest";
import { formatCitation, groupByDocument, pageLabel } from "../citation";
import { parsePatterns } from "../patterns";
import {
  emphasiseMarkdown,
  emphasisePlain,
  locateLine,
  queryTerms,
  snippetSpans,
  splitHighlights,
  stripMarkdown,
  toBoldUnicode,
} from "../text";
import { SearchHit } from "../types";

function hit(over: Partial<SearchHit> = {}): SearchHit {
  return {
    id: "files:c1",
    documentId: "d1",
    path: "/Users/me/Guitar/Country Guitar.pdf",
    title: "Country Guitar",
    documentType: "pdf",
    pages: [40],
    headings: ["Chapter 5", "Travis Picking"],
    labels: ["text"],
    snippet: "Travis picking",
    text: "Travis picking",
    score: 1,
    boxes: [],
    ...over,
  };
}

describe("emphasis", () => {
  it("drops stopwords and short words from the query", () => {
    expect(queryTerms("What is the Travis picking of a song?")).toEqual(["travis", "picking", "song"]);
  });

  it("splits at the service's highlight offsets", () => {
    expect(splitHighlights("...Travis picking is", [[3, 9]])).toEqual([
      { text: "...", match: false },
      { text: "Travis", match: true },
      { text: " picking is", match: false },
    ]);
  });

  it("clips overlapping and out-of-range highlights", () => {
    const spans = splitHighlights("abcdef", [
      [4, 99],
      [0, 2],
      [1, 3],
    ]);
    expect(spans).toEqual([
      { text: "ab", match: true },
      { text: "c", match: true },
      { text: "d", match: false },
      { text: "ef", match: true },
    ]);
  });

  it("falls back to query words when the service sent no highlights", () => {
    const spans = snippetSpans("Fingerstyle picks and picking patterns", "picking", []);
    expect(spans.filter((s) => s.match).map((s) => s.text)).toEqual(["picking"]);
    expect(
      snippetSpans("Pickers pick it", "picked", undefined)
        .filter((s) => s.match)
        .map((s) => s.text),
    ).toEqual(["pick"]);
    expect(snippetSpans("an is it", "it").filter((s) => s.match)).toHaveLength(0);
    expect(
      snippetSpans("guitars", "guitar")
        .filter((s) => s.match)
        .map((s) => s.text),
    ).toEqual(["guitars"]);
  });

  it("bolds in markdown and escapes the rest", () => {
    expect(emphasiseMarkdown(splitHighlights("a *b* c", [[3, 4]]))).toBe("a \\***b**\\* c");
  });

  it("bolds plain titles with Unicode letters", () => {
    expect(toBoldUnicode("Ab9ü")).toBe("𝗔𝗯𝟵ü");
    expect(emphasisePlain(splitHighlights("fox den", [[0, 3]]))).toBe("𝗳𝗼𝘅 den");
  });

  it("strips markdown markup", () => {
    expect(stripMarkdown("## Title\n\n- **bold** [link](http://x) `code`")).toBe("Title bold link code");
  });
});

describe("locateLine", () => {
  const content = ["# Notes", "", "intro", "The passage about modal", "interchange lives here.", "end"].join("\n");

  it("finds the line where the passage starts, even when rewrapped", () => {
    expect(locateLine(content, "The passage about modal interchange lives here.")).toBe(4);
  });

  it("matches whole words only", () => {
    expect(locateLine("theme passage\nthe passage here", "the passage")).toBe(2);
  });

  it("returns undefined when the passage is not there", () => {
    expect(locateLine(content, "nothing like it at all")).toBeUndefined();
    expect(locateLine(content, "")).toBeUndefined();
  });
});

describe("citations and grouping", () => {
  it("labels pages, page ranges, slides and lines", () => {
    expect(pageLabel(hit())).toBe("p. 40");
    expect(pageLabel(hit({ pages: [41, 40] }))).toBe("pp. 40–41");
    expect(pageLabel(hit({ path: "/d.pptx", documentType: "powerpoint", pages: [3] }))).toBe("slide 3");
    expect(pageLabel(hit({ pages: [], line: 12 }))).toBe("line 12");
    expect(pageLabel(hit({ pages: [] }))).toBeUndefined();
  });

  it("formats file, page and heading trail, then the path", () => {
    expect(formatCitation(hit())).toBe(
      "Country Guitar (Country Guitar.pdf), p. 40, “Chapter 5 › Travis Picking”\n/Users/me/Guitar/Country Guitar.pdf",
    );
    expect(formatCitation(hit({ title: undefined, headings: [], pages: [] }))).toBe(
      "Country Guitar.pdf\n/Users/me/Guitar/Country Guitar.pdf",
    );
  });

  it("groups by document in ranking order", () => {
    const groups = groupByDocument([
      hit({ id: "1", documentId: "a" }),
      hit({ id: "2", documentId: "b", path: "/b.md" }),
      hit({ id: "3", documentId: "a" }),
      hit({ id: "4", documentId: "a", database: "other" }),
    ]);
    expect(groups.map((g) => g.hits.map((h) => h.id))).toEqual([["1", "3"], ["2"], ["4"]]);
  });

  it("parses folder patterns", () => {
    expect(parsePatterns("**/*.pdf\n **/*.md , \n")).toEqual(["**/*.pdf", "**/*.md"]);
    expect(parsePatterns(undefined)).toEqual([]);
  });
});
