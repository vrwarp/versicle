import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataManagementTab, DataManagementTabProps } from './DataManagementTab';

describe('DataManagementTab', () => {
    const defaultProps: DataManagementTabProps = {
        readingListCount: 5,
        onViewReadingList: vi.fn(),
        onExportReadingList: vi.fn(),
        onImportReadingList: vi.fn(),
        backupStatus: null,
        onExportFull: vi.fn(),
        onExportWizard: vi.fn(),
        onExportLight: vi.fn(),
        onRestoreBackup: vi.fn(),
        isScanning: false,
        orphanScanResult: null,
        onRepairDB: vi.fn(),
        isRegenerating: false,
        regenerationProgress: null,
        regenerationPercent: 0,
        onRegenerateMetadata: vi.fn(),
        onClearAllData: vi.fn()
    };

    it('renders reading list section', () => {
        render(<DataManagementTab {...defaultProps} />);

        expect(screen.getByText('Reading List & Sync')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('View List')).toBeInTheDocument();
        expect(screen.getByText('Export to CSV')).toBeInTheDocument();
        expect(screen.getByText('Import CSV')).toBeInTheDocument();
    });

    it('renders backup section', () => {
        render(<DataManagementTab {...defaultProps} />);

        expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
        expect(screen.getByText('Export Full Backup (ZIP)')).toBeInTheDocument();
        expect(screen.getByText('Export Wizard (JSON)')).toBeInTheDocument();
        expect(screen.getByText('Restore Backup')).toBeInTheDocument();
    });

    it('shows backup status when present', () => {
        render(<DataManagementTab {...defaultProps} backupStatus="Exporting..." />);

        expect(screen.getByText('Exporting...')).toBeInTheDocument();
    });

    it('renders maintenance section', () => {
        render(<DataManagementTab {...defaultProps} />);

        expect(screen.getByText('Maintenance')).toBeInTheDocument();
        expect(screen.getByText('Check & Repair Database')).toBeInTheDocument();
        expect(screen.getByText('Regenerate All Metadata')).toBeInTheDocument();
    });

    it('shows scanning state', () => {
        render(<DataManagementTab {...defaultProps} isScanning={true} />);

        expect(screen.getByText('Scanning...')).toBeInTheDocument();
    });

    it('shows orphan scan result', () => {
        render(<DataManagementTab {...defaultProps} orphanScanResult="No orphans found." />);

        expect(screen.getByText('No orphans found.')).toBeInTheDocument();
    });

    it('shows regenerating state', () => {
        render(
            <DataManagementTab
                {...defaultProps}
                isRegenerating={true}
                regenerationProgress="Processing book 1 of 5..."
                regenerationPercent={20}
            />
        );

        expect(screen.getByText('Regenerating...')).toBeInTheDocument();
        expect(screen.getByText('Processing book 1 of 5...')).toBeInTheDocument();
    });

    it('renders danger zone', () => {
        render(<DataManagementTab {...defaultProps} />);

        expect(screen.getByText('Danger Zone')).toBeInTheDocument();
        expect(screen.getByText('Clear All Data')).toBeInTheDocument();
    });

    it('calls onViewReadingList when View List clicked', () => {
        const onViewReadingList = vi.fn();
        render(<DataManagementTab {...defaultProps} onViewReadingList={onViewReadingList} />);

        fireEvent.click(screen.getByText('View List'));
        expect(onViewReadingList).toHaveBeenCalled();
    });

    it('calls onExportFull when Export Full clicked', () => {
        const onExportFull = vi.fn();
        render(<DataManagementTab {...defaultProps} onExportFull={onExportFull} />);

        fireEvent.click(screen.getByText('Export Full Backup (ZIP)'));
        expect(onExportFull).toHaveBeenCalled();
    });

    it('calls onRepairDB when repair clicked', () => {
        const onRepairDB = vi.fn();
        render(<DataManagementTab {...defaultProps} onRepairDB={onRepairDB} />);

        fireEvent.click(screen.getByText('Check & Repair Database'));
        expect(onRepairDB).toHaveBeenCalled();
    });

    it('calls onClearAllData when Clear All Data clicked', () => {
        const onClearAllData = vi.fn();
        render(<DataManagementTab {...defaultProps} onClearAllData={onClearAllData} />);

        fireEvent.click(screen.getByText('Clear All Data'));
        expect(onClearAllData).toHaveBeenCalled();
    });

    it('triggers file input when Import CSV clicked', () => {
        render(<DataManagementTab {...defaultProps} />);

        const input = screen.getByTestId('reading-list-csv-input');
        const clickSpy = vi.spyOn(input, 'click');

        fireEvent.click(screen.getByText('Import CSV'));
        expect(clickSpy).toHaveBeenCalled();
    });

    it('calls onImportReadingList when CSV file selected', () => {
        const onImportReadingList = vi.fn();
        render(<DataManagementTab {...defaultProps} onImportReadingList={onImportReadingList} />);

        const input = screen.getByTestId('reading-list-csv-input');
        const file = new File(['content'], 'list.csv', { type: 'text/csv' });

        Object.defineProperty(input, 'files', { value: [file] });
        fireEvent.change(input);

        expect(onImportReadingList).toHaveBeenCalledWith(file);
    });
});
