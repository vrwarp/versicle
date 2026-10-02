/**
 * Lookup tables over a package's manifest and spine, so a reference written
 * in any of the ways real books write it can be matched to the exact
 * manifest href epub.js keys its spine by.
 *
 * Match strength, strongest first:
 *  - `exact`     — the manifest href as written;
 *  - `strict`    — same file after percent-decoding, Unicode NFC and
 *                  dot-segment normalization (`%27` vs `'`, `./a` vs `a`);
 *  - `canonical` — additionally case-folded, used only when exactly one
 *                  manifest item has that key (`CH3.xhtml` vs `Ch3.xhtml`);
 *  - `basename`  — file name alone, used only when unique in the package.
 */
import type { ManifestEntry, PackageModel } from './packageModel';
import { basename, canonicalKey, normalizePath, safeDecode, splitFragment } from './paths';

export type MatchStrength = 'exact' | 'strict' | 'canonical' | 'basename';

function strictKey(path: string): string {
  return normalizePath(safeDecode(splitFragment(path)[0]).normalize('NFC'));
}

/** Map a key to its single entry; a second distinct entry poisons the key (`null`). */
function addUnique(map: Map<string, ManifestEntry | null>, key: string, entry: ManifestEntry): void {
  if (!key) return;
  const existing = map.get(key);
  if (existing === undefined) map.set(key, entry);
  else if (existing !== null && existing !== entry) map.set(key, null);
}

export class PackageIndex {
  readonly model: PackageModel;
  private readonly exact = new Map<string, ManifestEntry>();
  private readonly strict = new Map<string, ManifestEntry | null>();
  private readonly canonical = new Map<string, ManifestEntry | null>();
  private readonly base = new Map<string, ManifestEntry | null>();
  private readonly spinePos = new Map<string, number>();

  constructor(model: PackageModel) {
    this.model = model;
    for (const entry of model.manifest) {
      if (!this.exact.has(entry.href)) this.exact.set(entry.href, entry);
      addUnique(this.strict, strictKey(entry.href), entry);
      addUnique(this.canonical, canonicalKey(entry.href), entry);
      addUnique(this.base, basename(canonicalKey(entry.href)), entry);
    }
    model.spine.forEach((href, i) => {
      if (!this.spinePos.has(href)) this.spinePos.set(href, i);
    });
  }

  /** Spine hrefs in reading order (manifest hrefs as written). */
  get spine(): readonly string[] {
    return this.model.spine;
  }

  /** Look up an OPF-relative path no weaker than `weakest`. */
  find(path: string, weakest: MatchStrength = 'basename'): { entry: ManifestEntry; strength: MatchStrength } | undefined {
    const bare = splitFragment(path)[0];
    if (!bare) return undefined;
    const exact = this.exact.get(bare);
    if (exact) return { entry: exact, strength: 'exact' };
    if (weakest === 'exact') return undefined;
    const strict = this.strict.get(strictKey(bare));
    if (strict) return { entry: strict, strength: 'strict' };
    if (weakest === 'strict') return undefined;
    const canonical = this.canonical.get(canonicalKey(bare));
    if (canonical) return { entry: canonical, strength: 'canonical' };
    if (weakest === 'canonical') return undefined;
    const base = this.base.get(basename(canonicalKey(bare)));
    return base ? { entry: base, strength: 'basename' } : undefined;
  }

  findById(id: string): ManifestEntry | undefined {
    return this.model.manifest.find((m) => m.id === id);
  }

  /** Reading-order position of a manifest href, or -1 when not in the spine. */
  spineIndexOf(href: string): number {
    return this.spinePos.get(href) ?? -1;
  }

  /** OPF-relative path → zip path (what archive readers key by). */
  toZipPath(opfRelative: string): string {
    return normalizePath(this.model.opfDir + splitFragment(opfRelative)[0]);
  }
}
