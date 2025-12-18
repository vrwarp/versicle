import React, { useRef, useState } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw,
  Volume1, Volume2,
  ChevronLeft, ChevronRight,
  X, Rewind, FastForward
} from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useShallow } from 'zustand/react/shallow';

interface GestureOverlayProps {
  /** Callback for swipe left gesture (Next Chapter). */
  onNextChapter?: () => void;
  /** Callback for swipe right gesture (Prev Chapter). */
  onPrevChapter?: () => void;
  /** Callback to close the overlay. */
  onClose?: () => void;
}

/**
 * Full-screen overlay that captures touch gestures for audio control without looking at the screen.
 * Supports taps (rewind/play/forward) and swipes (chapter navigation, speed control).
 *
 * @param props - Component props.
 * @returns The gesture overlay component or null if not active.
 */
export const GestureOverlay: React.FC<GestureOverlayProps> = ({
  onNextChapter,
  onPrevChapter,
  onClose
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

  const gestureMode = useReaderStore(useShallow(state => state.gestureMode));

  const [icon, setIcon] = useState<React.ReactNode | null>(null);
  const [iconKey, setIconKey] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');

  // Pointer tracking
  const touchStart = useRef<{ x: number, y: number } | null>(null);
  const touchStartTime = useRef<number>(0);

  // Show visual feedback
  const showFeedback = (iconNode: React.ReactNode, text?: string) => {
    setIcon(iconNode);
    setFeedbackText(text || '');
    setIconKey(k => k + 1); // Force re-render of animation

    // Auto clear is handled by CSS animation usually, but we can also timeout
    setTimeout(() => setIcon(null), 800);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Prevent default to stop text selection or native touch actions
    // However, touch-action: none handles the scrolling part.
    // e.preventDefault();

    // Capture pointer to track movement even if it leaves the element
    e.currentTarget.setPointerCapture(e.pointerId);

    touchStart.current = {
      x: e.clientX,
      y: e.clientY
    };
    touchStartTime.current = Date.now();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (!touchStart.current) {
        return;
    }

    const touchEnd = {
      x: e.clientX,
      y: e.clientY
    };
    const endTime = Date.now();

    const dx = touchEnd.x - touchStart.current.x;
    const dy = touchEnd.y - touchStart.current.y;
    const duration = endTime - touchStartTime.current;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const SWIPE_THRESHOLD = 50; // px
    const TAP_THRESHOLD = 10;   // px
    const TAP_TIMEOUT = 300;    // ms

    // TAP DETECTION
    // Note: Use clientX from the original touchStart event for tap zone logic,
    // or rely on touchEnd x if we assume minimal movement.
    // Since we validated movement < THRESHOLD, touchEnd.x is roughly equal to touchStart.x
    if (duration < TAP_TIMEOUT && absDx < TAP_THRESHOLD && absDy < TAP_THRESHOLD) {
      const width = window.innerWidth;
      const x = touchStart.current.x; // Use start position for tap zone consistency

      if (x < width * 0.25) {
        // Left Zone: Rewind
        seek(-15);
        if (providerId === 'local') {
          showFeedback(<Rewind size={64} />, "Previous");
        } else {
          showFeedback(<RotateCcw size={64} />, "-15s");
        }
      } else if (x > width * 0.75) {
        // Right Zone: Forward
        seek(15);
        if (providerId === 'local') {
          showFeedback(<FastForward size={64} />, "Next");
        } else {
          showFeedback(<RotateCw size={64} />, "+15s");
        }
      } else {
        // Center Zone: Play/Pause
        if (isPlaying) {
          pause();
          showFeedback(<Pause size={64} />, "Paused");
        } else {
          play();
          showFeedback(<Play size={64} />, "Playing");
        }
      }
    }
    // SWIPE DETECTION
    else if (absDx > SWIPE_THRESHOLD || absDy > SWIPE_THRESHOLD) {
      if (absDx > absDy) {
        // Horizontal Swipe
        if (dx > 0) {
          // Swipe Right -> Prev Chapter (or confirm?)
          if (onPrevChapter) {
            onPrevChapter();
            showFeedback(<ChevronLeft size={64} />, "Prev Chapter");
          }
        } else {
          // Swipe Left -> Next Chapter
          if (onNextChapter) {
            onNextChapter();
            showFeedback(<ChevronRight size={64} />, "Next Chapter");
          }
        }
      } else {
        // Vertical Swipe -> Speed Control
        if (dy < 0) {
          // Swipe Up -> Faster
          const newRate = Math.min(rate + 0.1, 3.0);
          setRate(parseFloat(newRate.toFixed(1)));
          showFeedback(<Volume2 size={64} />, `${newRate.toFixed(1)}x`);
        } else {
          // Swipe Down -> Slower
          const newRate = Math.max(rate - 0.1, 0.5);
          setRate(parseFloat(newRate.toFixed(1)));
          showFeedback(<Volume1 size={64} />, `${newRate.toFixed(1)}x`);
        }
      }
    }

    touchStart.current = null;
  };

  if (!gestureMode) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      // Stop clicks from propagating to underlying elements (e.g. reader iframe)
      onClick={(e) => e.stopPropagation()}
      // Prevent browser default actions
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute top-6 right-6 z-[70]">
        <button
            onClick={(e) => {
              e.stopPropagation();
              if (onClose) onClose();
            }}
            // Stop pointer down from starting a gesture
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-4 py-2 rounded-full backdrop-blur-md transition-all active:scale-95"
            aria-label="Exit Gesture Mode"
        >
            <X size={16} />
            <span className="font-medium">Exit</span>
        </button>
      </div>

      <div className="text-white text-center pointer-events-none">
        <p className="mb-8 text-xl font-medium">Gesture Mode Active</p>
        <div className="grid grid-cols-3 gap-8 text-sm opacity-90 max-w-sm mx-auto font-medium">
            <div className="flex flex-col items-center">
                <span className="mb-1">Tap Left</span>
                <span>{providerId === 'local' ? 'Previous' : 'Rewind'}</span>
            </div>
            <div className="flex flex-col items-center">
                <span className="mb-1">Tap Center</span>
                <span>Play/Pause</span>
            </div>
            <div className="flex flex-col items-center">
                <span className="mb-1">Tap Right</span>
                <span>{providerId === 'local' ? 'Next' : 'Forward'}</span>
            </div>
            <div className="flex flex-col items-center col-span-3 mt-4">
                <span>Swipe Vertical: Speed | Horizontal: Chapter</span>
            </div>
        </div>
      </div>

      {icon && (
        <div key={iconKey} className="absolute inset-0 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 pointer-events-none">
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
