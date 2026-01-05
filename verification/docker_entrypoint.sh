#!/bin/bash
set -e

# 1. Start the Preview Server in the Background
echo "🚀 Starting Vite Preview Server..."
npm run preview -- --port 5173 --host &
PID=$!

# 2. Wait for the Server to be Ready
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

# 3. Run Verification Tests
echo "🧪 Running verification suite..."
# We pass all arguments ($@) to the python script, which passes them to pytest.
# This allows running `docker run ... --update-snapshots`
python verification/run_all.py "$@"
EXIT_CODE=$?

# 4. Cleanup and Exit
echo "🏁 Tests finished with exit code $EXIT_CODE"
kill $PID
exit $EXIT_CODE
