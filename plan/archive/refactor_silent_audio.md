# Refactor Plan: Silent Audio Management in Local TTS Provider

## Context
Currently, `AudioPlayerService` manages a silent audio loop (`silentAudio`) specifically for the local `WebSpeechProvider`. This is used to keep the Media Session API active and prevent the browser from suspending the audio context during local TTS playback (especially on mobile devices).

The logic for starting/stopping/pausing this silent audio is currently embedded within `AudioPlayerService`, tightly coupled with `WebSpeechProvider` checks (e.g., `if (this.provider.id === 'local')`).

## Objective
Decouple `AudioPlayerService` from the specific implementation details of "keeping the session alive" for local TTS. Move the silent audio management logic INTO the `WebSpeechProvider` itself (or a specialized decorator/wrapper), so `AudioPlayerService` treats all providers more uniformly.

## Proposed Changes

### 1. Update `ITTSProvider` Interface?
We might need to standardize how providers signal their "active" state regarding Media Session.
*   Option A: No interface change. `WebSpeechProvider` manages silent audio internally when `synthesize`, `pause`, `resume`, `stop` are called.
*   Option B: Add `keepAlive?: boolean` flag or methods.

**Recommendation:** Option A. The provider knows best if it needs a silent audio hack.

### 2. Refactor `WebSpeechProvider`
*   Add a `silentAudio: HTMLAudioElement` property to `WebSpeechProvider`.
*   Initialize the silent audio loop in constructor or `init()`.
*   **Synthesize/Resume:** When `synthesize` or `resume` is called, `WebSpeechProvider` should ensure `silentAudio` is playing.
*   **Pause/Stop:** When `pause` or `stop` is called, `WebSpeechProvider` should pause `silentAudio`.
*   **Events:** Ensure proper cleanup.

### 3. Simplify `AudioPlayerService`
*   Remove `silentAudio` property.
*   Remove explicit calls to `this.silentAudio.play()` and `pause()` in `playInternal`, `pause`, `stop`.
*   Remove `if (this.provider.id === 'local')` checks related solely to silent audio.

## Considerations
*   **Media Session:** `AudioPlayerService` currently manages `MediaSessionManager`. The silent audio is the "anchor" that makes the browser think audio is playing. If we move it to the provider, we must ensure `AudioPlayerService` still correctly updates metadata and playback state on the *shared* `navigator.mediaSession`, or relies on the provider to do "audio output" that the browser detects.
    *   *Risk:* If `WebSpeechProvider` plays silent audio, the browser sees it as the "active audio element".
    *   `AudioPlayerService` handles `MediaSessionManager` actions (play/pause/seek). These call `service.play()`, etc.
    *   If `WebSpeechProvider` owns the audio element, `AudioPlayerService` doesn't need to touch it.

*   **Singleton vs Instance:** `WebSpeechProvider` is instantiated in `AudioPlayerService`. This works fine.

## Implementation Steps
1.  Modify `src/lib/tts/providers/WebSpeechProvider.ts` to include `SilentAudio` logic.
2.  Refactor `AudioPlayerService.ts` to remove `silentAudio` references.
3.  Update unit tests (`WebSpeechProvider.test.ts`, `AudioPlayerService_MediaSession.test.ts`).

## Impact
*   Cleaner `AudioPlayerService`.
*   Better encapsulation of browser-specific hacks (WebSpeech limitations).
*   Easier to add other local providers if needed.
