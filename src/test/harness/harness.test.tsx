/**
 * Self-test for the shared test harness: pins the behaviors other suites
 * rely on (loud doubles, real-store seeding/reset, toast capture, provider
 * double, renderWithStores auto-reset).
 */
import { describe, it, expect, vi } from 'vitest';
import { useToastStore } from '@store/useToastStore';
import {
  autoResetStores,
  captureToasts,
  FakeTTSProvider,
  makeBookMetadata,
  makeBookContentDouble,
  makeInventoryItem,
  makeLibraryPersistenceDouble,
  makeTTSQueue,
  renderWithStores,
  resetStore,
  seedStore,
  storeSeed,
} from './index';
import type { TTSEvent } from '@lib/tts/providers/types';

describe('doubles', () => {
  it('makeBookContentDouble: unstubbed methods throw with a clear message when called', async () => {
    const db = makeBookContentDouble();
    expect(() => db.getBookStructure('book-1')).toThrowError(/getBookStructure\(\) was called but not stubbed/);
  });

  it('makeBookContentDouble: overrides are used and typechecked', async () => {
    const getBookStructure = vi.fn(async () => undefined);
    const db = makeBookContentDouble({ getBookStructure });
    await expect(db.getBookStructure('book-1')).resolves.toBeUndefined();
    expect(getBookStructure).toHaveBeenCalledWith('book-1');
  });

  it('makeLibraryPersistenceDouble: optional fast-path methods stay undefined so fallbacks run', () => {
    const db = makeLibraryPersistenceDouble();
    expect(db.getBookMetadataBulk).toBeUndefined();
    expect(db.getAvailableResourceIds).toBeUndefined();
    expect(() => db.deleteBook('x')).toThrowError(/deleteBook\(\) was called but not stubbed/);
  });
});

describe('store seeding and reset', () => {
  autoResetStores(useToastStore);

  it('seedStore applies overrides on top of the pristine initial state', () => {
    seedStore(useToastStore, {
      toasts: [{ id: 1, message: 'seeded', type: 'info', duration: 3000 }],
    });
    expect(useToastStore.getState().toasts[0]?.message).toBe('seeded');
  });

  it('resetStore restores state AND replaced actions', () => {
    const original = useToastStore.getInitialState().showToast;
    seedStore(useToastStore, { showToast: vi.fn() });
    expect(useToastStore.getState().showToast).not.toBe(original);
    resetStore(useToastStore);
    expect(useToastStore.getState().showToast).toBe(original);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

describe('captureToasts', () => {
  it('records every showToast call in order, resolving catalog keys to display copy', () => {
    const capture = captureToasts();
    try {
      useToastStore.getState().showToast('first', 'success');
      useToastStore.getState().showToast('second', 'error', 5000);
      useToastStore.getState().showToast('sync.cleanSync.applied', 'success');
      expect(capture.messages()).toEqual(['first', 'second', 'Sync complete!']);
      expect(capture.toasts[1]).toEqual({
        message: 'second',
        key: undefined,
        type: 'error',
        duration: 5000,
      });
      expect(capture.toasts[2]?.key).toBe('sync.cleanSync.applied');
      // the real store still received the calls (queued, Phase 8 §D)
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
        'first',
        'second',
        'Sync complete!',
      ]);
    } finally {
      capture.restore();
      resetStore(useToastStore);
    }
  });
});

describe('FakeTTSProvider', () => {
  it('implements the ITTSProvider event contract', async () => {
    const provider = new FakeTTSProvider({ id: 'fake-1' });
    const events: TTSEvent[] = [];
    provider.on((e) => events.push(e));

    await provider.play('hello', { voiceId: 'fake-voice-1', speed: 1 });
    provider.emitPlaybackCycle();

    expect(provider.play).toHaveBeenCalledWith('hello', { voiceId: 'fake-voice-1', speed: 1 });
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
    await expect(provider.getVoices()).resolves.toHaveLength(1);
  });
});

describe('fixtures', () => {
  it('builds complete typed domain objects from partial overrides', () => {
    const item = makeInventoryItem({ bookId: 'b1', title: 'Custom' });
    expect(item).toMatchObject({ bookId: 'b1', title: 'Custom', status: 'unread', tags: [] });
    const meta = makeBookMetadata({ id: 'b1' });
    expect(meta.title).toBe('Book b1');
    const queue = makeTTSQueue(3);
    expect(queue).toHaveLength(3);
    expect(new Set(queue.map((q) => q.cfi)).size).toBe(3);
  });
});

describe('renderWithStores', () => {
  // Two tests in sequence prove the automatic post-test reset: the first
  // seeds, the second observes pristine state.
  it('seeds the real store for the rendered component', () => {
    const { getByTestId } = renderWithStores(<ToastProbe />, {
      seeds: [
        storeSeed(useToastStore, {
          toasts: [{ id: 1, message: 'from-seed', type: 'info' as const, duration: 3000 }],
        }),
      ],
    });
    expect(getByTestId('probe').textContent).toBe('from-seed');
  });

  it('auto-resets seeded stores after the previous test finished', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

function ToastProbe() {
  const message = useToastStore((s) => s.toasts[0]?.message ?? '');
  return <div data-testid="probe">{message}</div>;
}
