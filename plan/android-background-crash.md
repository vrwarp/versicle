Android Background Playback Crash Resolution
============================================

1\. Overview
------------

This document describes the root cause and resolution for a critical crash occurring on Android devices running Android 12 (API 31) and above. The application crashes with a `ForegroundServiceStartNotAllowedException` when the Text-to-Speech (TTS) engine attempts to automatically transition to the next chapter while the device screen is off (app is in the background).

2\. Problem Description
-----------------------

### 2.1 Symptoms

-   The user starts listening to a book and turns off the screen.

-   Playback completes for the current chapter.

-   Instead of starting the next chapter, the audio stops abruptly.

-   The application crashes and is terminated by the OS.

### 2.2 Error Analysis

The stack trace reveals a `ForegroundServiceStartNotAllowedException`. This exception is thrown by the Android system when an app attempts to call `startForegroundService()` while running in the background.

There are two distinct failures in the logs:

1.  **Versicle Foreground Service:** The app's explicit call to start its own foreground service fails. This is caught gracefully by a `try/catch` block in `AudioPlayerService.ts`.

2.  **Media Session Plugin Service:** Immediately after, the `MediaSession` plugin attempts to start its own internal service (`io.github.jofr.capacitor.mediasessionplugin.MediaSessionService`) to handle lock-screen controls. This call is **not** guarded by the plugin, leading to a `FATAL EXCEPTION` that kills the process.

3\. Root Cause Analysis
-----------------------

### 3.1 Android 12+ Restrictions

Android 12 introduced strict limitations on background execution. Apps are generally prohibited from starting foreground services when they are not visible to the user.

There are exemptions to this rule, most notably for **Media Playback**. However, this exemption relies on the app *already* having a valid, active media session or foreground service running, or starting one while the user is interacting with the app.

### 3.2 The Implementation Flaw

The crash was caused by the specific sequence of operations during a chapter transition in `AudioPlayerService.ts`:

1.  **Chapter Ends:** The TTS engine finishes the current text.

2.  **Stop Command:** The code called `stopInternal()`.

    -   This method updated the state to `stopped`.

    -   It signaled the Media Session to release or set its state to `none`.

    -   It scheduled the teardown of the Foreground Service.

3.  **Load Next Chapter:** The app loaded the new content.

4.  **Start Command:** The code called `playInternal()`.

    -   This method attempted to *re-engage* the background mode (`engageBackgroundMode`).

    -   It called `startForegroundService` to update the notification with the new chapter title.

**The Failure:** By calling `stopInternal()`, the app effectively relinquished its "active media" status in the eyes of the OS. When it immediately tried to `startForegroundService` again for the new chapter, the OS treated it as a **new** background start request from a backgrounded app, which is forbidden.

4\. Solution Design
-------------------

### 4.1 Strategy: Service Continuity

The solution is to maintain the Foreground Service's lifecycle continuously across chapter transitions. We must avoid "stopping" the service only to restart it milliseconds later.

### 4.2 Logic Changes

The `loadSectionInternal` method (responsible for loading chapter data) was modified to distinguish between a user-initiated stop and an automatic transition (`autoPlay`).

**Old Flow (Crashing):** `Finish Chapter` -> `Stop Service` (Loss of Privileges) -> `Load Data` -> `Start Service` (Blocked & Crash)

**New Flow (Fixed):** `Finish Chapter` -> `Save State` -> `Stop Audio Provider` (Silence) -> `Load Data` -> `Update Metadata` -> `Resume Audio Provider`

In the new flow, the `AudioPlayerService` status remains `playing` (or `loading`) throughout the transition. The Android Foreground Service is never torn down, so the app retains its execution privileges.

5\. Implementation Details
--------------------------

The fix involves editing `src/lib/tts/AudioPlayerService.ts`.

1.  **Conditional Stopping:** In `loadSectionInternal`, we now check the `autoPlay` flag.

    -   If `true` (automatic transition): We simply stop the audio output (`provider.stop()`) and save the playback position. We explicitly **skip** calling `stopInternal()`.

    -   If `false` (user selected a chapter): We perform the full stop/reset as before.

2.  **Metadata Updates:** Since the service is already running, the subsequent call to `updateMediaSessionMetadata` in `playInternal` acts as an *update* to the existing notification rather than a request to start a new service. This is permitted by Android.

3.  **Guard Clauses:** As a secondary defense, `playInternal` now checks if the background engagement was successful before attempting to set the Media Session playback state. This prevents the specific `FATAL EXCEPTION` from the plugin if the service start ever fails in the future.

6\. Verification
----------------

To verify this fix:

1.  Open the app and start playing a chapter.

2.  Seek to within a few seconds of the end of the chapter.

3.  Turn off the device screen (lock the device).

4.  Wait for the audio to finish.

5.  **Success:** The audio for the next chapter begins automatically, and the lock screen metadata updates to the new chapter title.

6.  **Failure:** The audio stops, and the app crashes (verify via `adb logcat`).

### Automated Verification
A verification test suite has been added in `src/verification/test_background_crash.test.ts`. This test mocks the Capacitor plugins and verifies that `stopForegroundService` is not called during an automatic chapter transition, ensuring service continuity.

### Deviations
No major deviations from the original plan. The verification suite was added to ensure regression testing is possible without a physical device.
