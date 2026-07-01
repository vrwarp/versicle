/**
 * Generative AI settings panel (Phase 8 §B): self-contained wiring for the
 * presentational GenAISettingsTab. Handlers (log download, content-analysis
 * cache clear) moved verbatim from the deleted GlobalSettingsDialog.
 */
import React from 'react';
import { useGenAIStore, DEFAULT_QUOTA_LIMITS } from '@store/useGenAIStore';
import { useToastStore } from '@store/useToastStore';
import { contentAnalysisRepository } from '@app/repositories/ContentAnalysisRepository';
import { exportFile } from '@lib/export';
import { GenAISettingsTab } from '@components/settings';
import { useConfirm } from '@components/ui/ConfirmDialog';
import { createLogger } from '@lib/logger';
import { useQuotaMeters } from './useQuotaMeters';

const logger = createLogger('GenAIPanel');

const GenAIPanel: React.FC = () => {
  const showToast = useToastStore((state) => state.showToast);
  const confirm = useConfirm();

  const {
    provider,
    setProvider,
    apiKey,
    setApiKey,
    model,
    setModel,
    anthropicApiKey,
    setAnthropicApiKey,
    anthropicModel,
    setAnthropicModel,
    isEnabled,
    setEnabled,
    isModelRotationEnabled,
    setModelRotationEnabled,
    isContentAnalysisEnabled,
    setContentAnalysisEnabled,
    isTableAdaptationEnabled,
    setTableAdaptationEnabled,
    contentFilterSkipTypes,
    setContentFilterSkipTypes,
    logs,
    maxLogs,
    setMaxLogs,
    clearLogs,
    isDebugModeEnabled,
    setDebugModeEnabled,
    quotaLimitsMap,
    setQuotaLimitsForPool,
    resetAllQuotaLimits,
    bgThrottlePercent,
    setBgThrottlePercent,
    fgRpdHeadroom,
    setFgRpdHeadroom,
    pauseAllGenAI,
    setPauseAllGenAI,
    preEmbedLibrary,
    setPreEmbedLibrary,
    shareAiCaches,
    setShareAiCaches,
    getQuotaSnapshot
  } = useGenAIStore();

  const handleResetPoolLimits = (ratePool: string) => {
    const defaultLimits = DEFAULT_QUOTA_LIMITS[ratePool] || DEFAULT_QUOTA_LIMITS['default'] || { rpm: 100, tpm: 30000, rpd: 1000 };
    setQuotaLimitsForPool(ratePool, defaultLimits);
  };

  const handleResetAllPoolLimits = async () => {
    if (await confirm({ titleKey: 'genai.resetAll.title', bodyKey: 'genai.resetAll.body', danger: true })) {
      try {
        resetAllQuotaLimits();
        showToast("All rate limit pools have been reset to defaults.", "success");
      } catch (e) {
        logger.error("Failed to reset all rate limit pools", e);
        showToast("Failed to reset rate pools.", "error");
      }
    }
  };

  const meters = useQuotaMeters();

  const handleClearContentAnalysis = async () => {
    if (await confirm({ titleKey: 'genai.clearCache.title', bodyKey: 'genai.clearCache.body', danger: true })) {
      try {
        contentAnalysisRepository.clearAll();
        showToast("Content Analysis cache cleared.", "success");
      } catch (e) {
        logger.error("Failed to clear content analysis cache", e);
        showToast("Failed to clear cache.", "error");
      }
    }
  };

  const handleDownloadLogs = async () => {
    const content = logs.map(log => {
      const target = log.model ? ` ${log.provider ? `${log.provider}/` : ''}${log.model}` : '';
      return (
        `[${new Date(log.timestamp).toISOString()}] ${log.type.toUpperCase()} (${log.method})${target} \n` +
        JSON.stringify(log.payload, null, 2) +
        `\n${'-'.repeat(40)} \n`
      );
    }).join('\n');

    const filename = `genai_logs_${new Date().toISOString()}.txt`;

    await exportFile({
      filename,
      data: content,
      mimeType: 'text/plain'
    });
  };

  return (
    <GenAISettingsTab
      isEnabled={isEnabled}
      onEnabledChange={setEnabled}
      provider={provider}
      onProviderChange={setProvider}
      apiKey={apiKey}
      onApiKeyChange={setApiKey}
      model={model}
      onModelChange={setModel}
      anthropicApiKey={anthropicApiKey}
      onAnthropicApiKeyChange={setAnthropicApiKey}
      anthropicModel={anthropicModel}
      onAnthropicModelChange={setAnthropicModel}
      isModelRotationEnabled={isModelRotationEnabled}
      onModelRotationChange={setModelRotationEnabled}
      isContentAnalysisEnabled={isContentAnalysisEnabled}
      onContentAnalysisChange={setContentAnalysisEnabled}
      contentFilterSkipTypes={contentFilterSkipTypes}
      onContentFilterSkipTypesChange={setContentFilterSkipTypes}
      isDebugModeEnabled={isDebugModeEnabled}
      onDebugModeChange={setDebugModeEnabled}
      onClearContentAnalysis={handleClearContentAnalysis}
      isTableAdaptationEnabled={isTableAdaptationEnabled}
      onTableAdaptationChange={setTableAdaptationEnabled}
      logs={logs}
      maxLogs={maxLogs}
      onMaxLogsChange={setMaxLogs}
      onClearLogs={clearLogs}
      onDownloadLogs={handleDownloadLogs}
      quotaLimitsMap={quotaLimitsMap}
      getQuotaSnapshot={getQuotaSnapshot}
      onQuotaLimitsForPoolChange={setQuotaLimitsForPool}

      onResetPoolLimits={handleResetPoolLimits}
      onResetAllPoolLimits={handleResetAllPoolLimits}
      bgThrottlePercent={bgThrottlePercent}
      onBgThrottlePercentChange={setBgThrottlePercent}
      fgRpdHeadroom={fgRpdHeadroom}
      onFgRpdHeadroomChange={setFgRpdHeadroom}
      pauseAllGenAI={pauseAllGenAI}
      onPauseAllGenAIChange={setPauseAllGenAI}
      meters={meters}
      preEmbedLibrary={preEmbedLibrary}
      onPreEmbedLibraryChange={setPreEmbedLibrary}
      shareAiCaches={shareAiCaches}
      onShareAiCachesChange={setShareAiCaches}
    />
  );
};

export default GenAIPanel;
