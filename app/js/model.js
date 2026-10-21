// Personal OS — Markdown model. Pure functions, no DOM: used by the app and by tests/app.test.mjs.
// Every operation edits lines in place and leaves everything else in the file byte-identical
// (frontmatter, notes, subtasks, unknown lines).

const TASK_RE = /^(\s*)- \[( |x|X)\] ?(.*)$/;
const FIELD_RE = /\[([A-Za-z_]+)::\s*([^\]]*?)\s*\]/g;
const TAG_RE = /(^|\s)#([A-Za-z0-9_\/-]+)/g;
// Date fields always go last on a task line (AGENTS.md "Field order").
export const TASKS_FIELDS = ["start", "scheduled", "due", "repeat", "completion"];

export function splitLines(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}

export function parseTaskLine(line) {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const [, indent, box, rest] = m;
  const fields = {};
  for (const f of rest.matchAll(FIELD_RE)) fields[f[1].toLowerCase()] = f[2];
  const tags = [];
  for (const t of rest.replace(FIELD_RE, " ").matchAll(TAG_RE)) tags.push(t[2]);
  const title = rest.replace(FIELD_RE, " ").replace(TAG_RE, " ").replace(/\s+/g, " ").trim();
  const priority = (tags.find((t) => /^p[123]$/i.test(t)) || "").toLowerCase() || null;
  const project = (tags.find((t) => t.toLowerCase().startsWith("proj/")) || "").slice(5) || null;
  return {
    indent: indent.length,
    done: box !== " ",
    title,
    tags,
    otherTags: tags.filter((t) => !/^p[123]$/i.test(t) && !t.toLowerCase().startsWith("proj/")),
    priority,
    project,
    fields,
  };
}

export function formatTaskLine(t) {
  const parts = [`${" ".repeat(t.indent || 0)}- [${t.done ? "x" : " "}] ${t.title.trim()}`];
  if (t.priority) parts.push(`#${t.priority}`);
  if (t.project) parts.push(`#proj/${t.project}`);
  for (const tag of t.otherTags || []) parts.push(`#${tag}`);
  const keys = Object.keys(t.fields || {}).filter((k) => t.fields[k] !== "" && t.fields[k] != null);
  for (const k of keys.filter((k) => !TASKS_FIELDS.includes(k))) parts.push(`[${k}:: ${t.fields[k]}]`);
  for (const k of TASKS_FIELDS) if (keys.includes(k)) parts.push(`[${k}:: ${t.fields[k]}]`);
  return parts.join(" ");
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// The lines a task owns: itself plus following lines indented deeper (subtasks, notes).
function blockEnd(lines, start) {
  const base = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "" && indentOf(lines[end]) > base) end++;
  return end;
}

export function parseBoard(text) {
  const { lines, eol } = splitLines(text);
  const lanes = [];
  let lane = null;
  let inFrontmatter = lines[0] === "---";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFrontmatter) {
      if (i > 0 && line === "---") inFrontmatter = false;
      continue;
    }
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      if (lane) lane.end = i;
      const wip = /\((\d+)\)\s*$/.exec(h[1]);
      lane = { name: h[1].replace(/\s*\(\d+\)\s*$/, ""), heading: h[1], wip: wip ? +wip[1] : null, line: i, end: lines.length, tasks: [] };
      lanes.push(lane);
      continue;
    }
    if (!lane) continue;
    const t = parseTaskLine(line);
    if (t && t.indent === 0) {
      const end = blockEnd(lines, i);
      const subtasks = [];
      for (let j = i + 1; j < end; j++) {
        const s = parseTaskLine(lines[j]);
        if (s) subtasks.push({ ...s, line: j });
      }
      lane.tasks.push({ ...t, line: i, end, raw: line, lane: lane.name, subtasks });
      i = end - 1;
    }
  }
  return { lines, eol, lanes };
}

export function allTasks(board) {
  return board.lanes.flatMap((l) => l.tasks);
}

// Find a task again after a re-read: same raw line, preferably in the same lane.
export function findTask(board, raw, laneName) {
  const tasks = allTasks(board);
  return tasks.find((t) => t.raw === raw && t.lane === laneName) || tasks.find((t) => t.raw === raw) || null;
}

function laneByName(board, name) {
  const want = name.toLowerCase();
  return board.lanes.find((l) => l.name.toLowerCase() === want);
}

// Where a new block goes in a lane: after the last task block; in an empty lane, after the heading
// and the blank line under it.
function insertionPoint(board, lane, beforeTask) {
  if (beforeTask) return beforeTask.line;
  if (lane.tasks.length) return lane.tasks[lane.tasks.length - 1].end;
  const next = board.lines[lane.line + 1];
  return next !== undefined && next.trim() === "" ? lane.line + 2 : lane.line + 1;
}

function join(lines, eol) {
  return lines.join(eol);
}

// Minimal edit for ticking: flip the box and add/remove [completion::], keep the rest of the line as typed.
export function retick(line, done, today) {
  if (done) {
    const out = line.replace(/^(\s*- )\[ \]/, "$1[x]");
    return /\[completion::/i.test(out) ? out : `${out.replace(/\s+$/, "")} [completion:: ${today}]`;
  }
  return line.replace(/^(\s*- )\[[xX]\]/, "$1[ ]").replace(/\s*\[completion::[^\]]*\]/i, "");
}

export function setDone(task, done, today) {
  const t = { ...task, fields: { ...task.fields }, done };
  if (done) t.fields.completion = t.fields.completion || today;
  else delete t.fields.completion;
  return t;
}

// Move a task (with its block) to another lane, optionally before another task.
// Moving into Done ticks it and stamps [completion::]; moving out of Done unticks it.
export function moveTask(text, raw, fromLane, toLaneName, today, beforeRaw = null) {
  const board = parseBoard(text);
  const task = findTask(board, raw, fromLane);
  const to = laneByName(board, toLaneName);
  if (!task || !to) return null;
  const block = board.lines.slice(task.line, task.end);
  const isDone = to.name.toLowerCase() === "done";
  if (isDone && (!task.done || !task.fields.completion)) block[0] = retick(block[0], true, today);
  if (!isDone && task.done) block[0] = retick(block[0], false, today);
  const lines = board.lines.slice();
  lines.splice(task.line, task.end - task.line);
  const after = parseBoard(join(lines, board.eol));
  const target = laneByName(after, to.name);
  const before = beforeRaw ? findTask(after, beforeRaw, to.name) : null;
  const at = insertionPoint(after, target, before && before.lane === target.name ? before : null);
  const out = after.lines.slice();
  out.splice(at, 0, ...block);
  return join(out, board.eol);
}

// Tick/untick from anywhere: a ticked top-level task goes to Done (AGENTS.md completion rule).
export function toggleTask(text, raw, laneName, today) {
  const board = parseBoard(text);
  const task = findTask(board, raw, laneName);
  if (!task) return null;
  if (!task.done) return moveTask(text, raw, laneName, "Done", today);
  const back = laneByName(board, "Next") || board.lanes[0];
  return moveTask(text, raw, laneName, back.name, today);
}

export function toggleSubtask(text, parentRaw, laneName, subLine, today) {
  const board = parseBoard(text);
  const task = findTask(board, parentRaw, laneName);
  if (!task) return null;
  const sub = task.subtasks.find((s) => s.line - task.line === subLine);
  if (!sub) return null;
  const lines = board.lines.slice();
  lines[sub.line] = retick(lines[sub.line], !sub.done, today);
  return join(lines, board.eol);
}

export function updateTask(text, raw, laneName, patch) {
  const board = parseBoard(text);
  const task = findTask(board, raw, laneName);
  if (!task) return null;
  const next = { ...task, ...patch, fields: { ...task.fields, ...(patch.fields || {}) } };
  const lines = board.lines.slice();
  lines[task.line] = formatTaskLine(next);
  let out = join(lines, board.eol);
  if (patch.lane && patch.lane !== task.lane) out = moveTask(out, lines[task.line], task.lane, patch.lane, patch.today || "");
  return out;
}

export function addTask(text, laneName, task) {
  const board = parseBoard(text);
  const lane = laneByName(board, laneName) || board.lanes[0];
  if (!lane) return null;
  const line = formatTaskLine({ indent: 0, done: false, otherTags: [], fields: {}, ...task });
  const lines = board.lines.slice();
  lines.splice(insertionPoint(board, lane, null), 0, line);
  return join(lines, board.eol);
}

// goals.md: "## G1 · Title" sections with "- Key: value" bullets.
export function parseGoals(text) {
  const goals = [];
  let g = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^## (G\d+)\s*[·\-–:]\s*(.+?)\s*$/.exec(line);
    if (h) {
      g = { id: h[1], title: h[2], props: {} };
      goals.push(g);
      continue;
    }
    if (/^## /.test(line)) g = null;
    const p = g && /^- ([^:]+):\s*(.+)$/.exec(line);
    if (p) g.props[p[1].trim().toLowerCase()] = p[2].trim();
  }
  return goals;
}

export function goalProgress(goals, tasks) {
  return goals.map((g) => {
    const mine = tasks.filter((t) => (t.fields.goal || "").toUpperCase() === g.id.toUpperCase());
    const done = mine.filter((t) => t.done).length;
    return { ...g, done, total: mine.length, pct: mine.length ? Math.round((100 * done) / mine.length) : 0 };
  });
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const data = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*([^#]*?)\s*(#.*)?$/.exec(line);
    if (kv) data[kv[1]] = kv[2];
  }
  const title = (/^# (.+)$/m.exec(text) || [])[1] || "";
  return { data, title };
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
