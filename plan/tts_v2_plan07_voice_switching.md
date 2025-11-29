# Plan: Narrative Voice Switching

## Priority: Medium (Immersion)

Switching voices for dialogue vs. narration significantly improves listener comprehension and immersion.

## Goals
- Detect dialogue within text (quotes).
- Allow user to assign different voices to "Narrator" and "Dialogue".
- Synthesize segments with the appropriate voice ID.

## Proposed Files
- Modify `src/lib/tts/TextSegmenter.ts`: Add dialogue detection.
- Modify `src/lib/tts/AudioPlayerService.ts`: Handle multi-voice queuing.

## Feasibility Analysis
The core challenge is accurate extraction. `TextSegmenter` currently splits by sentence. We need to split by "quote boundary" *first*, then by sentence within those blocks? Or just sentence first, then classify?
- **Issue:** A sentence can contain both: `He said, "Hello."` -> This is one sentence but two voices.
- **Solution:** We must split this into sub-segments: `He said, ` (Narrator) and `"Hello."` (Character).
- **Complexity:** This increases the number of TTS API calls significantly (3x).
- **Cost:** User must be warned about increased cloud costs.

## Implementation Plan

1. **Update `TextSegmenter` Logic**
   - New logic: Split by quotes `“..."` or `"..."`.
   - Resulting segments need a `type` property: `narrator` | `dialogue`.
   - Example: `He said, "Go."` -> `[{text: "He said, ", type: 'narrator'}, {text: "Go.", type: 'dialogue'}]`.

2. **Update `TTSQueueItem`**
   - Add `voiceId?: string` override to the item structure.
   - Or keep `type` and let `AudioPlayerService` resolve the ID at runtime.

3. **Update `AudioPlayerService`**
   - In `play()` loop:
     - Check item type.
     - Select voice ID: `useTTSStore.narratorVoiceId` or `useTTSStore.dialogueVoiceId`.
     - Pass explicit voice ID to `provider.synthesize`.

4. **UI Settings**
   - Add "Dialogue Voice" selector in Audio Settings.
   - Add "Enable Multi-voice" toggle.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
