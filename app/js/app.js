// Personal OS app: a local-first UI over the Markdown files. All rendering uses DOM nodes and
// textContent — never innerHTML with data — because notes can contain text ingested from elsewhere.
import * as m from "./model.js";
import { DemoStore, FolderStore, StaleError, folderSupported } from "./store.js";

const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name]; // constant markup above, never data
  return svg;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const S = {
  store: null,
  view: pref("view") || "today",
  text: "",
  board: { lanes: [] },
  goals: [],
  projects: [],
  archive: [],
  memoryInbox: 0,
  today: isoDate(new Date()),
  sig: "",
  synced: 0,
  pending: false,
};

function pref(k, v) {
  try {
    if (v === undefined) return localStorage.getItem("pos." + k);
    localStorage.setItem("pos." + k, v);
  } catch { /* storage can be blocked */ }
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- data ----------
async function load() {
  const st = S.store;
  S.sig = await st.signature();
  S.synced = Date.now();
  S.today = isoDate(new Date());
  S.text = (await st.read("tasks.md")) || "";
  S.board = m.parseBoard(S.text);
  S.goals = m.parseGoals((await st.read("goals.md")) || "");
  S.archive = [];
  for (const f of await st.list("archive")) {
    for (const line of ((await st.read("archive/" + f)) || "").split(/\r?\n/)) {
      const t = m.parseTaskLine(line);
      if (t && t.indent === 0) S.archive.push(t);
    }
  }
  S.projects = [];
  for (const f of await st.list("projects")) {
    const { data, title } = m.parseFrontmatter((await st.read("projects/" + f)) || "");
    S.projects.push({ slug: f.replace(/\.md$/, ""), title: title || f, ...data });
  }
  const inbox = (await st.read("memory/inbox.md")) || "";
  S.memoryInbox = (inbox.match(/^- \[ \] /gm) || []).length;
}

// Every change: re-read the file, apply the edit to the fresh text, write only if nobody changed it meanwhile.
async function mutate(op, message) {
  try {
    const fresh = (await S.store.read("tasks.md")) || "";
    const out = op(fresh);
    if (out == null) {
      await load();
      render();
      return toast("That task changed outside the app, so the view was refreshed. Try again.");
    }
    await S.store.write("tasks.md", out, fresh);
    await load();
    render();
    if (message) toast(message);
  } catch (e) {
    if (e instanceof StaleError) {
      await load();
      render();
      return toast("tasks.md was just changed elsewhere. Reloaded, so nothing was overwritten.");
    }
    console.error(e);
    toast("Couldn't save: " + e.message);
  }
}

const tasks = () => m.allTasks(S.board);
const lane = (name) => S.board.lanes.find((l) => l.name.toLowerCase() === name.toLowerCase());
const open = () => tasks().filter((t) => !t.done);
const prioRank = (t) => ({ p1: 1, p2: 2, p3: 3 })[t.priority] || 4;
const byPriority = (a, b) => prioRank(a) - prioRank(b) || (a.fields.due || "9999").localeCompare(b.fields.due || "9999");

// ---------- pieces ----------
function dueChip(due) {
  if (!due) return null;
  const d = m.daysBetween(S.today, due);
  const date = new Date(due + "T12:00:00");
  let label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  let cls = "chip";
  if (d < 0) { label = `Overdue · ${label}`; cls += " late"; }
  else if (d === 0) { label = "Today"; cls += " soon"; }
  else if (d === 1) { label = "Tomorrow"; cls += " soon"; }
  else if (d < 7) label = date.toLocaleDateString(undefined, { weekday: "long" });
  return h("span", { class: cls }, icon("cal"), label);
}

function meta(t, compact = false) {
  const goal = S.goals.find((g) => g.id === (t.fields.goal || "").toUpperCase());
  const subsDone = t.subtasks ? t.subtasks.filter((s) => s.done).length : 0;
  const chips = [
    t.priority && h("span", { class: `chip ${t.priority}` }, t.priority.toUpperCase()),
    !t.done && dueChip(t.fields.due),
    t.project && h("span", { class: "chip" }, icon("folder"), t.project),
    goal && h("span", { class: "chip goal", title: `${goal.id} · ${goal.title}` }, compact ? goal.id : h("span", {}, goal.id + " · " + goal.title)),
    t.fields.est && h("span", { class: "chip" }, icon("clock"), t.fields.est),
    t.fields.waiting && h("span", { class: "chip" }, icon("user"), "Waiting on " + t.fields.waiting),
    t.subtasks && t.subtasks.length > 0 && h("span", { class: "chip" }, icon("list"), `${subsDone}/${t.subtasks.length}`),
  ].filter(Boolean);
  return chips.length ? h("div", { class: "meta" }, chips) : null;
}

function checkButton(t) {
  return h("button", {
    class: `check${t.done ? " on" : ""}${t.priority === "p1" && !t.done ? " p1" : ""}`,
    "aria-label": t.done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`,
    onclick: (e) => {
      e.stopPropagation();
      mutate((txt) => m.toggleTask(txt, t.raw, t.lane, S.today), t.done ? "Moved back to Next" : "Done. Nice.");
    },
  }, icon("check"));
}

function row(t) {
  return h("div", { class: `row${t.done ? " done" : ""}`, onclick: () => editTask(t) },
    checkButton(t),
    h("div", { class: "body" }, h("div", { class: "title" }, t.title), meta(t)));
}

function list(items, emptyText) {
  return h("div", { class: "list" }, items.length ? items.map(row) : h("div", { class: "empty" }, emptyText));
}

function capture(placeholder = "Add a task and press Enter") {
  const input = h("input", { id: "capture", placeholder, "aria-label": "New task", autocomplete: "off" });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const title = input.value.trim();
    input.value = "";
    mutate((txt) => m.addTask(txt, "Inbox", { title }), "Added to Inbox");
  });
  return h("div", { class: "capture" }, icon("plus"), input, h("span", { class: "hint" }, "Enter"));
}

// ---------- views ----------
function viewToday() {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
  const doing = lane("Doing");
  const next = (lane("Next")?.tasks || []).slice().sort(byPriority);
  const soon = open().filter((t) => t.fields.due && t.fields.due <= addDays(S.today, 7)).sort((a, b) => a.fields.due.localeCompare(b.fields.due));
  const doneToday = tasks().filter((t) => t.done && t.fields.completion === S.today);
  const overdue = soon.filter((t) => t.fields.due < S.today).length;
  const doingCount = doing ? doing.tasks.length : 0;
  return h("div", { class: "page" },
    h("div", { class: "head" }, h("div", {},
      h("h1", {}, hello),
      h("p", { class: "sub" }, new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })))),
    capture("What do you need to do? Press Enter to add it to your Inbox"),
    h("div", { class: "stats" },
      stat("In progress", doingCount, doing?.wip ? `/ ${doing.wip}` : ""),
      stat("Up next", next.length),
      stat("Due this week", soon.length, overdue ? `${overdue} overdue` : "", overdue > 0),
      stat("Done today", doneToday.length)),
    h("h2", {}, "In progress"),
    list(doing ? doing.tasks : [], "Nothing in progress. Tell your agent \"plan the day\", or drag a task to Doing on the board."),
    h("h2", {}, "Up next"),
    list(next.slice(0, 6), "Nothing planned yet. Tell your agent what's on your plate, or add a task above."),
    h("h2", {}, "Due this week"),
    list(soon, "Nothing due in the next 7 days."),
    doneToday.length ? [h("h2", {}, "Done today"), list(doneToday, "")] : null);
}

function stat(k, v, small = "", warn = false) {
  return h("div", { class: `stat${warn ? " warn" : ""}` }, h("div", { class: "k" }, k), h("div", { class: "v" }, String(v), small ? h("small", {}, " " + small) : null));
}

let dragged = null;
function viewBoard() {
  return h("div", { class: "page wide" },
    h("div", { class: "head" }, h("div", {}, h("h1", {}, "Board"), h("p", { class: "sub" }, "Drag cards between columns. Click a card to edit it."))),
    h("div", { class: "board" }, S.board.lanes.map(laneColumn)));
}

function laneColumn(l) {
  const full = l.wip && l.tasks.length >= l.wip;
  const col = h("section", { class: `lane${l.name.toLowerCase() === "done" ? " done-lane" : ""}`, "aria-label": l.name },
    h("div", { class: "lane-h" }, l.name, h("span", { class: "n" }, String(l.tasks.length)),
      l.wip ? h("span", { class: `wip${full ? " full" : ""}`, title: "Limit for this column" }, `max ${l.wip}`) : null),
    l.tasks.map(card),
    addButton(l));
  col.addEventListener("dragover", (e) => {
    if (!dragged) return;
    e.preventDefault();
    col.classList.add("over");
    const before = cardAfter(col, e.clientY);
    const line = document.querySelector(".drop-line") || h("div", { class: "drop-line" });
    if (before) col.insertBefore(line, before);
    else col.insertBefore(line, col.querySelector(".add"));
  });
  col.addEventListener("dragleave", (e) => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove("over");
      document.querySelector(".drop-line")?.remove();
    }
  });
  col.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragged) return;
    const before = cardAfter(col, e.clientY);
    const t = dragged;
    dragged = null;
    mutate((txt) => m.moveTask(txt, t.raw, t.lane, l.name, S.today, before ? before.dataset.raw : null), l.name === "Done" ? "Done. Nice." : `Moved to ${l.name}`);
  });
  return col;
}

function cardAfter(col, y) {
  return [...col.querySelectorAll(".card:not(.dragging)")].find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
}

function card(t) {
  const el = h("article", { class: `card${t.done ? " done" : ""}`, draggable: "true", dataset: { raw: t.raw }, onclick: () => editTask(t) },
    checkButton(t),
    h("div", { class: "body" }, h("div", { class: "title" }, t.title), meta(t, true)));
  el.addEventListener("dragstart", (e) => {
    dragged = t;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", t.title);
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    document.querySelectorAll(".lane.over").forEach((c) => c.classList.remove("over"));
    document.querySelector(".drop-line")?.remove();
  });
  return el;
}

function addButton(l) {
  const btn = h("button", { class: "add" }, icon("plus"), "Add a task");
  btn.addEventListener("click", () => {
    const input = h("input", { class: "add-input", placeholder: "Task name, then Enter", "aria-label": `New task in ${l.name}` });
    const finish = () => input.replaceWith(btn);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish();
      if (e.key === "Enter" && input.value.trim()) {
        const title = input.value.trim();
        mutate((txt) => m.addTask(txt, l.name, { title, done: l.name === "Done", fields: l.name === "Done" ? { completion: S.today } : {} }), `Added to ${l.name}`);
      }
    });
    input.addEventListener("blur", finish);
    btn.replaceWith(input);
    input.focus();
  });
  return btn;
}

function viewGoals() {
  const progress = m.goalProgress(S.goals, [...tasks(), ...S.archive]);
  return h("div", { class: "page" },
    h("div", { class: "head" }, h("div", {}, h("h1", {}, "Goals"), h("p", { class: "sub" }, "Progress counts tasks linked to each goal, including archived ones."))),
    progress.length ? h("div", { class: "grid" }, progress.map((g) => {
      const fill = h("span");
      fill.style.width = g.pct + "%";
      return h("div", { class: "tile" },
        h("h3", {}, `${g.id} · ${g.title}`),
        h("p", { class: "k" }, g.props["key results"] || g.props.why || ""),
        h("div", { class: "bar", role: "progressbar", "aria-valuenow": String(g.pct), "aria-valuemin": "0", "aria-valuemax": "100" }, fill),
        h("div", { class: "bar-label" }, h("span", {}, `${g.done} of ${g.total} tasks`), h("span", {}, `${g.pct}%`)),
        h("div", { class: "meta" },
          g.props.horizon && h("span", { class: "chip" }, icon("cal"), "By " + g.props.horizon),
          g.props.status && h("span", { class: "chip" }, g.props.status)));
    })) : h("div", { class: "list" }, h("div", { class: "empty" }, "No goals yet. Ask your agent: \"help me set my goals\".")));
}

function viewProjects() {
  return h("div", { class: "page" },
    h("div", { class: "head" }, h("div", {}, h("h1", {}, "Projects"), h("p", { class: "sub" }, "Each project is a file in projects/. Your agent keeps its context, people and decisions there."))),
    S.projects.length ? h("div", { class: "grid" }, S.projects.map((p) => {
      const mine = tasks().filter((t) => t.project === p.slug);
      const openCount = mine.filter((t) => !t.done).length;
      return h("div", { class: "tile" },
        h("h3", {}, p.title),
        h("p", { class: "k" }, `${openCount} open task${openCount === 1 ? "" : "s"}`),
        h("div", { class: "meta" },
          p.status && h("span", { class: "chip" }, p.status),
          p.priority && h("span", { class: `chip ${p.priority}` }, p.priority.toUpperCase()),
          p.goal && h("span", { class: "chip goal" }, p.goal),
          p.due && dueChip(p.due)));
    })) : h("div", { class: "list" }, h("div", { class: "empty" }, "No projects yet.")));
}

// ---------- task editor ----------
function editTask(t) {
  const dlg = h("dialog", { "aria-label": "Edit task" });
  const title = h("input", { class: "t", value: t.title, "aria-label": "Task name" });
  let prio = t.priority || "";
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Priority" },
    [["", "None"], ["p1", "P1"], ["p2", "P2"], ["p3", "P3"]].map(([v, label]) => {
      const b = h("button", { type: "button", "aria-pressed": String(prio === v) }, label);
      b.addEventListener("click", () => {
        prio = v;
        seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      return b;
    }));
  const status = h("select", {}, S.board.lanes.map((l) => h("option", { value: l.name, selected: l.name === t.lane }, l.name)));
  const projects = [...new Set([...S.projects.map((p) => p.slug), t.project].filter(Boolean))];
  const project = h("select", {}, h("option", { value: "" }, "None"), projects.map((p) => h("option", { value: p, selected: p === t.project }, p)));
  const goal = h("select", {}, h("option", { value: "" }, "None"), S.goals.map((g) => h("option", { value: g.id, selected: g.id === (t.fields.goal || "").toUpperCase() }, `${g.id} · ${g.title}`)));
  const due = h("input", { type: "date", value: t.fields.due || "" });
  const estimates = ["", "15m", "30m", "1h", "2h", "4h", "1d", "2d"];
  if (t.fields.est && !estimates.includes(t.fields.est)) estimates.push(t.fields.est);
  const est = h("select", {}, estimates.map((v) => h("option", { value: v, selected: v === (t.fields.est || "") }, v || "None")));
  const waiting = h("input", { value: t.fields.waiting || "", placeholder: "Who are you waiting for?" });
  const waitingRow = field("Waiting on", waiting);
  const syncWaiting = () => { waitingRow.hidden = status.value !== "Waiting" && !waiting.value; };
  status.addEventListener("change", syncWaiting);
  syncWaiting();

  const subs = t.subtasks?.length ? h("div", { class: "subs" }, t.subtasks.map((s) => h("div", { class: "sub-row" },
    h("button", {
      class: `check${s.done ? " on" : ""}`, type: "button", "aria-label": `Toggle "${s.title}"`,
      onclick: () => { dlg.close(); mutate((txt) => m.toggleSubtask(txt, t.raw, t.lane, s.line - t.line, S.today)); },
    }, icon("check")),
    h("span", { class: s.done ? "title done" : "title" }, s.title)))) : null;

  const save = () => {
    if (!title.value.trim()) return title.focus();
    const patch = {
      title: title.value.trim(), priority: prio || null, project: project.value || null, lane: status.value, today: S.today,
      fields: { goal: goal.value, due: due.value, est: est.value, waiting: waiting.value.trim() },
    };
    dlg.close();
    mutate((txt) => m.updateTask(txt, t.raw, t.lane, patch), "Saved");
  };
  dlg.append(h("form", { class: "dlg", method: "dialog", onsubmit: (e) => { e.preventDefault(); save(); } },
    title,
    field("Status", status),
    field("Priority", seg),
    field("Due date", due),
    field("Project", project),
    field("Goal", goal),
    field("Estimate", est),
    waitingRow,
    subs && h("div", { class: "field" }, h("span", {}, "Steps"), subs),
    h("div", { class: "dlg-foot" },
      h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Cancel"),
      h("button", { class: "btn primary", type: "submit" }, "Save"))));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  title.focus();
}

function field(label, control) {
  return h("label", { class: "field" }, h("span", {}, label), control);
}

// ---------- shell ----------
const VIEWS = { today: ["Today", "sun", viewToday], board: ["Board", "board", viewBoard], goals: ["Goals", "target", viewGoals], projects: ["Projects", "folder", viewProjects] };

function render() {
  const root = document.getElementById("app");
  root.className = "";
  if (!S.store) return;
  S.pending = false;
  const scroll = document.querySelector(".main")?.scrollTop || 0;
  const boardScroll = document.querySelector(".board")?.scrollLeft || 0;
  const counts = { today: lane("Doing")?.tasks.length || 0, board: open().length, goals: S.goals.length, projects: S.projects.length };
  const nav = Object.entries(VIEWS).map(([key, [label, ic]]) => h("button", {
    class: "nav", "aria-current": S.view === key ? "page" : null,
    onclick: () => { S.view = key; pref("view", key); render(); },
  }, icon(ic), label, h("span", { class: "count" }, String(counts[key]))));
  const demo = S.store instanceof DemoStore;
  const side = h("nav", { class: "side", "aria-label": "Main" },
    h("div", { class: "brand" }, h("span", { class: "logo" }, icon("check")), "Personal OS"),
    nav,
    h("div", { class: "side-foot" },
      S.memoryInbox ? h("div", { class: "note" }, h("strong", {}, `${S.memoryInbox} memory item${S.memoryInbox === 1 ? "" : "s"}`), " waiting for review. Ask your agent: \"review my memory inbox\".") : null,
      demo ? null : h("div", { class: "live", title: "Changes your agent makes to the files appear here automatically" }, h("span", { class: "dot" }), "Live · updates as your agent works"),
      h("div", { class: "source" }, demo ? "Demo data" : `Folder: ${S.store.label}`,
        h("button", { class: "link", onclick: switchFolder }, demo ? "Open my folder" : "Change"))));
  const view = (VIEWS[S.view] || VIEWS.today)[2]();
  if (demo) view.prepend(h("div", { class: "demo-banner" }, "You're looking at the demo. Changes stay in this tab until you open your own folder."));
  root.replaceChildren(h("div", { class: "shell" }, side, h("main", { class: "main" }, view)));
  document.querySelector(".main").scrollTop = scroll;
  const board = document.querySelector(".board");
  if (board) board.scrollLeft = boardScroll;
}

// Live view: the agent edits the files from your chats; the app notices within ~1.5 s and redraws.
// It never redraws under your hands (typing, an open editor, a drag) — it waits until you're done.
const busy = () =>
  !!document.querySelector("dialog[open]") || !!dragged ||
  (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "") && !!document.activeElement.value);
async function poll() {
  if (!S.store || document.hidden) return;
  try {
    if (S.pending && !busy()) return render();
    if ((await S.store.signature()) === S.sig) return;
    await load();
    if (busy()) S.pending = true;
    else render();
  } catch (e) {
    console.warn("refresh failed", e);
  }
}
setInterval(poll, 1500);
document.addEventListener("visibilitychange", poll);

async function useStore(store) {
  S.store = store;
  await store.init();
  await load();
  render();
}

async function switchFolder() {
  if (!folderSupported()) return toast("Opening a folder needs Chrome, Edge, Brave or Arc on a computer.");
  try {
    await useStore(await FolderStore.pick());
    toast(`Opened ${S.store.label}`);
  } catch (e) {
    if (e.name !== "AbortError") toast(e.message);
  }
}

async function welcome() {
  const root = document.getElementById("app");
  root.className = "";
  const remembered = folderSupported() ? await FolderStore.remembered() : null;
  const err = h("p", { class: "error", role: "alert" });
  const openBtn = folderSupported()
    ? h("button", { class: "btn primary big", onclick: async () => {
        try { await useStore(await FolderStore.pick()); } catch (e) { if (e.name !== "AbortError") err.textContent = e.message; }
      } }, remembered ? "Open another folder" : "Open my Personal OS folder")
    : null;
  const resume = remembered ? h("button", { class: "btn primary big", onclick: async () => {
    if (await FolderStore.permission(remembered, true)) await useStore(new FolderStore(remembered));
    else err.textContent = "Permission wasn't granted. You can open the folder again.";
  } }, `Continue with "${remembered.name}"`) : null;
  root.replaceChildren(h("div", { class: "welcome" }, h("div", { class: "welcome-card" },
    h("div", { class: "logo" }, icon("check")),
    h("h1", {}, "Personal OS"),
    h("p", {}, "The live view of your work. Your AI agent keeps your tasks, goals and projects up to date in plain files on your computer; this page shows where things stand and updates as the agent works."),
    h("p", { class: "small" }, "Nothing is uploaded: the page reads and writes only the folder you choose, inside your browser."),
    h("div", { class: "actions" }, resume, openBtn, h("button", { class: "btn big", onclick: () => demoMode() }, "Try the demo")),
    folderSupported() ? null : h("p", { class: "small" }, "To open your own folder, use Chrome, Edge, Brave or Arc on a computer. Safari and Firefox can only show the demo."),
    err)));
}

async function demoMode() {
  await useStore(new DemoStore(new URL("../", location.href).href));
}

document.addEventListener("keydown", (e) => {
  if (e.key === "n" && !e.metaKey && !e.ctrlKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector("dialog[open]")) {
    const c = document.getElementById("capture");
    if (c) { e.preventDefault(); c.focus(); }
  }
});

(async () => {
  if (new URLSearchParams(location.search).has("demo")) return demoMode();
  const remembered = folderSupported() ? await FolderStore.remembered() : null;
  if (remembered && (await FolderStore.permission(remembered, false))) return useStore(new FolderStore(remembered));
  welcome();
})();
