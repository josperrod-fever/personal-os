# Personal OS

Run your work by **talking to your AI agent**. Everything lives in **plain Markdown files** on your computer, and a **live app** shows you where things stand at a glance.

| | Role |
|---|---|
| **Your agent** (Claude, Codex, Cursor, Gemini, Copilot…) | Where you work. You say "capture: call the bank", "plan the day", "I sent the report", "follow #launch for blockers", and the agent updates your files. |
| **The files** | The single source of truth: goals, a task board, daily notes, projects, memory. Readable without any tool and easy to version with Git. |
| **The app** | Your live dashboard. Today, Board, Goals and Projects update within a couple of seconds whenever the agent changes something. You can also drag, tick and edit there. |

- **Any agent can operate it.** The rules live in [`AGENTS.md`](AGENTS.md) and the procedures in [`.agents/skills/`](.agents/skills) (the open [Agent Skills](https://agentskills.io) standard).
- **It learns, selectively.** A strict filter keeps only durable facts you confirmed from your conversations (`/capture`).
- **It ingests on demand.** Ask it to follow a Slack channel, a repo, a document or your meeting notes, and it turns what matters into tasks and project context (`ingest`).
- **No lock-in, nothing uploaded.** No database, no server, no account. The app reads and writes the folder you choose, inside your browser.

## Quickstart (about 10 minutes)

1. **Get your own copy** (it will hold your real tasks, so keep it private):
   - with GitHub: **Use this template** → private repo → clone it;
   - without GitHub: **Code → Download ZIP** and unzip it somewhere like `Documents/Personal OS`.
2. **Connect your agent** to that folder:
   - **Claude Code** (terminal or the desktop app): run once `python3 scripts/setup.py` (Windows: `py scripts\setup.py`), which links the skills, then open the folder.
   - **Codex, Cursor, GitHub Copilot, Antigravity**: open the folder; they read `AGENTS.md` and the skills directly.
   - **A chat LLM** without file access: attach `AGENTS.md`, `tasks.md` and `goals.md`.
3. **Make it yours.** Tell the agent: *"Read AGENTS.md, then interview me to replace the example goals, projects and tasks with mine."*
4. **Open the app**, at **[josperrod9.github.io/personal-os/app](https://josperrod9.github.io/personal-os/app/)**, in Chrome, Edge, Brave or Arc on a computer. Click **Open my Personal OS folder**, pick your folder, and allow access. Next time it remembers the folder.
   - Want to look first? **[Try the demo](https://josperrod9.github.io/personal-os/app/?demo)**: example data, nothing saved.
   - Prefer not to use a hosted page? Run it from your copy with `python3 scripts/app.py` (Windows: `py scripts\app.py`). It's the same app, served only to your computer.

## The app
- **Today**: what you're on, what's next (by priority and date), what's due this week, what you finished today.
- **Board**: Inbox → Next → Doing → Waiting → Done. Drag cards between columns. Ticking a card or dropping it in Done records the completion date for you.
- **Goals**: a progress bar per goal, counted from the tasks linked to it.
- **Projects**: each project with its open tasks.
- **Quick add and a task editor** with plain controls (status, priority, due date, project, goal, estimate, who you're waiting on), so you never type the file syntax.
- **Live**: the sidebar shows "Live · updates as your agent works". The app checks the files every 1.5 seconds and redraws when something changed. It waits while you're typing or editing, and it never overwrites a change the agent made in the meantime.

Requirements: a Chromium browser (Chrome, Edge, Brave, Arc) on macOS, Windows or Linux. Safari and Firefox can't open local folders, so they can only show the demo.

## Daily loop
| When | Tell your agent | What you'll see in the app |
|---|---|---|
| Anytime | "capture: call the bank about the card" | A new card in Inbox |
| Morning | "plan the day" | Your top 3 in Doing and Up next; a note for today in `daily/` |
| While working | "sent the report" / "blocked on legal" | The card moves to Done / Waiting |
| End of a work session | `/capture` | Learnings saved to the project and `memory/` |
| Evening | "shut down the day" | Done today filled in, tomorrow's Next proposed |
| Weekly | "weekly review" | Goals progress updated, Inbox cleared, `weekly/<week>.md` written |

## Ingesting from your tools
Describe what to follow and the `ingest` skill sets it up:

> "Follow #launch-war-room for decisions and blockers on the launch project, every weekday at 9."

It finds the target, shows a preview of what it would keep, and adds the source to the list for that platform (`sources/slack.md`, `sources/github.md`…). Each list starts with rules for the whole platform, then one section per source with its own instructions, for example *"#channel-a: only decisions and blockers"* and *"#channel-b: take everything into account"*. Sources are read in parallel, only from where the last run stopped. By default everything found goes to `memory/inbox.md` for you to approve.

**No platform skills ship with the template**: you build the set that matches your tools. The first time you follow something in a tool (Slack, GitHub, Google Drive, Notion, Jira, Gmail, meeting notes, a web page, a folder of exports…), `ingest` drafts an `ingest-<tool>` skill from [a template](.agents/skills/ingest/platform-skill-template.md) and saves it after you confirm. The tool needs a connector or MCP server in your agent (web pages and local folders don't).

## Optional: automatic capture (Claude Code, macOS and Linux)
Off by default. When on, a background Claude runs the same relevance filter whenever a chat is compacted, when it ends, and as a catch-up at the next start:

```bash
scripts/auto-capture.sh on
```

- **Requires**: `claude`, `jq`, `python3` and `git` (for the audit trail). Not yet on Windows (the hooks are bash scripts), where `/capture` works the same by hand. Not available on machines with an administrator-managed MCP configuration (`managed-mcp.json`, common on company laptops); `on` detects it.
- **Safeguards**: only text you typed counts as yours; tool output, shell output and compaction summaries are stripped first. The background agent runs restricted: it can't read outside the folder, run commands or reach the network, and it can only edit memory, tasks and notes. Every run is logged in `memory/capture-log.md` and committed to Git. See [SECURITY.md](SECURITY.md).
- **Cost**: at most 2 short model calls per long conversation, each capped at $0.50 (`PERSONAL_OS_CAPTURE_BUDGET_USD`). After 3 budget overruns on the same conversation it gives up instead of retrying forever.
- **Health**: `scripts/auto-capture.sh status`. Turn it off with `scripts/auto-capture.sh off`.

## Structure
```
AGENTS.md            The spec, read by every agent
CLAUDE.md            Claude Code entry: imports AGENTS.md + memory
goals.md             Up to 3 goals with key results
tasks.md             The board — each ## heading is a column (Inbox → Next → Doing → Waiting → Done)
daily/  weekly/  projects/  archive/  templates/
memory/              me.md · playbook.md (loaded every session) · inbox.md · logs
sources/             One source list per platform (created when you add the first source) + _template.md
app/                 The live app (static HTML/CSS/JS, no dependencies, no build step)
.agents/             Platform-neutral layer — skills (see .agents/README.md)
.claude/             Claude Code adapter (skills → symlink to .agents/skills)
scripts/             setup.py · app.py · check.sh · auto-capture.sh · capture worker
```

A task is one line of GitHub-flavoured Markdown. The agent and the app write it for you:
```markdown
- [ ] Prepare the adoption report #p1 #proj/launch [goal:: G1] [est:: 2h] [due:: 2026-10-24]
```

## Other platforms
- **Gemini CLI**: add `{"context": {"fileName": ["AGENTS.md"]}}` to `.gemini/settings.json`. Skills load from `.agents/skills/`.
- **If a tool doesn't find the skills**: link its skills folder to `.agents/skills` (e.g. `ln -s ../.agents/skills .cursor/skills`). Don't copy them.
- **Windows**: everything except auto-capture works. `py scripts\setup.py` repairs the skills link that Git for Windows checks out as a plain file. Run `scripts/check.sh` from Git Bash.
- **Phone**: the app needs a computer. From your phone, tell your agent (if it has access to the folder), or edit `tasks.md` in your private repo with the GitHub app and add `- [ ] …` under `## Inbox`.

## Contributing
Change skills only under `.agents/`, keep the app dependency-free, and run `scripts/check.sh` (it also runs the app's tests with Node; CI runs everything on Linux and Windows). See [`.agents/README.md`](.agents/README.md).

## Security
Read [SECURITY.md](SECURITY.md), especially before turning on auto-capture or ingesting shared channels.

## License
[MIT](LICENSE)
