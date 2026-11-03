#!/bin/sh
# Build the launcher and render the launchd agent into OUT, installing nothing.
#
#   service/macos/build.sh --out DIR --ingester PATH --config PATH [--port N]
#
# OUT receives bin/haiku-rag-service (the program to grant Full Disk Access)
# and com.haiku-rag.service.plist (for ~/Library/LaunchAgents).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out="${HOME}/Library/Application Support/haiku.rag/service"
ingester=$(command -v haiku-ingester || true)
config="${HOME}/Library/Application Support/haiku.rag/haiku.rag.yaml"
port=8765

while [ $# -gt 0 ]; do
    case "$1" in
        --out) out=$2; shift 2 ;;
        --ingester) ingester=$2; shift 2 ;;
        --config) config=$2; shift 2 ;;
        --port) port=$2; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 64 ;;
    esac
done
[ -n "$ingester" ] || { echo "haiku-ingester not found; pass --ingester" >&2; exit 64; }

mkdir -p "$out/bin"
cc -O2 -Wall -o "$out/bin/haiku-rag-service" "$here/launcher.c"

escape() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
sed -e "s|@LAUNCHER@|$(escape "$out/bin/haiku-rag-service")|g" \
    -e "s|@INGESTER@|$(escape "$ingester")|g" \
    -e "s|@CONFIG@|$(escape "$config")|g" \
    -e "s|@PORT@|$port|g" \
    -e "s|@STATE_DIR@|$(escape "$out")|g" \
    "$here/com.haiku-rag.service.plist.in" > "$out/com.haiku-rag.service.plist"
plutil -lint "$out/com.haiku-rag.service.plist" >/dev/null

echo "Launcher: $out/bin/haiku-rag-service"
echo "Agent:    $out/com.haiku-rag.service.plist"
