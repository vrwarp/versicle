/**
 * Composition wiring for domains/google (Phase 7 §G): constructs the
 * GoogleAuthClient / DriveClient / DriveLibrarySync singletons with
 * store-backed adapters and installs them into the domain holders.
 *
 * Called synchronously from registerAppBootTasks() (the composition
 * manifest) — before any boot task or component can touch the holders.
 * This is where the store edges live (README §2 rule 3: domains declare
 * ports, app/ injects adapters):
 *
 *  - login hint   ← useSyncStore.firebaseUserEmail (GG-12's inverted
 *                   lib→sync edge, now app-owned)
 *  - connected    ← useGoogleServicesStore (demoted to a "has connected
 *    hint            before" HINT — connect/disconnect mirror it; token
 *                   failures do NOT, reversing the force-disconnect, GG-2)
 *  - scan index   ← useDriveStore
 *  - imports      ← useLibraryStore.addBook / useBookStore.books
 */
import {
  DriveClient,
  DriveLibrarySync,
  GoogleAuthClient,
  defaultPlatformOptions,
  makeLazyEmbeddingClient,
  makeLazyGenAIClient,
  setDriveClient,
  setDriveLibrarySync,
  setEmbeddingClient,
  setGenAIClient,
  setGoogleAuthClient,
  type EmbeddingConfig,
} from '@domains/google';
import { setConsentResolver, setQuotaScheduler } from '@kernel/net';
import { QuotaGovernor, setQuotaStore, type QuotaLimits } from '@kernel/quota';
import { makeQuotaStore } from '@app/quota/makeQuotaStore';
import { makeBackgroundQuotaLimits } from '@app/quota/embedSpendReconciler';
import { quotaCounterRepo } from '@data/repos/quotaCounter';
import { setTtsQuotaGovernor } from '@lib/tts/providers/BaseCloudProvider';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { useSyncStore } from '@store/useSyncStore';
import { useDriveStore } from '@store/useDriveStore';
import { useBookStore } from '@store/useBookStore';
import { libraryController } from '@app/library/useImportController';
import { useGenAIStore } from '@store/useGenAIStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import { makeAiConsentResolver } from './aiConsent';
import { makeArtifactConsult, makeArtifactConsentGate, setArtifactConsult } from './artifactConsult';
import { peekSyncOrchestrator } from '@app/sync/createSync';
import { bookContent } from '@data/repos/bookContent';
import { searchTextRepo } from '@data/repos/searchText';
import { embeddingsRepo } from '@data/repos/embeddings';
import { CURRENT_QUANT } from '@domains/search';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';
import { createLogger } from '@lib/logger';

let wired = false;

export function wireGoogleDomain(): void {
  if (wired) return;
  wired = true;

  const auth = new GoogleAuthClient({
    platform: defaultPlatformOptions(),
    getLoginHint: () => useSyncStore.getState().firebaseUserEmail || undefined,
    hooks: {
      onConnected: (serviceId) => useGoogleServicesStore.getState().connectService(serviceId),
      onDisconnected: (serviceId) =>
        useGoogleServicesStore.getState().disconnectService(serviceId),
    },
  });
  setGoogleAuthClient(auth);

  const client = new DriveClient({ auth });
  setDriveClient(client);

  setDriveLibrarySync(
    new DriveLibrarySync({
      client,
      driveIndex: {
        getLinkedFolderId: () => useDriveStore.getState().linkedFolderId,
        getLastScanTime: () => useDriveStore.getState().lastScanTime,
        getIndex: () => useDriveStore.getState().index,
        setScanning: (isScanning) => useDriveStore.getState().setScanning(isScanning),
        setScannedFiles: (files) => useDriveStore.getState().setScannedFiles(files),
      },
      library: {
        // Phase 7: Drive imports flow through the SAME ImportOrchestrator
        // queue as every other entry point (ghost matching + reading-list
        // registration included). Duplicates still throw DuplicateBookError
        // — the pre-P7 addBook contract Drive flows are built around.
        addBook: (file, options) =>
          options?.overwrite
            ? libraryController.replaceFile(file)
            : libraryController.importFile(file),
        getLibraryFilenames: () =>
          new Set(Object.values(useBookStore.getState().books).map((b) => b.sourceFilename)),
      },
      hasConnectedBefore: () => useGoogleServicesStore.getState().isServiceConnected('drive'),
      log: createLogger('DriveLibrarySync'),
    }),
  );

  // ONE kernel quota governor, shared by the GenAI egress lane (below) and the
  // cloud-TTS lane (the audio domain holder). Limits come from the user-editable
  // GenAI settings (useGenAIStore.quotaLimits) and are read FRESH per acquire
  // inside this closure, so a settings edit takes effect on the very next
  // acquire. When pauseAllGenAI is on, limits collapse to zero so acquire throws
  // NetRateLimitedError before any network call (a master pause with no kernel
  // change). The daily request count is persisted through the injected store
  // onto the quotaCounter repo (the only IDB touch); per-minute counts live
  // in-memory in the governor.
  const getQuotaLimits = (): QuotaLimits => {
    const s = useGenAIStore.getState();
    return s.pauseAllGenAI ? { rpm: 0, tpm: 0, rpd: 0 } : s.quotaLimits;
  };
  // saveDailyUsage — the single chokepoint where the governor reports today's
  // usage — ALSO publishes THIS device's own spend onto its synced DeviceInfo
  // record, so every device can sum the whole project's daily quota usage.
  setQuotaStore(
    makeQuotaStore(quotaCounterRepo, (usage) =>
      useDeviceStore.getState().publishEmbedSpend(getDeviceId(), usage),
    ),
  );
  // The background lane's effective daily ceiling: the base daily request limit
  // reduced by the sum of what OTHER devices active today have already spent, so
  // the shared daily quota is divided across devices. Read FRESH per acquire so
  // the kernel governor is untouched. Only the background lane is routed through
  // this reduced provider; the embedding-backfill task (below) reads it as a
  // cross-device admission check before each background embed.
  const getBackgroundQuotaLimits = makeBackgroundQuotaLimits(
    getQuotaLimits,
    () => useDeviceStore.getState().devices,
    getDeviceId(),
  );
  // The foreground/query provider (getQuotaLimits, full daily limit) and this
  // governor stay UNCHANGED, so foreground and query embeds are never divided
  // across devices.
  const governor = new QuotaGovernor(getQuotaLimits);
  // The SAME governor instance enforces admission at the NetworkGateway
  // chokepoint (acquire/release — unbypassable, like consent) AND receives the
  // post-response commit/recordCooldown from the clients.
  setQuotaScheduler(governor);
  setTtsQuotaGovernor(governor);
  // Expose the governor's live per-lane usage to the settings quota meters. The
  // governor stays the single source of truth; the store only re-exposes its
  // snapshot to the UI layer (no kernel→store edge).
  useGenAIStore.getState().setQuotaSnapshotProvider(() => governor.snapshot());
  // Install the in-memory seam the embedding-backfill task reads for its
  // cross-device admission check: this device's reduced background daily ceiling
  // plus the governor's live background daily count. Never persisted (same
  // contract as the snapshot provider), so the boot task never imports the
  // kernel governor.
  useGenAIStore
    .getState()
    .setBgBudgetProvider(getBackgroundQuotaLimits, () => governor.snapshot().bg.rpd);

  // GenAI (Phase 7 §H): config read PER CALL from the store — the mutable
  // singleton fields (and the TTS pipeline's configure() clobber, GG-8) are
  // gone. Log entries arrive pre-redacted (no inlineData bytes) and land in
  // the store's in-memory ring buffer (never persisted — its partialize
  // allowlist excludes logs).
  // Phase 8 §A: installed as the LAZY facade — GeminiClient (and the
  // egress plumbing behind it) loads on the first generate call, keeping
  // the GenAI implementation out of the entry chunk (check 4).
  setGenAIClient(
    makeLazyGenAIClient({
      getConfig: () => {
        const s = useGenAIStore.getState();
        return {
          apiKey: s.apiKey,
          model: s.model,
          rotationEnabled: s.isModelRotationEnabled,
        };
      },
      onLog: (entry) => useGenAIStore.getState().addLog(entry),
      governor,
    }),
  );

  // The embedding client, installed as a LAZY facade so the real
  // GeminiEmbeddingClient (and its egress plumbing) loads only on the first
  // embed call, keeping it out of the entry chunk. Config is read PER CALL from
  // the store, so an embeddingModel/embeddingDims edit takes effect on the next
  // embed; log entries arrive pre-redacted into the same in-memory log buffer as
  // the GenAI client. The foreground-lane acquire at the gateway already
  // throttles it, so no governor commit is wired here.
  setEmbeddingClient(
    makeLazyEmbeddingClient({
      getConfig: (): EmbeddingConfig => {
        const s = useGenAIStore.getState();
        return {
          apiKey: s.apiKey,
          model: s.embeddingModel,
          dims: s.embeddingDims,
          // Opt-in batch-embedding probe flag, read per call; default-off.
          useBatchEmbedding: s.useBatchEmbedding,
        };
      },
      onLog: (entry) => useGenAIStore.getState().addLog(entry),
    }),
  );

  // Per-book AI consent gate (Phase 7 §H / PR-N3, privacy D2): the gateway
  // consults this for non-interactive 'per-book' destinations (gemini).
  setConsentResolver(
    makeAiConsentResolver({
      getConsent: (bookId) => usePreferencesStore.getState().aiConsent[bookId],
      hasAnalysisRecords: (bookId) =>
        Object.keys(useContentAnalysisStore.getState().sections).some((key) =>
          key.startsWith(`${bookId}/`),
        ),
      // The library-wide opt-in is the user's consent for bulk BACKGROUND
      // embedding: it grants egress for an unread book that has no per-book
      // consent of its own, so the background backfill can pre-embed it. Read
      // fresh so a settings flip takes effect on the next egress.
      isLibraryPreEmbedEnabled: () => useGenAIStore.getState().preEmbedLibrary,
    }),
  );

  // The read side of the shared embedding cache: before spending Gemini quota to
  // embed a book, check the user's own cloud cache and, on a hit, download and
  // reuse another device's embeddings. The store/manifest/backend edges live
  // HERE; the boot loop and reader controller inject the installed singleton's
  // port. This is read-only — uploads are handled by the publisher boot task.
  setArtifactConsult(
    makeArtifactConsult({
      // The connected cloud backend, or null when sync is off / not connected.
      // peekSyncOrchestrator never CREATES the orchestrator (no sync = null =
      // cheap no-network short-circuit). Read fresh per call.
      getBackend: () => peekSyncOrchestrator()?.getConnectedArtifactBackend() ?? null,
      getManifest: (bookId) => bookContent.getManifest(bookId),
      // The live embedding-space stamp: {model, dims} from the GenAI settings
      // (read fresh), the int8 quant literal, and the current extraction version
      // (the same one the corpus rows are stamped with), so the derived cache key
      // matches the one the publisher wrote.
      getStamp: () => {
        const s = useGenAIStore.getState();
        return {
          model: s.embeddingModel,
          dims: s.embeddingDims,
          quant: CURRENT_QUANT,
          extractionVersion: TTS_EXTRACTION_VERSION,
        };
      },
      getLiveCorpus: (bookId) => searchTextRepo.get(bookId),
      putHydrated: (row, jobRow) => embeddingsRepo.putHydrated(row, jobRow),
      // Consent gate: the per-book consent predicate (per-book consent bit OR the
      // library pre-embed opt-in for background OR the interactive reader-open
      // gesture for foreground) ANDed with the shareAiCaches master switch. With
      // sharing OFF every book is DENIED even when the user just opened it. The
      // upload (publisher) path is built from this SAME helper so the two share
      // one gating rule.
      isConsented: makeArtifactConsentGate({
        isShareEnabled: () => useGenAIStore.getState().shareAiCaches,
        isPreEmbedEnabled: () => useGenAIStore.getState().preEmbedLibrary,
        getPerBookConsent: (bookId) => usePreferencesStore.getState().aiConsent[bookId],
      }),
    }),
  );
}
