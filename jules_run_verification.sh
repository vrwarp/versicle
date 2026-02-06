#!/bin/bash
set -e

# Help / LLM Documentation
if [[ "$1" == "--help" ]]; then
  echo "VERIFICATION TOOL DOCUMENTATION (LOCAL RUN)"
  echo "=========================================="
  echo ""
  echo "Purpose:"
  echo "  This script runs the full end-to-end verification suite for the Versicle application."
  echo "  It runs LOCALLY, bypassing Docker (which is restricted in this environment)."
  echo ""
  echo "Usage:"
  echo "  ./jules_run_verification.sh [arguments]"
  echo ""
  echo "How it works:"
  echo "  1. Installs npm and pip dependencies."
  echo "  2. Builds the app ('npm run build')."
  echo "  3. Starts the app in preview mode ('npm run preview')."
  echo "  4. Executes the Python test runner ('verification/run_all.py')."
  echo ""
  echo "Arguments:"
  echo "  All arguments passed to this script are forwarded directly to 'pytest'."
  echo ""
  exit 0
fi

# 1. Install Dependencies
echo "📦 Installing Dependencies..."
npm install --legacy-peer-deps
pip install pytest pytest-playwright pytest-xdist playwright==1.48.0
playwright install chromium

# 2. Build the App
echo "🏗️ Building the App..."
export VITE_HTTPS=false
npm run build

# 3. Start Preview Server
echo "🚀 Starting Vite Preview Server..."
# Kill any existing process on port 5173
kill $(lsof -t -i :5173) 2>/dev/null || true

npm run preview -- --port 5173 --host &
PID=$!

# Define cleanup function and trap
cleanup() {
    echo "🧹 Cleanup: Stopping Vite Preview Server..."
    kill $PID 2>/dev/null || true
}
trap cleanup EXIT

# 4. Wait for Server
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

# 5. Run Verification Tests
echo "🧪 Running verification suite..."
mkdir -p verification/screenshots

# We disable exit-on-error temporarily to capture the test exit code
set +e
python verification/run_all.py "$@"
EXIT_CODE=$?
set -e

echo "🏁 Tests finished with exit code $EXIT_CODE"
exit $EXIT_CODE
