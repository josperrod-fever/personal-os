// Round-trip and operation tests for app/js/model.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as m from "../app/js/model.js";

const TODAY = "2026-10-21";
const board = `---
note: frontmatter is preserved
---

## Inbox

- [ ] Review feedback #p2 #proj/launch


## Next

- [ ] Prepare the report #p1 #proj/launch [goal:: G1] [est:: 2h] [due:: 2026-10-24]
- [ ] Define data sources #p2 [goal:: G2]


## Doing (3)

- [ ] Write the rollout plan #p1 [goal:: G1] [due:: 2026-10-22]
  - [x] List the pilot customers [completion:: 2026-10-20]
  - [ ] Define exit criteria
  Some note under the task


## Waiting


## Done

- [x] Send the kickoff #p1 [goal:: G1] [completion:: 2026-10-20]

Free text at the end of the file is preserved.
`;

const changed = (a, b) => {
  const x = a.split("\n"), y = b.split("\n");
  return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) };
};

test("the example tasks.md parses into five lanes", () => {
  const b = m.parseBoard(readFileSync(new URL("../tasks.md", import.meta.url), "utf8"));
  assert.deepEqual(b.lanes.map((l) => l.name), ["Inbox", "Next", "Doing", "Waiting", "Done"]);
});

test("no-op round trip is byte-identical (LF and CRLF)", () => {
  for (const text of [board, board.replace(/\n/g, "\r\n")]) {
    const b = m.parseBoard(text);
    assert.equal(b.lines.join(b.eol), text);
  }
});

test("parses lanes, WIP limits, fields, tags and subtasks", () => {
  const b = m.parseBoard(board);
  assert.deepEqual(b.lanes.map((l) => [l.name, l.tasks.length]), [["Inbox", 1], ["Next", 2], ["Doing", 1], ["Waiting", 0], ["Done", 1]]);
  assert.equal(b.lanes[2].wip, 3);
  const t = b.lanes[1].tasks[0];
  assert.equal(t.title, "Prepare the report");
  assert.equal(t.priority, "p1");
  assert.equal(t.project, "launch");
  assert.deepEqual(t.fields, { goal: "G1", est: "2h", due: "2026-10-24" });
  assert.equal(b.lanes[2].tasks[0].subtasks.length, 2);
});

test("ticking a task moves it to Done with a completion date and changes nothing else", () => {
  const raw = "- [ ] Define data sources #p2 [goal:: G2]";
  const out = m.toggleTask(board, raw, "Next", TODAY);
  assert.deepEqual(changed(board, out), { removed: [raw], added: [`- [x] Define data sources #p2 [goal:: G2] [completion:: ${TODAY}]`] });
  const done = m.parseBoard(out).lanes[4].tasks;
  assert.equal(done[done.length - 1].title, "Define data sources");
  assert.ok(out.endsWith("Free text at the end of the file is preserved.\n"), "trailing text preserved");
});

test("moving a task carries its subtasks and notes", () => {
  const raw = "- [ ] Write the rollout plan #p1 [goal:: G1] [due:: 2026-10-22]";
  const out = m.moveTask(board, raw, "Doing", "Waiting", TODAY);
  const b = m.parseBoard(out);
  assert.equal(b.lanes[2].tasks.length, 0);
  const w = b.lanes[3];
  assert.equal(w.tasks.length, 1);
  assert.deepEqual(b.lines.slice(w.tasks[0].line, w.tasks[0].end), [
    raw,
    "  - [x] List the pilot customers [completion:: 2026-10-20]",
    "  - [ ] Define exit criteria",
    "  Some note under the task",
  ]);
  assert.deepEqual(changed(board, out).added, []);
});

test("moving a done task back out of Done unticks it and drops the completion date", () => {
  const raw = "- [x] Send the kickoff #p1 [goal:: G1] [completion:: 2026-10-20]";
  const out = m.moveTask(board, raw, "Done", "Next", TODAY);
  assert.deepEqual(changed(board, out), { removed: [raw], added: ["- [ ] Send the kickoff #p1 [goal:: G1]"] });
});

test("reordering within a lane inserts before the target card", () => {
  const a = "- [ ] Prepare the report #p1 #proj/launch [goal:: G1] [est:: 2h] [due:: 2026-10-24]";
  const bRaw = "- [ ] Define data sources #p2 [goal:: G2]";
  const out = m.moveTask(board, bRaw, "Next", "Next", TODAY, a);
  assert.deepEqual(m.parseBoard(out).lanes[1].tasks.map((t) => t.title), ["Define data sources", "Prepare the report"]);
});

test("adding to an empty lane keeps one blank line under the heading", () => {
  const out = m.addTask(board, "Waiting", { title: "Get API access", priority: "p2", fields: { waiting: "data team" } });
  assert.match(out, /## Waiting\n\n- \[ \] Get API access #p2 \[waiting:: data team\]\n/);
});

test("new and edited tasks keep date fields last", () => {
  const out = m.addTask(board, "Inbox", { title: "Call the bank", priority: "p1", project: "home", fields: { due: "2026-10-30", goal: "G3", est: "30m" } });
  assert.ok(out.includes("- [ ] Call the bank #p1 #proj/home [goal:: G3] [est:: 30m] [due:: 2026-10-30]"));
  const raw = "- [ ] Review feedback #p2 #proj/launch";
  const upd = m.updateTask(board, raw, "Inbox", { priority: "p1", fields: { due: "2026-11-01", est: "1h" } });
  assert.ok(upd.includes("- [ ] Review feedback #p1 #proj/launch [est:: 1h] [due:: 2026-11-01]"));
});

test("ticking a subtask stays under its parent", () => {
  const raw = "- [ ] Write the rollout plan #p1 [goal:: G1] [due:: 2026-10-22]";
  const out = m.toggleSubtask(board, raw, "Doing", 2, TODAY);
  assert.deepEqual(changed(board, out), { removed: ["  - [ ] Define exit criteria"], added: [`  - [x] Define exit criteria [completion:: ${TODAY}]`] });
});

test("a task that changed on disk is not found (the app reloads instead of overwriting)", () => {
  assert.equal(m.toggleTask(board, "- [ ] Something that is gone", "Next", TODAY), null);
});

test("goal progress counts done / total per goal", () => {
  const goals = m.parseGoals("## G1 · Launch\n- Horizon: 2026-12-15\n\n## G2 · Reporting\n");
  const p = m.goalProgress(goals, m.allTasks(m.parseBoard(board)));
  assert.deepEqual(p.map((g) => [g.id, g.done, g.total]), [["G1", 1, 3], ["G2", 0, 1]]);
  assert.equal(p[0].props.horizon, "2026-12-15");
});
