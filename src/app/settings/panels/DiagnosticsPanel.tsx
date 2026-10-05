/**
 * Diagnostics settings panel (Phase 8 §B): DiagnosticsTab was already the
 * self-contained model panel — this module adapts it to the registry's
 * default-export contract and puts the sync diagnostics export above it.
 */
import React from 'react';
import { DiagnosticsTab } from '@components/settings';
import { SyncDiagnosticsSection } from './SyncDiagnosticsSection';

const DiagnosticsPanel: React.FC = () => (
  <div className="space-y-6">
    <SyncDiagnosticsSection />
    <DiagnosticsTab />
  </div>
);

export default DiagnosticsPanel;
