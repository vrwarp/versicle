/**
 * useShortcut — React registration hook for the KeyboardShortcutService
 * (Phase 8 §E). Registers on mount, unregisters on unmount; the handler
 * and `when` predicate stay FRESH via refs, so callers pass plain inline
 * closures without re-registering (and without dev collision errors) on
 * every render.
 */
import { useEffect, useRef } from 'react';
import {
  keyboardShortcutService,
  type ShortcutRegistration,
} from './KeyboardShortcutService';

export function useShortcut(registration: ShortcutRegistration): void {
  const live = useRef(registration);
  // Keep the ref fresh AFTER render (react-hooks: refs are not written
  // during render); key events always fire after effects have run.
  useEffect(() => {
    live.current = registration;
  });

  const { id, key, scope, preventDefault, descriptionKey } = registration;
  const hasWhen = !!registration.when;

  useEffect(() => {
    return keyboardShortcutService.register({
      id,
      key,
      scope,
      preventDefault,
      descriptionKey,
      when: hasWhen ? () => live.current.when?.() ?? true : undefined,
      handler: (event) => live.current.handler(event),
    });
    // Re-register only when the registration IDENTITY changes — the
    // handler/when bodies ride the ref.
  }, [id, key, scope, preventDefault, descriptionKey, hasWhen]);
}
