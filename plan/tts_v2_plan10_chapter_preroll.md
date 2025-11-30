# Plan: Chapter Pre-roll (Announcer)

## Priority: Low (Delight)

Announces "Chapter [N]" and estimated time before reading the text, providing a mental bookmark.

## Status: Completed

## Goals
- Detect chapter transitions.
- Synthesize an announcement: "Chapter X. Title. Estimated time: Y minutes."
- Inject this audio before the chapter text.

## Files Modified
- `src/lib/tts/AudioPlayerService.ts`
- `src/store/useTTSStore.ts`
- `src/hooks/useTTS.ts`
- `src/components/reader/ReaderView.tsx`

## Implementation Details

1. **Generate Announcement Text**
   - Implemented `generatePreroll` in `AudioPlayerService`.
   - Uses simple word count / WPM estimation.

2. **Inject into Queue**
   - Implemented in `useTTS.ts` hook (closer to extraction logic).
   - Reads `prerollEnabled` from `useTTSStore`.
   - Prepends a `TTSQueueItem` with `isPreroll: true` and `cfi: null`.

3. **Handle Highlighting**
   - `AudioPlayerService` notifies listeners with `null` CFI for pre-roll items.
   - `SyncEngine` handles this gracefully (no action).

4. **Settings**
   - Added `prerollEnabled` to `useTTSStore`.
   - Added toggle in `ReaderView` TTS settings panel (under "Audio").

## Verification
- Unit tests added in `src/hooks/useTTS.test.ts` to verify injection logic.
- Verified that pre-roll item is created with correct text and null CFI.
