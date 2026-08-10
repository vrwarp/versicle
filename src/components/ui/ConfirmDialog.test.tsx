/**
 * useConfirm / ConfirmHost suite (Phase 8 §D) — the accessible replacement
 * for native confirm() (banned at lint ERROR with this PR).
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { runAxe } from '@test/harness';
import {
  ConfirmHost,
  confirmDialog,
  resetConfirmQueueForTests,
} from './ConfirmDialog';

describe('ConfirmDialog (useConfirm / confirmDialog)', () => {
  afterEach(() => {
    act(() => { resetConfirmQueueForTests(); });
  });

  it('resolves true on confirm, rendering keyed copy with params', async () => {
    act(() => { render(<ConfirmHost />); });

    let promise: Promise<boolean> = Promise.resolve(false);
    act(() => { promise = confirmDialog({
      titleKey: 'syncSettings.deleteWorkspace.title',
      bodyKey: 'syncSettings.deleteWorkspace.body',
      params: { name: 'My Workspace' },
      danger: true,
     }); });

    // Keyed title resolves WITH params (i18n ADR §2).
    expect(await screen.findByText('Delete workspace "My Workspace"?')).toBeInTheDocument();

    act(() => { fireEvent.click(screen.getByTestId('confirm-dialog-confirm')); });
    await expect(promise).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
  });

  it('resolves false on cancel', async () => {
    act(() => { render(<ConfirmHost />); });
    let promise: Promise<boolean> = Promise.resolve(false);
    act(() => { promise = confirmDialog({  titleKey: 'data.clearAll.title', bodyKey: 'data.clearAll.body'  }); });
    await act(async () => { fireEvent.click(await screen.findByTestId('confirm-dialog-cancel')); });
    await expect(promise).resolves.toBe(false);
  });

  it('danger requests default the confirm label to Delete; plain ones to Confirm', async () => {
    act(() => { render(<ConfirmHost />); });

    let dangerous: Promise<boolean> = Promise.resolve(false);
    act(() => { dangerous = confirmDialog({  titleKey: 'data.clearAll.title', danger: true  }); });
    expect(await screen.findByTestId('confirm-dialog-confirm')).toHaveTextContent('Delete');
    act(() => { fireEvent.click(screen.getByTestId('confirm-dialog-cancel')); });
    await dangerous;

    let plain: Promise<boolean> = Promise.resolve(false);
    act(() => { plain = confirmDialog({  titleKey: 'data.regenerate.title'  }); });
    await waitFor(() =>
      expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Confirm'),
    );
    act(() => { fireEvent.click(screen.getByTestId('confirm-dialog-cancel')); });
    await plain;
  });

  it('queues requests: the second dialog appears after the first settles', async () => {
    act(() => { render(<ConfirmHost />); });

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => { first = confirmDialog({  titleKey: 'data.clearAll.title'  }); });
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => { second = confirmDialog({  titleKey: 'data.regenerate.title'  }); });

    const els = await screen.findAllByText('Delete ALL data?'); expect(els.length).toBeGreaterThan(0);
    expect(screen.queryByText('Regenerate metadata?')).toBeNull();

    act(() => { fireEvent.click(screen.getByTestId('confirm-dialog-confirm')); });
    await expect(first).resolves.toBe(true);

    const els2 = await screen.findAllByText('Regenerate metadata?'); expect(els2.length).toBeGreaterThan(0);
    act(() => { fireEvent.click(screen.getByTestId('confirm-dialog-cancel')); });
    await expect(second).resolves.toBe(false);
  });

  it('a request made BEFORE any host mounts renders once a host appears (boot-time parity with the toast queue)', async () => {
    let promise: Promise<boolean> = Promise.resolve(false);
    act(() => { promise = confirmDialog({  titleKey: 'app.resetAll.title', bodyKey: 'app.resetAll.body'  }); });

    act(() => { render(<ConfirmHost />); });
    await act(async () => { fireEvent.click(await screen.findByTestId('confirm-dialog-confirm')); });
    await expect(promise).resolves.toBe(true);
  });

  it('passes axe (dialog semantics, labelled controls)', async () => {
    act(() => { render(<ConfirmHost />); });
    let promise: Promise<boolean> = Promise.resolve(false);
    act(() => { promise = confirmDialog({
      titleKey: 'app.resetAll.title',
      bodyKey: 'app.resetAll.body',
      danger: true,
     }); });
    await screen.findByTestId('confirm-dialog');

    // The dialog renders in a portal — scan the whole body.
    expect(await runAxe(document.body)).toHaveNoViolations();

    act(() => { fireEvent.click(screen.getByTestId('confirm-dialog-cancel')); });
    await promise;
  });
});
