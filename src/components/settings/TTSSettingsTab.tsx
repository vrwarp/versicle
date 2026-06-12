import React, { useState } from 'react';
import { Label } from '../ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { PasswordInput } from '../ui/PasswordInput';
import { Slider } from '../ui/Slider';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Progress } from '../ui/Progress';
import { Trash2 } from 'lucide-react';
import type { TTSVoice } from '@lib/tts/providers/types';
import {
    selectableProviders,
    type ProviderOption,
    type TTSProviderId,
    type TTSApiKeyProviderId,
} from '@lib/tts/providers/registry';
import { getDefaultMinSentenceLength } from '@store/useTTSSettingsStore';

// Re-export TTSVoice + the registry-derived id unions for consumers
export type { TTSVoice };
export type { TTSProviderId, TTSApiKeyProviderId };
/** @deprecated Renamed — use {@link TTSApiKeyProviderId} (registry-derived). */
export type TTSApiKeyProvider = TTSApiKeyProviderId;
export type BackgroundAudioMode = 'silence' | 'noise' | 'off';

export interface TTSSettingsTabProps {
    /** Currently active language profile (from store, driven by book context) */
    activeLanguage: string;
    /** All TTS profiles for language context */
    profiles: Record<string, import('@store/useTTSSettingsStore').TTSProfile>;
    // Provider
    providerId: TTSProviderId;
    onProviderChange: (providerId: TTSProviderId) => void;
    // API Keys — committed on blur / "Test Key", never per keystroke (5a buffered edits)
    apiKeys: Record<string, string>;
    onApiKeyChange: (provider: TTSApiKeyProviderId, key: string) => void;
    /** Explicit "Test Key" action: verify the (buffered) key by probing the provider. */
    onTestApiKey?: (provider: TTSApiKeyProviderId, key: string) => void;
    // Background Audio
    backgroundAudioMode: BackgroundAudioMode;
    onBackgroundAudioModeChange: (mode: BackgroundAudioMode) => void;
    whiteNoiseVolume: number;
    onWhiteNoiseVolumeChange: (volume: number) => void;
    // Voice (Piper)
    voice: TTSVoice | null;
    voices: TTSVoice[];
    onVoiceChange: (voice: TTSVoice | null, lang?: string) => void;
    isVoiceReady: boolean;
    isDownloading: boolean;
    downloadProgress: number;
    downloadStatus: string | null;
    onDownloadVoice: (voiceId: string) => void;
    onDeleteVoice: (voiceId: string) => void;
    // Text Processing
    onMinSentenceLengthChange: (length: number, lang: string) => void;
}

/**
 * One buffered API-key editor. Keystrokes only touch local state — the key is
 * committed (and the provider rebuilt) on blur or via the explicit "Test Key"
 * button. This kills the per-keystroke provider rebuild (S10/D5): typing an API
 * key constructs nothing.
 */
const ApiKeyField: React.FC<{
    option: ProviderOption & { id: TTSApiKeyProviderId };
    value: string;
    onCommit: (provider: TTSApiKeyProviderId, key: string) => void;
    onTest?: (provider: TTSApiKeyProviderId, key: string) => void;
}> = ({ option, value, onCommit, onTest }) => {
    const [draft, setDraft] = useState(value);

    const commit = () => {
        if (draft !== value) {
            onCommit(option.id, draft);
        }
    };

    return (
        <div className="space-y-2">
            <Label htmlFor={`tts-${option.id}-key`}>{option.apiKeyLabel}</Label>
            <div className="flex gap-2">
                <div className="flex-1">
                    <PasswordInput
                        id={`tts-${option.id}-key`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                    />
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    data-testid={`tts-${option.id}-test-key`}
                    onClick={() => {
                        commit();
                        onTest?.(option.id, draft);
                    }}
                >
                    Test Key
                </Button>
            </div>
        </div>
    );
};

export const TTSSettingsTab: React.FC<TTSSettingsTabProps> = ({
    activeLanguage = 'en',
    profiles = {},
    providerId,
    onProviderChange,
    apiKeys,
    onApiKeyChange,
    onTestApiKey,
    backgroundAudioMode,
    onBackgroundAudioModeChange,
    whiteNoiseVolume,
    onWhiteNoiseVolumeChange,
    voice: _voice,
    voices,
    onVoiceChange,
    isVoiceReady,
    isDownloading,
    downloadProgress,
    downloadStatus,
    onDownloadVoice,
    onDeleteVoice,
    onMinSentenceLengthChange
}) => {
    // Local-only language state for configuration view. Changing this does NOT
    // affect the active playback profile — that is always set by the open book's language.
    const [configLanguage, setConfigLanguage] = useState(activeLanguage);

    // The provider choices and API-key fields render from the registry — the single
    // source of truth (no re-declared aliases or hardcoded items in this component).
    const providerOptions = selectableProviders();
    const activeOption = providerOptions.find(o => o.id === providerId);

    // Derive the voice for the currently viewed config language from the profiles.
    // Fall back to the legacy 'voice' prop if we are looking at the active language
    // and no specific profile exists yet.
    const configProfile = profiles?.[configLanguage];
    const configVoiceId = configProfile?.voiceId || (configLanguage === activeLanguage ? _voice?.id : null);
    const configVoice = configVoiceId ? voices.find(v => v.id === configVoiceId) || null : null;

    const currentMinSentenceLength = configProfile?.minSentenceLength ?? getDefaultMinSentenceLength(configLanguage);

    const [voiceToDelete, setVoiceToDelete] = useState<string | null>(null);

    const handleConfirmDelete = () => {
        if (voiceToDelete) {
            onDeleteVoice(voiceToDelete);
            setVoiceToDelete(null);
        }
    };

    const getVoiceName = (id: string) => {
        return voices.find(v => v.id === id)?.name || 'Unknown Voice';
    };

    return (
        <div className="space-y-6">
            <div className="space-y-2 mb-6">
                <Label htmlFor="tts-language-select" className="text-sm font-medium">Language Profile</Label>
                <Select value={configLanguage} onValueChange={setConfigLanguage}>
                    <SelectTrigger id="tts-language-select" data-testid="tts-language-select">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="zh">Chinese (Mandarin)</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div>
                <h3 className="text-lg font-medium mb-4">Provider Configuration</h3>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="tts-provider-select" className="text-sm font-medium">Active Provider</Label>
                        <Select value={providerId} onValueChange={onProviderChange}>
                            <SelectTrigger id="tts-provider-select" data-testid="tts-provider-select" aria-label="Select TTS provider"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {providerOptions.map(option => (
                                    <SelectItem key={option.id} value={option.id}>{option.displayName}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-4 pt-4 border-t">
                        <div className="space-y-1">
                            <h4 className="text-sm font-medium">Background Audio & Keep-Alive</h4>
                            <p className="text-xs text-muted-foreground">
                                Prevents playback from stopping when the screen is locked.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="tts-mode-select" className="text-sm font-medium">Mode</Label>
                            <Select value={backgroundAudioMode} onValueChange={onBackgroundAudioModeChange}>
                                <SelectTrigger id="tts-mode-select" aria-label="Select background audio mode"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="silence">Silence (Default)</SelectItem>
                                    <SelectItem value="noise">White Noise</SelectItem>
                                    <SelectItem value="off">Off (Save Battery)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {backgroundAudioMode === 'noise' && (
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <div id="white-noise-label" className="text-sm font-medium">White Noise Volume</div>
                                    <span className="text-sm text-muted-foreground" role="status" aria-live="polite">{Math.round(whiteNoiseVolume * 100)}%</span>
                                </div>
                                <Slider
                                    aria-labelledby="white-noise-label"
                                    value={[whiteNoiseVolume]}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    onValueChange={(vals) => onWhiteNoiseVolumeChange(vals[0])}
                                />
                            </div>
                        )}
                    </div>

                    {activeOption?.capabilities.downloadableVoices && (
                        <div className="space-y-4 pt-4 border-t">
                            <div className="space-y-2">
                                <Label htmlFor="tts-voice-select" className="text-sm font-medium">Select Voice</Label>
                                <Select value={configVoice?.id} onValueChange={(val) => {
                                    const v = voices.find(v => v.id === val);
                                    onVoiceChange(v || null, configLanguage);
                                }}>
                                    <SelectTrigger id="tts-voice-select" aria-label="Select voice"><SelectValue placeholder="Select a voice" /></SelectTrigger>
                                    <SelectContent>
                                        {voices.filter(v => v.lang?.startsWith(configLanguage)).map(v => (
                                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {configLanguage === 'zh' && voices.filter(v => v.lang?.startsWith('zh')).length === 0 && (
                                    <div data-testid="mandarin-voice-warning" className="p-3 bg-warning/10 border border-warning/30 rounded-md text-sm text-warning mt-2">
                                        ⚠️ No Mandarin voice installed. Audio playback will fail for Chinese books.
                                    </div>
                                )}
                            </div>

                            {configVoice && (
                                <div className="space-y-3 p-3 bg-muted/50 rounded-md">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">Voice Data</span>
                                            <span className="text-xs text-muted-foreground">
                                                {isVoiceReady ? "Downloaded" : "Not Downloaded"}
                                            </span>
                                        </div>

                                        {isDownloading ? (
                                            <div className="space-y-2">
                                                <div className="flex justify-between text-xs">
                                                    <span>{downloadStatus}</span>
                                                    <span>{Math.round(downloadProgress)}%</span>
                                                </div>
                                                <Progress value={downloadProgress} className="w-full" aria-label="Voice download progress" />
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => configVoice && onDownloadVoice(configVoice.id)}
                                                    variant={isVoiceReady ? "outline" : "default"}
                                                    disabled={isVoiceReady}
                                                    size="sm"
                                                    className="flex-1"
                                                >
                                                    {isVoiceReady ? "Ready to Use" : "Download Voice Data"}
                                                </Button>
                                                {isVoiceReady && (
                                                    <Button
                                                        onClick={() => configVoice && setVoiceToDelete(configVoice.id)}
                                                        variant="destructive"
                                                        size="icon"
                                                        title="Delete Voice Data"
                                                        aria-label="Delete Voice Data"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeOption?.requiresApiKey && (
                        <ApiKeyField
                            key={activeOption.id}
                            option={activeOption as ProviderOption & { id: TTSApiKeyProviderId }}
                            value={apiKeys[activeOption.id] || ''}
                            onCommit={onApiKeyChange}
                            onTest={onTestApiKey}
                        />
                    )}

                    <div className="pt-4 border-t space-y-4">
                        <h4 className="text-sm font-medium">Text Processing</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <div className="space-y-0.5">
                                    <div id="min-sentence-label" className="text-sm font-medium">Minimum Sentence Length</div>
                                    <p id="min-sentence-desc" className="text-xs text-muted-foreground">
                                        Sentences shorter than this will be merged with adjacent ones.
                                    </p>
                                </div>
                                <span className="text-sm text-muted-foreground" role="status" aria-live="polite">{currentMinSentenceLength} chars</span>
                            </div>
                            <Slider
                                aria-labelledby="min-sentence-label"
                                aria-describedby="min-sentence-desc"
                                value={[currentMinSentenceLength]}
                                min={0}
                                max={120}
                                step={6}
                                onValueChange={(vals) => onMinSentenceLengthChange(vals[0], configLanguage)}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <Dialog
                isOpen={!!voiceToDelete}
                onClose={() => setVoiceToDelete(null)}
                title="Delete Voice Data"
                description={`Are you sure you want to delete the voice data for "${voiceToDelete ? getVoiceName(voiceToDelete) : ''}"? You will need to download it again to use it offline.`}
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setVoiceToDelete(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={handleConfirmDelete}
                            data-testid="confirm-delete-voice"
                        >
                            Delete
                        </Button>
                    </>
                }
            />
        </div>
    );
};
