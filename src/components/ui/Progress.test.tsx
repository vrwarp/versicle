import React from 'react';
import { render, screen } from '@testing-library/react';
import { Progress } from './Progress';
import { describe, it, expect } from 'vitest';

describe('Progress', () => {
  it('renders with default values (value=0, max=100)', () => {
    render(<Progress />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(progress).toHaveAttribute('aria-valuemin', '0');

    const indicator = progress.firstElementChild;
    expect(indicator).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it('renders with custom value and max', () => {
    render(<Progress value={30} max={200} />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '30');
    expect(progress).toHaveAttribute('aria-valuemax', '200');

    // percentage = 30/200 * 100 = 15%
    // transform = translateX(-(100 - 15)%) = translateX(-85%)
    const indicator = progress.firstElementChild;
    expect(indicator).toHaveStyle({ transform: 'translateX(-85%)' });
  });

  it('clamps value to 0 if value is negative', () => {
    render(<Progress value={-10} />);
    const progress = screen.getByRole('progressbar');
    // Note: aria-valuenow is set to the raw value, but the visual percentage is clamped
    expect(progress).toHaveAttribute('aria-valuenow', '-10');

    const indicator = progress.firstElementChild;
    expect(indicator).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it('clamps value to max if value is greater than max', () => {
    render(<Progress value={110} max={100} />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '110');

    const indicator = progress.firstElementChild;
    expect(indicator).toHaveStyle({ transform: 'translateX(-0%)' });
  });

  it('applies custom className', () => {
    render(<Progress className="custom-class" />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveClass('custom-class');
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Progress ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveAttribute('role', 'progressbar');
  });

  it('handles undefined value as 0', () => {
    render(<Progress value={undefined} />);
    const progress = screen.getByRole('progressbar');
    // The `value = 0` destructuring default also applies to an explicit undefined.
    expect(progress).toHaveAttribute('aria-valuenow', '0');
    const indicator = progress.firstElementChild;
    expect(indicator).toHaveStyle({ transform: 'translateX(-100%)' });
  });
});
