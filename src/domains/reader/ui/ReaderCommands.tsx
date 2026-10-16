/**
 * ReaderCommands — the typed command surface of the open reader.
 *
 * Commands travel through this typed surface instead of a window
 * CustomEvent, closures stored INSIDE useReaderUIStore (which keeps DATA
 * state only), or a `rendition` prop chain. Out-of-tree mounts such as
 * ReaderControlBar (mounted by RootLayout, outside the reader tree) can reach
 * the open reader through the registry, including `refineSelection()` for the
 * audio-triage selection-refinement path.
 *
 * Two consumption modes:
 *  - inside the reader tree: `useReaderCommands()` / `useReaderEngine()`
 *    (React context),
 *  - out-of-tree mounts (ReaderControlBar lives in RootLayout):
 *    `readerCommandsRegistry.get()` — registered by the provider on mount,
 *    cleared on unmount; null whenever no reader is open (callers handle
 *    absence).
 *
 * The provider takes an already-built ReaderCommands object rather than
 * building it from the engine: the TTS-aware chapter routing needs the audio
 * facade + playback store — app/state surfaces this domain module must not
 * import (domains-no-store). So the reader controller
 * (src/app/reader/useReaderController.ts) assembles the ReaderCommands object
 * and the provider owns context + registry lifecycle. `nextPage`/`prevPage`
 * exist because the keyboard path turns pages regardless of TTS chapter
 * routing (the keys are KeyboardShortcutService registrations —
 * src/app/shortcuts/ — where scope stacking decides ownership).
 */
import React, { createContext, useContext, useEffect } from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';

export interface ReaderCommands {
  /** Jump the reader to a CFI (sync-alert pill, history, panels). */
  jumpTo(cfi: string): void;
  /** Jump the reader so that the target CFI is aligned to the bottom of the viewport in scrolled mode. */
  jumpToEnd(cfi: string): void;
  /** Raw page turn (keyboard / nav surfaces; never TTS-routed). */
  nextPage(): void;
  prevPage(): void;
  /**
   * TTS-aware chapter navigation (the AudioPill arrows): routes to
   * skipToNext/PreviousSection while TTS is active, else turns the page.
   */
  nextChapter(): void;
  prevChapter(): void;
  /** Start playback at the queue item covering the selection. */
  playFromSelection(cfiRange: string): void;
  /**
   * Current iframe selection as a refined annotation target (the
   * audio-triage path) — null when nothing is selected.
   */
  refineSelection(): { cfiRange: string; text: string } | null;
}

interface ReaderCommandsContextValue {
  commands: ReaderCommands;
  engine: ReaderEngine | null;
}

const ReaderCommandsContext = createContext<ReaderCommandsContextValue | null>(null);

/** Out-of-tree handle (ReaderControlBar in RootLayout). Module-scope, inert. */
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
