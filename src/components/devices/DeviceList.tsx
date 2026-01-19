import { useState, useEffect } from 'react';
import { Laptop, Smartphone, Globe, Edit2, Trash2, Copy, Check, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { DeviceInfo, DeviceProfile } from '../../types/device';
import { cn } from '../../lib/utils'; // Assuming utils exists, or I'll use inline classes

interface DeviceListProps {
    devices: DeviceInfo[];
    currentDeviceId: string;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onClone: (profile: DeviceProfile) => void;
}

export const DeviceList = ({ devices, currentDeviceId, onRename, onDelete, onClone }: DeviceListProps) => {
    // Sort: Current device first, then by lastActive desc
    const sortedDevices = [...devices].sort((a, b) => {
        if (a.id === currentDeviceId) return -1;
        if (b.id === currentDeviceId) return 1;
        return b.lastActive - a.lastActive;
    });

    return (
        <div className="space-y-4">
            {sortedDevices.map((device) => (
                <DeviceItem
                    key={device.id}
                    device={device}
                    isCurrent={device.id === currentDeviceId}
                    onRename={onRename}
                    onDelete={onDelete}
                    onClone={onClone}
                />
            ))}
        </div>
    );
};

interface DeviceItemProps {
    device: DeviceInfo;
    isCurrent: boolean;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onClone: (profile: DeviceProfile) => void;
}

const DeviceItem = ({ device, isCurrent, onRename, onDelete, onClone }: DeviceItemProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(device.name);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        // Update relative time every minute
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);

    const handleSave = () => {
        if (editName.trim()) {
            onRename(device.id, editName.trim());
        }
        setIsEditing(false);
    };

    const getIcon = () => {
        const lower = device.name.toLowerCase() + (device.platform || '').toLowerCase();
        if (lower.includes('mobile') || lower.includes('phone') || lower.includes('android') || lower.includes('ios')) return <Smartphone className="h-5 w-5" />;
        if (lower.includes('mac') || lower.includes('windows') || lower.includes('desktop')) return <Laptop className="h-5 w-5" />;
        return <Globe className="h-5 w-5" />;
    };

    const getStatusColor = (lastActive: number) => {
        const diff = now - lastActive;
        if (diff < 10 * 60 * 1000) return 'bg-green-500'; // < 10 mins
        if (diff < 24 * 60 * 60 * 1000) return 'bg-yellow-500'; // < 24 hours
        return 'bg-gray-300 dark:bg-gray-600'; // Offline
    };

    const formatLastActive = (lastActive: number) => {
        const diff = now - lastActive;
        if (diff < 60 * 1000) return 'Just now';
        if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
        return new Date(lastActive).toLocaleDateString();
    };

    return (
        <div className={cn(
            "flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border bg-card text-card-foreground shadow-sm gap-3",
            isCurrent && "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
        )}>
            <div className="flex items-center gap-3 overflow-hidden">
                <div className="p-2 bg-muted rounded-full shrink-0">
                    {getIcon()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        {isEditing ? (
                            <div className="flex items-center gap-1">
                                <Input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="h-7 w-[150px]"
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                />
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSave}>
                                    <Check className="h-4 w-4 text-green-500" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setIsEditing(false)}>
                                    <X className="h-4 w-4 text-red-500" />
                                </Button>
                            </div>
                        ) : (
                            <h4 className="font-medium truncate flex items-center gap-2">
                                {device.name}
                                {isCurrent && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">This Device</span>}
                                <button className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity" onClick={() => setIsEditing(true)}>
                                    <Edit2 className="h-3 w-3 text-muted-foreground" />
                                </button>
                            </h4>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className={`h-2 w-2 rounded-full ${getStatusColor(device.lastActive)}`} />
                        <span>{formatLastActive(device.lastActive)}</span>
                        <span className="hidden sm:inline">• {device.browser} on {device.platform}</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
                {!isCurrent && (
                    <>
                        <Button variant="outline" size="sm" onClick={() => onClone(device.profile)} title="Clone settings from this device">
                            <Copy className="h-4 w-4 mr-2" />
                            Clone Settings
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(device.id)} title="Remove device">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </>
                )}
                {isCurrent && (
                    <Button variant="ghost" size="sm" disabled className="text-muted-foreground">
                        Active
                    </Button>
                )}
            </div>
        </div>
    );
};
