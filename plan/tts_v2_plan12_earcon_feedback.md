# Plan: Earcon Feedback

## Priority: Low (Delight)

Subtle sound effects for interactions (Skip, Pause) confirming actions without visual attention.

## Goals
- Play short beeps/clicks on user interaction.
- Essential for headless/car mode usage.

## Proposed Files
- `src/lib/tts/audio/EarconManager.ts` (or part of `WebAudioEngine`).
- Assets: simple beeps (generated via code or loaded).

## Implementation Steps

1. **Generate Sounds**
   - Use `OscillatorNode` in `WebAudioEngine` to generate simple beeps (cheaper than loading files).
     - High beep (800Hz) for Forward.
     - Low beep (400Hz) for Back.
     - Short click (noise buffer) for Pause.

2. **Trigger Logic**
   - Call `playEarcon(type)` in `AudioPlayerService` action handlers (only if triggered via Media Session or Car Mode?).
   - Or just always play them if enabled in settings.

3. **Settings**
   - Toggle: "Interaction Sounds".

4. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
