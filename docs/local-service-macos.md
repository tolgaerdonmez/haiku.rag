# Local search service on macOS

The [local search API](local-search-api.md) runs as a per-user launchd agent:
`haiku-ingester serve` watching the registered folders, started on demand, at
background priority. The files live in `service/macos/`:

| File | What it is |
|---|---|
| `launcher.c` | The program launchd runs. It holds the Full Disk Access grant, hands launchd's socket to the service and runs it as its child. |
| `com.haiku-rag.service.plist.in` | The launchd agent, with `@LAUNCHER@`, `@INGESTER@`, `@CONFIG@`, `@PORT@` and `@STATE_DIR@` to fill in. |
| `haiku.rag.yaml.example` | A service configuration: supervised conversion with Apple Vision OCR, the folder register, the throttle and the idle exit. |
| `build.sh` | Compiles the launcher and renders the agent into a directory. It installs nothing. |

## How it runs

- **On demand.** launchd listens on `127.0.0.1:8765` and starts the service on
  the first connection, and once at login (`RunAtLoad`) so that what changed
  while it was stopped gets indexed. With `ingester.service.idle_exit_s` the
  service exits after that long with no request and nothing to ingest; the
  next request starts it again. While it is stopped nothing watches the
  folders, and the sweep at the next start finds what changed.
- **Lightly.** The agent is `ProcessType Background` with low-priority I/O and
  `Nice 10`. Conversion processes run niced in macOS's background band, at
  most `processing.supervisor.workers` at once, and exit after a minute idle.
  The throttle holds conversions to one at a time on battery and pauses them
  under load or low memory. The search client, with its embedding model, is
  closed after `ingester.service.search_idle_s` without a search, and the
  ingesting databases release their embedding models after as long without
  work.
- **Crashes** restart it (`KeepAlive` on an unsuccessful exit), at most every
  30 s.

## Build

```bash
service/macos/build.sh \
  --out "$HOME/Library/Application Support/haiku.rag/service" \
  --ingester "$(command -v haiku-ingester)" \
  --config "$HOME/Library/Application Support/haiku.rag/haiku.rag.yaml"
```

This writes `bin/haiku-rag-service` (the launcher) and
`com.haiku-rag.service.plist` into the `--out` directory. The configuration's
directory also holds the folder register (`folders.yaml`).

## Install

```bash
cp "$HOME/Library/Application Support/haiku.rag/service/com.haiku-rag.service.plist" \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.haiku-rag.service.plist
```

`launchctl bootout gui/$(id -u)/com.haiku-rag.service` stops and unloads it;
`launchctl kickstart -k gui/$(id -u)/com.haiku-rag.service` restarts it. The
log is `service.log` in the `--out` directory.

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
4. Restart the service:
   `launchctl kickstart -k gui/$(id -u)/com.haiku-rag.service`.

The grant names the launcher's code, so it survives upgrades of haiku.rag,
Python and the configuration, which the launcher only runs. Rebuilding the
launcher changes its code signature, and the switch has to be turned off and
on again (or the entry removed and added).

Without the grant, a folder under a private location fails discovery: its
sweep logs `Operation not permitted`, and `GET /folders` shows it with no
documents.
