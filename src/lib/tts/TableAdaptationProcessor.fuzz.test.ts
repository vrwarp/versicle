import { describe, it, expect } from 'vitest';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { SentenceNode } from '../tts';
import { SeededRandom } from '../../test/fuzz-utils';

const DEFAULT_FUZZ_SEED = 12345;

describe('TableAdaptationProcessor Fuzz Test', () => {
    it('mapSentencesToAdaptations should handle randomized inputs gracefully', () => {
        const processor = new TableAdaptationProcessor();
        const prng = new SeededRandom(DEFAULT_FUZZ_SEED);

        const generateCfi = () => {
            return `epubcfi(/${prng.nextInt(2, 20)}/${prng.nextInt(1, 10)}!/${prng.nextInt(4, 10)}/${prng.nextInt(1, 5)})`;
        };

        const generateRangeCfi = () => {
            const parent = `/${prng.nextInt(2, 20)}/${prng.nextInt(1, 10)}!/${prng.nextInt(4, 10)}`;
            const start = `/${prng.nextInt(1, 3)}`;
            const end = `/${prng.nextInt(4, 6)}`;
            return `epubcfi(${parent},${start},${end})`;
        };

        for (let iter = 0; iter < 50; iter++) {
            const adaptationsMap = new Map<string, string>();
            const rootsCount = prng.nextInt(1, 5);
            for (let i = 0; i < rootsCount; i++) {
                const root = prng.next() > 0.5 ? generateRangeCfi() : generateCfi();
                adaptationsMap.set(root, `Adaptation ${i}`);
            }

            const sentences: SentenceNode[] = [];
            const sentencesCount = prng.nextInt(10, 50);
            for (let i = 0; i < sentencesCount; i++) {
                sentences.push({
                    text: `Sentence ${i}`,
                    cfi: prng.next() > 0.2 ? generateCfi() : undefined
                });
            }

            // Should not throw
            const result = processor.mapSentencesToAdaptations(sentences, adaptationsMap);

            // Basic validation
            expect(Array.isArray(result)).toBe(true);
            result.forEach(mapping => {
                expect(Array.isArray(mapping.indices)).toBe(true);
                expect(typeof mapping.text).toBe('string');
            });
        }
    });
});
