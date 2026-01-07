import { BaseModel } from './BaseModel';
import * as Y from 'yjs';

export class SettingsModel extends BaseModel<Y.Map<any>> {
  constructor(doc: Y.Doc) {
    // Plan: Y.Map<string, any>
    super(doc.getMap('settings'));
  }

  async getSettings() {
    // Placeholder
    return {};
  }
}
