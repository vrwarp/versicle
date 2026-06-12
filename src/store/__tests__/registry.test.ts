import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STORE_REGISTRY,
  SYNCED_STORE_DEFS,
  SYNCED_STORES,
  yjsHandleOf,
  renderStoreRegistryDocs,
  type SyncedStoreDef,
} from '@store/registry';
import { getDeviceId } from '@lib/device-id';

/**
 * Registry completeness + docs-generation gate (master plan §2 "three
 * explicit store tiers, declared in one registry"; phase2-fork-surgery.md
 * §2.5). Every store module under src/store/ must be declared, the runtime
 * roster must agree with the declared defs, persist keys must match the
 * actual store configuration, and src/store/README.md must be exactly the
 * registry rendering (regenerate with REGEN_STORE_DOCS=1).
 */

const storeDir = join(process.cwd(), 'src', 'store');

const storeModulesOnDisk = (): string[] =>
  readdirSync(storeDir)
    .filter((f) => /^use[A-Z]\w*\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();

describe('store registry', () => {
  it('declares every store module under src/store/ (and nothing else)', () => {
    const declared = STORE_REGISTRY.map((e) => e.module).sort();
    expect(declared).toEqual(storeModulesOnDisk());
  });

  it('declares each module exactly once', () => {
    const declared = STORE_REGISTRY.map((e) => e.module);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('synced rows carry a def; non-synced rows do not', () => {
    for (const entry of STORE_REGISTRY) {
      if (entry.tier === 'synced') {
        expect(entry.def, `${entry.module} must reference its SyncedStoreDef`).toBeDefined();
      } else {
        expect(entry.def, `${entry.module} (${entry.tier}) must not carry a def`).toBeUndefined();
      }
    }
  });

  it('synced rows reference each SYNCED_STORE_DEFS entry exactly once', () => {
    const referenced = STORE_REGISTRY.filter((e) => e.tier === 'synced').map((e) => e.def);
    const declared = Object.values(SYNCED_STORE_DEFS);
    expect(referenced).toHaveLength(declared.length);
    for (const def of declared) {
      expect(referenced.filter((d) => d === def)).toHaveLength(1);
    }
  });

  it('synced persistence labels match the live Y.Map binding (deviceId placeholdered)', () => {
    const expectedLabel = (def: SyncedStoreDef): string => {
      const base = def.name.split(getDeviceId()).join('<deviceId>');
      if (def.scope === undefined) return base;
      const scopeLabel = def.scope.key === getDeviceId() ? '<deviceId>' : def.scope.key;
      return `${base}.${scopeLabel}`;
    };
    for (const entry of STORE_REGISTRY.filter((e) => e.tier === 'synced')) {
      expect(entry.persistence, entry.module).toBe(expectedLabel(entry.def as SyncedStoreDef));
    }
  });

  it('the runtime roster binds every def to a live store with a yjs handle', () => {
    expect(SYNCED_STORES).toHaveLength(Object.values(SYNCED_STORE_DEFS).length);
    const rosterDefs = SYNCED_STORES.map((e) => e.def);
    for (const def of Object.values(SYNCED_STORE_DEFS)) {
      expect(rosterDefs.filter((d) => d === def), def.name).toHaveLength(1);
    }
    for (const { def, store } of SYNCED_STORES) {
      expect(yjsHandleOf(store), `store for map "${def.name}" lacks api.yjs`).toBeDefined();
    }
  });

  it('local-persisted rows match the actual zustand/persist keys', async () => {
    // Literal import map: Vite cannot resolve alias imports with runtime
    // template specifiers, and a literal map doubles as a second completeness
    // check (adding a persisted store must touch registry AND this list).
    const persistedImports: Record<string, () => Promise<Record<string, unknown>>> = {
      useSyncStore: () => import('@store/useSyncStore'),
      useTTSSettingsStore: () => import('@store/useTTSSettingsStore'),
      useDriveStore: () => import('@store/useDriveStore'),
      useGoogleServicesStore: () => import('@store/useGoogleServicesStore'),
      useGenAIStore: () => import('@store/useGenAIStore'),
      useLocalHistoryStore: () => import('@store/useLocalHistoryStore'),
    };

    const persisted = STORE_REGISTRY.filter((e) => e.tier === 'local-persisted');
    expect(persisted.map((e) => e.module).sort()).toEqual(Object.keys(persistedImports).sort());

    for (const entry of persisted) {
      const mod = await persistedImports[entry.module]();
      const store = mod[entry.module] as {
        persist?: { getOptions(): { name?: string } };
      };
      expect(store?.persist, `${entry.module} should use zustand/persist`).toBeDefined();
      expect(store.persist?.getOptions().name, entry.module).toBe(entry.persistence);
    }
  });

  it('ephemeral rows declare no persistence', () => {
    for (const entry of STORE_REGISTRY.filter((e) => e.tier === 'ephemeral')) {
      expect(entry.persistence, entry.module).toBeNull();
    }
  });

  it('src/store/README.md is the registry rendering (REGEN_STORE_DOCS=1 to regenerate)', () => {
    const readmePath = join(storeDir, 'README.md');
    const expected = renderStoreRegistryDocs();
    if (process.env.REGEN_STORE_DOCS === '1') {
      writeFileSync(readmePath, expected);
    }
    expect(readFileSync(readmePath, 'utf8')).toBe(expected);
  });
});
