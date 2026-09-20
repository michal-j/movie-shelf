#!/usr/bin/env python3
"""Minimal static file server that avoids os.getcwd() (broken in this sandbox).

Sends Cache-Control: no-store on every response so the browser always picks
up the latest index.html/app.js/styles.css while this prototype is under
active development — a stale-cached app.js was causing "changes don't show
up" confusion.
"""
import functools
import http.server
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 4173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_head(self):
        # Mirrors Vercel's cleanUrls (vercel.json) locally: /login should
        # serve login.html the same way it does in production, so clean-URL
        # links/redirects can actually be tested against this dev server
        # instead of only against a real Vercel deployment.
        path = self.translate_path(self.path)
        if "." not in os.path.basename(path) and os.path.isfile(path + ".html"):
            self.path += ".html"
        return super().send_head()


handler = functools.partial(NoCacheHandler, directory=ROOT)
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"Serving {ROOT} on http://127.0.0.1:{PORT} (no-cache)")
    httpd.serve_forever()
