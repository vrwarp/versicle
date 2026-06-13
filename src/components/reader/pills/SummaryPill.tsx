/**
 * SummaryPill — the "continue reading" card shown on the library when no
 * book is open, extracted from the dissolved ui/CompassPill (Phase 8 §C).
 * Pure presentation: the router (ReaderControlBar) supplies the last-read
 * book and the navigation onClick.
 */
import React from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '@lib/utils';

export interface SummaryPillProps {
  title?: string;
  subtitle?: string;
  /** 0–100. */
  progress?: number;
  onClick?: () => void;
}

export const SummaryPill: React.FC<SummaryPillProps> = ({
  title,
  subtitle,
  progress = 0,
  onClick,
}) => {
  const displayTitle = title || "Current Book";
  const displaySubtitle = subtitle || '';

  return (
    <div
      data-testid="compass-pill-summary"
      className={cn(
        "relative flex flex-col items-center justify-center w-full max-w-sm px-4 py-2 mx-auto overflow-hidden text-center transition-all border shadow-lg h-24 rounded-xl bg-background/75 backdrop-blur-md border-border",
        onClick && "cursor-pointer hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Continue reading ${displayTitle}, ${displaySubtitle}, ${Math.round(progress)}% complete`}
    >
      <div className="text-xs font-bold truncate w-full opacity-90">
        {displayTitle}
      </div>
      <div className="text-xs font-medium truncate w-full opacity-80 my-1 flex items-center justify-center gap-1.5">
        <BookOpen size={12} className="opacity-70" aria-hidden="true" />
        {displaySubtitle}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {Math.round(progress)}% complete
      </div>
      {/* Progress Bar Background */}
      <div
        className="absolute bottom-0 left-0 h-1 bg-primary/20 transition-all duration-300"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};
