/**
 * The C11 boot contract: an explicit, awaited boot sequence
 * (plan/overhaul/proposals/contract-first.md §C11).
 *
 * This module is ONLY the registry and the sequencer — it imports no
 * subsystem. Subsystems define named {@link BootTask}s (under `src/app/boot/`)
 * and `src/app/boot/registerBootTasks.ts` (the composition manifest) registers
 * them into phases. Bootstrap owns the ORDER; it must never grow imports of
 * sync/tts/drive internals (plan/overhaul/README.md §4 rule 9).
 *
 * Phases run strictly in {@link BOOT_PHASES} order; tasks within a phase run
 * sequentially in registration order. Each task returns or throws:
 *  - a throw rejects the boot promise → App routes to SafeModeView (crashes
 *    inside React render keep routing to ErrorBoundary /
 *    CriticalMigrationFailureView as before);
 *  - `ctx.halt(reason)` stops the sequence after the current phase (used by
 *    the migration interceptor while a backup restore reloads the page).
 */

import { measureSince } from '@lib/perf';

export const BOOT_PHASES = [
  'interceptMigration',
  'openDB',
  'startYjsPersistence',
  // `whenHydrated` composes waitForYjsSync (IDB load) with the per-store
  // hydration handles from the forked middleware (api.yjs.whenHydrated /
  // markHydrated) — see src/app/boot/whenHydrated.ts.
  'whenHydrated',
  // `migrations`: the CRDT migration coordinator (src/app/migrations.ts) —
  // static imports, sequential awaited doc transforms, atomic transactional
  // version bumps, loud-fail with a pre-migration checkpoint id.
  'migrations',
  'syncInit',
  'deviceRegistration',
  'backgroundTasks',
] as const;

export type BootPhase = (typeof BOOT_PHASES)[number];

/** Captured from the migration state machine for the confirmation modal. */
export interface PendingWorkspaceMigration {
  targetWorkspaceId: string;
  backupCheckpointId: number;
}

export type BootHaltReason = 'restoring-backup' | 'applying-staged-switch';

interface BootContext {
  /** Surface a human-readable boot progress message (loading screen). */
  setStatusMessage(message: string): void;
  /**
   * Whether sync may be initialized this boot. The migration interceptor
   * clears it while a workspace migration awaits user confirmation —
   * "do NOT initialize sync" is enforced as state, not as a comment.
   */
  syncAllowed: boolean;
  /** Set by the migration interceptor; rendered as the confirmation modal. */
  pendingMigration: PendingWorkspaceMigration | null;
  /** Stop the boot sequence after the current phase completes. */
  halt(reason: BootHaltReason): void;
  /**
   * Register teardown for resources a task starts (intervals, listeners).
   * Runs when the boot owner unmounts; if the owner is already disposed the
   * cleanup runs immediately.
   */
  addCleanup(cleanup: () => void): void;
}

export interface BootTask {
  /** Stable diagnostic name, `<subsystem>/<action>` (e.g. `sync/initialize`). */
  name: string;
  run(ctx: BootContext): void | Promise<void>;
}

type BootResult =
  | { status: 'ready'; pendingMigration: PendingWorkspaceMigration | null }
  | { status: 'halted'; reason: BootHaltReason };

export interface BootHandle {
  promise: Promise<BootResult>;
  /** Tear down everything boot tasks registered via `ctx.addCleanup`. */
  dispose(): void;
}

const registry = new Map<BootPhase, BootTask[]>();

export function registerBootTask(phase: BootPhase, task: BootTask): void {
  const tasks = registry.get(phase) ?? [];
  if (tasks.some((t) => t.name === task.name)) {
    throw new Error(`[bootstrap] duplicate boot task '${task.name}' in phase '${phase}'`);
  }
  tasks.push(task);
  registry.set(phase, tasks);
}

export interface RunBootOptions {
  onStatusMessage?: (message: string) => void;
}

/**
 * Run all registered boot tasks in phase order. Returns synchronously with a
 * handle so the owner can dispose long-lived resources (heartbeat interval)
 * on unmount even while the sequence is still in flight.
 */
export function runBootSequence(options: RunBootOptions = {}): BootHandle {
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let haltReason: BootHaltReason | null = null;

  const ctx: BootContext = {
    setStatusMessage: (message) => options.onStatusMessage?.(message),
    syncAllowed: true,
    pendingMigration: null,
    halt: (reason) => {
      haltReason = reason;
    },
    addCleanup: (cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        cleanups.push(cleanup);
      }
    },
  };

  const promise = (async (): Promise<BootResult> => {
    const bootStart = performance.now();
    for (const phase of BOOT_PHASES) {
      for (const task of registry.get(phase) ?? []) {
        const taskStart = performance.now();
        await task.run(ctx);
        measureSince(`boot:${task.name}`, taskStart);
      }
      if (haltReason !== null) {
        return { status: 'halted', reason: haltReason };
      }
    }
    measureSince('boot:total', bootStart);
    return { status: 'ready', pendingMigration: ctx.pendingMigration };
  })();

  return {
    promise,
    dispose: () => {
      disposed = true;
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
  };
}
