/**
 * TTS Engine settings panel (Phase 8 §B): self-contained wiring for the
 * presentational TTSSettingsTab. The provider list itself renders from the
 * 5a ProviderDescriptor registry inside TTSSettingsTab — adding a provider
 * does not touch settings code. Handlers (buffered API-key probe, piper
 * voice-readiness) moved verbatim from the deleted GlobalSettingsDialog.
 */
import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import { useToastStore } from '@store/useToastStore';
import { resolveDescriptor, type TTSApiKeyProviderId } from '@lib/tts/providers/registry';
import { TTSSettingsTab } from '@components/settings';
import { createLogger } from '@lib/logger';

const logger = createLogger('TTSPanel');

const TTSPanel: React.FC = () => {
  const showToast = useToastStore((state) => state.showToast);

  const {
    profiles,
    providerId, setProviderId,
    apiKeys, setApiKey,
    backgroundAudioMode, setBackgroundAudioMode,
    whiteNoiseVolume, setWhiteNoiseVolume,
    setVoiceId,
    activeLanguage,
    setMinSentenceLength
  } = useTTSSettingsStore(useShallow(state => ({
    // Optimization: Use shallow selector to avoid re-renders on unrelated settings churn
    activeLanguage: state.activeLanguage,
    profiles: state.profiles,
    providerId: state.providerId,
    setProviderId: state.setProviderId,
    apiKeys: state.apiKeys,
    setApiKey: state.setApiKey,
    backgroundAudioMode: state.backgroundAudioMode,
    setBackgroundAudioMode: state.setBackgroundAudioMode,
    whiteNoiseVolume: state.whiteNoiseVolume,
    setWhiteNoiseVolume: state.setWhiteNoiseVolume,
    setVoiceId: state.setVoiceId,
    setMinSentenceLength: state.setMinSentenceLength
  })));

  // Runtime engine state (voice list, resolved voice, download progress) lives
  // in the ephemeral playback store since the 5b split.
  const { voice, voices, downloadProgress, downloadStatus, isDownloading } = useTTSPlaybackStore(useShallow(state => ({
    voice: state.voice,
    voices: state.voices,
    downloadProgress: state.downloadProgress,
    downloadStatus: state.downloadStatus,
    isDownloading: state.isDownloading
  })));

  // Engine commands come from the TtsController facade (stable identities).
  const { downloadVoice, deleteVoice, checkVoiceDownloaded } = useAudioCommands();

  const [isVoiceReady, setIsVoiceReady] = useState(false);

  /**
   * Explicit "Test Key" action (5a buffered API-key edits): commit happened on
   * blur; here we build a throwaway provider from the registry with the entered
   * key and probe it (init + voice listing) WITHOUT touching the active provider.
   */
  const handleTestApiKey = async (provider: TTSApiKeyProviderId, key: string) => {
    const descriptor = resolveDescriptor(provider);
    const probe = descriptor.build({ apiKey: key, language: activeLanguage || 'en' });
    try {
      if (!key) {
        showToast(`${descriptor.displayName}: enter an API key first.`, 'error');
        return;
      }
      await probe.init();
      const probeVoices = await probe.getVoices();
      if (probeVoices.length > 0) {
        showToast(`${descriptor.displayName}: key OK (${probeVoices.length} voices available).`, 'success');
      } else {
        showToast(`${descriptor.displayName}: key accepted, but no voices were returned.`, 'info');
      }
    } catch (e) {
      logger.warn('API key test failed', e);
      showToast(`${descriptor.displayName}: key test failed — ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      probe.dispose();
    }
  };

  useEffect(() => {
    let ignore = false;
    if (providerId === 'piper' && voice) {
      checkVoiceDownloaded(voice.id).then(isReady => {
        if (!ignore) {
          setIsVoiceReady(isReady);
        }
      });
    } else {
      setIsVoiceReady(false);
    }
    return () => { ignore = true; };
  }, [providerId, voice, checkVoiceDownloaded, isDownloading]);

  return (
    <TTSSettingsTab
      activeLanguage={activeLanguage}
      profiles={profiles}
      providerId={providerId}
      onProviderChange={setProviderId}
      apiKeys={apiKeys}
      onApiKeyChange={setApiKey}
      onTestApiKey={handleTestApiKey}
      backgroundAudioMode={backgroundAudioMode}
      onBackgroundAudioModeChange={setBackgroundAudioMode}
      whiteNoiseVolume={whiteNoiseVolume}
      onWhiteNoiseVolumeChange={setWhiteNoiseVolume}
      voice={voice}
      voices={voices}
      onVoiceChange={(v, lang) => setVoiceId(v?.id ?? null, lang)}
      isVoiceReady={isVoiceReady}
      isDownloading={isDownloading}
      downloadProgress={downloadProgress}
      downloadStatus={downloadStatus}
      onDownloadVoice={downloadVoice}
      onDeleteVoice={(voiceId) => {
        deleteVoice(voiceId).then(() => setIsVoiceReady(false));
      }}
      onMinSentenceLengthChange={setMinSentenceLength}
    />
  );
};

export default TTSPanel;
