/**
 * The typed emitter every backend's `SyncConnection` adapter is built on.
 * Small, but the two properties that matter — detach actually detaches, and
 * a listener removing itself mid-dispatch does not skip its peers — are the
 * kind that only fail in production.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSyncConnectionEmitter } from './connectionEvents';

describe('createSyncConnectionEmitter', () => {
  it('delivers an emitted event to its subscriber, with the payload', () => {
    const emitter = createSyncConnectionEmitter();
    const saved = vi.fn();
    emitter.on('saved', saved);

    emitter.emit('saved', 1234);

    expect(saved).toHaveBeenCalledWith(1234);
  });

  it('keeps each event name separate', () => {
    const emitter = createSyncConnectionEmitter();
    const saved = vi.fn();
    const synced = vi.fn();
    emitter.on('saved', saved);
    emitter.on('synced', synced);

    emitter.emit('synced');

    expect(synced).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
  });

  it('fans out to every subscriber of the same event', () => {
    const emitter = createSyncConnectionEmitter();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('synced', a);
    emitter.on('synced', b);

    emitter.emit('synced');

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('registers a given callback once — a duplicate `on` does not double-deliver', () => {
    const emitter = createSyncConnectionEmitter();
    const cb = vi.fn();
    emitter.on('synced', cb);
    emitter.on('synced', cb);

    emitter.emit('synced');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('off DETACHES the callback', () => {
    const emitter = createSyncConnectionEmitter();
    const cb = vi.fn();
    emitter.on('synced', cb);

    emitter.off('synced', cb);
    emitter.emit('synced');

    expect(cb).not.toHaveBeenCalled();
  });

  it('off leaves the OTHER subscribers of that event attached', () => {
    const emitter = createSyncConnectionEmitter();
    const gone = vi.fn();
    const kept = vi.fn();
    emitter.on('synced', gone);
    emitter.on('synced', kept);

    emitter.off('synced', gone);
    emitter.emit('synced');

    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('off on an event nobody subscribed to is a no-op, not a crash', () => {
    const emitter = createSyncConnectionEmitter();

    expect(() => emitter.off('synced', vi.fn())).not.toThrow();
  });

  it('off on an unregistered callback leaves the registered one alone', () => {
    const emitter = createSyncConnectionEmitter();
    const cb = vi.fn();
    emitter.on('synced', cb);

    emitter.off('synced', vi.fn());
    emitter.emit('synced');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a listener detaching ITSELF mid-dispatch does not skip its peers', () => {
    const emitter = createSyncConnectionEmitter();
    const second = vi.fn();
    const first = vi.fn(() => emitter.off('synced', first));
    emitter.on('synced', first);
    emitter.on('synced', second);

    emitter.emit('synced');

    expect(second).toHaveBeenCalledTimes(1);
    // …and the self-detach took effect for the next round.
    emitter.emit('synced');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('emitting an event with no subscribers is inert', () => {
    const emitter = createSyncConnectionEmitter();

    expect(() => emitter.emit('epoch-changed', { epoch: 2, previousEpoch: 1, self: false })).not.toThrow();
  });

  it('forwards every argument of a multi-field event', () => {
    const emitter = createSyncConnectionEmitter();
    const cb = vi.fn();
    emitter.on('save-rejected', cb);

    emitter.emit('save-rejected', {
      code: 'document-too-large',
      sizeBytes: 99,
      permissionDenied: false,
    });

    expect(cb).toHaveBeenCalledWith({
      code: 'document-too-large',
      sizeBytes: 99,
      permissionDenied: false,
    });
  });
});
