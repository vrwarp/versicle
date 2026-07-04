/* eslint-disable jsx-a11y/label-has-for */
import React from 'react';
import { Label } from '../ui/Label';
import { Input } from '../ui/Input';
import { PasswordInput } from '../ui/PasswordInput';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Dialog } from '../ui/Dialog';
import { ScrollArea } from '../ui/ScrollArea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Download, Search, Edit2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import type { ContentType } from '~types/content-analysis';
import type { QuotaLimits, LaneUsage } from '@kernel/quota';
import { formatTime, formatNumber } from '@kernel/locale/format';
import { DEFAULT_QUOTA_LIMITS } from '@store/useGenAIStore';

/**
 * Per-lane time-to-exhaustion hints (ms; null when not filling) the panel
 * derives from the live snapshot's window fill rate. Presentational only —
 * every number here is computed by the wiring layer (GenAIPanel useQuotaMeters)
 * and passed in; this tab fabricates nothing.
 */
interface QuotaMeterEtas {
    /** ms until RPM exhaustion at the current minute fill rate (null = idle). */
    rpmMs: number | null;
    rpmPool: string | null;
    /** ms until TPM exhaustion at the current minute fill rate (null = idle). */
    tpmMs: number | null;
    tpmPool: string | null;
    /** ms until RPD exhaustion at the current daily rate (null = idle). */
    rpdMs: number | null;
    rpdPool: string | null;
}

/** Live meter inputs, all derived from `governor.snapshot()` by the panel. */
export interface QuotaMeters {
    fg: {
        rpm: number;
        tpm: number;
        rpd: number;
        limits: {
            rpd: number;
        };
    };
    bg: {
        rpm: number;
        tpm: number;
        rpd: number;
    };
    projectRpd: number;
    activePools: string[];
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

function formatEtaWithPool(ms: number | null, poolKey: string | null): string {
    if (ms === null || !Number.isFinite(ms) || ms <= 0) return '—';
    const timeStr = formatEta(ms);
    if (poolKey) {
        const label = RATE_POOL_LABELS[poolKey] || poolKey;
        return `${timeStr} (${label})`;
    }
    return timeStr;
}



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
    // Quota & Usage
    quotaLimitsMap: Record<string, QuotaLimits>;
    getQuotaSnapshot?: (ratePool?: string) => Record<'fg' | 'bg', LaneUsage>;
    onQuotaLimitsForPoolChange: (ratePool: string, limits: QuotaLimits) => void;
    onResetPoolLimits: (ratePool: string) => void;
    onResetAllPoolLimits: () => void;
    bgThrottlePercent: number;
    onBgThrottlePercentChange: (percent: number) => void;
    fgRpdHeadroom: number;
    onFgRpdHeadroomChange: (headroom: number) => void;
    pauseAllGenAI: boolean;
    onPauseAllGenAIChange: (paused: boolean) => void;
    meters: QuotaMeters;
    // Opt-in: embed the whole library in the background so semantic search can
    // find passages by meaning (default off).
    preEmbedLibrary: boolean;
    onPreEmbedLibraryChange: (enabled: boolean) => void;
    // Opt-in: upload this device's embedding vectors to the user's own cloud so
    // their other devices can reuse them instead of re-spending Gemini quota
    // (default off).
    shareAiCaches: boolean;
    onShareAiCachesChange: (enabled: boolean) => void;
}

const RATE_POOL_LABELS: Record<string, string> = {
    default: 'Default / General',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-1.5-pro': 'Gemini 1.5 Pro',
    'gemini-2.5-flash-tts': 'Gemini 2.5 Flash TTS',
    'gemini-3.1-flash-tts': 'Gemini 3.1 Flash TTS',
    'gemini-embedding-001': 'Gemini Embedding 1',
    'gemini-embedding-2': 'Gemini Embedding 2',
    'gemini-robotics-er-1.5-preview': 'Gemini Robotics ER 1.5 Preview',
    'gemini-robotics-er-1.6-preview': 'Gemini Robotics ER 1.6 Preview',
    'gemma-4-26b': 'Gemma 4 26B',
    'gemma-4-31b': 'Gemma 4 31B',
    'imagen-4-fast-generate': 'Imagen 4 Fast Generate',
    'imagen-4-generate': 'Imagen 4 Generate',
    'imagen-4-ultra-generate': 'Imagen 4 Ultra Generate',
    'gemini-2.5-flash-native-audio-dialog': 'Gemini 2.5 Flash Native Audio Dialog',
    'gemini-3-flash-live': 'Gemini 3 Flash Live',
    'gemini-3.5-live-translate': 'Gemini 3.5 Live Translate',
    'deep-research-pro-preview-map-grounding': 'Deep Research Pro Preview (Map Grounding)',
    'gemini-2-flash-map-grounding': 'Gemini 2 Flash (Map Grounding)',
    'gemini-2.0-flash-map-grounding': 'Gemini 2.0 Flash (Map Grounding)',
    'computer-use-preview-map-grounding': 'Computer Use Preview (Map Grounding)',
    'gemini-2.5-flash-map-grounding': 'Gemini 2.5 Flash (Map Grounding)',
    'gemini-2.5-flash-lite-map-grounding': 'Gemini 2.5 Flash Lite (Map Grounding)',
    'gemini-3.1-flash-lite-map-grounding': 'Gemini 3.1 Flash Lite (Map Grounding)',
    'gemini-3.1-flash-tts-map-grounding': 'Gemini 3.1 Flash TTS (Map Grounding)',
    'gemini-robotics-er-1.6-preview-map-grounding': 'Gemini Robotics ER 1.6 Preview (Map Grounding)',
    'gemini-2-search-grounding': 'Gemini 2 (Search Grounding)',
    'gemini-2.0-search-grounding': 'Gemini 2.0 (Search Grounding)',
    'gemini-2.5-search-grounding': 'Gemini 2.5 (Search Grounding)',
    'default-search-grounding': 'Default (Search Grounding)',
    'google-tts': 'Google Text-to-Speech (Fallback)',
    'google-tts-chirp3-hd': 'Google TTS Chirp 3: HD',
    'google-tts-wavenet': 'Google TTS WaveNet',
    'google-tts-studio': 'Google TTS Studio',
    'google-tts-standard': 'Google TTS Standard',
    'google-tts-neural2': 'Google TTS Neural2',
    'google-tts-polyglot': 'Google TTS Polyglot (Preview)',
    'openai-tts': 'OpenAI Text-to-Speech',
};

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
    quotaLimitsMap,
    getQuotaSnapshot,
    onQuotaLimitsForPoolChange,
    onResetPoolLimits,
    onResetAllPoolLimits,
    bgThrottlePercent,
    onBgThrottlePercentChange,
    fgRpdHeadroom,
    onFgRpdHeadroomChange,
    pauseAllGenAI,
    onPauseAllGenAIChange,
    meters,
    preEmbedLibrary,
    onPreEmbedLibraryChange,
    shareAiCaches,
    onShareAiCachesChange
}) => {
    const contentTypes: ContentType[] = ['reference'];

    const [searchQuery, setSearchQuery] = React.useState('');
    const [, setTick] = React.useState(0);
    const [showPreEmbedDetails, setShowPreEmbedDetails] = React.useState(false);
    const [showShareCachesDetails, setShowShareCachesDetails] = React.useState(false);

    // Setup 1s interval to poll the live usage snapshots from the governor
    React.useEffect(() => {
        const timer = setInterval(() => {
            setTick((t) => t + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Modal state for editing a specific rate limit pool
    const [editingPoolKey, setEditingPoolKey] = React.useState<string | null>(null);
    const [editRpm, setEditRpm] = React.useState<number>(0);
    const [editTpm, setEditTpm] = React.useState<number>(0);
    const [editRpd, setEditRpd] = React.useState<number>(0);

    const handleStartEdit = (poolKey: string, currentLimits: QuotaLimits) => {
        setEditingPoolKey(poolKey);
        setEditRpm(currentLimits.rpm);
        setEditTpm(currentLimits.tpm);
        setEditRpd(currentLimits.rpd);
    };

    const handleCancelEdit = () => {
        setEditingPoolKey(null);
    };

    const handleResetEditToDefault = () => {
        if (!editingPoolKey) return;
        onResetPoolLimits(editingPoolKey);
        setEditingPoolKey(null);
    };

    const handleSaveEdit = () => {
        if (!editingPoolKey) return;
        onQuotaLimitsForPoolChange(editingPoolKey, {
            rpm: editRpm,
            tpm: editTpm,
            rpd: editRpd,
        });
        setEditingPoolKey(null);
    };

    // Helper to extract usage and limits for a specific pool key
    const getPoolUsageAndLimits = (poolKey: string) => {
        const limits = quotaLimitsMap[poolKey] ??
                       DEFAULT_QUOTA_LIMITS[poolKey] ??
                       quotaLimitsMap['default'] ??
                       { rpm: 100, tpm: 30000, rpd: 1000 };

        let rpmUsage = 0;
        let tpmUsage = 0;
        let rpdUsage = 0;

        if (getQuotaSnapshot) {
            try {
                const snap = getQuotaSnapshot(poolKey);
                if (snap) {
                    rpmUsage = snap.fg.rpm + snap.bg.rpm;
                    tpmUsage = snap.fg.tpm + snap.bg.tpm;
                    rpdUsage = snap.fg.rpd;
                }
            } catch (_e) {
                // ignore
            }
        }

        return {
            limits,
            usage: { rpm: rpmUsage, tpm: tpmUsage, rpd: rpdUsage }
        };
    };

    // Filter and sort pools based on search query and usage
    const filteredPools = Object.entries(RATE_POOL_LABELS)
        .filter(([key, label]) => {
            const query = searchQuery.toLowerCase();
            return label.toLowerCase().includes(query) || key.toLowerCase().includes(query);
        })
        .map(([key, label]) => {
            const { limits, usage } = getPoolUsageAndLimits(key);
            const hasUsage = usage.rpm > 0 || usage.tpm > 0 || usage.rpd > 0;
            return { key, label, limits, usage, hasUsage };
        })
        .sort((a, b) => {
            if (a.hasUsage && !b.hasUsage) return -1;
            if (!a.hasUsage && b.hasUsage) return 1;
            return 0; // preserve original relative order
        });

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
                                        Maximizes free quota by trying premium models (gemini-3.5-flash, gemini-3-flash-preview) first, then falling back to gemini-3.1-flash-lite when their daily quota is exhausted.
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

                                <div className="flex items-center justify-between border-b pb-2">
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

                                <div className="space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="relative flex-1 max-w-sm">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                id="genai-search-pools"
                                                type="search"
                                                placeholder="Search rate limit pools..."
                                                className="pl-9 h-9 text-xs"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                            />
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={onResetAllPoolLimits}
                                            className="text-xs h-9 px-3"
                                        >
                                            Reset All Pools to Defaults
                                        </Button>
                                    </div>

                                    <div className="border rounded-md overflow-hidden">
                                        <ScrollArea className="h-[280px] w-full">
                                            <table className="w-full text-xs text-left border-collapse">
                                                <thead className="sticky top-0 bg-background border-b z-10">
                                                    <tr className="text-muted-foreground">
                                                        <th className="p-2 sm:p-3 font-medium">Pool Name</th>
                                                        <th className="p-2 sm:p-3 font-medium text-right font-semibold">Reqs / min</th>
                                                        <th className="p-2 sm:p-3 font-medium text-right font-semibold">Tokens / min</th>
                                                        <th className="p-2 sm:p-3 font-medium text-right font-semibold">Reqs / day</th>
                                                        {/* Collapsed on narrow screens (the table would overflow with no
                                                            horizontal scroll); rows are tappable there instead. */}
                                                        <th className="hidden sm:table-cell p-3 font-medium text-center">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y">
                                                    {filteredPools.map(({ key: poolKey, label, limits, usage }) => {
                                                        return (
                                                            <tr
                                                                key={poolKey}
                                                                className="hover:bg-muted/50 transition-colors cursor-pointer"
                                                                // The whole row opens the edit dialog — on mobile the
                                                                // Actions column is hidden, so a tap on the row is THE
                                                                // way to edit a pool's limits there.
                                                                onClick={() => handleStartEdit(poolKey, limits)}
                                                                aria-label={`Edit limits for ${label}`}
                                                            >
                                                                <td className="p-2 sm:p-3">
                                                                    <div>{label}</div>
                                                                    <div className="text-[10px] text-muted-foreground font-mono">{poolKey}</div>
                                                                </td>
                                                                <td className="p-2 sm:p-3 text-right font-mono">
                                                                    <span className={usage.rpm > 0 ? "text-primary font-semibold" : "text-muted-foreground"}>
                                                                        {usage.rpm}
                                                                    </span>
                                                                    <span className="text-muted-foreground/60 mx-1">/</span>
                                                                    <span>{formatNumber(limits.rpm)}</span>
                                                                </td>
                                                                <td className="p-2 sm:p-3 text-right font-mono">
                                                                    <span className={usage.tpm > 0 ? "text-primary font-semibold" : "text-muted-foreground"}>
                                                                        {formatNumber(usage.tpm)}
                                                                    </span>
                                                                    <span className="text-muted-foreground/60 mx-1">/</span>
                                                                    <span>{formatNumber(limits.tpm)}</span>
                                                                </td>
                                                                <td className="p-2 sm:p-3 text-right font-mono">
                                                                    <span className={usage.rpd > 0 ? "text-primary font-semibold" : "text-muted-foreground"}>
                                                                        {formatNumber(usage.rpd)}
                                                                    </span>
                                                                    <span className="text-muted-foreground/60 mx-1">/</span>
                                                                    <span>{formatNumber(limits.rpd)}</span>
                                                                </td>
                                                                <td className="hidden sm:table-cell p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="h-7 px-2 text-xs"
                                                                        onClick={() => handleStartEdit(poolKey, limits)}
                                                                    >
                                                                        <Edit2 className="h-3 w-3 mr-1" />
                                                                        Edit
                                                                    </Button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {filteredPools.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                                                No rate limit pools found matching your search.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </ScrollArea>
                                    </div>
                                </div>


                                {editingPoolKey && (
                                    <Dialog
                                        isOpen={true}
                                        onClose={handleCancelEdit}
                                        title={`Edit Limits: ${RATE_POOL_LABELS[editingPoolKey] || editingPoolKey}`}
                                        description="Configure individual rate and token limit thresholds for this pool."
                                        footer={
                                            <div className="flex flex-col-reverse sm:flex-row justify-between w-full gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleResetEditToDefault}
                                                    className="text-xs"
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                                    Reset to Default
                                                </Button>
                                                <div className="flex gap-2 justify-end">
                                                    <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                                                        Cancel
                                                    </Button>
                                                    <Button size="sm" onClick={handleSaveEdit}>
                                                        Save Changes
                                                    </Button>
                                                </div>
                                            </div>
                                        }
                                    >
                                        <div className="space-y-4 py-2">
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-quota-rpm" className="text-xs">Requests / min</Label>
                                                <Input
                                                    id="edit-quota-rpm"
                                                    type="number"
                                                    min={0}
                                                    value={editRpm}
                                                    onChange={(e) => setEditRpm(parseInt(e.target.value) || 0)}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-quota-tpm" className="text-xs">Tokens / min</Label>
                                                <Input
                                                    id="edit-quota-tpm"
                                                    type="number"
                                                    min={0}
                                                    value={editTpm}
                                                    onChange={(e) => setEditTpm(parseInt(e.target.value) || 0)}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-quota-rpd" className="text-xs">Requests / day</Label>
                                                <Input
                                                    id="edit-quota-rpd"
                                                    type="number"
                                                    min={0}
                                                    value={editRpd}
                                                    onChange={(e) => setEditRpd(parseInt(e.target.value) || 0)}
                                                />
                                            </div>
                                        </div>
                                    </Dialog>
                                )}

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
                                    <h5 className="text-sm font-medium">Overall AI & TTS Live Status</h5>
                                    <div className="p-3 border rounded-md bg-muted/30 space-y-2.5 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium text-muted-foreground">Active Pools</span>
                                            <span className="font-semibold text-primary text-right max-w-[70%] truncate">
                                                {meters.activePools && meters.activePools.length > 0
                                                    ? meters.activePools.map(key => RATE_POOL_LABELS[key] || key).join(', ')
                                                    : 'None'}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-muted">
                                            <div className="space-y-1">
                                                <div className="text-muted-foreground text-[10px] uppercase font-semibold tracking-wider">Project Daily Spend</div>
                                                <div className="font-mono text-foreground font-semibold" data-testid="genai-project-rpd">
                                                    {meters.projectRpd} requests <span className="text-[10px] font-normal text-muted-foreground">(all devices, all pools)</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-muted-foreground text-[10px] uppercase font-semibold tracking-wider">Time to Exhaustion</div>
                                                <div className="font-mono text-foreground space-x-2">
                                                    <span>RPM: <span className="font-semibold">{formatEtaWithPool(meters.etas.rpmMs, meters.etas.rpmPool)}</span></span>
                                                    <span className="text-muted-foreground">|</span>
                                                    <span>TPM: <span className="font-semibold">{formatEtaWithPool(meters.etas.tpmMs, meters.etas.tpmPool)}</span></span>
                                                    <span className="text-muted-foreground">|</span>
                                                    <span>RPD: <span className="font-semibold">{formatEtaWithPool(meters.etas.rpdMs, meters.etas.rpdPool)}</span></span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="pt-1 border-t border-muted flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-muted-foreground gap-1">
                                            <div>
                                                <span className="font-medium">Foreground:</span> {meters.fg.rpm} RPM, {formatNumber(meters.fg.tpm)} TPM, {meters.fg.rpd} RPD
                                            </div>
                                            <div className="hidden sm:block text-muted-foreground/45">|</div>
                                            <div>
                                                <span className="font-medium">Background:</span> {meters.bg.rpm} RPM, {formatNumber(meters.bg.tpm)} TPM, {meters.bg.rpd} RPD
                                            </div>
                                        </div>
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

                                <div className="space-y-2 border-b pb-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5 max-w-md">
                                            <label htmlFor="genai-preembed" className="text-sm font-medium">
                                                Pre-embed my library for semantic search
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                Allows background embedding of books to enable searching passages by meaning.
                                            </p>
                                        </div>
                                        <Switch
                                            id="genai-preembed"
                                            checked={preEmbedLibrary}
                                            onCheckedChange={onPreEmbedLibraryChange}
                                        />
                                    </div>
                                    <div className="pl-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setShowPreEmbedDetails(!showPreEmbedDetails)}
                                            className="inline-flex items-center text-xs text-primary/80 hover:text-primary transition-colors focus:outline-none cursor-pointer"
                                        >
                                            <span>{showPreEmbedDetails ? 'Show less' : 'Learn more...'}</span>
                                            {showPreEmbedDetails ? (
                                                <ChevronUp className="ml-1 h-3.5 w-3.5" />
                                            ) : (
                                                <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                            )}
                                        </button>
                                        <p className={`text-xs text-muted-foreground mt-2 bg-muted/30 border border-muted p-3 rounded-md max-w-md ${showPreEmbedDetails ? 'block' : 'hidden'}`}>
                                            When ON, the <strong>full text</strong> of every book on this device
                                            is sent to Google during idle time to build search
                                            embeddings, and your <strong>search query terms</strong> leave the
                                            device to Google whenever you run a semantic search. This is broader
                                            than the per-book TTS consent, which only sends short excerpts to
                                            improve audio narration. Default OFF — nothing is pre-embedded unless
                                            you turn this on.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5 max-w-md">
                                            <label htmlFor="genai-share-ai-caches" className="text-sm font-medium">
                                                Share AI caches across my devices
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                Syncs built embeddings to your private cloud to reuse across devices without spending quota.
                                            </p>
                                        </div>
                                        <Switch
                                            id="genai-share-ai-caches"
                                            checked={shareAiCaches}
                                            onCheckedChange={onShareAiCachesChange}
                                        />
                                    </div>
                                    <div className="pl-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setShowShareCachesDetails(!showShareCachesDetails)}
                                            className="inline-flex items-center text-xs text-primary/80 hover:text-primary transition-colors focus:outline-none cursor-pointer"
                                        >
                                            <span>{showShareCachesDetails ? 'Show less' : 'Learn more...'}</span>
                                            {showShareCachesDetails ? (
                                                <ChevronUp className="ml-1 h-3.5 w-3.5" />
                                            ) : (
                                                <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                            )}
                                        </button>
                                        <p className={`text-xs text-muted-foreground mt-2 bg-muted/30 border border-muted p-3 rounded-md max-w-md ${showShareCachesDetails ? 'block' : 'hidden'}`}>
                                            When ON, the <strong>whole-book embeddings</strong> a device builds
                                            (the full-corpus search vectors, roughly ~251&nbsp;KB per book — far
                                            heavier than the small annotation/progress data normal sync uploads)
                                            are uploaded to <strong>your own cloud</strong>, so your other devices
                                            can <strong>hydrate them without re-spending Gemini quota</strong>.
                                            Nothing is shared with anyone else — the cache lands only in your own
                                            Firebase project, content-addressed by the book and embedding stamp.
                                            Default OFF — no embeddings leave the device unless you turn this on.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
