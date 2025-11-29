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

## Implementation Steps

1. **Create `WebAudioEngine` Structure**
   - Create `src/lib/tts/audio/WebAudioEngine.ts`.
   - Implement the singleton pattern.
   - Initialize `AudioContext` (lazily or on user interaction).
   - Add `resume()` method to handle autoplay unlocking (to be called on first UI interaction).

2. **Implement Audio Graph**
   - Create `src/lib/tts/audio/AudioGraph.ts`.
   - Define the node chain: `Source` -> `VoiceGain` -> `MasterGain` -> `DynamicsCompressor` -> `Destination`.
   - Expose methods to connect sources and control volume parameters.

3. **Implement Buffer Scheduler**
   - Create `src/lib/tts/audio/BufferScheduler.ts`.
   - Implement a queue system for `AudioBuffer` objects.
   - Use `AudioBufferSourceNode` for playback.
   - Implement `schedule(buffer)` logic to play the next buffer precisely at `startTime = previousEndTime`.
   - Handle "drift" by checking `currentTime` and jumping ahead if lag occurs.

4. **Integrate with `AudioPlayerService`**
   - Modify `src/lib/tts/AudioPlayerService.ts`.
   - Import `WebAudioEngine`.
   - Replace `AudioElementPlayer` usage in `setupCloudPlayback` and `play` methods with `WebAudioEngine`.
   - Ensure `WebSpeechProvider` bypasses this engine (or runs in parallel if we add ambience later).

5. **Handle Background Playback (Keep-Alive)**
   - Add a "silence looper" or similar mechanism in `WebAudioEngine` to prevent the OS from suspending the audio thread when the screen is locked (crucial for iOS).
   - *Note:* This might involve playing a tiny silent buffer periodically or creating a dummy `<audio>` element if Web Audio API alone is insufficient on some platforms.

6. **Testing & Verification**
   - Verify cloud TTS playback (gapless transitions between sentences).
   - Verify volume controls work.
   - Verify playback continues when switching tabs or locking the screen (using the keep-alive strategy).

7. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
