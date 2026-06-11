<!-- GENERATED FILE — do not edit by hand. -->
<!-- Source: src/store/registry.ts. Regenerate with: -->
<!--   REGEN_STORE_DOCS=1 npx vitest run src/store/__tests__/registry.test.ts -->

# State management (stores)

Every zustand store in the app, declared in `src/store/registry.ts`
(the three-tier registry). Synced stores are created exclusively through
`defineSyncedStore` (src/store/yjs-provider.ts) from the def each store
module exports — see the registry module docs for tier semantics,
hydration modes, and the per-store flip ledger.

## Synced (CRDT user data — replicated via the Yjs middleware)

| Store | Y.Map | Owner | Synced keys | Hydration | Scoped diff | Purpose |
|---|---|---|---|---|---|---|
| `useBookStore` | `library` | library | `books` | replace | no | Book inventory (per-book user data; carries __schemaVersion). |
| `useReadingStateStore` | `progress` | reader | `progress` | replace | no | Reading progress per book per device, incl. reading sessions. |
| `useAnnotationStore` | `annotations` | reader | `annotations` | replace | no | Highlights and notes, keyed by UUID. |
| `usePreferencesStore` | `preferences.<deviceId>` | shell | `currentTheme`, `customTheme`, `fontFamily`, `lineHeight`, `fontSize`, `shouldForceFont`, `readerViewMode`, `libraryLayout`, `libraryFilterMode`, `librarySortOrder`, `activeContext`, `fontProfiles`, `forceTraditionalChinese`, `showPinyin`, `pinyinSize` | merge-defaults | yes | Per-device display preferences (theme, fonts, layout, Chinese). |
| `useReadingListStore` | `reading-list` | library | `entries` | merge-defaults | yes | Reading-list entries keyed by filename (progress projection). |
| `useVocabularyStore` | `vocabulary` | chinese | `knownCharacters` | merge-defaults | yes | Known Chinese characters (char → learned-at timestamp). |
| `useLexiconStore` | `lexicon` | audio | `rules`, `settings` | merge-defaults | yes | TTS pronunciation rules + per-book lexicon settings. |
| `useContentAnalysisStore` | `contentAnalysis` | audio | `sections` | merge-defaults | yes | AI content-analysis cache (references, table adaptations, titles). |
| `useDeviceStore` | `devices` | sync | `devices` | merge-defaults | yes | Device registry of the sync mesh (UA, heartbeat, names). |

## Local-persisted (zustand/persist → localStorage)

| Store | Persistence | Owner | Purpose |
|---|---|---|---|
| `useSyncStore` | `sync-storage` | sync | Firebase config, sync/auth status, onboarding flag. |
| `useTTSStore` | `tts-storage` | audio | TTS provider/voice/playback settings and segmentation config. |
| `useDriveStore` | `drive-config-storage` | google | Linked Drive folder + scanned file index. |
| `useGoogleServicesStore` | `google-services-storage` | google | Connected Google services + OAuth client ids. |
| `useGenAIStore` | `genai-storage` | google | Gemini API key/model config, feature toggles, request logs. |
| `useLocalHistoryStore` | `local-history-storage` | reader | Last-read book id (local cache to avoid progress-map scans). |

## Ephemeral (in-memory; dies with the tab)

| Store | Persistence | Owner | Purpose |
|---|---|---|---|
| `useLibraryStore` | — | library | Static-metadata projection of IndexedDB + offloaded-book set. |
| `useUIStore` | — | shell | Global UI flags (settings dialog, obsolete-client lock). |
| `useToastStore` | — | shell | Toast notification state. |
| `useReaderUIStore` | — | reader | Reader session UI (menus, popover, compass, reader callbacks). |
| `useBackNavigationStore` | — | shell | Priority-ordered back-button handler registry. |
| `useSidebarStore` | — | reader | Which reader side panel (TOC/search/annotations/audio) is open. |

### Hydration notes

- `merge-defaults` retains a declared top-level default when the key is
  absent from the doc (new fields survive hydration from older docs).
  Retention is shallow: a present-but-empty map value wins over a rich
  default, so **new nested fields inside an existing synced container
  still need a migration backfill** (the v4→v5 `fontProfiles` pattern).
- Deliberate top-level key removal is a migration concern: remove the key
  from the def (`syncedKeys` + state defaults) and bump the schema
  version in the same release.
