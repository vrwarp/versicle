import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GenAISettingsTab, type GenAISettingsTabProps } from './GenAISettingsTab';

// Mock UI components
vi.mock('../ui/Select', () => ({
    Select: ({ children, value, disabled }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void; disabled?: boolean }) => (
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
        onDownloadLogs: vi.fn(),
        maxLogs: 100,
        onMaxLogsChange: vi.fn(),
        onClearLogs: vi.fn(),
        quotaLimits: { rpm: 100, tpm: 30000, rpd: 1000 },
        onQuotaLimitsChange: vi.fn(),
        bgThrottlePercent: 50,
        onBgThrottlePercentChange: vi.fn(),
        fgRpdHeadroom: 0,
        onFgRpdHeadroomChange: vi.fn(),
        pauseAllGenAI: false,
        onPauseAllGenAIChange: vi.fn(),
        preEmbedLibrary: false,
        onPreEmbedLibraryChange: vi.fn(),
        shareAiCaches: false,
        onShareAiCachesChange: vi.fn(),
        meters: {
            // Seeded snapshot: the bars MUST read these exact figures, proving
            // the meter derives from the snapshot rather than fabricating.
            fg: { rpm: 40, tpm: 12000, rpd: 300, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
            bg: { rpm: 5, tpm: 2000, rpd: 300, limits: { rpm: 100, tpm: 30000, rpd: 1000 } },
            projectRpd: 500,
            etas: { rpmMs: 90_000, tpmMs: 90_000, rpdMs: 7_200_000 }
        }
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
        expect(screen.getByLabelText('reference')).toBeInTheDocument();
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

        fireEvent.click(screen.getByLabelText('reference'));
        expect(onContentFilterSkipTypesChange).toHaveBeenCalledWith(['reference']);
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

    // ── Quota & Usage (A7, §10.7 meters test at the presentational layer) ──

    it('shows the Quota & Usage section when enabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        expect(screen.getByText('Quota & Usage')).toBeInTheDocument();
        expect(screen.getByText('Live Usage')).toBeInTheDocument();
    });

    it('calls onQuotaLimitsChange when a per-lane limit input changes', () => {
        const onQuotaLimitsChange = vi.fn();
        render(
            <GenAISettingsTab
                {...defaultProps}
                isEnabled={true}
                onQuotaLimitsChange={onQuotaLimitsChange}
            />
        );

        fireEvent.change(screen.getByLabelText('Requests / min'), { target: { value: '200' } });
        expect(onQuotaLimitsChange).toHaveBeenCalledWith({ rpm: 200, tpm: 30000, rpd: 1000 });
    });

    it('calls onPauseAllGenAIChange when the pause-all switch is toggled', () => {
        const onPauseAllGenAIChange = vi.fn();
        render(
            <GenAISettingsTab
                {...defaultProps}
                isEnabled={true}
                onPauseAllGenAIChange={onPauseAllGenAIChange}
            />
        );

        fireEvent.click(screen.getByTestId('switch-genai-pause-all'));
        expect(onPauseAllGenAIChange).toHaveBeenCalledWith(true);
    });

    it('meter progressbars derive aria-valuenow/max from the SEEDED snapshot (no fabrication)', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        const rpmBar = screen.getByRole('progressbar', { name: 'Foreground RPM usage' });
        expect(rpmBar).toHaveAttribute('aria-valuenow', '40'); // meters.fg.rpm
        expect(rpmBar).toHaveAttribute('aria-valuemax', '100'); // meters.fg.limits.rpm

        const tpmBar = screen.getByRole('progressbar', { name: 'Foreground TPM usage' });
        expect(tpmBar).toHaveAttribute('aria-valuenow', '12000'); // meters.fg.tpm
        expect(tpmBar).toHaveAttribute('aria-valuemax', '30000'); // meters.fg.limits.tpm

        const rpdBar = screen.getByRole('progressbar', { name: 'Foreground RPD usage' });
        expect(rpdBar).toHaveAttribute('aria-valuenow', '300'); // meters.fg.rpd
        expect(rpdBar).toHaveAttribute('aria-valuemax', '1000'); // meters.fg.limits.rpd
    });

    it("today-spend shows the seeded project-wide RPD total", () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        expect(screen.getByTestId('genai-project-rpd')).toHaveTextContent('500 / 1000 requests');
    });

    // ── Semantic Search opt-in + disclosure (E3, §7/§8.4) ──

    it('renders the pre-embed opt-in default-OFF when enabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        expect(screen.getByText('Semantic Search')).toBeInTheDocument();
        const toggle = screen.getByTestId('switch-genai-preembed');
        expect(toggle).toHaveAttribute('data-checked', 'false');
    });

    it('hides the pre-embed opt-in when AI features are disabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={false} />);

        expect(screen.queryByTestId('switch-genai-preembed')).not.toBeInTheDocument();
    });

    it('calls onPreEmbedLibraryChange when the opt-in is toggled', () => {
        const onPreEmbedLibraryChange = vi.fn();
        render(
            <GenAISettingsTab
                {...defaultProps}
                isEnabled={true}
                onPreEmbedLibraryChange={onPreEmbedLibraryChange}
            />
        );

        fireEvent.click(screen.getByTestId('switch-genai-preembed'));
        expect(onPreEmbedLibraryChange).toHaveBeenCalledWith(true);
    });

    it('renders the share-AI-caches opt-in default-OFF when enabled', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        expect(screen.getByText('Share AI caches across my devices')).toBeInTheDocument();
        const toggle = screen.getByTestId('switch-genai-share-ai-caches');
        expect(toggle).toHaveAttribute('data-checked', 'false');
    });

    it('calls onShareAiCachesChange when the share-AI-caches opt-in is toggled', () => {
        const onShareAiCachesChange = vi.fn();
        render(
            <GenAISettingsTab
                {...defaultProps}
                isEnabled={true}
                onShareAiCachesChange={onShareAiCachesChange}
            />
        );

        fireEvent.click(screen.getByTestId('switch-genai-share-ai-caches'));
        expect(onShareAiCachesChange).toHaveBeenCalledWith(true);
    });

    it('shows the NEW disclosure copy (full-text embedding + query-term egress)', () => {
        render(<GenAISettingsTab {...defaultProps} isEnabled={true} />);

        const disclosure = screen.getByText(/full text/i).closest('p');
        expect(disclosure).toHaveTextContent(/full text/i);
        expect(disclosure).toHaveTextContent(/search query terms/i);
        expect(disclosure).toHaveTextContent(/Google/);
        // Distinct from the TTS excerpt consent (the copy says so explicitly).
        expect(disclosure).toHaveTextContent(/TTS/);
    });
});
