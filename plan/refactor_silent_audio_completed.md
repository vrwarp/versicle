# Refactor Silent Audio Management

## Context
Originally, `AudioPlayerService` managed a silent audio loop to keep the Media Session API active during local TTS playback (WebSpeech API). This logic was tightly coupled with provider checks in the service layer.

## Changes
We have moved the silent audio management logic into `WebSpeechProvider`.

### `WebSpeechProvider`
*   Now owns an `HTMLAudioElement` (`silentAudio`) initialized with a 1-second silent WAV loop.
*   `synthesize()`: Starts playing silent audio immediately.
*   `resume()`: Resumes silent audio if paused.
*   `pause()`: Pauses silent audio.
*   `stop()`: Pauses and resets silent audio.
*   `onerror`: Pauses silent audio.

### `AudioPlayerService`
*   Removed `silentAudio` property and initialization.
*   Removed explicit calls to `silentAudio.play/pause`.
*   Removed `if (this.provider.id === 'local')` checks that were solely for managing silent audio.

## Benefits
*   `AudioPlayerService` is cleaner and agnostic to the "keep-alive" hack required for local TTS.
*   The hack is encapsulated within the provider that needs it.
