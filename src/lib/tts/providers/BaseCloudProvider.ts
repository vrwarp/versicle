import { egress, retryAfterMs, type DestinationId } from '@kernel/net';
import type { QuotaGovernor } from '@kernel/quota';
import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice, SpeechSegment, Unsubscribe } from './types';
import { AudioElementPlayer } from '../AudioElementPlayer';
import type { AudioSink } from '../engine/AudioSink';
import { TTSCache } from '../TTSCache';

/** Max wall time for one synthesis round-trip before it is abandoned (TimeoutError). */
const SYNTHESIS_TIMEOUT_MS = 30_000;

/**
 * The slice of the shared rate/spend governor that the cloud-TTS request path
 * needs. Reserving budget before a request (`acquire`) and refunding it when the
 * request fails (`release`) are handled centrally in the NetworkGateway, where
 * every outbound request must pass through and so cannot bypass the limit. That
 * leaves this path only the after-the-fact bookkeeping: `commit` to record what
 * a successful response actually spent, and `recordCooldown` to honor a server
 * 429's back-off — both of which need the parsed response the gateway never
 * inspects.
 */
type TtsQuotaGovernor = Pick<QuotaGovernor, 'commit' | 'recordCooldown'>;

/**
 * Module-level governor holder, installed once at the TTS composition root
 * (src/app/google/wireGoogle.ts via {@link setTtsQuotaGovernor}). A holder
 * rather than a constructor param keeps {@link BaseCloudProvider}'s signature
 * (and every subclass `super()` + every direct-construction provider unit test)
 * untouched while still routing every cloud-TTS request through the governor.
 * `null` (the default) makes the governor a no-op, so provider tests that never
 * install one behave exactly as before.
 */
let ttsGovernor: TtsQuotaGovernor | null = null;

/** Install the cloud-TTS rate/spend governor (called once at the composition root). */
export function setTtsQuotaGovernor(governor: TtsQuotaGovernor | null): void {
  ttsGovernor = governor;
}

/** ~4-chars-per-token estimate for the up-front budget reservation (commit corrects it). */
function estTtsTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  protected voices: TTSVoice[] = [];
  protected audioPlayer: AudioSink;
  protected cache: TTSCache;
  protected eventListeners: ((event: TTSEvent) => void)[] = [];
  protected requestRegistry: Map<string, Promise<SpeechSegment>> = new Map();
  /** Whether the sink was injected (shared, manager-owned) or self-constructed. */
  private readonly ownsSink: boolean;
  private disposed = false;
  /** Aborts in-flight synthesis fetches on stop()/dispose() (5a-PR2). */
  private abortController: AbortController | null = null;

  /**
   * @param audioSink The audio-output device. The manager injects ONE shared
   *   {@link AudioElementPlayer} so provider swaps reuse the same element; tests inject
   *   a `FakeAudioSink`. When absent (direct construction) the provider creates its own.
   * @param cache The synthesized-audio cache. Injectable so provider unit tests can use
   *   an in-memory fake instead of mocking the module (vi.mock is banned in providers/).
   */
  constructor(audioSink?: AudioSink, cache: TTSCache = new TTSCache()) {
    this.ownsSink = !audioSink;
    this.audioPlayer = audioSink ?? new AudioElementPlayer();
    this.cache = cache;
    this.setupAudioPlayer();
  }

  protected setupAudioPlayer() {
    this.audioPlayer.setOnTimeUpdate((time) => {
        this.emit({ type: 'timeupdate', currentTime: time, duration: this.audioPlayer.getDuration() });
    });
    this.audioPlayer.setOnEnded(() => {
        this.emit({ type: 'end' });
    });
    // Mid-playback sink errors (after play() resolved) — the one legitimate use of the
    // 'error' EVENT under the single-shot contract (failures to start reject instead).
    this.audioPlayer.setOnError((e) => {
        this.emit({
            type: 'error',
            error: { message: e ? `Media error ${e.code}${e.message ? `: ${e.message}` : ''}` : 'Media playback error' },
        });
    });
  }

  abstract init(): Promise<void>;

  async getVoices(): Promise<TTSVoice[]> {
    return this.voices;
  }

  /**
   * Single-shot failure contract (ITTSProvider.play, 5a-PR2): resolves when audible
   * playback has started; REJECTS exactly once on failure — it never also emits an
   * `error` event for the same failure. The pre-5a emit+rethrow double-signal (one
   * half of the S2 fallback double-fire) is gone; the engine owns recovery, keyed
   * on the rejection the manager rethrows as `ProviderPlaybackError`.
   */
  async play(text: string, options: TTSOptions): Promise<void> {
    const { audio } = await this.getOrFetch(text, options);

    // We need to wait for playback to START. playBlob resolves when it starts.
    if (audio) {
      await this.audioPlayer.playBlob(audio);
    }
    // Speed policy: audio is always synthesized at 1.0; `options.speed` is a
    // playback-time rate applied at the sink AFTER the source is loaded, because the
    // media load algorithm resets `playbackRate` whenever a new src is assigned
    // (the sink also pins `defaultPlaybackRate` so later loads inherit the rate).
    this.audioPlayer.setRate(options.speed);
    this.emit({ type: 'start' });
  }

  async preload(text: string, options: TTSOptions): Promise<void> {
    try {
      await this.getOrFetch(text, options);
    } catch (e) {
      console.warn("Preload failed", e);
    }
  }

  protected async getOrFetch(text: string, options: TTSOptions): Promise<SpeechSegment> {
    // The cache key is speed-independent: synthesis always happens at 1.0 and the
    // playback rate is applied at the sink, so one cached blob serves every speed.
    const cacheKey = await this.cache.generateKey(text, options.voiceId);

    // 1. Permanent Cache Check
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return {
        audio: new Blob([cached.audio], { type: 'audio/mp3' }),
        alignment: cached.alignment
      };
    }

    // 2. Active Registry Check
    const existingPromise = this.requestRegistry.get(cacheKey);
    if (existingPromise) {
      return await existingPromise;
    }

    // 3. Initiate Fetch (Owner)
    const fetchPromise = (async () => {
      const lease = this.synthesisLease();
      try {
        const result = await this.fetchAudioData(text, options, lease.signal);
        if (!result.audio) {
          throw new Error("No audio returned from provider");
        }

        // Write to permanent cache
        await this.cache.put(cacheKey, await result.audio.arrayBuffer(), result.alignment);

        return result;
      } finally {
        lease.release();
        // Cleanup registry
        this.requestRegistry.delete(cacheKey);
      }
    })();

    this.requestRegistry.set(cacheKey, fetchPromise);
    return await fetchPromise;
  }

  /**
   * A per-request AbortSignal combining the provider-level controller (aborted by
   * `stop()`/`dispose()` — rejects as AbortError, a deliberate interruption) with a
   * synthesis timeout (rejects as TimeoutError — a provider failure the engine may
   * recover from). Composed manually: `AbortSignal.any` is too new for the older
   * WebKit versions this app still targets.
   */
  private synthesisLease(): { signal: AbortSignal; release(): void } {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    const upstream = this.abortController.signal;
    const local = new AbortController();
    const onUpstreamAbort = () => local.abort(upstream.reason);
    if (upstream.aborted) {
      onUpstreamAbort();
    } else {
      upstream.addEventListener('abort', onUpstreamAbort, { once: true });
    }
    const timeout = setTimeout(
      () => local.abort(new DOMException(`TTS synthesis timed out after ${SYNTHESIS_TIMEOUT_MS}ms`, 'TimeoutError')),
      SYNTHESIS_TIMEOUT_MS,
    );
    return {
      signal: local.signal,
      release: () => {
        clearTimeout(timeout);
        upstream.removeEventListener('abort', onUpstreamAbort);
      },
    };
  }

  /** Abort every in-flight synthesis fetch (they reject as AbortError). */
  private abortInFlight(): void {
    if (this.abortController) {
      this.abortController.abort(new DOMException('TTS playback stopped', 'AbortError'));
      this.abortController = null;
    }
  }

  pause(): void {
      this.audioPlayer.pause();
  }

  stop(): void {
      this.audioPlayer.stop();
      this.abortInFlight();
  }

  on(callback: (event: TTSEvent) => void): Unsubscribe {
      this.eventListeners.push(callback);
      return () => {
          this.eventListeners = this.eventListeners.filter(l => l !== callback);
      };
  }

  /**
   * Detach listeners, abort in-flight synthesis, and stop playback. The shared sink
   * is NOT destroyed unless this provider constructed it for itself — sink lifecycle
   * belongs to whoever injected it (the manager). After dispose the provider emits
   * nothing.
   */
  dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.audioPlayer.stop();
      this.abortInFlight();
      this.eventListeners = [];
      this.requestRegistry.clear();
      if (this.ownsSink) {
          this.audioPlayer.destroy();
      }
  }

  protected emit(event: TTSEvent) {
      if (this.disposed) return;
      this.eventListeners.forEach(l => l(event));
  }

    public playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
        this.audioPlayer.playEarcon(type);
    }

  /**
   * Abstract method for subclasses to implement the API call.
   *
   * @param signal Abort signal threaded from `stop()`/`dispose()` (AbortError) and
   *   the synthesis timeout (TimeoutError). Network implementations MUST pass it to
   *   their fetches.
   */
  protected abstract fetchAudioData(text: string, options: TTSOptions, signal?: AbortSignal): Promise<SpeechSegment>;

  /**
   * Helper method to perform a POST request and return the response as a Blob.
   * Routes through `NetworkGateway.egress()` (Phase 7 §I): subclasses name the
   * registry destination their synthesis endpoint belongs to.
   */
  protected async fetchAudio(destinationId: DestinationId, url: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Blob> {
    const payload = JSON.stringify(body);

    // Rate-limiting/back-pressure lives in the NetworkGateway, the single point
    // every outbound request passes through: it reserves budget (acquire) before
    // the network call and refunds it on failure (release), so nothing can skip
    // the limit. This call just declares its lane (foreground) and token
    // estimate via the egress opts, then does the after-the-fact bookkeeping
    // below — commit on success, cooldown on a 429 — using the parsed response
    // the gateway never inspects. The governor holder is a no-op when unset
    // (e.g. direct-construction provider unit tests).
    const estimate = estTtsTokens(payload);

    const response = await egress(
      destinationId,
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: payload,
        signal
      },
      { lane: 'fg', estTokens: estimate },
    );

    if (!response.ok) {
      if (response.status === 429) {
        // The cloud-TTS 429 default falls back to the synthesis timeout (30s) —
        // passed explicitly so the shared kernel/net helper keeps no baked-in
        // default (each caller owns its own constant).
        ttsGovernor?.recordCooldown(retryAfterMs(response, SYNTHESIS_TIMEOUT_MS));
      }
      throw new Error(`TTS API Error: ${response.status} ${response.statusText}`);
    }

    ttsGovernor?.commit('fg', estimate);
    return await response.blob();
  }
}
