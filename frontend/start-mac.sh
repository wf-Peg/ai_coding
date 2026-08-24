#!/usr/bin/env bash
set -euo pipefail

PORT=3000
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Please stop that process first."
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  echo "Starting frontend on http://localhost:$PORT (Node SPA)"
  exec node server.js
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "Neither node nor Python found. Install Node.js or Python."
  exit 1
fi

echo "Starting frontend on http://localhost:$PORT (Python SPA)"
exec "$PYTHON_CMD" -c "
import http.server, os, sys
class S(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        p = self.translate_path(self.path)
        if not os.path.exists(p) or os.path.isdir(p):
            self.path = '/index.html'
        return super().do_GET()
http.server.HTTPServer(('0.0.0.0', $PORT), S).serve_forever()
"