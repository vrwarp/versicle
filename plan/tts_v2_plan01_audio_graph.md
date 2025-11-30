# Plan: Audio Pipeline Infrastructure (Web Audio Graph)

## Priority: Critical (Foundation)

This plan establishes the core Web Audio API infrastructure required for advanced features like gapless playback, silence trimming, and ambience mixing. It replaces the simple `AudioElementPlayer` with a robust `WebAudioEngine` for managing audio streams.

## Goals
- Create a `WebAudioEngine` singleton to manage the `AudioContext`.
- Implement a Directed Acyclic Graph (DAG) for audio routing (Voice -> Gain -> Master -> Destination).
- Implement precise buffer scheduling for gapless playback of TTS segments.
- Handle browser autoplay policies and background audio lifecycle (iOS/Android quirks).

## Proposed Files
- `src/lib/tts/audio/WebAudioEngine.ts`: Core engine class.
- `src/lib/tts/audio/AudioGraph.ts`: Manages the nodes (Gain, Compressor, etc.).
- `src/lib/tts/audio/BufferScheduler.ts`: Handles the timing and queuing of `AudioBuffer`s.

## Feasibility Analysis
The current `AudioPlayerService` relies on `AudioElementPlayer` which wraps the HTML5 `<audio>` element. While simple, this approach has limitations regarding gapless playback (crucial for sentence-by-sentence TTS) and advanced DSP (needed for Plan 06 and 11).

Switching to the Web Audio API (`AudioContext`) is highly feasible and standard practice for these requirements. The codebase is already structured with a service layer that can swap the underlying player implementation (`AudioElementPlayer` vs `WebAudioEngine`).

**Risks:**
- **Mobile Autoplay:** iOS Safari requires `AudioContext` to be resumed inside a user interaction handler. The `resume()` method must be wired to the first "Play" click.
- **Memory Management:** `AudioBuffer` objects can consume significant memory if not garbage collected. The `BufferScheduler` must rigorously manage source nodes and buffers.
- **Background Audio:** Web Audio API contexts can be suspended by the OS when the screen locks. A common workaround (playing a silent `<audio>` element in parallel) might be needed to keep the `AudioContext` alive on iOS.

## Implementation Plan

1. **Scaffold `WebAudioEngine`**
   - Create `src/lib/tts/audio/WebAudioEngine.ts` implementing a singleton pattern.
   - Initialize `AudioContext` lazily.
   - Implement `suspend()` and `resume()` methods.

2. **Build the Audio Graph (`AudioGraph.ts`)**
   - Construct the node chain: `Source` (placeholder) -> `VoiceGainNode` -> `DynamicsCompressorNode` (to normalize volume) -> `MasterGainNode` -> `Destination`.
   - Expose properties for `voiceVolume` and `masterVolume`.

3. **Develop `BufferScheduler`**
   - Create `src/lib/tts/audio/BufferScheduler.ts`.
   - Maintain a queue of `{ buffer: AudioBuffer, startTime: number }`.
   - Use `context.currentTime` to schedule the next buffer immediately after the previous one (`startTime = prevEndTime`).
   - Implement a lookahead system: always schedule 1-2 sentences ahead to prevent gaps.

4. **Update `AudioPlayerService`**
   - Replace `AudioElementPlayer` with `WebAudioEngine` in the `setupCloudPlayback` method.
   - Modify `play()` to feed blobs into the `WebAudioEngine` (which will decode them to `AudioBuffer`s).
   - Ensure the fallback path to `WebSpeechProvider` remains intact.

5. **Verify Background Playback**
   - Test specifically on mobile.
   - If audio cuts out on lock screen, implement the "silent html audio" trick: loop a 1-second silent MP3 in a hidden `<audio>` tag whenever the `WebAudioEngine` is active.

6. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
