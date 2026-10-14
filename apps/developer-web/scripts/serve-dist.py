#!/usr/bin/env python3
"""以静态站点方式托管打包后的 developer-web dist，并把 /api 反向代理到 workspace backend。

只需要 Python 标准库，因此发布后使用者可以直接用系统自带 python3 启动，
不依赖 node、pnpm 或前端工具链。

环境变量：
  UNILAB_DIST     打包产物目录（必须包含 index.html）
  UNILAB_BACKEND  workspace backend 地址，例如 http://127.0.0.1:52734
  UNILAB_FE_PORT  监听端口，默认 4177
"""

import os
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(os.environ["UNILAB_DIST"]).resolve()
BACKEND = os.environ["UNILAB_BACKEND"].rstrip("/")
PREFIX = "/__unilab_backend"
HOST = "127.0.0.1"
PORT = int(os.environ["UNILAB_FE_PORT"])
HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def do_PUT(self):
        self._handle()

    def do_PATCH(self):
        self._handle()

    def do_DELETE(self):
        self._handle()

    def do_OPTIONS(self):
        self._handle()

    def _handle(self):
        path = self.path.split("?", 1)[0]
        if path == "/api" or path.startswith("/api/"):
            self._proxy(self.path)
            return
        # 与 Vite dev proxy 保持一致：默认构建把后端地址烧成 /__unilab_backend，
        # 只有 VITE_UNILAB_API_URL 设成 / 时才会直接请求 /api。
        if path == PREFIX or path.startswith(PREFIX + "/"):
            self._proxy(self.path[len(PREFIX) :])
            return
        self._static()

    def _proxy(self, target_path):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP}
        request = Request(BACKEND + target_path, data=body, headers=headers, method=self.command)
        try:
            upstream = urlopen(request, timeout=60)
        except HTTPError as exc:
            upstream = exc
        except URLError as exc:
            payload = f"backend unavailable: {exc.reason}".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(getattr(upstream, "status", upstream.code))
        for key, value in upstream.headers.items():
            if key.lower() not in HOP:
                self.send_header(key, value)
        # 不使用 keep-alive：SSE 等流式响应以连接关闭作为正文结束标志。
        self.close_connection = True
        self.end_headers()
        try:
            while True:
                # read(n) 会阻塞到攒满 n 字节，SSE 的小帧会被扣在这里；read1 有多少转多少。
                chunk = upstream.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _static(self):
        rel = self.path.split("?", 1)[0].lstrip("/")
        candidate = (ROOT / rel).resolve() if rel else ROOT / "index.html"
        if not str(candidate).startswith(str(ROOT)) or not candidate.is_file():
            candidate = ROOT / "index.html"
        if not candidate.is_file():
            payload = f"dist 目录缺少 index.html: {ROOT}".encode()
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        data = candidate.read_bytes()
        content_type = CONTENT_TYPES.get(candidate.suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


print(f"frontend http://{HOST}:{PORT}/  api {BACKEND}  dist {ROOT}", flush=True)
ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()