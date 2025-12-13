# Android Verification Suite

This directory contains Playwright tests for verifying the Capacitor application on Android devices or emulators.

## Prerequisites

1.  **Android Device or Emulator**: You must have an Android device connected via USB or an emulator running.
2.  **ADB**: `adb` must be installed and in your PATH. The device must be visible in `adb devices`.
3.  **App Installed**: The `versicle` app must be installed on the device.
    *   Package Name: `com.vrwarp.versicle`
    *   Activity: `.MainActivity` (default)
4.  **Debuggable**: The app must be debuggable (built with `debug` build type) so Playwright can inspect the WebView.

## Setup

Install the dependencies (if not already installed in the root virtual environment):

```bash
pip install pytest pytest-playwright playwright
playwright install
```

## Running Tests

To run the Android verification tests, execute `pytest` from the root directory, targeting this directory:

```bash
pytest verification/android/
```

## Structure

*   `conftest.py`: Defines fixtures for connecting to the Android device (`android_device`) and the app's WebView (`android_page`).
*   `utils.py`: Helper functions for resetting the app state and capturing screenshots.
*   `test_*.py`: The actual test files.

## Notes

*   These tests run against a real Android environment, so they cannot be run in the standard Docker verification container unless it is configured to access the host's ADB.
*   The `reset_app` utility uses `pm clear` to reset the application state between tests, which force-stops the app and clears all data.
