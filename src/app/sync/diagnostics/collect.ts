/**
 * Build the sync diagnostics report: everything needed to explain "device A
 * and device B are not converging" from two exported files, without access
 * to either device.
 *
 * Comparing two devices' reports answers, in order:
 *  1. Are they even pointed at the same place? (firebase projectId, uid,
 *     activeWorkspaceId, the remote workspace directory)
 *  2. Is the connection actually live? (orchestrator status, the y-cinder
 *     provider's queue/retry/epoch-fence internals, recent sync events, the
 *     log ring)
 *  3. Has each device SEEN the other's writes? (the Y.Doc state vector —
 *     one clock per writing client — plus pending structs, i.e. updates
 *     received but blocked on a missing dependency)
 *  4. Where exactly do the replicas differ? (per top-level map: key list
 *     with a content hash per entry and any epoch-ms timestamp fields — no
 *     content itself)
 *
 * PRIVACY: values are never exported, only hashes; the email is masked and
 * the Firebase API key is reduced to a fingerprint. Entry KEYS (book ids,
 * device ids, …) are included because the cross-device diff needs them.
 */
import { Capacitor } from '@capacitor/core';
import { getYDoc, getYjsPersistence, CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import { useSyncStore } from '@store/useSyncStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { getRecentLogs } from '@lib/logger';
import { MigrationStateService } from '@domains/sync/workspaces/MigrationStateService';
import { peekSyncOrchestrator, isSyncEnabled } from '../createSync';
import { getRecorderSnapshot } from './recorder';
import { fnv1a, summarizeDoc } from './docSummary';
import { runIntegrityChecks } from './integrity';
import packageJson from '../../../../package.json';

/** Bump when the report shape changes incompatibly. */
const SYNC_DIAGNOSTICS_FORMAT = 2;

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function safely<T>(run: () => T | Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * The sync-path libraries this BUILD was made with (the forks are pinned to
 * commits — two devices on different builds can run different library
 * code). From package.json, so it is the declared pin, not a lockfile read.
 */
function libraries(): Record<string, string | null> {
  const deps = packageJson.dependencies as Record<string, string | undefined>;
  const pick = (name: string): string | null => deps[name] ?? null;
  return {
    yjs: pick('yjs'),
    'y-cinder': pick('y-cinder'),
    'y-idb': pick('y-idb'),
    'zustand-middleware-yjs': pick('zustand-middleware-yjs'),
    firebase: pick('firebase'),
    zustand: pick('zustand'),
  };
}

function environment(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    appVersion: packageJson.version,
    // Git commit + build time of THIS bundle (the APK freezes whatever was
    // built into it; the web app redeploys on every push).
    build: typeof __VERSICLE_BUILD__ !== 'undefined' ? __VERSICLE_BUILD__ : null,
    buildMode: import.meta.env.MODE,
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    userAgent: nav?.userAgent ?? null,
    language: nav?.language ?? null,
    online: nav?.onLine ?? null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeOrigin: typeof performance !== 'undefined' ? performance.timeOrigin : null,
    uptimeMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : null,
  };
}

function syncSettings(): Record<string, unknown> {
  const s = useSyncStore.getState();
  return {
    syncEnabledGate: isSyncEnabled(),
    firebaseEnabled: s.firebaseEnabled,
    firestoreStatus: s.firestoreStatus,
    firebaseAuthStatus: s.firebaseAuthStatus,
    firebaseUserEmail: maskEmail(s.firebaseUserEmail),
    activeWorkspaceId: s.activeWorkspaceId,
    lastSyncTime: s.lastSyncTime,
    hasCompletedOnboarding: s.hasCompletedOnboarding,
    firebaseConfig: {
      projectId: s.firebaseConfig.projectId || null,
      authDomain: s.firebaseConfig.authDomain || null,
      storageBucket: s.firebaseConfig.storageBucket || null,
      appId: s.firebaseConfig.appId || null,
      apiKeyFingerprint: s.firebaseConfig.apiKey ? fnv1a(s.firebaseConfig.apiKey) : null,
    },
  };
}

function devices(): Record<string, unknown> {
  const all = useDeviceStore.getState().devices;
  return {
    currentDeviceId: getDeviceId(),
    known: Object.values(all).map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      browser: d.browser,
      model: d.model,
      appVersion: d.appVersion,
      lastActive: d.lastActive,
      created: d.created,
    })),
  };
}

export interface SyncDiagnosticsReport {
  format: number;
  generatedAt: number;
  generatedAtIso: string;
  [section: string]: unknown;
}

/**
 * Collect the full report. Never throws: each section records its own
 * failure. The remote probe is skipped when sync never composed, and is
 * time-bounded so an offline device still exports promptly.
 */
export async function collectSyncDiagnostics(opts?: {
  remoteTimeoutMs?: number;
  integrityRemoteTimeoutMs?: number;
}): Promise<SyncDiagnosticsReport> {
  const orchestrator = peekSyncOrchestrator();
  const remoteTimeoutMs = opts?.remoteTimeoutMs ?? 8000;
  const persistence = getYjsPersistence();

  const [remote, storageEstimate] = await Promise.all([
    orchestrator
      ? safely(() =>
          withTimeout(orchestrator.probeRemoteDiagnostics(remoteTimeoutMs), remoteTimeoutMs + 2000, 'remote probe')
        )
      : Promise.resolve({ skipped: 'sync orchestrator never composed on this device (sync off or not configured)' }),
    safely(async () =>
      typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : null
    ),
  ]);

  // The library cross-checks (./integrity.ts) — run before the logs are
  // read so anything they log lands in this report.
  const integrity = await safely(() => runIntegrityChecks({ remoteTimeoutMs: opts?.integrityRemoteTimeoutMs }));

  const now = Date.now();
  return {
    format: SYNC_DIAGNOSTICS_FORMAT,
    generatedAt: now,
    generatedAtIso: new Date(now).toISOString(),
    verdicts: 'verdicts' in integrity ? integrity.verdicts : integrity,
    libraries: await safely(libraries),
    environment: await safely(environment),
    devices: await safely(devices),
    syncSettings: await safely(syncSettings),
    migrationState: await safely(() => MigrationStateService.getState()),
    orchestrator: orchestrator ? await safely(() => orchestrator.getDiagnostics()) : null,
    remote,
    localPersistence: {
      started: persistence !== null,
      synced: persistence ? persistence.synced : null,
      destroyed: persistence ? Boolean(persistence._destroyed) : null,
      storageEstimate,
    },
    crdt: {
      currentSchemaVersion: CURRENT_SCHEMA_VERSION,
      doc: await safely(() => summarizeDoc(getYDoc())),
    },
    integrity,
    recorder: getRecorderSnapshot(),
    logs: getRecentLogs(),
  };
}
