/**
 * The generated-docs drift gate (Phase 9 docs item; master plan §4 rule 10).
 *
 * Two jobs:
 *  1. COMPLETENESS — the authored maps in registryDocs.ts must match the
 *     filesystem (module sets, data-layer contents) and every file pointer
 *     in the C1–C12 / boundary-rule tables must exist. Adding a module or
 *     moving a pinning suite fails this gate until the docs follow.
 *  2. DRIFT — architecture.md, AGENTS.md, and the kernel/data/domains
 *     READMEs must be EXACTLY the registry rendering. Regenerate with
 *     `npm run docs:generate` (REGEN_DOCS=1 writes the files here).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  PACKAGE_MODULES,
  SRC_MODULES,
  DOMAIN_MODULES,
  KERNEL_MODULES,
  ENTRY_FILES,
  ROOT_DIRS,
  DATA_MODULES,
  DATA_REPOS,
  CONTRACTS,
  BOUNDARY_RULES,
  JULES_README_RULE,
  srcModuleOrderForTest,
  parseLocalGateTable,
  renderArchitectureMd,
  renderAgentsMd,
  renderKernelReadme,
  renderDataReadme,
  renderDomainsReadme,
  type RatchetSnapshot,
} from './registryDocs';

const root = process.cwd();
const REGEN = process.env.REGEN_DOCS === '1';

const dirsOf = (p: string): string[] =>
  readdirSync(join(root, p))
    .filter((f) => statSync(join(root, p, f)).isDirectory())
    .sort();

const ratchetSnapshot = (): RatchetSnapshot => {
  const baseline = JSON.parse(
    readFileSync(join(root, '.dependency-cruiser-baseline.json'), 'utf8'),
  ) as { counts: Record<string, number>; total: number };
  const allowlist = JSON.parse(readFileSync(join(root, 'lint-debt-allowlist.json'), 'utf8')) as {
    files: Record<string, { asAny: number; colonAny: number; disables: number }>;
  };
  const entries = Object.values(allowlist.files);
  return {
    depcruiseTotal: baseline.total,
    depcruiseNonZero: Object.entries(baseline.counts).filter(([, n]) => n > 0),
    lintDebtAnySites: entries.reduce((s, e) => s + e.asAny + e.colonAny, 0),
    lintDebtDisables: entries.reduce((s, e) => s + e.disables, 0),
  };
};

/** Path-alias names from tsconfig.app.json (`@app/*` → `@app/`). */
const aliasNames = (config: string): string[] => {
  const parsed = ts.readConfigFile(join(root, config), ts.sys.readFile);
  expect(parsed.error, `${config} must parse`).toBeUndefined();
  const paths = (parsed.config as { compilerOptions?: { paths?: Record<string, unknown> } })
    .compilerOptions?.paths;
  expect(paths, `${config} must declare paths`).toBeDefined();
  return Object.keys(paths ?? {}).map((k) => k.replace(/\*$/, ''));
};

const expectGenerated = (relPath: string, expected: string) => {
  const abs = join(root, relPath);
  if (REGEN) writeFileSync(abs, expected);
  expect(
    readFileSync(abs, 'utf8'),
    `${relPath} drifted from the registries — run \`npm run docs:generate\``,
  ).toBe(expected);
};

describe('module-map completeness (authored maps == filesystem)', () => {
  it('packages/* matches PACKAGE_MODULES', () => {
    expect(Object.keys(PACKAGE_MODULES).sort()).toEqual(dirsOf('packages'));
  });

  it('src/* directories match SRC_MODULES (and the curated render order)', () => {
    expect(Object.keys(SRC_MODULES).sort()).toEqual(dirsOf('src'));
    expect([...srcModuleOrderForTest()].sort()).toEqual(Object.keys(SRC_MODULES).sort());
  });

  it('src/domains/* matches DOMAIN_MODULES', () => {
    expect(Object.keys(DOMAIN_MODULES).sort()).toEqual(dirsOf('src/domains'));
  });

  it('src/kernel/* matches KERNEL_MODULES', () => {
    expect(Object.keys(KERNEL_MODULES).sort()).toEqual(dirsOf('src/kernel'));
  });

  it('src/data contents match DATA_MODULES (dirs + non-test modules)', () => {
    const entries = readdirSync(join(root, 'src/data'))
      .filter((f) => !/\.test\.[jt]sx?$/.test(f))
      .map((f) => (statSync(join(root, 'src/data', f)).isDirectory() ? `${f}/` : f))
      .filter((f) => f.endsWith('/') || f.endsWith('.ts'))
      .sort();
    expect(Object.keys(DATA_MODULES).sort()).toEqual(entries);
  });

  it('src/data/repos contents match DATA_REPOS (non-test modules)', () => {
    const entries = readdirSync(join(root, 'src/data/repos'))
      .filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f))
      .sort();
    expect(Object.keys(DATA_REPOS).sort()).toEqual(entries);
  });

  it('entry files and root dirs exist', () => {
    for (const f of Object.keys(ENTRY_FILES)) expect(existsSync(join(root, f)), f).toBe(true);
    for (const d of Object.keys(ROOT_DIRS)) expect(existsSync(join(root, d)), d).toBe(true);
  });
});

describe('contract + boundary-rule file pointers are live', () => {
  it('every C1–C12 home and pinning pointer exists', () => {
    for (const c of CONTRACTS) {
      for (const p of [...c.home, ...c.pinnedBy]) {
        expect(existsSync(join(root, p)), `${c.id} pointer ${p}`).toBe(true);
      }
    }
  });

  it('contract ids are exactly C1–C12, in order', () => {
    expect(CONTRACTS.map((c) => c.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `C${i + 1}`),
    );
  });

  it('every boundary-rule pointer exists, rules are 1–10', () => {
    for (const r of BOUNDARY_RULES) {
      for (const p of r.pointers) {
        expect(existsSync(join(root, p)), `rule ${r.n} pointer ${p}`).toBe(true);
      }
    }
    expect(BOUNDARY_RULES.map((r) => r.n)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
  });
});

describe('generated docs match the registries (REGEN_DOCS=1 to regenerate)', () => {
  it('architecture.md', () => {
    expectGenerated('architecture.md', renderArchitectureMd(ratchetSnapshot()));
  });

  it('AGENTS.md (from TESTING.md gate table + registries)', () => {
    const testingMd = readFileSync(join(root, 'TESTING.md'), 'utf8');
    const gates = parseLocalGateTable(testingMd);
    // Commands must survive verbatim: each documented command string in
    // TESTING.md appears character-identical in AGENTS.md.
    const agents = renderAgentsMd(gates, aliasNames('tsconfig.app.json'));
    for (const g of gates) expect(agents).toContain(g.command);
    expect(agents).toContain(JULES_README_RULE);
    expectGenerated('AGENTS.md', agents);
  });

  it('src/kernel/README.md', () => {
    expectGenerated('src/kernel/README.md', renderKernelReadme());
  });

  it('src/data/README.md', () => {
    expectGenerated('src/data/README.md', renderDataReadme());
  });

  it('src/domains/README.md', () => {
    expectGenerated('src/domains/README.md', renderDomainsReadme());
  });
});

describe('alias maps stay in sync (tsconfig.e2e.json mirrors tsconfig.app.json)', () => {
  it('e2e paths equal app paths', () => {
    expect(aliasNames('tsconfig.e2e.json')).toEqual(aliasNames('tsconfig.app.json'));
  });
});
