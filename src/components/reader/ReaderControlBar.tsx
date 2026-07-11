/**
 * ReaderControlBar — the THIN variant router over the dissolved CompassPill
 * (Phase 8 §C): each variant is its own feature component (reader/pills/*,
 * sync/SyncAlertPill, chinese/VocabTriageCard). Which variant renders is
 * decided by `resolvePillVariant` (store/compassMachine.ts): the compass
 * interaction state wins when one is in flight, otherwise the ambient
 * conditions gathered here pick the resting pill. The `key={variant}`
 * remount is GONE (a11y item 8): variants morph by re-render, and the
 * router restores focus into the new pill when a morph would otherwise
 * drop it on <body>.
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
import { compassOwnsSelection, resolvePillVariant, type PillVariant } from '@store/compassMachine';

/**
 * True when any reader iframe currently holds a live (non-collapsed) text
 * selection. Used to keep the pill's variant-morph focus restore from
 * stealing focus out of the iframe and killing an in-progress Android
 * long-press selection. Same-origin iframes only; cross-origin access throws
 * and is swallowed.
 */
function readerIframeHasActiveSelection(): boolean {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of Array.from(iframes)) {
        try {
            const sel = iframe.contentWindow?.getSelection();
            if (sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim()) {
                return true;
            }
        } catch {
            // Cross-origin iframe — not ours; ignore.
        }
    }
    return false;
}

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

    // Compass interaction state is ephemeral UI state (never synced via Yjs) —
    // it lives in useReaderUIStore behind the compassMachine transition table.
    const { immersiveMode, toc, currentSectionTitle, currentSectionId, currentBookId, compass, dispatchCompass } = useReaderUIStore(useShallow(state => ({
        immersiveMode: state.immersiveMode,
        toc: state.toc,
        currentSectionTitle: state.currentSectionTitle,
        currentSectionId: state.currentSectionId,
        currentBookId: state.currentBookId,
        compass: state.compass,
        dispatchCompass: state.dispatchCompass
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

    const isReaderActive = !!currentBookId;

    // The selection the current interaction operates on (annotation toolbar /
    // vocab card). Null in every other mode — the machine guarantees a
    // selection-owning mode always carries its payload.
    const selection = compassOwnsSelection(compass) ? compass.selection : null;

    // THE routing decision (§C): interaction mode wins; otherwise the ambient
    // conditions pick the resting pill (see compassMachine.ts for the table).
    const variant: PillVariant | null = resolvePillVariant(compass, {
        showSyncAlert: !!showSyncAlert,
        isReaderActive,
        immersiveMode,
        isAudioPlaying: isPlaying,
        hasLastReadBook: !!lastReadBook,
        hasQueueItems,
    });

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
        // Never steal focus from a live text selection in the reader iframe.
        // The selection→annotation morph is DRIVEN by the user creating a
        // selection (Android long-press), so the iframe holds an active,
        // non-collapsed selection at this point. Focusing a pill button here
        // moves focus out of the iframe, which deactivates the native Android
        // selection — the handles vanish and the highlight renders inert grey,
        // so the user can no longer drag to adjust it. The `pillHadFocusRef`
        // flag wrongly survives that focus-into-iframe transition (a blur with
        // a null relatedTarget reads as "unmount", not "moved to iframe"), so
        // this guard is what actually protects the selection. Keyboard users —
        // the only ones the restore serves — never have a live iframe
        // selection, so skipping here costs them nothing.
        if (readerIframeHasActiveSelection()) return;
        if (pillHadFocusRef.current && region && !region.contains(document.activeElement)) {
            // Skip disabled controls — a disabled element cannot take focus, so
            // targeting one would drop focus back to <body>. The AudioPill's
            // prev/next arrows are disabled while TTS is idle (the pill is a
            // pure audio transport), so the first focusable is the center toggle.
            region
                .querySelector<HTMLElement>('button:not([disabled]), [role="button"], [tabindex="0"], textarea')
                ?.focus();
        }
    }, [variant]);

    // Handle Annotation Actions. Every completed action dispatches
    // ACTION_COMMITTED — the machine returns the pill to idle regardless of
    // how annotation mode was entered (fresh selection or highlight tap).
    const handleAnnotationAction = (action: ActionType, payload?: string) => {
        switch (action) {
            case 'color':
                if (payload && currentBookId) {
                    if (selection?.annotationId) {
                        update(selection.annotationId, { color: payload });
                    } else {
                        add({
                            type: 'highlight',
                            color: payload,
                            bookId: currentBookId,
                            text: selection?.text || '',
                            cfiRange: selection?.cfiRange || ''
                        });
                    }
                    dispatchCompass({ type: 'ACTION_COMMITTED' });
                }
                break;
            case 'note':
                if (payload && currentBookId) {
                    if (selection?.annotationId) {
                        update(selection.annotationId, { note: payload, type: 'note' });
                    } else {
                        add({
                            type: 'note',
                            note: payload,
                            bookId: currentBookId,
                            text: selection?.text || '',
                            cfiRange: selection?.cfiRange || '',
                            color: 'yellow' // Default color for notes if not specified
                        });
                    }
                    showToast("Note saved", "success");
                    dispatchCompass({ type: 'ACTION_COMMITTED' });
                }
                break;
            case 'copy':
                if (selection?.text) {
                    navigator.clipboard.writeText(selection.text).then(() => {
                        showToast("Copied to clipboard", "success");
                        // Keep the toolbar up briefly so the "copied" check is seen.
                        setTimeout(() => dispatchCompass({ type: 'ACTION_COMMITTED' }), 1000);
                    }).catch(() => {
                        showToast("Failed to copy", "error");
                    });
                }
                break;
            case 'play':
                // Play from selection (reader command registry — the
                // callbacks-in-store path died with Phase 6 §5a)
                if (selection?.cfiRange) {
                    const commands = readerCommandsRegistry.get();
                    if (commands) {
                        commands.playFromSelection(selection.cfiRange);
                    } else {
                        showToast("Audio not ready yet", "error");
                    }
                    dispatchCompass({ type: 'ACTION_COMMITTED' });
                }
                break;
            case 'pronounce':
                if (selection?.text) {
                    setLexiconText(selection.text);
                    setLexiconOpen(true);
                    dispatchCompass({ type: 'ACTION_COMMITTED' });
                }
                break;
            case 'delete':
                if (selection?.annotationId) {
                    remove(selection.annotationId);
                    showToast("Annotation deleted", "success");
                    dispatchCompass({ type: 'ACTION_COMMITTED' });
                }
                break;
            case 'dismiss':
                if (variant === 'sync-alert' && remoteProgress) {
                    setDismissedSyncAlerts(prev => new Set(prev).add(remoteProgress.deviceId));
                } else {
                    dispatchCompass({ type: 'DISMISSED' });
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
                return <VocabTriageCard text={selection?.text || ''} />;
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
                            delete: !!selection?.annotationId
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
            {/* role="region": the pill is the one piece of shell content
                outside the route's landmarks — naming it a landmark closes
                the last P0 'region' finding on the reader surface (the axe
                spec asserts the rule as fixed; Phase 8 §C/§K ratchet). */}
            <div
                role="region"
                aria-label="Quick actions"
                className="fixed bottom-8 left-0 right-0 z-40 px-4 pointer-events-none flex justify-center"
            >
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
