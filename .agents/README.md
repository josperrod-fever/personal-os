# `.agents/` — the platform-neutral layer

Everything an AI agent needs to operate this Personal OS lives in two places that don't depend on any vendor:

| Path | Standard | What it holds |
|---|---|---|
| `AGENTS.md` (repo root) | [AGENTS.md](https://agents.md) convention | The spec: file formats, statuses, operations, memory and ingestion rules |
| `.agents/skills/<name>/SKILL.md` | [Agent Skills](https://agentskills.io) open standard | Reusable procedures: `capture`, the `ingest` coordinator, and one `ingest-<tool>` platform skill per tool (slack, github, drive, granola, …) |

**Rule: `.agents/` is the source of truth.** Platform folders (`.claude/`, `.cursor/`, `.gemini/`, …) only hold *adapters*: links or thin pointers to this layer, plus that platform's own runtime settings. Never edit a skill inside a platform folder.

## Skill rules (enforced by `scripts/check.sh` and CI)
- One folder per skill. The folder name equals the `name` in its frontmatter: lowercase letters, digits and hyphens, at most 64 characters.
- `SKILL.md` starts with YAML frontmatter that has `name` and `description` (≤ 1024 characters). Write long descriptions as a `>-` block: in a plain value, ` #word` starts a YAML comment and `: ` breaks the mapping, silently cutting the text (the check fails on both). The description says **what** the skill does and **when** to use it, in the user's words, because that's what triggers it.
- Supporting files sit next to `SKILL.md` and are referenced by relative path. Keep `SKILL.md` lean and move detail into references (progressive disclosure).
- Skills must work on any platform. Describe capabilities ("find the Slack tool by keyword"), not one vendor's tool names. Anything vendor-specific goes in a clearly labelled section.
- Ingestion skills are **per platform, never per source**. A channel, repo or doc is a section in the platform's list `sources/<tool>.md` (platform rules + per-source `process` instructions), read by `ingest-<tool>`. Platform skills only fetch (they must say "Never writes files.") and follow the fetcher contract in `ingest/SKILL.md`. New platforms start from `ingest/platform-skill-template.md`. The check fails on per-source skills and on sources whose tool has no platform skill.

## Platform adapters
| Platform | Reads `AGENTS.md` | Skills | Adapter in this repo |
|---|---|---|---|
| Claude Code | via `CLAUDE.md` (`@AGENTS.md` import) | `.claude/skills/` | `.claude/skills` → symlink to `.agents/skills` (a junction on Windows; `scripts/setup.py` creates or repairs it) |
| Codex CLI | natively | `.agents/skills/` | none needed |
| Cursor | natively | `.agents/skills/` | none needed |
| GitHub Copilot | natively | `.agents/skills/` | none needed |
| Antigravity | natively | `.agents/skills/` | none needed |
| Gemini CLI | `{"context": {"fileName": ["AGENTS.md"]}}` in `.gemini/settings.json` | `.agents/skills/` | settings line only |
| Any chat LLM (ChatGPT, Gemini app…) | paste or attach `AGENTS.md` | paste the relevant `SKILL.md` | none |

Every agent except Claude Code (which imports them via `CLAUDE.md`) is told by `AGENTS.md` to read `memory/me.md` and `memory/playbook.md` itself at session start, Gemini CLI included.

> Support differs between tool versions. If a platform doesn't pick up `.agents/skills`, add a link from its own skills folder (as done for Claude Code) instead of copying the files.

## Platform-specific features (optional)
- **Automatic capture** uses Claude Code hooks and the `claude` CLI. It's off by default and is turned on per machine with `scripts/auto-capture.sh on`, which writes to the gitignored `.claude/settings.local.json`.
- **Scheduled ingestion** uses the scheduler of whichever app runs it. Sources store only the schedule; the scheduler is set up by the `ingest` skill once the user confirms.

## Changing this layer
1. Edit only files under `.agents/` (or `AGENTS.md`).
2. Run `scripts/check.sh`.
3. Commit with a message starting with `agents:` so the history of the standard is easy to follow.
