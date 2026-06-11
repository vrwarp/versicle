/**
 * Axe smoke assertions on presentational primitives — proves the harness's
 * vitest-axe integration runs and demonstrates the opt-in usage pattern
 * (gap-accessibility report, debt #6 layer 2). Deeper per-component audits
 * land with each component's Phase 1+ rewrite.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { renderWithStores, runAxe } from '@test/harness';
import { Button } from './Button';
import { Toast } from './Toast';
import { Progress } from './Progress';

describe('axe smoke: ui primitives', () => {
  it('Button (text and icon-with-label variants) has no violations', async () => {
    const view = renderWithStores(
      <div>
        <Button>Save</Button>
        <Button aria-label="Close panel">×</Button>
      </div>,
    );
    expect(await view.axe()).toHaveNoViolations();
  });

  it('Toast (visible, success) has no violations', async () => {
    const view = renderWithStores(
      <Toast message="Library imported" isVisible type="success" onClose={vi.fn()} duration={0} />,
    );
    expect(await view.axe()).toHaveNoViolations();
  });

  it('Progress with an accessible name has no violations (plain render + runAxe)', async () => {
    const { container } = render(<Progress aria-label="Import progress" value={40} />);
    expect(await runAxe(container)).toHaveNoViolations();
  });
});
