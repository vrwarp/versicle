/**
 * useAudioCommands — the ONE way UI components issue TTS engine commands
 * (Phase 5b-PR1; plan/overhaul/prep/phase5-tts-strangler.md §5b.4).
 *
 * Returns the bound command functions of the app-wide {@link TtsController}.
 * Components READ playback/settings state from `useTTSStore` (selectors) and
 * WRITE commands through this hook — store actions no longer wrap the engine,
 * and `@app/tts/mainThreadAudioPlayer` is import-banned outside src/app/tts/
 * (eslint no-restricted-imports).
 *
 * The returned object is stable for the lifetime of the app (the controller is
 * a singleton with bound command fields), so it is safe in dependency arrays.
 *
 * Component tests mock THIS module (`vi.mock('@app/tts/useAudioCommands')`)
 * instead of reaching for the engine composition root.
 */
import { getTtsController, type TtsController } from './TtsController';

export type AudioCommands = Pick<TtsController,
    | 'play' | 'pause' | 'stop' | 'jumpTo' | 'seek' | 'preview'
    | 'setBookId' | 'loadSectionBySectionId'
    | 'skipToNextSection' | 'skipToPreviousSection' | 'clearPauseGesture'
    | 'loadVoices' | 'downloadVoice' | 'deleteVoice' | 'checkVoiceDownloaded'
>;

export function useAudioCommands(): AudioCommands {
    return getTtsController();
}
