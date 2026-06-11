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
  makeDbServiceDouble,
  makeInventoryItem,
  makeLibraryDbDouble,
  makeTTSQueue,
  renderWithStores,
  resetStore,
  seedStore,
  storeSeed,
} from './index';
import type { TTSEvent } from '@lib/tts/providers/types';

describe('doubles', () => {
  it('makeDbServiceDouble: unstubbed methods throw with a clear message when called', async () => {
    const db = makeDbServiceDouble();
    expect(() => db.getTTSState('book-1')).toThrowError(/getTTSState\(\) was called but not stubbed/);
  });

  it('makeDbServiceDouble: overrides are used and typechecked', async () => {
    const getTTSState = vi.fn(async () => undefined);
    const db = makeDbServiceDouble({ getTTSState });
    await expect(db.getTTSState('book-1')).resolves.toBeUndefined();
    expect(getTTSState).toHaveBeenCalledWith('book-1');
  });

  it('makeLibraryDbDouble: optional fast-path methods stay undefined so fallbacks run', () => {
    const db = makeLibraryDbDouble();
    expect(db.getBookMetadataBulk).toBeUndefined();
    expect(db.getAvailableResourceIds).toBeUndefined();
    expect(() => db.deleteBook('x')).toThrowError(/deleteBook\(\) was called but not stubbed/);
  });
});

describe('store seeding and reset', () => {
  autoResetStores(useToastStore);

  it('seedStore applies overrides on top of the pristine initial state', () => {
    seedStore(useToastStore, { message: 'seeded', isVisible: true });
    expect(useToastStore.getState().message).toBe('seeded');
    expect(useToastStore.getState().isVisible).toBe(true);
    // untouched field keeps its initial value
    expect(useToastStore.getState().type).toBe('info');
  });

  it('resetStore restores state AND replaced actions', () => {
    const original = useToastStore.getInitialState().showToast;
    seedStore(useToastStore, { showToast: vi.fn() });
    expect(useToastStore.getState().showToast).not.toBe(original);
    resetStore(useToastStore);
    expect(useToastStore.getState().showToast).toBe(original);
    expect(useToastStore.getState().message).toBe('');
  });
});

describe('captureToasts', () => {
  it('records every showToast call in order (single-slot store loses them)', () => {
    const capture = captureToasts();
    try {
      useToastStore.getState().showToast('first', 'success');
      useToastStore.getState().showToast('second', 'error', 5000);
      expect(capture.messages()).toEqual(['first', 'second']);
      expect(capture.toasts[1]).toEqual({ message: 'second', type: 'error', duration: 5000 });
      // the real store still received the calls (last one wins)
      expect(useToastStore.getState().message).toBe('second');
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
      seeds: [storeSeed(useToastStore, { message: 'from-seed', isVisible: true })],
    });
    expect(getByTestId('probe').textContent).toBe('from-seed');
  });

  it('auto-resets seeded stores after the previous test finished', () => {
    expect(useToastStore.getState().message).toBe('');
    expect(useToastStore.getState().isVisible).toBe(false);
  });
});

function ToastProbe() {
  const message = useToastStore((s) => s.message);
  return <div data-testid="probe">{message}</div>;
}
