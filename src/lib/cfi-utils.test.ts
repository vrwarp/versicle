import { describe, it, expect } from 'vitest';
import { getParentCfi } from './cfi-utils';

describe('getParentCfi', () => {
    // Base Cases
    it('should return "unknown" for empty inputs', () => {
        expect(getParentCfi('')).toBe('unknown');
        // @ts-ignore
        expect(getParentCfi(null)).toBe('unknown');
        // @ts-ignore
        expect(getParentCfi(undefined)).toBe('unknown');
    });

    // Range CFI
    it('should extract parent from range CFI', () => {
        const cfi = 'epubcfi(/6/14[chapter1]!/4/2,1:0,1:5)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14[chapter1]!/4/2)');
    });

    // Standard Point CFI
    it('should extract parent block from point CFI (simple)', () => {
        const cfi = 'epubcfi(/6/14!/4/1:0)';
        // cleanParts: ['4', '1:0'] -> pop -> ['4']
        // Result: epubcfi(/6/14!/4)
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14!/4)');
    });

    it('should extract parent block from deeper point CFI', () => {
        const cfi = 'epubcfi(/6/14[chapter1]!/4/2/3/1:0)'; // Body -> Div -> P -> Text
        // cleanParts: ['4', '2', '3', '1:0'] -> pop -> ['4', '2', '3']
        // length 3 (not > 3) -> keep.
        // Result: epubcfi(/6/14[chapter1]!/4/2/3)
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14[chapter1]!/4/2/3)');
    });

    // Heuristic Logic Tests
    it('should aggressively strip deeply nested inline elements', () => {
        // Example: /Body/Div/P/Span/Text -> /Body/Div/P
        // Path: /4/2/3/5/1:0
        // cleanParts: ['4', '2', '3', '5', '1:0'] -> pop -> ['4', '2', '3', '5']
        // length 4 > 3 -> pop -> ['4', '2', '3']
        const cfi = 'epubcfi(/6/14!/4/2/3/5/1:0)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14!/4/2/3)');
    });

    it('should handle root-level elements', () => {
        const cfi = 'epubcfi(/6/14!/4/1:0)';
        // cleanParts: ['4', '1:0'] -> pop -> ['4']
        // Result: epubcfi(/6/14!/4)
        // This effectively means "The element 4 inside the spine item".
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14!/4)');
    });

    it('should handle just spine item', () => {
        const cfi = 'epubcfi(/6/14!)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14!)');
    });

    // Fuzzing / Edge Cases
    it('should handle malformed CFIs gracefully by returning original', () => {
        const badCfi = 'invalid-cfi-string';
        expect(getParentCfi(badCfi)).toBe(badCfi);
    });

    it('should handle CFIs without text offsets', () => {
        const cfi = 'epubcfi(/6/14!/4/2/1)';
        // cleanParts: ['4', '2', '1'] -> pop '1' -> ['4', '2']
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/14!/4/2)');
    });

    it('should handle random fuzz inputs without crashing', () => {
        const inputs = [
            'epubcfi()',
            'epubcfi(!)',
            'epubcfi(/a/b!/c)',
            'epubcfi(/6/14!///)',
            'epubcfi(/6/14!/4/2/1:)',
        ];
        inputs.forEach(input => {
            expect(() => getParentCfi(input)).not.toThrow();
            const result = getParentCfi(input);
            expect(typeof result).toBe('string');
        });
    });
});
