#!/bin/bash
set -e

# 1. Establish Connection
echo "🔌 Connecting to Remote Emulator..."
adb connect $ANDROID_EMULATOR_HOST:$ANDROID_EMULATOR_PORT

# 2. Build Artifact
echo "🏗️ Building Android APK (Debug)..."
cd /app/android
./gradlew assembleDebug

# 3. Install Artifact
echo "📲 Installing APK..."
adb -s $ANDROID_EMULATOR_HOST:$ANDROID_EMULATOR_PORT install -r app/build/outputs/apk/debug/app-debug.apk

# 4. Enforce Determinism (Critical for Visual Regression)
echo "⚙️ Locking UI State..."
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

# 5. Execute Tests
echo "🚀 Running Playwright Android Tests..."
cd /app
# Forward the emulator's internal WebView CDP port to the container's localhost
adb forward tcp:9222 localabstract:chrome_devtools_remote

python -m pytest verification/test_journey_android.py
