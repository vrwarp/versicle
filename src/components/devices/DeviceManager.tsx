
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { DeviceList } from './DeviceList';
import type { DeviceProfile } from '../../types/device';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useToastStore } from '../../store/useToastStore';

export const DeviceManager = () => {
    const { devices, renameDevice, deleteDevice } = useDeviceStore();
    const currentDeviceId = getDeviceId();
    const deviceList = Object.values(devices);
    const showToast = useToastStore(state => state.showToast);

    const handleClone = (profile: DeviceProfile) => {
        if (!confirm("This will overwrite your current Theme and TTS settings. Continue?")) return;

        // Apply Theme
        usePreferencesStore.setState({
            currentTheme: profile.theme,
            fontSize: profile.fontSize
        });

        // Apply TTS
        const ttsStore = useTTSStore.getState();
        const updates: Partial<typeof ttsStore> = {
            rate: profile.ttsRate,
            pitch: profile.ttsPitch
        };

        // Try to find matching voice
        if (profile.ttsVoiceURI) {
            const matchingVoice = ttsStore.voices.find(v => v.id === profile.ttsVoiceURI || v.name === profile.ttsVoiceURI);
            if (matchingVoice) {
                updates.voice = matchingVoice;
            } else {
                showToast(`Voice "${profile.ttsVoiceURI}" not found on this device.`, 'error');
            }
        }

        useTTSStore.setState(updates);
        showToast("Settings cloned successfully!", 'success');
    };

    const handleDelete = (id: string) => {
        if (confirm("Are you sure you want to remove this device? It will just stop appearing here.")) {
            deleteDevice(id);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium mb-2">Sync Mesh</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Manage all devices connected to your account. Active devices share reading progress and library updates.
                </p>
            </div>

            <DeviceList
                devices={deviceList}
                currentDeviceId={currentDeviceId}
                onRename={renameDevice}
                onDelete={handleDelete}
                onClone={handleClone}
            />
        </div>
    );
};
