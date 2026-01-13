#!/bin/bash
set -e

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
