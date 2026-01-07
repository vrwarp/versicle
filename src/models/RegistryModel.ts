import { BaseModel } from './BaseModel';
import * as Y from 'yjs';

interface DeviceInfo {
  deviceId: string;
  name: string;
  lastSeen: number;
}

export class RegistryModel extends BaseModel<Y.Map<DeviceInfo>> {
  constructor(doc: Y.Doc) {
    // Plan: Y.Map<DeviceId, DeviceInfo>
    super(doc.getMap('deviceRegistry'));
  }

  async getRegistry() {
    // Placeholder
    return [];
  }
}
