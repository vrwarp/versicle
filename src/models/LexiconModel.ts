import { LexiconService } from '../lib/tts/LexiconService';
import { BaseModel } from './BaseModel';
import type { LexiconRule } from '../types/db';

export class LexiconModel extends BaseModel {
  private service: LexiconService;

  constructor() {
    super();
    this.service = LexiconService.getInstance();
  }

  async getRules(bookId?: string) {
    return this.service.getRules(bookId);
  }

  async saveRule(rule: Omit<LexiconRule, 'id' | 'created'> & { id?: string }) {
    return this.service.saveRule(rule);
  }

  async reorderRules(updates: { id: string; order: number }[]) {
    return this.service.reorderRules(updates);
  }

  async deleteRule(id: string) {
    return this.service.deleteRule(id);
  }

  async deleteRules(ids: string[]) {
    return this.service.deleteRules(ids);
  }

  applyLexicon(text: string, rules: LexiconRule[]) {
    return this.service.applyLexicon(text, rules);
  }

  async getRulesHash(rules: LexiconRule[]) {
      return this.service.getRulesHash(rules);
  }
}

export const lexiconModel = new LexiconModel();
