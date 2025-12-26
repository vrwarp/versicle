import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render } from '@testing-library/react';
import { UnifiedInputController } from '../UnifiedInputController';
import { useTTSStore } from '../../../store/useTTSStore';
import React from 'react';

describe('UnifiedInputController Tap Logic', () => {
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
            manager: {
                container: {
                    clientWidth: 1000 // Default Width
                }
            }
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

    it('Issue A: Uses container width instead of window width for tap zones', () => {
        // Setup: Window is 1920px, Container is 700px.
        // Tap at 300px.
        // Old Logic: 300 < 1920 * 0.2 (384) -> True (Prev) - BUG
        // New Logic: 300 < 700 * 0.2 (140) -> False (No Prev) - FIX

        mockRendition.manager.container.clientWidth = 700;

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

        const mockEvent = {
            view: {
                innerWidth: 1920, // Wide Window
                getSelection: () => ({ isCollapsed: true })
            },
            clientX: 300, // Inside book, but > 20% of book width (140)
            defaultPrevented: false,
            preventDefault: vi.fn(),
        };

        if (clickHandler) {
            clickHandler(mockEvent);
        }

        vi.advanceTimersByTime(350);

        expect(onPrev).not.toHaveBeenCalled();
        expect(onNext).not.toHaveBeenCalled();
    });

    it('Issue B: Disables tap navigation when NOT in Immersive Mode', () => {
        render(
            <UnifiedInputController
                rendition={mockRendition}
                currentSectionTitle="Test Chapter"
                onPrev={onPrev}
                onNext={onNext}
                onToggleHUD={onToggleHUD}
                immersiveMode={false} // Standard Mode
            />
        );

        // Expect NO listener attached because the effect returns early
        expect(clickHandler).toBeUndefined();
    });

    it('Issue B: Enables tap navigation when in Immersive Mode', () => {
        render(
            <UnifiedInputController
                rendition={mockRendition}
                currentSectionTitle="Test Chapter"
                onPrev={onPrev}
                onNext={onNext}
                onToggleHUD={onToggleHUD}
                immersiveMode={true} // Immersive Mode
            />
        );

        expect(clickHandler).toBeDefined();
    });
});
