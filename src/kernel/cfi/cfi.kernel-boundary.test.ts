/**
 * Kernel-boundary invariants (phase5-tts-strangler.md §5c.4):
 *
 *  1. `epubjs/src/epubcfi` is imported by EXACTLY ONE module — the kernel's
 *     typed shim (src/kernel/cfi/epubcfiShim.ts). The `@ts-expect-error`'d
 *     epubjs internals are quarantined there; everything else uses the
 *     kernel's typed surface.
 *  2. src/kernel/** imports nothing internal outside src/kernel/** (master
 *     plan §2 rule 1 — belt to the dependency-cruiser `kernel-imports-nothing`
 *     braces; this one also covers test files, which depcruise excludes).
 *
 * Source-scan style follows the worker-chunk / single-instance checks: assert
 * the tree, not a convention.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..');
const SHIM = 'kernel/cfi/epubcfiShim.ts';

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            walk(p, out);
        } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
            out.push(p);
        }
    }
    return out;
}

describe('CFI kernel boundary', () => {
    it('only the kernel shim imports epubjs/src/epubcfi', () => {
        const offenders: string[] = [];
        for (const file of walk(SRC)) {
            const rel = relative(SRC, file).replaceAll('\\', '/');
            if (rel === SHIM) continue;
            const text = readFileSync(file, 'utf8');
            if (/from\s+['"]epubjs\/src\/epubcfi['"]/.test(text) || /import\(['"]epubjs\/src\/epubcfi['"]\)/.test(text)) {
                offenders.push(rel);
            }
        }
        expect(offenders, 'epubjs/src/epubcfi is quarantined to the kernel shim — use src/kernel/cfi instead').toEqual([]);
    });

    it('src/kernel imports nothing internal outside src/kernel', () => {
        const offenders: string[] = [];
        for (const file of walk(join(SRC, 'kernel'))) {
            const rel = relative(SRC, file).replaceAll('\\', '/');
            const text = readFileSync(file, 'utf8');
            for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
                const spec = m[1];
                const internal =
                    spec.startsWith('@app') || spec.startsWith('@components') || spec.startsWith('@data') ||
                    spec.startsWith('@domains') || spec.startsWith('@hooks') || spec.startsWith('@lib') ||
                    spec.startsWith('@store') || spec.startsWith('~types') || spec.startsWith('@workers') ||
                    // relative escape above the kernel root (e.g. ../../lib/…)
                    /^(\.\.\/)+(app|components|data|domains|hooks|lib|store|types|workers)(\/|$)/.test(spec);
                // @test/* is tolerated in *.test.ts files only (fuzz utils).
                const testUtil = spec.startsWith('@test') && /\.test\.tsx?$/.test(rel);
                if (internal && !testUtil) offenders.push(`${rel} → ${spec}`);
            }
        }
        expect(offenders, 'kernel admission rule: zero internal imports').toEqual([]);
    });
});
