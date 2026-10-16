/**
 * Devices settings panel: the DeviceManager surface.
 */
import React from 'react';
import { DeviceManager } from '@components/devices/DeviceManager';

const DevicesPanel: React.FC = () => (
  <div className="space-y-6">
    <DeviceManager />
  </div>
);

export default DevicesPanel;
