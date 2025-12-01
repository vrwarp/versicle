# Project Plans and Design Documents

This directory contains the architectural plans, design sprints, and step-by-step implementation guides for the Versicle project. These documents serve as the historical and forward-looking blueprint for the application's development.

## Contents

### General Roadmap & Setup
*   **`setup.md`**: Initial environment setup and project initialization guide.
*   **`step01.md` - `step08.md`**: The original sequential roadmap for building the application, covering features from basic ingestion to PWA support.

### Design Sprints
Focused efforts on UI/UX and architectural refactoring.
*   **`design_sprint_1.md`**: Initial UI design improvements based on Material Design principles.
*   **`design_sprint_2.md`**: Further UI refinements.
*   **`design_sprint_3.md`** and related files (`_phaseX.md`, `_regressions.md`): Documentation for the "Three Rooms" architecture (Reading Room, Listening Room, Engine Room) and the associated refactoring process.

### Text-to-Speech (TTS) Enhancements
Detailed specifications for the advanced audio features.
*   **`tts_enhancement_plan.md`**: The first iteration of TTS improvements.
*   **`tts_enhancement_plan_v2.md`**: The master plan for TTS v2.
*   **`tts_phase*.md`**: Detailed breakdown of the first TTS enhancement phase.
*   **`tts_v2_plan*.md`**: Specific feature specifications for TTS v2, covering:
    *   **Core Audio**: Audio Graph (`plan01`), Media Session (`plan02`).
    *   **Processing**: Text Sanitization (`plan03`), Smart Resume (`plan04`), Smart Speed (`plan06`).
    *   **Features**: Sleep Timer (`plan05`), Voice Switching (`plan07`), Pronunciation Lexicon (`plan08`), Chapter Preroll (`plan10`), Ambient Sounds (`plan11`), Earcon Feedback (`plan12`), Gesture Pad (`plan13`), MP3 Export (`plan14`).
    *   **Modes**: Car Mode (`plan09`).
