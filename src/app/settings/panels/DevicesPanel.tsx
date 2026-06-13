/**
 * Devices settings panel (Phase 8 §B): the DeviceManager surface, formerly
 * inline JSX in the deleted GlobalSettingsDialog.
 */
import React from 'react';
import { DeviceManager } from '@components/devices/DeviceManager';

const DevicesPanel: React.FC = () => (
  <div className="space-y-6">
    <DeviceManager />
  </div>
);

export default DevicesPanel;
