import { BaseModel } from './BaseModel';
import * as Y from 'yjs';

// Currently Settings are just a Map<string, any>.
// We can expose generic accessors or specific ones if we know the schema.
// Since settings are diverse, I will stick to Map-like access but wrapped.

export class SettingsModel extends BaseModel<Y.Map<any>> {
  constructor(data: Y.Map<any> | Record<string, any>) {
    if (data instanceof Y.Map) {
      super(data);
    } else {
      const map = new Y.Map();
      for (const [key, value] of Object.entries(data)) {
        map.set(key, value);
      }
      super(map);
    }
  }

  get(key: string): any {
    return this.y.get(key);
  }

  set(key: string, value: any) {
    this.y.set(key, value);
  }

  toJSON(): Record<string, any> {
    return this.y.toJSON();
  }
}
