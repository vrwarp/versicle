#!/bin/bash
set -e

mkdir -p android-sdk/cmdline-tools
wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip
unzip -q cmdline-tools.zip -d android-sdk/cmdline-tools
mv android-sdk/cmdline-tools/cmdline-tools android-sdk/cmdline-tools/latest

export ANDROID_HOME=$(pwd)/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin

yes | sdkmanager --licenses > /dev/null
# Keep in sync with Dockerfile.android and android/variables.gradle (API 35).
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" > /dev/null

echo "Android SDK installed successfully."
