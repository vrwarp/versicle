/**
 * AnnotationPill — the selection/annotation toolbar + note editor,
 * extracted from the dissolved ui/CompassPill (Phase 8 §C). Owns the
 * note-editing state machine (including the note-recall sync-on-render —
 * see the absorbed regression block in pills/AnnotationPill.test.tsx) and
 * the smart Chinese-selection vocab entry point.
 */
import React, { useState, useEffect, useRef } from 'react';
import { StickyNote, Mic, Copy, X, Check, Play, Trash2, GraduationCap } from 'lucide-react';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { HAN_RE } from '@domains/chinese';
import { PillShell } from '../../ui/PillShell';
import { Button } from '../../ui/Button';
import { cn } from '@lib/utils';

export type ActionType =
  | 'vocab'      // Payload: null
  | 'color'      // Payload: 'yellow' | 'green' | 'blue' | 'red'
  | 'note'       // Payload: string (the note text)
  | 'copy'       // Payload: null
  | 'pronounce'  // Payload: null
  | 'play'       // Payload: null
  | 'delete'     // Payload: null
  | 'dismiss';   // Payload: null

export interface AnnotationPillProps {
  onAction?: (action: ActionType, payload?: string) => void;
  availableActions?: {
    play?: boolean;
    pronounce?: boolean;
    delete?: boolean;
  };
}

export const AnnotationPill: React.FC<AnnotationPillProps> = ({ onAction, availableActions }) => {
  // Compass interaction state is ephemeral UI state (never synced via Yjs) —
  // it lives in useReaderUIStore behind the compassMachine transition table.
  // The router only mounts this pill in annotation mode; the payload guards
  // below cover morph frames where the mode has already moved on.
  const compass = useReaderUIStore(state => state.compass);
  const selectionText = compass.mode === 'annotation' ? compass.selection.text : '';
  const targetAnnotation = compass.mode === 'annotation' ? compass.annotation : undefined;

  // Full-script Han test (CH-1 family: astral Han selections count too).
  // The dictionary itself loads only when the triage card opens (PR-11) —
  // the legacy any-CJK-selection fetch trigger is gone.
  const isChineseSelection = HAN_RE.test(selectionText);

  // Internal state for note editing - initialize based on target annotation if present
  const [isEditingNote, setIsEditingNote] = useState(!!targetAnnotation?.note);
  const [noteText, setNoteText] = useState(targetAnnotation?.note || '');
  const [isCopied, setIsCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep track of the previous annotation to sync state during render
  // instead of using an effect, which prevents cascading renders.
  const [prevAnnotationId, setPrevAnnotationId] = useState(targetAnnotation?.id);

  if (targetAnnotation?.id !== prevAnnotationId) {
    setPrevAnnotationId(targetAnnotation?.id);
    if (targetAnnotation?.note) {
      setIsEditingNote(true);
      setNoteText(targetAnnotation.note);
    } else {
      setIsEditingNote(false);
      setNoteText('');
    }
  }

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditingNote && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditingNote]);

  // Clean up copy timeout
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isCopied) {
      timeoutId = setTimeout(() => setIsCopied(false), 2000);
    }
    return () => clearTimeout(timeoutId);
  }, [isCopied]);

  const handleSaveNote = () => {
    onAction?.('note', noteText);
    setIsEditingNote(false);
    setNoteText('');
  };

  const handleCancelNote = () => {
    setIsEditingNote(false);
    setNoteText('');
  };

  if (isEditingNote) {
    return (
      <PillShell
        shape="card"
        emphasis="strong"
        data-testid="compass-pill-annotation-edit"
        className="z-50 flex flex-col justify-between w-full max-w-md duration-300 shadow-2xl p-3 min-h-[140px]"
      >
        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note..."
          className="w-full h-24 p-2 bg-transparent resize-none focus-visible:outline-none text-sm"
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={handleCancelNote}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={handleSaveNote}>
            Save
          </Button>
        </div>
      </PillShell>
    );
  }

  return (
    <PillShell
      emphasis="strong"
      data-testid="compass-pill-annotation"
      className="z-50 flex items-center justify-between w-full max-w-md h-14 px-4 duration-300 shadow-2xl"
    >
      {/* Left: Color Swatches */}
      <div className="flex items-center gap-2">
        {(['yellow', 'green', 'blue', 'red'] as const).map((color) => (
          <button
            key={color}
            data-testid={`popover-color-${color}`}
            className={cn(
              "w-6 h-6 rounded-full border border-border hover:scale-125 transition-transform",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            )}
            style={{ backgroundColor: color === 'yellow' ? '#fde047' : color === 'green' ? '#86efac' : color === 'blue' ? '#93c5fd' : '#fca5a5' }}
            onClick={() => onAction?.('color', color)}
            aria-label={`Highlight ${color}`}
          />
        ))}
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-9 h-9"
          onClick={() => {
            if (targetAnnotation?.note) {
              setNoteText(targetAnnotation.note);
            }
            setIsEditingNote(true);
          }}
          data-testid="popover-add-note-button"
          aria-label="Add Note"
        >
          <StickyNote size={18} />
        </Button>

        {/* Smart Pinyin Filtering Action */}
        {isChineseSelection && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9 text-primary hover:bg-primary/10"
            onClick={() => {
              useReaderUIStore.getState().dispatchCompass({ type: 'VOCAB_TRIAGE_REQUESTED' });
            }}
            data-testid="popover-vocab-button"
            aria-label="Manage Pinyin Vocabulary"
            title="Mark as Known"
          >
            <GraduationCap size={18} />
          </Button>
        )}

        {availableActions?.pronounce && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9"
            onClick={() => onAction?.('pronounce')}
            data-testid="popover-fix-pronunciation-button"
            aria-label="Pronounce"
          >
            <Mic size={18} />
          </Button>
        )}

        {availableActions?.play && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9"
            onClick={() => onAction?.('play')}
            data-testid="popover-play-button"
            aria-label="Play from here"
          >
            <Play size={18} />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-9 h-9"
          onClick={() => {
            setIsCopied(true);
            onAction?.('copy');
          }}
          data-testid="popover-copy-button"
          aria-label={isCopied ? "Copied" : "Copy text"}
        >
          {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
        </Button>

        {availableActions?.delete && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full w-9 h-9 text-muted-foreground hover:text-destructive"
            onClick={() => onAction?.('delete')}
            data-testid="popover-delete-button"
            aria-label="Delete"
          >
            <Trash2 size={18} />
          </Button>
        )}

        <div className="w-px h-6 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          className="rounded-full w-9 h-9 text-muted-foreground hover:text-destructive"
          onClick={() => onAction?.('dismiss')}
          data-testid="popover-close-button"
          aria-label="Dismiss"
        >
          <X size={18} />
        </Button>
      </div>
    </PillShell>
  );
};
