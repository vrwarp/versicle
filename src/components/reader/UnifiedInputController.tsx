import React, { useRef, useState, useEffect } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import type { Rendition } from 'epubjs';
import { useShallow } from 'zustand/react/shallow';
import {
    Pause, RotateCcw, RotateCw,
    Volume1, Volume2,
    ChevronLeft, ChevronRight,
    Rewind, FastForward,
    Moon
} from 'lucide-react';

interface UnifiedInputControllerProps {
    rendition: Rendition | null;
    onPrev: () => void;
    onNext: () => void;
    onToggleHUD: () => void;
}

export const UnifiedInputController: React.FC<UnifiedInputControllerProps> = ({
    rendition,
    onPrev,
    onNext,
    onToggleHUD
}) => {
    const { isPlaying, play, pause, seek, rate, setRate, providerId } = useTTSStore(useShallow(state => ({
        isPlaying: state.isPlaying,
        play: state.play,
        pause: state.pause,
        seek: state.seek,
        rate: state.rate,
        setRate: state.setRate,
        providerId: state.providerId
    })));

    const [isCurtainActive, setIsCurtainActive] = useState(false);

    // Feedback state
    const [icon, setIcon] = useState<React.ReactNode | null>(null);
    const [iconKey, setIconKey] = useState(0);
    const [feedbackText, setFeedbackText] = useState('');

    const showFeedback = (iconNode: React.ReactNode, text?: string) => {
        setIcon(iconNode);
        setFeedbackText(text || '');
        setIconKey(k => k + 1);
        setTimeout(() => setIcon(null), 800);
    };

    // --- Visual Reading State (Audio Paused) ---
    const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastClickTimeRef = useRef<number>(0);

    // Ref to hold latest callbacks to avoid effect re-runs and timeout clearing on parent render
    const callbacksRef = useRef({ onPrev, onNext, onToggleHUD, play });
    useEffect(() => {
        callbacksRef.current = { onPrev, onNext, onToggleHUD, play };
    }, [onPrev, onNext, onToggleHUD, play]);

    useEffect(() => {
        if (!rendition || isPlaying) return;

        const handleSingleTapVisual = (e: MouseEvent) => {
             const view = e.view;
             if (!view) return;
             const width = view.innerWidth;
             const x = e.clientX;

             if (e.defaultPrevented) return;

             if (x < width * 0.2) {
                 callbacksRef.current.onPrev();
             } else if (x > width * 0.8) {
                 callbacksRef.current.onNext();
             } else {
                 callbacksRef.current.onToggleHUD();
             }
        };

        const handleClick = (e: MouseEvent) => {
            const selection = e.view?.getSelection();
            if (selection && !selection.isCollapsed) {
                return;
            }

            const now = Date.now();
            const timeDiff = now - lastClickTimeRef.current;

            if (timeDiff < 300) {
                // Double Tap
                if (clickTimeoutRef.current) {
                    clearTimeout(clickTimeoutRef.current);
                    clickTimeoutRef.current = null;
                }
                callbacksRef.current.play(); // Start Audio
            } else {
                // Single Tap - Wait
                clickTimeoutRef.current = setTimeout(() => {
                     handleSingleTapVisual(e);
                     clickTimeoutRef.current = null;
                }, 300);
            }
            lastClickTimeRef.current = now;
        };

        rendition.on('click', handleClick);
        return () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (rendition as any).off('click', handleClick);
            if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        };
    }, [rendition, isPlaying]); // Stable dependencies


    // --- Listening State (Audio Playing) ---
    const touchStart = useRef<{ x: number, y: number } | null>(null);
    const touchStartTime = useRef<number>(0);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!isPlaying) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        touchStart.current = { x: e.clientX, y: e.clientY };
        touchStartTime.current = Date.now();
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!isPlaying) return;
        e.currentTarget.releasePointerCapture(e.pointerId);

        if (!touchStart.current) return;

        const touchEnd = { x: e.clientX, y: e.clientY };
        const endTime = Date.now();
        const dx = touchEnd.x - touchStart.current.x;
        const dy = touchEnd.y - touchStart.current.y;
        const duration = endTime - touchStartTime.current;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const SWIPE_THRESHOLD = 50;
        const TAP_THRESHOLD = 10;
        const DOUBLE_TAP_TIMEOUT = 300;

        touchStart.current = null;

        if (duration < DOUBLE_TAP_TIMEOUT && absDx < TAP_THRESHOLD && absDy < TAP_THRESHOLD) {
            const now = Date.now();
            const timeDiff = now - lastClickTimeRef.current;
            lastClickTimeRef.current = now;

            if (timeDiff < DOUBLE_TAP_TIMEOUT) {
                 setIsCurtainActive(!isCurtainActive);
                 if (clickTimeoutRef.current) {
                     clearTimeout(clickTimeoutRef.current);
                     clickTimeoutRef.current = null;
                 }
                 return;
            }

            clickTimeoutRef.current = setTimeout(() => {
                const width = window.innerWidth;
                const x = touchEnd.x;

                if (isCurtainActive) {
                    showFeedback(<Moon size={64} />, "Curtain Active");
                    return;
                }

                if (x < width * 0.2) {
                    seek(-15);
                    if (providerId === 'local') {
                        showFeedback(<Rewind size={64} />, "Previous");
                    } else {
                        showFeedback(<RotateCcw size={64} />, "-15s");
                    }
                } else if (x > width * 0.8) {
                    seek(15);
                    if (providerId === 'local') {
                        showFeedback(<FastForward size={64} />, "Next");
                    } else {
                        showFeedback(<RotateCw size={64} />, "+15s");
                    }
                } else {
                    pause();
                    showFeedback(<Pause size={64} />, "Paused");
                }

                clickTimeoutRef.current = null;
            }, 300);

        } else if (absDx > SWIPE_THRESHOLD || absDy > SWIPE_THRESHOLD) {
             if (absDx > absDy) {
                 if (dx > 0) { // Right Swipe (Left to Right) -> Prev
                     // However, standard is Swipe Right -> Go Back (Prev)
                     if (dx > 0) {
                         onPrev();
                         showFeedback(<ChevronLeft size={64} />, "Prev Chapter");
                     } else {
                         onNext();
                         showFeedback(<ChevronRight size={64} />, "Next Chapter");
                     }
                 } else { // Left Swipe (Right to Left) -> Next
                     onNext();
                     showFeedback(<ChevronRight size={64} />, "Next Chapter");
                 }
             } else {
                 if (dy < 0) {
                     const newRate = Math.min(rate + 0.1, 3.0);
                     setRate(parseFloat(newRate.toFixed(1)));
                     showFeedback(<Volume2 size={64} />, `${newRate.toFixed(1)}x`);
                 } else {
                     const newRate = Math.max(rate - 0.1, 0.5);
                     setRate(parseFloat(newRate.toFixed(1)));
                     showFeedback(<Volume1 size={64} />, `${newRate.toFixed(1)}x`);
                 }
             }
        }
    };

    if (!isPlaying) return null;

    return (
        <div
            data-testid="flow-mode-overlay"
            className={`fixed inset-0 flex items-center justify-center select-none touch-none transition-colors duration-300 ${isCurtainActive ? 'bg-black z-[100]' : 'bg-transparent z-[30]'}`}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
        >
             {!isCurtainActive && (
                 <div data-testid="flow-mode-breathing-border" className="absolute inset-0 border-4 border-primary/30 animate-pulse pointer-events-none" />
             )}

             {isCurtainActive && (
                 <div className="text-neutral-500 text-sm font-medium pointer-events-none">
                     Double tap to unlock
                 </div>
             )}

             {icon && (
                <div key={iconKey} className="absolute inset-0 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 pointer-events-none z-[80]">
                  <div className="bg-white/20 p-8 rounded-full backdrop-blur-sm text-white drop-shadow-lg mb-4">
                    {icon}
                  </div>
                  <div className="text-white text-2xl font-bold drop-shadow-md">
                    {feedbackText}
                  </div>
                </div>
             )}
        </div>
    );
};
