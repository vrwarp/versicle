/**
 * KeyboardShortcutService (Phase 8 §E) — THE structural home of the P0
 * keyboard-gating hotfix.
 *
 * Before this service, TWO overlapping window keydown registries existed
 * (useReaderNavigation page turns + ReaderTTSController playback keys),
 * each carrying a hand-rolled predicate about the OTHER's state — the
 * exact destructive-conflict class the P0 hotfix papered over ("Interim
 * mitigation until the Phase 8 KeyboardShortcutService replaces both").
 * Both registries and both interim predicates are deleted; their behavior
 * survives byte-identically as scope-stacked registrations:
 *
 *   'global' < 'reader' < 'tts-active' < 'overlay'   (top-most wins)
 *
 * Dispatch walks scopes top-down and fires the FIRST registration whose
 * key matches and whose `when()` passes — so the TTS sentence-jump owns
 * ArrowLeft/ArrowRight while `tts-active` is live (playing|paused), and
 * the reader page-turn gets them back the instant it is not. One
 * keypress, exactly one action, in every TTS state (the §E acceptance
 * matrix pins this).
 *
 * Built-in policies (absorbed from the two registries):
 *  - `e.repeat` is ignored (no page-turn/jump spam on held keys);
 *  - keypresses while typing (input/textarea/contenteditable) are ignored;
 *  - Space NEVER fires when a focusable interactive control has focus
 *    (the control keeps its own Space activation);
 *  - Escape resolves the TOP-MOST OPEN OVERLAY first: while a Radix
 *    dialog/sheet/menu/popover is open, Escape is left entirely to it —
 *    `tts-active` may only stop playback when no overlay is open;
 *  - DEV-mode collision error on a duplicate `(key, scope)` registration.
 *
 * ONE window keydown listener feeds {@link handleKeyEvent}
 * (KeyboardShortcutHost, mounted by the shell); the reader feature feeds
 * the SAME entry point from the engine's forwarded iframe keydown stream
 * (the C7 ReaderEngine port event — keys work with focus inside the book).
 *
 * The singleton lives in src/app/ (master plan §2 rule 8: only app/
 * constructs singletons). eslint bans `addEventListener('keydown')`
 * outside this directory.
 */
import type { MessageKey } from '@kernel/locale/messages';

export type ShortcutScope = 'global' | 'reader' | 'tts-active' | 'overlay';

/** Top-most first — dispatch order. */
const SCOPE_PRIORITY: readonly ShortcutScope[] = ['overlay', 'tts-active', 'reader', 'global'];

export interface ShortcutRegistration {
  /** Stable id, `<owner>.<action>` (diagnostics + help sheet). */
  id: string;
  /** `KeyboardEvent.key` value (`' '` for Space, `'?'`, `'ArrowLeft'`, …). */
  key: string;
  scope: ShortcutScope;
  /**
   * Activation predicate, evaluated at dispatch. A scope is "active" for
   * a key exactly when a matching registration's `when()` passes — a
   * false predicate lets LOWER scopes take the key.
   */
  when?: () => boolean;
  handler: (event: KeyboardEvent) => void;
  /** Call `event.preventDefault()` before the handler runs (if cancelable). */
  preventDefault?: boolean;
  /** Help-sheet copy (i18n ADR: keys, not prose). Omit to hide from the sheet. */
  descriptionKey?: MessageKey;
}

export type Unregister = () => void;

/**
 * Focused interactive controls own Space themselves; hijacking it (and
 * calling preventDefault) would swallow e.g. a header button's activation.
 * (Moved verbatim from ReaderTTSController — the P0 hotfix.)
 */
const INTERACTIVE_TARGET_SELECTOR = 'button, a[href], select, summary, [role="button"]';

/**
 * An open overlay (Radix dialog/sheet/menu/popover) owns Escape: it
 * dismisses the overlay, and stopping playback at the same time would
 * kill the audio session the user only meant to close a dialog over.
 * (Moved verbatim from ReaderTTSController — the P0 hotfix.)
 */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-radix-popper-content-wrapper] [data-state="open"]',
].join(', ');

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    (target as HTMLElement).isContentEditable
  );
}

function matchesKey(registration: ShortcutRegistration, event: KeyboardEvent): boolean {
  if (registration.key === ' ') {
    return event.key === ' ' || event.code === 'Space';
  }
  return event.key === registration.key;
}

type RegistryListener = () => void;

export class KeyboardShortcutService {
  private registrations: ShortcutRegistration[] = [];
  private listeners = new Set<RegistryListener>();
  /** Cached snapshot — useSyncExternalStore needs referential stability. */
  private snapshot: readonly ShortcutRegistration[] = [];

  /**
   * Register a shortcut. Returns the unregister function. DEV-mode
   * collision error on duplicate `(key, scope)` — two owners of the same
   * key in the same scope is exactly the bug class this service exists
   * to make impossible.
   */
  register(registration: ShortcutRegistration): Unregister {
    const collision = this.registrations.find(
      (r) => r.key === registration.key && r.scope === registration.scope,
    );
    if (collision) {
      const message =
        `KeyboardShortcutService: duplicate registration for key "${registration.key}" ` +
        `in scope "${registration.scope}" (existing: ${collision.id}, new: ${registration.id})`;
      if (import.meta.env.DEV) {
        throw new Error(message);
      }
      // Production: refuse the duplicate loudly but keep running.
      console.error(message);
      return () => {};
    }

    this.registrations.push(registration);
    this.notify();
    return () => {
      const index = this.registrations.indexOf(registration);
      if (index >= 0) {
        this.registrations.splice(index, 1);
        this.notify();
      }
    };
  }

  /**
   * THE dispatch entry point — fed by the shell's single window listener
   * and by the reader engine's forwarded iframe keydown stream.
   */
  handleKeyEvent(event: KeyboardEvent): void {
    // Held keys never spam actions (both legacy registries guarded this).
    if (event.repeat) return;

    // Typing wins over every shortcut (Search/Notes inputs, note editor).
    if (isTypingTarget(event.target)) return;

    // Space stays with a focused interactive control.
    if (
      (event.key === ' ' || event.code === 'Space') &&
      event.target instanceof Element &&
      event.target.closest(INTERACTIVE_TARGET_SELECTOR)
    ) {
      return;
    }

    // Escape resolves the TOP-MOST overlay before any scope below
    // 'overlay' may see it (the overlay closes itself — Radix owns that).
    if (event.key === 'Escape' && typeof document !== 'undefined') {
      if (document.querySelector(OPEN_OVERLAY_SELECTOR)) {
        const overlayHandled = this.dispatchIn('overlay', event);
        void overlayHandled; // overlay-scope registrations are optional
        return;
      }
    }

    for (const scope of SCOPE_PRIORITY) {
      if (this.dispatchIn(scope, event)) return;
    }
  }

  private dispatchIn(scope: ShortcutScope, event: KeyboardEvent): boolean {
    for (const registration of this.registrations) {
      if (registration.scope !== scope) continue;
      if (!matchesKey(registration, event)) continue;
      if (registration.when && !registration.when()) continue;

      if (registration.preventDefault && event.cancelable) {
        event.preventDefault();
      }
      registration.handler(event);
      return true;
    }
    return false;
  }

  /** Snapshot for the help sheet (stable array identity between changes). */
  getRegistrations(): readonly ShortcutRegistration[] {
    return this.snapshot;
  }

  /** Subscribe to registration changes (help sheet re-render). */
  subscribe(listener: RegistryListener): Unregister {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.snapshot = this.registrations.slice();
    for (const listener of this.listeners) listener();
  }
}

/** The app-level singleton (rule 8: app/ constructs singletons). */
export const keyboardShortcutService = new KeyboardShortcutService();
