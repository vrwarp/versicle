/**
 * DOM-Range → CFI generation, ported verbatim from src/lib/cfi-utils.ts
 * (the epubjs constructor call goes through the shim).
 */
import { cfiFromRange } from './epubcfiShim';
import { stripCfiWrapper } from './parse';

/**
 * Generates a CFI string for a given DOM Range relative to a base Spine CFI.
 * This is used for decoupled extraction where we don't have a rendered view.
 *
 * @param range - The DOM Range to generate a CFI for.
 * @param baseCfi - The base CFI for the spine item (e.g. "epubcfi(/6/14[chapter1_id]!)").
 * @returns A full CFI string (e.g. "epubcfi(/6/14[chapter1_id]!/4/2/1:0,/4/2/1:10)").
 */
export function generateEpubCfi(range: Range, baseCfi: string): string {
    try {
        let baseComponent = stripCfiWrapper(baseCfi);

        // Take the part before '!' if present
        if (baseComponent.includes('!')) {
            baseComponent = baseComponent.split('!')[0];
        }

        return cfiFromRange(range, baseComponent);
    } catch (e) {
        console.error("Error generating CFI", e);
        return "";
    }
}
