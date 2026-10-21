#!/usr/bin/env bash
# Validates the platform-neutral layer and the scripts. Used locally and in CI.
# Usage: scripts/check.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
err() { echo "✗ $*"; fail=1; }
ok()  { echo "✓ $*"; }

# 1. Agent Skills: frontmatter parses as YAML; name == folder; description present and <= 1024 chars.
python3 - <<'PY' || fail=1
import pathlib, re, sys
try:
    import yaml
except ImportError:
    yaml = None

def parse(fm):
    for key in ("name", "description"):  # always: YAML silently cuts plain scalars at " #"
        m = re.search(rf"^{key}:[ \t]*(.*)$", fm, re.M)
        val = m.group(1).strip() if m else ""
        if val and not val.startswith(("'", '"', ">", "|")) and (" #" in val or ": " in val):
            raise ValueError(f"unquoted {key} contains ' #' or ': ' (YAML would truncate it); use a '>-' block")
    if yaml:
        return yaml.safe_load(fm) or {}
    # Fallback without PyYAML: flag plain scalars that YAML would cut (" #" starts a comment, ": " breaks mappings).
    data = {}
    for key in ("name", "description"):
        m = re.search(rf"^{key}:[ \t]*(.*)$", fm, re.M)
        if not m:
            continue
        val = m.group(1).strip()
        if val in (">-", ">", "|", "|-"):
            block = re.search(rf"^{key}:[ \t]*[>|]-?\n((?:[ \t]+.*\n?)+)", fm, re.M)
            val = " ".join(l.strip() for l in block.group(1).splitlines()) if block else ""
        elif not val.startswith(("'", '"')) and (" #" in val or ": " in val):
            raise ValueError(f"unquoted {key} contains ' #' or ': ' (YAML would truncate it); use a '>-' block")
        data[key] = val.strip("'\"")
    return data

bad = 0
for skill in sorted(pathlib.Path(".agents/skills").glob("*/SKILL.md")):
    folder, problems = skill.parent.name, []
    m = re.match(r"^---\n(.*?)\n---\n", skill.read_text(encoding="utf-8"), re.S)
    if not m:
        problems.append("missing YAML frontmatter")
    else:
        try:
            fm = parse(m.group(1))
        except Exception as e:
            fm, problems = {}, [f"frontmatter: {e}"]
        name, desc = str(fm.get("name", "")).strip(), str(fm.get("description", "")).strip()
        if name != folder:
            problems.append(f"name '{name}' must equal folder name '{folder}'")
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", folder) or len(folder) > 64:
            problems.append("invalid skill name")
        if not desc:
            problems.append("missing description")
        elif len(desc) > 1024:
            problems.append("description longer than 1024 characters")
    for p in problems:
        print(f"✗ {skill}: {p}")
    if problems:
        bad = 1
    else:
        print(f"✓ skill {folder}")
if not yaml:
    print("  (PyYAML not installed: used the fallback frontmatter check)")
sys.exit(bad)
PY

# 2. Platform adapters point at .agents (never hold their own copy). Windows: a junction is fine.
if [ -L .claude/skills ] && [ "$(readlink .claude/skills)" = "../.agents/skills" ]; then
  ok ".claude/skills → .agents/skills"
elif [ -d .claude/skills ] && [ "$(cd .claude/skills && pwd -P)" = "$(cd .agents/skills && pwd -P)" ]; then
  ok ".claude/skills → .agents/skills (junction)"
else
  err ".claude/skills must link to .agents/skills — run: python3 scripts/setup.py --skills-only (Windows: py scripts\\setup.py --skills-only)"
fi

# 3. Sources: one list per platform (sources/<tool>.md) read by .agents/skills/ingest-<tool>/.
#    Unique source ids, a tool in every list, no per-source skills, platform skills only fetch.
python3 - <<'PY' || fail=1
import pathlib, re, sys
bad, ids = 0, {}
for f in sorted(pathlib.Path("sources").glob("*.md")):
    if f.name.startswith("_"):
        continue
    text = f.read_text(encoding="utf-8")
    m = re.search(r"^tool:\s*([a-z0-9-]+)", text, re.M)
    if not m:
        print(f"✗ {f}: frontmatter needs 'tool: <name>'"); bad = 1; continue
    tool = m.group(1)
    if f.stem != tool:
        print(f"✗ {f}: file must be named sources/{tool}.md"); bad = 1
    if not pathlib.Path(f".agents/skills/ingest-{tool}/SKILL.md").exists():
        print(f"✗ {f}: no platform skill .agents/skills/ingest-{tool}/"); bad = 1
    body = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    if re.search(r"^## <", body, re.M) or re.search(r"^tool:\s*<", text, re.M):
        print(f"✗ {f}: still contains template placeholders ('## <…>' or 'tool: <…>')"); bad = 1
    for sid in re.findall(r"^- id:\s*([a-z0-9-]+)", body, re.M):
        if sid in ids:
            print(f"✗ source id '{sid}' in {f} already used in {ids[sid]}"); bad = 1
        ids[sid] = f
        if pathlib.Path(f".agents/skills/ingest-{sid}").exists() and sid != tool:
            print(f"✗ per-source skill .agents/skills/ingest-{sid}: sources are sections of {f}, not skills"); bad = 1
for sk in sorted(pathlib.Path(".agents/skills").glob("ingest-*/SKILL.md")):
    if "Never writes files" not in sk.read_text(encoding="utf-8"):
        print(f"✗ {sk.parent}: not a platform fetcher (missing 'Never writes files.')"); bad = 1
print(f"✓ sources: {len(ids)} across {len(list(pathlib.Path('sources').glob('[!_]*.md')))} platform list(s)") if not bad else None
sys.exit(bad)
PY

# 4. Scripts parse.
for s in scripts/*.sh; do bash -n "$s" || err "syntax error in $s"; done
for py in scripts/condense.py scripts/setup.py scripts/app.py; do
  python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$py" || err "$py does not parse"
done
ok "scripts parse"

# 5. Transcript condenser still behaves (Claude Code's transcript format is internal and can change).
if diff -u tests/fixtures/transcript.expected.txt \
     <(python3 scripts/condense.py tests/fixtures/transcript.jsonl /nonexistent | jq -r '"user_msgs=\(.user_msgs) to=\(.to)\n\(.text)"') >/dev/null; then
  ok "condense.py matches fixture"
else
  err "condense.py output differs from tests/fixtures/transcript.expected.txt"
fi

# 6. The app: model tests (byte-identical round trips), demo files present, strict CSP kept.
if command -v node >/dev/null; then
  if node --test tests/app.test.mjs >/dev/null 2>&1; then ok "app model tests"; else err "app model tests fail — run: node --test tests/app.test.mjs"; fi
else
  echo "  (node not installed: skipped the app model tests; CI runs them)"
fi
python3 - <<'PY' || fail=1
import json, pathlib, sys
missing = [p for p in json.loads(pathlib.Path("app/demo-files.json").read_text()) if not pathlib.Path(p).exists()]
html = pathlib.Path("app/index.html").read_text(encoding="utf-8")
bad = 0
if missing:
    print(f"✗ app/demo-files.json lists missing files: {missing}"); bad = 1
if "Content-Security-Policy" not in html or "script-src 'self'" not in html or "connect-src 'self'" not in html:
    print("✗ app/index.html must keep its strict Content-Security-Policy (no remote code, no network)"); bad = 1
if not bad:
    print("✓ app files and CSP")
sys.exit(bad)
PY

# 7. No machine-local state committed.
if git rev-parse --git-dir >/dev/null 2>&1; then
  for p in .claude/settings.local.json memory/.captured.json private; do
    git ls-files --error-unmatch "$p" >/dev/null 2>&1 && err "$p must not be committed"
  done
fi

[ $fail -eq 0 ] && echo "All checks passed." || { echo "Checks failed."; exit 1; }
