# Design Sprint 3: Feature Regressions

The following features were removed or deprioritized during the Design Sprint 3 refactor to streamline the user experience and modularize the codebase.

## 1. TTS Cost Warning & Indicator
*   **What it did:** Displayed estimated cost for TTS session and showed a warning dialog before playing large text blocks with paid providers (Google/OpenAI).
*   **Status:** Removed.
*   **Reason:** Complexity reduction. The new "Engine Room" model delegates API key management to the user, shifting responsibility. The "Cost Indicator" UI in the old panel was tightly coupled with the panel implementation.
*   **Follow-up:** Re-introduce a simplified cost tracking display in the "TTS Engine" tab of Global Settings or a subtle indicator in the Unified Audio Panel in a future sprint.

## 2. TTS Fallback Verification (Automated Test)
*   **What it did:** `test_tts_fallback.py` verified that the app automatically switched to Local TTS if Cloud TTS failed (missing key).
*   **Status:** Test deleted; Logic preserved (in `AudioPlayerService`), but UI flow to trigger it manually (selecting provider without key) is now distributed across Global Settings and Audio Deck, making the old test journey invalid.
*   **Reason:** Test maintenance cost. The new UI flow separates configuration from playback.
*   **Follow-up:** Create a new integration test that mocks the provider failure programmatically rather than relying on UI state to trigger it.

## 3. Inline "Voice Settings" Panel
*   **What it did:** A sub-panel within the TTS overlay to configure voice/speed/provider.
*   **Status:** Replaced.
*   **Reason:** UX Improvement. Split into "Audio Deck" (Sheet) for playback/voice and "Engine Room" (Modal) for provider configuration.
