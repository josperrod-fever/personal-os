#!/usr/bin/env python3
"""Condense a Claude Code transcript (.jsonl) into a compact, safe text segment.

Only text the user actually typed is labelled USER, because the capture gate trusts it:
  - user messages, including messages queued mid-turn (attachment queued_command, mode "prompt");
  - pasted text is kept but flagged as not necessarily written by the user.
Everything model- or tool-generated is dropped or labelled ASSISTANT:
  - tool results (web pages, emails, file contents...), shell output (`!` commands),
    compaction summaries and meta entries are dropped;
  - tool calls are kept as `name + target` only.
The transcript format is internal to Claude Code and may change between versions;
scripts/check.sh runs this against tests/fixtures/ to catch regressions.

Usage: condense.py <transcript.jsonl> <state.json>
Prints JSON: {"session", "from", "to", "user_msgs", "text"}
"""
import json, os, re, sys

MAX_MSG, MAX_TOTAL = 2000, 120_000
DROP = re.compile(
    r"<(system-reminder|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|task-notification)>.*?</\1>",
    re.S,
)
PASTED = re.compile(r"<pasted_content[^>]*>(.*?)</pasted_content[^>]*>", re.S)


def clean(text):
    text = DROP.sub("", text)
    text = PASTED.sub(lambda m: "[pasted by user, not necessarily written by them]\n" + m.group(1), text)
    return text.strip()


def tool_summary(b):
    i = b.get("input") or {}
    target = i.get("file_path") or i.get("path") or i.get("description") or i.get("url") or ""
    return f"[tool:{b.get('name')}] {str(target)[:160]}"


def texts(content, role):
    if isinstance(content, str):
        return [content]
    out = []
    for b in content or []:
        if b.get("type") == "text":
            out.append(b.get("text", ""))
        elif b.get("type") == "tool_use" and role == "ASSISTANT":
            out.append(tool_summary(b))
        # tool_result, image, thinking, …: dropped on purpose
    return out


def entry(d, after_compaction):
    """Return (role, [chunks]) or None if the entry must be ignored."""
    t = d.get("type")
    if d.get("isMeta") or d.get("isCompactSummary") or d.get("isVisibleInTranscriptOnly") or d.get("isSidechain"):
        return None
    origin = d.get("origin")
    if isinstance(origin, dict) and origin.get("kind") not in (None, "human"):
        return None  # peer sessions, automations…: not typed by the user
    if t == "attachment":
        a = d.get("attachment") or {}
        a_origin = a.get("origin")
        if isinstance(a_origin, dict) and a_origin.get("kind") not in (None, "human"):
            return None  # queued by a peer session or automation, not typed by the user
        if a.get("type") == "queued_command" and a.get("commandMode") == "prompt":
            return "USER", texts(a.get("prompt"), "USER")
        return None
    if t == "user":
        if after_compaction:  # the summary written by the model after a compaction
            return None
        return "USER", texts(d.get("message", {}).get("content"), "USER")
    if t == "assistant":
        return "ASSISTANT", texts(d.get("message", {}).get("content"), "ASSISTANT")
    return None


def main(path, state_path):
    session = os.path.splitext(os.path.basename(path))[0]
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    start = state.get("sessions", {}).get(session, 0)
    lines = open(path, encoding="utf-8").read().splitlines()
    parts, user_msgs, after_compaction = [], 0, False
    for line in lines[start:]:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "system" and d.get("subtype") == "compact_boundary":
            after_compaction = True
            continue
        got = entry(d, after_compaction)
        if d.get("type") in ("user", "assistant"):
            after_compaction = False
        if not got:
            continue
        role, chunks = got
        chunks = [c for c in (clean(c) for c in chunks) if c]
        if not chunks:
            continue
        if role == "USER":
            user_msgs += 1
        parts.append(f"## {role}\n" + "\n".join(c[:MAX_MSG] for c in chunks))
    text = "\n\n".join(parts)[-MAX_TOTAL:]
    print(json.dumps({"session": session, "from": start, "to": len(lines), "user_msgs": user_msgs, "text": text}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
