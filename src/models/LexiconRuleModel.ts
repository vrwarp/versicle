import { BaseModel } from './BaseModel';
import * as Y from 'yjs';
import type { LexiconRule } from '../types/db';

export class LexiconRuleModel extends BaseModel<Y.Map<any>> implements LexiconRule {
  constructor(data: Y.Map<any> | LexiconRule) {
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

  get original(): string { return this.y.get('original'); }
  set original(v: string) { this.y.set('original', v); }

  get replacement(): string { return this.y.get('replacement'); }
  set replacement(v: string) { this.y.set('replacement', v); }

  get isRegex(): boolean { return this.y.get('isRegex'); }
  set isRegex(v: boolean) { this.y.set('isRegex', v); }

  get bookId(): string | undefined { return this.y.get('bookId'); }
  set bookId(v: string | undefined) { this.y.set('bookId', v); }

  get applyBeforeGlobal(): boolean | undefined { return this.y.get('applyBeforeGlobal'); }
  set applyBeforeGlobal(v: boolean | undefined) { this.y.set('applyBeforeGlobal', v); }

  get order(): number | undefined { return this.y.get('order'); }
  set order(v: number | undefined) { this.y.set('order', v); }

  get created(): number { return this.y.get('created'); }
  set created(v: number) { this.y.set('created', v); }

  toJSON(): LexiconRule {
    return this.y.toJSON() as LexiconRule;
  }
}
