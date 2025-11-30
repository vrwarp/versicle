# TTS v2 Plan 01: Web Audio Graph Migration

## Goal
Migrate the current `AudioElement`-based playback to a **Web Audio API** based architecture.

## Status
- **Pending**

## Rationale
The current implementation uses a standard HTML5 `<audio>` element. While simple, it has significant limitations for a high-end TTS experience:
*   **Gaps:** There is often a noticeable delay between sentences as the next URL loads.
*   **Precision:** Synchronizing visual highlighters with audio is limited by the update rate of `timeupdate` events.
*   **Effects:** We cannot easily apply DSP effects (equalizer, compressor, silence trimming).
*   **Mixing:** We cannot mix in ambient sounds (Plan 11) or earcons (Plan 12) seamlessly.

## Feasibility Analysis
- **Feasibility:** High. Web Audio API is standard.
- **Complexity:** High. Requires rewriting the core playback loop in `AudioPlayerService`.
- **Dependencies:** None, but many other plans (06, 11) depend on this.
- **Risk:** Memory management with `AudioBuffer` decoding. Must implement a sliding window buffer (keep ~3-5 sentences decoded) to avoid OOM on mobile.

## Design

### 1. `WebAudioEngine` Class
A new singleton class that manages the `AudioContext`.

```typescript
class WebAudioEngine {
  context: AudioContext;
  scheduler: BufferScheduler;

  play(buffer: AudioBuffer, time: number);
  scheduleNext(buffer: AudioBuffer); // Seamlessly appends to the timeline
}
```

### 2. `BufferScheduler`
Responsible for queuing up `AudioBufferSourceNodes` to play back-to-back without gaps. It needs to look ahead and fetch/decode the next segment before the current one finishes.

### 3. Changes to `AudioPlayerService`
*   Instead of setting `audio.src = url`, it will now fetch the blob, decode it using `context.decodeAudioData()`, and pass the `AudioBuffer` to the engine.
*   It must maintain a "lookahead" buffer of at least 2-3 sentences to ensure gapless playback.

## Implementation Steps
1.  Create `src/lib/tts/audio/WebAudioEngine.ts` scaffolding.
2.  Implement `fetchAndDecode` in `AudioPlayerService`.
3.  Create a basic `schedule` function to play two buffers back-to-back.
4.  Refactor `AudioPlayerService` to use the new engine.
5.  Handle "Pause" (requires `context.suspend()` or stopping nodes and tracking offset).
6.  Handle "Seek" (requires recalculating start times).
