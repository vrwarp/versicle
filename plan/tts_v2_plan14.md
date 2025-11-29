# Plan: Export to MP3

## Priority: Low (Utility)

Compile cached TTS segments into a single downloadable MP3/WAV file.

## Goals
- Concatenate audio buffers for a chapter.
- Encode to MP3 (or WAV).
- Trigger download.

## Proposed Files
- `src/lib/tts/exporters/AudioExporter.ts`.

## Implementation Steps

1. **Fetch Data**
   - Iterate through all text segments in a chapter.
   - Retrieve audio from `TTSCache`. If missing, warn user or generate (slow).

2. **Stitch Audio**
   - Calculate total length.
   - Create new `AudioBuffer`.
   - `set` data from source buffers at correct offsets.

3. **Encode**
   - WAV is easiest (write RIFF header + PCM data). File size is large.
   - MP3 requires `lamejs` or similar WASM encoder.
   - Start with WAV for MVP.

4. **UI**
   - "Download Chapter Audio" button in TOC or Chapter menu.
   - Progress bar during export.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
