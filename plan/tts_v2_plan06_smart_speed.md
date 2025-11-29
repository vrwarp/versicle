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

## Implementation Steps

1. **Create `SilenceTrimmer`**
   - Implement `process(audioBuffer: AudioBuffer): AudioBuffer`.
   - Algorithm:
     - Analyze PCM data (Float32Array).
     - Find segments where amplitude < threshold (e.g., 0.01) for > 300ms.
     - Copy non-silent segments to a new buffer.
     - Insert short silence (200ms) where large gaps were removed.
     - Apply micro-fades (1-2ms) at cut points if not at zero-crossing.

2. **Integration**
   - In `WebAudioEngine` (or `AudioPlayerService` before queuing):
   - When a new cloud TTS segment is received (Blob -> ArrayBuffer -> AudioBuffer):
     - Run `SilenceTrimmer.process(buffer)`.
     - Queue the *processed* buffer.

3. **Performance Optimization**
   - Buffer processing can be expensive (O(N) on sample rate).
   - Consider running this in a Web Worker if main thread blocks.
   - For now, implement on main thread and benchmark.

4. **UI Toggle**
   - Add "Smart Speed" toggle in Audio Settings.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
