import { LexiconService } from './LexiconService';
import { LexiconRule } from '../../types/db';

describe('LexiconService CSV Support', () => {
  let service: LexiconService;

  beforeEach(() => {
    // Reset instance (though it's a singleton, we can't easily reset private static instance)
    // but we can just use getInstance()
    service = LexiconService.getInstance();
  });

  describe('rulesToCSV', () => {
    it('should generate a correct CSV header and rows', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'Hello', replacement: 'Hi', isRegex: false, created: 0 },
        { id: '2', original: 'World', replacement: 'Earth', isRegex: true, created: 0 }
      ];

      const csv = service.rulesToCSV(rules);
      const lines = csv.split('\n');

      expect(lines[0]).toBe('Original,Replacement,IsRegex');
      expect(lines[1]).toBe('Hello,Hi,false');
      expect(lines[2]).toBe('World,Earth,true');
    });

    it('should handle special characters and quoting', () => {
      const rules: LexiconRule[] = [
        { id: '1', original: 'Hello, World', replacement: 'Hi "Earth"', isRegex: false, created: 0 }
      ];

      const csv = service.rulesToCSV(rules);
      const lines = csv.split('\n');

      // "Hello, World","Hi ""Earth""",false
      expect(lines[1]).toBe('"Hello, World","Hi ""Earth""",false');
    });
  });

  describe('csvToRules', () => {
    it('should parse a simple CSV correctly', () => {
      const csv = `Original,Replacement,IsRegex
Hello,Hi,false
World,Earth,true`;

      const rules = service.csvToRules(csv);

      expect(rules).toHaveLength(2);
      expect(rules[0]).toEqual({ original: 'Hello', replacement: 'Hi', isRegex: false });
      expect(rules[1]).toEqual({ original: 'World', replacement: 'Earth', isRegex: true });
    });

    it('should handle quoted fields correctly', () => {
      const csv = `Original,Replacement,IsRegex
"Hello, World","Hi ""Earth""",false`;

      const rules = service.csvToRules(csv);

      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual({ original: 'Hello, World', replacement: 'Hi "Earth"', isRegex: false });
    });

    it('should throw error on invalid header', () => {
      const csv = `Wrong,Header,Here
Hello,Hi,false`;

      expect(() => service.csvToRules(csv)).toThrow('Invalid CSV header');
    });

    it('should ignore empty lines', () => {
        const csv = `Original,Replacement,IsRegex
Hello,Hi,false

World,Earth,true
`;
        const rules = service.csvToRules(csv);
        expect(rules).toHaveLength(2);
    });
  });
});
