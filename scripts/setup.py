#!/usr/bin/env python3
"""One-time setup for agents, on macOS, Linux or Windows. Standard library only; safe to re-run.

  python3 scripts/setup.py          # macOS / Linux
  py scripts\\setup.py               # Windows

Links .claude/skills -> .agents/skills so Claude Code finds the skills (a symlink; on Windows a
directory junction, no admin needed). Git on Windows often checks the link out as a plain text
file, which this repairs. Other agents read .agents/skills directly and need nothing.

To open the app on this computer instead of the hosted link: python3 scripts/app.py
"""
import os, pathlib, platform, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WINDOWS = platform.system() == "Windows"


def _is_junction(p):
    try:
        return bool(os.path.isjunction(p))  # Python 3.12+
    except AttributeError:
        return p.resolve() != p.absolute()


def link_skills():
    link, target = ROOT / ".claude" / "skills", ROOT / ".agents" / "skills"
    link.parent.mkdir(exist_ok=True)
    if (link.is_symlink() or (WINDOWS and link.is_dir() and _is_junction(link))) and link.resolve() == target.resolve():
        print("✓ .claude/skills → .agents/skills")
        return
    if link.is_file():  # Windows checkout without symlink support: a text file holding the link target
        link.unlink()
    elif link.exists():
        sys.exit(f"✗ {link} exists and is not a link. Move it away; skills belong in .agents/skills.")
    try:
        os.symlink(pathlib.Path("..") / ".agents" / "skills", link, target_is_directory=True)
    except OSError:
        if not WINDOWS:
            raise
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
    print("✓ linked .claude/skills → .agents/skills")


if __name__ == "__main__":
    link_skills()
    print("\nNext: open the app (README → Quickstart), and/or run your agent here and say:")
    print('  "Read AGENTS.md, then interview me to set up my goals and tasks."')
