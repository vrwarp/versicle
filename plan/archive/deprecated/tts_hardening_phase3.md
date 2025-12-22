# Phase 3: Resilience, Error Recovery & Diagnostics

## Objective
Ensure the system recovers gracefully from external failures (Network, Browser Audio, API limits) and provides actionable debug info.

## Implementation Details

### 1. WebSpeech Watchdog
Browser TTS sometimes silently stops firing events.
*   **Action:** Implement a heartbeat monitor.
*   **Logic:**
    *   Start a timer when `start` event fires.
    *   Reset timer on `boundary` events.
    *   If timer expires (e.g., 5s with no event while "playing"), assume crash.
    *   **Recovery:** `speechSynthesis.cancel()` -> `speechSynthesis.speak()`.

### 2. Circuit Breaker for Cloud TTS
Prevent retry loops that drain quotas or batter the API.
*   **Logic:**
    *   Track `failureCount` for Cloud Provider.
    *   If `failureCount > 3` in 1 minute:
        *   Switch to `WebSpeechProvider`.
        *   Set `coolDown` timer (e.g., 5 minutes).
        *   Notify user: "Network instability detected. Switched to local voice temporarily."
    *   After `coolDown`, attempt Cloud again on next sentence.

### 3. Debug Snapshot Export
Allow users to download their state when reporting bugs.
*   **Action:** specific function `exportDebugState()`.
*   **Content:**
    *   Browser Info (UserAgent).
    *   Current Queue (anonymized text if needed, or just lengths/CFIs).
    *   Log Buffer (keep last 50 logs in memory).
    *   Store State (Settings).
*   **UI:** Add "Export Debug Info" button in Global Settings -> Data Management.

### 4. Implementation Plan
1.  **Watchdog:** Add `WatchdogTimer` class to `WebSpeechProvider`.
2.  **Circuit Breaker:** Add logic to `AudioPlayerService` error handler.
3.  **Diagnostics:** Create `DebugService` or utility in `AudioPlayerService` to gather data.

## Risks
*   **False Positives:** Watchdog might kill valid long pauses (though rare in TTS).
*   **Complexity:** Managing the "Cool-down" state adds more state flags.

## Verification
*   **Automated:** Mock `speechSynthesis` to simulate "hanging" (no events). Verify Watchdog restarts it.
*   **Manual:** Disconnect WiFi while using Cloud Voice. Verify graceful fallback and cooldown behavior.
