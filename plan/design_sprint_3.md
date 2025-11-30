# Design Sprint 3: The "Three Rooms" User-Centric Remodel

## 1. Executive Summary

This remodeling plan moves Versicle from a **developer-centric** structure (grouping by code module) to a **user-centric** structure (grouping by intent).
Currently, settings and controls are scattered or grouped by implementation detail. This sprint reorganizes the interface into three distinct "rooms" based on the user's mental model.

## 2. The Core Philosophy: "Three Rooms"

1.  **The Reading Room (Visual):** Transient, frequent adjustments (Font, Light) while looking at the screen.
2.  **The Listening Room (Audio):** Flow control and voice comfort while eyes are off the text.
3.  **The Engine Room (System):** Configuration, API keys, and global rules (set once, rarely touched).

## 3. High-Level Changes

### 3.1 The Visual Controller (`VisualSettings.tsx`)
*   **Goal:** Clean, non-intrusive adjustments.
*   **Location:** A compact Popover (not a full side panel) floating near the `Aa` button.
*   **Content:** Theme (Ambience), Typography (Legibility), and Layout (Format).
*   **Removed:** Audio settings, Gesture toggles (moved to other "rooms").

### 3.2 The Audio Deck (`UnifiedAudioPanel.tsx`)
*   **Goal:** Unite "Player" and "Voice Settings".
*   **Location:** Side Panel (replacing the fragmented `TTSQueue` and `TTSPanel`).
*   **Content:** Playback controls, Queue, Voice selection, Speed, Sanitization toggles.
*   **Philosophy:** Users shouldn't leave the player to change the voice.

### 3.3 The System Engine (`GlobalSettings.tsx`)
*   **Goal:** A centralized place for "Set and Forget" configuration.
*   **Location:** A Modal Dialog (via a 'Gear' icon).
*   **Content:** API Keys, Abbreviations, Gesture Mode toggles, Data management.

### 3.4 Integration Logic
*   **Header Icons:** Map `Aa` to Visual Controller, `Headphones` to Audio Deck, `Gear` to System Engine.
*   **Lexicon Hook:** Integrate lexicon editing into the text selection context menu ("Speak / Fix").

## 4. Implementation Phases

*   [Phase 1: The Visual Controller](design_sprint_3_phase1.md)
*   [Phase 2: The Audio Deck](design_sprint_3_phase2.md)
*   [Phase 3: The System Engine](design_sprint_3_phase3.md)
*   [Phase 4: Integration & Cleanup](design_sprint_3_phase4.md)
