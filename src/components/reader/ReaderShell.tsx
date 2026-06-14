/**
 * ReaderShell — the reader route as pure composition (Phase 6 §5,
 * prep/phase6-reader-engine.md PR-9). The 1,400-line ReaderView died here;
 * every concern lives in a named module:
 *
 *  - engine construction + lifecycle + ReadingSessionRecorder + commands
 *      → app/reader/useReaderController
 *  - "Resume from Reading List?"   → shell/ImportJumpPrompt
 *  - annotations (highlights, audio-bookmark triage, note markers)
 *      → shell/AnnotationLayer
 *  - GenAI debug highlights        → shell/DebugHighlightLayer
 *  - header + immersive chrome     → shell/ReaderChrome
 *  - TOC/annotations/search mounts → shell/ReaderSidebars (+ useTocController,
 *      useDeviceMarkers)
 *  - TTS highlight/keyboard        → ReaderTTSController (rides the
 *      ReaderCommands context)
 *
 * The shell stays under 200 lines by construction — that ceiling is the
 * phase exit criterion the prep doc puts a wc -l gate on.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useTTS } from '@hooks/useTTS';
import { useSidebarState } from '@hooks/useSidebarState';
import { useReaderController } from '@app/reader/useReaderController';
import { ReaderCommandsProvider } from '@domains/reader/ui/ReaderCommands';
import { useImportJumpPrompt } from './shell/ImportJumpPrompt';
import { AnnotationLayer } from './shell/AnnotationLayer';
import { DebugHighlightLayer } from './shell/DebugHighlightLayer';
import { ReaderChrome } from './shell/ReaderChrome';
import { ReaderSidebars } from './shell/ReaderSidebars';
import { ReaderViewport } from './shell/ReaderViewport';
import { ReaderTTSController } from './ReaderTTSController';
import { HistoryHighlighter } from './HistoryHighlighter';
import { PinyinOverlay } from './PinyinOverlay';
import { SyncStatusPanel } from './SyncStatusPanel';
import { ContentAnalysisLegend } from './ContentAnalysisLegend';
import { ReaderHighlightsStyles } from './ReaderHighlightsStyles';

export const ReaderShell: React.FC = () => {
    const { id: bookId } = useParams<{ id: string }>();
    const { activeSidebar } = useSidebarState();

    const { currentSectionTitle, immersiveMode, resetCompassState, hidePopover } =
        useReaderUIStore(useShallow(state => ({
            currentSectionTitle: state.currentSectionTitle,
            immersiveMode: state.immersiveMode,
            resetCompassState: state.resetCompassState,
            hidePopover: state.hidePopover,
        })));
    const { fontSize, pinyinSize, currentTheme } = usePreferencesStore(useShallow(state => ({
        fontSize: state.fontSize,
        pinyinSize: state.pinyinSize,
        currentTheme: state.currentTheme,
    })));
    const isPlaying = useTTSPlaybackStore(state => state.isPlaying);

    // ImportJumpPrompt gates the controller's onLocationChange; the prompt
    // itself needs the controller's engine — a render-assigned ref breaks
    // the cycle without an extra render pass.
    const checkImportJumpRef = useRef<(percentage: number) => boolean>(() => false);
    const controller = useReaderController(bookId, {
        checkImportJump: (percentage) => checkImportJumpRef.current(percentage),
    });
    const importJump = useImportJumpPrompt({
        bookId,
        engine: controller.engine,
        areLocationsReady: controller.areLocationsReady,
        bookMetadata: controller.bookMetadata,
    });
    useEffect(() => {
        checkImportJumpRef.current = importJump.checkImportJump;
    }, [importJump.checkImportJump]);

    const [syncPanelOpen, setSyncPanelOpen] = useState(false);

    // The CompassPill collapses whenever a sidebar/immersive mode opens.
    useEffect(() => {
        if (activeSidebar !== 'none' || immersiveMode) {
            resetCompassState();
        }
    }, [activeSidebar, immersiveMode, resetCompassState]);

    // TTS session wiring (queue building, progress following).
    useTTS();

    return (
        <ReaderCommandsProvider commands={controller.commands} engine={controller.engine}>
            <div
                data-testid="reader-view"
                className="flex flex-col h-screen bg-background text-foreground relative"
                onClick={() => {
                    hidePopover();
                    useReaderUIStore.getState().resetCompassState();
                }}
            >
                {importJump.dialog}

                <ReaderTTSController viewMode={controller.readerViewMode} />

                <ReaderChrome
                    title={currentSectionTitle || controller.bookMetadata?.title || 'Reading'}
                    onOpenSyncPanel={() => setSyncPanelOpen(true)}
                />

                {/* Main Content — a real <main> landmark (P0 a11y baseline:
                    the reader body lived outside any landmark region) */}
                <main aria-label="Book" className="flex-1 relative overflow-hidden flex justify-center">
                    <ReaderSidebars
                        bookId={bookId}
                        engine={controller.engine}
                        bookMetadata={controller.bookMetadata}
                        historyTick={controller.historyTick}
                        searchSession={controller.searchSession}
                        onSearchNavigate={(result) => {
                            void controller.navigateToSearchResult(result);
                        }}
                    />

                    {/* Pinyin Overlay (Ephemeral UI) */}
                    <PinyinOverlay
                        positions={controller.pinyinPositions}
                        pinyinSize={pinyinSize}
                        containerNode={controller.containerNode}
                    />

                    {/* User annotations: highlights + note markers */}
                    <AnnotationLayer
                        bookId={bookId}
                        engine={controller.engine}
                        highlights={controller.highlights}
                        isReady={controller.isReady}
                        containerNode={controller.containerNode}
                        viewerRef={controller.viewerRef}
                        measureDeps={[fontSize, controller.readerViewMode]}
                    />

                    <ReaderViewport
                        viewerRef={controller.viewerRef}
                        scrollWrapperRef={controller.scrollWrapperRef}
                        readerViewMode={controller.readerViewMode}
                    />
                </main>

                <DebugHighlightLayer
                    bookId={bookId}
                    engine={controller.engine}
                    highlights={controller.highlights}
                    isReady={controller.isReady}
                />

                {/* Content Analysis Debug Legend */}
                <ContentAnalysisLegend engine={controller.engine} />

                <SyncStatusPanel
                    open={syncPanelOpen}
                    onOpenChange={setSyncPanelOpen}
                    bookId={bookId || ''}
                    onJump={(cfi) => controller.commands.jumpTo(cfi)}
                />

                <HistoryHighlighter
                    highlights={controller.highlights}
                    isRenditionReady={controller.isReady}
                    bookId={bookId || null}
                    isPlaying={isPlaying}
                />

                <ReaderHighlightsStyles currentTheme={currentTheme} />
            </div>

            {/* Settings opened from the reader nests at /read/:id/settings/:tab
                and mounts here (SettingsShell is a portaled Modal, so the slot
                placement is incidental). Keeping it inside ReaderShell is what
                preserves the book context behind the overlay. */}
            <Outlet />
        </ReaderCommandsProvider>
    );
};
