/**
 * The typed message catalog (Phase 8 §D; docs/adr/0001-i18n-strategy.md).
 *
 * THE library decision recorded by the ADR's §6 falls here: **no i18n
 * library yet.** This is a minimal in-repo catalog — a plain `en` record
 * behind a `MessageKey` union and a `formatMessage(key, params)` resolver.
 * Plain TS module: importable from stores, services and the TTS worker
 * (no React, no DOM), tree-shakeable, zero runtime bet. When a second UI
 * locale ships, Paraglide/Lingui replaces only this module's INTERNALS —
 * the choke-point signatures (`MessageInput` on the toast queue,
 * `useConfirm`, the settings registry's `labelKey`) are the contract; the
 * catalog backend is an implementation detail.
 *
 * Conventions (ADR §2):
 *  - keys are domain-namespaced (`sync.cleanSync.applied`,
 *    `settings.tab.general`, …);
 *  - the `errors.*` namespace keys 1:1 by the C10 `AppErrorCode` union —
 *    `errors.<CODE>` exists for EVERY code by construction (the mapped
 *    type below makes a missing entry a compile error);
 *  - params use `{name}` placeholders, resolved by {@link formatMessage}.
 *    No ICU plural/select yet — English-only catalog; plural-bearing
 *    messages take pre-pluralized params or split keys until a real
 *    library lands.
 */
import { APP_ERROR_CODES, type AppErrorCode } from '~types/errors';

/** Parameter bag for placeholder substitution. */
export type MessageParams = Record<string, string | number>;

type ErrorMessages = { [C in AppErrorCode as `errors.${C}`]: string };

/**
 * English catalog for the C10 error codes (`presentError` resolves
 * `code → errors.<code>`; UI never renders `err.message` verbatim).
 */
const errorMessages: ErrorMessages = {
  'errors.APP_UNKNOWN': 'Something went wrong. Please try again.',
  'errors.DB_UNKNOWN': 'A local storage error occurred.',
  'errors.DB_QUOTA_EXCEEDED': 'Storage is full. Free up space and try again.',
  'errors.SYNC_UNKNOWN': 'Sync failed. Please try again.',
  'errors.SYNC_WORKSPACE_DELETED': 'This workspace has been deleted.',
  'errors.SYNC_MIGRATION_FAILED': 'Workspace migration failed.',
  'errors.TTS_UNKNOWN': 'Audio playback failed.',
  'errors.GENAI_UNKNOWN': 'The AI request failed.',
  'errors.GENAI_NOT_CONFIGURED': 'Add a Gemini API key in Settings to use AI features.',
  'errors.GENAI_INVALID_RESPONSE': 'The AI returned an unusable response.',
  'errors.DRIVE_UNKNOWN': 'Google Drive request failed.',
  'errors.DRIVE_API_ERROR': 'Google Drive returned an error.',
  'errors.INGEST_UNKNOWN': 'Import failed.',
  'errors.INGEST_DUPLICATE_BOOK': 'This book is already in your library.',
  'errors.INGEST_INVALID_FILE': 'This file is not a valid EPUB.',
  'errors.INGEST_FILE_MISMATCH': 'The file does not match the expected book.',
  'errors.INGEST_CANCELLED': 'Import cancelled.',
  'errors.INGEST_VERIFICATION_FAILED': 'Imported data failed verification.',
  'errors.SEARCH_UNKNOWN': 'Search failed.',
  'errors.SEARCH_SESSION_DISPOSED': 'Search session ended. Try searching again.',
  'errors.NET_UNKNOWN': 'Network request failed.',
  'errors.NET_UNKNOWN_DESTINATION': 'Unknown network destination.',
  'errors.NET_HOST_NOT_ALLOWED': 'Blocked request to an unapproved host.',
  'errors.NET_CONSENT_REQUIRED': 'This feature needs your consent before sending data.',
  'errors.NET_TIMEOUT': 'The request timed out.',
  'errors.NET_OFFLINE': 'You appear to be offline.',
  'errors.BACKUP_SNAPSHOT_INVALID': 'The backup file is invalid.',
  'errors.GOOGLE_AUTH_REQUIRED': 'Sign in with Google to continue.',
  'errors.GOOGLE_AUTH_REVOKED': 'Google access was revoked. Reconnect to continue.',
  'errors.GOOGLE_AUTH_TRANSIENT': 'Google sign-in hiccuped. Please try again.',
  'errors.GOOGLE_UNKNOWN_SERVICE': 'Unknown Google service.',
};

// Compile-time guarantee that the mapped type really covers every code
// (and the runtime list for tests/tooling).
export const ERROR_MESSAGE_KEYS = APP_ERROR_CODES.map((c) => `errors.${c}` as const);

/**
 * The catalog. Domain-namespaced; grow it as choke points adopt keys
 * (ADR §2: components may still author prose inline — only SHARED
 * infrastructure contracts are key-based).
 */
export const messages = {
  ...errorMessages,

  // --- common ---------------------------------------------------------
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.continue': 'Continue',
  'common.reload': 'Reload',

  // --- settings shell (registry labels, §B) ----------------------------
  'settings.tab.general': 'General',
  'settings.tab.tts': 'TTS Engine',
  'settings.tab.genai': 'Generative AI',
  'settings.tab.sync': 'Sync & Cloud',
  'settings.tab.devices': 'Devices',
  'settings.tab.dictionary': 'Dictionary',
  'settings.tab.recovery': 'Recovery',
  'settings.tab.diagnostics': 'Diagnostics',
  'settings.tab.data': 'Data Management',

  // --- toasts: sync domain (the wireSyncEvents choke point, P4 §D3) ----
  'sync.cleanSync.started': 'Syncing library from cloud...',
  'sync.cleanSync.applied': 'Sync complete!',
  'sync.cleanSync.failed': 'Failed to sync. Please try again.',
  'sync.switch.downloading': 'Downloading workspace data...',
  'sync.switch.failedRollingBack': 'Workspace switch failed. Restoring your previous data...',
  'sync.switch.failedAborted': 'Workspace switch failed. Please try again.',
  'sync.tombstoned.connect': 'Sync disconnected: Remote workspace was deleted. Operating offline.',
  'sync.tombstoned.switch': 'Cannot switch: This workspace has been deleted.',
  // Moved verbatim from domains/sync/backend/permissionDenied.ts (the
  // transport keeps DETECTION, the catalog owns the COPY — P4 §D3 completed).
  'sync.rulesOutOfDate':
    "Cloud sync was rejected by your Firebase project's security rules. Your deployed rules are likely out of date — redeploy firestore.rules and storage.rules from the Versicle repository (firebase deploy --only firestore:rules,storage).",
  'sync.failure.maxAttempts': 'Sync failed after multiple attempts. Please check your connection.',
  'sync.saveRejected.tooLarge':
    'Sync disabled: Document too large ({sizeBytes} bytes). Please export and clear data.',
  'sync.saveRejected.maxRetries': 'Sync save failed: Max retries exceeded. Check connection.',
  'sync.persistenceUnavailable': 'Offline sync unavailable (persistence failed)',
  'sync.workspacePurged': 'Remote workspace data purged ({docs}, {blobs}).',

  // --- confirms/alerts: app shell + data management (§D codemod) -------
  'app.resetAll.title': 'Delete all data?',
  'app.resetAll.body':
    'Are you sure you want to delete all data? This cannot be undone.',
  'app.resetAll.confirm': 'Delete everything',
  'app.resetAll.failed': 'Failed to reset database. You may need to clear browser data manually.',

  // --- PWA shell (Phase 8 §G) -------------------------------------------
  'app.updateReady': 'A new version of Versicle is ready.',
  'app.swDegraded':
    'Offline features are unavailable in this session — book covers may not display. Reload to retry.',
  'data.clearAll.title': 'Delete ALL data?',
  'data.clearAll.body':
    'Are you sure you want to delete ALL data? This includes books, annotations, and settings.',
  'data.clearAll.confirm': 'Delete everything',
  'data.clearAll.failed': 'Failed to clear data. Please check console.',
  'data.exportReadingList.empty': 'Reading list is empty.',
  'data.exportReadingList.failed': 'Failed to export reading list.',
  'data.orphans.title': 'Delete orphaned data?',
  'data.orphans.body':
    'Found orphans:\n - Files: {files}\n - Locations: {locations}\n - TTS Prep: {ttsPrep}\n\nDelete them?',
  'data.regenerate.title': 'Regenerate metadata?',
  'data.regenerate.body':
    'This will regenerate all book metadata and content structure from the stored files. This may take a while. Continue?',
  'data.restoreBackup.title': 'Restore backup?',
  'data.restoreBackup.body':
    'Restoring a backup will merge data into your library. Existing books will be updated. Continue?',
  'data.downloadRecovery.failed': 'Failed to download data.',

  // --- confirms/alerts: settings panels --------------------------------
  'genai.clearCache.title': 'Clear analysis cache?',
  'genai.clearCache.body':
    'Are you sure you want to clear the Content Analysis cache? This will force re-analysis of content.',
  'syncSettings.clearConfig.title': 'Clear Firebase configuration?',
  'syncSettings.clearConfig.body': 'Are you sure you want to clear the Firebase configuration?',
  'syncSettings.deleteWorkspace.title': 'Delete workspace "{name}"?',
  'syncSettings.deleteWorkspace.body':
    'This will permanently reclaim cloud storage for this workspace. Your local data will be preserved but sync will be disabled for this workspace ID.',
  'diagnostics.deleteSnapshots.title': 'Delete all snapshots?',
  'diagnostics.deleteSnapshots.body': 'Are you sure you want to delete all diagnostic snapshots?',
  'devices.applySettings.title': 'Apply device settings?',
  'devices.applySettings.body': 'This will overwrite your current Theme and TTS settings. Continue?',
  'devices.remove.title': 'Remove this device?',
  'devices.remove.body': 'Are you sure you want to remove this device? It will just stop appearing here.',

  // --- confirms/alerts: reader feature ---------------------------------
  'reader.annotation.delete.title': 'Delete this annotation?',
  'reader.annotation.delete.body': 'The highlight and any note attached to it will be removed.',
  'reader.reprocess.title': 'Reprocess this book?',
  'reader.reprocess.body':
    'This will re-extract all text and images. The page will reload.',
  'lexicon.import.replace.title': 'Replace lexicon entries?',
  'lexicon.import.replace.body':
    '{oldCount} entries will be replaced with {newCount} new entries. Continue?',
  'abbrev.import.empty': 'No items found in file.',
  'abbrev.import.skippedInvalid': 'Skipping {count} invalid items (e.g. too long).',
  'abbrev.import.replaceValid.title': 'Replace abbreviation list?',
  'abbrev.import.replaceValid.body':
    'This will replace your current list with {validCount} valid entries from the file ({invalidCount} invalid skipped). Are you sure?',
  'abbrev.import.replace.title': 'Replace abbreviation list?',
  'abbrev.import.replace.body':
    'This will replace your current list with {count} entries from the file. Are you sure?',

  // --- live announcements (TTS adapter, §D) -----------------------------
  'announce.tts.playing': 'Playing — {section}',
  'announce.tts.paused': 'Paused',
  'announce.tts.stopped': 'Stopped',

  // --- keyboard shortcuts (§E help sheet) -------------------------------
  'shortcuts.help.title': 'Keyboard shortcuts',
  'shortcuts.help.open': 'Show keyboard shortcuts',
  'shortcuts.reader.prevPage': 'Previous page',
  'shortcuts.reader.nextPage': 'Next page',
  'shortcuts.tts.prevSentence': 'Previous sentence (while listening)',
  'shortcuts.tts.nextSentence': 'Next sentence (while listening)',
  'shortcuts.tts.playPause': 'Play / pause audio',
  'shortcuts.tts.stop': 'Stop audio',
} as const satisfies Record<string, string> & ErrorMessages;

/** Typed key union — the contract every keyed choke point accepts. */
export type MessageKey = keyof typeof messages;

/**
 * Keyed content accepted by choke-point APIs (toast queue, announcer):
 * a bare key, or a key with params.
 */
export type MessageInput = MessageKey | { key: MessageKey; params?: MessageParams };

/** True when `value` is a catalog key (vs free-form prose). */
export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(messages, value);
}

/**
 * Resolve a key to its display string, substituting `{name}` placeholders
 * from `params`. Unknown placeholders are left verbatim (loud in review,
 * harmless in production).
 */
export function formatMessage(key: MessageKey, params?: MessageParams): string {
  const template = messages[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Resolve a {@link MessageInput} or raw prose to a display string.
 * The transitional overload for choke points whose legacy call sites
 * still pass prose (the deprecated `showToast(prose)` path).
 */
export function resolveMessage(content: MessageInput | string, params?: MessageParams): string {
  if (typeof content === 'object') return formatMessage(content.key, content.params);
  if (isMessageKey(content)) return formatMessage(content, params);
  return content;
}
