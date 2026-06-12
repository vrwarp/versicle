import React, { useEffect, useState } from 'react';
import { formatBytes, formatPercent } from '@kernel/locale/format';

/**
 * Storage usage line for the Data Management settings tab — the
 * `navigator.storage.estimate()` surface Phase 3 deferred to the settings
 * pass (phase3-storage-gateway.md §Follow-ups item 7; `storage.persist()`
 * itself is requested at first open by data/connection.ts D2). Landed P9.
 *
 * Self-contained on purpose: the tab is a props-fed presentational
 * component, and this is a read of a browser API with no app state — it
 * renders nothing when the API is unavailable (older WebViews, jsdom).
 */
export const StorageUsageSummary: React.FC = () => {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator
      ?.storage;
    if (typeof storage?.estimate !== 'function') return;
    storage
      .estimate()
      .then(({ usage, quota }) => {
        if (!cancelled && typeof usage === 'number' && typeof quota === 'number' && quota > 0) {
          setEstimate({ usage, quota });
        }
      })
      .catch(() => {
        /* unavailable estimate just renders nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!estimate) return null;

  return (
    <p className="text-xs text-muted-foreground" data-testid="storage-usage-summary">
      Storage used: {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)} available (
      {formatPercent(estimate.usage / estimate.quota)})
    </p>
  );
};
