# **Phase 3: Google Cloud / OpenAI Integration & Caching**

## **1. Objectives**

Phase 3 connects the infrastructure to real high-quality voices. We will implement adapters for Google Cloud TTS and/or OpenAI Audio API. Since these APIs are paid, implementing a robust caching layer in IndexedDB is critical to prevent runaway costs and enable offline re-listening of previously generated chapters.

**Status: Completed**

## **2. Design Specifications**

### **3.1. Google Cloud TTS Adapter (`src/lib/tts/providers/GoogleTTSProvider.ts`)**

*   **API Endpoint**: `https://texttospeech.googleapis.com/v1/text:synthesize`
*   **Authentication**: API Key (stored in `localStorage` by user, passed in headers).
*   **Payload**:
    *   `input`: `{ text: "..." }`
    *   `voice`: `{ languageCode: "...", name: "..." }`
    *   `audioConfig`: `{ audioEncoding: "MP3", speakingRate: ... }`
    *   **Important**: Request `enableTimepointing: ["SSML_MARK"]` or word-level timepoints if available to support highlighting.
*   **Response Parsing**:
    *   Decode `audioContent` (base64) to `Blob`.
    *   Parse `timepoints` to `Timepoint[]`.
    *   *Implementation Note*: Google TTS does not support automatic word-level timepoints for plain text without SSML marks. Current implementation defaults to sentence-level sync (one blob per segment).

### **3.2. OpenAI Adapter (`src/lib/tts/providers/OpenAIProvider.ts`)**

*   **API Endpoint**: `https://api.openai.com/v1/audio/speech`
*   **Authentication**: Bearer Token (API Key).
*   **Limitation**: OpenAI's TTS API currently **does not** return timestamp/alignment information.
    *   *Workaround*: We can only support **sentence-level** highlighting for OpenAI. The `SyncEngine` will simply highlight the entire sentence for the duration of the audio blob.

### **3.3. TTS Cache Layer (`src/lib/tts/TTSCache.ts`)**

We need to store the generated audio and metadata.

*   **IndexedDB Store**: `tts_cache`
*   **Key Generation**:
    *   We need a deterministic key. `SHA-256(text + voice_id + speed + pitch)`.
    *   Using `subtle.crypto.digest` for ID generation.
*   **Schema**:
    ```typescript
    interface CachedSegment {
      key: string;      // SHA-256 hash
      audio: ArrayBuffer;
      alignment: Timepoint[];
      createdAt: number;
      lastAccessed: number;
    }
    ```
*   **Logic**:
    *   Before calling `provider.synthesize`, check cache.
    *   If hit: return cached Blob + Alignment.
    *   If miss: call API -> save to cache -> return.

### **3.4. Settings UI Updates**

*   Add a "Voices" settings panel.
*   Allow user to input API Keys for Google/OpenAI.
*   Dropdown to select Provider.
*   Dropdown to select Voice (populated dynamically from `provider.getVoices()`).

## **3. Implementation Plan**

1.  **Cache Implementation** (Done):
    *   Update `src/db/db.ts` to include `tts_cache` store.
    *   Implement `TTSCache` class with `get(key)` and `put(key, data)`.
2.  **Google Provider** (Done):
    *   Implement `GoogleTTSProvider`.
    *   Voice ID fix implemented (using `v.name`).
3.  **OpenAI Provider** (Done):
    *   Implement `OpenAIProvider`.
4.  **UI Integration** (Done):
    *   Updated `ReaderView.tsx` to allow inputting API keys and selecting providers.
    *   Persist keys securely (not in Git, just LocalStorage via Zustand).

## **4. Verification Steps**

*   **Cache Verification**: Play a sentence. Refresh page. Play same sentence. Verify network tab shows NO new request to Google/OpenAI.
*   **Cost Check**: Verify that `synthesize` is not called for repeated text.
*   **Offline Test**: (If cache is populated) Turn off WiFi. Verify playback still works for cached segments.
