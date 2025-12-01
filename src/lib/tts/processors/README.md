# TTS Processors

This directory contains logic for cleaning and processing text before it is sent to the TTS engine.

## Files

*   **`RegexPatterns.ts`**: A centralized collection of regular expressions used for text analysis, sanitization, and segmentation. It defines patterns for URLs, abbreviations, whitespace, and more.
*   **`Sanitizer.ts`**: A class responsible for "sanitizing" text for audio consumption. It filters out non-speakable artifacts (like citation numbers, page numbers) and simplifies complex elements (like replacing long URLs with just their domain name).
    *   `Sanitizer.test.ts`: Unit tests verifying the sanitization logic.
