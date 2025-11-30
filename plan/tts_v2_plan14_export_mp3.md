# Plan: Export to MP3

## Priority: Low (Utility)

Compile cached TTS segments into a single downloadable MP3/WAV file.

## Goals
- Concatenate audio buffers for a chapter.
- Encode to MP3 (or WAV).
- Trigger download.

## Proposed Files
- `src/lib/tts/exporters/AudioExporter.ts`.

## Feasibility Analysis
- **Data Source:** We rely on `TTSCache`. If items aren't in cache, we must synthesize them. This could be slow and cost money. We should only allow export if all segments are cached or warn the user.
- **Encoding:** `lamejs` is slow in JS main thread. WAV is huge.
  - *Recommendation:* Start with WAV (simple concatenation of PCM). It's fast and universally supported. Users can convert later.

## Implementation Plan

1. **`AudioExporter` Class**
   - `exportChapter(chapterItems: TTSQueueItem[])`.
   - Step 1: Check Cache. Return list of missing items.
   - Step 2: If missing > 0, ask user to "Generate Missing" (calls provider).
   - Step 3: Fetch all Blobs from Cache.
   - Step 4: Decode to AudioBuffers (using `AudioContext`).
   - Step 5: Concatenate into one giant Buffer.
   - Step 6: Encode to WAV (interleave channels, write headers).
   - Step 7: Trigger Download (`URL.createObjectURL`).

2. **UI**
   - "Download Audio" in Chapter Menu.
   - Progress bar (0-100%).

3. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
