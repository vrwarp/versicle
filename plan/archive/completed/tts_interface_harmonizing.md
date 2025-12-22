# TTS Interface Harmonization Design

## 1. Introduction

### 1.1 Purpose
The goal of this design is to unify the interface and behavior of Local (WebSpeech, Capacitor) and Cloud (Google, OpenAI) TTS providers. Currently, the system exposes implementation details (Blobs vs Native) to the consumer. We aim to hide these details behind a unified interface where the `AudioPlayerService` simply requests to "play" text.

### 1.2 Scope
*   Redesign `ITTSProvider` to focus on a `play(text)` action.
*   Move caching and audio playback logic into a shared `BaseCloudProvider`.
*   **Simplification:** Enforce consistent behavior for Seeking and Speed changes across all providers (removing Cloud-specific optimizations).
*   Simplification of `AudioPlayerService`.

## 2. Current Architecture & Problem

### 2.1 Issues
*   **Leaky Abstraction:** `AudioPlayerService` handles Blobs for Cloud but ignores them for Local.
*   **Inconsistent Flow:** "Synthesize" means "Fetch Blob" for Cloud, but "Speak Immediately" for Local.
*   **Feature Disparity:** Cloud supports intra-sentence seeking and dynamic speed changes; Local does not. This forces branching logic in the Service.

## 3. Proposed Solution

We will adopt a **"Play-Centric"** interface with **Strict Consistency**.

### 3.1 Unified Strategy
*   **Top-Level Interface:** `ITTSProvider` exposes `play(text)`. It handles the details of how to produce sound.
*   **Consistency:** We remove the ability to seek *within* a segment and the ability to change speed dynamically without restarting. This aligns Cloud behavior with Local constraints, resulting in a single, robust code path.
*   **BaseCloudProvider:** Encapsulates the Cache -> Fetch -> Play loop for Cloud providers.

## 4. Implementation Steps

### Step 1: Interface Definition
Define the new `ITTSProvider` interface focusing on `play` and `preload`. **Remove** `seek`, `setSpeed`, and `capabilities` to enforce uniformity.

### Step 2: `BaseCloudProvider`
*   Create `abstract class BaseCloudProvider implements ITTSProvider`.
*   Inject `TTSCache`.
*   **Method `play(text, options)`**:
    *   Check Cache.
    *   If miss:
        *   Track Cost.
        *   Fetch: `const { audio, alignment } = await this.fetchAudio(text)`.
        *   Save to Cache.
    *   Emit `meta` event (with alignment).
    *   Load `audio` into internal `AudioElementPlayer`.
    *   Play.
*   **Method `preload(text)`**: Check Cache -> Fetch -> Cache.
*   **Events**: Forward `timeupdate`, `ended`, `error`.

### Step 3: Local Providers
*   **`WebSpeechProvider`**: `play(text)` calls `speak`.
*   **`CapacitorTTSProvider`**: `play(text)` calls `speak`.

### Step 4: `AudioPlayerService` Refactor
*   **Remove Code:** Delete all direct references to `AudioElementPlayer`.
*   **Remove Code:** Delete branching logic in `playInternal` (Local vs Cloud).
*   **Simplify `seek(offset)`**:
    *   Remove logic that seeks within audio `audioPlayer.seek()`.
    *   Implement unified logic: Positive offset calls `next()`, Negative offset calls `prev()`.
*   **Simplify `setSpeed(speed)`**:
    *   Remove logic that calls `player.setRate()`.
    *   Implement unified logic: Update state, `stop()`, and `play()` again.
*   **Events**: Listen for `meta` to update `SyncEngine`, `timeupdate` for MediaSession.

## 5. End State Interface Specification

### 5.1 `ITTSProvider`

```typescript
export interface TTSOptions {
  voiceId: string;
  speed: number;
  volume?: number;
}

export interface ITTSProvider {
  id: string;

  init(): Promise<void>;
  getVoices(): Promise<TTSVoice[]>;

  /**
   * Requests the provider to speak the given text.
   *
   * **Behavior:**
   * - **Cloud:** Checks cache, downloads if needed, then plays the audio blob.
   * - **Local:** Immediately triggers the native TTS engine.
   *
   * **Blocking:**
   * - Returns a Promise that resolves when playback *starts*.
   *
   * @param text The text to speak.
   * @param options Playback options (speed, voice).
   */
  play(text: string, options: TTSOptions): Promise<void>;

  /**
   * Hints to the provider that this text will be needed soon.
   */
  preload(text: string, options: TTSOptions): Promise<void>;

  pause(): void;
  resume(): void;
  stop(): void;

  on(callback: (event: TTSEvent) => void): void;
}
```

### 5.2 `BaseCloudProvider` (Abstract)

```typescript
abstract class BaseCloudProvider implements ITTSProvider {
  // ...

  /**
   * Abstract method for subclasses to implement the API call.
   */
  protected abstract fetchAudioData(text: string, options: TTSOptions): Promise<{ audio: Blob, alignment?: Timepoint[] }>;
}
```

### 5.3 Events

```typescript
export type TTSEvent =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'error'; error: any }
  | { type: 'timeupdate'; currentTime: number; duration: number }
  | { type: 'boundary'; charIndex: number }
  | { type: 'meta'; alignment: Timepoint[] };
```

### 5.4 Assumptions

1.  **Seek Behavior**: Seeking is purely "Structural" (Next/Prev Sentence). Intra-sentence seeking is explicitly unsupported to ensure consistent UX across all providers.
2.  **Speed Change**: Changing speed always requires re-synthesizing (Local) or re-playing (Cloud) the current segment. The Service handles this by stopping and playing again.
3.  **Queueing**: `AudioPlayerService` manages the queue and locking.
4.  **Cost Tracking**: `BaseCloudProvider` handles cost tracking on cache misses.
