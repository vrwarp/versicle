/**
 * `deviceRegistration` boot phase (moved verbatim from App.tsx):
 *  1. wire the TTS store to the engine (must precede profile assembly —
 *     the device profile reads the TTS voice/rate/pitch),
 *  2. assemble the device profile and register/touch this device.
 *
 * C11 eventually gives the TTS controller its own phase (P5); until then it
 * keeps its historical position right before device registration.
 */
import type { BootTask } from '../bootstrap';
import { getDeviceId } from '@lib/device-id';
import { useDeviceStore } from '@store/useDeviceStore';
import { useTTSStore } from '@store/useTTSStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import type { DeviceProfile } from '~types/device';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

export const ttsInitializeTask: BootTask = {
  name: 'tts/initialize',
  run: () => {
    useTTSStore.getState().initialize();
  },
};

export const deviceRegistrationTask: BootTask = {
  name: 'device/register',
  run: () => {
    const deviceId = getDeviceId();
    const deviceStore = useDeviceStore.getState();
    const prefs = usePreferencesStore.getState();
    const tts = useTTSStore.getState();

    const profile: DeviceProfile = {
      theme: prefs.currentTheme,
      fontSize: prefs.fontSize,
      ttsVoiceURI: tts.voice ? tts.voice.id : null,
      ttsRate: tts.rate,
      ttsPitch: tts.pitch,
    };

    if (!deviceStore.devices[deviceId]) {
      logger.info('Registering new device:', deviceId);
    }
    // Registering an existing device touches lastActive and syncs the profile.
    deviceStore.registerCurrentDevice(deviceId, profile);
  },
};
