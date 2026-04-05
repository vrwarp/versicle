import * as fs from 'fs';
const content = fs.readFileSync('src/lib/cfi-utils.fast-merge.test.ts', 'utf8');

const target = `        it('merges Point + Point (common parent)', () => {`;

const replacement = `        it('merges Point + Point (deep divergence)', () => {
            const left = \`epubcfi(/6/14[chapter1]!/4:0)\`;
            const right = \`epubcfi(/6/14[chapter1]!/5:0)\`;
            const fastMerged = tryFastMergeCfi(left, right);

            // Explicitly check the string output to ensure fast merge built it directly and preserves !
            expect(fastMerged).toBe(\`epubcfi(/6/14[chapter1]!,/4:0,/5:0)\`);

            const expected = mergeCfiSlow(left, right);
            assertCfiEqual(fastMerged, expected);
        });

        it('merges Point + Point (common parent)', () => {`;

fs.writeFileSync('src/lib/cfi-utils.fast-merge.test.ts', content.replace(target, replacement));
