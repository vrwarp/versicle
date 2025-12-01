# TTS Providers

This directory contains the implementations of the various Text-to-Speech engines supported by Versicle. All providers adhere to a common interface, allowing the application to switch between them seamlessly.

## Interface

*   **`types.ts`**: Defines the `ITTSProvider` interface, which specifies the contract for synthesis, voice listing, and playback control. It also defines core types like `TTSVoice` and `SpeechSegment`.

## Implementations

*   **`WebSpeechProvider.ts`**: Wraps the browser's native `window.speechSynthesis` API. This provider works offline and is free.
    *   `WebSpeechProvider.test.ts`: Unit tests for the WebSpeech wrapper.
*   **`BaseCloudProvider.ts`**: An abstract base class for REST-based cloud providers. It encapsulates common logic for network requests, error handling, and response processing.
*   **`GoogleTTSProvider.ts`**: Implementation for the Google Cloud Text-to-Speech API, extending `BaseCloudProvider`.
*   **`OpenAIProvider.ts`**: Implementation for the OpenAI TTS API, extending `BaseCloudProvider`.
*   **`MockCloudProvider.ts`**: A dummy provider used in tests to simulate cloud responses without making actual network calls.
