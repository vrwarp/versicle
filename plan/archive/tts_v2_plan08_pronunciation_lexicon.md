# Plan: User Pronunciation Lexicon

## Priority: Medium (Customization)

Users need to correct mispronunciations, especially for proper nouns in fantasy/sci-fi.

## Status: Implemented

## Goals
- Allow users to define specific pronunciation rules (Find -> Replace).
- Apply these rules before synthesis.
- Persist rules per book or globally.

## Proposed Files
- `src/lib/tts/LexiconService.ts`: Manage the dictionary.
- `src/components/reader/LexiconManager.tsx`: UI for adding/editing rules.

## Feasibility Analysis
This is a straightforward string replacement task.
- **Scope:** Global (all books) vs. Local (per book). MVP should be Global or Per-Book (using book ID).
- **Performance:** Iterating through a map of ~50-100 rules per sentence is negligible.
- **Cache Invalidation:** If a user changes a rule, previously cached audio for that word will be wrong.
  - *Fix:* Include the lexicon hash/version in the `TTSCache` key generation.

## Implementation Plan

1. **`LexiconService`**
   - Store rules in IndexedDB (new object store `lexicon`).
   - Interface: `{ original: string, replacement: string, bookId?: string, isRegex?: boolean }`.

2. **Processing Pipeline**
   - Create `applyLexicon(text: string, rules: Rule[]): string`.
   - Default: Use regex with word boundaries: `new RegExp("\\b" + escapeRegExp(original) + "\\b", "gi")`.
   - **Regex Mode:** If `isRegex` is true, use `new RegExp(original, "gi")` directly (no escaping, no auto-word-boundaries).
   - Case sensitivity handling? Usually we want case-insensitive match but replace with specific phonetic spelling.

3. **Integration**
   - In `AudioPlayerService.play()`, fetch rules.
   - Run `applyLexicon` on text before generating cache key or synthesizing.
   - **Important:** Modify `TTSCache.generateKey` to accept a `lexiconHash` or similar to ensure cache busting.

4. **UI**
   - Settings -> Pronunciation.
   - List of rules. Add/Edit/Delete.
   - "Test" button to speak the replacement.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
