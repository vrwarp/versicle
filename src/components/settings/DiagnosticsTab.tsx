import React, { useState, useEffect } from 'react';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import type { FlightSnapshot } from '~types/db';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ScrollArea } from '../ui/ScrollArea';
import { 
    Activity, 
    Download, 
    Trash2, 
    Camera, 
    AlertTriangle, 
    CheckCircle2,
    Share2,
    RefreshCw,
    Clock,
    FileJson
} from 'lucide-react';

export const DiagnosticsTab: React.FC = () => {
    // The LIVE ring buffer + stats come over the engine handle (5b-PR4, the
    // S9 fix): the engine runs in the worker, whose flight recorder is a
    // DIFFERENT module instance than the main thread's — reading the local
    // singleton showed an empty buffer. Persisted snapshots are shared
    // IndexedDB rows, listed through the same command facade.
    const audio = useAudioCommands();
    const [snapshots, setSnapshots] = useState<Omit<FlightSnapshot, 'eventsJSON'>[]>([]);
    const [stats, setStats] = useState<{ eventCount: number; capacity: number; oldestWall: number | null }>(
        { eventCount: 0, capacity: 0, oldestWall: null });
    const [isCapturing, setIsCapturing] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const loadSnapshots = async () => {
        setIsRefreshing(true);
        const [list, exported] = await Promise.all([
            audio.listDiagnosticSnapshots(),
            audio.exportDiagnostics(),
        ]);
        setSnapshots(list);
        setStats(exported.stats);
        setIsRefreshing(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadSnapshots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleManualSnapshot = async () => {
        setIsCapturing(true);
        await audio.triggerDiagnosticsSnapshot('manual', 'User triggered snapshot');
        await loadSnapshots();
        setIsCapturing(false);
    };

    const handleDeleteSnapshot = async (id: string) => {
        await audio.deleteDiagnosticSnapshot(id);
        await loadSnapshots();
    };

    const handleClearAll = async () => {
        if (confirm('Are you sure you want to delete all diagnostic snapshots?')) {
            await audio.clearDiagnosticSnapshots();
            await loadSnapshots();
        }
    };

    const handleShare = async (id: string) => {
        await audio.shareDiagnosticSnapshot(id);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Header / Buffer Stats */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-muted/50 p-4 rounded-xl border border-border">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg text-primary">
                        <Activity className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-foreground">Active Flight Buffer</h3>
                        <p className="text-sm text-muted-foreground">
                            {stats.eventCount} / {stats.capacity} events tracked 
                            {stats.oldestWall ? ` (since ${new Date(stats.oldestWall).toLocaleTimeString()})` : ''}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={loadSnapshots}
                        disabled={isRefreshing}
                        className="gap-2"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button 
                        variant="default" 
                        size="sm" 
                        onClick={handleManualSnapshot}
                        disabled={isCapturing}
                        className="gap-2"
                    >
                        <Camera className="w-4 h-4" />
                        Capture Snapshot
                    </Button>
                </div>
            </div>

            {/* Saved Snapshots */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Saved Recordings
                        <Badge variant="secondary" className="ml-2">{snapshots.length}</Badge>
                    </h3>
                    {snapshots.length > 0 && (
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={handleClearAll}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                            Clear All
                        </Button>
                    )}
                </div>

                {snapshots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 border-2 border-dashed border-border rounded-2xl text-center">
                        <div className="p-3 bg-muted rounded-full mb-4">
                            <Clock className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <h4 className="text-foreground font-medium mb-1">No recordings found</h4>
                        <p className="text-sm text-muted-foreground max-w-xs">
                            Snapshots are automatically created on anomalies or can be triggered manually.
                        </p>
                    </div>
                ) : (
                    <ScrollArea className="h-[400px] pr-4 -mr-4">
                        <div className="space-y-3">
                            {snapshots.map((snap) => (
                                <div 
                                    key={snap.id} 
                                    className="p-4 bg-background border border-border rounded-xl hover:border-primary/50 transition-colors shadow-sm"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                {snap.trigger.startsWith('anomaly') ? (
                                                    <Badge variant="destructive" className="gap-1 px-1.5 py-0.5">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        ANOMALY
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="gap-1 px-1.5 py-0.5 border-primary/20 text-primary">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        MANUAL
                                                    </Badge>
                                                )}
                                                <span className="text-xs text-muted-foreground font-mono">
                                                    {snap.id.slice(0, 8)}
                                                </span>
                                            </div>
                                            
                                            <h4 className="font-medium text-foreground truncate">
                                                {snap.note || 'Snapshot Recording'}
                                            </h4>
                                            
                                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                <div className="flex items-center gap-1.5">
                                                    <Clock className="w-3 h-3" />
                                                    {new Date(snap.createdAt).toLocaleString()}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <FileJson className="w-3 h-3" />
                                                    {snap.eventCount} events ({(snap.sizeBytes / 1024).toFixed(1)} KB)
                                                </div>
                                            </div>
                                            
                                            {/* Context Preview */}
                                            <div className="mt-3 p-2 bg-muted/50 rounded text-[10px] font-mono text-muted-foreground grid grid-cols-2 gap-1">
                                                <div className="truncate">BOOK: {snap.context.bookId?.slice(0, 8) || 'none'}</div>
                                                <div>SEC: {snap.context.sectionIndex}</div>
                                                <div>POS: {snap.context.currentIndex}</div>
                                                <div>STATUS: {snap.context.status}</div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-col gap-2 shrink-0">
                                            <Button 
                                                variant="outline" 
                                                size="icon"
                                                onClick={() => handleShare(snap.id)}
                                                title="Share/Export JSON"
                                                aria-label="Share or Export JSON"
                                                className="w-9 h-9 border-border"
                                            >
                                                <Share2 className="w-4 h-4" />
                                            </Button>
                                            <Button 
                                                variant="ghost" 
                                                size="icon"
                                                onClick={() => handleDeleteSnapshot(snap.id)}
                                                title="Delete"
                                                aria-label="Delete Snapshot"
                                                className="w-9 h-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </div>

            {/* Help / Footer */}
            <div className="bg-primary/5 p-4 rounded-xl border border-primary/20">
                <h4 className="text-sm font-semibold text-primary mb-1 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    How to use diagnostics
                </h4>
                <p className="text-xs text-primary/80 leading-relaxed">
                    Recording is always active with a memory-bounded ring buffer. If you experience an issue, 
                    capture a snapshot immediately. Use the share button to export the JSON recording for analysis.
                    Snapshots include state transitions, event sequences, and high-resolution timestamps.
                </p>
            </div>
        </div>
    );
};
