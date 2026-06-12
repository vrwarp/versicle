/**
 * Sync & Cloud settings panel (Phase 8 §B): self-contained wiring for the
 * presentational SyncSettingsTab. Handlers (device rename self-healing,
 * Firebase sign-in/out, config clear) moved verbatim from the deleted
 * GlobalSettingsDialog.
 */
import React, { useState } from 'react';
import { useSyncStore } from '@store/useSyncStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useToastStore } from '@store/useToastStore';
import { useFirestoreSync } from '@hooks/useFirestoreSync';
import { getDeviceId } from '@lib/device-id';
import { SyncSettingsTab } from '@components/settings';
import { useConfirm } from '@components/ui/ConfirmDialog';
import { createLogger } from '@lib/logger';

const logger = createLogger('SyncPanel');

const SyncPanel: React.FC = () => {
  const showToast = useToastStore((state) => state.showToast);
  const {
    setFirebaseEnabled, firestoreStatus, firebaseAuthStatus, firebaseUserEmail,
    firebaseConfig, setFirebaseConfig
  } = useSyncStore();
  const { signIn: firebaseSignIn, signOut: firebaseSignOut, isConfigured: isFirebaseAvailable } = useFirestoreSync();
  const [isFirebaseSigningIn, setIsFirebaseSigningIn] = useState(false);

  const { devices, renameDevice } = useDeviceStore();
  const currentDeviceId = getDeviceId();
  const confirm = useConfirm();

  const handleClearConfig = async () => {
    if (await confirm({ titleKey: 'syncSettings.clearConfig.title', bodyKey: 'syncSettings.clearConfig.body', danger: true })) {
      setFirebaseConfig({
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
        measurementId: ''
      });
      setFirebaseEnabled(false);
    }
  };

  return (
    <SyncSettingsTab
      currentDeviceId={currentDeviceId}
      currentDeviceName={devices[currentDeviceId]?.name || 'Unknown Device'}
      onDeviceRename={(name) => {
        if (devices[currentDeviceId]) {
          renameDevice(currentDeviceId, name);
        } else {
          // Self-healing: Device not mesh-registered? Register it now with the new name.
          const prefs = usePreferencesStore.getState();
          const tts = useTTSSettingsStore.getState();
          const activeProfile = tts.profiles[tts.activeLanguage];
          const profile = {
            theme: prefs.currentTheme,
            fontSize: prefs.fontSize,
            ttsVoiceURI: activeProfile?.voiceId ?? null,
            ttsRate: activeProfile?.rate ?? 1.0,
            // Profile pitch died in the 5b settings split.
            ttsPitch: 1.0
          };
          useDeviceStore.getState().registerCurrentDevice(currentDeviceId, profile, name);
          showToast('Device registered to mesh', 'success');
        }
      }}
      isFirebaseAvailable={isFirebaseAvailable}
      firebaseAuthStatus={firebaseAuthStatus}
      firestoreStatus={firestoreStatus}
      firebaseUserEmail={firebaseUserEmail}
      isFirebaseSigningIn={isFirebaseSigningIn}
      firebaseConfig={firebaseConfig}
      onFirebaseConfigChange={(updates) => setFirebaseConfig({ ...firebaseConfig, ...updates })}
      onFirebaseSignIn={async () => {
        setIsFirebaseSigningIn(true);
        try {
          await firebaseSignIn();
        } catch (e) {
          logger.error('Firebase sign in failed', e);
          const message = e instanceof Error ? e.message : 'Unknown error';
          showToast(`Sign in failed: ${message}`, 'error');
        } finally {
          setIsFirebaseSigningIn(false);
        }
      }}
      onFirebaseSignOut={async () => {
        await firebaseSignOut();
      }}
      onClearConfig={handleClearConfig}
    />
  );
};

export default SyncPanel;
