/**
 * Generative AI settings panel (Phase 8 §B): self-contained wiring for the
 * presentational GenAISettingsTab. Handlers (log download, content-analysis
 * cache clear) moved verbatim from the deleted GlobalSettingsDialog.
 */
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
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

  // Scoped subscriptions, NOT `useGenAIStore()`: the bare hook subscribes to
  // the whole state object, so every store write — the embedding model, the
  // boot-time quota providers, anything — re-rendered this panel and its
  // (heavy) tab. The settings this panel actually shows:
  const {
    apiKey,
    model,
    isEnabled,
    isModelRotationEnabled,
    isContentAnalysisEnabled,
    isTableAdaptationEnabled,
    contentFilterSkipTypes,
    maxLogs,
    isDebugModeEnabled,
    quotaLimitsMap,
    bgThrottlePercent,
    fgRpdHeadroom,
    pauseAllGenAI,
    preEmbedLibrary,
    shareAiCaches,
    getQuotaSnapshot
  } = useGenAIStore(
    useShallow((state) => ({
      apiKey: state.apiKey,
      model: state.model,
      isEnabled: state.isEnabled,
      isModelRotationEnabled: state.isModelRotationEnabled,
      isContentAnalysisEnabled: state.isContentAnalysisEnabled,
      isTableAdaptationEnabled: state.isTableAdaptationEnabled,
      contentFilterSkipTypes: state.contentFilterSkipTypes,
      maxLogs: state.maxLogs,
      isDebugModeEnabled: state.isDebugModeEnabled,
      quotaLimitsMap: state.quotaLimitsMap,
      bgThrottlePercent: state.bgThrottlePercent,
      fgRpdHeadroom: state.fgRpdHeadroom,
      pauseAllGenAI: state.pauseAllGenAI,
      preEmbedLibrary: state.preEmbedLibrary,
      shareAiCaches: state.shareAiCaches,
      getQuotaSnapshot: state.getQuotaSnapshot
    }))
  );

  // Actions are created once by the store factory, so this subscription never
  // notifies; it is here to keep the handlers off the whole-state hook.
  const {
    setApiKey,
    setModel,
    setEnabled,
    setModelRotationEnabled,
    setContentAnalysisEnabled,
    setTableAdaptationEnabled,
    setContentFilterSkipTypes,
    setMaxLogs,
    clearLogs,
    setDebugModeEnabled,
    setQuotaLimitsForPool,
    resetAllQuotaLimits,
    setBgThrottlePercent,
    setFgRpdHeadroom,
    setPauseAllGenAI,
    setPreEmbedLibrary,
    setShareAiCaches
  } = useGenAIStore(
    useShallow((state) => ({
      setApiKey: state.setApiKey,
      setModel: state.setModel,
      setEnabled: state.setEnabled,
      setModelRotationEnabled: state.setModelRotationEnabled,
      setContentAnalysisEnabled: state.setContentAnalysisEnabled,
      setTableAdaptationEnabled: state.setTableAdaptationEnabled,
      setContentFilterSkipTypes: state.setContentFilterSkipTypes,
      setMaxLogs: state.setMaxLogs,
      clearLogs: state.clearLogs,
      setDebugModeEnabled: state.setDebugModeEnabled,
      setQuotaLimitsForPool: state.setQuotaLimitsForPool,
      resetAllQuotaLimits: state.resetAllQuotaLimits,
      setBgThrottlePercent: state.setBgThrottlePercent,
      setFgRpdHeadroom: state.setFgRpdHeadroom,
      setPauseAllGenAI: state.setPauseAllGenAI,
      setPreEmbedLibrary: state.setPreEmbedLibrary,
      setShareAiCaches: state.setShareAiCaches
    }))
  );

  // The activity log gets its OWN subscription: the tab's Debug Logs list is
  // always rendered, so an appended entry has to reach it — but it is the only
  // thing an addLog re-renders here now.
  const logs = useGenAIStore((state) => state.logs);

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
    // Header line: `[iso] TYPE (method)` plus, when the entry carries them,
    // `cid=<correlationId>` (ties a call's request/response/error entries and
    // the detector's telemetry record together) and the JSON-quoted book and
    // section titles — so an exported log can be paired offline without
    // guessing from timestamps.
    const content = logs.map(log => {
      const header = [`[${new Date(log.timestamp).toISOString()}] ${log.type.toUpperCase()} (${log.method})`];
      if (log.correlationId) header.push(`cid=${log.correlationId}`);
      if (log.bookTitle) header.push(`book=${JSON.stringify(log.bookTitle)}`);
      if (log.sectionTitle) header.push(`section=${JSON.stringify(log.sectionTitle)}`);
      return (
        `${header.join(' ')} \n` +
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
      apiKey={apiKey}
      onApiKeyChange={setApiKey}
      model={model}
      onModelChange={setModel}
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
