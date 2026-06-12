/**
 * ReaderCommands — the typed command surface of the open reader (Phase 6
 * §5a, prep/phase6-reader-engine.md PR-8).
 *
 * Replaces three ad-hoc command paths that all died with this module:
 *  - the `reader:chapter-nav` window CustomEvent (CompassPill → ReaderView),
 *  - the `playFromSelection`/`jumpToLocation` closures stored INSIDE
 *    useReaderUIStore (callbacks-in-store),
 *  - the dead `rendition` prop chain (RootLayout mounted ReaderControlBar
 *    bare, so CompassPill's selection-refinement branch was unreachable —
 *    reader.md D11; it is reachable again via `refineSelection()`).
 *
 * Two consumption modes:
 *  - inside the reader tree: `useReaderCommands()` / `useReaderEngine()`
 *    (React context),
 *  - out-of-tree mounts (CompassPill lives in RootLayout):
 *    `readerCommandsRegistry.get()` — registered by the provider on mount,
 *    cleared on unmount; null whenever no reader is open (callers already
 *    handle absence, exactly like the optional store callbacks they
 *    replaced).
 *
 * Reconciliation vs the prep-doc sketch (recorded per program rules): the
 * doc draws `ReaderCommandsProvider: React.FC<{ engine }>` building the
 * commands itself, but the TTS-aware chapter routing needs the audio
 * facade + playback store — app/state surfaces this domain module must not
 * import (domains-no-store, master plan §2 rule 3). So the SHELL assembles
 * the ReaderCommands object (it owns those imports already) and the
 * provider owns context + registry lifecycle. `nextPage`/`prevPage` are
 * additions over the sketch: the keyboard path turns pages regardless of
 * TTS chapter routing (the P0 keyboard-gating predicates live in
 * useReaderNavigation and must stay byte-identical).
 */
import React, { createContext, useContext, useEffect } from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';

export interface ReaderCommands {
  /** Jump the reader to a CFI (sync-alert pill, history, panels). */
  jumpTo(cfi: string): void;
  /** Raw page turn (keyboard / nav surfaces; never TTS-routed). */
  nextPage(): void;
  prevPage(): void;
  /**
   * TTS-aware chapter navigation (the CompassPill arrows): routes to
   * skipToNext/PreviousSection while TTS is active, else turns the page.
   */
  nextChapter(): void;
  prevChapter(): void;
  /** Start playback at the queue item covering the selection. */
  playFromSelection(cfiRange: string): void;
  /**
   * Current iframe selection as a refined annotation target (the
   * audio-triage path, D11) — null when nothing is selected.
   */
  refineSelection(): { cfiRange: string; text: string } | null;
}

interface ReaderCommandsContextValue {
  commands: ReaderCommands;
  engine: ReaderEngine | null;
}

const ReaderCommandsContext = createContext<ReaderCommandsContextValue | null>(null);

/** Out-of-tree handle (CompassPill in RootLayout). Module-scope, inert. */
let registered: ReaderCommands | null = null;

export const readerCommandsRegistry = {
  get(): ReaderCommands | null {
    return registered;
  },
};

/**
 * Registers the active reader's commands; returns the unregister. Used by
 * the provider (and directly by test fixtures standing in for it).
 * Replacement overrides previous; only the current owner clears.
 */
export function registerReaderCommands(commands: ReaderCommands): () => void {
  registered = commands;
  return () => {
    if (registered === commands) {
      registered = null;
    }
  };
}

export const ReaderCommandsProvider: React.FC<{
  commands: ReaderCommands;
  engine: ReaderEngine | null;
  children: React.ReactNode;
}> = ({ commands, engine, children }) => {
  useEffect(() => registerReaderCommands(commands), [commands]);

  return (
    <ReaderCommandsContext.Provider value={{ commands, engine }}>
      {children}
    </ReaderCommandsContext.Provider>
  );
};

export function useReaderCommands(): ReaderCommands {
  const ctx = useContext(ReaderCommandsContext);
  if (!ctx) {
    throw new Error('useReaderCommands must be used inside ReaderCommandsProvider');
  }
  return ctx.commands;
}

/** The live engine for in-tree consumers (null while the book loads). */
export function useReaderEngine(): ReaderEngine | null {
  const ctx = useContext(ReaderCommandsContext);
  if (!ctx) {
    throw new Error('useReaderEngine must be used inside ReaderCommandsProvider');
  }
  return ctx.engine;
}
