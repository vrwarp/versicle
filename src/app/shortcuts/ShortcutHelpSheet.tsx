import React, { useSyncExternalStore } from 'react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@components/ui/Modal';
import { formatMessage } from '@kernel/locale/messages';
import { keyboardShortcutService } from './KeyboardShortcutService';

/** Display label for a `KeyboardEvent.key` value. */
function keyLabel(key: string): string {
  switch (key) {
    case ' ': return 'Space';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'Escape': return 'Esc';
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
}

interface ShortcutHelpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The `?` help sheet (Phase 8 §E discoverability gap): GENERATED from the
 * live registrations' descriptionKeys — registering a shortcut documents
 * it; there is no second list to forget.
 */
export const ShortcutHelpSheet: React.FC<ShortcutHelpSheetProps> = ({ open, onOpenChange }) => {
  const registrations = useSyncExternalStore(
    (notify) => keyboardShortcutService.subscribe(notify),
    () => keyboardShortcutService.getRegistrations(),
    () => keyboardShortcutService.getRegistrations(),
  );

  const documented = registrations.filter((r) => r.descriptionKey);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent data-testid="shortcut-help-sheet" className="max-w-md">
        <ModalHeader>
          <ModalTitle>{formatMessage('shortcuts.help.title')}</ModalTitle>
          <ModalDescription className="sr-only">
            {formatMessage('shortcuts.help.title')}
          </ModalDescription>
        </ModalHeader>
        <ul className="space-y-2">
          {documented.map((registration) => (
            <li key={registration.id} className="flex items-center justify-between gap-4 text-sm">
              <span>{formatMessage(registration.descriptionKey!)}</span>
              <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                {keyLabel(registration.key)}
              </kbd>
            </li>
          ))}
        </ul>
      </ModalContent>
    </Modal>
  );
};
