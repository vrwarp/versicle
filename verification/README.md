# Visual Verification Suite

This directory contains the Playwright-based visual verification tests for Versicle. These tests are designed to prevent visual regressions and verify critical user journeys by capturing screenshots and asserting state.

## Directories

*   **`goldens/`**: Stores the validated "golden" screenshots. These represent the expected visual state of the application.
*   **`screenshots/`**: (Generated at runtime) Stores the screenshots captured during the most recent test run.

## Configuration & Utilities

*   **`__init__.py`**: Python package marker.
*   **`conftest.py`**: Pytest configuration file. It defines fixtures for setting up the Playwright browser context, including mobile emulation and timeout settings.
*   **`run_all.py`**: The master script to execute all verification tests. It invokes `pytest`.
*   **`utils.py`**: Contains helper functions for tests, such as `reset_app` (to clear state and load the app) and `capture_screenshot`.

## Test Scripts

### User Journeys
Tests that simulate complete user workflows.

*   **`test_journey_annotations.py`**: Verifies highlighting text and adding notes.
*   **`test_journey_audio_deck.py`**: Verifies the Unified Audio Panel (player controls, queue).
*   **`test_journey_demo_book.py`**: Verifies the functionality of loading the built-in "Alice in Wonderland" demo book.
*   **`test_journey_engine_room.py`**: Verifies the "Engine Room" (Global Settings Dialog), cycling through all tabs.
*   **`test_journey_gesture_mode.py`**: Verifies the Gesture Mode overlay and touch interactions.
*   **`test_journey_lexicon.py`**: Verifies the Pronunciation Lexicon UI (adding/editing rules).
*   **`test_journey_lexicon_csv.py`**: Verifies the CSV import/export workflow for the Lexicon.
*   **`test_journey_library.py`**: Verifies the Library view, including empty states and book ingestion.
*   **`test_journey_preroll.py`**: Verifies Chapter Preroll settings and UI.
*   **`test_journey_progress_bar.py`**: Verifies the reading progress bar on book cards.
*   **`test_journey_reading.py`**: Verifies core reading features (navigation, text rendering).
*   **`test_journey_search.py`**: Verifies full-text search and result highlighting.
*   **`test_journey_search_position.py`**: Verifies navigation to specific search results within the reader.
*   **`test_journey_visual_settings.py`**: Verifies the "Reading Room" (Visual Settings) popover (fonts, themes).

### Feature & Regression Tests

*   **`test_abbrev_settings.py`**: Verifies abbreviation handling settings.
*   **`test_bug_selection.py`**: Regression test ensuring text selection remains active after highlighting.
*   **`test_sprint1.py`**: General verification for features delivered in Sprint 1.
*   **`test_theme.py`**: Verifies global theme switching (Light/Dark/Sepia).
*   **`test_tts_queue.py`**: Verifies the behavior of the TTS playback queue.
*   **`verify_scrolled_mode.py`**: Specific verification for the "Scrolled" view mode.

## Assets

*   **`alice.epub`**: A local copy of the demo book used for consistent testing.
*   **`*.png`** (e.g., `sprint2_empty_library.png`, `error_no_book.png`): Various screenshot artifacts or references used for specific test cases or documentation.
