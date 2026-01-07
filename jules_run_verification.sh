#!/bin/bash
set -e

# Build the verification image
echo "🔨 Building verification Docker image..."
sudo docker build -t versicle-verify -f Dockerfile.verification .

# Create screenshots directory if it doesn't exist
mkdir -p verification/screenshots

# Run the verification container
echo "🏃 Running verification tests..."
# We mount the screenshots directory to persist artifacts
sudo docker run --rm \
  -v "$(pwd)/verification/screenshots:/app/verification/screenshots" \
  versicle-verify "$@"
