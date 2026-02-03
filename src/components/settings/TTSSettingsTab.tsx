import React from 'react';
import { Label } from '../ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Input } from '../ui/Input';
import { Slider } from '../ui/Slider';
import { Button } from '../ui/Button';
import { Trash2 } from 'lucide-react';
import type { TTSVoice } from '../../lib/tts/providers/types';

// Re-export TTSVoice for consumers
export type { TTSVoice };

// Type aliases matching the store types
export type TTSProviderId = 'local' | 'google' | 'openai' | 'lemonfox' | 'piper';
export type TTSApiKeyProvider = 'google' | 'openai' | 'lemonfox';
export type BackgroundAudioMode = 'silence' | 'noise' | 'off';

export interface TTSSettingsTabProps {
    // Provider
    providerId: TTSProviderId;
    onProviderChange: (providerId: TTSProviderId) => void;
    // API Keys
    apiKeys: Record<string, string>;
    onApiKeyChange: (provider: TTSApiKeyProvider, key: string) => void;
    // Background Audio
    backgroundAudioMode: BackgroundAudioMode;
    onBackgroundAudioModeChange: (mode: BackgroundAudioMode) => void;
    whiteNoiseVolume: number;
    onWhiteNoiseVolumeChange: (volume: number) => void;
    // Voice (Piper)
    voice: TTSVoice | null;
    voices: TTSVoice[];
    onVoiceChange: (voice: TTSVoice | null) => void;
    isVoiceReady: boolean;
    isDownloading: boolean;
    downloadProgress: number;
    downloadStatus: string | null;
    onDownloadVoice: (voiceId: string) => void;
    onDeleteVoice: (voiceId: string) => void;
    // Text Processing
    minSentenceLength: number;
    onMinSentenceLengthChange: (length: number) => void;
}

export const TTSSettingsTab: React.FC<TTSSettingsTabProps> = ({
    providerId,
    onProviderChange,
    apiKeys,
    onApiKeyChange,
    backgroundAudioMode,
    onBackgroundAudioModeChange,
    whiteNoiseVolume,
    onWhiteNoiseVolumeChange,
    voice,
    voices,
    onVoiceChange,
    isVoiceReady,
    isDownloading,
    downloadProgress,
    downloadStatus,
    onDownloadVoice,
    onDeleteVoice,
    minSentenceLength,
    onMinSentenceLengthChange
}) => {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium mb-4">Provider Configuration</h3>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="tts-provider-select" className="text-sm font-medium">Active Provider</Label>
                        <Select value={providerId} onValueChange={onProviderChange}>
                            <SelectTrigger id="tts-provider-select" data-testid="tts-provider-select"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="local">Web Speech (Local)</SelectItem>
                                <SelectItem value="piper">Piper (High Quality Local)</SelectItem>
                                <SelectItem value="google">Google Cloud TTS</SelectItem>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="lemonfox">LemonFox.ai</SelectItem>
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
                                <SelectTrigger id="tts-mode-select"><SelectValue /></SelectTrigger>
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
                                    <span className="text-sm text-muted-foreground">{Math.round(whiteNoiseVolume * 100)}%</span>
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

                    {providerId === 'piper' && (
                        <div className="space-y-4 pt-4 border-t">
                            <div className="space-y-2">
                                <Label htmlFor="tts-voice-select" className="text-sm font-medium">Select Voice</Label>
                                <Select value={voice?.id} onValueChange={(val) => {
                                    const v = voices.find(v => v.id === val);
                                    onVoiceChange(v || null);
                                }}>
                                    <SelectTrigger id="tts-voice-select"><SelectValue placeholder="Select a voice" /></SelectTrigger>
                                    <SelectContent>
                                        {voices.map(v => (
                                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {voice && (
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
                                                <div className="h-2 bg-secondary rounded overflow-hidden">
                                                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={() => onDownloadVoice(voice.id)}
                                                    variant={isVoiceReady ? "outline" : "default"}
                                                    disabled={isVoiceReady}
                                                    size="sm"
                                                    className="flex-1"
                                                >
                                                    {isVoiceReady ? "Ready to Use" : "Download Voice Data"}
                                                </Button>
                                                {isVoiceReady && (
                                                    <Button
                                                        onClick={() => {
                                                            if (confirm('Delete downloaded voice data?')) {
                                                                onDeleteVoice(voice.id);
                                                            }
                                                        }}
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

                    {providerId === 'google' && (
                        <div className="space-y-2">
                            <Label htmlFor="tts-google-key">Google API Key</Label>
                            <Input
                                id="tts-google-key"
                                type="password"
                                value={apiKeys.google || ''}
                                onChange={(e) => onApiKeyChange('google', e.target.value)}
                            />
                        </div>
                    )}
                    {providerId === 'openai' && (
                        <div className="space-y-2">
                            <Label htmlFor="tts-openai-key">OpenAI API Key</Label>
                            <Input
                                id="tts-openai-key"
                                type="password"
                                value={apiKeys.openai || ''}
                                onChange={(e) => onApiKeyChange('openai', e.target.value)}
                            />
                        </div>
                    )}
                    {providerId === 'lemonfox' && (
                        <div className="space-y-2">
                            <Label htmlFor="tts-lemonfox-key">LemonFox API Key</Label>
                            <Input
                                id="tts-lemonfox-key"
                                type="password"
                                value={apiKeys.lemonfox || ''}
                                onChange={(e) => onApiKeyChange('lemonfox', e.target.value)}
                            />
                        </div>
                    )}

                    <div className="pt-4 border-t space-y-4">
                        <h4 className="text-sm font-medium">Text Processing</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <div className="space-y-0.5">
                                    <div id="min-sentence-label" className="text-sm font-medium">Minimum Sentence Length</div>
                                    <p className="text-xs text-muted-foreground">
                                        Sentences shorter than this will be merged with adjacent ones.
                                    </p>
                                </div>
                                <span className="text-sm text-muted-foreground">{minSentenceLength} chars</span>
                            </div>
                            <Slider
                                aria-labelledby="min-sentence-label"
                                value={[minSentenceLength]}
                                min={0}
                                max={120}
                                step={6}
                                onValueChange={(vals) => onMinSentenceLengthChange(vals[0])}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
