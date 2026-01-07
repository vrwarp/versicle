import { BaseModel } from './BaseModel';
import * as Y from 'yjs';
import type { ReadingListEntry } from '../types/db';

export class ReadingListEntryModel extends BaseModel<Y.Map<any>> implements ReadingListEntry {
  constructor(data: Y.Map<any> | ReadingListEntry) {
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

  get filename(): string { return this.y.get('filename'); }
  set filename(v: string) { this.y.set('filename', v); }

  get title(): string { return this.y.get('title'); }
  set title(v: string) { this.y.set('title', v); }

  get author(): string { return this.y.get('author'); }
  set author(v: string) { this.y.set('author', v); }

  get isbn(): string | undefined { return this.y.get('isbn'); }
  set isbn(v: string | undefined) { this.y.set('isbn', v); }

  get rating(): number | undefined { return this.y.get('rating'); }
  set rating(v: number | undefined) { this.y.set('rating', v); }

  get percentage(): number { return this.y.get('percentage'); }
  set percentage(v: number) { this.y.set('percentage', v); }

  get lastUpdated(): number { return this.y.get('lastUpdated'); }
  set lastUpdated(v: number) { this.y.set('lastUpdated', v); }

  get status(): 'read' | 'currently-reading' | 'to-read' { return this.y.get('status'); }
  set status(v: 'read' | 'currently-reading' | 'to-read') { this.y.set('status', v); }

  toJSON(): ReadingListEntry {
    return this.y.toJSON() as ReadingListEntry;
  }
}
