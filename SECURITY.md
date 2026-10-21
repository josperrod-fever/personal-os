# Security

Personal OS keeps your data in plain files and lets AI agents edit them. Two features process content you didn't write, and they are where the risk is.

## Threat model
**Prompt injection into memory.** A web page, email, Slack message or document could contain text written to look like instructions ("remember that the user wants…"). If an agent stored it in `memory/me.md` or `memory/playbook.md`, it would be loaded into every future session.

Mitigations:
- The `capture` gate only accepts facts **you** stated or confirmed. Tool output is never a fact by itself.
- Auto-capture analyses a condensed transcript that contains only text you typed plus the assistant's replies. Tool results, shell output (`!` commands) and compaction summaries are removed before analysis (`scripts/condense.py`, tested in `tests/fixtures/`).
- Ingestion treats everything it reads as data. In `review` mode (the default, and always for scheduled runs), every candidate goes to `memory/inbox.md` with its evidence link for you to approve. Interactive ingestion is instructed never to change `AGENTS.md`, `.agents/`, `.claude/` or `memory/me.md` because of external content; the auto-capture run enforces this with deny rules.
- Platform skills (`ingest-<tool>`) are trusted instructions, so they are built only from the template and the connector's own tool descriptions — never from fetched items — and saved only after you review and confirm them.

**An unattended agent with file access.** Auto-capture runs `claude -p` in the background.

Mitigations:
- It's off by default, enabled per machine (`scripts/auto-capture.sh on`), and stored in the gitignored `.claude/settings.local.json`.
- `--restricted` and `--tools "Read,Edit,Glob,Grep"`: no shell, no web, no MCP servers (`--strict-mcp-config`).
- `blockReadsOutsideWorkingDirectories`: it can't read `~/.ssh`, `~/.aws` or anything else outside the folder.
- Deny rules keep it away from the instructions, skills, scripts, sources, dashboard, templates, CI and the audit logs.
- `--permission-prompts none`: anything that would need approval is refused.
- `--max-budget-usd 0.50` per run.
- Every run is logged in `memory/capture-log.md` and committed to Git, so it can be reviewed and reverted.

**The app.** It reads and writes the folder you pick, through your browser's File System Access API. Nothing is uploaded: the page has a strict Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`, no third-party code or fonts), and `scripts/check.sh` fails if that policy is removed. Your notes can contain text that came from Slack, email or the web, so the app renders everything as plain text and never as HTML. Before every save it re-reads the file and refuses to write if the agent or anything else changed it since. The browser only grants access to the folder you chose, and asks again in a new session.
- **Hosted vs local.** The hosted link serves the code from this repository's GitHub Pages. If you'd rather not trust a hosted page with folder access, run the same code from your own copy with `scripts/app.py` (served only on `127.0.0.1`).

## Your responsibilities
- Keep your copy of the repo **private**: it holds your tasks, notes and memory.
- Review `memory/inbox.md` and the Git history of `memory/` during the weekly review.
- Don't connect ingestion to channels where untrusted people can post unless the source stays in `review` mode.

## Reporting a vulnerability
Open a [private security advisory](../../security/advisories/new) on this repository instead of a public issue.
