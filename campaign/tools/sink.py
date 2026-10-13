"""Local-only helper for rendering the ad video in the preview browser.
Serves the app folder (so the ad page can load the real screenshots) and accepts
POST /save?name=<file> to write the rendered video into campaign/ad/out/.
Run via the 'ad-render' preview config; never deployed."""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # app root
OUT = os.path.join(ROOT, "campaign", "video")


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        u = urlparse(self.path)
        name = (parse_qs(u.query).get("name") or [""])[0]
        if u.path != "/save" or not re.fullmatch(r"[a-z0-9-]{1,40}\.(mp4|webm|png)", name):
            self.send_error(400); return
        n = int(self.headers.get("Content-Length", "0"))
        if n <= 0 or n > 80 * 1024 * 1024:
            self.send_error(413); return
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers(); self.wfile.write(b"saved")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8744
    ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=ROOT)).serve_forever()
