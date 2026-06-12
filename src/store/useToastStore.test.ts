import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from './useToastStore';

describe('useToastStore (queue, Phase 8 §D)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('starts empty', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('shows a toast with resolved prose, type and duration', () => {
    useToastStore.getState().showToast('Test Message', 'success', 5000);
    const [toast] = useToastStore.getState().toasts;
    expect(toast.message).toBe('Test Message');
    expect(toast.type).toBe('success');
    expect(toast.duration).toBe(5000);
    expect(toast.key).toBeUndefined();
  });

  it('resolves catalog keys and key+params content (i18n ADR §2)', () => {
    useToastStore.getState().showToast('sync.cleanSync.applied', 'success');
    useToastStore
      .getState()
      .showToast({ key: 'sync.signedInViaRedirect', params: { email: 'a@b.c' } }, 'info');

    const [first, second] = useToastStore.getState().toasts;
    expect(first.message).toBe('Sync complete!');
    expect(first.key).toBe('sync.cleanSync.applied');
    expect(second.message).toBe('Signed in as a@b.c');
    expect(second.key).toBe('sync.signedInViaRedirect');
  });

  it('defaults: 3000ms, errors get the longer 5000ms default', () => {
    useToastStore.getState().showToast('info toast');
    useToastStore.getState().showToast('error toast', 'error');
    const [info, error] = useToastStore.getState().toasts;
    expect(info.duration).toBe(3000);
    expect(error.duration).toBe(5000);
  });

  it('dismissToast removes one entry by id; hideToast clears all', () => {
    useToastStore.getState().showToast('one');
    useToastStore.getState().showToast('two');
    const [first] = useToastStore.getState().toasts;

    useToastStore.getState().dismissToast(first.id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['two']);

    useToastStore.getState().hideToast();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  describe('regression: single-slot overwrite lost messages (Phase 8 §D queue)', () => {
    it('a second toast STACKS instead of overwriting the first', () => {
      useToastStore.getState().showToast('first', 'success');
      useToastStore.getState().showToast('second', 'error');
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['first', 'second']);
    });

    it('identical message+type dedupes (refresh, not flood) and the cap bounds the queue', () => {
      for (let i = 0; i < 3; i++) {
        useToastStore.getState().showToast('same thing', 'info');
      }
      expect(useToastStore.getState().toasts).toHaveLength(1);

      for (let i = 0; i < 10; i++) {
        useToastStore.getState().showToast(`import error ${i}`, 'error');
      }
      // Cap = 5 (risk 7: per-file import errors must not flood the screen).
      expect(useToastStore.getState().toasts.length).toBeLessThanOrEqual(5);
      // Newest survive.
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe('import error 9');
    });
  });
});
