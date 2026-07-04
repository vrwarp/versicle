/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useSyncExternalStore } from 'react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from './Modal';
import { Button } from './Button';
import { formatMessage, type MessageKey, type MessageParams } from '@kernel/locale/messages';

/**
 * useConfirm / ConfirmHost (Phase 8 §D) — the accessible replacement for
 * every native `confirm()` site (banned by eslint `no-alert` +
 * `no-restricted-globals` at ERROR since this landed).
 *
 * Keyed per the i18n ADR: requests carry MessageKeys + params, never
 * prose. The implementation is a module-level request queue (no React
 * context): `useConfirm()` works in any component and `confirmDialog()`
 * works from non-React code, as long as ONE `<ConfirmHost/>` is mounted —
 * App.tsx mounts it above the router gate, so even the SafeMode reset
 * path gets the dialog. Requests made with no host mounted stay queued
 * until a host appears (mirroring the boot-time toast queue).
 */
export interface ConfirmRequest {
  titleKey: MessageKey;
  bodyKey?: MessageKey;
  /** Params applied to BOTH title and body templates. */
  params?: MessageParams;
  /** Destructive styling on the confirm button. */
  danger?: boolean;
  /** Confirm button label (default: common.confirm / common.delete when danger). */
  confirmKey?: MessageKey;
  /** Cancel button label (default: common.cancel). */
  cancelKey?: MessageKey;
}

interface PendingConfirm {
  request: ConfirmRequest;
  resolve: (confirmed: boolean) => void;
}

// Module-level queue + subscription (one source of truth, host-agnostic).
let queue: readonly PendingConfirm[] = [];
const subscribers = new Set<() => void>();

function setQueue(next: readonly PendingConfirm[]): void {
  queue = next;
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

function getSnapshot(): readonly PendingConfirm[] {
  return queue;
}

/**
 * Ask the user to confirm. Resolves `true` on confirm, `false` on cancel
 * or dismiss (Escape / overlay click). Callable from non-React code.
 */
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setQueue([...queue, { request, resolve }]);
  });
}

/** Hook flavor — the conventional component-side spelling. */
export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  return useCallback((request: ConfirmRequest) => confirmDialog(request), []);
}

/**
 * Renders the ACTIVE confirm request (queue head) as a modal dialog.
 * Mount exactly once, above the router gate (App.tsx).
 */
export const ConfirmHost: React.FC = () => {
  const pending = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const active = pending[0];

  if (!active) return null;

  const { request } = active;
  const settle = (confirmed: boolean) => {
    active.resolve(confirmed);
    setQueue(queue.filter((entry) => entry !== active));
  };

  const confirmLabel = formatMessage(
    request.confirmKey ?? (request.danger ? 'common.delete' : 'common.confirm'),
    request.params,
  );

  return (
    <Modal open onOpenChange={(open) => { if (!open) settle(false); }}>
      <ModalContent data-testid="confirm-dialog" className="max-w-md" hideCloseButton>
        <ModalHeader>
          <ModalTitle>{formatMessage(request.titleKey, request.params)}</ModalTitle>
          {request.bodyKey && (
            <ModalDescription className="whitespace-pre-line">
              {formatMessage(request.bodyKey, request.params)}
            </ModalDescription>
          )}
        </ModalHeader>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            data-testid="confirm-dialog-cancel"
            onClick={() => settle(false)}
          >
            {formatMessage(request.cancelKey ?? 'common.cancel', request.params)}
          </Button>
          <Button
            variant={request.danger ? 'destructive' : 'default'}
            data-testid="confirm-dialog-confirm"
            onClick={() => settle(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
};

/** Test seam: drop queued requests (resolving them as cancelled). */
export function resetConfirmQueueForTests(): void {
  for (const entry of queue) entry.resolve(false);
  setQueue([]);
}
