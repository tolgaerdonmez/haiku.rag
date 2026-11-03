# Local search service on macOS

The [local search API](local-search-api.md) runs as a per-user launchd agent:
`haiku-ingester serve` watching the registered folders, started on demand, at
low priority. `scripts/install-macos.sh` asks what to install and installs it;
`scripts/macos-service.sh`, which it builds on, installs and manages the service
from a checkout, with the Raycast extension (`clients/raycast`) and its
Cmd+Shift+F hotkey. The files they install live in `service/macos/`:

| File | What it is |
|---|---|
| `launcher.c` | The program launchd runs. It holds the Full Disk Access grant, hands launchd's socket to the service and runs it as its child. |
| `haiku-rag-serve.in` | The command the launcher runs: `haiku-ingester serve`, or a successful exit while the embedding model is missing. |
| `com.haiku-rag.service.plist.in` | The launchd agent. |
| `haiku.rag.yaml` | The service configuration, installed as-is: the coreml embedder, 1024-token chunks, supervised conversion with Apple Vision OCR, the folder register, the throttle and the idle exit. |
| `folders.yaml` | An empty folder register, installed only where none exists. |
| `build.sh` | Compiles the launcher and renders all of the above for an install directory. It installs nothing. |

Everything is installed under `~/Library/Application Support/haiku.rag/`:

| Path | |
|---|---|
| `haiku.rag.yaml`, `folders.yaml` | Configuration and folder register |
| `models/jina-nano-coreml/` | The Core ML embedding model (`model.mlpackage`, `tokenizer.json`) |
| `files.lancedb/`, `ingester.db` | The index and the queue |
| `service/bin/haiku-rag-service` | The launcher, the program granted Full Disk Access |
| `service/bin/haiku-rag-serve` | The command it runs |
| `service/env/` | The Python environment, with the `ingester` and `coreml` extras |
| `service/service.log` | The service's log |
| `raycast/` | The Raycast extension's working copy |
| `source/` | The fork's checkout, when the installer ran on its own |

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/tolgaerdonmez/haiku.rag/main/scripts/install-macos.sh | sh
```

Run on its own, the installer clones the fork into
`~/Library/Application Support/haiku.rag/source` (or updates that clone) and
runs the copy there; from a checkout, `scripts/install-macos.sh` installs that
checkout. It checks the Mac (macOS 15 or later, Apple Silicon for the Neural
Engine, the Xcode Command Line Tools, uv, which it offers to install, free disk,
Raycast and Karabiner-Elements), then opens a menu in the terminal: every
component is a checkbox (arrows move, space checks or unchecks, Return
continues), with the recommended ones checked and the unavailable ones greyed
out with the reason. It then asks where the model comes from (Hugging Face,
another repository, a folder on this Mac, or keeping the installed one) and
which folders to index (the usual ones that exist, any other folder you type,
Tab completing), shows the plan, and installs exactly what is checked, or goes
back to change it, or cancels without changing anything:

| Component | | Preselected |
|---|---|---|
| `service` | The launchd agent, its launcher and the Python environment (about 1.9 GB) | yes |
| `model` | The Core ML embedding model from Hugging Face (about 850 MB installed, 420 MB download, each file checked against its SHA-256) | yes |
| `raycast` | The Raycast extension: Search Documents, Manage Indexed Folders. Needs Node.js | when Raycast is installed |
| `hotkey` | Cmd+Shift+F opens Search Documents, as a Karabiner-Elements rule. Other apps lose Cmd+Shift+F | no; offered when Karabiner is installed |
| `folders` | Folders to index (`~/Documents` suggested), registered with the excludes `.*`, `*.json`, `*.yaml`, `*.yml`. Needs the service | yes |
| `fda` | Afterwards, open the Full Disk Access pane and the launcher in Finder | on a first install |

The menu is `scripts/install-macos-tui.py`, a Python script uv runs with its
pinned `questionary`. Without uv, when its packages cannot be fetched, or with
`HAIKU_RAG_TUI=0`, a numbered menu asks instead, and the folders are asked
after installing.

Afterwards it shows the Full Disk Access step with the launcher's exact path
and opens that System Settings pane when `fda` is checked (the numbered menu
asks), checks that the service answers,
runs a test search when documents are indexed, and prints how to pause and
uninstall. Running it again updates what changed and keeps the index, the
folder list and an installed model.

Options pick components without asking: `--service`, `--model`, `--raycast`,
`--hotkey` and their `--no-` forms, `--folder PATH` (repeatable) and
`--no-folders`. `--yes` asks nothing and installs the preselected set, without
folders unless `--folder` names them. `--dry-run` checks the Mac, shows the
menu, and prints the plan without changing anything; with `--yes` or without a
terminal it prints the recommended plan. With the one-liner, pass them after `sh -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/tolgaerdonmez/haiku.rag/main/scripts/install-macos.sh \
  | sh -s -- --yes --folder ~/Documents
```

`--model-from DIR` installs a model folder you already have instead of
downloading one, and `--model-repo ID` / `--model-revision REV` download from
another Hugging Face repository. `HAIKU_RAG_REPO`, `HAIKU_RAG_REF` and
`HAIKU_RAG_SOURCE` pick the repository, branch and clone directory of the
one-liner.

### Uninstall

```bash
scripts/install-macos.sh --uninstall
```

removes the agent, the launcher, the Python environment, the configuration, the
Raycast extension, the Cmd+Shift+F rule, the model and the fetched source. It
asks before deleting the index, the queue and the folder list, and keeps them
by default (`--delete-index` deletes them, `--keep-model` keeps the model). It
never touches the indexed folders or their files. The Full Disk Access entry is
left for you to remove in System Settings.

### By hand: `scripts/macos-service.sh`

```bash
scripts/macos-service.sh install --model-from DIR
```

`--model-from` names a model directory (see
[The embedding model](#the-embedding-model)); it is copied when it differs from the
installed one, which is kept as `models/jina-nano-coreml.previous`. The command
stops the agent, builds the environment from the checkout with
`uv sync --no-editable` (the checkout can move afterwards), installs the files,
loads the agent, registers the Raycast extension and adds the Karabiner rule
when it is missing. Running it again updates what changed. The launcher is
replaced only when `launcher.c` changes, so its Full Disk Access grant
survives reinstalls. It refuses while a Nix-managed install of the same paths
is active.

| Command | |
|---|---|
| `status` | The agent's state and the service's `/status` |
| `restart` | Restart the service |
| `pause`, `resume` | Unload the agent until the next login, load it again |
| `logs` | Follow `service/service.log` |
| `cli ARGUMENT...` | `haiku-rag` with the service's configuration, e.g. `cli rebuild --rechunk` (pause first) |
| `model DIR`, `raycast`, `karabiner` | One install step: the model from DIR, the Raycast extension, the Karabiner rule |
| `uninstall` | Remove the agent and the environment; data, model, launcher and Raycast extension stay |

`--folders-seed FILE` installs that register instead of the empty one when
none exists. `--no-raycast` and `--no-karabiner` skip those steps.

## How it runs

- **On demand.** launchd listens on `127.0.0.1:8765` and starts the service on
  the first connection, and once at login (`RunAtLoad`) so that what changed
  while it was stopped gets indexed. With `ingester.service.idle_exit_s` the
  service exits after that long with no request and nothing to ingest; the
  next request starts it again. While it is stopped nothing watches the
  folders, and the sweep at the next start finds what changed.
- **Lightly.** The agent is `ProcessType Standard` with low-priority I/O and
  `Nice 10`; `Background` holds the whole process tree to the efficiency
  cores. Conversion runs at most `processing.supervisor.workers` processes at
  once, on the performance cores (`background: false`), and each exits after
  a minute idle. The throttle pauses conversions on battery, while the load
  per core is above `max_load` and in low memory. The search client, with its
  embedding model, is closed after `ingester.service.search_idle_s` without a
  search, and the ingesting databases release their embedding models after as
  long without work.
- **Compact after indexing.** Once nothing has been queued or converting for
  `ingester.service.vacuum_after_indexing.quiet_s` (60 s) after at least
  `min_documents` (50) documents were indexed or removed, the service vacuums
  that database with `retention_seconds` (0): old versions and the files only
  they use are removed, which takes an index from gigabytes back to its live
  size. It waits for running searches and holds new ones back meanwhile.
  `min_documents: null` turns it off. The ordinary background vacuum after
  writes, with `storage.vacuum_retention_seconds`, runs as before.
- **Crashes** restart it (`KeepAlive` on an unsuccessful exit), at most every
  30 s.

The configuration is sized for a first full index (8 conversion processes and
8 queue workers); lower `processing.supervisor.workers` and
`ingester.workers.worker_count` for a lighter steady state.

## The embedding model

The service embeds with
[tolgaerdonmez/jina-embeddings-v5-omni-nano-coreml](https://huggingface.co/tolgaerdonmez/jina-embeddings-v5-omni-nano-coreml),
a Core ML conversion of `jinaai/jina-embeddings-v5-omni-nano-retrieval` with
one function per sequence length, 64 to 2048 tokens. Each text runs on the
shortest that fits it, so `processing.chunk_size: 1024` (counted with
`processing.chunking_tokenizer`) leaves room for the document prefix and a
tokenizer that counts more tokens. The installer downloads it; by hand,
download the repository's `model.mlpackage` and `tokenizer.json` into a
directory and run `scripts/macos-service.sh model DIR`.

**Licenses.** haiku.rag is MIT-licensed and only loads a Core ML model: it
contains no code that converts or modifies the jina model. The converted model
and the script that converts it live in that Hugging Face repository, under the
model's own license, CC BY-NC 4.0 by Jina AI: non-commercial use, with
attribution.

After changing `chunk_size`, re-chunk the index without converting documents
again:

```bash
scripts/macos-service.sh pause
scripts/macos-service.sh cli rebuild --rechunk
scripts/macos-service.sh resume
```

## Full Disk Access, once

Folders under `~/Documents`, `~/Desktop`, `~/Downloads` and iCloud Drive are
private: a process launchd starts cannot read them until the program
responsible for it has Full Disk Access. That program is the launcher, and the
service and its conversion processes inherit its access as its children.

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click **+**, press **Cmd+Shift+G**, paste
   `~/Library/Application Support/haiku.rag/service/bin/haiku-rag-service`, press
   Return, and click **Open**.
3. Turn on the switch next to **haiku-rag-service**.
4. Restart the service: `scripts/macos-service.sh restart`.

The grant names the launcher's code, so it survives upgrades of haiku.rag,
Python and the configuration, which the launcher only runs. A new launcher
changes its code signature, and the switch has to be turned off and on again
(or the entry removed and added); `install` says when that happened.

Without the grant, a folder under a private location fails discovery: its
sweep logs `Operation not permitted`, and `GET /folders` shows it with no
documents.

## Packaging

Another installer, such as a Nix module, uses the same files: run `build.sh
--out DIR --ingester PATH` and install `DIR`'s files at the paths above,
replacing the launcher only when `launcher.c.sha256` changes.
