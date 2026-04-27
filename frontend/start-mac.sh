#!/usr/bin/env bash
set -euo pipefail

PORT=3000
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Please stop that process first."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "Python is not installed or not in PATH."
  exit 1
fi

echo "Starting frontend on http://localhost:$PORT"
exec "$PYTHON_CMD" -m http.server "$PORT"

