# Changelog

Format: [Keep a Changelog](https://keepachangelog.com). Versions follow [SemVer](https://semver.org): a breaking change to the file formats in `AGENTS.md` or to the `.agents/` layer bumps the major version.

## [0.1.0] — 2026-10-21
### Added
- Agent-first Markdown work system: `tasks.md` board (columns = headings), goals, daily and weekly notes, projects, monthly archive.
- The app (`app/`): a live, dependency-free dashboard for non-technical users, with Today, Board (drag and drop), Goals and Projects, quick add and a task editor. It reads and writes your folder in the browser (File System Access API), redraws within ~2 s when the agent changes the files, never overwrites concurrent edits, and has a demo mode. Hosted on GitHub Pages or local via `scripts/app.py`.
- `AGENTS.md` spec and the platform-neutral `.agents/` layer (Agent Skills standard), with `.claude/skills` as a symlink (a junction on Windows via `scripts/setup.py`).
- `capture` skill: relevance-gated learning from conversations into `memory/` and project files.
- Ingestion: `ingest` coordinator and meta-skill that creates one platform skill per tool the user connects (`ingest-<tool>`, from a template, after confirmation; none ship). Sources live in one list per platform (`sources/<tool>.md`). Parallel read-only fetchers with a single writer, `review` / `auto` trust levels.
- Optional Claude Code auto-capture (`scripts/auto-capture.sh on`), off by default, sandboxed with `--restricted`, budget-capped.
- `scripts/check.sh` + CI on Linux and Windows: skill frontmatter, adapters, sources ↔ skills, transcript-condenser fixture, app model tests (byte-identical round trips), app CSP, no local state.
