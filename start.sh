#!/bin/bash
# ============================================
# Clip Demo - Start Services (macOS/Linux)
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_LOG="$SCRIPT_DIR/backend.log"
FRONTEND_LOG="$SCRIPT_DIR/frontend.log"
BACKEND_PORT=8080
FRONTEND_PORT=3000

echo "========================================"
echo "  Clip - Starting Frontend & Backend"
echo "========================================"
echo ""

# ---------- Check Prerequisites ----------
check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "[ERROR] $1 not found. Please install it first."
    exit 1
  fi
}

check_command java
check_command curl

# ---------- Check if port is in use ----------
port_in_use() {
  lsof -ti:"$1" &>/dev/null
}

# ---------- Start Backend ----------
if port_in_use $BACKEND_PORT; then
  echo "[INFO] Backend already running on port $BACKEND_PORT"
else
  echo "[1/2] Starting backend..."
  JAR="$BACKEND_DIR/target/clip-demo-0.0.1-SNAPSHOT.jar"

  if [ ! -f "$JAR" ]; then
    echo "[ERROR] JAR not found at: $JAR"
    echo "        Run: mvn clean package -DskipTests"
    exit 1
  fi

  # Start backend in background
  cd "$BACKEND_DIR"
  java -jar "$JAR" > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  cd "$SCRIPT_DIR"

  echo "       Waiting for backend..."
  RETRIES=0
  while [ $RETRIES -lt 30 ]; do
    if curl -sf "http://127.0.0.1:$BACKEND_PORT/api/clip/list" >/dev/null 2>&1; then
      echo "       Backend started! (PID: $BACKEND_PID)"
      break
    fi
    sleep 2
    RETRIES=$((RETRIES + 1))
  done

  if [ $RETRIES -ge 30 ]; then
    echo "[ERROR] Backend startup timeout. Check $BACKEND_LOG"
    exit 1
  fi
fi

# ---------- Start Frontend ----------
if port_in_use $FRONTEND_PORT; then
  echo "[INFO] Frontend already running on port $FRONTEND_PORT"
else
  echo "[2/2] Starting frontend..."

  if command -v npx &>/dev/null; then
    npx serve "$FRONTEND_DIR" -l $FRONTEND_PORT > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    echo "       Frontend starting... (PID: $FRONTEND_PID)"
    sleep 3
  elif command -v python3 &>/dev/null; then
    cd "$FRONTEND_DIR"
    python3 -m http.server $FRONTEND_PORT > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    cd "$SCRIPT_DIR"
    echo "       Frontend starting... (PID: $FRONTEND_PID, using Python)"
    sleep 2
  else
    echo "[WARN] Neither npx nor python3 found. Start frontend manually:"
    echo "        npx serve frontend -l $FRONTEND_PORT"
  fi
fi

# ---------- Done ----------
echo ""
echo "========================================"
echo "  All services started!"
echo "  Frontend: http://127.0.0.1:$FRONTEND_PORT"
echo "  Backend:  http://127.0.0.1:$BACKEND_PORT"
echo "========================================"
echo ""

# Open browser
read -r -p "Press Enter to open browser (or Ctrl+C to skip)..."
open "http://127.0.0.1:$FRONTEND_PORT"