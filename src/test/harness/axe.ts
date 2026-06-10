/**
 * vitest-axe integration: opt-in accessibility assertions for component
 * tests (gap-accessibility report, debt #6, layer 2 of the verification
 * stack — jsx-a11y lint → vitest-axe in this harness → @axe-core/playwright
 * scans in verification/).
 *
 * Importing this module (directly, or via the harness index /
 * renderWithStores) registers the `toHaveNoViolations` matcher. Usage:
 *
 *   const view = renderWithStores(<Toast … />);
 *   expect(await view.axe()).toHaveNoViolations();
 *
 * or, without the render helper:
 *
 *   expect(await runAxe(container)).toHaveNoViolations();
 */
import { expect } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';

expect.extend(matchers);

// vitest-axe@1.0.0-pre.5 ships its augmentation against vitest's pre-1.0
// non-generic `Assertion`; vitest 4's `Assertion<T>` needs a matching
// generic parameter list for declaration merging, so we augment here.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

/**
 * Component-scoped axe run with the rules that cannot work on a jsdom
 * fragment disabled:
 * - `color-contrast` needs a canvas/layout engine; jsdom has neither.
 * - `region` ("all content must be inside landmarks") always fires for a
 *   component rendered into a bare test container — it is a PAGE-level
 *   rule, covered by the Playwright surface scans instead.
 */
export const runAxe = configureAxe({
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
});
