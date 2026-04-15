# Versicle: Technical Roadmap & Master Plan

## 1. Project Overview
Versicle is a web-based EPUB manager and reader designed for a "Local-First" experience. It leverages `epub.js` for rendering and various TTS engines (Web Speech, Google, OpenAI, Piper) for audio.

**Core Principles:**
- **Local-First:** Heavy reliance on IndexedDB for storage.
- **Privacy-Centric:** Local processing where possible.
- **Hybrid-Ready:** Designed to work as a PWA and a Capacitor Android app.
- **Simplicity:** Prefers standard Web APIs (Promises, Comlink, File API) over complex custom orchestrators.

## 2. Roadmap

### 2.1 Active Priorities: TTS v2 Engine
We are building the next generation of audio features, moving from `AudioElement` to a Web Audio Graph.
*Ref: `plan/tts_v2_roadmap.md`*

| Feature | Plan File | Status |
| :--- | :--- | :--- |
| **Web Audio Graph** | [`tts_v2_plan01_audio_graph.md`](plan/tts_v2_plan01_audio_graph.md) | **Pending** (Foundation) |
| **Sleep Timer** | [`tts_v2_plan05_sleep_timer.md`](plan/tts_v2_plan05_sleep_timer.md) | Pending |
| **Smart Speed** | [`tts_v2_plan06_smart_speed.md`](plan/tts_v2_plan06_smart_speed.md) | Pending (Requires Plan 01) |
| **Voice Switching** | [`tts_v2_plan07_voice_switching.md`](plan/tts_v2_plan07_voice_switching.md) | Pending |
| **Car Mode** | [`tts_v2_plan09_car_mode.md`](plan/tts_v2_plan09_car_mode.md) | Pending |

### 2.2 Future Enhancements
- **Ambient Sounds** (`plan/tts_v2_plan11_ambient_sounds.md`)
- **Export MP3** (`plan/tts_v2_plan14_export_mp3.md`)

## 3. Completed Initiatives (Archive)
*Historical plans and completed features can be found in `plan/archive/`.*

### Major Milestone: Architectural Simplification (2025)
Ref: `plan/archive/2025_simplification/`
- **Ingestion**: Replaced crypto-hashing with "3-Point Fingerprint" (O(1) checks).
- **Concurrency**: Replaced Mutex locks with Sequential Promise Chains in `AudioPlayerService`.
- **Worker Management**: Replaced Supervisor pattern with "Let It Crash" Error Boundaries.
- **Search**: Replaced custom RPC with `Comlink`.

### Other Completed Features
- **Semantic Reading History**: Event-based history with sentence snapping (`plan/archive/completed/event-based-history.md`).
- **Reading List**: Import/Export independent reading progress (`plan/archive/completed/reading-list.md`).
- **Performance**: Optimized ReaderView re-renders (`plan/archive/completed/performance_reader_optimization.md`).
- **TTS v2 Foundations**:
    - Media Session Integration
    - Text Sanitization
    - Smart Resume
    - Pronunciation Lexicon
    - Gesture Pad

## 4. Architecture Reference
See [`architecture.md`](architecture.md) for the current detailed technical design, updated to reflect the Simplification milestone.
