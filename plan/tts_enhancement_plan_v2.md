# TTS Enhancement Roadmap (v2)

This document outlines the roadmap for the next generation of Text-to-Speech features in Versicle. Each feature has a detailed implementation plan linked below.

## Critical Priority (Foundation)

### 1. Audio Pipeline Infrastructure (Web Audio Graph)
**Plan:** [plan/tts_v2_plan01.md](./tts_v2_plan01.md)
**Goal:** Migrate from `AudioElement` to a Web Audio API Directed Acyclic Graph (DAG) to enable gapless playback, precise scheduling, and DSP effects.
**Key Components:** `WebAudioEngine`, `AudioGraph`, `BufferScheduler`.

### 2. Media Session Integration
**Plan:** [plan/tts_v2_plan02.md](./tts_v2_plan02.md)
**Goal:** Enable native OS lock screen controls (Play/Pause, Seek, Next/Prev) and display rich metadata (Title, Author, Cover Art).
**Key Components:** `MediaSessionManager`.

## High Priority (Core Experience)

### 3. Text Sanitization Engine
**Plan:** [plan/tts_v2_plan03.md](./tts_v2_plan03.md)
**Goal:** Automatically remove non-narrative artifacts (page numbers, URLs, citations) from the text stream before synthesis to improve immersion.
**Key Components:** `Sanitizer`, `RegexPatterns`.

### 4. Smart Resume ("Recall" Buffer)
**Plan:** [plan/tts_v2_plan04.md](./tts_v2_plan04.md)
**Goal:** Intelligently rewind playback (10s - 60s) upon resumption based on how long the user has been away to help regain context.
**Key Components:** `useTTSStore` (lastPauseTime), `AudioPlayerService` logic.

### 5. Sleep Timer (Fade Out)
**Plan:** [plan/tts_v2_plan05.md](./tts_v2_plan05.md)
**Goal:** Implement a sleep timer that gradually fades out volume over the last minute instead of stopping abruptly.
**Key Components:** `AudioPlayerService`, `SleepTimerMenu`.

## Medium Priority (Quality & Safety)

### 6. Intelligent Silence Trimming ("Smart Speed")
**Plan:** [plan/tts_v2_plan06.md](./tts_v2_plan06.md)
**Goal:** Analyze audio buffers to detect and trim excessive silence (>300ms) to create a tighter, more natural pacing.
**Key Components:** `SilenceTrimmer`, `WebAudioEngine`.

### 7. Narrative Voice Switching
**Plan:** [plan/tts_v2_plan07.md](./tts_v2_plan07.md)
**Goal:** Use different voices or pitches for narration and dialogue (detected via quotes) to distinguish characters.
**Key Components:** `TextSegmenter` (dialogue detection), `AudioPlayerService`.

### 8. User Pronunciation Lexicon
**Plan:** [plan/tts_v2_plan08.md](./tts_v2_plan08.md)
**Goal:** Allow users to define custom pronunciation rules (Find/Replace) to correct specific words or names.
**Key Components:** `LexiconService`, `LexiconManager`.

### 9. Car Mode UI
**Plan:** [plan/tts_v2_plan09.md](./tts_v2_plan09.md)
**Goal:** A simplified, high-contrast interface with massive buttons for safe usage while driving.
**Key Components:** `CarModeView`, `WakeLock`.

## Low Priority (Delight & Utility)

### 10. Chapter Pre-roll (Announcer)
**Plan:** [plan/tts_v2_plan10.md](./tts_v2_plan10.md)
**Goal:** Synthesize and inject an announcement ("Chapter N. Title...") before starting a new chapter.
**Key Components:** `AudioPlayerService` (pre-flight injection).

### 11. Ambient Soundscapes
**Plan:** [plan/tts_v2_plan11.md](./tts_v2_plan11.md)
**Goal:** Mix looping background sounds (Rain, Fire, White Noise) with the TTS narration.
**Key Components:** `AmbiencePlayer`, `AudioGraph`.

### 12. Earcon Feedback
**Plan:** [plan/tts_v2_plan12.md](./tts_v2_plan12.md)
**Goal:** Play subtle audio cues (beeps/clicks) for interactions like skipping or pausing, essential for headless usage.
**Key Components:** `EarconManager`.

### 13. Gesture Pad Overlay
**Plan:** [plan/tts_v2_plan13.md](./tts_v2_plan13.md)
**Goal:** A full-screen invisible overlay that accepts gestures (Tap, Swipe) for blind control.
**Key Components:** `GestureOverlay`.

### 14. Export to MP3
**Plan:** [plan/tts_v2_plan14.md](./tts_v2_plan14.md)
**Goal:** Stitch cached audio segments into a single downloadable file for offline listening on other devices.
**Key Components:** `AudioExporter`.
