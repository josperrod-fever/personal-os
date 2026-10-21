#!/usr/bin/env bash
# Turn automatic capture on or off for this folder.
# Usage: scripts/auto-capture.sh on | off | status
#
# "on" adds PreCompact / SessionEnd / SessionStart hooks to .claude/settings.local.json
# (gitignored, so it never reaches the repo). Takes effect in the next Claude Code session
# opened in this folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/.claude/settings.local.json"
HOOK='"$CLAUDE_PROJECT_DIR"/scripts/capture-hook.sh'
command -v jq >/dev/null || { echo "jq is required (brew install jq / apt install jq)"; exit 1; }
mkdir -p "$ROOT/.claude"
[ -f "$FILE" ] || echo '{}' > "$FILE"

case "${1:-status}" in
  on)
    for dep in claude python3 git; do command -v "$dep" >/dev/null || echo "warning: '$dep' not found on PATH"; done
    if command -v claude >/dev/null; then
      help=$(claude --help 2>&1)
      for flag in --restricted --tools --permission-prompts --max-budget-usd --no-session-persistence; do
        grep -q -- "$flag" <<<"$help" || { echo "Your claude CLI lacks $flag (needed to sandbox the background agent). Update Claude Code, then retry."; exit 1; }
      done
    fi
    # The background agent runs with --strict-mcp-config, which Claude Code refuses when an
    # administrator deployed a managed MCP config (typical on company machines).
    for managed in "/Library/Application Support/ClaudeCode/managed-mcp.json" "/etc/claude-code/managed-mcp.json"; do
      if [ -f "$managed" ]; then
        echo "This machine has a managed MCP configuration ($managed)."
        echo "Auto-capture's sandbox can't start here; use /capture manually instead."
        exit 1
      fi
    done
    jq --arg cmd "$HOOK" '
      .hooks //= {} |
      reduce ("PreCompact","SessionEnd","SessionStart") as $e (.;
        .hooks[$e] = ([(.hooks[$e] // [])[] | select(any(.hooks[]?; .command == $cmd) | not)]
                      + [{hooks: [{type: "command", command: $cmd, timeout: 10}]}]))' \
      "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
    git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || echo "note: not a git repo — captures won't be committed (run 'git init' for an audit trail)"
    echo "Auto-capture ON. Open a new Claude Code session in this folder for it to take effect."
    ;;
  off)
    jq --arg cmd "$HOOK" '
      if .hooks then
        .hooks |= (with_entries(.value |= map(select(any(.hooks[]?; .command == $cmd) | not)))
                   | with_entries(select(.value | length > 0)))
        | if (.hooks | length) == 0 then del(.hooks) else . end
      else . end' "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
    echo "Auto-capture OFF (takes effect in the next session)."
    ;;
  status)
    if jq -e --arg cmd "$HOOK" '[.hooks[]?[]?.hooks[]?.command] | index($cmd)' "$FILE" >/dev/null; then
      echo "Auto-capture: ON"
    else
      echo "Auto-capture: OFF"
    fi
    last=$(grep -E '^- [0-9]{4}-' "$ROOT/memory/capture-log.md" 2>/dev/null | tail -1 || true)
    echo "Last capture: ${last:-none yet}"
    if [ -f "$ROOT/memory/.runs/worker.log" ]; then
      issue=$(grep -E 'FAILED|busy|missing dependency|recovered stale lock|[Ee]rror' "$ROOT/memory/.runs/worker.log" | tail -1 || true)
      gaveup=$(grep -E 'GAVE UP' "$ROOT/memory/capture-log.md" 2>/dev/null | tail -1 || true)
      [ -z "$gaveup" ] || echo "Last give-up: $gaveup"
      [ -z "$issue" ] || echo "Last worker issue: $issue"
    fi
    [ ! -d "$ROOT/memory/.runs/lock" ] || echo "A run is in progress (or was killed; it recovers automatically after 30 min)."
    ;;
  *) echo "usage: $0 on | off | status"; exit 1 ;;
esac
