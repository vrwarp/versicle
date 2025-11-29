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

## Implementation Steps

1. **Asset Management**
   - Add assets to `public/sounds/`.

2. **Implement Player**
   - Load file into `AudioBuffer`.
   - Create `AudioBufferSourceNode` with `loop = true`.
   - Connect to `AmbienceGain` -> `MasterGain` in `WebAudioEngine`.

3. **UI Controls**
   - Add "Ambience" section in Audio Settings.
   - Selector (Rain, Fire, None).
   - Volume Slider.

4. **State Persistence**
   - Store choices in `useTTSStore`.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
