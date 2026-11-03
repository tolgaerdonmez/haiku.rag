import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useRef, useState } from "react";
import { basename, dirname } from "path";
import { headingTrail, groupByDocument, pageLabel } from "../lib/citation";
import { fileKind } from "../lib/doctype";
import { preferences, resultLimit, searchService } from "../lib/preferences";
import { emphasiseMarkdown, emphasisePlain, snippetSpans } from "../lib/text";
import { SearchHit } from "../lib/types";
import { HitActions } from "./HitActions";

export interface DocumentScope {
  documentId: string;
  database?: string;
  title: string;
}

const KIND_ICON: Record<string, Icon> = {
  pdf: Icon.Document,
  text: Icon.Code,
  word: Icon.Paragraph,
  powerpoint: Icon.AppWindowGrid2x2,
  html: Icon.Globe,
  epub: Icon.Book,
  other: Icon.BlankDocument,
};

function tidyHome(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** Whitespace flattened to spaces one for one, so highlight offsets still apply. */
function flatten(text: string): string {
  return text.replace(/\s/g, " ");
}

function rowTitle(hit: SearchHit, query: string): string {
  return emphasisePlain(snippetSpans(flatten(hit.snippet), query, hit.highlights))
    .replace(/ {2,}/g, " ")
    .trim();
}

function detailMarkdown(hit: SearchHit, query: string): string {
  const parts: string[] = [];
  const trail = headingTrail(hit);
  if (trail) parts.push(`### ${trail}`);
  parts.push(
    `> ${emphasiseMarkdown(snippetSpans(flatten(hit.snippet), query, hit.highlights))
      .replace(/ {2,}/g, " ")
      .trim()}`,
  );
  const context = hit.context && hit.context.trim() !== hit.text.trim() ? hit.context : hit.text;
  if (context && context.trim() !== hit.snippet.trim()) {
    parts.push("---", context);
  }
  return parts.join("\n\n");
}

function HitDetail({ hit, query }: { hit: SearchHit; query: string }) {
  const page = pageLabel(hit);
  return (
    <List.Item.Detail
      markdown={detailMarkdown(hit, query)}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="File" text={basename(hit.path)} />
          {page ? <List.Item.Detail.Metadata.Label title="Location" text={page} /> : null}
          {hit.headings.length > 0 ? (
            <List.Item.Detail.Metadata.Label title="Section" text={headingTrail(hit)} />
          ) : null}
          {hit.labels.length > 0 ? (
            <List.Item.Detail.Metadata.TagList title="Elements">
              {[...new Set(hit.labels)].map((l) => (
                <List.Item.Detail.Metadata.TagList.Item key={l} text={l.replace(/_/g, " ")} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          ) : null}
          <List.Item.Detail.Metadata.Label title="Folder" text={tidyHome(dirname(hit.path))} />
          <List.Item.Detail.Metadata.Label title="Type" text={hit.documentType} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export function SearchView({ scope }: { scope?: DocumentScope }) {
  const prefs = useMemo(() => preferences(), []);
  const service = useMemo(() => searchService(prefs), [prefs]);
  const limit = resultLimit(prefs);
  const [query, setQuery] = useState("");
  const [showingDetail, setShowingDetail] = useState(true);
  const abortable = useRef<AbortController>(null);

  const { data, isLoading, error } = usePromise(
    async (q: string) => {
      if (!q.trim()) return undefined;
      return service.search(
        q,
        { limit, context: true, documentId: scope?.documentId, database: scope?.database },
        abortable.current?.signal,
      );
    },
    [query],
    { abortable, failureToastOptions: { title: "Search failed" } },
  );

  const groups = useMemo(() => groupByDocument(data?.hits ?? []), [data]);
  const hasHits = groups.length > 0;

  return (
    <List
      isLoading={isLoading}
      throttle
      filtering={false}
      onSearchTextChange={setQuery}
      isShowingDetail={showingDetail && hasHits}
      navigationTitle={scope ? `Search in ${scope.title}` : undefined}
      searchBarPlaceholder={scope ? `Search inside ${scope.title}…` : "Search your files by meaning…"}
    >
      {!query.trim() ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={scope ? `Search inside ${scope.title}` : "Search your files"}
          description="Type a question or keywords. Enter opens the result at its page and passage."
        />
      ) : error && !hasHits ? (
        <List.EmptyView icon={Icon.Warning} title="The search service did not answer" description={error.message} />
      ) : !isLoading && !hasHits ? (
        <List.EmptyView icon={Icon.MagnifyingGlass} title="No matching passages" />
      ) : null}
      {groups.map((group) => (
        <List.Section
          key={group.key}
          title={group.title}
          subtitle={`${tidyHome(dirname(group.path))} · ${group.hits.length} ${group.hits.length === 1 ? "passage" : "passages"}`}
        >
          {group.hits.map((hit) => {
            const page = pageLabel(hit);
            const heading = hit.headings.at(-1);
            const title = rowTitle(hit, query);
            return (
              <List.Item
                key={hit.id}
                id={hit.id}
                icon={KIND_ICON[fileKind(hit.path, hit.documentType)]}
                title={showingDetail ? [page, heading, title].filter(Boolean).join(" · ") : title}
                subtitle={showingDetail ? undefined : heading}
                accessories={showingDetail ? undefined : page ? [{ tag: page }] : undefined}
                keywords={hit.headings}
                detail={<HitDetail hit={hit} query={query} />}
                actions={
                  <HitActions
                    hit={hit}
                    query={query}
                    scoped={!!scope}
                    extra={
                      <Action
                        title={showingDetail ? "Hide Details" : "Show Details"}
                        icon={Icon.Sidebar}
                        shortcut={{ modifiers: ["cmd"], key: "d" }}
                        onAction={() => setShowingDetail((v) => !v)}
                      />
                    }
                  />
                }
              />
            );
          })}
        </List.Section>
      ))}
      {data && data.skipped > 0 ? (
        <List.Section title={`${data.skipped} more results are not local files`}>
          <List.Item
            title="Results without a local file are hidden"
            icon={Icon.Info}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard content={query} title="Copy Query" />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
    </List>
  );
}
