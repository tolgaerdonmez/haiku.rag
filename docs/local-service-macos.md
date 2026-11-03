# Local search service on macOS

The [local search API](local-search-api.md) runs as a per-user launchd agent:
`haiku-ingester serve` watching the registered folders, started on demand, at
low priority. `scripts/macos-service.sh` installs it from a checkout, with the
Raycast extension (`clients/raycast`) and its Cmd+Shift+F hotkey. The files it
installs live in `service/macos/`:

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

## Install

```bash
scripts/macos-service.sh install --model-from DIR
```

`--model-from` names a converted model directory (see
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
- **Crashes** restart it (`KeepAlive` on an unsuccessful exit), at most every
  30 s.

The configuration is sized for a first full index (8 conversion processes and
8 queue workers); lower `processing.supervisor.workers` and
`ingester.workers.worker_count` for a lighter steady state.

## The embedding model

`examples/coreml/convert_jina_nano.py` converts
`jina-embeddings-v5-omni-nano-retrieval` into one function per sequence length,
64 to 2048 tokens. Each text runs on the shortest that fits it, so
`processing.chunk_size: 1024` (counted with `processing.chunking_tokenizer`)
leaves room for the document prefix and a tokenizer that counts more tokens.

```bash
uv run --with sentence-transformers python examples/coreml/convert_jina_nano.py \
  jinaai/jina-embeddings-v5-omni-nano-retrieval ./jina-nano-coreml
```

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
