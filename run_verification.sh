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

# Build the test image
docker build -t versicle-verify -f Dockerfile.verification .

# Create screenshots directory if it doesn't exist
mkdir -p verification/screenshots

# Run the verification container and capture exit code
echo "🏃 Running verification tests..."
# We mount the screenshots directory to persist artifacts
docker run --rm \
  -v "$(pwd)/verification/screenshots:/app/verification/screenshots" \
  versicle-verify "$@"

# Capture the exit code from docker run
EXIT_CODE=$?

# Echo it for visibility (but this doesn't affect the script's exit code)
echo "🏁 Verification tests completed with exit code: $EXIT_CODE"

# Exit with the same code
exit $EXIT_CODE
