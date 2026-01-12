#!/bin/bash
set -e

# Build the test image (forcing clean build to pick up code changes)
docker build --no-cache -t versicle-verify -f Dockerfile.verification .

# Create screenshots directory if it doesn't exist
mkdir -p verification/screenshots

# Run the verification container
echo "🏃 Running verification tests..."
# We mount the screenshots directory to persist artifacts
docker run --rm \
  -v "$(pwd)/verification/screenshots:/app/verification/screenshots" \
  versicle-verify "$@"
