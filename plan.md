# Versicle: Technical Roadmap & Master Plan

## 1. Project Overview
Versicle is a web-based EPUB manager and reader designed for a "Local-First" experience. It leverages `epub.js` for rendering and various TTS engines (Web Speech, Google, OpenAI, Piper) for audio.

**Core Principles:**
- **Local-First:** Heavy reliance on IndexedDB for storage.
- **Privacy-Centric:** Local processing where possible.
- **Hybrid-Ready:** Designed to work as a PWA and a Capacitor Android app.

## 2. Roadmap

### 2.1 Current Priorities: Hardening & Stability
We are currently focusing on hardening the core systems to ensure reliability, performance, and type safety.

- **Ingestion Hardening** (`plan/hardening_ingestion.md`)
  - robust error handling for parsing, memory optimization for large files.
- **Search Hardening** (`plan/hardening_search.md`)
  - batch processing for indexing, worker stability.
- **TTS Resilience** (`plan/hardening_tts.md`)
  - state machine robustness, improved voice loading.
- **Reader Engine Stability** (`plan/hardening_reader.md`)
  - `useEpubReader` hook abstraction, better highlighting.
- **General Hardening** (`plan/general_hardening.md`)

### 2.2 Feature Roadmap: TTS v2
Building the next generation of audio features.
*Ref: `plan/tts_enhancement_plan_v2.md`*

| Feature | Plan File | Status |
| :--- | :--- | :--- |
| **Web Audio Graph** | [`tts_v2_plan01_audio_graph.md`](plan/tts_v2_plan01_audio_graph.md) | **Pending** (Foundation for effects & precise timing) |
| **Sleep Timer** | [`tts_v2_plan05_sleep_timer.md`](plan/tts_v2_plan05_sleep_timer.md) | Pending |
| **Smart Speed** | [`tts_v2_plan06_smart_speed.md`](plan/tts_v2_plan06_smart_speed.md) | Pending (Requires Plan 01) |
| **Voice Switching** | [`tts_v2_plan07_voice_switching.md`](plan/tts_v2_plan07_voice_switching.md) | Pending |
| **Car Mode** | [`tts_v2_plan09_car_mode.md`](plan/tts_v2_plan09_car_mode.md) | Pending |
| **Chapter Pre-roll** | [`tts_v2_plan10_chapter_preroll.md`](plan/tts_v2_plan10_chapter_preroll.md) | Pending |
| **Ambient Sounds** | [`tts_v2_plan11_ambient_sounds.md`](plan/tts_v2_plan11_ambient_sounds.md) | Pending |
| **Earcon Feedback** | [`tts_v2_plan12_earcon_feedback.md`](plan/tts_v2_plan12_earcon_feedback.md) | Pending |
| **Export MP3** | [`tts_v2_plan14_export_mp3.md`](plan/tts_v2_plan14_export_mp3.md) | Pending |

## 3. Completed Initiatives (Archive)
*Historical plans and completed features can be found in `plan/archive/`.*

- **Design Sprints 1-5**: Core UI, Reader, Library, Audio Panel, Settings, Navigation.
- **TTS v2 Foundations**:
    - Media Session Integration (`plan/archive/tts_v2_plan02_media_session.md`)
    - Text Sanitization (`plan/archive/tts_v2_plan03_text_sanitization.md`)
    - Smart Resume (`plan/archive/tts_v2_plan04_smart_resume.md`)
    - Pronunciation Lexicon (`plan/archive/tts_v2_plan08_pronunciation_lexicon.md`)
    - Gesture Pad (`plan/archive/tts_v2_plan13_gesture_pad.md`)
- **System Hardening**:
    - Database Hardening (Phase 1-3)
    - Verification Suite Containerization
- **Platform Support**:
    - Capacitor (Android) Transition
    - GenAI Foundations

## 4. Architecture Reference
*For the original detailed technical design document, see [`plan/archive/technical_design_reference.md`](plan/archive/technical_design_reference.md).*

### System Architecture
*   **Frontend**: React 18+ (Vite), TypeScript, TailwindCSS.
*   **State**: Zustand.
*   **Storage**: IndexedDB (via `idb`).
*   **Rendering**: `epub.js` (iframe).
*   **TTS**: Abstracted `AudioPlayerService` supporting multiple providers (WebSpeech, Piper, Google, OpenAI).

### Data Persistence (IndexedDB)
*   **books**: Metadata (Title, Author, Cover Blob).
*   **files**: Raw binary EPUBs (lazy loaded).
*   **annotations**: User highlights/notes.
*   **reading_history**: Reading progress segments.
*   **tts_queue**: Smart resume state.
*   **lexicon**: Pronunciation rules.

### TTS Architecture
The "Walk and Highlight" strategy:
1.  **Extraction**: Extract text from `epub.js` DOM.
2.  **Segmentation**: Split into sentences (`TextSegmenter`).
3.  **Sanitization**: Clean cruft (`Sanitizer`).
4.  **Queueing**: Queue for playback.
5.  **Synchronization**: Sync audio with visual highlighting via `AudioPlayerService`.
