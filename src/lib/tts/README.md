# Text-to-Speech (TTS) Engine

This directory contains the comprehensive implementation of the Text-to-Speech system, handling everything from text segmentation to audio playback and caching.

## Directories

*   **`processors/`**: Contains text processing logic, including the Sanitizer and regex patterns.
*   **`providers/`**: Contains the implementations of various TTS providers (WebSpeech, Google, OpenAI).

## Core Services

*   **`AudioPlayerService.ts`**: The heart of the TTS system. It acts as the central controller, managing the playback queue, orchestrating providers, handling buffering/pre-fetching, managing error recovery, and broadcasting state changes to the UI.
    *   `AudioPlayerService.test.ts`: Unit tests for the service.
    *   `AudioPlayerService_Resume.test.ts`: Specific tests for resume/pause behavior.
    *   `AudioPlayerService_SmartResume.test.ts`: Tests for the "Smart Resume" feature (rewinding context after pauses).
*   **`SyncEngine.ts`**: Responsible for the "Karaoke" effect. It maps audio timepoints (from providers) to the active text segment to trigger real-time highlighting.
*   **`TTSCache.ts`**: Manages the persistence of synthesized audio segments in IndexedDB to minimize API costs and latency.
*   **`MediaSessionManager.ts`**: Handles integration with the browser's Media Session API, allowing control via hardware keys, lock screens, and smartwatches.
*   **`LexiconService.ts`**: Manages the Pronunciation Lexicon, applying text replacement rules and regex transformations before synthesis.

## Components

*   **`AudioElementPlayer.ts`**: A wrapper around the native HTML5 `Audio` element, providing a clean API for playing audio Blobs and tracking progress.
*   **`CostEstimator.ts`**: Tracks and persists the number of characters synthesized via paid cloud providers (Google, OpenAI) to help users manage costs.
*   **`TextSegmenter.ts`**: A robust logic class for splitting paragraph text into individual speakable sentences, intelligently handling abbreviations, URLs, and boundary cases.
    *   `TextSegmenter.test.ts`: Unit tests for segmentation logic.
    *   `TextSegmenter.regression.test.ts`: Regression tests for known edge cases.
    *   `TextSegmenter.configurable.test.ts`: Tests verifying the impact of user-defined settings (e.g., custom abbreviations).

## Utilities

*   **`CsvUtils.ts`**: Helper functions for parsing and generating CSV files, used for Lexicon import/export.
*   **`lexiconSample.ts`**: Generates the sample CSV file provided to users as a template.
*   **`extractSentences.test.ts`**: Regression tests for the `extractSentences` function (located in `src/lib/tts.ts`), specifically ensuring that inline HTML elements (bold, links) do not cause incorrect sentence fragmentation.
