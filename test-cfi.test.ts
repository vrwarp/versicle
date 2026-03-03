import { describe, it } from 'vitest';
import { generateCfiRange, tryFastMergeCfi } from './src/lib/cfi-utils';

describe('CFI merging', () => {
    it('generateCfiRange long', () => {
        const result = generateCfiRange('epubcfi(/6/28!/4/2/14/1:1)', 'epubcfi(/6/28!/4/2/14/2/2/80/4/2/1:7)');
        console.log('generateCfiRange long:', result);
    });

    it('tryFastMergeCfi point-point', () => {
        const left = 'epubcfi(/6/28!/4/2/14/1:1)';
        const right = 'epubcfi(/6/28!/4/2/14/2/2/80/4/2/1:7)';
        console.log('tryFastMergeCfi point-point:', tryFastMergeCfi(left, right));
    });
});
