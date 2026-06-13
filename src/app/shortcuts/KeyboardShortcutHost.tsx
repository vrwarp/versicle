import type React from 'react';
import { useEffect, useState } from 'react';
import { keyboardShortcutService } from './KeyboardShortcutService';
import { useShortcut } from './useShortcut';
import { ShortcutHelpSheet } from './ShortcutHelpSheet';

/**
 * KeyboardShortcutHost (Phase 8 §E) — mounts THE single window keydown
 * listener (eslint bans `addEventListener('keydown')` everywhere outside
 * src/app/shortcuts/) and the global `?` help-sheet shortcut. Mounted
 * once by the shell (RootLayout).
 */
export const KeyboardShortcutHost: React.FC = () => {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyboardShortcutService.handleKeyEvent(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useShortcut({
    id: 'global.help',
    key: '?',
    scope: 'global',
    descriptionKey: 'shortcuts.help.open',
    handler: () => setHelpOpen(true),
  });

  return <ShortcutHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />;
};
