#!/bin/bash
set -e

# Cleanup function to kill background processes
cleanup() {
  echo "🧹 Cleaning up..."
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "🔧 Checking Python dependencies..."
# Only install if pytest is not found
if ! command -v pytest &> /dev/null; then
    pip install pytest pytest-playwright pytest-xdist playwright==1.48.0
    playwright install chromium
fi

echo "🔧 Checking Node.js dependencies..."
if [ ! -d "node_modules" ]; then
    npm ci --legacy-peer-deps
else
    echo "✅ node_modules exists, skipping npm ci."
fi

echo "🏗️ Building the app..."
# Disable HTTPS for verification as per Dockerfile
export VITE_HTTPS=false

# Skip build if dist exists and we are in fast mode (optional)
# For now, we always build to be safe, but we can rely on incremental build?
# npm run build runs tsc -b which is incremental.
npm run build

echo "🚀 Starting Vite Preview Server..."
# Kill any existing preview server on 5173
fuser -k 5173/tcp 2>/dev/null || true

npm run preview -- --port 5173 --host &
PID=$!

# Wait for the Server to be Ready
echo "⏳ Waiting for application to be ready at http://localhost:5173..."
RETRIES=30
for i in $(seq 1 $RETRIES); do
    if curl -s http://localhost:5173 > /dev/null; then
        echo "✅ Application is ready!"
        break
    fi
    if [ "$i" -eq "$RETRIES" ]; then
        echo "❌ Timeout waiting for application to start."
        exit 1
    fi
    sleep 1
done

echo "🧪 Running verification suite..."
# Run the verification tests
python verification/run_all.py "$@"
