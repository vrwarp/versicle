import { BaseModel } from './BaseModel';
import * as Y from 'yjs';
import type { Annotation } from '../types/db';

export class AnnotationModel extends BaseModel<Y.Map<any>> implements Annotation {
  constructor(data: Y.Map<any> | Annotation) {
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

  get id(): string { return this.y.get('id'); }
  set id(v: string) { this.y.set('id', v); }

  get bookId(): string { return this.y.get('bookId'); }
  set bookId(v: string) { this.y.set('bookId', v); }

  get cfiRange(): string { return this.y.get('cfiRange'); }
  set cfiRange(v: string) { this.y.set('cfiRange', v); }

  get text(): string { return this.y.get('text'); }
  set text(v: string) { this.y.set('text', v); }

  get type(): 'highlight' | 'note' { return this.y.get('type'); }
  set type(v: 'highlight' | 'note') { this.y.set('type', v); }

  get color(): string { return this.y.get('color'); }
  set color(v: string) { this.y.set('color', v); }

  get note(): string | undefined { return this.y.get('note'); }
  set note(v: string | undefined) { this.y.set('note', v); }

  get created(): number { return this.y.get('created'); }
  set created(v: number) { this.y.set('created', v); }

  toJSON(): Annotation {
    return this.y.toJSON() as Annotation;
  }
}
