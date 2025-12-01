# Reader Components

This directory contains components used to render the Reader view, the core of the application where users read and listen to books.

## Directories

*   **`tests/`**: Unit and integration tests for reader components.

## Components

### Core Reader
*   **`ReaderView.tsx`**: The primary component responsible for rendering the EPUB content using `epub.js`. It manages the reader lifecycle, navigation, layout reflows, and integrates with the TTS service.

### Sidebars & Panels
*   **`AnnotationList.tsx`**: Displays a sidebar list of all user annotations (highlights and notes) for the current book, allowing navigation to them.
*   **`UnifiedAudioPanel.tsx`**: The "Listening Room". A comprehensive sidebar panel containing the TTS Queue, Player controls, and Audio settings.
*   **`VisualSettings.tsx`**: The "Reading Room". A popover menu for customizing visual preferences (font family, size, theme, line height).

### Overlays & Popovers
*   **`AnnotationPopover.tsx`**: A contextual popup that appears when selecting text, allowing users to create highlights or notes.
*   **`GestureOverlay.tsx`**: An invisible layer overlaid on the reader to capture touch gestures (swipes, taps) for navigation and controls when "Gesture Mode" is active.

### TTS & Dictionary
*   **`LexiconManager.tsx`**: A UI for managing Pronunciation Lexicon rules (Text replacements and Regex patterns).
*   **`TTSAbbreviationSettings.tsx`**: A settings component (typically embedded in Global Settings) to configure how TTS handles abbreviations.
*   **`TTSQueue.tsx`**: Displays the active Text-to-Speech playback queue, highlighting the current sentence and allowing navigation within the audio stream.

### Utilities
*   **`index.ts`**: Re-exports public components.
