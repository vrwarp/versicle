/**
 * domains/chinese — shared types (Phase 6 §7,
 * prep/phase6-reader-engine.md).
 *
 * `PinyinPosition` was defined inside the PinyinOverlay component; it is the
 * data contract between the content processor (geometry collection inside
 * the section iframe) and the overlay portal (parent-document rendering),
 * so it lives with the feature module. The overlay re-exports it for its
 * legacy import path.
 */
export interface PinyinPosition {
  char: string;
  pinyin: string;
  top: number;
  left: number;
  width: number;
  height: number;
}
