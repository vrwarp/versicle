Piper TTS Integration Hardening Plan
====================================

1\. Root Cause Analysis
-----------------------

Based on the symptoms described (worker exceptions, download fragility) and the repository structure, the following fragility vectors have been identified:

### A. Worker Fragility (The "Silent Death")

-   **Unhandled Exceptions:** Standard web workers will terminate silently or print to the console without notifying the main thread if an exception is thrown outside of a specific `try/catch` block.

-   **Memory Pressure:** Piper WASM models are large. On mobile devices, the OS may kill the worker process to reclaim memory, which looks like a crash/hang to the application.

-   **Initialization Race Conditions:** If the worker receives a `synthesize` command before the WASM is fully compiled and the model is loaded, it may panic.

### B. Download Fragility (The "Corrupt State")

-   **Partial Downloads:** If the network is interrupted while downloading the `.onnx` or `.json` file, the browser might cache the partial response. Subsequent attempts try to load this corrupt file, failing indefinitely.

-   **Synchronization:** The voice model consists of two files (`.onnx` and `.json`). If one updates (or downloads) and the other fails, the voice pack becomes unusable.

-   **CORS/Network Flakiness:** Fetching from HuggingFace or Github directly in the browser is subject to transient network errors that aren't being retried with backoff.

2\. Hardening Strategy
----------------------

### Phase 1: Robust Worker Supervision ("The Supervisor Pattern")

We need to treat the Piper Worker not as a simple function call, but as a separate process that needs supervision.

**Tasks:**

1.  **Implement `PiperProcessSupervisor`:**

    -   Create a class that wraps the `Worker` instance.

    -   **Heartbeat/Timeout:** If a synthesis request takes longer than $N$ seconds (e.g., 30s), assume the worker has hung or died. Terminate and restart it.

    -   **Auto-Restart:** If the worker throws an `error` event, automatically terminate the instance and spawn a new one, attempting to replay the failed request once.

    -   **Message Queue:** Buffer requests while the worker is restarting/initializing.

2.  **Enhance Worker Script (`patch_piper_worker.js` / Custom Worker):**

    -   Wrap the entire `onmessage` handler in a `try...catch` block.

    -   Add global `self.onerror` and `self.onunhandledrejection` handlers inside the worker to catch async WASM errors and `postMessage({ type: 'error', ... })` back to the main thread before dying.

### Phase 2: Transactional Voice Management

Downloads must be atomic. We should not attempt to load a voice unless we are 100% sure we have both files intact.

**Tasks:**

1.  **Staging Area:**

    -   Download voice files to a temporary cache or memory first.

    -   Do not write to the persistent `caches` storage until *both* files are successfully fetched.

2.  **Integrity Check (The "Test Load"):**

    -   After downloading, perform a "dry run" or checksum verification (if hashes are available in the index) before marking the voice as "Available".

    -   If a voice fails to load during initialization, automatically flag it as "Corrupt" and prompt/trigger a re-download, clearing the specific cache entries.

3.  **Resilient Fetcher:**

    -   Replace standard `fetch` with a wrapper that implements **Exponential Backoff** (retry 3 times with 1s, 2s, 4s delays) for network errors.

### Phase 3: Defensive Coding in Provider

**Tasks:**

1.  **Input Sanitization:**

    -   Ensure text sent to Piper is strictly segmented. Sending massive blocks of text is a primary cause of WASM memory crashes.

    -   Enforce a maximum character limit per request (e.g., 500 chars). Split larger requests into chained sentences.

2.  **Resource Cleanup:**

    -   Explicitly revoke ObjectURLs created for audio blobs immediately after they are attached to the audio element or finished playing to prevent memory leaks.

3\. Implementation Checklist
----------------------------

-   [x] **Step 1:** Create `src/lib/tts/providers/PiperProcessSupervisor.ts` to manage the worker lifecycle (start, kill, restart).

-   [x] **Step 2:** Modify `PiperProvider.ts` (specifically `piper-utils.ts`) to use the Supervisor instead of raw Worker interactions.

-   [x] **Step 3:** Update `src/lib/tts/providers/piper-utils.ts` to include retry logic for downloads.
    -   Implemented `fetchWithBackoff` with 3 retries (1s, 2s, 4s delay).
    -   Implemented `cacheModel` for transactional updates.

-   [x] **Step 4:** Add global error trapping to the worker script generation logic.

-   [x] **Step 5:** Add a "Repair Voice" function in the Settings UI that clears the cache for a specific voice.
    -   Implemented Transactional Download in `PiperProvider.downloadVoice`.
    -   Logic: Fetch (memory) -> Cache -> Verify (test load) -> Commit.
    -   On failure, `deleteCachedModel` is called automatically (Repair).
    -   Existing UI allows deleting (repairing) voice.

-   [x] **Step 6:** Implement Phase 3 Defensive Coding.
    -   Updated `PiperProvider.ts` to use `TextSegmenter` for input sanitization (splitting >500 char requests).
    -   Updated `piper-utils.ts` to modify `piperGenerate` to return `Blob` directly, avoiding `URL.createObjectURL` leaks.
    -   Implemented `stitchWavs` in `piper-utils.ts` to concatenate segmented audio responses efficiently.
