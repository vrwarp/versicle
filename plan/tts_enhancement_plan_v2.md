# TTS Enhancement Roadmap (v2)

This document outlines the roadmap for the next generation of Text-to-Speech features in Versicle. Each feature has a detailed implementation plan linked below.

## Critical Priority (Foundation)

### 1. Audio Pipeline Infrastructure (Web Audio Graph)
**Plan:** [plan/tts_v2_plan01_audio_graph.md](./tts_v2_plan01_audio_graph.md)
**Status:** **Pending**
**Goal:** Migrate from `AudioElement` to a Web Audio API Directed Acyclic Graph (DAG) to enable gapless playback, precise scheduling, and DSP effects.
**Key Components:** `WebAudioEngine`, `AudioGraph`, `BufferScheduler`.

### 2. Media Session Integration
**Plan:** [plan/archive/tts_v2_plan02_media_session.md](./archive/tts_v2_plan02_media_session.md)
**Status:** **Completed**
**Goal:** Enable native OS lock screen controls (Play/Pause, Seek, Next/Prev) and display rich metadata (Title, Author, Cover Art).
**Key Components:** `MediaSessionManager`.

## High Priority (Core Experience)

### 3. Text Sanitization Engine
**Plan:** [plan/archive/tts_v2_plan03_text_sanitization.md](./archive/tts_v2_plan03_text_sanitization.md)
**Status:** **Completed**
**Goal:** Automatically remove non-narrative artifacts (page numbers, URLs, citations) from the text stream before synthesis to improve immersion.
**Key Components:** `Sanitizer`, `RegexPatterns`.

### 4. Smart Resume ("Recall" Buffer)
**Plan:** [plan/archive/tts_v2_plan04_smart_resume.md](./archive/tts_v2_plan04_smart_resume.md)
**Status:** **Completed**
**Goal:** Intelligently rewind playback (10s - 60s) upon resumption based on how long the user has been away to help regain context.
**Key Components:** `useTTSStore` (lastPauseTime), `AudioPlayerService` logic.

### 5. Sleep Timer (Fade Out)
**Plan:** [plan/tts_v2_plan05_sleep_timer.md](./tts_v2_plan05_sleep_timer.md)
**Status:** **Pending**
**Goal:** Implement a sleep timer that gradually fades out volume over the last minute instead of stopping abruptly.
**Key Components:** `AudioPlayerService`, `SleepTimerMenu`.

## Medium Priority (Quality & Safety)

### 6. Intelligent Silence Trimming ("Smart Speed")
**Plan:** [plan/tts_v2_plan06_smart_speed.md](./tts_v2_plan06_smart_speed.md)
**Status:** **Pending**
**Goal:** Analyze audio buffers to detect and trim excessive silence (>300ms) to create a tighter, more natural pacing.
**Key Components:** `SilenceTrimmer`, `WebAudioEngine`.

### 7. Narrative Voice Switching
**Plan:** [plan/tts_v2_plan07_voice_switching.md](./tts_v2_plan07_voice_switching.md)
**Status:** **Pending**
**Goal:** Use different voices or pitches for narration and dialogue (detected via quotes) to distinguish characters.
**Key Components:** `TextSegmenter` (dialogue detection), `AudioPlayerService`.

### 8. User Pronunciation Lexicon
**Plan:** [plan/archive/tts_v2_plan08_pronunciation_lexicon.md](./archive/tts_v2_plan08_pronunciation_lexicon.md)
**Status:** **Completed**
**Goal:** Allow users to define custom pronunciation rules (Find/Replace) to correct specific words or names.
**Key Components:** `LexiconService`, `LexiconManager`.

### 9. Car Mode UI
**Plan:** [plan/tts_v2_plan09_car_mode.md](./tts_v2_plan09_car_mode.md)
**Status:** **Pending**
**Goal:** A simplified, high-contrast interface with massive buttons for safe usage while driving.
**Key Components:** `CarModeView`, `WakeLock`.

## Low Priority (Delight & Utility)

### 10. Chapter Pre-roll (Announcer)
**Plan:** [plan/tts_v2_plan10_chapter_preroll.md](./tts_v2_plan10_chapter_preroll.md)
**Status:** **Pending**
**Goal:** Synthesize and inject an announcement ("Chapter N. Title...") before starting a new chapter.
**Key Components:** `AudioPlayerService` (pre-flight injection).

### 11. Ambient Soundscapes
**Plan:** [plan/tts_v2_plan11_ambient_sounds.md](./tts_v2_plan11_ambient_sounds.md)
**Status:** **Pending**
**Goal:** Mix looping background sounds (Rain, Fire, White Noise) with the TTS narration.
**Key Components:** `AmbiencePlayer`, `AudioGraph`.

### 12. Earcon Feedback
**Plan:** [plan/tts_v2_plan12_earcon_feedback.md](./tts_v2_plan12_earcon_feedback.md)
**Status:** **Pending**
**Goal:** Play subtle audio cues (beeps/clicks) for interactions like skipping or pausing, essential for headless usage.
**Key Components:** `EarconManager`.

### 13. Gesture Pad Overlay
**Plan:** [plan/archive/tts_v2_plan13_gesture_pad.md](./archive/tts_v2_plan13_gesture_pad.md)
**Status:** **Completed**
**Goal:** A full-screen invisible overlay that accepts gestures (Tap, Swipe) for blind control.
**Key Components:** `GestureOverlay`.

### 14. Export to MP3
**Plan:** [plan/tts_v2_plan14_export_mp3.md](./tts_v2_plan14_export_mp3.md)
**Status:** **Pending**
**Goal:** Stitch cached audio segments into a single downloadable file for offline listening on other devices.
**Key Components:** `AudioExporter`.

---

## Appendix: Implementation Dependencies

### Parallel Development
Most features in the roadmap are loosely coupled, but some share critical dependencies.

*   **Group A (Core Engine):** Plan 01 (Audio Graph) is a prerequisite for Plan 06 (Smart Speed), Plan 11 (Ambience), and Plan 05 (Fade Out quality). It should be done first.
*   **Group B (Logic/UI):** Plans 02, 03, 04, 08, 09, 10, 12, 13, 14 can be developed in parallel with each other and largely in parallel with Group A (though they eventually need to hook into the engine).
*   **Group C (Extraction):** Plan 07 (Voice Switching) and Plan 03 (Sanitization) both touch the `TextSegmenter` pipeline. It is better to do Plan 03 first to ensure clean text before complicating the segmenter with Plan 07.

### Sequential Order Recommendation

1.  **Plan 01 (Audio Graph)** - *Foundation for everything.*
2.  **Plan 02 (Media Session)** - *Completed.*
3.  **Plan 03 (Sanitization)** - *Completed.*
4.  **Plan 04 (Smart Resume)** - *Completed.*
5.  **Plan 13 (Gesture Pad)** - *Completed.*
6.  **Plan 08 (Lexicon)** - *Completed.*
7.  **Plan 05 (Sleep Timer)** - *Easy logic.*
8.  **Plan 06 (Smart Speed)** - *Requires Plan 01.*
9.  **Plan 07 (Voice Switching)** - *Complex logic.*
10. **Plan 09 - 14** - *Independent, do in any order.*
