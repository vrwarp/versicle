/**
 * General settings panel: self-contained wiring for the presentational
 * GeneralSettingsTab — theme + batch import.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { useToastStore } from '@store/useToastStore';
import { useImportController } from '@app/library/useImportController';
import { GeneralSettingsTab } from '@components/settings';

const GeneralPanel: React.FC = () => {
  const navigate = useNavigate();
  const isImporting = useLibraryStore((state) => state.isImporting);
  const { importFiles } = useImportController();
  const { currentTheme, setTheme } = usePreferencesStore(
    useShallow((state) => ({
      currentTheme: state.currentTheme,
      setTheme: state.setTheme,
    })),
  );

  return (
    <GeneralSettingsTab
      currentTheme={currentTheme}
      onThemeChange={setTheme}
      isImporting={isImporting}
      onBatchImport={(files) => {
        void importFiles(Array.from(files)).then(() => {
          // On `/`, LibraryView mounts ImportProgressUI's persistent summary banner.
          // If the user navigated elsewhere while the batch ran, notify via toast.
          if (window.location.pathname !== '/') {
            const summary = useLibraryStore.getState().batchImportSummary;
            if (summary) {
              const parts = [`${summary.imported} imported`];
              if (summary.skipped.length > 0) parts.push(`${summary.skipped.length} skipped`);
              if (summary.failed.length > 0) parts.push(`${summary.failed.length} failed`);
              useToastStore.getState().showToast(
                `Batch import complete: ${parts.join(', ')}`,
                summary.failed.length > 0 ? 'error' : 'success',
                5000,
              );
            }
          }
        });
        // Close the settings overlay so the library import progress is visible.
        navigate('/');
      }}
    />
  );
};

export default GeneralPanel;
