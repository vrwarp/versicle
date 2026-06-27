import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PageTurnRails } from './PageTurnRails';

describe('PageTurnRails', () => {
  it('LTR: left rail turns to the previous page, right rail to the next', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<PageTurnRails onPrev={onPrev} onNext={onNext} />);

    const left = screen.getByTestId('page-turn-rail-left');
    const right = screen.getByTestId('page-turn-rail-right');
    expect(left).toHaveAttribute('aria-label', 'Previous page');
    expect(right).toHaveAttribute('aria-label', 'Next page');

    fireEvent.click(left);
    fireEvent.click(right);
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('RTL: mirrors so the leading (next) edge is on the left', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<PageTurnRails onPrev={onPrev} onNext={onNext} direction="rtl" />);

    const left = screen.getByTestId('page-turn-rail-left');
    const right = screen.getByTestId('page-turn-rail-right');
    expect(left).toHaveAttribute('aria-label', 'Next page');
    expect(right).toHaveAttribute('aria-label', 'Previous page');

    fireEvent.click(left);
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(right);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('isolates the page turn from the reader-view global click handler', () => {
    // The reader-view root clears popovers / compass state on any click; a
    // page turn must not also trigger that, so the rail stops propagation
    // (React forwards SyntheticEvent.stopPropagation to the native event).
    const onPrev = vi.fn();
    render(<PageTurnRails onPrev={onPrev} onNext={vi.fn()} />);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(clickEvent, 'stopPropagation');
    screen.getByTestId('page-turn-rail-left').dispatchEvent(clickEvent);

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalled();
  });
});
