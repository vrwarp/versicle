/**
 * domains/chinese — the self-contained Chinese reading feature module
 * (Phase 6 §7, prep/phase6-reader-engine.md PR-10).
 *
 * `registerChineseReading(engine, hooks)` is the ONLY reader-facing entry:
 * the reader core (hooks/useEpubReader, domains/reader) has ZERO imports
 * from this module — the dependency is inverted through the ReaderEngine's
 * content-processor seam (`contentRendered`/`contentDestroyed` events), and
 * the app layer (src/app/reader/useReaderController) registers the feature
 * only for Chinese books.
 *
 * CH-8 interim helper: `getBookBaseLanguage` normalizes BCP-47-ish
 * inventory values ('zh-CN', 'zh_TW', 'ZH') to their base subtag so the
 * legacy exact-match activation bug ('zh-CN' ≠ 'zh' → no pinyin) dies.
 * Full store-boundary normalization + inventory migration is P7's
 * `updateBook` territory (prep doc §7).
 */
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import {
  ChineseContentProcessor,
  type ChineseReadingHooks,
  type ChineseReadingPrefs,
} from './engine/ChineseContentProcessor';

export type { ChineseReadingHooks, ChineseReadingPrefs };
export type { PinyinPosition } from './types';
export { HAN_RE } from './engine/PinyinGeometryEngine';

/** Handle returned by {@link registerChineseReading}. */
export interface ChineseReadingRegistration {
  /** Re-run the content pass (preference / book-language change). */
  refresh(): void;
  /** Unsubscribe from the engine and drop all positions. */
  dispose(): void;
}

/**
 * Wire the Chinese reading pass to a reader engine. Call from the app
 * composition layer, and only when the book's base language is 'zh'.
 */
export function registerChineseReading(
  engine: ReaderEngine,
  hooks: ChineseReadingHooks,
): ChineseReadingRegistration {
  const processor = new ChineseContentProcessor(engine, hooks);
  processor.start();
  return {
    refresh: () => processor.refresh(),
    dispose: () => processor.dispose(),
  };
}

/**
 * Base language subtag of a book's inventory `language` value (CH-8 interim
 * helper): lowercased, first hyphen/underscore segment, 'en' when absent.
 */
export function getBookBaseLanguage(language: string | null | undefined): string {
  return (language || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en';
}
