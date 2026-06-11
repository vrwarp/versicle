/**
 * TTS engine Web Worker entry.
 *
 * Runs the orchestration brain ({@link WorkerTtsEngine} → AudioPlayerService) off the main
 * thread and exposes it over Comlink. The main thread drives it via
 * {@link createWorkerEngineClient}, which injects a backend + media platform that proxy back
 * to the main thread (where the real providers, HTMLAudioElement and MediaSession live).
 *
 * Mirrors src/workers/search.worker.ts.
 */
import * as Comlink from 'comlink';
import { WorkerTtsEngine } from '@lib/tts/engine/WorkerTtsEngine';

Comlink.expose(new WorkerTtsEngine());
