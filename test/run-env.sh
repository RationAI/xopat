#!/usr/bin/env bash
# Run the Cypress suite against a viewer started with a given deployment ENV.
# Usage: test/run-env.sh <viewer-env-file> [port=9001] [extra cypress args...]
# Starts `node index.js` with XOPAT_ENV on a side port, runs Cypress against it,
# shuts the server down. Pixel tests skipped (baseline belongs to another env).
set -euo pipefail

ENV_FILE="${1:?usage: test/run-env.sh <viewer-env-file> [port] [cypress args...]}"
PORT="${2:-9001}"
cd "$(dirname "$0")/.."

# VSCode terminals export this; it breaks the Cypress Electron binary
unset ELECTRON_RUN_AS_NODE || true

XOPAT_ENV="$ENV_FILE" XOPAT_NODE_PORT="$PORT" node index.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

echo "Waiting for viewer on port $PORT (env: $ENV_FILE)..."
for _ in $(seq 1 60); do
    if curl -sf "http://localhost:$PORT/" -o /dev/null; then
        break
    fi
    sleep 0.5
done
curl -sf "http://localhost:$PORT/" -o /dev/null \
    || { echo "Viewer did not come up on port $PORT" >&2; exit 1; }

npx cypress run --e2e \
    --env "viewer=http://localhost:$PORT/,interceptDomain=http://localhost:$PORT/**,skipPixelTests=1" \
    "${@:3}"
