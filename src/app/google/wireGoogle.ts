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
  makeLazyGenAIClient,
  setDriveClient,
  setDriveLibrarySync,
  setGenAIClient,
  setGoogleAuthClient,
} from '@domains/google';
import { setConsentResolver, setQuotaScheduler } from '@kernel/net';
import { QuotaGovernor, setQuotaStore, type QuotaLimits } from '@kernel/quota';
import { makeQuotaStore } from '@app/quota/makeQuotaStore';
import { quotaCounterRepo } from '@data/repos/quotaCounter';
import { setTtsQuotaGovernor } from '@lib/tts/providers/BaseCloudProvider';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
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
  // read FRESH per acquire (GG-8) from this provider — per-lane settings UI is
  // a later increment (A7), so today it returns the free-tier defaults. RPD is
  // persisted through the injected store onto the quotaCounter repo (the only
  // IDB touch); RPM/TPM live in-memory in the governor.
  const getQuotaLimits = (): QuotaLimits => ({ rpm: 100, tpm: 30_000, rpd: 1000 });
  setQuotaStore(makeQuotaStore(quotaCounterRepo));
  const governor = new QuotaGovernor(getQuotaLimits);
  // A4 (design §3.2): the SAME governor instance enforces admission at the
  // NetworkGateway chokepoint (acquire/release — unbypassable, like consent)
  // AND receives the post-response commit/recordCooldown from the clients.
  setQuotaScheduler(governor);
  setTtsQuotaGovernor(governor);

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

  // Per-book AI consent gate (Phase 7 §H / PR-N3, privacy D2): the gateway
  // consults this for non-interactive 'per-book' destinations (gemini).
  setConsentResolver(
    makeAiConsentResolver({
      getConsent: (bookId) => usePreferencesStore.getState().aiConsent[bookId],
      hasAnalysisRecords: (bookId) =>
        Object.keys(useContentAnalysisStore.getState().sections).some((key) =>
          key.startsWith(`${bookId}/`),
        ),
    }),
  );
}
