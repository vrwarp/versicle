# Plan: User Pronunciation Lexicon

## Priority: Medium (Customization)

Users need to correct mispronunciations, especially for proper nouns in fantasy/sci-fi.

## Goals
- Allow users to define specific pronunciation rules (Find -> Replace).
- Apply these rules before synthesis.
- Persist rules per book or globally.

## Proposed Files
- `src/lib/tts/LexiconService.ts`: Manage the dictionary.
- `src/components/reader/LexiconManager.tsx`: UI for adding/editing rules.

## Implementation Steps

1. **Create `LexiconService`**
   - Store: `Map<string, string>`.
   - Methods: `addRule(original, replacement)`, `removeRule`, `getRules`.
   - Persist to IndexedDB (or `useLocalStorage` for simplicity initially).

2. **Implement Processing Logic**
   - `process(text)` method.
   - Use Regex with word boundaries `\b` to replace keys with values.
   - Sort keys by length (descending) to avoid partial replacement issues.
   - Example: Replace "Sazed" with "Say-zed".

3. **UI Integration**
   - Add "Pronunciation" option in the text selection menu (requires hooking into `epub.js` selection events).
   - Add "Manage Pronunciations" in Settings.

4. **Integration with Pipeline**
   - Call `LexiconService.process()` in `AudioPlayerService` before sending text to provider/cache.
   - Note: Changing the lexicon invalidates cached audio for those sentences. We need a strategy to clear cache or use a different cache key (include lexicon hash in key).

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
