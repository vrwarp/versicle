/**
 * Phase 8 §G — the prompt-style SW update flow (prep risk #1, the phase's
 * riskiest transition). Two layers pinned here:
 *
 *  1. SWUpdatePrompt behavior: `needRefresh` → ONE persistent keyed toast
 *     with a Reload action → `updateServiceWorker(true)`.
 *  2. The update-flow SOURCE CONTRACT: src/sw.ts must never regain an
 *     unconditional `self.skipWaiting()` (that would silently revert to
 *     the abrupt autoUpdate channel), must keep the SKIP_WAITING message
 *     handler the prompt depends on, and every runtime cacheName must be
 *     enumerated (by prefix) in @data/wipe.ts. vite.config.ts must keep
 *     `registerType: 'prompt'`.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWUpdatePrompt } from './SWUpdatePrompt';
import { ToastHost } from './ToastHost';
import { useToastStore } from '@store/useToastStore';
import { APP_CACHE_PREFIXES } from '@data/wipe';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Controllable double for the virtual module (vitest resolves the specifier
// to src/test/harness/pwaRegisterStub.ts; the mock replaces the stub).
const h = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [h.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: h.updateServiceWorker,
  }),
}));

describe('SWUpdatePrompt (prompt-style update flow)', () => {
  beforeEach(() => {
    h.needRefresh = false;
    h.updateServiceWorker.mockClear();
    useToastStore.getState().hideToast();
  });

  it('shows no toast while no update is waiting', () => {
    render(<SWUpdatePrompt />);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('needRefresh → ONE persistent keyed toast with a Reload action', () => {
    h.needRefresh = true;
    render(
      <>
        <SWUpdatePrompt />
        <ToastHost />
      </>,
    );

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].key).toBe('app.updateReady');
    expect(toasts[0].duration).toBe(Infinity); // persistent — never auto-dismisses
    expect(screen.getByText('A new version of Versicle is ready.')).toBeInTheDocument();
    expect(screen.getByTestId('toast-action')).toHaveTextContent('Reload');
  });

  it('Reload action activates the waiting SW (updateServiceWorker(true)) and dismisses', async () => {
    h.needRefresh = true;
    render(
      <>
        <SWUpdatePrompt />
        <ToastHost />
      </>,
    );

    fireEvent.click(screen.getByTestId('toast-action'));

    expect(h.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(h.updateServiceWorker).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  it('re-renders dedupe instead of stacking duplicate prompts', () => {
    h.needRefresh = true;
    const { rerender } = render(<SWUpdatePrompt key="a" />);
    rerender(<SWUpdatePrompt key="b" />); // remount re-fires the effect
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe('regression: sw.ts update-flow source contract (prep risk #1)', () => {
  const swSource = readFileSync(join(repoRoot, 'src', 'sw.ts'), 'utf8');
  const viteConfig = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf8');

  it('never regains an unconditional self.skipWaiting()', () => {
    // Exactly ONE occurrence in CODE (comments stripped), and it must sit
    // inside the SKIP_WAITING message listener — the prompt flow's
    // activation handshake.
    const codeOnly = swSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const occurrences = codeOnly.match(/self\.skipWaiting\(\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const listenerStart = codeOnly.indexOf("self.addEventListener('message'");
    expect(listenerStart).toBeGreaterThanOrEqual(0);
    const listenerBlock = codeOnly.slice(listenerStart, codeOnly.indexOf('clientsClaim()'));
    expect(listenerBlock).toContain("event.data.type === 'SKIP_WAITING'");
    expect(listenerBlock).toContain('self.skipWaiting()');
  });

  it('keeps clientsClaim (first-install control) and cleanupOutdatedCaches', () => {
    expect(swSource).toContain('clientsClaim()');
    expect(swSource).toContain('cleanupOutdatedCaches()');
  });

  it('keeps the cover fetch handler (P3 sw-contract)', () => {
    expect(swSource).toContain('parseCoverPath');
    expect(swSource).toContain('createCoverResponse');
  });

  it('vite.config.ts stays on registerType prompt', () => {
    expect(viteConfig).toContain("registerType: 'prompt'");
    expect(viteConfig).not.toContain("registerType: 'autoUpdate'");
  });

  it('every runtime cacheName in sw.ts is wipe-enumerated by prefix (@data/wipe)', () => {
    const names = [...swSource.matchAll(/cacheName:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(3); // dict, fonts, piper-runtime
    for (const name of names) {
      expect(
        APP_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)),
        `runtime cache '${name}' missing from APP_CACHE_PREFIXES`,
      ).toBe(true);
    }
  });
});
