import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render } from '@testing-library/react';
import { UnifiedInputController } from '../UnifiedInputController';
import { useTTSStore } from '../../../store/useTTSStore';
import React from 'react';

describe('UnifiedInputController Immersive Mode', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRendition: any;
    let onToggleHUD: Mock;
    let onPrev: Mock;
    let onNext: Mock;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let clickHandler: ((e: any) => void) | undefined;

    beforeEach(() => {
        onToggleHUD = vi.fn();
        onPrev = vi.fn();
        onNext = vi.fn();
        clickHandler = undefined;

        mockRendition = {
            on: vi.fn((event, handler) => {
                if (event === 'click') {
                    clickHandler = handler;
                }
            }),
            off: vi.fn(),
        };

        useTTSStore.setState({
            isPlaying: false,
            play: vi.fn(),
            pause: vi.fn(),
            seek: vi.fn(),
            rate: 1,
            setRate: vi.fn(),
            providerId: 'local'
        });

        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('DOES NOT toggle HUD when clicking in the center (behavior change)', () => {
        render(
            <UnifiedInputController
                rendition={mockRendition}
                currentSectionTitle="Test Chapter"
                onPrev={onPrev}
                onNext={onNext}
                onToggleHUD={onToggleHUD}
                immersiveMode={true}
            />
        );

        // Ensure handler is attached
        expect(clickHandler).toBeDefined();

        // Simulate click in the center (50% width)
        const mockEvent = {
            view: {
                innerWidth: 1000,
                getSelection: () => ({ isCollapsed: true })
            },
            clientX: 500, // Center
            defaultPrevented: false,
            preventDefault: vi.fn(),
        };

        // Trigger the click handler
        if (clickHandler) {
            clickHandler(mockEvent);
        }

        // Advance timers to trigger single tap action (300ms delay in component)
        vi.advanceTimersByTime(350);

        // Expect onToggleHUD NOT to be called
        expect(onToggleHUD).not.toHaveBeenCalled();
    });

    it('navigates prev when clicking left', () => {
         render(
            <UnifiedInputController
                rendition={mockRendition}
                currentSectionTitle="Test Chapter"
                onPrev={onPrev}
                onNext={onNext}
                onToggleHUD={onToggleHUD}
                immersiveMode={true}
            />
        );

        expect(clickHandler).toBeDefined();

        const mockEvent = {
            view: {
                innerWidth: 1000,
                getSelection: () => ({ isCollapsed: true })
            },
            clientX: 100, // Left 10%
            defaultPrevented: false,
            preventDefault: vi.fn(),
        };

        if (clickHandler) {
            clickHandler(mockEvent);
        }

        vi.advanceTimersByTime(350);

        expect(onPrev).toHaveBeenCalled();
        expect(onToggleHUD).not.toHaveBeenCalled();
    });

    it('navigates next when clicking right', () => {
         render(
            <UnifiedInputController
                rendition={mockRendition}
                currentSectionTitle="Test Chapter"
                onPrev={onPrev}
                onNext={onNext}
                onToggleHUD={onToggleHUD}
                immersiveMode={true}
            />
        );

        expect(clickHandler).toBeDefined();

        const mockEvent = {
            view: {
                innerWidth: 1000,
                getSelection: () => ({ isCollapsed: true })
            },
            clientX: 900, // Right 90%
            defaultPrevented: false,
            preventDefault: vi.fn(),
        };

        if (clickHandler) {
            clickHandler(mockEvent);
        }

        vi.advanceTimersByTime(350);

        expect(onNext).toHaveBeenCalled();
        expect(onToggleHUD).not.toHaveBeenCalled();
    });
});
