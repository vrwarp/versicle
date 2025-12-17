# **Phase 2: Cloud Foundation - Audio Infrastructure**

## **1. Objectives**

Phase 2 focuses on enabling Versicle to play "real" audio files, paving the way for cloud-based TTS. Since Web Speech API handles its own playback, we need a parallel system for playing audio Blobs (MP3/WAV) returned by cloud providers. This phase also introduces "Background Play" capabilities using the Media Session API, ensuring the book can be listened to like a podcast.

## **2. Design Specifications**

### **2.1. HTML5 Audio Integration (`src/lib/tts/AudioElementPlayer.ts`)**

We need a wrapper around the browser's `Audio` object.

*   **Responsibility**: Play audio Blobs or URLs.
*   **Events**:
    *   `timeupdate`: Fired continuously during playback. Used for synchronization.
    *   `ended`: Fired when a segment finishes. Used to trigger the next segment in the queue.
    *   `error`: Handling decode errors or network issues.
*   **Integration**: The `AudioPlayerService` created in Phase 1 will now instantiate this `AudioElementPlayer` when a non-native provider is active.

### **2.2. Abstract Cloud Provider Base (`src/lib/tts/providers/BaseCloudProvider.ts`)**

A base class to reduce boilerplate for Google/OpenAI/Amazon implementations.

*   **Functionality**:
    *   Handle HTTP requests to TTS endpoints.
    *   Standardize error handling (401, 403, 429).
    *   (Future) Handle caching checks before making requests.

### **2.3. Media Session API Integration**

To support background play and lock-screen controls, we must integrate `navigator.mediaSession`.

*   **Metadata Updates**: When a new chapter or book starts, update `mediaSession.metadata` with:
    *   `title`: Chapter Title
    *   `artist`: Author Name
    *   `album`: Book Title
    *   `artwork`: Cover image (extracted from `epub.js` or `IndexedDB`).
*   **Action Handlers**:
    *   `previoustrack`: Jump to previous sentence/paragraph.
    *   `nexttrack`: Jump to next sentence/paragraph.
    *   `play`/`pause`: Toggle playback.
    *   `seekto`: Seek within the current audio segment.

### **2.4. Synchronization Engine v1 (`src/lib/tts/SyncEngine.ts`)**

We need a module that translates "Time" into "Location".

*   **Input**: `currentTime` (seconds) and `AlignmentData` (JSON array from provider).
*   **Logic**:
    *   Find the entry in `AlignmentData` where `entry.time <= currentTime`.
    *   Extract `charIndex` or `textOffset`.
    *   Map this offset back to the original text segment.
    *   **Crucial Step**: The `AudioPlayerService` must maintain the mapping between the *Audio Segment* currently playing and the *CFI* of the text sentence.
    *   Emit `cfiUpdate` events to the UI for highlighting.

## **3. Implementation Plan (Completed)**

1.  **Audio Player Implementation**:
    *   [x] Create `AudioElementPlayer` class.
    *   [x] Add methods `playBlob(blob)`, `pause()`, `resume()`.
2.  **Enhance AudioPlayerService**:
    *   [x] Add logic to switch output: If `provider.isNative`, use internal logic. Else, get `SpeechSegment` (audio + alignment) and pass to `AudioElementPlayer`.
3.  **Media Session Setup**:
    *   [x] In `AudioPlayerService`, add `setupMediaSession()` method.
    *   [x] Hook up the event listeners to the service's control methods.
4.  **Sync Logic**:
    *   [x] Implement the `SyncEngine` class.
    *   [x] Since we don't have a real cloud provider yet, create a **MockCloudProvider** that returns a static audio file (e.g., a simple MP3 in public folder) and a fake alignment JSON for testing purposes.
5.  **Background Play Testing**:
    *   [x] Ensure that when the tab is hidden or minimized, audio continues playing (unlike visual-dependent rendering loops).

## **4. Verification Steps**

*   **Mock Test**: Use the `MockCloudProvider` to play audio. Verify `AudioElementPlayer` works.
*   **Background Test**: Start playback, switch tabs, verify audio continues.
*   **Lock Screen**: On a mobile device (or supported desktop), verify lock screen controls (Play/Pause/Next) control the application.
