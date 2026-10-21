#!/usr/bin/env bash
# Hook entry point (PreCompact, SessionEnd, SessionStart). Reads the hook JSON on stdin,
# hands it to the worker in the background and returns immediately.
[ -n "${PERSONAL_OS_CAPTURE:-}" ] && exit 0   # never run inside the background capture itself
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/memory/.runs"
payload="$(cat)"
nohup "$ROOT/scripts/capture-worker.sh" "$payload" >> "$ROOT/memory/.runs/worker.log" 2>&1 &
exit 0
