import React from 'react';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { PasswordInput } from '../ui/PasswordInput';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Download } from 'lucide-react';
import type { ContentType } from '~types/content-analysis';
import type { QuotaLimits, LaneUsage } from '@kernel/quota';
import { formatTime } from '@kernel/locale/format';

/**
 * Per-lane time-to-exhaustion hints (ms; null when not filling) the panel
 * derives from the live snapshot's window fill rate. Presentational only —
 * every number here is computed by the wiring layer (GenAIPanel useQuotaMeters)
 * and passed in; this tab fabricates nothing.
 */
interface QuotaMeterEtas {
    /** ms until RPM exhaustion at the current minute fill rate (null = idle). */
    rpmMs: number | null;
    /** ms until TPM exhaustion at the current minute fill rate (null = idle). */
    tpmMs: number | null;
    /** ms until RPD exhaustion at the current daily rate (null = idle). */
    rpdMs: number | null;
}

/** Live meter inputs, all derived from `governor.snapshot()` by the panel. */
export interface QuotaMeters {
    /** Foreground-lane live usage (the shared snapshot shape). */
    fg: LaneUsage;
    /** Background-lane live usage (the shared snapshot shape). */
    bg: LaneUsage;
    /** Project-wide RPD: this device's bg.rpd + the A6 cross-device sum. */
    projectRpd: number;
    /** Foreground-lane time-to-exhaustion hints. */
    etas: QuotaMeterEtas;
}

interface GenAILog {
    id: string;
    timestamp: number;
    type: string;
    method: string;
    payload: unknown;
    bookTitle?: string;
    sectionTitle?: string;
    correlationId?: string;
}

/** Render an ms-ETA as a short human hint, or a dash when not filling. */
function formatEta(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms) || ms <= 0) return '—';
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `~${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `~${hours} hr`;
}

/**
 * A used-vs-limit progress bar. `role="progressbar"` with aria-valuenow/min/max
 * carries the exact figures for assistive tech (jsx-a11y clean); the visible
 * label echoes `used / limit`. Every number is a prop — no fabrication.
 */
const UsageBar: React.FC<{ label: string; used: number; limit: number }> = ({
    label,
    used,
    limit,
}) => {
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono">
                    {used} / {limit}
                </span>
            </div>
            <div
                role="progressbar"
                aria-label={`${label} usage`}
                aria-valuenow={used}
                aria-valuemin={0}
                aria-valuemax={limit}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
                <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

export interface GenAISettingsTabProps {
    // Core settings
    isEnabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    apiKey: string;
    onApiKeyChange: (key: string) => void;
    model: string;
    onModelChange: (model: string) => void;
    // Model rotation
    isModelRotationEnabled: boolean;
    onModelRotationChange: (enabled: boolean) => void;
    // Content analysis
    isContentAnalysisEnabled: boolean;
    onContentAnalysisChange: (enabled: boolean) => void;
    contentFilterSkipTypes: ContentType[];
    onContentFilterSkipTypesChange: (types: ContentType[]) => void;
    isDebugModeEnabled: boolean;
    onDebugModeChange: (enabled: boolean) => void;
    onClearContentAnalysis: () => void;
    // Table adaptation
    isTableAdaptationEnabled: boolean;
    onTableAdaptationChange: (enabled: boolean) => void;
    // Logs
    logs: GenAILog[];
    maxLogs: number;
    onMaxLogsChange: (max: number) => void;
    onDownloadLogs: () => void;
    onClearLogs: () => void;
    // Quota & Usage (A7)
    quotaLimits: QuotaLimits;
    onQuotaLimitsChange: (limits: QuotaLimits) => void;
    bgThrottlePercent: number;
    onBgThrottlePercentChange: (percent: number) => void;
    fgRpdHeadroom: number;
    onFgRpdHeadroomChange: (headroom: number) => void;
    pauseAllGenAI: boolean;
    onPauseAllGenAIChange: (paused: boolean) => void;
    meters: QuotaMeters;
    // Semantic Search — library-wide background pre-embed opt-in (E3)
    preEmbedLibrary: boolean;
    onPreEmbedLibraryChange: (enabled: boolean) => void;
}

export const GenAISettingsTab: React.FC<GenAISettingsTabProps> = ({
    isEnabled,
    onEnabledChange,
    apiKey,
    onApiKeyChange,
    model,
    onModelChange,
    isModelRotationEnabled,
    onModelRotationChange,
    isContentAnalysisEnabled,
    onContentAnalysisChange,
    contentFilterSkipTypes,
    onContentFilterSkipTypesChange,
    isDebugModeEnabled,
    onDebugModeChange,
    onClearContentAnalysis,
    isTableAdaptationEnabled,
    onTableAdaptationChange,
    logs,
    maxLogs,
    onMaxLogsChange,
    onDownloadLogs,
    onClearLogs,
    quotaLimits,
    onQuotaLimitsChange,
    bgThrottlePercent,
    onBgThrottlePercentChange,
    fgRpdHeadroom,
    onFgRpdHeadroomChange,
    pauseAllGenAI,
    onPauseAllGenAIChange,
    meters,
    preEmbedLibrary,
    onPreEmbedLibraryChange
}) => {
    const contentTypes: ContentType[] = ['reference'];

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium mb-4">Generative AI Configuration</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Enable advanced features powered by Google Gemini (e.g., smart TOC, pronunciation guides).
                </p>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <label htmlFor="genai-toggle" className="text-sm font-medium">Enable AI Features</label>
                            <p className="text-xs text-muted-foreground">
                                Allows the app to send content to the AI provider.
                            </p>
                        </div>
                        <Switch
                            id="genai-toggle"
                            checked={isEnabled}
                            onCheckedChange={onEnabledChange}
                        />
                    </div>

                    {isEnabled && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="genai-api-key">Gemini API Key</Label>
                                <PasswordInput
                                    id="genai-api-key"
                                    value={apiKey}
                                    onChange={(e) => onApiKeyChange(e.target.value)}
                                    placeholder="Enter your Google Gemini API Key"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Your key is stored locally on this device.
                                </p>
                            </div>

                            <div className="flex items-center justify-between border-b pb-4">
                                <div className="space-y-0.5">
                                    <label htmlFor="genai-rotation" className="text-sm font-medium">Free Tier Rotation</label>
                                    <p className="text-xs text-muted-foreground max-w-sm">
                                        Maximizes free quota by randomly rotating between gemini-2.5-flash-lite and gemini-2.5-flash on each request.
                                    </p>
                                </div>
                                <Switch
                                    id="genai-rotation"
                                    checked={isModelRotationEnabled}
                                    onCheckedChange={onModelRotationChange}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="genai-model-select" className="text-sm font-medium">Model</Label>
                                <Select value={model} onValueChange={onModelChange} disabled={isModelRotationEnabled}>
                                    <SelectTrigger id="genai-model-select" aria-label="Select generative AI model"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="gemini-flash-lite-latest">Gemini Flash-Lite Latest (Recommended)</SelectItem>
                                        <SelectItem value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</SelectItem>
                                        <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                                        <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                                        <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                                    </SelectContent>
                                </Select>
                                {isModelRotationEnabled && (
                                    <p className="text-xs text-muted-foreground">
                                        Model selection is handled automatically when rotation is enabled.
                                    </p>
                                )}
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <h4 className="text-sm font-medium">Advanced Features</h4>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label htmlFor="genai-content-detection" className="text-sm font-medium">Content Type Detection & Filtering</label>
                                            <p className="text-xs text-muted-foreground">
                                                Automatically detects and skips non-narrative content.
                                            </p>
                                        </div>
                                        <Switch
                                            id="genai-content-detection"
                                            checked={isContentAnalysisEnabled}
                                            onCheckedChange={onContentAnalysisChange}
                                        />
                                    </div>

                                    {isContentAnalysisEnabled && (
                                        <div className="space-y-3 pl-4 border-l-2 border-muted">
                                            <h5 className="text-sm font-medium">Skip Content Types</h5>
                                            <div className="grid grid-cols-2 gap-2">
                                                {contentTypes.map((type) => (
                                                    <div key={type} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`skip-${type}`}
                                                            checked={contentFilterSkipTypes.includes(type)}
                                                            onCheckedChange={(checked) => {
                                                                if (checked) {
                                                                    onContentFilterSkipTypesChange([...contentFilterSkipTypes, type]);
                                                                } else {
                                                                    onContentFilterSkipTypesChange(contentFilterSkipTypes.filter(t => t !== type));
                                                                }
                                                            }}
                                                        />
                                                        <label htmlFor={`skip-${type}`} className="text-sm capitalize">
                                                            {type}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="pt-2">
                                                <Button variant="outline" size="sm" onClick={onClearContentAnalysis} aria-label="Clear content analysis cache">
                                                    Clear Content Analysis Cache
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label htmlFor="genai-table-adaptation" className="text-sm font-medium">Table Teleprompter</label>
                                            <p className="text-xs text-muted-foreground">
                                                Uses GenAI to convert table images into natural speech.
                                            </p>
                                        </div>
                                        <Switch
                                            id="genai-table-adaptation"
                                            checked={isTableAdaptationEnabled}
                                            onCheckedChange={onTableAdaptationChange}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label htmlFor="genai-debug" className="text-sm font-medium">Enable GenAI Debug Panel</label>
                                            <p className="text-xs text-muted-foreground">
                                                Shows a debug panel for content analysis and table teleprompter features.
                                            </p>
                                        </div>
                                        <Switch
                                            id="genai-debug"
                                            checked={isDebugModeEnabled}
                                            onCheckedChange={onDebugModeChange}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <h4 className="text-sm font-medium">Debug Logs</h4>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex items-center space-x-2">
                                            <Label htmlFor="max-logs" className="text-xs whitespace-nowrap">Max Logs:</Label>
                                            <input
                                                id="max-logs"
                                                type="number"
                                                aria-label="Max GenAI debug logs"
                                                min={1}
                                                max={1000}
                                                className="flex h-8 w-20 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                value={maxLogs}
                                                onChange={(e) => onMaxLogsChange(parseInt(e.target.value) || 100)}
                                            />
                                        </div>
                                        <Button variant="outline" size="sm" onClick={onClearLogs} disabled={logs.length === 0} aria-label="Clear GenAI debug logs">
                                            Clear Logs
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={onDownloadLogs} disabled={logs.length === 0} aria-label="Download GenAI debug logs">
                                            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                                            Download Logs
                                        </Button>
                                    </div>
                                </div>
                                <div className="bg-muted p-2 rounded-md h-40 overflow-y-auto font-mono text-xs">
                                    {logs.length === 0 ? (
                                        <span className="text-muted-foreground">No logs available.</span>
                                    ) : (
                                        logs.slice().reverse().map(log => (
                                            <div key={log.id} className="mb-2 border-b last:border-0 pb-2">
                                                <div className="font-semibold text-primary">
                                                    [{formatTime(log.timestamp)}] {log.type.toUpperCase()} - {log.method}
                                                </div>
                                                {(log.bookTitle || log.sectionTitle || log.correlationId) && (
                                                    <div className="text-muted-foreground mb-1">
                                                        {log.bookTitle && <span>Book: {log.bookTitle} </span>}
                                                        {log.sectionTitle && <span>| Section: {log.sectionTitle} </span>}
                                                        {log.correlationId && <span>| Correlation: {log.correlationId}</span>}
                                                    </div>
                                                )}
                                                <div className="whitespace-pre-wrap truncate line-clamp-2">
                                                    {JSON.stringify(log.payload)}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div>
                                    <h4 className="text-sm font-medium">Quota & Usage</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Per-lane rate limits (read fresh on each request) and live usage meters.
                                    </p>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="genai-pause-all" className="text-sm font-medium">Pause All AI Requests</Label>
                                        <p className="text-xs text-muted-foreground">
                                            Stops every outgoing AI request before it leaves this device.
                                        </p>
                                    </div>
                                    <Switch
                                        id="genai-pause-all"
                                        checked={pauseAllGenAI}
                                        onCheckedChange={onPauseAllGenAIChange}
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="genai-quota-rpm" className="text-xs">Requests / min</Label>
                                        <Input
                                            id="genai-quota-rpm"
                                            type="number"
                                            min={0}
                                            value={quotaLimits.rpm}
                                            onChange={(e) =>
                                                onQuotaLimitsChange({ ...quotaLimits, rpm: parseInt(e.target.value) || 0 })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="genai-quota-tpm" className="text-xs">Tokens / min</Label>
                                        <Input
                                            id="genai-quota-tpm"
                                            type="number"
                                            min={0}
                                            value={quotaLimits.tpm}
                                            onChange={(e) =>
                                                onQuotaLimitsChange({ ...quotaLimits, tpm: parseInt(e.target.value) || 0 })
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="genai-quota-rpd" className="text-xs">Requests / day</Label>
                                        <Input
                                            id="genai-quota-rpd"
                                            type="number"
                                            min={0}
                                            value={quotaLimits.rpd}
                                            onChange={(e) =>
                                                onQuotaLimitsChange({ ...quotaLimits, rpd: parseInt(e.target.value) || 0 })
                                            }
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="genai-bg-throttle" className="text-xs">Background Throttle (%)</Label>
                                        <Input
                                            id="genai-bg-throttle"
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={bgThrottlePercent}
                                            onChange={(e) =>
                                                onBgThrottlePercentChange(parseInt(e.target.value) || 0)
                                            }
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Share of the budget background work may use before it yields to foreground.
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="genai-fg-headroom" className="text-xs">Foreground RPD Headroom</Label>
                                        <Input
                                            id="genai-fg-headroom"
                                            type="number"
                                            min={0}
                                            value={fgRpdHeadroom}
                                            onChange={(e) =>
                                                onFgRpdHeadroomChange(parseInt(e.target.value) || 0)
                                            }
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Daily requests reserved for interactive use.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2">
                                    <h5 className="text-sm font-medium">Live Usage</h5>
                                    <div className="space-y-2">
                                        <UsageBar label="Foreground RPM" used={meters.fg.rpm} limit={meters.fg.limits.rpm} />
                                        <UsageBar label="Foreground TPM" used={meters.fg.tpm} limit={meters.fg.limits.tpm} />
                                        <UsageBar label="Foreground RPD" used={meters.fg.rpd} limit={meters.fg.limits.rpd} />
                                        <UsageBar label="Background RPM" used={meters.bg.rpm} limit={meters.bg.limits.rpm} />
                                        <UsageBar label="Background TPM" used={meters.bg.tpm} limit={meters.bg.limits.tpm} />
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">Today's spend (this project, all devices)</span>
                                        <span className="font-mono" data-testid="genai-project-rpd">
                                            {meters.projectRpd} / {meters.fg.limits.rpd} requests
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
                                        <span>RPM exhausts: {formatEta(meters.etas.rpmMs)}</span>
                                        <span>TPM exhausts: {formatEta(meters.etas.tpmMs)}</span>
                                        <span>RPD exhausts: {formatEta(meters.etas.rpdMs)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div>
                                    <h4 className="text-sm font-medium">Semantic Search</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Pre-embed your library so semantic search can find passages by meaning.
                                    </p>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5 max-w-md">
                                        <label htmlFor="genai-preembed" className="text-sm font-medium">
                                            Pre-embed my library for semantic search
                                        </label>
                                        <p className="text-xs text-muted-foreground">
                                            When ON, the <strong>full text</strong> of books you have loaded but
                                            not yet read is sent to Google during idle time to build search
                                            embeddings, and your <strong>search query terms</strong> leave the
                                            device to Google whenever you run a semantic search. This is broader
                                            than the per-book TTS consent, which only sends short excerpts to
                                            improve audio narration. Default OFF — nothing is pre-embedded unless
                                            you turn this on.
                                        </p>
                                    </div>
                                    <Switch
                                        id="genai-preembed"
                                        checked={preEmbedLibrary}
                                        onCheckedChange={onPreEmbedLibraryChange}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
