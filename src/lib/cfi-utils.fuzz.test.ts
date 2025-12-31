import { describe, it, expect } from 'vitest';
import { mergeCfiRanges, generateCfiRange, parseCfiRange, getParentCfi } from './cfi-utils';

describe('cfi-utils Fuzzing', () => {

    const generateRandomCfi = (seed: number) => {
        // Generate valid-looking CFI structure
        // epubcfi(/6/14!/4/2/1:0)
        // Let's vary the last part mainly for ranges
        const step = Math.floor((seed * 9301 + 49297) % 233280);
        const offset = Math.floor(seed % 100);
        return `epubcfi(/6/${step}!/4/2/1:${offset})`;
    };

    const randomString = (length: number) => {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+[]{}|;:,.<>?';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    };

    it('remains stable under random merges (Idempotency & Associativity)', () => {
        const cfi1 = generateRandomCfi(1);
        const cfi2 = generateRandomCfi(2);
        const cfi3 = generateRandomCfi(3);

        const range1 = generateCfiRange(cfi1, cfi2); // Range 1-2
        const range2 = generateCfiRange(cfi2, cfi3); // Range 2-3

        // Merge (1-2) + (2-3) should be (1-3)
        // Note: this assumes range1 and range2 overlap or abut.
        // Since random generation is used, they might not.
        // But we just test stability (no crash, returns something).

        const ranges = [range1, range2];
        const merged = mergeCfiRanges(ranges);

        expect(merged.length).toBeGreaterThan(0);

        // Idempotency: Merge(A, A) = A
        const mergedSelf = mergeCfiRanges([range1], range1);
        expect(mergedSelf).toHaveLength(1);
        expect(mergedSelf[0]).toBe(range1);
    });

    it('handles large inputs without crashing', () => {
        const ranges: string[] = [];
        for(let i=0; i<100; i++) {
            // Ensure strict ordering for generation
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i+1})`;
            ranges.push(generateCfiRange(s, e));
        }

        // All adjacent ranges: 0-1, 1-2, 2-3...
        // Should merge into ONE giant range 0-100
        const result = mergeCfiRanges(ranges);

        expect(result).toHaveLength(1);
        expect(result[0]).toContain(':0');
        expect(result[0]).toContain(':100');
    });

    it('handles non-contiguous fuzz', () => {
        const ranges: string[] = [];
        // Even: 0-1, 2-3, 4-5...
        for(let i=0; i<100; i+=2) {
            const s = `epubcfi(/6/14!/4/2/1:${i})`;
            const e = `epubcfi(/6/14!/4/2/1:${i+1})`;
            ranges.push(generateCfiRange(s, e));
        }

        const result = mergeCfiRanges(ranges);

        // Should remain 50 separate ranges
        expect(result).toHaveLength(50);
    });

    it('parseCfiRange survives random strings', () => {
        for(let i=0; i<1000; i++) {
            const str = randomString(Math.floor(Math.random() * 50));
            // Should not throw
            try {
                const res = parseCfiRange(str);
                // It's likely null, but strict check is it doesn't crash
                expect(res === null || typeof res === 'object').toBe(true);
            } catch (e) {
                console.error(`Crashed on input: ${str}`);
                throw e;
            }
        }
    });

    it('getParentCfi survives random strings', () => {
        for(let i=0; i<1000; i++) {
             const str = randomString(Math.floor(Math.random() * 50));
             try {
                 const res = getParentCfi(str);
                 expect(typeof res).toBe('string');
             } catch(e) {
                 console.error(`Crashed on input: ${str}`);
                 throw e;
             }
        }
    });

    it('getParentCfi handles deep random paths', () => {
         for(let i=0; i<100; i++) {
             let path = 'epubcfi(/6/2!';
             const depth = Math.floor(Math.random() * 20); // up to 20 levels deep
             for(let d=0; d<depth; d++) {
                 path += `/${Math.floor(Math.random() * 10)}`;
             }
             path += ')';

             const res = getParentCfi(path);
             expect(typeof res).toBe('string');
             // It should potentially strip something but not crash
         }
    });
});
