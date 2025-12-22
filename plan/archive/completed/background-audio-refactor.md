Design Doc: Background Audio Keep-Alive & Refactoring
=====================================================

1\. Context & Problem
---------------------

When the Versicle web app is in the background (especially on Chrome Android), TTS playback stops indefinitely at the end of a chapter.

**Root Cause:**

1.  **Chrome Throttling:** Chrome aggressively throttles background tabs that are not playing audio.

2.  **Audio Gaps:** When a chapter ends, the TTS engine stops. The current implementation (specifically in `CapacitorTTSProvider`) stops its internal "silent audio" track immediately.

3.  **Session Death:** This creates a moment of complete silence/inactivity. Chrome interprets this as the end of the media session and throttles the JavaScript process, preventing the `AudioPlayerService` from fetching and starting the next chapter.

2\. Objective
-------------

Ensure continuous, uninterrupted playback across chapter boundaries while the app is in the background.

**Key Goals:**

-   **Bridge the Gap:** Maintain an active audio session during the brief transition between chapters.

-   **Centralize Logic:** Move "silent audio" and "white noise" handling out of individual providers (like `CapacitorTTSProvider`) into a shared service.

-   **Universal Support:** Make the "White Noise" feature available for all TTS providers (Google, OpenAI, etc.), not just local ones.

3\. Proposed Solution
---------------------

We will promote `BackgroundAudio` from a simple helper to a state-aware service that manages the application's "Audio Keep-Alive" status.

### 3.1. The "Debounce" Mechanism

The core fix is a debounce (or "grace period") when stopping the background audio.

-   **Start:** When TTS starts, we immediately start the silent/noise track.

-   **Stop:** When TTS stops (e.g., chapter end), we **do not** stop the silent track immediately. Instead, we start a timer (e.g., 1000ms).

-   **Resume:** If TTS starts again (e.g., next chapter loads) within that 1000ms window, we cancel the timer. The silent track never stopped, so the browser never throttled the tab.

-   **Timeout:** If the timer expires (user actually paused), we stop the silent track to save battery.

### 3.2. Architecture Changes

#### A. Enhanced `BackgroundAudio` Service (`src/lib/tts/BackgroundAudio.ts`)

This class will become the single source of truth for keeping the browser awake.

**New API:**

-   `play(mode: 'silence' | 'noise')`: Starts audio immediately. Clears any pending stop timers.

-   `stopWithDebounce(delayMs: number)`: Schedules a stop operation.

-   `cancelDebounce()`: Cancels any pending stop operation.

-   `forceStop()`: Stops immediately (for cleanup).

**State Management:**

-   It needs to track if it's currently "keeping alive" to avoid unnecessary play calls.

-   It will manage the `HTMLAudioElement` loop and volume.

#### B. `AudioPlayerService` Integration (`src/lib/tts/AudioPlayerService.ts`)

The `AudioPlayerService` knows the high-level playback state (Playing, Paused, Loading). It will orchestrate the `BackgroundAudio`.

-   **On Play / Resume:** Call `BackgroundAudio.play(settings.backgroundMode)`.

-   **On Pause:** Call `BackgroundAudio.stopWithDebounce(500)`.

-   **On Chapter End:** Call `BackgroundAudio.stopWithDebounce(5000)`. We use a longer timeout here because loading the next chapter (fetching text, generating audio) might take a few seconds.

-   **On Next Chapter Start:** Call `BackgroundAudio.play(...)` (which cancels the timeout).

#### C. `CapacitorTTSProvider` Cleanup

-   Remove `BackgroundAudio` instantiation and usage from this provider.

-   Remove `playSilentAudio` and related internal methods.

-   The provider should focus solely on generating speech.

#### D. Global Settings (`useTTSStore`)

-   Ensure `backgroundAudioMode` ('silence' | 'noise' | 'off') is available in the store.

-   `AudioPlayerService` will read this setting to pass to `BackgroundAudio`.

4\. Implementation Steps
------------------------

1.  **Update `BackgroundAudio.ts`**:

    -   Implement the `timeoutId` logic for debouncing.

    -   Add `startKeepAlive()` and `stopKeepAlive()` methods.

    -   Ensure it handles switching between 'silence' and 'noise' seamlessly (if user changes settings while playing).

2.  **Refactor `AudioPlayerService.ts`**:

    -   Inject or import the `BackgroundAudio` singleton.

    -   Hook into `play()`, `pause()`, and the chapter transition logic (likely in `handlePlaybackEnd` or `playNext`).

    -   **Crucial:** Ensure the `AudioPlayerService` subscribes to the TTS Store to know which mode to use.

3.  **Clean `CapacitorTTSProvider.ts`**:

    -   Delete the local `BackgroundAudio` instance.

    -   Verify that removing it doesn't break the native plugin (the shared `BackgroundAudio` playing silence should be sufficient to keep the native layer happy if that was a requirement).

4.  **Verification**:

    -   **Test 1 (Background):** Play a book, lock screen, wait for chapter end. Next chapter should start automatically.

    -   **Test 2 (White Noise):** Enable white noise, play book. Noise should mix with TTS.

    -   **Test 3 (Pause):** Pause book. Silence/Noise should stop after ~1s (verify via media notification or dev tools).
