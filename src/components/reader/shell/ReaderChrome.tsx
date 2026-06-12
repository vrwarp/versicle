/**
 * ReaderChrome — the reader header + immersive-mode exit button (Phase 6
 * §5 table, prep/phase6-reader-engine.md PR-9). Extracted verbatim from
 * the legacy ReaderView, including the WebKit flushSync navigation
 * workaround (load-bearing — see the inline comment).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Settings, ArrowLeft, X, Search, Highlighter, Maximize, Minimize, Type, Headphones, Monitor } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useUIStore } from '@store/useUIStore';
import { useSidebarState } from '@hooks/useSidebarState';
import { cn } from '@lib/utils';
import { Button } from '../../ui/Button';
import { Popover, PopoverTrigger } from '../../ui/Popover';
import { Sheet, SheetTrigger } from '../../ui/Sheet';
import { UnifiedAudioPanel } from '../UnifiedAudioPanel';
import { VisualSettings } from '../VisualSettings';

export interface ReaderChromeProps {
  /** Header title: section title → book title → 'Reading'. */
  title: string;
  onOpenSyncPanel: () => void;
}

export const ReaderChrome: React.FC<ReaderChromeProps> = ({ title, onOpenSyncPanel }) => {
  const navigate = useNavigate();
  const { activeSidebar, setSidebar } = useSidebarState();
  const { immersiveMode, setImmersiveMode } = useReaderUIStore(useShallow(state => ({
    immersiveMode: state.immersiveMode,
    setImmersiveMode: state.setImmersiveMode,
  })));
  const isPlaying = useTTSPlaybackStore(state => state.isPlaying);
  const { setGlobalSettingsOpen } = useUIStore();

  const showToc = activeSidebar === 'toc';
  const showAnnotations = activeSidebar === 'annotations';

  // Immersive Mode Exit Button
  if (immersiveMode) {
    return (
      <Button
        variant="ghost"
        size="icon"
        data-testid="reader-immersive-exit-button"
        aria-label="Exit Immersive Mode"
        onClick={() => setImmersiveMode(false)}
        className="absolute top-4 right-4 z-50 rounded-full bg-surface/50 hover:bg-surface shadow-md backdrop-blur-sm transition-colors"
      >
        <Minimize className="w-5 h-5 text-foreground" />
      </Button>
    );
  }

  return (
    <header data-testid="reader-header" className="flex items-center justify-between px-2 md:px-8 py-2 bg-surface shadow-sm z-10">
      <div className="flex items-center gap-1 md:gap-2">
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-back-button"
          aria-label={activeSidebar !== 'none' ? "Close Side Bar" : "Back to Library"}
          onClick={() => {
            if (activeSidebar !== 'none') {
              setSidebar('none');
            } else {
              // flushSync: React Router 7 wraps navigations in startTransition by
              // default; on WebKit that transition can be starved when nothing else
              // re-renders (e.g. TTS idle), so the URL updates but the route never
              // re-renders and the reader→library transition wedges. Force a
              // synchronous navigation so it always completes.
              navigate('/', { flushSync: true });
            }
          }}
          className="rounded-full text-muted-foreground"
        >
          {activeSidebar !== 'none' ? <X className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-toc-button"
          aria-label="Table of Contents"
          onClick={() => {
            if (activeSidebar === 'toc') setSidebar('none');
            else setSidebar('toc');
          }}
          className={cn("rounded-full text-muted-foreground", showToc && "bg-accent text-accent-foreground")}
        >
          <List className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-annotations-button"
          aria-label="Annotations"
          onClick={() => {
            if (activeSidebar === 'annotations') setSidebar('none');
            else setSidebar('annotations');
          }}
          className={cn("rounded-full text-muted-foreground", showAnnotations && "bg-accent text-accent-foreground")}
        >
          <Highlighter className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-search-button"
          aria-label="Search"
          onClick={() => {
            if (activeSidebar === 'search') {
              setSidebar('none');
            } else {
              setSidebar('search');
            }
          }}
          className="rounded-full text-muted-foreground"
        >
          <Search className="w-5 h-5" />
        </Button>
      </div>
      <h1 className="text-sm font-medium truncate max-w-xs text-foreground hidden md:block">
        {title}
      </h1>
      <div className="flex items-center gap-1 md:gap-2">
        <Sheet open={activeSidebar === 'audio-panel'} onOpenChange={(open) => setSidebar(open ? 'audio-panel' : 'none')}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="reader-audio-button"
              aria-label="Open Audio Deck"
              className={cn("rounded-full", isPlaying ? "text-primary" : "text-muted-foreground")}
            >
              <Headphones className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <UnifiedAudioPanel />
        </Sheet>
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-immersive-enter-button"
          aria-label="Enter Immersive Mode"
          onClick={() => setImmersiveMode(true)}
          className="rounded-full text-muted-foreground"
        >
          <Maximize className="w-5 h-5" />
        </Button>
        <Popover open={activeSidebar === 'visual-settings'} onOpenChange={(open) => setSidebar(open ? 'visual-settings' : 'none')}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="reader-visual-settings-button"
              aria-label="Visual Settings"
              className="rounded-full text-muted-foreground"
            >
              <Type className="w-5 h-5" />
            </Button>
          </PopoverTrigger>
          <VisualSettings />
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-sync-status-button"
          aria-label="Sync Status"
          onClick={onOpenSyncPanel}
          className="rounded-full text-muted-foreground"
        >
          <Monitor className="w-5 h-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="reader-settings-button"
          aria-label="Settings"
          onClick={() => setGlobalSettingsOpen(true)}
          className="rounded-full text-muted-foreground"
        >
          <Settings className="w-5 h-5" />
        </Button>
      </div>
    </header>
  );
};
