import { describe, it } from 'vitest';
import ePub from 'epubjs';

describe('epub.js behavior', () => {
    it('checks for cfiFromNode on Contents or EpubCFI constructor', () => {
        // We just need to check if EpubCFI constructor takes a node.
        // And if contents has cfiFromNode.
        console.log("EpubCFI prototype:", Object.keys(ePub.CFI.prototype));
        console.log("Contents prototype:", Object.keys((ePub as unknown as { Contents?: { prototype: unknown } }).Contents?.prototype || {}));
    });
});
