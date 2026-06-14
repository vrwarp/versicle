/**
 * General settings panel (Phase 8 §B): self-contained wiring for the
 * presentational GeneralSettingsTab — theme + batch import. Handlers moved
 * verbatim from the deleted GlobalSettingsDialog.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useLibraryStore } from '@store/useLibraryStore';
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
        void importFiles(Array.from(files));
        // Close the settings overlay so the library import progress is visible.
        navigate('/');
      }}
    />
  );
};

export default GeneralPanel;
