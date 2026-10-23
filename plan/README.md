# Project Plans and Design Documents

This directory contains the architectural plans, design sprints, and step-by-step implementation guides for the Versicle project. These documents serve as the historical and forward-looking blueprint for the application's development.

## Contents

### Overhaul program (complete)
*   **`overhaul/`**: The 2026 comprehensive overhaul. `overhaul/README.md` is the master plan (its §4 "Program rules" remain binding for every change); `analysis/`, `proposals/`, `prep/` and `judging.md` are the supporting research and per-phase preparation notes, written against the pre-overhaul tree (file paths in them are historical).

### Product vision
*   **`vision/`**: Product requirement and UX documents for the long-range roadmap (see `vision/README.md`).

### Text-to-Speech (TTS) v2
Specifications for the advanced audio features, with `tts_v2_roadmap.md` as the master plan.
*   **`tts_v2_plan*.md`**: Specific feature specifications still in this directory:
    *   **Core Audio**: Audio Graph (`plan01`).
    *   **Features**: Sleep Timer (`plan05`), Smart Speed (`plan06`), Voice Switching (`plan07`), Chapter Preroll (`plan10`), Ambient Sounds (`plan11`), Earcon Feedback (`plan12`), MP3 Export (`plan14`).
    *   **Modes**: Car Mode (`plan09`).
*   The shipped v2 specs (Media Session `plan02`, Text Sanitization `plan03`, Smart Resume `plan04`, Pronunciation Lexicon `plan08`, Gesture Pad `plan13`) moved to `archive/`.

### Feature plans and design docs
*   **Google Drive**: `gdrive-phase-1.md`, `gdrive-phase-2.md`, and the partial-metadata set (`gdrive-partial-metadata*.md`).
*   **Global notes**: `global-notes-prd.md`, `global-notes-ux.md`, `global-notes-technical-design.md`.
*   **Chinese support**: `zh-prd.md`, `zh-plan.md`, `zh-smart-pinyin-design.md`.
*   **Semantic search**: `semantic-search-design.md`, `semantic-search-tasks.md`.
*   **Other**: `compass-pill-nav-phase2.md`, `epub-toc-cover-hardening.md`, `shared-ai-cache-design.md`.

### Archive
*   **`archive/`**: Completed, deprecated and superseded plans, including `setup.md` (initial environment setup) and `deprecated/tts_enhancement_plan.md` (the first TTS iteration). Do not treat archived plans as current instructions.
