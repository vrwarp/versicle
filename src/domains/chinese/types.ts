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

/**
 * A subscribable snapshot of the merged overlay positions (jank fix): the
 * app controller feeds processor emissions into one of these instead of
 * React state, so a geometry update re-renders ONLY the overlay portal
 * (via useSyncExternalStore in its host), never the whole reader shell.
 * Shape matches the useSyncExternalStore contract.
 */
export interface PinyinPositionsSource {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): PinyinPosition[];
}
