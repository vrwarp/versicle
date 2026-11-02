import { describe, it, expect } from 'vitest';
import type { NavigationItem } from '~types/book';
import { chooseTocSource, isLowQualityLabel, junkLabelRate, repairTocLabels, tocDepth } from './tocLabels';

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

  it('never lends a grouping entry\u2019s label to the child whose href it borrowed', () => {
    // Nav: <span>Part One</span> groups "Chapter 1"; resolution gives the
    // group its first child's href, so both point at a.xhtml.
    const nav: NavigationItem[] = [
      { id: '', href: 'a.xhtml', label: 'Part One', subitems: [{ id: 'a', href: 'a.xhtml', label: 'Chapter 1' }] },
    ];
    const stored: NavigationItem[] = [
      { id: 'nav-0', href: 'a.xhtml', label: 'Part One', subitems: [{ id: 'a', href: 'a.xhtml', label: 'The Beginning' }] },
    ];
    expect(repairTocLabels(nav, [stored])[0].subitems?.[0].label).toBe('The Beginning');
    // Same outcome when ids differ: leaves are matched before groups.
    const renamed = [{ ...stored[0], subitems: [{ id: 'x', href: 'a.xhtml', label: 'The Beginning' }] }];
    expect(repairTocLabels(nav, [renamed])[0].subitems?.[0].label).toBe('The Beginning');
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

describe('regression: flat class-styled nav vs nested NCX (T11)', () => {
  // Same files, same headings: the nav lists them as siblings, the NCX as a tree.
  const flatNav: NavigationItem[] = [
    { id: 'a', href: 'c1.xhtml', label: 'One' },
    { id: 'b', href: 'c1.xhtml#s1', label: 'One, first section' },
    { id: 'c', href: 'c1.xhtml#s2', label: 'One, second section' },
    { id: 'd', href: 'c2.xhtml', label: 'Two' },
    { id: 'e', href: 'c2.xhtml#s3', label: 'Two, only section' },
  ];
  const nestedNcx: NavigationItem[] = [
    {
      id: 'x1',
      href: 'c1.xhtml',
      label: 'One',
      subitems: [
        { id: 'x2', href: 'c1.xhtml#s1', label: 'One, first section' },
        { id: 'x3', href: 'c1.xhtml#s2', label: 'One, second section' },
      ],
    },
    { id: 'x4', href: 'c2.xhtml', label: 'Two', subitems: [{ id: 'x5', href: 'c2.xhtml#s3', label: 'Two, only section' }] },
  ];

  it('hands the TOC to the NCX when the nav is flat and the NCX is a real tree', () => {
    expect(tocDepth(flatNav)).toBe(1);
    expect(tocDepth(nestedNcx)).toBe(2);
    expect(chooseTocSource([{ kind: 'nav', items: flatNav }, { kind: 'ncx', items: nestedNcx }]).source).toBe('ncx');
  });

  it('keeps a flat nav that lists far more than a nested NCX', () => {
    const chaptersOnly: NavigationItem[] = [
      { id: 'x1', href: 'c1.xhtml', label: 'One', subitems: [{ id: 'x2', href: 'c2.xhtml', label: 'Two' }] },
    ];
    expect(chooseTocSource([{ kind: 'nav', items: flatNav }, { kind: 'ncx', items: chaptersOnly }]).source).toBe('nav');
  });

  it('keeps a nested nav over a nested NCX', () => {
    expect(chooseTocSource([{ kind: 'nav', items: nestedNcx }, { kind: 'ncx', items: nestedNcx }]).source).toBe('nav');
  });
});

describe('regression: label repair never duplicates a neighbour into the same file', () => {
  // The nav spells a part as three rows into one file; the bare numeral is junk.
  const nav: NavigationItem[] = [
    { id: 'p', href: 'part1.html', label: 'I' },
    { id: 'q', href: 'part1.html#ptr1', label: 'Series subtitle' },
    { id: 'r', href: 'part1.html#ptr2', label: 'Part 1: Belief' },
    { id: 's', href: 'chap01.html', label: 'Chapter 1' },
  ];
  const ncx: NavigationItem[] = [
    { id: 'n1', href: 'part1.html#ptr2', label: 'Part 1: Belief' },
    { id: 'n2', href: 'chap01.html', label: 'First Things' },
  ];

  it('keeps the junk label rather than repeating the label two rows below', () => {
    expect(repairTocLabels(nav, [ncx]).map((i) => i.label)).toEqual([
      'I',
      'Series subtitle',
      'Part 1: Belief',
      'First Things',
    ]);
  });

  it('still repairs two junk entries into one file with the same real title', () => {
    // Only a label the publisher wrote blocks the borrow (the all-`*FIX_`
    // NCX keeps getting every label the nav has).
    const twoJunk: NavigationItem[] = [
      { id: 'a', href: 'c.xhtml', label: 'Chapter 3' },
      { id: 'b', href: 'c.xhtml', label: '3' },
    ];
    const out = repairTocLabels(twoJunk, [[{ id: 'n', href: 'c.xhtml', label: 'The Long Road' }]]);
    expect(out.map((i) => i.label)).toEqual(['The Long Road', 'The Long Road']);
  });
});
