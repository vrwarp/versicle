import { describe, it } from 'vitest';
import ePub from 'epubjs';

describe('epub.js behavior', () => {
    it('checks for cfiFromNode on Contents or EpubCFI constructor', () => {
        // We just need to check if EpubCFI constructor takes a node.
        // And if contents has cfiFromNode.
        console.log("EpubCFI prototype:", Object.keys(ePub.CFI.prototype));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.log("Contents prototype:", Object.keys((ePub as any).Contents?.prototype || {}));
    });
});
