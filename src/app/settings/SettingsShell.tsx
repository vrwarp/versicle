/**
 * SettingsShell (Phase 8 §B) — the registry-driven replacement for the
 * 738-line GlobalSettingsDialog god file (deleted with this shell).
 *
 * - `/settings/:tab` is the single source of the active tab: deep links
 *   cold-load onto the right panel (over the library), tab switches are
 *   `replace` navigations so ONE back gesture closes the whole overlay.
 * - Real tablist semantics via Radix Tabs `orientation="vertical"` (the
 *   fake-button sidebar was a11y item 7).
 * - Panels are self-contained modules (the DiagnosticsTab model), mounted
 *   lazily — ONLY the active panel loads/mounts, each behind its own
 *   ErrorBoundary + Suspense.
 * - Back-button safety: closing IS history navigation, so the existing
 *   BackNavigationManager (useBackNavigationStore keeper) needs no
 *   settings-specific guard — hardware back with no higher-priority
 *   handler pops the URL and the overlay closes; overlays INSIDE panels
 *   (e.g. the reading-list dialog) keep their own guards and win first.
 */
import React, { Suspense, useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { MigrationStateService } from '@domains/sync/workspaces/MigrationStateService';
import { X } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@components/ui/Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@components/ui/Tabs';
import { ErrorBoundary } from '@components/ErrorBoundary';
import { cn } from '@lib/utils';
import { Loader2 } from 'lucide-react';
import { SETTINGS_PANELS, resolveSettingsTab, type SettingsTabId } from './registry';
import { formatMessage } from '@kernel/locale/messages';

/** One React.lazy component per descriptor, created once at module scope. */
const LAZY_PANELS = new Map(
  SETTINGS_PANELS.map((panel) => [panel.id, React.lazy(panel.load)] as const),
);

function PanelFallback() {
  return (
    <div className="flex items-center justify-center py-12" role="status" aria-label="Loading settings panel">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
    </div>
  );
}

export const SettingsShell: React.FC = () => {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTab = resolveSettingsTab(tab);

  // The shell mounts at either the top-level /settings/:tab (overlay on the
  // library) or nested under the reader at /read/:id/settings/:tab (overlay on
  // the live book). Derive the base from the URL so tab hops and cold-close
  // stay within the mount that opened us — bouncing a reader-nested overlay to
  // /settings would unmount ReaderShell and drop the "This Book" lexicon scope.
  const { settingsBase, underlayPath } = useMemo(() => {
    const marker = pathname.indexOf('/settings');
    if (marker < 0) {
      return { settingsBase: '/settings', underlayPath: '/' };
    }
    return {
      settingsBase: pathname.slice(0, marker + '/settings'.length),
      underlayPath: pathname.slice(0, marker) || '/',
    };
  }, [pathname]);

  const close = useCallback(() => {
    // In-app open pushed a history entry — back restores the previous
    // location (library, notes or reader). Cold deep-link lands on the route
    // beneath the overlay (the reader for a nested mount, otherwise the
    // library) instead of exiting the app.
    const historyIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (historyIdx > 0) {
      navigate(-1);
    } else {
      navigate(underlayPath, { replace: true });
    }
  }, [navigate, underlayPath]);

  const selectTab = useCallback(
    (value: string) => {
      // `replace`: tab hops are one overlay session — back closes settings,
      // it does not replay the tab tour (matches the old dialog's local
      // tab state). Keep the current base so a reader-nested overlay stays
      // nested (preserving the book context) instead of jumping to /settings.
      navigate(`${settingsBase}/${value as SettingsTabId}`, { replace: true });
    },
    [navigate, settingsBase],
  );

  // Pending-migration guard: a staged workspace switch reloads back onto
  // /settings/sync in the AWAITING_CONFIRMATION boot arm, where the app-level
  // WorkspaceMigrationConfirmModal (App.tsx) is the only legal interaction.
  // Mounting this Radix modal Dialog then would aria-hide that plain modal
  // (Radix hideOthers marks every sibling aria-hidden) and trap focus under
  // it — the confirmation stays visible on screen but unreachable for AT and
  // role-based queries. Step aside instead: render nothing and hand the URL
  // back to the underlay until the user finalizes or rolls back.
  const migrationPending = MigrationStateService.getState()?.status === 'AWAITING_CONFIRMATION';
  useEffect(() => {
    if (migrationPending) navigate(underlayPath, { replace: true });
  }, [migrationPending, navigate, underlayPath]);

  if (migrationPending) return null;

  return (
    <Modal open onOpenChange={(open) => { if (!open) close(); }}>
      <ModalContent
        hideCloseButton
        className="max-w-3xl h-[90vh] sm:h-[600px] flex flex-col sm:flex-row p-0 overflow-hidden gap-0 sm:rounded-lg"
        aria-describedby="global-settings-desc"
      >
        <VisuallyHidden>
          <ModalHeader>
            <ModalTitle>Global Settings</ModalTitle>
            <ModalDescription id="global-settings-desc">
              Global application settings including appearance, TTS configuration, and data management.
            </ModalDescription>
          </ModalHeader>
        </VisuallyHidden>

        <button
          type="button"
          onClick={close}
          data-testid="settings-close-button"
          className="absolute right-2 top-2 sm:right-4 sm:top-4 z-[60] rounded-full bg-background/80 backdrop-blur-sm p-2 shadow-sm border border-border opacity-100 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>

        <Tabs
          value={activeTab}
          onValueChange={selectTab}
          orientation="vertical"
          className="flex flex-col sm:flex-row w-full h-full min-h-0"
        >
          {/* Sidebar — a REAL tablist (a11y item 7) */}
          <TabsList
            aria-label="Settings sections"
            className="w-full sm:w-1/4 h-auto bg-muted/30 border-b sm:border-r sm:border-b-0 p-2 sm:p-4 flex flex-row sm:flex-col gap-2 overflow-x-auto sm:overflow-visible items-center sm:items-stretch shrink-0 justify-start rounded-none text-foreground"
          >
            <h2 className="text-lg font-semibold mb-4 px-2 hidden sm:block" aria-hidden="true">
              Settings
            </h2>
            {SETTINGS_PANELS.map(({ id, labelKey, danger }) => (
              <TabsTrigger
                key={id}
                value={id}
                data-testid={`settings-tab-${id}`}
                className={cn(
                  'w-auto sm:w-full justify-start whitespace-nowrap flex-shrink-0 px-4 py-2 rounded-md',
                  'hover:bg-accent hover:text-accent-foreground data-[state=active]:bg-secondary',
                  danger && 'text-destructive hover:text-destructive data-[state=active]:text-destructive mr-10 sm:mr-0',
                )}
              >
                {formatMessage(labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Content — only the ACTIVE panel mounts (Radix unmounts the rest) */}
          {SETTINGS_PANELS.map(({ id }) => {
            const LazyPanel = LAZY_PANELS.get(id)!;
            return (
              <TabsContent
                key={id}
                value={id}
                className="w-full sm:w-3/4 p-4 sm:p-8 overflow-y-auto flex-1 mt-0 data-[state=inactive]:hidden"
              >
                <ErrorBoundary>
                  <Suspense fallback={<PanelFallback />}>
                    <LazyPanel />
                  </Suspense>
                </ErrorBoundary>
              </TabsContent>
            );
          })}
        </Tabs>
      </ModalContent>
    </Modal>
  );
};
