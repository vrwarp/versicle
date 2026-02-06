#!/bin/bash
set -e

# Help / LLM Documentation
if [[ "$1" == "--help" ]]; then
  echo "ANDROID VERIFICATION TOOL DOCUMENTATION"
  echo "======================================="
  echo ""
  echo "Purpose:"
  echo "  This script runs the Android test suite for the Versicle application."
  echo "  It encapsulates the environment in a Docker container to ensure consistent results"
  echo "  and avoids the need for a local Android-configured environment."
  echo ""
  echo "Usage:"
  echo "  ./run_android_test.sh [arguments]"
  echo ""
  echo "How it works:"
  echo "  1. Builds a Docker image ('versicle-android-test') using 'Dockerfile.android'."
  echo "  2. The image installs Android SDK, Node.js, and builds the app."
  echo "  3. Runs a container which executes './gradlew test' by default."
  echo ""
  echo "Arguments:"
  echo "  All arguments passed to this script are forwarded directly to the container."
  echo "  If arguments are provided, they OVERRIDE the default command ('./gradlew test')."
  echo ""
  echo "Examples:"
  echo "  - Run all Android unit tests (default):"
  echo "      ./run_android_test.sh"
  echo ""
  echo "  - Run a specific test class:"
  echo "      ./run_android_test.sh ./gradlew test --tests 'com.example.MyTest'"
  echo ""
  echo "  - Run with stacktrace:"
  echo "      ./run_android_test.sh ./gradlew test --stacktrace"
  echo ""
  echo "  - List tasks:"
  echo "      ./run_android_test.sh ./gradlew tasks"
  echo ""
  echo "Artifacts:"
  echo "  - Test reports are saved to 'android/app/build/reports'."
  echo "  - This directory is mounted from the host, so artifacts persist after the run."
  echo ""
  exit 0
fi

# Build the test image
echo "🔨 Building Android test image..."
docker build -t versicle-android-test -f Dockerfile.android .

# Create reports directory if it doesn't exist
mkdir -p android/app/build/reports

# Run the verification container and capture exit code
echo "🏃 Running Android tests..."
# We mount the reports directory to persist artifacts
docker run --rm \
  -v "$(pwd)/android/app/build/reports:/app/android/app/build/reports" \
  versicle-android-test "$@"

# Capture the exit code from docker run
EXIT_CODE=$?

# Echo it for visibility
echo "🏁 Android tests completed with exit code: $EXIT_CODE"

# Exit with the same code
exit $EXIT_CODE
