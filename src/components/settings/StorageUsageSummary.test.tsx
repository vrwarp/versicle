/**
 * StorageUsageSummary — the navigator.storage.estimate() settings surface
 * (P9, paying the P3 §Follow-ups item 7 the P8 settings pass left open).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { StorageUsageSummary } from './StorageUsageSummary';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubEstimate(value: Partial<StorageEstimate> | Promise<never>) {
  vi.stubGlobal('navigator', {
    ...navigator,
    storage: {
      estimate: () =>
        value instanceof Promise ? value : Promise.resolve(value as StorageEstimate),
    },
  });
}

describe('StorageUsageSummary', () => {
  it('renders usage of quota with a percentage', async () => {
    stubEstimate({ usage: 50 * 1024 * 1024, quota: 200 * 1024 * 1024 });
    render(<StorageUsageSummary />);

    const summary = await screen.findByTestId('storage-usage-summary');
    expect(summary.textContent).toContain('50 MB');
    expect(summary.textContent).toContain('200 MB');
    expect(summary.textContent).toContain('25%');
  });

  it('renders nothing when the API is unavailable', () => {
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    const { container } = render(<StorageUsageSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on a zero/absent quota (no divide-by-zero percent)', async () => {
    stubEstimate({ usage: 1024, quota: 0 });
    const { container } = render(<StorageUsageSummary />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
