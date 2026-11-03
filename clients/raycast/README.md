# haiku.rag for Raycast

Search the files haiku.rag indexes and land on the exact page and passage.
It talks to the local search service (`haiku-ingester serve`, contract in
[`docs/local-search-api.md`](../../docs/local-search-api.md)).

## Commands

- **Search Documents**: results as you type, grouped by document. Each row
  shows the page, the section heading and the snippet with the matched words
  in bold; the detail pane (⌘D) shows the passage in its section.
- **Manage Indexed Folders**: the folder register. Add a folder, edit its
  include and exclude globs, stop watching it or remove it from the index,
  and see and retry files that failed to ingest.

## Opening a result

Enter opens the result where the passage is:

| File | Opens in | Lands on |
|---|---|---|
| PDF, scanned PDF | Skim | The page, scrolled to the passage. Text is selected; a scanned page or a picture gets a selection box. Nothing is written to the PDF. |
| Markdown, text, code | Neovim in a new Rex tab | The passage's line, centred. |
| Word | Microsoft Word | The page, with the passage copied for ⌘F. Without Word, the default app with the passage copied. |
| PowerPoint | Microsoft PowerPoint | The slide, with the passage copied. Without PowerPoint, the default app with the passage copied. |
| HTML | The default browser | The section, through a text fragment that highlights the heading and the passage. |
| EPUB | The default browser | The chapter file holding the passage, at the section. **Open in Books** opens it in Books with the passage copied. |
| Anything else | The default app | The passage is copied for ⌘F. |

Rex tabs go to the session named in the preferences (`haiku` by default),
created on first use, and Rex is brought forward on that tab.

## Actions (⌘K)

| Action | Shortcut |
|---|---|
| Show in Finder | ⌘⇧F |
| Search in This Document | ⌘F |
| Quick Look Page (the PDF page with the passage outlined) | ⌘Y |
| Copy Citation (file, page, heading trail, path) | ⌘⇧C |
| Ask About This Result | ⌘⇧A |
| Copy Passage, Copy Path, Open in Default App | |
| Manage Indexed Folders | |

**Ask About This Result** sends the passage (its section when the service
returned one) and your question to OpenRouter. The API key is a password
preference. Answers are capped at 700 tokens, and asking stops once the
month's recorded spend reaches **Monthly Spending Cap** (default $1.00). The
spend is OpenRouter's reported cost for each answer, kept in the extension's
local storage. A spending limit on the OpenRouter key itself is the hard
backstop.

## Preferences

| Preference | Default |
|---|---|
| Search Service URL | `http://127.0.0.1:8765` |
| Service Token | empty; set when `ingester.api.auth_token` is set |
| Mock Data | off; on serves the sample files in `assets/samples` without a service |
| Result Limit | 20 |
| Rex CLI | empty finds the CLI bundled with Rex |
| Rex Session | `haiku` |
| Editor | `nvim` |
| OpenRouter API Key, Ask Model, Monthly Spending Cap | empty, `google/gemini-2.5-flash-lite`, `1.00` |

## Development

```bash
cd clients/raycast
npm install
npm run dev        # ray develop: loads the extension into Raycast until you stop it
npm test           # vitest: coordinate mapping, opener dispatch, scripts, client
npm run lint       # ray lint
npm run typecheck
npm run build      # ray build into ./dist
```

Turn on **Mock Data** to try the commands and every opener against the
bundled samples without the service.
