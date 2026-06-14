/**
 * Minimal typed emitter backing each backend's `SyncConnection` adapter:
 * providers (y-cinder FireProvider / MockFireProvider) emit their native
 * events, the adapter normalizes them onto the C3 `SyncConnectionEvents`
 * surface, and the orchestrator subscribes through this one shape.
 */
import type { SyncConnectionEvents } from './SyncBackend';

export interface SyncConnectionEmitter {
  on<E extends keyof SyncConnectionEvents>(event: E, cb: SyncConnectionEvents[E]): void;
  off<E extends keyof SyncConnectionEvents>(event: E, cb: SyncConnectionEvents[E]): void;
  emit<E extends keyof SyncConnectionEvents>(
    event: E,
    ...args: Parameters<SyncConnectionEvents[E]>
  ): void;
}

export function createSyncConnectionEmitter(): SyncConnectionEmitter {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: (event, cb) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb as (...args: unknown[]) => void);
      listeners.set(event, set);
    },
    off: (event, cb) => {
      listeners.get(event)?.delete(cb as (...args: unknown[]) => void);
    },
    emit: (event, ...args) => {
      // Copy: a listener detaching itself mid-dispatch must not skip peers.
      for (const cb of [...(listeners.get(event) ?? [])]) {
        cb(...args);
      }
    },
  };
}
