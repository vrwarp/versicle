/**
 * VocabTriageCard — the vocab-triage CompassPill variant + character tiles
 * (Phase 6 §7.4, prep doc PR-11; extracted from CompassPill.tsx).
 *
 * Dictionary data now comes from the async DictionaryService (IDB-backed):
 * the import is triggered HERE, on triage open — the legacy module-global
 * fetch fired on ANY selection containing a CJK character and retained the
 * whole ~80 MB map for the session. Entries and compound hits load in one
 * batched pass per selection; tiles render immediately (pinyin fills in
 * when the lookup lands, matching the legacy not-yet-fetched render).
 *
 * Lives under src/components (not domains/chinese/ui): it reads/writes the
 * vocabulary + readerUI stores, which domains-no-store forbids inside
 * domains/ — same reconciliation as the reader shell (prep doc §Status 3).
 */
import React, { useState, useEffect, useRef } from 'react';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useVocabularyStore } from '@store/useVocabularyStore';
import {
  getDictionaryService,
  type DictionaryStatus,
} from '@domains/chinese/dictionary/DictionaryService';
import type { CompoundHit } from '@domains/chinese/dictionary/compoundLookup';
import { canonicalizeChar } from '@domains/chinese/vocabulary/canonicalize';
import { HAN_RE } from '@domains/chinese';
import { GraduationCap, X, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '@lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { createLogger } from '@lib/logger';

const logger = createLogger('VocabTriageCard');

interface TileData {
  pinyin: string;
  definition: string;
  compound: CompoundHit | null;
}

/** Interactive individual character tile (markup preserved verbatim). */
const VocabTile: React.FC<{
  char: string;
  pinyin: string;
  definition: string;
  compound: CompoundHit | null;
  isKnown: boolean;
  onToggle: () => void;
}> = ({ char, pinyin, definition, compound, isKnown, onToggle }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTooltip) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (tileRef.current && !tileRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTooltip]);

  return (
    <Popover open={showTooltip && (!!pinyin || !!definition)} onOpenChange={setShowTooltip}>
      <PopoverTrigger asChild>
        <div
          ref={tileRef}
          className="relative flex flex-col items-center"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {/* Main Tile */}
          <button
            onClick={onToggle}
            className={cn(
              "relative flex flex-col items-center justify-center w-12 h-14 rounded-xl border transition-all duration-200 select-none",
              isKnown
                ? "bg-primary/10 border-primary text-primary font-medium shadow-sm hover:bg-primary/15"
                : "bg-card border-border text-foreground hover:bg-accent hover:border-accent-foreground/30"
            )}
            style={{ touchAction: 'manipulation' }}
            aria-pressed={isKnown}
          >
            <span className="text-[10px] text-muted-foreground/80 leading-none h-3 select-none font-pinyin">
              {pinyin.split(' / ')[0]}
            </span>
            <span className="text-lg font-semibold leading-none mt-1 select-none">
              {char}
            </span>

            {/* Small [i] icon for touch trigger */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowTooltip(!showTooltip);
              }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground shadow-sm transition-colors"
              title="Show meaning"
              aria-label="Show character details"
              aria-expanded={showTooltip}
            >
              i
            </button>

            {isKnown && (
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                <Check size={8} strokeWidth={3} />
              </div>
            )}
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-48 bg-popover text-popover-foreground border border-border text-xs rounded-lg p-2.5 shadow-xl pointer-events-auto leading-relaxed z-[100]"
        style={{ textShadow: 'none' }}
      >
        <div className="font-semibold border-b border-border/40 pb-1 mb-1.5 flex items-center justify-between">
          <span className="text-sm">{char}</span>
          <span className="text-muted-foreground font-normal">[{pinyin}]</span>
        </div>
        <p className="text-muted-foreground break-words mb-1.5">{definition || 'No standalone definition'}</p>
        {compound && (
          <div className="border-t border-border/40 pt-1.5 mt-1.5 text-[10px]">
            <span className="font-semibold text-primary">In selection: </span>
            <span className="font-semibold">{compound.word}</span> <span className="text-muted-foreground">[{compound.pinyin}]</span>
            <p className="text-muted-foreground mt-0.5 break-words">{compound.definition}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export const VocabTriageCard: React.FC<{ text: string }> = ({ text }) => {
  const { knownCharacters, toggleKnownCharacter } = useVocabularyStore();
  const [tiles, setTiles] = useState<Map<number, TileData>>(new Map());
  const [dictStatus, setDictStatus] = useState<DictionaryStatus>('empty');

  // Dictionary load is gated on TRIAGE OPEN (this mount): import on first
  // use, then one batched entry lookup + per-character compound resolution.
  useEffect(() => {
    let cancelled = false;
    const service = getDictionaryService();
    const unsubscribe = service.subscribe((progress) => {
      if (!cancelled) setDictStatus(progress.status);
    });

    (async () => {
      try {
        await service.ensureReady();
        const chars = Array.from(text);
        const hanChars = [...new Set(chars.filter((ch) => HAN_RE.test(ch)))];
        const entries = await service.getEntries(hanChars);
        const next = new Map<number, TileData>();
        for (let index = 0; index < chars.length; index++) {
          if (!HAN_RE.test(chars[index])) continue;
          const entry = entries.get(chars[index]);
          const compound = await service.getCompound(text, index);
          next.set(index, {
            pinyin: entry ? entry[0] : '',
            definition: entry ? entry[1] : '',
            compound,
          });
        }
        if (!cancelled) setTiles(next);
      } catch (error) {
        // Status surface already flipped to 'error' (CH-13: never silent).
        logger.warn('Dictionary unavailable for triage', error);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [text]);

  const close = () => {
    useReaderUIStore.getState().resetCompassState();
    useReaderUIStore.getState().hidePopover();
  };

  return (
    <div
      data-testid="compass-pill-vocab-triage"
      className="relative z-50 flex flex-col justify-between w-full max-w-md mx-auto transition-all duration-300 bg-background/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-4 min-h-[160px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <GraduationCap size={16} className="text-primary animate-pulse" />
          <span>Manage Pinyin annotations</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6 rounded-full hover:bg-muted"
          onClick={close}
          aria-label="Close"
        >
          <X size={14} />
        </Button>
      </div>

      {/* Subtitle instructions */}
      <p className="text-xs text-muted-foreground mb-3">
        Tap characters to toggle Pinyin. Pinyin will be hidden for checked words.
      </p>
      {dictStatus === 'importing' && (
        <p className="text-[10px] text-muted-foreground mb-2" role="status">
          Preparing dictionary…
        </p>
      )}
      {dictStatus === 'error' && (
        <p className="text-[10px] text-destructive mb-2" role="status">
          Dictionary unavailable — definitions are hidden, toggling still works.
        </p>
      )}

      {/* Body: Tactile Character Tiles — lang: the tiles render Chinese
          book text + dictionary entries (i18n ADR §3: content language for
          Han-unification glyph selection + SR voice choice) */}
      <div lang="zh" className="flex flex-wrap items-center gap-2 mb-4 justify-center max-h-[300px] overflow-y-auto p-1 custom-scrollbar">
        {Array.from(text).map((char, index) => {
          if (!HAN_RE.test(char)) {
            return (
              <span
                key={`${char}-${index}`}
                className="text-muted-foreground/60 text-lg font-mono px-1 flex items-center justify-center min-w-[20px] h-14 select-none"
              >
                {char}
              </span>
            );
          }

          // isKnown compares the CANONICAL (simplified) form (CH-6 read
          // path, CRDT v7) — the tile shows known-state regardless of the
          // display script; the store action canonicalizes the write.
          const isKnown = !!knownCharacters[canonicalizeChar(char)];
          const tile = tiles.get(index);

          return (
            <VocabTile
              key={`${char}-${index}`}
              char={char}
              pinyin={tile?.pinyin || ''}
              definition={tile?.definition || ''}
              compound={tile?.compound ?? null}
              isKnown={isKnown}
              onToggle={() => toggleKnownCharacter(char)}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          className="px-4 py-1.5 h-8 text-xs rounded-full font-medium"
          onClick={close}
        >
          Done
        </Button>
      </div>
    </div>
  );
};
