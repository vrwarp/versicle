import React from 'react';
import { Dialog } from '../ui/Dialog';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { Calendar, Percent } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils'; // Assuming utils exists

interface SyncStatusPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bookId: string;
    onJump: (cfi: string) => void;
}

import { DeviceIcon } from './DeviceIcon';

export const SyncStatusPanel: React.FC<SyncStatusPanelProps> = ({
    open,
    onOpenChange,
    bookId,
    onJump
}) => {
    const currentDeviceId = getDeviceId();
    const allProgress = useReadingStateStore(state => state.progress[bookId]);
    const devices = useDeviceStore(state => state.devices);

    const deviceSessions = React.useMemo(() => {
        if (!allProgress) return [];
        return Object.entries(allProgress)
            .map(([deviceId, progress]) => {
                const p = progress as { percentage?: number; lastRead?: number; currentCfi?: string };
                const device = devices[deviceId];
                return {
                    deviceId,
                    name: device?.name || (deviceId === currentDeviceId ? 'This Device' : 'Unknown Device'),
                    platform: device?.platform || 'desktop',
                    percentage: p.percentage || 0,
                    cfi: p.currentCfi || '',
                    lastRead: p.lastRead || 0,
                    isCurrent: deviceId === currentDeviceId
                };
            })
            .sort((a, b) => b.lastRead - a.lastRead);
    }, [allProgress, currentDeviceId, devices]);

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            title="Sync Status"
            description="Reading progress across your devices."
        >
            <div className="space-y-4">
                {deviceSessions.length === 0 ? (
                    <p className="text-center text-muted-foreground">No sync data available.</p>
                ) : (
                    <div className="flex flex-col gap-3">
                        {deviceSessions.map((session) => (
                            <div
                                key={session.deviceId}
                                className={cn(
                                    "flex items-center justify-between p-3 rounded-lg border",
                                    session.isCurrent ? "bg-muted/50 border-primary/20" : "bg-card hover:bg-muted/30 transition-colors"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn("p-2 rounded-full", session.isCurrent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                        <DeviceIcon platform={session.platform} className="w-4 h-4" />
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm">{session.name}</span>
                                            {session.isCurrent && (
                                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Currently Reading</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                            <span className="flex items-center gap-1">
                                                <Percent className="w-3 h-3" />
                                                {Math.round(session.percentage * 100)}%
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(session.lastRead).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {!session.isCurrent && session.cfi && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            onJump(session.cfi);
                                            onOpenChange(false);
                                        }}
                                    >
                                        Jump
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Dialog>
    );
};
