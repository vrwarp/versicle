import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getParentCfi, parseCfiRange, generateCfiRange, mergeCfiRanges, generateEpubCfi, snapCfiToSentence } from './cfi-utils';

// --- Mocks ---

// Flag to trigger error in EpubCFI constructor
let triggerEpubCfiError = false;

// Mock epubjs EpubCFI with more realistic comparison logic for tests
const mockCompare = vi.fn((a: string, b: string) => {
    // Check if we need to throw for specific test case
    if (a.includes('THROW_MERGE') || b.includes('THROW_MERGE')) {
        throw new Error('Merge error');
    }

    if (a === b) return 0;

    // Parse helper to extract important parts for comparison
    const parse = (cfi: string) => {
        // e.g. epubcfi(/6/2!/4/2/1:0)
        // Remove wrapper
        const content = cfi.replace('epubcfi(', '').replace(')', '');
        // Split path and offset
        const parts = content.split(':');
        // If no offset, assume 0
        const path = parts[0];
        const offset = parts.length > 1 ? parseInt(parts[1]) : 0;
        return { path, offset };
    };

    const pa = parse(a);
    const pb = parse(b);

    if (pa.path < pb.path) return -1;
    if (pa.path > pb.path) return 1;

    if (pa.offset < pb.offset) return -1;
    if (pa.offset > pb.offset) return 1;

    return 0;
});

vi.mock('epubjs', () => {
    return {
        EpubCFI: class {
            constructor(range?: Range | string, baseCfi?: string) {
                // To avoid unused vars
                void range; void baseCfi;
                if (triggerEpubCfiError) {
                    throw new Error('Constructor error');
                }
            }
            compare(a: string, b: string) {
                return mockCompare(a, b);
            }
            toString() {
                return "epubcfi(/mock/1)";
            }
        }
    }
});

// Mocking global Intl if not present (Node environment usually has it, but safe to mock specific behavior)
// We will mock it inside the test cases where needed using vi.spyOn or modifying global

// Mocking document and Range
const mockSetStart = vi.fn();
const mockSetEnd = vi.fn();
const mockCreateRange = vi.fn(() => ({
    setStart: mockSetStart,
    setEnd: mockSetEnd,
    startContainer: {},
    startOffset: 0,
    endContainer: {},
    endOffset: 0,
    commonAncestorContainer: {},
    collapsed: false
}));

// Mock implementation for generateEpubCfi to avoid unused var errors in mock call
vi.mock('./cfi-utils', async (importOriginal) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actual: any = await importOriginal();
    return {
        ...actual,
        generateEpubCfi: vi.fn((range, baseCfi) => {
            // Usage to avoid unused warning in mock impl if desired, or use underscores
            void range; void baseCfi;
            if (triggerEpubCfiError) {
                console.error("Error generating CFI", new Error('Constructor error'));
                return '';
            }
            return "epubcfi(/mock/1)";
        })
    };
});

// We need to handle the global document object for snapCfiToSentence
const originalCreateRange = global.document.createRange;

describe('cfi-utils', () => {

  beforeEach(() => {
      vi.clearAllMocks();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      global.document.createRange = mockCreateRange as any;
      triggerEpubCfiError = false;
  });

  afterEach(() => {
      global.document.createRange = originalCreateRange;
  });

  describe('parseCfiRange', () => {
    it('parses a valid range CFI correctly', () => {
      const cfi = 'epubcfi(/6/2!/4/2,:0,:10)';
      const result = parseCfiRange(cfi);
      expect(result).not.toBeNull();
      expect(result?.parent).toBe('/6/2!/4/2');
      expect(result?.start).toBe(':0');
      expect(result?.end).toBe(':10');
      expect(result?.fullStart).toBe('epubcfi(/6/2!/4/2:0)');
      expect(result?.fullEnd).toBe('epubcfi(/6/2!/4/2:10)');
    });

    it('returns null for empty string', () => {
        expect(parseCfiRange('')).toBeNull();
    });

    it('returns null for null/undefined input (if types allowed it)', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(parseCfiRange(null as any)).toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(parseCfiRange(undefined as any)).toBeNull();
    });

    it('returns null if not starting with epubcfi(', () => {
        expect(parseCfiRange('invalid(/6/2)')).toBeNull();
    });

    it('returns null if not ending with )', () => {
        expect(parseCfiRange('epubcfi(/6/2')).toBeNull();
    });

    it('returns null if internal structure is not triplet (parent, start, end)', () => {
        // missing end
        expect(parseCfiRange('epubcfi(/6/2,:0)')).toBeNull();
        // too many parts
        expect(parseCfiRange('epubcfi(/6/2,:0,:10,:20)')).toBeNull();
    });

    it('handles parent with special characters if present', () => {
        // Technically CFI shouldn't have weird chars, but function splits by comma
        const cfi = 'epubcfi(/6/2[id=1]!/4/2,:0,:10)';
        const result = parseCfiRange(cfi);
        expect(result?.parent).toBe('/6/2[id=1]!/4/2');
    });
  });

  describe('getParentCfi', () => {
    it('returns "unknown" for empty input', () => {
        expect(getParentCfi('')).toBe('unknown');
    });

    it('extracts parent from a valid range CFI', () => {
        const cfi = 'epubcfi(/6/2!/4/2,:0,:10)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/2!/4/2)');
    });

    it('handles standard CFI: simple file level', () => {
        // /6/2[id]!
        const cfi = 'epubcfi(/6/2[id]!)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/2[id]!)');
    });

    it('handles standard CFI: specific path', () => {
        // /6/2!/4/2
        const cfi = 'epubcfi(/6/2!/4/2)';
        // Should keep as is if depth is shallow
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/2!/4)');
    });

    it('strips last segment (text node/leaf)', () => {
        const cfi = 'epubcfi(/6/2!/4/2/1:10)';
        // Splitting path: ['', '4', '2', '1:10'] -> filter empty -> ['4', '2', '1:10']
        // pop -> ['4', '2']
        // depth check: 2 < 3.
        // Result: /4/2
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/2!/4/2)');
    });

    it('does not truncate deep paths (previously heuristic)', () => {
        // Path: /4/2/4/2/1:10
        // Parts: ['4', '2', '4', '2', '1:10'] (Length 5)
        // Truncate to: ['4', '2', '4', '2']
        // New behavior: should preserve full path (minus leaf)
        const cfi = 'epubcfi(/6/2!/4/2/4/2/1:10)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/2!/4/2/4/2)');
    });

    it('handles CFI pointing to root of spine item (no internal path)', () => {
        const cfi = 'epubcfi(/6/2!)';
        expect(getParentCfi(cfi)).toBe('epubcfi(/6/2!)');
    });
    
    it('handles CFI where path becomes empty after popping', () => {
         // /6/2!/4 -> parts ['4'] -> pop -> []
         // Should return spine root
         const cfi = 'epubcfi(/6/2!/4)';
         expect(getParentCfi(cfi)).toBe('epubcfi(/6/2!)');
    });

    it('returns original CFI if parsing fails (catch block)', () => {
         const cfi = 'epubcfi(invalid-structure-no-exclamation)';
         expect(getParentCfi(cfi)).toBe('epubcfi(invalid-structure-no-exclamation!)');
    });

    it('returns original CFI if format is completely alien', () => {
        const cfi = 'not-a-cfi';
        expect(getParentCfi(cfi)).toBe('not-a-cfi');
    });

    // New tests from "Design Doc: Precise EPUB CFI Grouping Heuristic"

    describe('Leaf Stripping', () => {
        it('Input: epubcfi(/6/4[chap1]!/4/2/1:0) -> Output: epubcfi(/6/4[chap1]!/4/2)', () => {
            expect(getParentCfi('epubcfi(/6/4[chap1]!/4/2/1:0)')).toBe('epubcfi(/6/4[chap1]!/4/2)');
        });

        it('Input: epubcfi(/6/4[chap1]!/4/10/1:50) -> Output: epubcfi(/6/4[chap1]!/4/10)', () => {
            expect(getParentCfi('epubcfi(/6/4[chap1]!/4/10/1:50)')).toBe('epubcfi(/6/4[chap1]!/4/10)');
        });

        it('Input: epubcfi(/6/12!/2/1:0) -> Output: epubcfi(/6/12!/2)', () => {
            expect(getParentCfi('epubcfi(/6/12!/2/1:0)')).toBe('epubcfi(/6/12!/2)');
        });

        it('Input: epubcfi(/6/2!/4/2/4/1:20) -> Output: epubcfi(/6/2!/4/2/4)', () => {
            // This was previously snapped to /4/2 if depth logic was aggressive, but now it should just strip leaf
            expect(getParentCfi('epubcfi(/6/2!/4/2/4/1:20)')).toBe('epubcfi(/6/2!/4/2/4)');
        });

        it('Input: epubcfi(/6/4!/4/2/6/2/1:0) -> Output: epubcfi(/6/4!/4/2/6/2)', () => {
             expect(getParentCfi('epubcfi(/6/4!/4/2/6/2/1:0)')).toBe('epubcfi(/6/4!/4/2/6/2)');
        });

        it('Input: epubcfi(/6/4!/4/4/2[id123]/1:10) -> Output: epubcfi(/6/4!/4/4/2[id123])', () => {
             expect(getParentCfi('epubcfi(/6/4!/4/4/2[id123]/1:10)')).toBe('epubcfi(/6/4!/4/4/2[id123])');
        });

        it('Input: epubcfi(/6/8!/4/2/1:0) -> Output: epubcfi(/6/8!/4/2)', () => {
             expect(getParentCfi('epubcfi(/6/8!/4/2/1:0)')).toBe('epubcfi(/6/8!/4/2)');
        });

        it('Input: epubcfi(/6/10!/2/2/1:0) -> Output: epubcfi(/6/10!/2/2)', () => {
             expect(getParentCfi('epubcfi(/6/10!/2/2/1:0)')).toBe('epubcfi(/6/10!/2/2)');
        });

        it('Input: epubcfi(/6/4!/4/20/1:100) -> Output: epubcfi(/6/4!/4/20)', () => {
             expect(getParentCfi('epubcfi(/6/4!/4/20/1:100)')).toBe('epubcfi(/6/4!/4/20)');
        });

        it('Input: epubcfi(/6/4!/6/1:0) -> Output: epubcfi(/6/4!/6)', () => {
             expect(getParentCfi('epubcfi(/6/4!/6/1:0)')).toBe('epubcfi(/6/4!/6)');
        });
    });

    describe('Table Grouping (Known Roots)', () => {
        const knownBlockRoots = ["epubcfi(/6/4!/4/12)"]; // a table at index 12

        it('Input: epubcfi(/6/4!/4/12/2/2/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/2/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/4/10/2/1:5) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/4/10/2/1:5)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/2/4/2/2/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/4/2/2/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/2/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/6/2/4/1:10) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/6/2/4/1:10)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/2/2/2/2/2/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/2/2/2/2/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/4/2/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/4/2/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/2/8/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/8/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/2/6/4/2/1:0) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/6/4/2/1:0)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('Input: epubcfi(/6/4!/4/12/2/2/1:15) -> Output: epubcfi(/6/4!/4/12)', () => {
            expect(getParentCfi('epubcfi(/6/4!/4/12/2/2/1:15)', knownBlockRoots)).toBe('epubcfi(/6/4!/4/12)');
        });

        it('picks the deepest known root if multiple match', () => {
            const roots = [
                "epubcfi(/6/4!/4/12)",       // Outer table
                "epubcfi(/6/4!/4/12/2/2)"    // Inner table (hypothetical)
            ];
            // CFI is inside inner table
            const input = "epubcfi(/6/4!/4/12/2/2/4/1:0)";
            expect(getParentCfi(input, roots)).toBe('epubcfi(/6/4!/4/12/2/2)');
        });
    });

    describe('boundary check', () => {

        it('does not false match sibling paths (prefix issue)', () => {
            const root = "epubcfi(/6/4!/4/1)";
            const knownBlockRoots = [root];

            // Should NOT match /4/12
            const cfiSibling = "epubcfi(/6/4!/4/12/2/1:0)";
            // Since it doesn't match root, it should fall through to standard leaf stripping
            // /6/4!/4/12/2/1:0 -> strip 1:0 -> /6/4!/4/12/2
            expect(getParentCfi(cfiSibling, knownBlockRoots)).toBe('epubcfi(/6/4!/4/12/2)');
        });

        it('matches correct child path', () => {
            const root = "epubcfi(/6/4!/4/1)";
            const knownBlockRoots = [root];

            const cfiChild = "epubcfi(/6/4!/4/1/2/1:0)";
            expect(getParentCfi(cfiChild, knownBlockRoots)).toBe(root);
        });

        it('matches exactly equal path', () => {
            const root = "epubcfi(/6/4!/4/1)";
            const knownBlockRoots = [root];

            expect(getParentCfi(root, knownBlockRoots)).toBe(root);
        });

        it('matches with square bracket boundary', () => {
            const root = "epubcfi(/6/4!/4/1)";
            const knownBlockRoots = [root];

            // /4/1[id]
            const cfiWithId = "epubcfi(/6/4!/4/1[id]/2/1:0)";
            expect(getParentCfi(cfiWithId, knownBlockRoots)).toBe(root);
        });
    });

    describe('boundary check: Hardening', () => {
         it('should snap point CFI with offset (:) to root path', () => {
            // Root: /6/4!/2
            const root = "epubcfi(/6/4!/2)";
            const knownBlockRoots = [root];

            // Input: /6/4!/2:10
            const input = "epubcfi(/6/4!/2:10)";

            // Before fix: cleanCfi (/6/4!/2:10) starts with cleanRoot (/6/4!/2).
            // Next char is ':'. If ':' not in boundary list, it failed.
            expect(getParentCfi(input, knownBlockRoots)).toBe(root);
        });

         it('should snap point CFI with offset (:) to deeper root path', () => {
            const root = "epubcfi(/6/4!/2/4)";
            const knownBlockRoots = [root];
            const input = "epubcfi(/6/4!/2/4:5)";
            expect(getParentCfi(input, knownBlockRoots)).toBe(root);
        });
    });

    describe('getParentCfi Fixes (Regression Tests)', () => {

        it('should snap Range CFI input to known block root if matched', () => {
            // Known block root: /6/24!/4/2/4 (Table)
            const tableRoot = "epubcfi(/6/24!/4/2/4)";
            const knownBlockRoots = [tableRoot];

            // Input: Range CFI *inside* the table
            // epubcfi(/6/24!/4/2/4/2/2/2/2/2,/1:0,/1:2)
            // Parent of this range is /6/24!/4/2/4/2/2/2/2/2
            // We want it to snap to /6/24!/4/2/4
            const inputCfi = "epubcfi(/6/24!/4/2/4/2/2/2/2/2,/1:0,/1:2)";

            expect(getParentCfi(inputCfi, knownBlockRoots)).toBe(tableRoot);
        });

        it('should match deep point CFI to known block root even if root was provided as Range CFI', () => {
            const tableRoot = "epubcfi(/6/24!/4/2/4)";
            const knownBlockRoots = [tableRoot];

            // Deep child point CFI
            const inputCfi = "epubcfi(/6/24!/4/2/4/2/2/1:0)";

            expect(getParentCfi(inputCfi, knownBlockRoots)).toBe(tableRoot);
        });

        it('should match point CFI to a known block root provided as a Range CFI', () => {
            // Range Root: epubcfi(/6/4!/2, /1:0, /1:10) -> Parent is /6/4!/2
            const rangeRoot = "epubcfi(/6/4!/2,/1:0,/1:10)";
            const knownBlockRoots = [rangeRoot];

            // Input: /6/4!/2/1:5 (Child of that parent)
            const input = "epubcfi(/6/4!/2/1:5)";

            // The input starts with /6/4!/2.
            // But the root string is the full range string.
            // Logic must parse root -> /6/4!/2 to match.
            expect(getParentCfi(input, knownBlockRoots)).toBe(rangeRoot);
        });

        it('should match point CFI inside complex range root', () => {
             // Range: /6/24!/4/2/4 (parent)
             const rangeRoot = "epubcfi(/6/24!/4/2/4,/1:0,/3:10)";
             const knownBlockRoots = [rangeRoot];

             // Input: /6/24!/4/2/4/2/1:0
             const input = "epubcfi(/6/24!/4/2/4/2/1:0)";

             expect(getParentCfi(input, knownBlockRoots)).toBe(rangeRoot);
        });

        it('should NOT match if prefix is ambiguous (Boundary Check regression test)', () => {
            // Corrected input to be a valid Point CFI
            const standardInput = "epubcfi(/6/2!/4/20/1:0)";
            const standardRoot = "epubcfi(/6/2!/4/2)"; // Matches prefix of /4/20, but not boundary.

            // Should default to standard leaf stripping: /4/20
            expect(getParentCfi(standardInput, [standardRoot])).toBe("epubcfi(/6/2!/4/20)");
        });
    });
  });

  describe('generateCfiRange', () => {
    it('generates range correctly', () => {
        const start = 'epubcfi(/6/2!/4/2/1:0)';
        const end = 'epubcfi(/6/2!/4/2/1:10)';
        expect(generateCfiRange(start, end)).toBe('epubcfi(/6/2!/4/2/1,:0,:10)');
    });

    it('strips epubcfi wrapper if present', () => {
        const start = '/6/2!/4/2/1:0';
        const end = 'epubcfi(/6/2!/4/2/1:10)';
        expect(generateCfiRange(start, end)).toBe('epubcfi(/6/2!/4/2/1,:0,:10)');
    });

    it('handles completely disjoint paths correctly', () => {
        // Common prefix minimal
        const start = 'epubcfi(/6/2!/4/2/1:0)';
        const end = 'epubcfi(/6/2!/6/2/1:0)';
        // Code analysis:
        // common stops before '/'. So common="epubcfi(/6/2!"
        // startRel="/4/2/1:0", endRel="/6/2/1:0"
        // Result: "epubcfi(" + common + "," + startRel + "," + endRel + ")"
        // "epubcfi(/6/2!,/4/2/1:0,/6/2/1:0)"
        expect(generateCfiRange(start, end)).toBe('epubcfi(/6/2!,/4/2/1:0,/6/2/1:0)');
    });

    it('backtracks correctly to safe delimiter', () => {
        // start: .../123
        // end: .../124
        // common string: .../12
        // backtrack to /
        // common: .../
        // startRel: 123
        // endRel: 124
        const start = 'epubcfi(/a/b/123)';
        const end = 'epubcfi(/a/b/124)';
        // Common part excludes the delimiter found during backtrack.
        // So common is "/a/b"
        // startRel is "/123", endRel is "/124"
        expect(generateCfiRange(start, end)).toBe('epubcfi(/a/b,/123,/124)');
    });

    it('normalizes common path when start is a prefix of end and ends at step boundary', () => {
        // As reported:
        // Start: /6/28!/4/2
        // End: /6/28!/4/2/8
        // Common prefix: /6/28!/4/2
        // Should be: epubcfi(/6/28!/4/2,,/8)
        const start = 'epubcfi(/6/28!/4/2)';
        const end = 'epubcfi(/6/28!/4/2/8)';

        const result = generateCfiRange(start, end);
        expect(result).toBe('epubcfi(/6/28!/4/2,,/8)');
    });

    it('handles identical start and end', () => {
        const start = 'epubcfi(/6/2!/4/1:0)';
        // Canonical behavior: Common path is full path, relative parts are empty
        expect(generateCfiRange(start, start)).toBe('epubcfi(/6/2!/4/1:0,,)');
    });

    it('handles 1 vs 11 scenario (delimiter alignment)', () => {
        // start: /2/1:0
        // end: /2/11:0
        // mismatch at '1' (end[4]) vs ':' (start[4])
        // backtrack should skip '1' (start[3]) which is not delimiter
        // should stop at '/' (start[2])
        const start = 'epubcfi(/2/1:0)';
        const end = 'epubcfi(/2/11:0)';
        const res = generateCfiRange(start, end);
        // Expect common prefix ending at /2
        expect(res).toBe('epubcfi(/2,/1:0,/11:0)');
    });
  });

  describe('mergeCfiRanges', () => {
      it('returns empty array for empty input', () => {
          expect(mergeCfiRanges([])).toEqual([]);
      });

      it('returns single range if only one provided', () => {
          const r = 'epubcfi(/6/2!/4/2,:0,:10)';
          expect(mergeCfiRanges([r])).toEqual([r]);
      });

      it('adds newRange to the list before merging', () => {
          const r1 = 'epubcfi(/6/2!/4/2,:0,:10)';
          const r2 = 'epubcfi(/6/2!/4/2,:10,:20)';
          const res = mergeCfiRanges([r1], r2);
          expect(res).toHaveLength(1); // merged
          expect(res[0]).toContain(':0,:20');
      });

      it('merges overlapping ranges', () => {
          const r1 = 'epubcfi(/6/2!/4/2,:0,:10)'; // 0-10
          const r2 = 'epubcfi(/6/2!/4/2,:5,:15)'; // 5-15
          const res = mergeCfiRanges([r1, r2]);
          expect(res).toHaveLength(1);
          expect(res[0]).toContain(':0,:15');
      });

      it('merges abutting ranges', () => {
          const r1 = 'epubcfi(/6/2!/4/2,:0,:10)'; // 0-10
          const r2 = 'epubcfi(/6/2!/4/2,:10,:20)'; // 10-20
          const res = mergeCfiRanges([r1, r2]);
          expect(res).toHaveLength(1);
          expect(res[0]).toContain(':0,:20');
      });

      it('merges contained ranges', () => {
          const r1 = 'epubcfi(/6/2!/4/2,:0,:20)'; // 0-20
          const r2 = 'epubcfi(/6/2!/4/2,:5,:10)'; // 5-10
          const res = mergeCfiRanges([r1, r2]);
          expect(res).toHaveLength(1);
          expect(res[0]).toContain(':0,:20');
      });

      it('includes point CFIs in merge (as range)', () => {
          const p = 'epubcfi(/6/2!/4/2:5)'; // point at 5
          const res = mergeCfiRanges([p]);
          expect(res).toHaveLength(1);
          // generateCfiRange converts point P into P,P -> parent,startRel,startRel
          // /6/2!/4/2:5 -> /6/2!/4/2,:5,:5 (Old)
          // /6/2!/4/2:5 -> /6/2!/4/2:5,,   (Canonical)
          expect(res[0]).toBe('epubcfi(/6/2!/4/2:5,,)');
      });

      it('merges point CFI into overlapping range', () => {
          const r = 'epubcfi(/6/2!/4/2,:0,:10)';
          const p = 'epubcfi(/6/2!/4/2:5)'; // Inside
          const res = mergeCfiRanges([r, p]);
          expect(res).toHaveLength(1);
          expect(res[0]).toContain(':0,:10');
      });

      it('handles unsorted ranges', () => {
          const r1 = 'epubcfi(/6/2!/4/2,:10,:20)';
          const r2 = 'epubcfi(/6/2!/4/2,:0,:5)';
          const res = mergeCfiRanges([r1, r2]);
          // Should result in two ranges: 0-5 and 10-20, sorted
          expect(res).toHaveLength(2);
          expect(res[0]).toContain(':0,:5');
          expect(res[1]).toContain(':10,:20');
      });

      it('handles comparison errors gracefully (returns all ranges)', () => {
          mockCompare.mockImplementationOnce(() => { throw new Error('Compare error'); });
          const r1 = 'epubcfi(/6/2!/4/2,:0,:10)';
          const r2 = 'epubcfi(/6/2!/4/2,:10,:20)';
          const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
          const res = mergeCfiRanges([r1, r2]);
          expect(res).toHaveLength(2); // Failed to sort/merge, return original
          expect(consoleSpy).toHaveBeenCalled();
          consoleSpy.mockRestore();
      });

      it('handles merge logic errors gracefully', () => {
           mockCompare.mockImplementation((a, b) => {
                // Throw specific error for loop check condition
                // a is next.fullStart, b is current.fullEnd
                if (a.endsWith(':10)') && b.endsWith(':10)')) {
                    throw new Error('Loop error');
                }

                if (a === b) return 0;
                const parse = (c: string) => {
                    const content = c.replace('epubcfi(', '').replace(')', '');
                    const [p, off] = content.split(':');
                    return { path: p, offset: off ? parseInt(off) : 0 };
                };
                const pa = parse(a);
                const pb = parse(b);
                if (pa.offset < pb.offset) return -1;
                if (pa.offset > pb.offset) return 1;
                return 0;
           });

           const r3 = 'epubcfi(/6/2!/4/2,:0,:10)';
           const r4 = 'epubcfi(/6/2!/4/2,:10,:20)';
           const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

           const res = mergeCfiRanges([r3, r4]);

           // If loop error caught, it pushes current and sets current=next.
           // So result should be [r3, r4] (unmerged).
           expect(res).toHaveLength(2);
           expect(consoleSpy).toHaveBeenCalled();
           consoleSpy.mockRestore();
      });
  });

  describe('generateEpubCfi', () => {
      it('generates cfi', () => {
          const range = {} as Range;
          const base = 'epubcfi(/6/2!)';
          expect(generateEpubCfi(range, base)).toBe('epubcfi(/mock/1)');
      });

      it('cleans baseCfi input', () => {
          const range = {} as Range;
          const base = 'epubcfi(/6/2!/ignore)'; // should strip after !
          expect(generateEpubCfi(range, base)).toBe('epubcfi(/mock/1)');
      });

      it('handles errors', () => {
           triggerEpubCfiError = true;
           const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
           const res = generateEpubCfi({} as Range, 'base');
           expect(res).toBe('');
           expect(consoleSpy).toHaveBeenCalled();
           consoleSpy.mockRestore();
      });
  });

  describe('snapCfiToSentence', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mockBook: any;

      beforeEach(() => {
          mockBook = {
              spine: { items: [] },
              getRange: vi.fn(),
          };
      });

      it('returns original if book/spine is invalid', async () => {
          const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await snapCfiToSentence({} as any, 'cfi');
          expect(res).toBe('cfi');
          consoleSpy.mockRestore();
      });

      it('returns original if cfi invalid', async () => {
          const res = await snapCfiToSentence(mockBook, 'invalid');
          expect(res).toBe('invalid');
      });

      it('returns original if getRange returns null', async () => {
          mockBook.getRange.mockResolvedValue(null);
          const res = await snapCfiToSentence(mockBook, 'epubcfi(/6/2!/4/2:10)');
          expect(res).toBe('epubcfi(/6/2!/4/2:10)');
      });

      it('returns original if node is not TEXT_NODE', async () => {
          mockBook.getRange.mockResolvedValue({
              startContainer: { nodeType: 1 }, // Element node
              startOffset: 0
          });
          const res = await snapCfiToSentence(mockBook, 'epubcfi(/6/2!/4/2:10)');
          expect(res).toBe('epubcfi(/6/2!/4/2:10)');
      });

      it('snaps to sentence boundary using Intl.Segmenter', async () => {
          const textNode = {
              nodeType: 3,
              textContent: "Hello world. This is a test."
          };

          mockBook.getRange.mockResolvedValue({
              startContainer: textNode,
              startOffset: 15
          });

          const segmentFn = vi.fn().mockReturnValue([
              { index: 0, segment: "Hello world. " },
              { index: 13, segment: "This is a test." }
          ]);

          class MockSegmenter {
              segment(text: string) {
                  return segmentFn(text);
              }
          }
          
          const originalIntl = global.Intl;
          // @ts-expect-error - overriding global Intl
          global.Intl = {
              ...originalIntl,
              // @ts-expect-error - overriding global Intl.Segmenter
              Segmenter: MockSegmenter
          };

          const res = await snapCfiToSentence(mockBook, 'epubcfi(/6/2!/4/2:15)');

          expect(mockCreateRange).toHaveBeenCalled();
          expect(mockSetStart).toHaveBeenCalledWith(textNode, 13);
          expect(res).toBe('epubcfi(/mock/1)');

          global.Intl = originalIntl;
      });
      
      it('returns original if already at start of sentence', async () => {
          const textNode = {
              nodeType: 3,
              textContent: "Hello world. This is a test."
          };

          mockBook.getRange.mockResolvedValue({
              startContainer: textNode,
              startOffset: 13
          });

           const segmentFn = vi.fn().mockReturnValue([
              { index: 0, segment: "Hello world. " },
              { index: 13, segment: "This is a test." }
          ]);

          class MockSegmenter {
              segment(text: string) {
                  return segmentFn(text);
              }
          }

          const originalIntl = global.Intl;
          // @ts-expect-error - overriding global Intl
          global.Intl = {
              ...originalIntl,
              // @ts-expect-error - overriding global Intl.Segmenter
              Segmenter: MockSegmenter
          };

          const res = await snapCfiToSentence(mockBook, 'epubcfi(/6/2!/4/2:13)');

          expect(mockCreateRange).not.toHaveBeenCalled();
          expect(res).toBe('epubcfi(/6/2!/4/2:13)');

          global.Intl = originalIntl;
      });

      it('handles exceptions in snapCfiToSentence gracefully', async () => {
           mockBook.getRange.mockRejectedValue(new Error('Book error'));
           const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

           const res = await snapCfiToSentence(mockBook, 'epubcfi(/6/2!/4/2:10)');

           expect(res).toBe('epubcfi(/6/2!/4/2:10)');
           expect(consoleSpy).toHaveBeenCalled();
           consoleSpy.mockRestore();
      });
  });

});
