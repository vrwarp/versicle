# Plan: Earcon Feedback

## Priority: Low (Delight)

Subtle sound effects for interactions (Skip, Pause) confirming actions without visual attention.

## Goals
- Play short beeps/clicks on user interaction.
- Essential for headless/car mode usage.

## Proposed Files
- `src/lib/tts/audio/EarconManager.ts` (or part of `WebAudioEngine`).
- Assets: simple beeps (generated via code or loaded).

## Feasibility Analysis
Very high feasibility. Generating beeps with `OscillatorNode` is instant and requires no assets.
- **UX:** Sounds must be subtle and non-intrusive.
- **Timing:** Must play immediately on click/tap (low latency).

## Implementation Plan

1. **`EarconManager`**
   - Methods: `playSkip()`, `playRewind()`, `playPause()`, `playResume()`.
   - Use `AudioContext.createOscillator()`.
   - envelopes (ADSR) to make them sound pleasant (not harsh beeps).
     - e.g., Sine wave, fast attack, short decay.

2. **Integration**
   - In `AudioPlayerService` methods (`next`, `prev`, `pause`, `resume`).
   - Call `EarconManager.playX()`.

3. **Settings**
   - Toggle "Interaction Sounds".

4. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
