/**
 * `deviceRegistration` boot phase:
 *  1. wire the TTS controller to the engine + stores (must precede profile
 *     assembly — the device profile reads the TTS voice/rate),
 *  2. assemble the device profile and register/touch this device.
 *
 * The TTS wiring is TtsController.initialize() (engine→store mirror,
 * store→engine settings sync, rehydrated-settings replay); the settings store
 * itself is pure state.
 */
import type { BootTask } from '../bootstrap';
import { getDeviceId } from '@lib/device-id';
import { useDeviceStore } from '@store/useDeviceStore';
import { useTTSSettingsStore, selectActiveRate, selectActiveVoiceId } from '@store/useTTSSettingsStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { getTtsController } from '../tts/TtsController';
import type { DeviceProfile } from '~types/device';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

export const ttsInitializeTask: BootTask = {
  name: 'tts/initialize',
  run: () => {
    getTtsController().initialize();
  },
};

export const deviceRegistrationTask: BootTask = {
  name: 'device/register',
  run: () => {
    const deviceId = getDeviceId();
    const deviceStore = useDeviceStore.getState();
    const prefs = usePreferencesStore.getState();
    const tts = useTTSSettingsStore.getState();

    const profile: DeviceProfile = {
      theme: prefs.currentTheme,
      fontSize: prefs.fontSize,
      ttsVoiceURI: selectActiveVoiceId(tts),
      ttsRate: selectActiveRate(tts),
      // Nothing applies a per-profile pitch; the synced DeviceProfile shape
      // keeps the field at its neutral value.
      ttsPitch: 1.0,
    };

    if (!deviceStore.devices[deviceId]) {
      logger.info('Registering new device:', deviceId);
    }
    // Registering an existing device touches lastActive and syncs the profile.
    deviceStore.registerCurrentDevice(deviceId, profile);
  },
};
