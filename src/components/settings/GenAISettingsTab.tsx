import React from 'react';
import { Label } from '../ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Download } from 'lucide-react';
import type { ContentType } from '../../types/content-analysis';

export interface GenAILog {
    id: string;
    timestamp: number;
    type: string;
    method: string;
    payload: unknown;
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
    onDownloadLogs: () => void;
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
    onDownloadLogs
}) => {
    const contentTypes: ContentType[] = ['footnote', 'table', 'other', 'title', 'main'];

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
                                <Input
                                    id="genai-api-key"
                                    type="password"
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
                                    <SelectTrigger id="genai-model-select"><SelectValue /></SelectTrigger>
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

                                            <div className="pt-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <label htmlFor="genai-debug" className="text-sm font-medium">Enable Content Analysis Debugging</label>
                                                        <p className="text-xs text-muted-foreground">
                                                            Highlights content based on its detected type.
                                                        </p>
                                                    </div>
                                                    <Switch
                                                        id="genai-debug"
                                                        checked={isDebugModeEnabled}
                                                        onCheckedChange={onDebugModeChange}
                                                    />
                                                </div>
                                            </div>

                                            <div className="pt-2">
                                                <Button variant="outline" size="sm" onClick={onClearContentAnalysis}>
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
                                </div>
                            </div>

                            <div className="pt-4 border-t space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium">Debug Logs</h4>
                                    <Button variant="outline" size="sm" onClick={onDownloadLogs} disabled={logs.length === 0}>
                                        <Download className="h-4 w-4 mr-2" />
                                        Download Logs
                                    </Button>
                                </div>
                                <div className="bg-muted p-2 rounded-md h-40 overflow-y-auto font-mono text-xs">
                                    {logs.length === 0 ? (
                                        <span className="text-muted-foreground">No logs available.</span>
                                    ) : (
                                        logs.slice().reverse().map(log => (
                                            <div key={log.id} className="mb-2 border-b last:border-0 pb-2">
                                                <div className="font-semibold text-primary">
                                                    [{new Date(log.timestamp).toLocaleTimeString()}] {log.type.toUpperCase()} - {log.method}
                                                </div>
                                                <div className="whitespace-pre-wrap truncate line-clamp-2">
                                                    {JSON.stringify(log.payload)}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
