/**
 * SyncAlertPill — the "pick up where you left off" remote-progress alert,
 * extracted from the dissolved ui/CompassPill into its sync feature home
 * (Phase 8 §C). Pure presentation: the variant router (ReaderControlBar)
 * supplies the remote-progress copy, the jump onClick and the dismiss.
 */
import React from 'react';
import { Smartphone, ArrowUpCircle, X } from 'lucide-react';
import { PillShell } from '../ui/PillShell';
import { Button } from '../ui/Button';

export interface SyncAlertPillProps {
  title?: string;
  subtitle?: string;
  onClick?: () => void;
  onDismiss?: () => void;
}

export const SyncAlertPill: React.FC<SyncAlertPillProps> = ({
  title,
  subtitle,
  onClick,
  onDismiss,
}) => (
  <PillShell
    emphasis="strong"
    data-testid="compass-pill-sync-alert"
    className="z-50 flex items-center justify-between w-full max-w-sm h-14 px-4 border-primary/20 animate-in fade-in slide-in-from-bottom-2"
    role="alert"
  >
    <div
      className="flex items-center gap-3 flex-1 min-w-0"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={title && subtitle ? `${title}. ${subtitle}` : "Reading Progress Updated"}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          if (onClick) onClick();
        }
      }}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-pulse">
        <Smartphone size={16} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-foreground truncate">
          {title || "Reading Progress Updated"}
        </span>
        <span className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
          <ArrowUpCircle size={10} />
          {subtitle || "Tap to sync location"}
        </span>
      </div>
    </div>

    <Button
      variant="ghost"
      size="icon"
      className="rounded-full w-8 h-8 -mr-1 text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onDismiss?.();
      }}
      aria-label="Dismiss update"
    >
      <X size={16} />
    </Button>
  </PillShell>
);
