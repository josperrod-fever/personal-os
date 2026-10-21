// Storage for the app. Two interchangeable stores with the same interface:
//   read(path) -> string | null      write(path, text, basedOn) -> void (throws StaleError)
//   list(dir)  -> [names of .md files]  label, writable
// FolderStore uses the File System Access API (Chrome, Edge, Brave, Arc): files never leave the computer.
// DemoStore loads the example files shipped with the app and keeps edits in memory.

export class StaleError extends Error {}

export class DemoStore {
  constructor(base = "../") {
    this.base = base;
    this.files = new Map();
    this.label = "Demo";
    this.writable = false; // edits work, but only in memory
  }
  async init() {
    const index = await fetch(`${this.base}app/demo-files.json`).then((r) => r.json());
    await Promise.all(index.map(async (p) => {
      const r = await fetch(this.base + p);
      if (r.ok) this.files.set(p, await r.text());
    }));
  }
  async read(path) {
    return this.files.has(path) ? this.files.get(path) : null;
  }
  async write(path, text, basedOn) {
    if (basedOn !== undefined && (this.files.get(path) ?? null) !== basedOn) throw new StaleError(path);
    this.files.set(path, text);
  }
  async signature() {
    return "demo"; // nothing outside this tab changes the demo
  }
  async list(dir) {
    return [...this.files.keys()].filter((p) => p.startsWith(dir + "/") && p.endsWith(".md")).map((p) => p.slice(dir.length + 1));
  }
}

const DB = "personal-os";
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("handles", mode);
      const req = fn(tx.objectStore("handles"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export class FolderStore {
  constructor(handle) {
    this.dir = handle;
    this.label = handle.name;
    this.writable = true;
  }
  static async remembered() {
    try {
      const h = await idb("readonly", (s) => s.get("vault"));
      return h || null;
    } catch {
      return null;
    }
  }
  static async pick() {
    const handle = await window.showDirectoryPicker({ id: "personal-os", mode: "readwrite" });
    const store = new FolderStore(handle);
    if ((await store.read("tasks.md")) === null || (await store.read("AGENTS.md")) === null) {
      throw new Error(`"${handle.name}" doesn't look like a Personal OS folder (no tasks.md or AGENTS.md).`);
    }
    await idb("readwrite", (s) => s.put(handle, "vault"));
    return store;
  }
  static async forget() {
    await idb("readwrite", (s) => s.delete("vault"));
  }
  static async permission(handle, ask) {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return ask ? (await handle.requestPermission(opts)) === "granted" : false;
  }
  async init() {}
  async _file(path, create = false) {
    const parts = path.split("/");
    let dir = this.dir;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
    return dir.getFileHandle(parts[parts.length - 1], { create });
  }
  async read(path) {
    try {
      return await (await (await this._file(path)).getFile()).text();
    } catch (e) {
      if (e.name === "NotFoundError" || e.name === "TypeMismatchError") return null;
      throw e;
    }
  }
  async write(path, text, basedOn) {
    // Never overwrite changes made outside the app (by the agent, an editor, a script) since we read the file.
    if (basedOn !== undefined && (await this.read(path)) !== basedOn) throw new StaleError(path);
    const w = await (await this._file(path, true)).createWritable();
    await w.write(text);
    await w.close();
  }
  // Cheap fingerprint of every file the app shows: modified time + size. Polled to pick up
  // changes made by the agent (or anything else) and refresh the view live.
  async signature() {
    const paths = ["tasks.md", "goals.md", "memory/inbox.md"];
    for (const d of ["projects", "archive"]) for (const f of await this.list(d)) paths.push(`${d}/${f}`);
    const parts = await Promise.all(paths.map(async (p) => {
      try {
        const f = await (await this._file(p)).getFile();
        return `${p}:${f.lastModified}:${f.size}`;
      } catch {
        return `${p}:-`;
      }
    }));
    return parts.join("|");
  }
  async list(dir) {
    const out = [];
    try {
      let d = this.dir;
      for (const p of dir.split("/")) d = await d.getDirectoryHandle(p);
      for await (const [name, h] of d.entries()) if (h.kind === "file" && name.endsWith(".md")) out.push(name);
    } catch {
      /* folder doesn't exist yet */
    }
    return out.sort();
  }
}
