#!/bin/bash
set -e

# Help / LLM Documentation
if [[ "$1" == "--help" ]]; then
  echo "VERIFICATION TOOL DOCUMENTATION (LLM.TXT FORMAT)"
  echo "================================================"
  echo ""
  echo "Purpose:"
  echo "  This script runs the full end-to-end verification suite for the Versicle application."
  echo "  It encapsulates the environment in a Docker container to ensure consistent results."
  echo ""
  echo "Usage:"
  echo "  ./run_verification.sh [arguments]"
  echo ""
  echo "How it works:"
  echo "  1. Builds a Docker image ('versicle-verify') using 'Dockerfile.verification'."
  echo "  2. The image builds the app ('npm run build') and sets up Playwright browsers."
  echo "  3. Runs a container which:"
  echo "     a. Starts the app in preview mode ('npm run preview')."
  echo "     b. Waits for the app to become available at http://localhost:5173."
  echo "     c. Executes the Python test runner ('verification/run_all.py')."
  echo "     d. The runner executes 'pytest' with the provided arguments."
  echo ""
  echo "Arguments:"
  echo "  All arguments passed to this script are forwarded directly to 'pytest' inside the container."
  echo ""
  echo "Common Arguments & Examples:"
  echo "  - Run all tests (default):"
  echo "      ./run_verification.sh"
  echo ""
  echo "  - Run a specific test file:"
  echo "      ./run_verification.sh verification/tests/test_library.py"
  echo ""
  echo "  - Run tests matching a keyword (pytest -k):"
  echo "      ./run_verification.sh -k 'search'"
  echo ""
  echo "  - Run with specific markers:"
  echo "      ./run_verification.sh -m 'slow'"
  echo ""
  echo "  - Update visual regression snapshots:"
  echo "      ./run_verification.sh --update-snapshots"
  echo ""
  echo "  - Disable parallel execution (useful for debugging):"
  echo "      ./run_verification.sh -n 0"
  echo ""
  echo "  - Enable verbose page/console logs (sets DEBUG_PAGE_LOGS=1 in container):"
  echo "      ./run_verification.sh --logs"
  echo "      ./run_verification.sh --logs verification/test_journey_library.spec.ts"
  echo ""
  echo "Artifacts:"
  echo "  - Screenshots and test artifacts are saved to 'verification/screenshots'."
  echo "  - This directory is mounted from the host, so artifacts persist after the run."
  echo ""
  echo "Notes for Agents:"
  echo "  - Always use 'jules_run_verification.sh' wrapper to invoke this script."
  echo "  - If the build fails, check 'Dockerfile.verification' or recent code changes."
  echo "  - Tests run against a production-like build (Vite preview), not the dev server."
  exit 0
fi

# Parse flags before passing remainder to playwright
DEBUG_ENV=""
PASSTHROUGH_ARGS=()
TARGETS_WEBKIT=false
USER_SET_WORKERS=false
HAS_PROJECT=false
for arg in "$@"; do
  if [[ "$arg" == "--logs" ]]; then
    DEBUG_ENV="$DEBUG_ENV -e DEBUG_PAGE_LOGS=1"
  elif [[ "$arg" == "--probe" ]]; then
    # Enable the IndexedDB / event-loop probe (verification/_idb_probe.js) and dump
    # its summary per test. Used to diagnose WebKit TTS hangs.
    DEBUG_ENV="$DEBUG_ENV -e TTS_IDB_PROBE=1"
  else
    PASSTHROUGH_ARGS+=("$arg")
    [[ "$arg" == *webkit* ]] && TARGETS_WEBKIT=true
    [[ "$arg" == --workers* ]] && USER_SET_WORKERS=true
    if [[ "$arg" == --project* ]] || [[ "$arg" == -p ]]; then
      HAS_PROJECT=true
    fi
  fi
done

if [[ "$HAS_PROJECT" == false ]]; then
  echo "No project specified — defaulting to desktop and mobile projects."
  PASSTHROUGH_ARGS+=("--project=desktop" "--project=mobile")
fi

# WebKit is run serially (one worker). Unlike Chromium, parallel WebKit instances
# in this container contend heavily for CPU/IO, which makes the timing-sensitive TTS
# journeys flaky. Serial execution trades runtime for reliability. Only applied when
# the run explicitly targets the webkit project and the caller didn't set --workers.
if [[ "$TARGETS_WEBKIT" == true && "$USER_SET_WORKERS" == false ]]; then
  echo "🧵 WebKit target detected — running serially (--workers=1) for reliability."
  PASSTHROUGH_ARGS+=("--workers=1")
fi

# Build the test image
docker build -t versicle-verify -f Dockerfile.verification .

# Create screenshots directory if it doesn't exist
mkdir -p verification/screenshots

# Run the verification container and capture exit code
echo "🏃 Running verification tests..."
# We mount the screenshots directory to persist artifacts.
# --ipc=host: Playwright's recommended setting for browsers in Docker. The default
#   64MB /dev/shm starves the browser's shared memory and causes renderer "Page
#   crashed" failures (notably in WebKit on long, memory-heavy journeys).
docker run --rm \
  --ipc=host \
  -v "$(pwd)/verification/screenshots:/app/verification/screenshots" \
  -e BASE_URL=http://localhost:5173 \
  $DEBUG_ENV \
  versicle-verify "${PASSTHROUGH_ARGS[@]}"

# Capture the exit code from docker run
EXIT_CODE=$?

# Echo it for visibility (but this doesn't affect the script's exit code)
echo "🏁 Verification tests completed with exit code: $EXIT_CODE"

# Exit with the same code
exit $EXIT_CODE
