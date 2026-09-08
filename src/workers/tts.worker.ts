/**
 * TTS engine Web Worker entry.
 *
 * Runs the orchestration brain ({@link WorkerTtsEngine} → PlaybackController) off the main
 * thread and exposes it over Comlink. The main thread drives it via
 * {@link createWorkerEngineClient}, which injects a backend + media platform that proxy back
 * to the main thread (where the real providers, HTMLAudioElement and MediaSession live).
 *
 * Mirrors src/workers/search.worker.ts.
 */
import * as Comlink from 'comlink';
import { installAppErrorTransferHandler } from '@lib/comlinkAppError';
import { WorkerTtsEngine } from '@lib/tts/engine/WorkerTtsEngine';

// Keep AppError codes intact across the boundary (the host's GenAI calls
// throw typed errors the engine branches on; see lib/comlinkAppError.ts).
installAppErrorTransferHandler();
Comlink.expose(new WorkerTtsEngine());
