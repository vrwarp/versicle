import React from 'react';
import { cn } from '@lib/utils';

/**
 * PillShell — the dumb layout primitive left in ui/ after the CompassPill
 * dissolution (Phase 8 §C). It owns the shared pill chrome only: centered
 * geometry, backdrop blur, border + shadow, and the optional progress
 * underlay. NO store imports, no variant knowledge — feature pills
 * (reader/pills/*, sync/SyncAlertPill, chinese/VocabTriageCard) compose it
 * and own their own state. Focus management across variant morphs lives in
 * the variant ROUTER (ReaderControlBar), which is the only place that
 * knows a morph happened.
 */
export interface PillShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Bar (rounded-full) or card (rounded-2xl) geometry. */
  shape?: 'bar' | 'card';
  /** Background opacity emphasis (alert-style pills read 'strong'). */
  emphasis?: 'default' | 'strong';
  /** 0–100: renders the left-anchored progress underlay (audio pill). */
  progress?: number;
  progressTestId?: string;
  'data-testid'?: string;
}

export const PillShell = React.forwardRef<HTMLDivElement, PillShellProps>(
  (
    { shape = 'bar', emphasis = 'default', progress, progressTestId, className, children, ...rest },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'relative mx-auto overflow-hidden transition-all border shadow-lg backdrop-blur-md border-border',
        shape === 'bar' ? 'rounded-full' : 'rounded-2xl',
        emphasis === 'strong' ? 'bg-background/90' : 'bg-background/75',
        className,
      )}
      {...rest}
    >
      {progress !== undefined && (
        <div
          data-testid={progressTestId}
          className="absolute inset-y-0 left-0 bg-primary/10 -z-10 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      )}
      {children}
    </div>
  ),
);
PillShell.displayName = 'PillShell';
