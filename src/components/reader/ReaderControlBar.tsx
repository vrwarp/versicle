/**
 * ReaderControlBar — the THIN variant router over the dissolved CompassPill
 * (Phase 8 §C): the priority switch below is the single dispatcher; each
 * variant is its own feature component (reader/pills/*, sync/SyncAlertPill,
 * chinese/VocabTriageCard). The `key={variant}` remount is GONE (a11y item
 * 8): variants morph by re-render, and the router restores focus into the
 * new pill when a morph would otherwise drop it on <body>.
 */
import React, { useEffect, useRef } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useCurrentDeviceProgress, useBookProgress } from '@store/useReadingStateStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useBook, useLastReadBook } from '@store/libraryViewStore';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { AudioPill } from './pills/AudioPill';
import { SummaryPill } from './pills/SummaryPill';
import { AnnotationPill, type ActionType } from './pills/AnnotationPill';
import { AudioTriagePill } from './pills/AudioTriagePill';
import { SyncAlertPill } from '../sync/SyncAlertPill';
import { VocabTriageCard } from '../chinese/VocabTriageCard';
import { useToastStore } from '@store/useToastStore';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { LexiconManager } from './LexiconManager';

import { useRemoteProgress } from '@hooks/useRemoteProgress';
import { findTocItem, resolveSyntheticPreference } from '@lib/reader/titleResolver';
import { readerCommandsRegistry } from '@domains/reader/ui/ReaderCommands';

type PillVariant =
  | 'annotation' | 'active' | 'summary' | 'compact'
  | 'sync-alert' | 'audio-triage' | 'vocab-triage';

export const ReaderControlBar: React.FC = () => {
    // Correctly using the store-based toast
    const showToast = useToastStore(state => state.showToast);
    const navigate = useNavigate();

    const [lexiconOpen, setLexiconOpen] = React.useState(false);
    const [lexiconText, setLexiconText] = React.useState('');
    const [dismissedSyncAlerts, setDismissedSyncAlerts] = React.useState<Set<string>>(new Set());

    // Store Subscriptions
    const { add, update, remove } = useAnnotationStore(useShallow(state => ({
        add: state.add,
        update: state.update,
        remove: state.remove,
    })));

    // Optimization: We only need to know if the queue has items to determine variant,
    // and if queue is empty to set title/subtitle manually.
    const hasQueueItems = useTTSPlaybackStore(state => state.queue.length > 0);
    const isPlaying = useTTSPlaybackStore(state => state.isPlaying);

    // Popover state is ephemeral UI state (never synced via Yjs) — it lives in useReaderUIStore.
    const { immersiveMode, toc, currentSectionTitle, currentSectionId, currentBookId, resetCompassState, popover, hidePopover } = useReaderUIStore(useShallow(state => ({
        immersiveMode: state.immersiveMode,
        toc: state.toc,
        currentSectionTitle: state.currentSectionTitle,
        currentSectionId: state.currentSectionId,
        currentBookId: state.currentBookId,
        resetCompassState: state.resetCompassState,
        popover: state.popover,
        hidePopover: state.hidePopover
    })));

    // Check for remote progress
    const remoteProgress = useRemoteProgress(currentBookId);

    // Determining if we should show the sync alert
    // 1. Must have remote progress
    // 2. Must not have been dismissed for this specific device/timestamp combo (simplified to deviceId for now)
    const showSyncAlert = remoteProgress && !dismissedSyncAlerts.has(remoteProgress.deviceId);

    // Select the most recently read book
    const lastReadBook = useLastReadBook();
    const lastReadBookProgress = useCurrentDeviceProgress(lastReadBook?.bookId || null);

    // Select the current book if active
    const currentBook = useBook(currentBookId);
    // useBookProgress applies the same fallback logic as getProgress() (most-recent
    // across devices, with isValidProgress guard), so the scrubber always reflects
    // the best available progress rather than just the current-device entry.
    const currentBookProgress = useBookProgress(currentBookId);

    // Determine State Priority
    // 0. Sync Alert (High Priority)
    const isSyncAlert = showSyncAlert;

    // 1. Annotation Mode
    const isAnnotationMode = popover.visible;

    // 2. Audio Mode OR Active Reader
    const isReaderActive = !!currentBookId;

    const compassState = useReaderUIStore(state => state.compassState || {});

    // THE single dispatcher (§C): priority switch, unchanged semantics.
    let variant: PillVariant | null = null;

    if (compassState.variant) {
        variant = compassState.variant;
    } else if (isSyncAlert) {
        variant = 'sync-alert';
    } else if (isAnnotationMode) {
        variant = 'annotation';
    } else if (isReaderActive) {
        variant = immersiveMode ? 'compact' : 'active';
    } else if (isPlaying) {
        variant = 'active';
    } else if (lastReadBook) { // Check lastReadBook existence directly
        // If not playing and not in reader, prefer Summary over a paused queue
        variant = 'summary';
    } else if (hasQueueItems) {
        // Fallback: If no last read book (unlikely in Library if we have a queue), but queue exists
        variant = 'active';
    } else {
        variant = null;
    }

    // Focus management on variant morph (a11y item 8): if keyboard focus
    // lived inside the pill and the morph unmounted that control, move
    // focus to the new pill's first control instead of dropping it on
    // <body>. The flag is event-driven (focus/blur on the region); a blur
    // with a NULL relatedTarget means focus was destroyed (the unmount
    // case), so it does not clear the flag.
    const pillRegionRef = useRef<HTMLDivElement>(null);
    const prevVariantRef = useRef<PillVariant | null>(variant);
    const pillHadFocusRef = useRef(false);
    useEffect(() => {
        if (variant === prevVariantRef.current) return;
        prevVariantRef.current = variant;
        const region = pillRegionRef.current;
        if (pillHadFocusRef.current && region && !region.contains(document.activeElement)) {
            region
                .querySelector<HTMLElement>('button, [role="button"], [tabindex="0"], textarea')
                ?.focus();
        }
    }, [variant]);

    // Handle Annotation Actions
    const handleAnnotationAction = (action: ActionType, payload?: string) => {
        switch (action) {
            case 'color':
                if (payload && currentBookId) {
                    if (popover.id) {
                        update(popover.id, { color: payload });
                    } else {
                        add({
                            type: 'highlight',
                            color: payload,
                            bookId: currentBookId,
                            text: popover.text || '',
                            cfiRange: popover.cfiRange || ''
                        });
                    }
                    hidePopover();
                    resetCompassState();
                }
                break;
            case 'note':
                if (payload && currentBookId) {
                    if (popover.id) {
                        update(popover.id, { note: payload, type: 'note' });
                    } else {
                        add({
                            type: 'note',
                            note: payload,
                            bookId: currentBookId,
                            text: popover.text || '',
                            cfiRange: popover.cfiRange || '',
                            color: 'yellow' // Default color for notes if not specified
                        });
                    }
                    showToast("Note saved", "success");
                    hidePopover();
                    resetCompassState();
                }
                break;
            case 'copy':
                if (popover.text) {
                    navigator.clipboard.writeText(popover.text).then(() => {
                        showToast("Copied to clipboard", "success");
                        setTimeout(() => hidePopover(), 1000);
                    }).catch(() => {
                        showToast("Failed to copy", "error");
                    });
                }
                break;
            case 'play':
                // Play from selection (reader command registry — the
                // callbacks-in-store path died with Phase 6 §5a)
                if (popover.cfiRange) {
                    const commands = readerCommandsRegistry.get();
                    if (commands) {
                        commands.playFromSelection(popover.cfiRange);
                    } else {
                        showToast("Audio not ready yet", "error");
                    }
                    hidePopover();
                }
                break;
            case 'pronounce':
                if (popover.text) {
                    setLexiconText(popover.text);
                    setLexiconOpen(true);
                    hidePopover();
                }
                break;
            case 'delete':
                if (popover.id) {
                    remove(popover.id);
                    showToast("Annotation deleted", "success");
                    hidePopover();
                }
                break;
            case 'dismiss':
                if (variant === 'sync-alert' && remoteProgress) {
                    setDismissedSyncAlerts(prev => new Set(prev).add(remoteProgress.deviceId));
                } else {
                    hidePopover();
                    resetCompassState();
                }
                break;
        }
    };

    if (!variant) return null;

    // Determine props based on variant
    let title: string | undefined;
    let subtitle: string | undefined;
    let progress: number | undefined;

    if (variant === 'sync-alert' && remoteProgress) {
        title = `Pick up from ${remoteProgress.deviceName}?`;
        const percent = Math.round(remoteProgress.percentage * 100);
        subtitle = `Jump to ${percent}%`;
    } else if (variant === 'summary' && lastReadBook) {
        title = lastReadBook.title;
        subtitle = "Continue Reading";
        // Get progress from reading state (local device)
        progress = (lastReadBookProgress?.percentage || 0) * 100;
    } else if ((variant === 'active' || variant === 'compact') && isReaderActive && currentBook) {
        title = currentBook.title;
        const useSynthetic = resolveSyntheticPreference(currentBook);
        const currentToc = (useSynthetic && currentBook.syntheticToc) ? currentBook.syntheticToc : toc;

        const resolvedItem = currentSectionId ? findTocItem(currentToc, currentSectionId) : null;
        subtitle = resolvedItem?.label || currentSectionTitle || undefined;
        // Only override progress when TTS is not active; when TTS has queue items,
        // the AudioPill uses its own TTS-based chapter progress from useSectionDuration.
        if (!hasQueueItems) {
            progress = (currentBookProgress?.percentage || 0) * 100;
        }
    }

    const pill = (() => {
        switch (variant) {
            case 'audio-triage':
                return <AudioTriagePill />;
            case 'vocab-triage':
                // Phase 6 PR-11 home: the chinese feature card (the IDB
                // dictionary import is gated on THIS card opening).
                return <VocabTriageCard text={popover.text || ''} />;
            case 'sync-alert':
                return (
                    <SyncAlertPill
                        title={title}
                        subtitle={subtitle}
                        onClick={() => {
                            const commands = readerCommandsRegistry.get();
                            if (remoteProgress && commands) {
                                commands.jumpTo(remoteProgress.cfi);
                                setDismissedSyncAlerts(prev => new Set(prev).add(remoteProgress.deviceId));
                            }
                        }}
                        onDismiss={() => handleAnnotationAction('dismiss')}
                    />
                );
            case 'annotation':
                return (
                    <AnnotationPill
                        onAction={handleAnnotationAction}
                        availableActions={{
                            play: true,
                            pronounce: true,
                            delete: !!popover.id
                        }}
                    />
                );
            case 'summary':
                return (
                    <SummaryPill
                        title={title}
                        subtitle={subtitle}
                        progress={progress}
                        onClick={() => {
                            if (lastReadBook) navigate(`/read/${lastReadBook.id}`);
                        }}
                    />
                );
            case 'active':
            case 'compact':
                // ONE component for both layouts: the immersive-mode morph
                // re-renders instead of remounting.
                return (
                    <AudioPill
                        compact={variant === 'compact'}
                        title={title}
                        subtitle={subtitle}
                        progress={progress}
                    />
                );
        }
    })();

    return (
        <>
            <div className="fixed bottom-8 left-0 right-0 z-40 px-4 pointer-events-none flex justify-center">
                <div
                    className="pointer-events-auto w-full max-w-md"
                    ref={pillRegionRef}
                    onFocus={() => { pillHadFocusRef.current = true; }}
                    onBlur={(e) => {
                        // relatedTarget null = focus destroyed (unmount) —
                        // keep the flag so the morph effect can restore it.
                        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
                            pillHadFocusRef.current = false;
                        }
                    }}
                >
                    {pill}
                </div>
            </div>

            <LexiconManager
                key={lexiconOpen ? 'open' : 'closed'}
                open={lexiconOpen}
                onOpenChange={setLexiconOpen}
                initialTerm={lexiconText}
            />
        </>
    );
};
