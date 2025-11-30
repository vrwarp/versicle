# Plan: Ambient Soundscapes

## Priority: Low (Delight)

Mixes background loops (rain, fire, noise) with the TTS.

## Goals
- Play looping ambient audio.
- Independent volume control.
- Mix with TTS output.

## Proposed Files
- `src/lib/tts/audio/AmbiencePlayer.ts` (or part of `WebAudioEngine`).
- Assets: `rain.mp3`, `fire.mp3`.

## Feasibility Analysis
Requires `WebAudioEngine` (Plan 01).
- **Implementation:** Simple `AudioBufferSourceNode` with `loop = true` connected to a GainNode.
- **Assets:** Need high-quality, seamless loops. Store in `public/assets/sounds/`.
- **Memory:** Decoding a 30s MP3 to PCM takes ~5MB RAM. Negligible.

## Implementation Plan

1. **`AmbiencePlayer` Class**
   - Manage loading and playing loops.
   - Methods: `play(url, volume)`, `stop()`, `setVolume(v)`.

2. **Integration with `WebAudioEngine`**
   - `WebAudioEngine` should expose a `mixAmbience(node)` method or simply let `AmbiencePlayer` connect to `WebAudioEngine.masterGain`.

3. **UI**
   - New "Ambience" tab in Audio Settings.
   - Preset cards (Rain, Fire, Cafe).
   - Volume slider (independent of voice).

4. **Persistence**
   - Store `ambienceTrack` and `ambienceVolume` in `useTTSStore`.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
