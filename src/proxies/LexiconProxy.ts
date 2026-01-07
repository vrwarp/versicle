import { LexiconService } from '../lib/tts/LexiconService';
import { LexiconRuleModel } from '../models/LexiconRuleModel';
import type { LexiconRule } from '../types/db';

export class LexiconProxy {
  private service: LexiconService;

  constructor() {
    this.service = LexiconService.getInstance();
  }

  async getRules(bookId?: string) {
    const rules = await this.service.getRules(bookId);
    return rules.map(r => new LexiconRuleModel(r));
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
    // LexiconService expects plain objects or at least compatible interfaces.
    // LexiconRuleModel implements LexiconRule, so it should be fine.
    return this.service.applyLexicon(text, rules);
  }

  async getRulesHash(rules: LexiconRule[]) {
      return this.service.getRulesHash(rules);
  }
}
