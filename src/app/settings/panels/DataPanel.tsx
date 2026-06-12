/**
 * Data Management settings panel (Phase 8 §B): self-contained wiring for
 * the presentational DataManagementTab — reading-list CSV import/export,
 * backup/restore, DB repair, metadata regeneration, clear-all-data — plus
 * the CSV-import progress overlay and the ReadingListDialog. Handlers moved
 * verbatim from the deleted GlobalSettingsDialog.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useReadingListStore } from '@store/useReadingListStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useBookStore } from '@store/useLibraryStore';
import { maintenanceService } from '@lib/MaintenanceService';
import { backupService } from '@lib/BackupService';
import { wipeAllData } from '@data/wipe';
import { exportReadingListToCSV, parseReadingListCSV } from '@lib/csv';
import { exportFile } from '@lib/export';
import { Button } from '@components/ui/Button';
import { ReadingListDialog } from '@components/ReadingListDialog';
import { DataManagementTab } from '@components/settings';
import { useNavigationGuard } from '@hooks/useNavigationGuard';
import { BackButtonPriority } from '@store/useBackNavigationStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('DataPanel');

const DataPanel: React.FC = () => {
  const navigate = useNavigate();

  const readingListEntries = useReadingListStore(state => state.entries);
  const readingListCount = readingListEntries ? Object.keys(readingListEntries).length : 0;
  const [isReadingListOpen, setIsReadingListOpen] = useState(false);
  const [isCsvImporting, setIsCsvImporting] = useState(false);
  const [csvImportMessage, setCsvImportMessage] = useState('');
  const [csvImportComplete, setCsvImportComplete] = useState(false);

  const [orphanScanResult, setOrphanScanResult] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationProgress, setRegenerationProgress] = useState<string | null>(null);
  const [regenerationPercent, setRegenerationPercent] = useState(0);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  // The reading-list overlay closes on hardware back BEFORE the settings
  // overlay does (the settings close is plain history navigation; this
  // guard outranks it while the inner dialog is open).
  useNavigationGuard(() => {
    setIsReadingListOpen(false);
  }, BackButtonPriority.OVERLAY, isReadingListOpen);

  const handleExportReadingList = async () => {
    try {
      const list = Object.values(useReadingListStore.getState().entries);
      if (!list || list.length === 0) {
        alert('Reading list is empty.');
        return;
      }
      const csv = exportReadingListToCSV(list);
      const filename = `versicle_reading_list_${new Date().toISOString().split('T')[0]}.csv`;

      await exportFile({
        filename,
        data: csv,
        mimeType: 'text/csv'
      });
    } catch (e) {
      logger.error('Export reading list failed', e);
      alert('Failed to export reading list.');
    }
  };

  const handleReturnToLibrary = async () => {
    setIsCsvImporting(false);
    setCsvImportComplete(false);
    setCsvImportMessage('');
    navigate('/');
  };

  const handleImportReadingListFile = async (file: File) => {
    setIsCsvImporting(true);
    setCsvImportComplete(false);
    setCsvImportMessage('Reading file...');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      if (text) {
        try {
          setCsvImportMessage('Parsing CSV...');
          await new Promise(r => setTimeout(r, 500));
          const entries = parseReadingListCSV(text);

          setCsvImportMessage(`Importing ${entries.length} entries and syncing with library...`);
          await new Promise(r => setTimeout(r, 500));

          const store = useReadingListStore.getState();
          const rsStore = useReadingStateStore.getState();

          // Pre-compute a mapping of sourceFilename -> bookId to avoid O(N*M) lookups in the loop
          const libraryBooks = useBookStore.getState().books;
          const filenameToBookId: Record<string, string> = {};
          // Iterate over Object.values to match the original behavior exactly (finding the book object directly)
          for (const book of Object.values(libraryBooks)) {
            if (book && book.sourceFilename && !filenameToBookId[book.sourceFilename]) {
              // Only set if not already set, to match original .find() behavior (first match wins)
              filenameToBookId[book.sourceFilename] = book.bookId;
            }
          }

          for (const entry of entries) {
            store.upsertEntry(entry);
            if (entry.percentage !== undefined) {
              const bookId = filenameToBookId[entry.filename];
              const targetId = bookId || entry.filename;
              rsStore.updateLocation(targetId, '', entry.percentage);
            }
          }

          setCsvImportMessage(`Successfully imported ${entries.length} entries.`);
          setCsvImportComplete(true);
        } catch (err) {
          logger.error('CSV import failed', err);
          setCsvImportMessage('Failed to import CSV.');
          setTimeout(() => setIsCsvImporting(false), 2000);
        }
      }
    };
    reader.readAsText(file);
  };

  const handleClearAllData = async () => {
    if (confirm("Are you sure you want to delete ALL data? This includes books, annotations, and settings.")) {
      setIsClearing(true);
      try {
        // Single owner of the wipe: stops sync + Yjs persistence, deletes
        // both IndexedDB databases (EpubLibraryDB + versicle-yjs), clears
        // Versicle localStorage keys and app caches, then reloads.
        await wipeAllData();
      } catch (e) {
        logger.error('Failed to clear data', e);
        setIsClearing(false);
        alert('Failed to clear data. Please check console.');
      }
    }
  };

  const handleRepairDB = async () => {
    setIsScanning(true);
    setOrphanScanResult('Scanning...');
    try {
      const report = await maintenanceService.scanForOrphans();
      const total = report.files + report.locations + report.tts_prep;
      if (total > 0) {
        if (confirm(`Found orphans: \n - Files: ${report.files} \n - Locations: ${report.locations} \n - TTS Prep: ${report.tts_prep} \n\nDelete them?`)) {
          await maintenanceService.pruneOrphans();
          setOrphanScanResult('Repair complete. Orphans removed.');
        } else {
          setOrphanScanResult('Repair cancelled.');
        }
      } else {
        setOrphanScanResult('Database is healthy. No orphans found.');
      }
    } catch (e) {
      logger.error('Repair DB failed', e);
      setOrphanScanResult('Error during repair check console.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleRegenerateMetadata = async () => {
    if (!confirm("This will regenerate all book metadata and content structure from the stored files. This may take a while. Continue?")) {
      return;
    }

    setIsRegenerating(true);
    setRegenerationProgress('Starting...');
    setRegenerationPercent(0);

    try {
      await maintenanceService.regenerateAllMetadata((current, total, message) => {
        setRegenerationProgress(message);
        setRegenerationPercent(total > 0 ? Math.round((current / total) * 100) : 0);
      });
      setRegenerationProgress('Regeneration complete.');
      setRegenerationPercent(100);
      setTimeout(() => {
        setIsRegenerating(false);
        setRegenerationProgress(null);
      }, 3000);
    } catch (e) {
      logger.error('Regenerate metadata failed', e);
      setRegenerationProgress('Failed to regenerate metadata.');
      setIsRegenerating(false);
    }
  };

  const handleExportLight = async () => {
    try {
      setBackupStatus('Exporting metadata...');
      await backupService.createLightBackup();
      setBackupStatus('Metadata export complete.');
    } catch (error) {
      logger.error('Export light failed', error);
      setBackupStatus('Export failed.');
    }
  };

  const handleExportFull = async () => {
    try {
      setBackupStatus('Starting full backup...');
      await backupService.createFullBackup((percent, msg) => {
        setBackupStatus(`Backup: ${percent}% - ${msg} `);
      });
      setTimeout(() => setBackupStatus('Full backup complete.'), 2000);
    } catch (error) {
      logger.error('Export full failed', error);
      setBackupStatus('Full backup failed. Check console.');
    }
  };

  const handleRestoreBackupFile = async (file: File) => {
    if (!confirm('Restoring a backup will merge data into your library. Existing books will be updated. Continue?')) {
      return;
    }

    try {
      setBackupStatus('Starting restore...');
      await backupService.restoreBackup(file, (percent, msg) => {
        setBackupStatus(`Restore: ${percent}% - ${msg} `);
      });
      setBackupStatus('Restore complete! Reloading...');
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      logger.error('Restore failed', error);
      setBackupStatus(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'} `);
    }
  };

  return (
    <>
      {isCsvImporting && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8 text-center">
          <Loader2 className={`h-12 w-12 text-primary mb-4 ${!csvImportComplete ? 'animate-spin' : ''}`} aria-hidden="true" />
          <h3 className="text-xl font-semibold mb-2">{csvImportComplete ? 'Import Complete' : 'Importing Reading List'}</h3>
          <p className="text-muted-foreground mb-6">{csvImportMessage}</p>

          {csvImportComplete && (
            <Button size="lg" onClick={handleReturnToLibrary}>
              Return to Library
            </Button>
          )}
        </div>
      )}

      <DataManagementTab
        readingListCount={readingListCount}
        onViewReadingList={() => setIsReadingListOpen(true)}
        onExportReadingList={handleExportReadingList}
        onImportReadingList={handleImportReadingListFile}
        backupStatus={backupStatus}
        onExportFull={handleExportFull}
        onExportLight={handleExportLight}
        onRestoreBackup={handleRestoreBackupFile}
        isScanning={isScanning}
        orphanScanResult={orphanScanResult}
        onRepairDB={handleRepairDB}
        isRegenerating={isRegenerating}
        regenerationProgress={regenerationProgress}
        regenerationPercent={regenerationPercent}
        onRegenerateMetadata={handleRegenerateMetadata}
        onClearAllData={handleClearAllData}
        isClearing={isClearing}
      />

      <ReadingListDialog open={isReadingListOpen} onOpenChange={setIsReadingListOpen} />
    </>
  );
};

export default DataPanel;
