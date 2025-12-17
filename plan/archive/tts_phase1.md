# **Phase 1: Architecture Refactor - The TTS Foundation**

## **1. Objectives**

The primary goal of Phase 1 is to refactor the current monolithic TTS implementation into a modular, provider-based architecture. This prepares the codebase for supporting multiple TTS engines (like Google Cloud or OpenAI) without modifying the core player logic later. We will also implement the `AudioPlayerService` to decouple playback state management from the React lifecycle.

## **2. Design Specifications**

### **2.1. The Provider Interface (`src/lib/tts/providers/types.ts`)**

We need to define the contract that all TTS providers must adhere to. This includes types for voices and synthesis results.

```typescript
export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  provider: 'local' | 'google' | 'openai';
  // Additional metadata specific to providers can go here
}

export interface SpeechSegment {
  // For cloud providers: the audio blob
  audio?: Blob;
  // For cloud providers: timestamp alignment data
  alignment?: Timepoint[];
  // If true, the provider handles playback internally (like Web Speech API)
  isNative: boolean;
}

export interface Timepoint {
  timeSeconds: number;
  charIndex: number;
  // 'word' or 'sentence'
  type?: string;
}

export interface ITTSProvider {
  /** Unique identifier for the provider */
  id: string;

  /** Initialize the provider (load voices, check API keys) */
  init(): Promise<void>;

  /** Get available voices */
  getVoices(): Promise<TTSVoice[]>;

  /**
   * Synthesize text.
   * - Cloud providers return a Blob and Alignment data.
   * - Local providers return a specialized flag or stream.
   */
  synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment>;

  /**
   * Optional: Cancel current synthesis/playback if handled natively
   */
  stop?(): void;

  /**
   * Optional: Pause/Resume if handled natively
   */
  pause?(): void;
  resume?(): void;
}
```

### **2.2. Web Speech Adapter (`src/lib/tts/providers/WebSpeechProvider.ts`)**

We will move the logic currently in `src/hooks/use-tts.ts` and `src/lib/tts.ts` into a class that implements `ITTSProvider`.

*   **Responsibility**: Wraps `window.speechSynthesis`.
*   **Method `synthesize`**: Since Web Speech API plays audio directly, this method will return `{ isNative: true }`.
*   **Event Handling**: The provider will need to expose an event emitter or callback mechanism to notify the `AudioPlayerService` of `onboundary` events (for highlighting) and `onend` events.

### **2.3. Audio Player Service (`src/lib/tts/AudioPlayerService.ts`)**

This service will replace the simple state logic in `useTTSStore`. It will be a singleton (or Zustand-managed service) responsible for:

*   **Queue Management**: Holding a list of text segments to play.
*   **Provider Management**: Switching between the active `ITTSProvider`.
*   **Playback Control**: `play()`, `pause()`, `next()`, `prev()`.
*   **Synchronization**: It will listen to events from the active provider.
    *   If `isNative` (WebSpeech), it listens to `onboundary` events.
    *   If `!isNative` (Cloud), it will eventually play the `Blob` using an `Audio` element and monitor `ontimeupdate` (to be fully implemented in Phase 2, but stubbed here).

### **2.4. Store Updates (`src/store/useTTSStore.ts`)**

The Zustand store will be simplified to be a UI state reflector for the `AudioPlayerService`.

*   **New State Fields**:
    *   `provider`: 'local' | 'google' | ...
    *   `voices`: `TTSVoice[]` (unified list)
    *   `status`: 'loading' | 'playing' | 'paused' | 'stopped'
*   **Actions**:
    *   Most actions will now delegate to `AudioPlayerService`. e.g., `play()` calls `AudioPlayerService.play()`.

## **3. Implementation Plan**

1.  **Directory Structure Setup**:
    *   Create `src/lib/tts/`
    *   Create `src/lib/tts/providers/`
2.  **Define Interfaces**: Create `types.ts`.
3.  **Migrate Web Speech Logic**:
    *   Implement `WebSpeechProvider` class.
    *   Ensure it handles the "quirks" of browsers (e.g., `cancel` before `speak`, periodic resume to prevent garbage collection pauses if necessary).
4.  **Create AudioPlayerService**:
    *   Implement basic queueing.
    *   Integrate `WebSpeechProvider`.
5.  **Refactor Hooks**:
    *   Update `useTTS` hook to consume `AudioPlayerService` instead of direct `speechSynthesis` calls.
    *   Ensure the `extractSentences` logic remains robust (potentially moved to `src/lib/tts/text-processing.ts`).
6.  **Verify Parity**:
    *   Ensure current features (highlighting, play/pause, speed control) work exactly as before, but running through the new architecture.

## **4. Verification Steps**

*   **Unit Tests**: Test `WebSpeechProvider` (mocking `window.speechSynthesis`) and `AudioPlayerService`.
*   **Manual Test**: Open a book, verify TTS plays, highlights update correctly, and voice changing works.
