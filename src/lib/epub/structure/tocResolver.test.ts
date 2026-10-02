import { describe, it, expect } from 'vitest';
import type { NavigationItem } from '~types/book';
import { PackageIndex } from './packageIndex';
import type { PackageModel } from './packageModel';
import { resolveToc, resolveTocHref, scoreToc, tocEquals } from './tocResolver';

function model(spine: string[], extra: string[] = [], opfDir = 'OEBPS/'): PackageModel {
  const manifest = [...spine, ...extra].map((href, i) => ({
    id: `m${i}`,
    href,
    mediaType: 'application/xhtml+xml',
    properties: [] as string[],
  }));
  return { opfPath: `${opfDir}content.opf`, opfDir, manifest, spine, guide: [] };
}

describe('resolveTocHref', () => {
  const index = new PackageIndex(
    model(['Text/CH1.xhtml', 'Text/Ch3.xhtml', 'Text/Chapter%20One.xhtml', 'Text/don%27t.xhtml'], ['Text/toc.xhtml']),
  );
  const raw = { index, tocPath: 'Text/toc.xhtml', order: 'raw' as const };

  it('T1: resolves nav-relative hrefs from a nav in a subfolder', () => {
    expect(resolveTocHref('../Text/CH1.xhtml', raw)).toBe('Text/CH1.xhtml');
    expect(resolveTocHref('CH1.xhtml#p2', raw)).toBe('Text/CH1.xhtml#p2');
  });

  it('T2: matches percent-encoding in either direction', () => {
    expect(resolveTocHref('Chapter One.xhtml', raw)).toBe('Text/Chapter%20One.xhtml');
    expect(resolveTocHref("don't.xhtml#a", raw)).toBe('Text/don%27t.xhtml#a');
  });

  it('T3: matches a case mismatch only when unambiguous', () => {
    expect(resolveTocHref('CH3.xhtml', raw)).toBe('Text/Ch3.xhtml');
    const ambiguous = new PackageIndex(model(['a/X.xhtml', 'a/x.xhtml']));
    expect(resolveTocHref('a/X.XHTML', { index: ambiguous, order: 'raw' })).toBeNull();
  });

  it('T4: accepts ./, zip-root and OPF-folder-prefixed spellings', () => {
    expect(resolveTocHref('./CH1.xhtml', raw)).toBe('Text/CH1.xhtml');
    expect(resolveTocHref('/OEBPS/Text/CH1.xhtml', raw)).toBe('Text/CH1.xhtml');
    expect(resolveTocHref('OEBPS\\Text\\CH1.xhtml', { index, order: 'raw' })).toBe('Text/CH1.xhtml');
  });

  it('T5: a manifest item outside the spine, or a missing file, does not resolve', () => {
    expect(resolveTocHref('toc.xhtml', raw)).toBeNull();
    expect(resolveTocHref('missing.xhtml', raw)).toBeNull();
  });

  it('falls back to a unique basename as the last rung', () => {
    expect(resolveTocHref('elsewhere/Ch3.xhtml', { index, order: 'raw' })).toBe('Text/Ch3.xhtml');
  });

  it('stored order prefers the href as written (idempotence anchor)', () => {
    const tricky = new PackageIndex(model(['CH1.xhtml', 'Text/CH1.xhtml'], ['Text/toc.xhtml']));
    // Raw nav semantics: relative to Text/toc.xhtml.
    expect(resolveTocHref('CH1.xhtml', { index: tricky, tocPath: 'Text/toc.xhtml', order: 'raw' })).toBe(
      'Text/CH1.xhtml',
    );
    // Already-resolved TOC: the value IS the spine href.
    expect(resolveTocHref('CH1.xhtml', { index: tricky, tocPath: 'Text/toc.xhtml', order: 'stored' })).toBe(
      'CH1.xhtml',
    );
  });
});

describe('resolveToc', () => {
  const index = new PackageIndex(model(['Text/a.xhtml', 'Text/b.xhtml', 'Text/c.xhtml'], ['Text/nav.xhtml']));
  const ctx = { index, tocPath: 'Text/nav.xhtml', order: 'raw' as const };

  const raw: NavigationItem[] = [
    {
      id: 'group',
      href: '',
      label: 'Part One',
      subitems: [
        { id: 'a', href: 'a.xhtml', label: 'A' },
        { id: 'b', href: 'b.xhtml', label: 'B', subitems: [{ id: 'b2', href: '#s2', label: 'B.2' }] },
      ],
    },
    { id: 'gone', href: 'gone.xhtml', label: 'Gone' },
    { id: 'c', href: 'c.xhtml', label: 'C' },
  ];

  it('rewrites hrefs, resolves fragment-only and grouping entries, flags the rest', () => {
    const out = resolveToc(raw, ctx);
    expect(out[0].href).toBe('Text/a.xhtml'); // T9: group takes first child
    expect(out[0].unresolved).toBeUndefined();
    expect(out[0].subitems?.[1].subitems?.[0].href).toBe('Text/b.xhtml#s2'); // T6
    expect(out[1]).toMatchObject({ href: 'gone.xhtml', unresolved: true });
    expect(out[2].href).toBe('Text/c.xhtml');
  });

  it('does not mutate its input', () => {
    const snapshot = JSON.stringify(raw);
    resolveToc(raw, ctx);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('is idempotent in stored order (the reader self-heal relies on this)', () => {
    const once = resolveToc(raw, ctx);
    const twice = resolveToc(once, { ...ctx, order: 'stored' });
    expect(tocEquals(once, twice)).toBe(true);
  });

  it('clears a stale unresolved flag once the href resolves', () => {
    const out = resolveToc([{ id: 'a', href: 'Text/a.xhtml', label: 'A', unresolved: true }], {
      index,
      order: 'stored',
    });
    expect(out[0].unresolved).toBeUndefined();
  });

  it('scores resolve rate and distinct targets', () => {
    const score = scoreToc(resolveToc(raw, ctx));
    expect(score).toMatchObject({ total: 6, resolved: 5, distinctTargets: 3 });
  });
});
