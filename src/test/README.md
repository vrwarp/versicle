# Test Utilities

This directory contains configuration and helper files for the unit testing environment (Vitest).

## Contents

*   **`fixtures/`**: Contains static binary data used for testing, such as sample `.epub` files.
*   **`setup.ts`**: The global test setup file referenced in `vitest.config.ts`. It runs before each test suite to configure the JSDOM environment, implementing mocks for browser APIs that are missing or require specific behavior in tests (e.g., `ResizeObserver`, `IntersectionObserver`, `window.speechSynthesis`).
