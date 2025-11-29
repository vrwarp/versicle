# Plan: Intelligent Silence Trimming ("Smart Speed")

## Priority: Medium (Quality of Life)

Trimming silence removes awkward pauses from generated TTS, creating a more natural, energetic flow. This depends heavily on the **Web Audio Infrastructure (Plan 1)**.

## Goals
- Detect silence windows (>300ms) in decoded `AudioBuffer`s.
- Remove or shorten them (clamp to ~200ms) without altering pitch.
- Ensure transitions are smooth (cross-fade/zero-crossing) to avoid clicks.

## Proposed Files
- `src/lib/tts/dsp/SilenceTrimmer.ts`: DSP logic for buffer manipulation.
- Modify `src/lib/tts/audio/WebAudioEngine.ts`: Integrate trimmer in the processing chain (or pre-processing).

## Feasibility Analysis
This is strictly a DSP task. It requires accessing the raw PCM data (`Float32Array`) from an `AudioBuffer`.
- **Constraint:** Can only work with Cloud TTS where we get a Blob/Buffer. `WebSpeechProvider` is a black box; we cannot trim silence from it.
- **Performance:** Iterating over sample arrays (e.g., 44.1kHz * 60s = 2.6M samples) in JavaScript is fast enough on modern engines, but doing it on the main thread might cause a slight UI jank. Moving it to a Worker or doing it in chunks is safer.

## Implementation Plan

1. **Create `SilenceTrimmer`**
   - Class `SilenceTrimmer` with static `process(buffer: AudioBuffer, context: AudioContext): AudioBuffer`.
   - **Algorithm:**
     1. Get channel data.
     2. Scan for silence regions (amplitude < 0.005 for > 300ms).
     3. Construct a new `AudioBuffer`.
     4. Copy non-silent regions.
     5. Insert short silence (150ms) between regions to prevent sentences running into each other too fast.
     6. Apply tiny fade-in/out (5ms) at cuts to avoid clicking.

2. **Integrate with `WebAudioEngine`**
   - In `AudioPlayerService`, when a cloud response is received and decoded:
   - `const processedBuffer = SilenceTrimmer.process(decodedBuffer, context);`
   - Send `processedBuffer` to `BufferScheduler`.

3. **Configuration**
   - Add `smartSpeedEnabled` to `useTTSStore`.

4. **Testing**
   - Unit test with a synthesized buffer containing digital silence (zeros). Verify length decreases.
   - Listening test: Ensure no words are clipped.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
