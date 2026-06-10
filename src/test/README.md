# Test Utilities

This directory contains configuration and helper files for the unit testing environment (Vitest).

## Contents

*   **`fixtures/`**: Contains static binary data used for testing, such as sample `.epub` files.
*   **`setup.ts`**: The global test setup file referenced in `vitest.config.ts`. It runs before each test suite to configure the JSDOM environment, implementing mocks for browser APIs that are missing or require specific behavior in tests (e.g., `Blob` methods, `localStorage`, `matchMedia`, `ResizeObserver`, `window.speechSynthesis`, media elements, and `fake-indexeddb`).
*   **`harness/`**: The shared test harness (typed service doubles, real-store
    seed/reset helpers, toast capture, an `ITTSProvider` double, domain
    fixtures, and `renderWithStores`). New tests should consume these instead
    of hand-rolling `vi.mock` blocks for DBService/stores — see
    `harness/index.ts` for the full surface and the rules of thumb.
*   **`fuzz-utils.ts`**: Seeded PRNG infrastructure for the `*.fuzz.test.ts` suites.
