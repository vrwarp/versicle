import { describe, it, expect } from 'vitest';
import type { NavigationItem } from '~types/book';
import { chooseTocSource, isLowQualityLabel, junkLabelRate, repairTocLabels } from './tocLabels';

describe('isLowQualityLabel', () => {
  it.each([
    '',
    '   ',
    '*FIX_When I Don’t Desire God.543173.int',
    'Untitled',
    'ch01.xhtml',
    'part0003_split_001.html',
    'Chapter 7',
    'chapter 7.',
    'Ch. 12',
    'CHAPTER XII',
    'Part II',
    '7',
    'XIV',
    '---',
  ])('junk: %j', (label) => {
    expect(isLowQualityLabel(label)).toBe(true);
  });

  it.each([
    'Chapter 1 Why I Wrote This Book',
    'Part One',
    'Epilogue',
    'Mix', // a word made of roman-numeral letters is still a word
    'I, Robot',
    'The Middle',
  ])('fine: %j', (label) => {
    expect(isLowQualityLabel(label)).toBe(false);
  });
});

describe('repairTocLabels', () => {
  const toc: NavigationItem[] = [
    { id: '1', href: 'a.xhtml', label: 'Chapter 1' },
    { id: '2', href: 'b.xhtml#x', label: 'Chapter 2' },
    { id: '3', href: 'c.xhtml', label: 'Chapter 3' },
    { id: '4', href: 'd.xhtml', label: 'Real Title' },
  ];

  it('replaces junk labels from another source with the same target', () => {
    const out = repairTocLabels(toc, [
      [
        { id: 'n1', href: 'a.xhtml', label: 'The Beginning' },
        { id: 'n2', href: 'b.xhtml#x', label: 'The Middle' },
        { id: 'n4', href: 'd.xhtml', label: 'Other Title' },
      ],
    ]);
    expect(out.map((i) => i.label)).toEqual(['The Beginning', 'The Middle', 'Chapter 3', 'Real Title']);
  });

  it('uses derived chapter titles last, never truncated prose or junk', () => {
    const titles = new Map([
      ['c.xhtml', 'The Long Road'],
      ['a.xhtml', 'It was a dark and stormy night and the rain fell in torrents...'],
      ['d.xhtml', 'Chapter 4'],
    ]);
    const out = repairTocLabels(toc, [], titles);
    expect(out.map((i) => i.label)).toEqual(['Chapter 1', 'Chapter 2', 'The Long Road', 'Real Title']);
  });

  it('never takes a fragment entry’s label from a different anchor of the same file', () => {
    const out = repairTocLabels(toc, [[{ id: 'n', href: 'b.xhtml', label: 'Whole File' }]]);
    expect(out[1].label).toBe('Chapter 2');
  });

  it('treats an all-identical tree as junk and ignores junk alternatives', () => {
    const fix = [1, 2, 3].map((n) => ({ id: `${n}`, href: `${n}.xhtml`, label: 'Same' }));
    expect(junkLabelRate(fix)).toBe(1);
    const out = repairTocLabels(toc, [fix]);
    expect(out).toEqual(toc);
  });
});

describe('chooseTocSource', () => {
  const good = (prefix: string, n: number): NavigationItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, href: `c${i}.xhtml`, label: `Title ${prefix}${i}` }));

  it('keeps the nav when it is as good as the NCX', () => {
    expect(chooseTocSource([{ kind: 'nav', items: good('n', 3) }, { kind: 'ncx', items: good('x', 3) }]).source).toBe(
      'nav',
    );
  });

  it('T8: falls back to the NCX when the nav is empty', () => {
    expect(chooseTocSource([{ kind: 'nav', items: [] }, { kind: 'ncx', items: good('x', 2) }]).source).toBe('ncx');
  });

  it('switches when the NCX reaches more of the spine', () => {
    expect(chooseTocSource([{ kind: 'nav', items: good('n', 2) }, { kind: 'ncx', items: good('x', 5) }]).source).toBe(
      'ncx',
    );
  });

  it('keeps a nav with a few dead links over a flatter NCX', () => {
    const nav = [...good('n', 3), { id: 'dead', href: 'gone.xhtml', label: 'Gone', unresolved: true }];
    expect(chooseTocSource([{ kind: 'nav', items: nav }, { kind: 'ncx', items: good('x', 3) }]).source).toBe('nav');
  });

  it('switches away from a mostly broken nav', () => {
    const nav = good('n', 3).map((i, k) => (k > 0 ? { ...i, unresolved: true } : i));
    expect(chooseTocSource([{ kind: 'nav', items: nav }, { kind: 'ncx', items: good('x', 1) }]).source).toBe('ncx');
  });

  it('T7: merges good nav labels onto junk NCX labels and reports the repair', () => {
    const ncx = [0, 1, 2, 3].map((i) => ({ id: `x${i}`, href: `c${i}.xhtml`, label: '*FIX_Book.1.int' }));
    const nav = good('n', 2);
    const choice = chooseTocSource([{ kind: 'nav', items: nav }, { kind: 'ncx', items: ncx }]);
    // NCX reaches more of the spine, so it supplies the structure…
    expect(choice.source).toBe('ncx');
    // …and the nav supplies the labels it has.
    expect(choice.toc.map((i) => i.label)).toEqual(['Title n0', 'Title n1', '*FIX_Book.1.int', '*FIX_Book.1.int']);
    expect(choice.junkRateBefore).toBe(1);
    expect(choice.junkRateAfter).toBeCloseTo(0.5);
  });

  it('returns an empty choice when no source has entries', () => {
    expect(chooseTocSource([{ kind: 'nav', items: [] }])).toMatchObject({ toc: [], source: null });
  });
});
