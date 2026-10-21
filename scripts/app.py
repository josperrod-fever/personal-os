#!/usr/bin/env python3
"""Open the Personal OS app from this computer (an alternative to the hosted link). Standard library only.

  python3 scripts/app.py     # macOS / Linux
  py scripts\\app.py          # Windows

Serves the app on http://127.0.0.1:4173 (only reachable from this computer) and opens it in your
browser. Use Chrome, Edge, Brave or Arc, then choose "Open my Personal OS folder".
Only the app and the demo's example files are served; everything else (your notes, .git, private/)
is refused. Your own folder is read by the browser directly, never through this server.
Options: [port] [--no-open]. Stop it with Ctrl+C.
"""
import functools, http.server, json, pathlib, posixpath, sys, threading, urllib.parse, webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(ARGS[0]) if ARGS else 4173
DEMO_FILES = set(json.loads((ROOT / "app" / "demo-files.json").read_text(encoding="utf-8")))


def allowed(url_path):
    path = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(url_path).path)).lstrip("/")
    if path in ("", ".", "index.html"):
        return True
    if any(part.startswith(".") for part in path.split("/")):
        return False
    return path == "app" or path.startswith("app/") or path in DEMO_FILES


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if not allowed(self.path):
            self.send_error(404, "Not served: the app only exposes itself and the demo files")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "No directory listings")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def open_browser(url):
    # The app needs a Chromium browser to open your folder; prefer one over a Safari/Firefox default.
    for name in ("chrome", "google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave"):
        try:
            if webbrowser.get(name).open(url):
                return
        except webbrowser.Error:
            continue
    if sys.platform == "darwin":
        import subprocess
        for app in ("Google Chrome", "Microsoft Edge", "Brave Browser", "Arc", "Chromium"):
            if subprocess.run(["open", "-a", app, url], capture_output=True).returncode == 0:
                return
    webbrowser.open(url)


def main():
    handler = functools.partial(Handler, directory=str(ROOT))
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError:
        sys.exit(f"Port {PORT} is busy. Try: python3 scripts/app.py {PORT + 1}")
    url = f"http://127.0.0.1:{PORT}/app/"
    print(f"Personal OS is running at {url}\nOpen it in Chrome, Edge, Brave or Arc. Press Ctrl+C to stop.")
    if "--no-open" not in sys.argv:
        threading.Timer(0.5, lambda: open_browser(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
