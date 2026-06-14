/**
 * AudioTriagePill — the "Review Bookmark" pill for dragnet audio bookmarks,
 * extracted from the dissolved ui/CompassPill (Phase 8 §C). Confirms or
 * discards the pending dragnet annotation; selection refinement goes
 * through the ReaderCommands registry (D11 — reachable from this
 * out-of-tree mount since P6).
 */
import React from 'react';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { readerCommandsRegistry } from '@domains/reader/ui/ReaderCommands';
import { PillShell } from '../../ui/PillShell';
import { Button } from '../../ui/Button';

export const AudioTriagePill: React.FC = () => {
  const compassState = useReaderUIStore(state => state.compassState || {});
  const resetCompassState = useReaderUIStore(state => state.resetCompassState);
  const { addAnnotation, removeAnnotation } = useAnnotationStore(useShallow(state => ({
    addAnnotation: state.add,
    removeAnnotation: state.remove
  })));

  if (!compassState.targetAnnotation) return null;

  const onConfirmTriage = async () => {
    const target = compassState.targetAnnotation!;
    let newCfiRange = target.cfiRange;
    let newText = target.text;

    // If the user adjusted the selection, use the new bounds.
    // Otherwise, fall back to the original annotation data.
    const refined = readerCommandsRegistry.get()?.refineSelection();
    if (refined) {
      newCfiRange = refined.cfiRange;
      newText = refined.text;
    }

    // Mutate CRDT Store: Delete dirty dragnet, insert precise highlight
    removeAnnotation(target.id);
    addAnnotation({
      ...target,
      cfiRange: newCfiRange,
      text: newText,
      type: 'highlight' // Elevate status
    });

    resetCompassState();
  };

  const onDiscardTriage = () => {
    removeAnnotation(compassState.targetAnnotation!.id);
    resetCompassState();
  };

  return (
    <PillShell
      emphasis="strong"
      data-testid="compass-pill-triage"
      className="z-50 flex items-center justify-between w-full max-w-sm h-14 px-4 border-orange-500/50 animate-in fade-in slide-in-from-bottom-2"
    >
      <span className="text-sm font-bold text-orange-500">Review Bookmark</span>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onDiscardTriage}>Discard</Button>
          <Button variant="default" size="sm" onClick={onConfirmTriage}>Confirm</Button>
        </div>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-8 h-8 text-muted-foreground mr-[-4px]"
          onClick={() => resetCompassState()}
          aria-label="Dismiss review"
        >
          <X size={16} />
        </Button>
      </div>
    </PillShell>
  );
};
