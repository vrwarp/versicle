import { useState, useEffect } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { SheetContent, SheetHeader, SheetTitle } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Slider } from '../ui/Slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Badge } from '../ui/Badge';
import { Switch } from '../ui/Switch';
import { TTSQueue } from './TTSQueue';
import { Play, Pause, RotateCcw, RotateCw, Mic, RefreshCw } from 'lucide-react';
import { LexiconManager } from './LexiconManager';

/**
 * A comprehensive panel for controlling Text-to-Speech playback and settings.
 * Includes playback controls, queue visualization, and configuration options
 * like speed, voice selection, and pronunciation rules.
 *
 * @returns A React component rendering the audio panel.
 */
export const UnifiedAudioPanel = () => {
  const {
    isPlaying,
    play,
    pause,
    rate,
    setRate,
    voice,
    setVoice,
    voices,
    loadVoices,
    seek,
    providerId,
    sanitizationEnabled,
    setSanitizationEnabled,
    prerollEnabled,
    setPrerollEnabled
  } = useTTSStore();

  const [view, setView] = useState<'queue' | 'settings'>('queue');
  const [isLexiconOpen, setIsLexiconOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load voices when switching to settings view if empty
  useEffect(() => {
     if (view === 'settings' && voices.length === 0) {
         loadVoices();
     }
  }, [view, voices.length, loadVoices]);

  // Helper for voice selection
  const handleVoiceChange = (voiceId: string) => {
      if (voiceId === 'default') {
          setVoice(null);
          return;
      }
      const selected = voices.find(v => v.id === voiceId);
      setVoice(selected || null);
  };

  const handleRefreshVoices = async () => {
      setIsRefreshing(true);
      await loadVoices();
      setIsRefreshing(false);
  };

  return (
    <SheetContent side="right" className="w-full sm:w-[400px] flex flex-col p-0 gap-0" data-testid="tts-panel">
       <SheetHeader className="p-4 border-b">
         <SheetTitle>Audio Deck</SheetTitle>
       </SheetHeader>

       {/* Stage */}
       <div className="player-stage bg-muted/30 p-4 border-b">
          {/* Main Controls */}
          <div className="flex justify-center items-center gap-6 mb-4">
             <Button variant="ghost" size="icon" onClick={() => seek(-15)} disabled={providerId === 'local'} aria-label="Rewind 15s">
                <RotateCcw className="h-6 w-6" />
             </Button>
             <Button data-testid="tts-play-pause-button" size="icon" className="h-12 w-12 rounded-full" onClick={isPlaying ? pause : play} aria-label={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
             </Button>
             <Button variant="ghost" size="icon" onClick={() => seek(15)} disabled={providerId === 'local'} aria-label="Forward 15s">
                <RotateCw className="h-6 w-6" />
             </Button>
          </div>

          {/* Quick Toggles */}
          <div className="flex justify-center gap-4">
             <Badge variant="outline" className="cursor-pointer" onClick={() => setView('settings')}>
                {rate}x
             </Badge>
             <Badge variant="outline" className="cursor-pointer truncate max-w-[150px]" onClick={() => setView('settings')}>
                {voice?.name || 'Default Voice'}
             </Badge>
          </div>
       </div>

       {/* Content */}
       <div className="flex-1 min-h-0 flex flex-col">
         {view === 'queue' ? (
            <TTSQueue />
         ) : (
           <div className="p-6 space-y-8 flex-1 overflow-y-auto">
              <section className="space-y-4">
                 <h3 className="text-sm font-medium text-muted-foreground">Voice & Pace</h3>
                 <div className="space-y-2">
                    <label className="text-sm font-medium">Speed ({rate}x)</label>
                    <Slider
                       value={[rate]}
                       min={0.5}
                       max={3.0}
                       step={0.1}
                       onValueChange={(val) => setRate(val[0])}
                    />
                 </div>
                 <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">Voice</label>
                        <Button
                             variant="ghost"
                             size="sm"
                             className="h-6 px-2 text-xs"
                             onClick={handleRefreshVoices}
                             disabled={isRefreshing}
                             title="Refresh Voice List"
                        >
                             <RefreshCw className={`h-3 w-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
                             Refresh
                        </Button>
                    </div>
                    <Select value={voice?.id || 'default'} onValueChange={handleVoiceChange}>
                       <SelectTrigger><SelectValue placeholder="Select Voice" /></SelectTrigger>
                       <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          {voices.map(v => (
                              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                          ))}
                       </SelectContent>
                    </Select>
                 </div>
              </section>

              <section className="space-y-4">
                 <h3 className="text-sm font-medium text-muted-foreground">Flow Control</h3>
                 <div className="flex items-center justify-between">
                    <label className="text-sm">Skip URLs & Citations</label>
                    <Switch checked={sanitizationEnabled} onCheckedChange={setSanitizationEnabled} />
                 </div>
                 <div className="flex items-center justify-between">
                    <label className="text-sm">Announce Chapter Titles</label>
                    <Switch checked={prerollEnabled} onCheckedChange={setPrerollEnabled} />
                 </div>
              </section>

              <section className="pt-4 border-t">
                 <Button variant="outline" className="w-full" onClick={() => setIsLexiconOpen(true)}>
                    <Mic className="mr-2 h-4 w-4" />
                    Manage Pronunciation Rules
                 </Button>
              </section>
           </div>
         )}
       </div>

       {/* Footer Toggle */}
       <div className="border-t p-2 grid grid-cols-2 gap-2 bg-background">
          <Button
             variant={view === 'queue' ? 'default' : 'ghost'}
             onClick={() => setView('queue')}
             size="sm"
          >
             Up Next
          </Button>
          <Button
             variant={view === 'settings' ? 'default' : 'ghost'}
             onClick={() => setView('settings')}
             size="sm"
          >
             Settings
          </Button>
       </div>

       <LexiconManager open={isLexiconOpen} onOpenChange={setIsLexiconOpen} />
    </SheetContent>
  );
};
