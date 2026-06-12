
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { DeviceList } from './DeviceList';
import type { DeviceProfile } from '~types/device';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useToastStore } from '@store/useToastStore';

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

        // Apply TTS: write the active profile (the TtsController pushes the
        // changes to the engine). Profile pitch died in the 5b settings split.
        const settings = useTTSSettingsStore.getState();
        settings.setRate(profile.ttsRate);

        // Try to find matching voice in the loaded runtime list
        if (profile.ttsVoiceURI) {
            const voices = useTTSPlaybackStore.getState().voices;
            const matchingVoice = voices.find(v => v.id === profile.ttsVoiceURI || v.name === profile.ttsVoiceURI);
            if (matchingVoice) {
                settings.setVoiceId(matchingVoice.id);
            } else {
                showToast(`Voice "${profile.ttsVoiceURI}" not found on this device.`, 'error');
            }
        }

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
