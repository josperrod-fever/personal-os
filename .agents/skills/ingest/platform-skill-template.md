---
name: ingest-{{tool}}
description: >-
  Reads {{Tool}} for Personal OS ingestion sources with tool {{tool}} ({{kinds, e.g. channels,
  threads, people}}) and returns new items since each source's cursor. The ingest skill uses it
  as the {{Tool}} fetcher. Use directly when the user asks what's new in {{a Tool thing}} that is
  tracked in sources/{{tool}}.md, or wants to start following one.
---

# Ingest · {{Tool}} (platform fetcher)

Fetch half of ingestion for every source with `tool: {{tool}}`. **Never writes files.**
Follow the fetcher contract in `.agents/skills/ingest/SKILL.md`. If the user invoked this skill directly, hand over to the `ingest` skill (mode C to run, mode A to add a source), which calls back here for the reading.

## Your sources
The sources this skill serves, and how to process each one, are listed in `sources/{{tool}}.md`:
first the rules for every {{tool}} source, then one section per source with its own `process` instructions (which win on conflict).
The user adds or changes them there, or by asking ("follow … for …"); the `ingest` skill keeps that file up to date.

## Find the tools
<!-- Keywords for tool search ("<tool> search", "<tool> read …"), plus a CLI alternative if one exists (read commands only).
     Never hard-code one installation's internal tool ids: they differ between setups. -->

## Target kinds and how to resolve them (mode A)
<!-- One bullet per kind: what the user says → what goes in the source's `ref` line.
     e.g. "channel: name → search → channel id" · "person: name → user id" · "doc: URL or title → file id" · "query: store the query itself". -->

## Read (mode C)
<!-- Per kind: what to read since the cursor, oldest first. Lessons that apply to most tools:
     - Chat tools: new replies in older threads don't appear in channel history; re-read recent threads (e.g. last 14 days) whose latest reply is newer than the cursor.
     - Documents: when the modified time is newer than the cursor, report WHAT CHANGED (compare with the source's latest digest), plus new comments; never the whole document.
     - Repos / trackers: items opened, updated or closed since the cursor, oldest update first.
     - Meetings: use the notes or summary first; open the transcript only for decisions, owners and dates the notes leave vague.
     - Big containers (folders, spreadsheets): read only what the source's `process` list names, and respect `max_items`. -->

## Cursor
<!-- What the cursor stores (message ts, update time, modified time, meeting start) — always the LAST ITEM PROCESSED, so a capped run continues next time. -->

## Evidence
<!-- The permalink or "title + date + ≤20-word quote" format for each item. -->

## Noise, limits and privacy
<!-- What to skip (bots, joins, formatting-only edits, dependency bumps…), access caveats, rate limits.
     Never widen the scope beyond the source. Leave out personal details that aren't needed for the work. -->

## Objective events
<!-- Events that may move a linked task to Done under `trust: auto` because they are facts, not claims
     (e.g. "PR merged", "ticket closed", "doc I own marked final") — or "None: messages are claims". -->
