# Technical Design: Consolidating Android Service Management

## 1. Goal

The objective of this refactor is to move the responsibility of managing the Android Foreground Service from the high-level AudioPlayerService into the lower-level MediaSessionManager.

## 2. Rationale

Currently, AudioPlayerService acts as a "God Object," managing playback logic, queue state, and low-level operating system lifecycle primitives (Android Foreground Services). This violation of the Single Responsibility Principle has led to stability issues, specifically the ForegroundServiceStartNotAllowedException crash on Android 12+.

By moving the Foreground Service logic into MediaSessionManager, we achieve:

1.  **Logical Alignment:** On Android, the Foreground Service notification _is_ the media control notification. They are conceptually one unit. Managing them together prevents state desynchronization (e.g., Media Session thinks we are "playing", but the Service is "stopped").
2.  **Crash Prevention:** A single manager allows us to atomically handle the complex rules of Android background execution (debouncing stops, updating vs. restarting) without the AudioPlayerService needing to know platform specifics.
3.  **Code Simplification:** AudioPlayerService becomes platform-agnostic, focusing solely on reading text and managing the playlist.

## 3. Architecture Changes

### 3.1 Current State (Coupled)

*   **AudioPlayerService:**
    *   imports @capawesome/capacitor-foreground-service.
    *   Checks if (Android).
    *   Manages a foregroundStopTimer to keep the app alive during pauses.
    *   Manages Notification Channels.
*   **MediaSessionManager:**
    *   Passive wrapper around the @jofr/capacitor-media-session plugin.

### 3.2 Future State (Decoupled)

*   **AudioPlayerService:**
    *   Unaware of "Foreground Services".
    *   Simply reports state changes (Playing/Paused) and Metadata (Title/Artist) to MediaSessionManager.
*   **MediaSessionManager:**
    *   **Active Lifecycle Manager.**
    *   When told to "Play", it ensures the Android Service is running.
    *   When told to "Pause", it handles the grace period (keeping the service alive for 5 minutes) to prevent crash-loops on resume.
    *   Syncs metadata to _both_ the Media Session API and the Android Notification.

## 4. Implementation Guide

### Phase 1: Enhance MediaSessionManager.ts

1.  **Dependencies & Imports:**
    *   Import ForegroundService from @capawesome/capacitor-foreground-service.
    *   Import Capacitor to check for platform state (isNative, getPlatform() === 'android').
2.  **State Properties:**
    *   Add a private property stopTimer (type any or NodeJS.Timeout) to handle the service teardown delay.
    *   Add a private property currentMetadata to cache the latest title/artist. This is necessary because ForegroundService updates often require passing the full text body again.
3.  **Constructor Initialization:**
    *   Call a new private method setupAndroidChannel().
    *   Inside this method, check if running on Android. If so, create the notification channel (id: 'versicle\_tts\_channel', importance: 3). _Note: This logic moves here from_ _AudioPlayerService__._
4.  **Update** **setMetadata(metadata)****:**
    *   Cache the incoming metadata to this.currentMetadata.
    *   Perform the existing Media Session update.
    *   **Add Android Logic:** If on Android, attempt to call ForegroundService.updateForegroundService().
        *   Use metadata.title for the notification title.
        *   Use metadata.artist (or similar) for the notification body.
        *   Wrap this in a try/catch block. It is acceptable for this to fail if the service isn't running yet (e.g., loading state).
5.  **Update** **setPlaybackState(state)****:**
    *   **Case: 'playing'**
        *   Clear this.stopTimer if it exists. We are active now.
        *   **Start Service:** Call ForegroundService.startForegroundService().
            *   **Crucial:** This is the only place startForegroundService should be called.
            *   Pass the channel ID and button configuration (Play/Pause).
            *   Use this.currentMetadata to populate the initial notification text.
    *   **Case: 'paused' or 'none'**
        *   **Debounce Stop:** Do _not_ call stopForegroundService immediately.
        *   Start this.stopTimer with a delay (e.g., 5 minutes).
        *   Inside the timer callback, call ForegroundService.stopForegroundService(). This keeps the app "foregrounded" during short pauses or chapter transitions, preventing the Android 12 crash.

### Phase 2: Simplify AudioPlayerService.ts

1.  **Remove Cleanup:**
    *   Delete imports for ForegroundService.
    *   Delete foregroundStopTimer property.
    *   Delete scheduleForegroundStop() method.
    *   Delete engageBackgroundMode() method.
2.  **Refactor** **playInternal()****:**
    *   Remove the call to engageBackgroundMode.
    *   Keep the call to this.setStatus('playing') and this.updateMediaSessionMetadata().
    *   _Logic Check:_ Ensure updateMediaSessionMetadata is called _before_ setStatus('playing') if possible, so the manager has data ready when it starts the service.
3.  **Refactor** **loadSectionInternal()****:**
    *   The "autoPlay" fix we implemented previously relied on skipping stopInternal.
    *   With the new architecture, stopInternal will call mediaSessionManager.setPlaybackState('none').
    *   Because MediaSessionManager now handles the _delay_ internally, calling setPlaybackState('none') followed immediately by setPlaybackState('playing') (during a chapter switch) is safe. The manager will simply clear the pending stop timer and update the service, never actually tearing it down. This simplifies the autoPlay conditional logic significantly.

### 5. Verification Plan

1.  **Build & Run:** Deploy to an Android device (Physical or Emulator API 31+).
2.  **Notification Test:** Start playback. Verify the notification appears with the correct Title and Chapter.
3.  **Background Transition Test:**
    *   Play a chapter.
    *   Lock the screen (screen off).
    *   Wait for the chapter to finish.
    *   **Expected:** The next chapter starts playing, and the notification text updates to the new chapter title _without_ the notification flickering or disappearing.
4.  **Pause Persistence:**
    *   Pause playback.
    *   Verify the notification remains.
    *   Wait 5 minutes (or temporarily shorten the timer).
    *   Verify the notification disappears (service stops) to save battery.
