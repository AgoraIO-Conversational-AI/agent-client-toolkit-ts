#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.client
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


DEFAULT_TARGET_ORIGIN = "https://api.agora.io"
DEFAULT_ALLOWED_ORIGIN = "*"
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "origin",
}


def trim_trailing_slash(value: str) -> str:
    return value.rstrip("/")


def make_handler(target_origin: str, allowed_origin: str):
    parsed_target = urlparse(trim_trailing_slash(target_origin))
    if parsed_target.scheme != "https" or not parsed_target.netloc:
        raise ValueError("target_origin must be an https origin, for example https://api.agora.io")

    class ConvoAIProxyHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _write_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Max-Age", "600")

        def _send_json(self, status: int, body: dict[str, object]) -> None:
            payload = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self._write_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._write_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self) -> None:
            if not self.path.startswith("/api/conversational-ai-agent/v2/projects/"):
                self._send_json(404, {"error": "Unsupported proxy path", "path": self.path})
                return

            content_length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(content_length) if content_length else b""

            forward_headers = {
                key: value
                for key, value in self.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
            }
            forward_headers["Host"] = parsed_target.netloc

            connection = http.client.HTTPSConnection(parsed_target.netloc, timeout=30)
            try:
                target_path = self.path
                connection.request("POST", target_path, body=body, headers=forward_headers)
                response = connection.getresponse()
                response_body = response.read()

                self.send_response(response.status)
                self._write_cors_headers()
                for key, value in response.getheaders():
                    if key.lower() not in HOP_BY_HOP_HEADERS:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)
            except Exception as exc:
                self._send_json(502, {"error": "Proxy request failed", "detail": str(exc)})
            finally:
                connection.close()

        def log_message(self, format: str, *args: object) -> None:
            print("[%s] %s" % (self.log_date_time_string(), format % args))

    return ConvoAIProxyHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="Local CORS proxy for Agora ConvoAI REST.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--target-origin", default=DEFAULT_TARGET_ORIGIN)
    parser.add_argument("--allowed-origin", default=DEFAULT_ALLOWED_ORIGIN)
    args = parser.parse_args()

    handler = make_handler(args.target_origin, args.allowed_origin)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(
        "ConvoAI proxy listening on "
        f"http://{args.host}:{args.port} -> {trim_trailing_slash(args.target_origin)}"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
