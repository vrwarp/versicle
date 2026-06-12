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
  setDriveClient,
  setDriveLibrarySync,
  setGoogleAuthClient,
} from '@domains/google';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
import { useSyncStore } from '@store/useSyncStore';
import { useDriveStore } from '@store/useDriveStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { useBookStore } from '@store/useBookStore';
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
}

/** Test-only: allow re-wiring after holder resets. */
export function resetGoogleWiringForTesting(): void {
  wired = false;
}
