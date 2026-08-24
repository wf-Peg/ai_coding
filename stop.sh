#!/bin/bash
# ============================================
# Clip Demo - Stop Services (macOS/Linux)
# ============================================

BACKEND_PORT=8081
FRONTEND_PORT=3001

echo "========================================"
echo "  Clip - Stopping Frontend & Backend"
echo "========================================"
echo ""

# Stop backend (port 8081)
echo "[1/2] Stopping backend (port $BACKEND_PORT)..."
PIDS=$(lsof -ti:$BACKEND_PORT 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null
  echo "       Killed PIDs: $(echo $PIDS | tr '\n' ' ')"
else
  echo "       No process found on port $BACKEND_PORT"
fi

# Stop frontend (port 3001)
echo "[2/2] Stopping frontend (port $FRONTEND_PORT)..."
PIDS=$(lsof -ti:$FRONTEND_PORT 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null
  echo "       Killed PIDs: $(echo $PIDS | tr '\n' ' ')"
else
  echo "       No process found on port $FRONTEND_PORT"
fi

echo ""
echo "========================================"
echo "  All services stopped!"
echo "========================================"