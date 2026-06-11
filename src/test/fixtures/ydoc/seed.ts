/**
 * Shared seed dataset for the captured Y.Doc fixtures
 * (plan/overhaul/prep/phase2-fork-surgery.md §4.2).
 *
 * One constant dataset, rendered into era-specific docs by
 * scripts/capture-ydoc-fixture.ts:
 *
 *   - v1: Y.Text string encoding (pre-disableYText), one INVALID reading
 *     session ({ startTime: 'corrupt' }) — exercises the v1→v2 prune.
 *   - v2: Y.Text encoding, sessions pruned.
 *   - v4: plain-string encoding (the disableYText flip), preferences WITHOUT
 *     fontProfiles (exercises the v4→v5 backfill and contract case C.4),
 *     annotations carrying the stale top-level `popover` key (pre-hotfix
 *     shape; exercises the v6 deletion and syncedKeys case B.2).
 *   - v5: v4 + fontProfiles present.
 *
 * Deliberately NOT typed against the app's current store interfaces: these
 * are HISTORICAL doc shapes (including keys that no longer exist in state,
 * like `popover`), and they must not drift when current types evolve.
 * Values are fixed constants so captures are reproducible byte-for-byte
 * (fixed Y.Doc clientID in the capture script).
 */

export const DEVICE_A = 'fixture-device-a';
export const DEVICE_B = 'fixture-device-b';
export const BOOK_EN = 'fixture-book-alice';
export const BOOK_CJK = 'fixture-book-hongloumeng';

/** Era-plausible fixed timestamps (ms). */
const T0 = 1740000000000; // base
const T1 = 1740000600000;
const T2 = 1740001200000;

export type FixtureEra = 1 | 2 | 4 | 5;

export interface EraSeed {
  /** Y.Map name → plain-JSON content to encode with the era's string mapping. */
  maps: Record<string, Record<string, unknown>>;
}

const books = {
  [BOOK_EN]: {
    bookId: BOOK_EN,
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    addedAt: T0,
    lastInteraction: T2,
    sourceFilename: 'alice.epub',
    tags: ['classics'],
    status: 'reading',
    language: 'en',
  },
  [BOOK_CJK]: {
    bookId: BOOK_CJK,
    // CJK title: encoding realism for the Y.Text eras (multi-byte glyphs).
    title: '紅樓夢',
    author: '曹雪芹',
    addedAt: T1,
    lastInteraction: T1,
    sourceFilename: 'hongloumeng.epub',
    tags: [],
    status: 'unread',
    language: 'zh',
  },
};

const validSessionA = {
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:120)',
  startTime: T0,
  endTime: T0 + 300000,
  type: 'visual',
};
const validSessionB = {
  cfiRange: 'epubcfi(/6/6!/4/2,/1:0,/1:80)',
  startTime: T1,
  endTime: T1 + 120000,
  type: 'tts',
};
/** The v1-only corrupt entry the v1→v2 migration prunes. */
const invalidSession = {
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
  startTime: 'corrupt',
  endTime: T0 + 60000,
  type: 'visual',
};

/** progress: Record<bookId, Record<deviceId, UserProgress>> */
const progressFor = (era: FixtureEra) => ({
  [BOOK_EN]: {
    [DEVICE_A]: {
      bookId: BOOK_EN,
      percentage: 0.42,
      currentCfi: 'epubcfi(/6/4!/4/2/1:120)',
      lastRead: T2,
      completedRanges: ['epubcfi(/6/4!/4/2,/1:0,/1:120)'],
      readingSessions:
        era === 1 ? [validSessionA, invalidSession] : [validSessionA],
    },
    [DEVICE_B]: {
      bookId: BOOK_EN,
      percentage: 0.1,
      currentCfi: 'epubcfi(/6/4!/4/2/1:30)',
      lastRead: T1,
      completedRanges: [],
      readingSessions: [validSessionB],
    },
  },
});

const annotations = {
  'fixture-annotation-1': {
    id: 'fixture-annotation-1',
    bookId: BOOK_EN,
    cfiRange: 'epubcfi(/6/4!/4/2,/1:5,/1:25)',
    text: 'Down the Rabbit-Hole',
    type: 'highlight',
    color: '#ffd54f',
    createdAt: T1,
  },
  'fixture-annotation-2': {
    id: 'fixture-annotation-2',
    bookId: BOOK_CJK,
    cfiRange: 'epubcfi(/6/8!/4/2,/1:0,/1:4)',
    text: '甄士隱',
    type: 'note',
    color: '#81d4fa',
    note: 'character introduction',
    createdAt: T2,
  },
};

/**
 * The stale popover key (pre-hotfix useAnnotationStore shape, v4/v5 docs):
 * transient UI state that leaked into the CRDT — screen coordinates included.
 * Deleted by the v6 migration; structurally ignored by syncedKeys (B.2).
 */
const stalePopover = {
  visible: false,
  x: 312,
  y: 480,
  cfiRange: 'epubcfi(/6/4!/4/2,/1:5,/1:25)',
  selectedText: 'Down the Rabbit-Hole',
};

/** The 14 scalar pref fields (fontProfiles joins at v5; it did not exist before). */
const basePreferences = {
  currentTheme: 'sepia',
  customTheme: { bg: '#f4ecd8', fg: '#5b4636' },
  fontFamily: 'Literata',
  lineHeight: 1.6,
  fontSize: 110,
  shouldForceFont: false,
  readerViewMode: 'paginated',
  libraryLayout: 'grid',
  libraryFilterMode: 'all',
  librarySortOrder: 'recent',
  activeContext: 'library',
  forceTraditionalChinese: false,
  showPinyin: true,
  pinyinSize: 60,
};

const fontProfiles = {
  en: { fontSize: 100, lineHeight: 1.5 },
  zh: { fontSize: 120, lineHeight: 1.8 },
};

const preferencesFor = (era: FixtureEra, device: string) => ({
  ...basePreferences,
  fontFamily: device === DEVICE_A ? 'Literata' : 'Bookerly',
  ...(era >= 5 ? { fontProfiles } : {}),
});

const readingList = {
  'frankenstein.epub': {
    filename: 'frankenstein.epub',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    percentage: 0.65,
    lastRead: T1,
  },
};

const vocabulary = {
  knownCharacters: { 紅: T0, 樓: T1, 夢: T2 },
};

const lexicon = {
  rules: {
    'fixture-rule-1': {
      id: 'fixture-rule-1',
      pattern: 'Dr\\.',
      replacement: 'Doctor',
      isRegex: true,
      enabled: true,
      order: 0,
    },
    'fixture-rule-2': {
      id: 'fixture-rule-2',
      pattern: 'St.',
      replacement: 'Saint',
      isRegex: false,
      enabled: true,
      order: 1,
    },
  },
  settings: {
    [BOOK_EN]: { enabled: true },
  },
};

const contentAnalysis = {
  sections: {
    [`${BOOK_EN}:section-4`]: {
      bookId: BOOK_EN,
      sectionId: 'section-4',
      referenceStartCfi: 'epubcfi(/6/4!/4/40/1:0)',
      tableAdaptations: [
        { tableIndex: 0, adaptation: 'narrate-rows' },
      ],
      analyzedAt: T2,
    },
  },
};

const devices = {
  [DEVICE_A]: {
    id: DEVICE_A,
    name: 'Fixture Phone',
    platform: 'Android',
    browser: 'Chrome',
    model: 'Pixel 6',
    userAgent: 'fixture-ua-android',
    lastActive: T2,
  },
  [DEVICE_B]: {
    id: DEVICE_B,
    name: 'Fixture Laptop',
    platform: 'macOS',
    browser: 'Firefox',
    model: null,
    userAgent: 'fixture-ua-desktop',
    lastActive: T1,
  },
};

/** Build the per-map JSON for one era. Pure data — encoding happens in the capture script. */
export const seedFor = (era: FixtureEra): EraSeed => ({
  maps: {
    library: { __schemaVersion: era, books },
    progress: { progress: progressFor(era) },
    annotations: {
      annotations,
      ...(era >= 4 ? { popover: stalePopover } : {}),
    },
    [`preferences/${DEVICE_A}`]: preferencesFor(era, DEVICE_A),
    [`preferences/${DEVICE_B}`]: preferencesFor(era, DEVICE_B),
    'reading-list': { entries: readingList },
    vocabulary,
    lexicon,
    contentAnalysis,
    devices,
  },
});

export const FIXTURE_ERAS: readonly FixtureEra[] = [1, 2, 4, 5];
