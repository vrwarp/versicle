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
  GeminiClient,
  GoogleAuthClient,
  defaultPlatformOptions,
  setDriveClient,
  setDriveLibrarySync,
  setGenAIClient,
  setGoogleAuthClient,
} from '@domains/google';
import { setConsentResolver } from '@kernel/net';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
import { useSyncStore } from '@store/useSyncStore';
import { useDriveStore } from '@store/useDriveStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { useBookStore } from '@store/useBookStore';
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
        addBook: (file, options) => useLibraryStore.getState().addBook(file, options),
        getLibraryFilenames: () =>
          new Set(Object.values(useBookStore.getState().books).map((b) => b.sourceFilename)),
      },
      hasConnectedBefore: () => useGoogleServicesStore.getState().isServiceConnected('drive'),
      log: createLogger('DriveLibrarySync'),
    }),
  );

  // GenAI (Phase 7 §H): config read PER CALL from the store — the mutable
  // singleton fields (and the TTS pipeline's configure() clobber, GG-8) are
  // gone. Log entries arrive pre-redacted (no inlineData bytes) and land in
  // the store's in-memory ring buffer (never persisted — its partialize
  // allowlist excludes logs).
  setGenAIClient(
    new GeminiClient({
      getConfig: () => {
        const s = useGenAIStore.getState();
        return {
          apiKey: s.apiKey,
          model: s.model,
          rotationEnabled: s.isModelRotationEnabled,
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
    }),
  );
}

/** Test-only: allow re-wiring after holder resets. */
export function resetGoogleWiringForTesting(): void {
  wired = false;
}
