/**
 * `ProviderConnection` — attach/detach of the ONE live `SyncConnection`
 * (phase4-sync-strangler.md §D2): wires the normalized transport events
 * onto the typed SyncEvent bus (no UX copy — wireSyncEvents presents) and
 * owns the §D5 layer-2 live quarantine observer on the `meta` map.
 *
 * Absorbed verbatim from FirestoreSyncManager.connectFireProviderNormal /
 * disconnectFireProvider; pinned by the orchestrator characterization and
 * quarantine suites.
 */
import type { FirestoreSyncStatus } from '~types/sync';
import type * as Y from 'yjs';
import { createLogger } from '@lib/logger';
import type { ConnectOptions, SyncBackend, SyncConnection } from '../backend/SyncBackend';
import { isPermissionDeniedEvent } from '../backend/permissionDenied';
import type { SyncEventBus } from '../events';

const logger = createLogger('ProviderConnection');

export interface ProviderConnectionDeps {
  events: SyncEventBus;
  doc: () => Y.Doc;
  currentSchemaVersion: number;
  /** Quarantine handle — UI lock + `obsolete` announcement. */
  onObsolete: (incomingVersion: number) => void;
  /** The orchestrator's status fan-out. */
  setStatus: (status: FirestoreSyncStatus) => void;
}

export class ProviderConnection {
  private connection: SyncConnection | null = null;
  /** Detach handle for the live `meta` quarantine observer (§D5.2). */
  private metaQuarantineCleanup: (() => void) | null = null;

  constructor(private readonly deps: ProviderConnectionDeps) {}

  isAttached(): boolean {
    return this.connection !== null;
  }

  /**
   * Attach the live doc to the workspace's replicated document and report
   * `connected` — unless the synchronous pre-attach `meta` check quarantined
   * the doc, in which case the connection is already torn down again by the
   * time this returns (the `obsolete` event's subscriber severs through the
   * orchestrator re-entrantly).
   */
  attach(backend: SyncBackend, workspaceId: string, opts: ConnectOptions): void {
    const deps = this.deps;
    const events = deps.events;
    deps.setStatus('connecting');

    try {
      const connection = backend.connect(deps.doc(), workspaceId, opts);
      this.connection = connection;

      // Transport error events, normalized by the backend adapter.
      // No UX here: the transport announces, wireSyncEvents presents.
      connection.on('connection-error', (event) => {
        logger.error('Firestore connection error:', event);
        deps.setStatus('error');
        events.emit({
          type: 'connection-error',
          permissionDenied: isPermissionDeniedEvent(event),
        });
      });

      connection.on('sync-failure', (error) => {
        logger.error('Firestore sync failure after max retries:', error);
        deps.setStatus('error');
        events.emit({
          type: 'sync-failure',
          permissionDenied: isPermissionDeniedEvent(error),
        });
      });

      connection.on('save-rejected', (event) => {
        logger.error('Firestore save rejected:', event);
        deps.setStatus('error');
        events.emit({
          type: 'save-rejected',
          code: event.code,
          sizeBytes: event.sizeBytes,
          permissionDenied: isPermissionDeniedEvent(event),
        });
      });

      // A committed save → lastSyncTime (the `flushed` semantics).
      connection.on('saved', (at) => {
        events.emit({ type: 'flushed', at });
      });

      // Quarantine layer 2 — live observer (§D5.2): y-cinder applies
      // remote updates to the doc internally, so the guard sits on the
      // `meta` map and fires synchronously on transaction commit. The
      // local Y-merge of that one transaction has happened (accepted
      // residual, pinned by the F.2 contract test); enforcement
      // destroys the provider so nothing further flows either way.
      const metaMap = deps.doc().getMap('meta');
      const checkMetaVersion = (): void => {
        const incoming = metaMap.get('schemaVersion');
        if (typeof incoming === 'number' && incoming > deps.currentSchemaVersion) {
          logger.warn(
            `Live quarantine: meta.schemaVersion v${incoming} > supported v${deps.currentSchemaVersion}.`
          );
          deps.onObsolete(incoming);
        }
      };
      metaMap.observe(checkMetaVersion);
      this.metaQuarantineCleanup = () => metaMap.unobserve(checkMetaVersion);
      // A doc already past CURRENT must not attach at all.
      checkMetaVersion();
      if (!this.connection) {
        // checkMetaVersion → onObsolete → severObsoleteConnection already
        // tore the connection down; do not report connected.
        return;
      }

      // The provider connects automatically in the background
      logger.info(`Connected to workspace: ${workspaceId}`);
      deps.setStatus('connected');
    } catch (error) {
      logger.error('Failed to connect:', error);
      deps.setStatus('error');
    }
  }

  /** Detach the provider (flush + destroy) and report `disconnected`. */
  detach(): void {
    if (this.metaQuarantineCleanup) {
      this.metaQuarantineCleanup();
      this.metaQuarantineCleanup = null;
    }
    if (this.connection) {
      try {
        this.connection.destroy();
        logger.debug('Provider destroyed');
      } catch (error) {
        logger.error('Error destroying provider:', error);
      }
      this.connection = null;
    }
    this.deps.setStatus('disconnected');
  }
}
