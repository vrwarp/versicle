import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GenAISettingsTab, GenAISettingsTabProps } from './GenAISettingsTab';

// Mock UI components
vi.mock('../ui/Select', () => ({
    Select: ({ children, value, onValueChange, disabled }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void; disabled?: boolean }) => (
        <div data-testid="select" data-value={value} data-disabled={disabled}>{children}</div>
    ),
    SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <button id={id}>{children}</button>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
        <div data-testid={`select-item-${value}`}>{children}</div>
    ),
    SelectValue: () => <span />
}));

vi.mock('../ui/Switch', () => ({
    Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
        <button
            id={id}
            data-testid={`switch-${id}`}
            data-checked={checked}
            onClick={() => onCheckedChange(!checked)}
        >
            {checked ? 'On' : 'Off'}
        </button>
    )
}));

vi.mock('../ui/Checkbox', () => ({
    Checkbox: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
        <input
            type="checkbox"
            id={id}
            checked={checked}
            onChange={() => onCheckedChange(!checked)}
        />
    )
}));

describe('GenAISettingsTab', () => {
    const defaultProps: GenAISettingsTabProps = {
        isEnabled: false,
        onEnabledChange: vi.fn(),
        apiKey: '',
        onApiKeyChange: vi.fn(),
        model: 'gemini-flash-lite-latest',
        onModelChange: vi.fn(),
        isModelRotationEnabled: false,
        onModelRotationChange: vi.fn(),
        isContentAnalysisEnabled: false,
        onContentAnalysisChange: vi.fn(),
        contentFilterSkipTypes: [],
        onContentFilterSkipTypesChange: vi.fn(),
        isDebugModeEnabled: false,
        onDebugModeChange: vi.fn(),
        onClearContentAnalysis: vi.fn(),
        isTableAdaptationEnabled: false,
        onTableAdaptationChange: vi.fn(),
        logs: [],
        onDownloadLogs: vi.fn()
    };

    it('renders header and toggle', () => {
        render(<GenAISettingsTab {...defaultProps} />);

        expect(screen.getByText('Generative AI Configuration')).toBeInTheDocument();
        expect(screen.getByText('Enable AI Features')).toBeInTheDocument();
    });

    it('hides configuration when disabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={false} />);

        expect(screen.queryByLabelText('Gemini API Key')).not.toBeInTheDocument();
    });

    it('shows configuration when enabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        expect(screen.getByLabelText('Gemini API Key')).toBeInTheDocument();
        expect(screen.getByText('Model')).toBeInTheDocument();
        expect(screen.getByText('Advanced Features')).toBeInTheDocument();
    });

    it('calls onEnabledChange when toggle clicked', () => {
        const onEnabledChange = vi.fn();
        render(<GenAISettingsTab {...defaultProps} onEnabledChange={onEnabledChange} />);

        fireEvent.click(screen.getByTestId('switch-genai-toggle'));
        expect(onEnabledChange).toHaveBeenCalledWith(true);
    });

    it('calls onApiKeyChange when API key input changes', () => {
        const onApiKeyChange = vi.fn();
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} onApiKeyChange={onApiKeyChange} />);

        fireEvent.change(screen.getByLabelText('Gemini API Key'), { target: { value: 'test-key' } });
        expect(onApiKeyChange).toHaveBeenCalledWith('test-key');
    });

    it('shows content filter options when content analysis enabled', () => {
        render(
            <GenAISettingsTab
                {...defaultProps}
                isEnabled={true}
                isContentAnalysisEnabled={true}
            />
        );

        expect(screen.getByText('Skip Content Types')).toBeInTheDocument();
        expect(screen.getByLabelText('footnote')).toBeInTheDocument();
        expect(screen.getByLabelText('table')).toBeInTheDocument();
    });

    it('calls onContentFilterSkipTypesChange when checkbox toggled', () => {
        const onContentFilterSkipTypesChange = vi.fn();
        render(
            <GenAISettingsTab
                {...defaultProps}
                isEnabled={true}
                isContentAnalysisEnabled={true}
                onContentFilterSkipTypesChange={onContentFilterSkipTypesChange}
            />
        );

        fireEvent.click(screen.getByLabelText('footnote'));
        expect(onContentFilterSkipTypesChange).toHaveBeenCalledWith(['footnote']);
    });

    it('shows debug logs section when enabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        expect(screen.getByText('Debug Logs')).toBeInTheDocument();
        expect(screen.getByText('No logs available.')).toBeInTheDocument();
    });

    it('displays logs when present', () => {
        const logs = [
            { id: '1', timestamp: Date.now(), type: 'request', method: 'analyze', payload: { test: 'data' } }
        ];
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} logs={logs} />);

        expect(screen.getByText(/REQUEST - analyze/)).toBeInTheDocument();
    });

    it('calls onDownloadLogs when download button clicked', () => {
        const onDownloadLogs = vi.fn();
        const logs = [{ id: '1', timestamp: Date.now(), type: 'request', method: 'test', payload: {} }];
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} logs={logs} onDownloadLogs={onDownloadLogs} />);

        fireEvent.click(screen.getByText('Download Logs'));
        expect(onDownloadLogs).toHaveBeenCalled();
    });

    it('disables download button when no logs', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} logs={[]} />);

        expect(screen.getByText('Download Logs').closest('button')).toBeDisabled();
    });
});
