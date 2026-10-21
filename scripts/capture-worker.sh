#!/usr/bin/env bash
# Distils new transcript segments into the Markdown memory, then commits the result.
set -uo pipefail
export PERSONAL_OS_CAPTURE=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
STATE="memory/.captured.json"
LOCK="memory/.runs/lock"
mkdir -p memory/.runs
if ! mkdir "$LOCK" 2>/dev/null; then
  # A lock older than 30 min means a run was killed (SIGKILL, reboot): recover instead of staying dead.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ] && rmdir "$LOCK" && mkdir "$LOCK"; then
    echo "$(date) recovered stale lock"
  else
    echo "$(date) busy, skipping"; exit 0
  fi
fi
trap 'rmdir "$LOCK"' EXIT

for bin in claude jq python3; do
  command -v "$bin" >/dev/null || { echo "$(date) missing dependency: $bin"; exit 0; }
done
mtime() { python3 -c 'import os,sys; print(int(os.path.getmtime(sys.argv[1])))' "$1"; }   # portable (macOS + Linux)

payload="${1:-}"; [ -n "$payload" ] || payload='{}'
event=$(jq -r '.hook_event_name // "manual"' <<<"$payload")
tp=$(jq -r '.transcript_path // empty' <<<"$payload")
sid=$(jq -r '.session_id // empty' <<<"$payload")
[ -f "$STATE" ] || echo "{\"installed_at\": $(date +%s), \"sessions\": {}}" > "$STATE"
installed_at=$(jq -r '.installed_at' "$STATE")

# Targets: the current transcript, or (SessionStart) a catch-up sweep of other sessions
# changed since installation that ended without SessionEnd.
targets=()
if [ "$event" = "SessionStart" ] && [ -n "$tp" ]; then
  for f in "$(dirname "$tp")"/*.jsonl; do
    [ -f "$f" ] || continue
    [ "$(basename "$f" .jsonl)" = "$sid" ] && continue
    [ "$(mtime "$f")" -gt "$installed_at" ] && targets+=("$f")
  done
elif [ -n "$tp" ]; then
  targets=("$tp")
fi

# The background agent may read only inside this folder and edit only memory, tasks and notes.
CHILD_SETTINGS='{"permissions":{"blockReadsOutsideWorkingDirectories":true,"deny":[
  "Edit(AGENTS.md)","Edit(CLAUDE.md)","Edit(README.md)","Edit(app/**)",
  "Edit(.claude/**)","Edit(.agents/**)","Edit(.github/**)",
  "Edit(scripts/**)","Edit(sources/**)","Edit(templates/**)","Edit(tests/**)",
  "Edit(memory/capture-log.md)","Edit(memory/ingest-log.md)","Edit(memory/.captured.json)"]}}'

advance() { jq --arg s "$1" --argjson n "$2" '.sessions[$s] = $n | del(.failures[$s])' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"; }
failures() { jq -r --arg s "$1" '.failures[$s] // 0' "$STATE"; }
count_failure() { jq --arg s "$1" '.failures[$s] = ((.failures[$s] // 0) + 1)' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"; }
logline() { echo "- $(date '+%Y-%m-%d %H:%M') · auto/$event · $1" >> memory/capture-log.md; }

for t in ${targets[@]+"${targets[@]}"}; do
  seg=$(python3 scripts/condense.py "$t" "$STATE") || continue
  s=$(jq -r .session <<<"$seg"); from=$(jq -r .from <<<"$seg"); to=$(jq -r .to <<<"$seg")
  [ "$to" -le "$from" ] && continue
  if [ "$(jq -r .user_msgs <<<"$seg")" -lt 2 ]; then
    advance "$s" "$to"; echo "$(date) ${s:0:8} lines $from-$to skipped (trivial)"; continue   # worker.log only: no commit
  fi
  result=$(jq -r .text <<<"$seg" | claude -p "$(cat scripts/capture-prompt.md)

Session id: $s. Today: $(date +%F)." \
    --model sonnet \
    --restricted \
    --tools "Read,Edit,Glob,Grep" \
    --permission-mode acceptEdits \
    --permission-prompts none \
    --max-budget-usd "${PERSONAL_OS_CAPTURE_BUDGET_USD:-0.50}" \
    --strict-mcp-config \
    --settings "$CHILD_SETTINGS" \
    --output-format json \
    --no-session-persistence 2>&1)
  rc=$?
  subtype=$(jq -r '.subtype // empty' <<<"$result" 2>/dev/null)
  summary=$(jq -r '.result // empty' <<<"$result" 2>/dev/null | grep -E '^CAPTURED:' | tail -1)
  if [ $rc -eq 0 ] && [ "$subtype" = "success" ]; then
    advance "$s" "$to"
    logline "${s:0:8} lines $from-$to · ${summary:-CAPTURED: ? (no summary line)}"
  elif [ "$subtype" = "error_max_budget_usd" ]; then
    # Only paid failures count: give up on the 3rd budget overrun instead of paying forever.
    if [ "$(failures "$s")" -ge 2 ]; then
      advance "$s" "$to"
      logline "${s:0:8} lines $from-$to · GAVE UP after 3 budget overruns (raise PERSONAL_OS_CAPTURE_BUDGET_USD or /capture by hand)"
    else
      count_failure "$s"
      logline "${s:0:8} lines $from-$to · BUDGET cap hit (retried next run)"
    fi
  else
    # Offline, expired login, …: free to retry, so no counting.
    logline "${s:0:8} lines $from-$to · FAILED rc=$rc ${subtype:-no result} (retried next run)"
    echo "$result" | tail -20
  fi
done

# Commit only the paths a capture may touch, so unrelated work in progress stays out.
PATHS=(); for p in memory tasks.md goals.md projects daily archive weekly; do [ -e "$p" ] && PATHS+=("$p"); done
if [ ${#PATHS[@]} -gt 0 ] && git rev-parse --git-dir >/dev/null 2>&1 && [ -n "$(git status --porcelain -- "${PATHS[@]}")" ]; then
  git add -- "${PATHS[@]}" && git commit -qm "memory: auto-capture ($event)" -- "${PATHS[@]}" && echo "$(date) committed"
fi
