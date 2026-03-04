import { describe, it, expect } from 'vitest';
import { TableAdaptationProcessor } from './TableAdaptationProcessor';
import { SentenceNode } from '../tts';
import { SeededRandom } from '../../test/fuzz-utils';

const DEFAULT_FUZZ_SEED = 12345;

describe('TableAdaptationProcessor Fuzz Test', () => {
    it('mapSentencesToAdaptations should accurately match synthetic structural hierarchies', () => {
        const processor = new TableAdaptationProcessor();
        const prng = new SeededRandom(DEFAULT_FUZZ_SEED);

        for (let iter = 0; iter < 100; iter++) {
            const adaptationsMap = new Map<string, string>();
            const sentences: SentenceNode[] = [];
            const expectedMapping = new Map<number, string>();

            const spine = prng.nextInt(2, 20) * 2;
            const maxElements = prng.nextInt(10, 50);

            const numTables = prng.nextInt(1, 5);
            const tables: { parent: string, startChild: number, endChild: number, type: 'range' | 'point', text: string, root: string }[] = [];

            for (let t = 0; t < numTables; t++) {
                const parent = `/${spine}/14!/4/${prng.nextInt(1, 10) * 2}`;

                if (tables.some(tbl => tbl.parent === parent)) continue;

                const isRange = prng.next() > 0.5;
                const startChild = prng.nextInt(1, 5) * 2;
                const endChild = isRange ? startChild + prng.nextInt(1, 3) * 2 : startChild;
                const text = `Table Data ${t}`;

                const root = isRange ? `epubcfi(${parent},/${startChild},/${endChild})` : `epubcfi(${parent}/${startChild})`;

                tables.push({
                    parent,
                    startChild,
                    endChild,
                    type: isRange ? 'range' : 'point',
                    text,
                    root
                });

                adaptationsMap.set(root, text);
            }

            for (let i = 0; i < maxElements; i++) {
                const inTable = prng.next() > 0.5 && tables.length > 0;
                let cfi = '';

                if (inTable) {
                    const table = prng.nextElement(tables);
                    // generate an EVEN child node in range
                    let childNode = table.startChild;
                    if (table.type === 'range') {
                        // Generate a valid even number child node inside the bounds
                        // Note: EpubCFI compare says epubcfi(/.../10/1:0) > epubcfi(/.../10).
                        // So a descendant of the endChild is OUTSIDE the bounds `compare <= 0`.
                        // Therefore, we must strictly generate childNode < endChild, or if it is endChild, it must not have descendants.
                        // Since we append `/1:0`, it must be strictly less than endChild.
                        const maxExclusive = Math.max(table.startChild, table.endChild - 2);
                        if (maxExclusive >= table.startChild) {
                            childNode = table.startChild + prng.nextInt(0, (maxExclusive - table.startChild) / 2) * 2;
                        }
                    }

                    cfi = `epubcfi(${table.parent}/${childNode}/1:0)`;
                    expectedMapping.set(i, table.text);

                } else {
                    const randomParent = `/${spine}/14!/4/${prng.nextInt(11, 30) * 2}`;
                    cfi = `epubcfi(${randomParent}/${prng.nextInt(1, 10) * 2}/1:0)`;
                }

                const hasCfi = prng.next() > 0.1;
                sentences.push({
                    text: `Sentence ${i}`,
                    cfi: hasCfi ? cfi : undefined
                });

                if (!hasCfi && expectedMapping.has(i)) {
                    expectedMapping.delete(i);
                }
            }

            const trickyStrings = [
                'epubcfi(/invalid)',
                'not-a-cfi',
                '',
                'epubcfi(/6/14!/4/2/1:0) trailing garbage',
                'epubcfi(/6/14!/4,/2/1:0,/4)'
            ];

            for (const tricky of trickyStrings) {
                sentences.push({
                    text: 'Tricky',
                    cfi: prng.next() > 0.5 ? tricky : undefined
                });
            }

            const result = processor.mapSentencesToAdaptations(sentences, adaptationsMap);

            const actualMapping = new Map<number, string>();
            for (const res of result) {
                for (const idx of res.indices) {
                    actualMapping.set(idx, res.text);
                }
            }

            for (const [expectedIdx, expectedText] of expectedMapping.entries()) {
                if (actualMapping.get(expectedIdx) !== expectedText) {
                    console.log("Failed at iter", iter, "idx", expectedIdx);
                    console.log("Sentence CFI:", sentences[expectedIdx].cfi);
                    const tbl = tables.find(t => t.text === expectedText);
                    console.log("Table info:", tbl);
                }
                expect(actualMapping.get(expectedIdx)).toBe(expectedText);
            }

            for (let i = 0; i < sentences.length; i++) {
                if (!expectedMapping.has(i) && sentences[i].cfi && !sentences[i].cfi!.includes('invalid') && !sentences[i].cfi!.includes('Tricky')) {
                    if (!trickyStrings.includes(sentences[i].cfi!)) {
                         expect(actualMapping.has(i)).toBe(false);
                    }
                }
            }
        }
    });
});
