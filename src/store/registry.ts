/**
 * The store registry — the single declaration surface for every zustand
 * store in the app (master plan §2 "three explicit store tiers, declared in
 * one registry"; phase2-fork-surgery.md §2.5).
 *
 * Three tiers:
 *   - 'synced'          — CRDT user data, replicated through the Yjs
 *                         middleware into the shared Y.Doc. Created ONLY via
 *                         `defineSyncedStore` (src/store/yjs-provider.ts;
 *                         lint-enforced: the raw middleware import is banned
 *                         outside that module). Each synced store module
 *                         declares and exports its `SyncedStoreDef`; this
 *                         registry aggregates them.
 *   - 'local-persisted' — device-local settings/caches via zustand/persist
 *                         (localStorage).
 *   - 'ephemeral'       — in-memory UI/session state; dies with the tab.
 *
 * `src/store/README.md` is GENERATED from {@link STORE_REGISTRY} — edit the
 * registry (or a store's def), then regenerate:
 *
 *   REGEN_STORE_DOCS=1 npx vitest run src/store/__tests__/registry.test.ts
 *
 * The registry test also asserts completeness (every `use*Store.ts` module
 * under src/store/ has a row here) and that persist keys / Y.Map names match
 * the actual store configuration.
 *
 * Import-graph note: stores must NEVER import this module — the TTS worker's
 * type-closure reaches the store modules, and any new src/store module they
 * pull in regresses the `worker-no-state-typegraph` depcruise ratchet. The
 * registry therefore imports the stores (for the boot roster), and
 * `defineSyncedStore`/`SyncedStoreDef` live in yjs-provider.ts, which is
 * already inside that closure.
 */
import * as Y from 'yjs';
import type { YjsStoreHandle } from 'zustand-middleware-yjs';
import type { SyncedStoreDef } from './yjs-provider';
import { useBookStore, LIBRARY_STORE_DEF } from './useBookStore';
import { useReadingStateStore, PROGRESS_STORE_DEF } from './useReadingStateStore';
import { useAnnotationStore, ANNOTATIONS_STORE_DEF } from './useAnnotationStore';
import { usePreferencesStore, PREFERENCES_STORE_DEF } from './usePreferencesStore';
import { useReadingListStore, READING_LIST_STORE_DEF } from './useReadingListStore';
import { useVocabularyStore, VOCABULARY_STORE_DEF } from './useVocabularyStore';
import { useLexiconStore, LEXICON_STORE_DEF } from './useLexiconStore';
import { useContentAnalysisStore, CONTENT_ANALYSIS_STORE_DEF } from './useContentAnalysisStore';
import { useDeviceStore, DEVICES_STORE_DEF } from './useDeviceStore';

export type { SyncedStoreDef } from './yjs-provider';

// ─── Synced-store aggregation ────────────────────────────────────────────────

/**
 * All nine synced-store defs, keyed for lookup. Flip state
 * (phase2-fork-surgery.md §2.6 order: contentAnalysis → vocabulary →
 * devices → lexicon → reading-list → preferences → annotations → books →
 * progress) lives in each store module's exported def; this table and the
 * generated README are the program-wide view of it.
 */
export const SYNCED_STORE_DEFS = {
  library: LIBRARY_STORE_DEF,
  progress: PROGRESS_STORE_DEF,
  annotations: ANNOTATIONS_STORE_DEF,
  preferences: PREFERENCES_STORE_DEF,
  readingList: READING_LIST_STORE_DEF,
  vocabulary: VOCABULARY_STORE_DEF,
  lexicon: LEXICON_STORE_DEF,
  contentAnalysis: CONTENT_ANALYSIS_STORE_DEF,
  devices: DEVICES_STORE_DEF,
} as const;

export interface SyncedStoreEntry {
  /** The store's replication declaration (Y.Map name, scope, options). */
  def: SyncedStoreDef;
  /** The store api object (the middleware attaches `api.yjs` to it). */
  store: object;
}

/**
 * The store's hydration handle, or undefined when the module is a test mock
 * without the middleware augmentation (App_Boot.test.tsx mocks store
 * modules wholesale). Production stores always carry `api.yjs`.
 */
export const yjsHandleOf = (store: object): YjsStoreHandle | undefined =>
  (store as { yjs?: YjsStoreHandle }).yjs;

/**
 * The runtime roster: every synced store bound to its def. The boot
 * `whenHydrated` composition iterates this list to mark empty-map stores
 * hydrated and await the rest (phase2-fork-surgery.md §2.4). Order is
 * irrelevant (hydration is awaited as a set).
 */
export const SYNCED_STORES: readonly SyncedStoreEntry[] = [
  { def: SYNCED_STORE_DEFS.library, store: useBookStore },
  { def: SYNCED_STORE_DEFS.progress, store: useReadingStateStore },
  { def: SYNCED_STORE_DEFS.annotations, store: useAnnotationStore },
  { def: SYNCED_STORE_DEFS.preferences, store: usePreferencesStore },
  { def: SYNCED_STORE_DEFS.readingList, store: useReadingListStore },
  { def: SYNCED_STORE_DEFS.vocabulary, store: useVocabularyStore },
  { def: SYNCED_STORE_DEFS.lexicon, store: useLexiconStore },
  { def: SYNCED_STORE_DEFS.contentAnalysis, store: useContentAnalysisStore },
  { def: SYNCED_STORE_DEFS.devices, store: useDeviceStore },
];

/**
 * True when the store's DATA map holds nothing — scope-aware: a scoped store
 * reads `getMap(name).get(scope.key)`, and a missing or empty child means
 * the store starts from its declared defaults (the boot `whenHydrated`
 * composition uses this to `markHydrated()` stores that will never receive
 * an inbound patch).
 */
export function syncedDataMapIsEmpty(doc: Y.Doc, def: SyncedStoreDef): boolean {
  const root = doc.getMap(def.name);
  if (def.scope === undefined) return root.size === 0;
  const child = root.get(def.scope.key);
  return !(child instanceof Y.Map) || child.size === 0;
}

// ─── The three-tier registry (docs + completeness surface) ──────────────────

export type StoreTier = 'synced' | 'local-persisted' | 'ephemeral';

export interface StoreRegistryEntry {
  /** Module basename under src/store/ (also the hook name). */
  readonly module: string;
  readonly tier: StoreTier;
  /**
   * Where the data lives: the Y.Map name (synced), the zustand/persist
   * localStorage key (local-persisted), or null (ephemeral). For docs this
   * is the STABLE name — device-keyed names use the `<deviceId>` placeholder.
   */
  readonly persistence: string | null;
  /** Owning target domain (master plan §2 geography). */
  readonly owner: string;
  readonly summary: string;
  /** Synced stores carry their replication def. */
  readonly def?: SyncedStoreDef;
}

export const STORE_REGISTRY: readonly StoreRegistryEntry[] = [
  // ── synced (CRDT user data) ────────────────────────────────────────────
  {
    module: 'useBookStore',
    tier: 'synced',
    persistence: 'library',
    owner: 'library',
    summary: 'Book inventory (per-book user data; carries __schemaVersion).',
    def: SYNCED_STORE_DEFS.library,
  },
  {
    module: 'useReadingStateStore',
    tier: 'synced',
    persistence: 'progress',
    owner: 'reader',
    summary: 'Reading progress per book per device, incl. reading sessions.',
    def: SYNCED_STORE_DEFS.progress,
  },
  {
    module: 'useAnnotationStore',
    tier: 'synced',
    persistence: 'annotations',
    owner: 'reader',
    summary: 'Highlights and notes, keyed by UUID.',
    def: SYNCED_STORE_DEFS.annotations,
  },
  {
    module: 'usePreferencesStore',
    tier: 'synced',
    persistence: 'preferences/<deviceId>',
    owner: 'shell',
    summary: 'Per-device display preferences (theme, fonts, layout, Chinese).',
    def: SYNCED_STORE_DEFS.preferences,
  },
  {
    module: 'useReadingListStore',
    tier: 'synced',
    persistence: 'reading-list',
    owner: 'library',
    summary: 'Reading-list entries keyed by filename (progress projection).',
    def: SYNCED_STORE_DEFS.readingList,
  },
  {
    module: 'useVocabularyStore',
    tier: 'synced',
    persistence: 'vocabulary',
    owner: 'chinese',
    summary: 'Known Chinese characters (char → learned-at timestamp).',
    def: SYNCED_STORE_DEFS.vocabulary,
  },
  {
    module: 'useLexiconStore',
    tier: 'synced',
    persistence: 'lexicon',
    owner: 'audio',
    summary: 'TTS pronunciation rules + per-book lexicon settings.',
    def: SYNCED_STORE_DEFS.lexicon,
  },
  {
    module: 'useContentAnalysisStore',
    tier: 'synced',
    persistence: 'contentAnalysis',
    owner: 'audio',
    summary: 'AI content-analysis cache (references, table adaptations, titles).',
    def: SYNCED_STORE_DEFS.contentAnalysis,
  },
  {
    module: 'useDeviceStore',
    tier: 'synced',
    persistence: 'devices',
    owner: 'sync',
    summary: 'Device registry of the sync mesh (UA, heartbeat, names).',
    def: SYNCED_STORE_DEFS.devices,
  },
  // ── local-persisted (device-local, zustand/persist → localStorage) ─────
  {
    module: 'useSyncStore',
    tier: 'local-persisted',
    persistence: 'sync-storage',
    owner: 'sync',
    summary: 'Firebase config, sync/auth status, onboarding flag.',
  },
  {
    module: 'useTTSStore',
    tier: 'local-persisted',
    persistence: 'tts-storage',
    owner: 'audio',
    summary: 'TTS provider/voice/playback settings and segmentation config.',
  },
  {
    module: 'useDriveStore',
    tier: 'local-persisted',
    persistence: 'drive-config-storage',
    owner: 'google',
    summary: 'Linked Drive folder + scanned file index.',
  },
  {
    module: 'useGoogleServicesStore',
    tier: 'local-persisted',
    persistence: 'google-services-storage',
    owner: 'google',
    summary: 'Connected Google services + OAuth client ids.',
  },
  {
    module: 'useGenAIStore',
    tier: 'local-persisted',
    persistence: 'genai-storage',
    owner: 'google',
    summary: 'Gemini API key/model config, feature toggles, request logs.',
  },
  {
    module: 'useLocalHistoryStore',
    tier: 'local-persisted',
    persistence: 'local-history-storage',
    owner: 'reader',
    summary: 'Last-read book id (local cache to avoid progress-map scans).',
  },
  // ── ephemeral (in-memory; dies with the tab) ───────────────────────────
  {
    module: 'useLibraryStore',
    tier: 'ephemeral',
    persistence: null,
    owner: 'library',
    summary: 'Static-metadata projection of IndexedDB + offloaded-book set.',
  },
  {
    module: 'useUIStore',
    tier: 'ephemeral',
    persistence: null,
    owner: 'shell',
    summary: 'Global UI flags (settings dialog, obsolete-client lock).',
  },
  {
    module: 'useToastStore',
    tier: 'ephemeral',
    persistence: null,
    owner: 'shell',
    summary: 'Toast notification state.',
  },
  {
    module: 'useReaderUIStore',
    tier: 'ephemeral',
    persistence: null,
    owner: 'reader',
    summary: 'Reader session UI (menus, popover, compass, reader callbacks).',
  },
  {
    module: 'useBackNavigationStore',
    tier: 'ephemeral',
    persistence: null,
    owner: 'shell',
    summary: 'Priority-ordered back-button handler registry.',
  },
  {
    module: 'useSidebarStore',
    tier: 'ephemeral',
    persistence: null,
    owner: 'reader',
    summary: 'Which reader side panel (TOC/search/annotations/audio) is open.',
  },
];

// ─── Generated docs ──────────────────────────────────────────────────────────

const TIER_HEADINGS: Record<StoreTier, string> = {
  synced: 'Synced (CRDT user data — replicated via the Yjs middleware)',
  'local-persisted': 'Local-persisted (zustand/persist → localStorage)',
  ephemeral: 'Ephemeral (in-memory; dies with the tab)',
};

/**
 * Renders `src/store/README.md` from the registry. Kept pure so the
 * registry test can diff it against the checked-in file (and rewrite it
 * under REGEN_STORE_DOCS=1).
 */
export function renderStoreRegistryDocs(): string {
  const lines: string[] = [
    '<!-- GENERATED FILE — do not edit by hand. -->',
    '<!-- Source: src/store/registry.ts. Regenerate with: -->',
    '<!--   REGEN_STORE_DOCS=1 npx vitest run src/store/__tests__/registry.test.ts -->',
    '',
    '# State management (stores)',
    '',
    'Every zustand store in the app, declared in `src/store/registry.ts`',
    '(the three-tier registry). Synced stores are created exclusively through',
    '`defineSyncedStore` (src/store/yjs-provider.ts) from the def each store',
    'module exports — see the registry module docs for tier semantics,',
    'hydration modes, and the per-store flip ledger.',
    '',
  ];

  for (const tier of ['synced', 'local-persisted', 'ephemeral'] as const) {
    lines.push(`## ${TIER_HEADINGS[tier]}`, '');
    if (tier === 'synced') {
      lines.push(
        '| Store | Y.Map | Owner | Synced keys | Hydration | Scoped diff | Purpose |',
        '|---|---|---|---|---|---|---|',
      );
      for (const entry of STORE_REGISTRY.filter((e) => e.tier === tier)) {
        const def = entry.def;
        lines.push(
          `| \`${entry.module}\` | \`${entry.persistence}\` | ${entry.owner} | ` +
            `\`${(def?.syncedKeys ?? []).join('`, `')}\` | ` +
            `${def?.hydration} | ${def?.scopedDiff ? 'yes' : 'no'} | ${entry.summary} |`,
        );
      }
    } else {
      lines.push('| Store | Persistence | Owner | Purpose |', '|---|---|---|---|');
      for (const entry of STORE_REGISTRY.filter((e) => e.tier === tier)) {
        const persistence = entry.persistence === null ? '—' : `\`${entry.persistence}\``;
        lines.push(`| \`${entry.module}\` | ${persistence} | ${entry.owner} | ${entry.summary} |`);
      }
    }
    lines.push('');
  }

  lines.push(
    '### Hydration notes',
    '',
    '- `merge-defaults` retains a declared top-level default when the key is',
    '  absent from the doc (new fields survive hydration from older docs).',
    '  Retention is shallow: a present-but-empty map value wins over a rich',
    '  default, so **new nested fields inside an existing synced container',
    '  still need a migration backfill** (the v4→v5 `fontProfiles` pattern).',
    '- Deliberate top-level key removal is a migration concern: remove the key',
    '  from the def (`syncedKeys` + state defaults) and bump the schema',
    '  version in the same release.',
    '',
  );

  return lines.join('\n');
}
