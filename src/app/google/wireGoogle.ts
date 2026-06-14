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

  // QuotaGovernor (Phase A): ONE kernel governor shared by the GenAI egress
  // lane (below) and the cloud-TTS lane (the audio domain holder). Limits are
  // read FRESH per acquire (GG-8) from this provider — A7 sources them from the
  // user-editable GenAI settings (useGenAIStore.quotaLimits), read fresh inside
  // the closure so a settings edit takes effect on the very next acquire. When
  // pauseAllGenAI is on, limits collapse to zero so acquire throws
  // NetRateLimitedError PRE-network (a master pause with no kernel change). RPD
  // is persisted through the injected store onto the quotaCounter repo (the only
  // IDB touch); RPM/TPM live in-memory in the governor.
  const getQuotaLimits = (): QuotaLimits => {
    const s = useGenAIStore.getState();
    return s.pauseAllGenAI ? { rpm: 0, tpm: 0, rpd: 0 } : s.quotaLimits;
  };
  // A6 (design §3.4): saveDailyUsage — the single chokepoint where the governor
  // reports today's usage — ALSO publishes THIS device's own spend onto its
  // synced DeviceInfo record, for the project-wide cross-device quota sum.
  setQuotaStore(
    makeQuotaStore(quotaCounterRepo, (usage) =>
      useDeviceStore.getState().publishEmbedSpend(getDeviceId(), usage),
    ),
  );
  // A6 BG-lane-only effective ceiling: base RPD reduced by the sum of OTHER
  // active-today devices' published spend. Read FRESH per acquire (GG-8) so the
  // kernel is UNTOUCHED (the QuotaGovernor.ts:29 seam). bg-only division is
  // enforced by routing ONLY the bg lane through this provider; the Phase-E2
  // embedding backfill task consumes it (below) as the cross-device admission
  // pre-flight (the single governor uses ONE full-projectRPD provider for both
  // lanes, so the cross-device ceiling is an app-layer admission gate).
  const getBackgroundQuotaLimits = makeBackgroundQuotaLimits(
    getQuotaLimits,
    () => useDeviceStore.getState().devices,
    getDeviceId(),
  );
  // The fg/query provider (getQuotaLimits, full projectRPD) and this governor
  // stay UNCHANGED so foreground + query embeds are never rate-divided
  // (guardrail #4).
  const governor = new QuotaGovernor(getQuotaLimits);
  // A4 (design §3.2): the SAME governor instance enforces admission at the
  // NetworkGateway chokepoint (acquire/release — unbypassable, like consent)
  // AND receives the post-response commit/recordCooldown from the clients.
  setQuotaScheduler(governor);
  setTtsQuotaGovernor(governor);
  // A7: the READ-direction mirror of the `onLog: addLog` injection below — the
  // settings quota meters poll this provider for live per-lane usage. The
  // governor stays the single source of truth; the store only re-exposes its
  // snapshot to the UI layer (no kernel→store edge).
  useGenAIStore.getState().setQuotaSnapshotProvider(() => governor.snapshot());
  // E2: install the BG-budget seam the embeddingBackfillTask reads for its
  // cross-device RPD pre-flight — the A6 reduced bg ceiling + the governor's
  // live bg.rpd. In-memory (never persisted, same contract as the snapshot
  // provider) so the boot task never imports the kernel governor.
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

  // GenAI embedding (Increment C §1): the LAZY embedding facade —
  // GeminiEmbeddingClient (and its egress plumbing) loads on the first embed
  // call, kept out of the entry chunk (check 4). Config is read PER CALL from
  // the store (GG-8: an embeddingModel/embeddingDims edit takes effect on the
  // next embed); log entries arrive pre-redacted into the same in-memory ring
  // buffer as the GenAI client. The fg-lane acquire at the gateway already
  // throttles it (no governor commit is wired here — the embedContent
  // usageMetadata reconcile is a Phase-D/F refinement).
  setEmbeddingClient(
    makeLazyEmbeddingClient({
      getConfig: (): EmbeddingConfig => {
        const s = useGenAIStore.getState();
        return { apiKey: s.apiKey, model: s.embeddingModel, dims: s.embeddingDims };
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
      // E1 (§8.4.1): the library-wide opt-in is the user's consent for bulk
      // BACKGROUND embedding — granted before the per-book default-deny so an
      // unread book can be backfilled. Read fresh so a settings flip takes
      // effect on the next egress.
      isLibraryPreEmbedEnabled: () => useGenAIStore.getState().preEmbedLibrary,
    }),
  );
}
