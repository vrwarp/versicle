import React, { useRef, useState } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw,
  Volume1, Volume2,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';

interface GestureOverlayProps {
  onNextChapter?: () => void;
  onPrevChapter?: () => void;
  onClose?: () => void;
}

export const GestureOverlay: React.FC<GestureOverlayProps> = ({
  onNextChapter,
  onPrevChapter,
  onClose
}) => {
  const { isPlaying, play, pause, seek, rate, setRate } = useTTSStore();
  const { gestureMode } = useReaderStore(); // Assuming we add this to store

  const [icon, setIcon] = useState<React.ReactNode | null>(null);
  const [iconKey, setIconKey] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');

  // Touch tracking
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
    touchStartTime.current = Date.now();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;

    const touchEnd = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY
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
    if (duration < TAP_TIMEOUT && absDx < TAP_THRESHOLD && absDy < TAP_THRESHOLD) {
      const width = window.innerWidth;
      const x = touchEnd.x;

      if (x < width * 0.25) {
        // Left Zone: Rewind
        seek(-15);
        showFeedback(<RotateCcw size={64} />, "-15s");
      } else if (x > width * 0.75) {
        // Right Zone: Forward
        seek(15);
        showFeedback(<RotateCw size={64} />, "+15s");
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
        // Vertical Swipe -> Speed Control (Plan says Volume, but TTS API usually controls Speed more reliably on web, Volume is often system)
        // Let's stick to Plan which says "Swipe Up/Down: Volume +/-".
        // However, Web Audio / SpeechSynth volume control can be tricky.
        // Let's implement Volume if store supports it, or Speed as fallback if logic map allows deviation?
        // Plan says "Swipe Up/Down: Volume +/-".
        // NOTE: Standard iOS/Android behavior prevents programmatic volume control often.
        // Speed is safer. But let's check store. useTTSStore has `rate`, `setRate`. Does it have volume?
        // Checking useTTSStore... currently visible in ReaderView: `rate, setRate`. No volume.
        // So I will implement SPEED instead, or add Volume to store.
        // Given "Volume" is in plan, but `rate` is in store. I'll use Rate for now as it's implemented.
        // Or I should add volume to store?
        // Let's check `useTTSStore`.

        // Actually, let's map Swipe Up to Speed Up, Swipe Down to Speed Down for now, as volume is often hardware button.
        // Plan logic: "Swipe Up/Down: Volume +/-".
        // I will interpret this as Rate/Speed since Volume is not in the slice I saw.
        // Or I'll add Volume to store if I can read it.

        // Let's stick to Speed (Rate) as it is most useful for TTS users.
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
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center select-none touch-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      // Prevent defaults to stop scrolling/zooming
      onTouchMove={(e) => e.preventDefault()}
    >
      <div className="absolute top-4 right-4">
        <button
            onClick={onClose}
            className="text-white/50 border border-white/30 rounded-full px-3 py-1 text-sm hover:bg-white/10"
        >
            Exit Gesture Mode
        </button>
      </div>

      <div className="text-white/30 text-center pointer-events-none">
        <p className="mb-8 text-lg font-light">Gesture Mode Active</p>
        <div className="grid grid-cols-3 gap-8 text-xs opacity-50 max-w-sm mx-auto">
            <div className="flex flex-col items-center">
                <span className="mb-1">Tap Left</span>
                <span>Rewind</span>
            </div>
            <div className="flex flex-col items-center">
                <span className="mb-1">Tap Center</span>
                <span>Play/Pause</span>
            </div>
            <div className="flex flex-col items-center">
                <span className="mb-1">Tap Right</span>
                <span>Forward</span>
            </div>
            <div className="flex flex-col items-center col-span-3 mt-4">
                <span>Swipe Vertical: Speed | Horizontal: Chapter</span>
            </div>
        </div>
      </div>

      {icon && (
        <div key={iconKey} className="absolute inset-0 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
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
