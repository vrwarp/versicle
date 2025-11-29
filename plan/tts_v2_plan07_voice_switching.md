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

## Implementation Steps

1. **Update `TextSegmenter`**
   - Enhance segmentation logic to split not just by sentence, but by quote boundaries.
   - Tag segments: `{ text: "...", type: 'narrator' | 'dialogue' }`.
   - Regex: Detect text between `“` and `”` or `"`.

2. **Update Store / Settings**
   - Add `dialogueVoiceId` in addition to `voiceId` (narrator).
   - Add toggle: `enableDialogueVoice`.

3. **Update Playback Logic**
   - In `AudioPlayerService.play()`:
   - Check segment type.
   - Use `voiceId` for narrator, `dialogueVoiceId` for dialogue.
   - **Optimization:** To avoid HTTP overhead, we might want to batch contiguous dialogue segments if the provider supports it (unlikely for simple APIs).
   - *Constraint:* This increases API requests (1 sentence might become 3 parts: Narrator -> Dialogue -> Narrator).
   - *Cost:* Ensure user is aware this might triple their API usage/cost (or use local voices).

4. **Testing**
   - Test with complex sentences: `He said, "Hello there," and walked away.` -> 3 segments.
   - Verify voice switching happens correctly.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
