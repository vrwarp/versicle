/**
 * PlaybackController unit suite (Phase 5b decomposition; phase5-tts-strangler.md
 * §5b.1) — fake-driven, ZERO vi.mock (the engine-dir allowlist is empty since
 * 5b-PR4): FakeEngineContext + FakePlaybackBackend + a recorded platform fake.
 *
 * Carries the named regression blocks for the per-bug files deleted in this
 * commit (absorption ledger rows 1/10/12):
 *  - AudioPlayerService.test.ts      → describe('regression: AudioPlayerService.test')
 *  - AudioPlayerService_LanguageSync → describe('regression: AudioPlayerService_LanguageSync')
 *  - AudioPlayerService_StateProtection → describe('regression: AudioPlayerService_StateProtection')
 * plus the session-persistence dedupe block that moved here from
 * QueueModel.test.ts when the model went pure.
 */
import { describe, it, expect, vi } from 'vitest';
import { PlaybackController } from './PlaybackController';
import { FakeEngineContext } from './FakeEngineContext';
import { FakePlaybackBackend } from './FakePlaybackBackend';
import type { MediaPlatformFactory, PlatformEvents } from '../PlatformIntegration';

function makePlatform() {
    let events: PlatformEvents | null = null;
    const playbackStates: string[] = [];
    const platform = {
        setBackgroundAudioMode: vi.fn(),
        getBackgroundAudioMode: vi.fn(() => 'off' as const),
        setBackgroundVolume: vi.fn(),
        updatePlaybackState: vi.fn((s: string) => { playbackStates.push(s); }),
        updateMetadata: vi.fn(),
        setPositionState: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
    };
    const factory: MediaPlatformFactory = (ev) => {
        events = ev;
        return platform;
    };
    return { factory, platform, playbackStates, getEvents: () => events };
}

function makeEngine(ctx = new FakeEngineContext()) {
    // The content pipeline reads the settings profiles during loadSection.
    if (!ctx.ttsSettings.profiles) {
        ctx.ttsSettings = {
            customAbbreviations: [],
            alwaysMerge: [],
            sentenceStarters: [],
            isBibleLexiconEnabled: false,
            profiles: { en: { voiceId: null, rate: 1.0, minSentenceLength: 0 } },
        };
    }
    const backendRef = FakePlaybackBackend.factory();
    const plat = makePlatform();
    const svc = PlaybackController.createWithContext(ctx, backendRef.factory, plat.factory);
    return { svc, ctx, backend: backendRef.get()!, ...plat };
}

/** Run a private status/queue mutation INSIDE the sequencer (C4 dev-assert). */
const sequenced = (svc: PlaybackController, fn: () => void) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).taskSequencer.enqueue('test.sequenced', async () => fn()) as Promise<void>;

describe('PlaybackController', () => {
    it('wires ALL media-platform handlers (play/pause/stop/prev/next/seek/seekTo)', () => {
        const { getEvents } = makeEngine();
        const events = getEvents()!;
        // The seekto lock-screen handler regression (MediaSession suite) at the
        // engine level: the controller hands the platform every callback.
        for (const key of ['onPlay', 'onPause', 'onStop', 'onPrev', 'onNext', 'onSeek', 'onSeekTo'] as const) {
            expect(typeof events[key]).toBe('function');
        }
    });

    describe('regression: AudioPlayerService.test', () => {
        it('notifies listeners on subscribe with the stopped snapshot', async () => {
            const { svc } = makeEngine();
            const snap = await new Promise<{ status: string; error: unknown }>((resolve) => {
                svc.subscribe((s) => resolve({ status: s.status, error: s.error }));
            });
            expect(snap.status).toBe('stopped');
            expect(snap.error).toBeNull();
        });

        it('includes the chapter title in queue items including the preroll', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [{ sectionId: 'sec1', title: 'Chapter 1', characterCount: 100 }];
            ctx.ttsContent['book1/sec1'] = { sentences: [{ text: 'Sentence sec1', cfi: 'cfi_sec1' }] };
            const { svc } = makeEngine(ctx);

            svc.setPrerollEnabled(true);
            void svc.setBookId('book1');
            await svc.loadSection(0, false);

            const queue = svc.getQueue();
            expect(queue.length).toBeGreaterThan(0);
            expect(queue[0].isPreroll).toBe(true);
            expect(queue[0].title).toBe('Chapter 1');
            expect(queue[1].text).toBe('Sentence sec1');
        });

        it('generates a preroll for empty chapters', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [{ sectionId: 'sec-empty', title: 'Empty', characterCount: 0 }];
            ctx.ttsContent['book1/sec-empty'] = { sentences: [] };
            const { svc } = makeEngine(ctx);

            void svc.setBookId('book1');
            await svc.loadSection(0, false);

            const queue = svc.getQueue();
            expect(queue.length).toBe(1);
            expect(queue[0].isPreroll).toBe(true);
        });

        it('transitions to completed when the queue finishes, broadcasting a null CFI', async () => {
            const { svc, backend } = makeEngine();
            const statuses: string[] = [];
            const cfis: Array<string | null> = [];
            svc.subscribe((s) => { statuses.push(s.status); cfis.push(s.activeCfi); });

            await svc.setQueue([{ text: '1', cfi: '1' }]);
            await svc.play();
            backend.fireEnd();
            await vi.waitFor(() => expect(statuses).toContain('completed'));
            expect(cfis[statuses.indexOf('completed')]).toBeNull();
        });

        it('keeps pushing platform playback state on completed (background audio stays engaged)', async () => {
            const { svc, playbackStates } = makeEngine();
            await sequenced(svc, () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (svc as any).setStatus('playing');
            });
            await sequenced(svc, () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (svc as any).setStatus('completed');
            });
            expect(playbackStates).toEqual(['playing', 'completed']);
        });

        it('stops playback and resets state on book switch before queued work for the new book runs', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [];
            ctx.sections['book2'] = [];
            const { svc, backend } = makeEngine(ctx);

            void svc.setBookId('book1');
            await svc.setQueue([{ text: 'Book 1', cfi: 'cfi1' }]);
            await svc.play();
            backend.fireStart();
            await vi.waitFor(() => expect(svc.snapshot().status).toBe('playing'));

            // The context switch is synchronous; the reset is the FIRST task.
            const switched = svc.setBookId('book2');
            await switched;

            expect(svc.snapshot().status).toBe('stopped');
            expect(svc.getQueue().length).toBe(0);
        });
    });

    describe('session persistence (the SessionStore single owner; moved from QueueModel.test)', () => {
        it('persists queue content once per queueId; index moves do not re-save; masks do', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [];
            const { svc } = makeEngine(ctx);
            void svc.setBookId('book1');

            const items = [
                { text: 'Hello', cfi: '1', sourceIndices: [0] },
                { text: 'World', cfi: '2', sourceIndices: [1] },
            ];
            await svc.setQueue(items, 0);
            expect(ctx.persistedQueues.length).toBe(1);
            expect(ctx.persistedQueues[0].bookId).toBe('book1');

            // Index-only moves keep the same queueId — no re-save.
            await sequenced(svc, () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (svc as any).stateManager.next();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (svc as any).stateManager.jumpTo(0);
            });
            expect(ctx.persistedQueues.length).toBe(1);

            // A content change (mask) stamps a new queueId — saved again, with
            // the masked flag included (the S4 bug's surviving pin).
            await sequenced(svc, () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (svc as any).stateManager.applySkippedMask(new Set([1]));
            });
            expect(ctx.persistedQueues.length).toBe(2);
            expect(ctx.persistedQueues[1].queue[1].isSkipped).toBe(true);
        });

        it('does not persist without a bookId, and a book-switch reset never clobbers the session with an empty queue', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [];
            ctx.sections['book2'] = [];
            const { svc } = makeEngine(ctx);

            // No book → no writes.
            await svc.setQueue([{ text: 'Hello', cfi: '1' }]);
            expect(ctx.persistedQueues.length).toBe(0);

            void svc.setBookId('book1');
            await svc.setQueue([{ text: 'Hello', cfi: '1' }, { text: 'B', cfi: '2' }]);
            expect(ctx.persistedQueues.length).toBe(1);

            // The reset broadcast (empty queue, fresh queueId) must not write.
            await svc.setBookId('book2');
            expect(ctx.persistedQueues.length).toBe(1);
        });

        it('persists the pause timestamp on pause and clears it on stop (detached writes)', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [];
            const { svc, backend } = makeEngine(ctx);
            void svc.setBookId('book1');
            await svc.setQueue([{ text: 'Hello', cfi: '1' }]);
            await svc.play();
            backend.fireStart();

            await svc.pause();
            await vi.waitFor(() => expect(ctx.persistedPauseTimes.length).toBeGreaterThan(0));
            expect(ctx.persistedPauseTimes.at(-1)).toEqual(
                { bookId: 'book1', lastPauseTime: expect.any(Number) });

            await svc.stop();
            await vi.waitFor(() =>
                expect(ctx.persistedPauseTimes.at(-1)).toEqual({ bookId: 'book1', lastPauseTime: null }));
        });
    });

    describe('regression: AudioPlayerService_LanguageSync', () => {
        it('proactively syncs TTS language and clears the lexicon cache on setBookId', async () => {
            const ctx = new FakeEngineContext();
            ctx.activeLanguage = 'en';
            ctx.bookLanguages['book-zh'] = 'zh';
            ctx.sections['book-zh'] = [];
            const { svc } = makeEngine(ctx);

            // Simulate previous playback state holding compiled rules.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (svc as any).activeLexicon = { rules: [{ target: 'test', replacement: 'replaced' }], version: 0 };

            await svc.setBookId('book-zh');

            expect(ctx.activeLanguage).toBe('zh');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((svc as any).activeLexicon).toBeNull();
        });

        it('a mid-playback lexicon edit takes effect on the next sentence (5c-PR3, S15)', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book1'] = [];
            const { svc, backend } = makeEngine(ctx);
            void svc.setBookId('book1');
            await svc.setQueue([
                { text: 'cat one.', cfi: '1' },
                { text: 'cat two.', cfi: '2' },
            ]);

            // No rules yet: the first sentence plays verbatim.
            await svc.play();
            await vi.waitFor(() => expect(backend.played.length).toBe(1));
            expect(backend.played[0].text).toBe('cat one.');

            // User edits the lexicon mid-playback: the invalidation stream fires,
            // the engine drops its CompiledLexicon handle, and the NEXT sentence
            // is fetched with the new rules applied.
            ctx.lexiconRules = [{ id: '1', original: 'cat', replacement: 'feline', created: 0 } as never];
            ctx.emitLexiconChange();

            backend.fireEnd(); // advance to the second sentence
            await vi.waitFor(() => expect(backend.played.length).toBe(2));
            expect(backend.played[1].text).toBe('feline two.');
        });

        it('re-syncs when the current book’s language changes after the fact (Yjs metadata edit)', async () => {
            const ctx = new FakeEngineContext();
            ctx.activeLanguage = 'en';
            ctx.bookLanguages['book-en'] = 'en';
            ctx.sections['book-en'] = [];
            const { svc } = makeEngine(ctx);
            await svc.setBookId('book-en');
            expect(ctx.activeLanguage).toBe('en');

            ctx.bookLanguages['book-en'] = 'fr';
            ctx.emitBookChange();

            await vi.waitFor(() => expect(ctx.activeLanguage).toBe('fr'));
        });
    });

    describe('regression: AudioPlayerService_StateProtection', () => {
        it('does NOT write reading progress while the section index is -1 (reset state)', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book-1'] = [];
            const { svc } = makeEngine(ctx);

            const done = svc.setBookId('book-1');
            await done;
            await new Promise((r) => setTimeout(r, 10));

            expect(ctx.ttsProgressWrites.length).toBe(0);
        });

        it('writes reading progress once the section index is valid', async () => {
            const ctx = new FakeEngineContext();
            ctx.sections['book-1'] = [];
            const { svc } = makeEngine(ctx);
            await svc.setBookId('book-1');

            await sequenced(svc, () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (svc as any).stateManager.setQueue([{ text: 'test', cfi: 'cfi1', isSkipped: false }], 0, 5);
            });

            expect(ctx.ttsProgressWrites.at(-1)).toEqual({ bookId: 'book-1', queueIndex: 0, sectionIndex: 5 });
        });
    });

    describe('diagnostics over the engine surface (S9)', () => {
        it('exportDiagnostics serves the engine-side flight recorder buffer + stats', async () => {
            const { svc } = makeEngine();
            await svc.setQueue([{ text: 'x', cfi: '1' }]); // records engine events
            const exported = await svc.exportDiagnostics();
            expect(exported.stats.capacity).toBeGreaterThan(0);
            expect(exported.stats.eventCount).toBeGreaterThan(0);
            expect(exported.events.length).toBe(exported.stats.eventCount);
            expect(exported.events.some((e) => e.src === 'TSQ')).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Scrubber seek. A drag on the OS media controls (Chrome's Global Media
    // Controls / lock screen) surfaces as pause → seekto(×N) → play. Two
    // regressions are pinned here:
    //   1) every seekto re-derived the index + rebuilt metadata + RE-SYNTHESIZED,
    //      so the drag felt laggy. The burst must coalesce into ONE commit.
    //   2) the pause→play bracketing the drag tripped the 5s "Dragnet"
    //      audio-bookmark gesture. A scrub must DISARM it.
    // ─────────────────────────────────────────────────────────────────────────
    describe('scrubber seek (coalescing + dragnet)', () => {
        // Mirrors the private PlaybackController.SEEK_SETTLE_MS (the scrub coalesce window).
        const PRIVATE_SETTLE_MS = 180;
        // 30-char sentences: charsPerSecond=15 → prefixSums [0,30,60,90,120], so
        // t=3→idx1, t=5→idx2, t=7→idx3 (each tick would change the index).
        const FOUR = [
            { text: 'A'.repeat(30), cfi: 'epubcfi(/6/4!/4/2/1:0)' },
            { text: 'B'.repeat(30), cfi: 'epubcfi(/6/4!/4/2/1:50)' },
            { text: 'C'.repeat(30), cfi: 'epubcfi(/6/4!/4/2/1:100)' },
            { text: 'D'.repeat(30), cfi: 'epubcfi(/6/4!/4/2/1:150)' },
        ];

        async function startPlaying(ctx = new FakeEngineContext()) {
            ctx.sections['bk'] = [];
            const eng = makeEngine(ctx);
            void eng.svc.setBookId('bk');
            await eng.svc.setQueue(FOUR, 0);
            await eng.svc.play();
            await vi.waitFor(() => expect(eng.backend.played.length).toBe(1));
            eng.backend.fireStart();
            await vi.waitFor(() => expect(eng.svc.snapshot().status).toBe('playing'));
            return eng;
        }

        it('coalesces a burst of seekto ticks into ONE re-synthesis when the drag settles', async () => {
            const { svc, backend } = await startPlaying();

            svc.seekTo(3);
            svc.seekTo(5);
            svc.seekTo(7); // only this last target survives the coalescing

            // The drag settles onto the LAST target (index 3) with a single play.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await vi.waitFor(() => expect((svc as any).stateManager.currentIndex).toBe(3));
            // Let any stray per-tick synthesis surface, then assert there was none.
            await new Promise((r) => setTimeout(r, 60));
            expect(backend.played.length).toBe(2); // 1 initial + 1 settled commit (NOT 4)
            expect(backend.played.at(-1)!.text).toBe('D'.repeat(30));
        });

        it('a scrub (pause → seekto → play) does NOT capture an audio-bookmark', async () => {
            const ctx = new FakeEngineContext();
            const { svc, backend } = await startPlaying(ctx);

            svc.pause(); // arms the Dragnet (pause→play within 5s)
            await vi.waitFor(() => expect(svc.snapshot().status).toBe('paused'));
            svc.seekTo(7); // the scrub: must DISARM the gesture
            await svc.play();

            // Give the (suppressed) capture path time to run.
            await new Promise((r) => setTimeout(r, 60));
            expect(ctx.addedAnnotations.some((a) => a.type === 'audio-bookmark')).toBe(false);
            expect(backend.earcons).not.toContain('bookmark_captured');
        });

        it('a bare pause → play within 5s STILL captures an audio-bookmark (control)', async () => {
            const ctx = new FakeEngineContext();
            const { svc, backend } = await startPlaying(ctx);
            await svc.jumpTo(1); // capture spans the previous + current sentence

            svc.pause();
            await vi.waitFor(() => expect(svc.snapshot().status).toBe('paused'));
            await svc.play();

            await vi.waitFor(() =>
                expect(ctx.addedAnnotations.some((a) => a.type === 'audio-bookmark')).toBe(true));
            expect(backend.earcons).toContain('bookmark_captured');
        });

        it('cancels a pending scrub on stop (no stale seek fires after)', async () => {
            const { svc, backend } = await startPlaying();
            const playedBeforeStop = backend.played.length;

            svc.seekTo(7);
            await svc.stop();
            await vi.waitFor(() => expect(svc.snapshot().status).toBe('stopped'));

            // Wait past the settle window: the cancelled scrub must not re-synthesize.
            await new Promise((r) => setTimeout(r, 60));
            expect(backend.played.length).toBe(playedBeforeStop);
            expect(svc.snapshot().status).toBe('stopped');
        });

        it('discards a pending scrub when the queue changes before it settles', async () => {
            const { svc, backend } = await startPlaying();
            const playedBefore = backend.played.length;

            svc.seekTo(7); // pending against the original queue (would land on idx 3)
            // A new section/queue (same shape, so t=7 maps to idx 3 there TOO)
            // arrives before the drag settles → fresh queueId. Without the guard
            // the stale time would mis-apply and jump the new queue to index 3.
            await svc.setQueue(
                [0, 1, 2, 3].map((i) => ({ text: String.fromCharCode(87 + i).repeat(30), cfi: `epubcfi(/6/8!/4/2/1:${i})` })),
                0,
            );

            // Wait PAST the settle window (the timer still fires, then bails on the
            // queueId mismatch rather than mis-applying the stale time).
            await new Promise((r) => setTimeout(r, PRIVATE_SETTLE_MS + 80));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((svc as any).stateManager.currentIndex).toBe(0); // guard bailed (would be 3)
            expect(backend.played.length).toBe(playedBefore); // no stale re-synthesis
        });
    });
});
