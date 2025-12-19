Proposal: Hardening CFI Logic
=============================================

1\. Diagnosis of Brittleness
----------------------------

The current mechanism for handling Canonical Fragment Identifiers (CFIs) in `src/lib/cfi-utils.ts` has been identified as a critical point of failure for session management. The logic currently relies on a brittle, runtime introspection strategy to locate the `CFI` class constructor within the `epubjs` library.

**Root Cause Analysis:** The core issue stems from how `epub.js` is bundled and exposed in different environments. The application currently attempts to "hunt" for the `CFI` class by checking multiple potential attach points at runtime: `ePub.CFI`, `ePub.default.CFI`, and even the global `window.ePub.CFI`.

This approach is inherently unstable for several reasons:

1.  **Environment Discrepancies:** The internal structure of the `epub.js` module object often varies significantly between the development server (managed by Vite using native ESM) and the production build (bundled by Rollup). A path that works in development may not exist in production, and vice-versa.

2.  **Module Format Confusion:** `epub.js` is an older library likely distributed as a UMD (Universal Module Definition). Modern tooling attempts to wrap this in ESM, but the default export behavior is notoriously inconsistent across different build tools and configurations.

3.  **Catastrophic Fallback:** When this runtime lookup fails---returning `undefined` instead of the class constructor---the system silently degrades to using `fallbackCfiCompare`.

**The Fallback Failure Mode:** The `fallbackCfiCompare` function is designed as a safety net, but it is fundamentally flawed for CFI comparison. It relies on naive lexicographical string sorting rather than semantic parsing.

-   **String vs. Integer Sorting:** In string sorting, the character "1" comes before "2". Consequently, a CFI step of `/10` will be sorted *before* `/2`, completely corrupting the chronological order of reading history.

-   **Assertion Parsing:** CFIs often contain assertions (e.g., `/4[chapter1]`). The fallback logic struggles to strip these correctly, leading to further sorting errors. This results in the "Smart Resume" feature placing users at incorrect locations or failing to merge overlapping history sessions.

2\. Solution: Static Direct Import
----------------------------------

To permanently resolve this instability, we will eliminate the need for runtime guessing entirely. The solution leverages **Static ESM Imports**, which allow the build tool to resolve dependencies at compile time rather than execution time.

By switching to a named import or a direct submodule import, we shift the responsibility of finding the `CFI` class from our runtime code to the bundler (Vite). If the bundler successfully compiles the project, we are guaranteed that the class exists and is accessible.

### The Fix

We will refactor `src/lib/cfi-utils.ts` to explicitly import the `EpubCFI` class. This replaces the dynamic property access with a static reference.

**Current (Brittle Implementation):** The code currently tries to accommodate every possible permutation of the library's export structure, effectively guessing where the class might be hidden.

```
import ePub from 'epubjs';

// This function attempts to find the class at runtime, risking undefined returns
export function getEpubCFI() {
  return ePub.CFI || ePub.default?.CFI || window.ePub?.CFI;
}

```

**Proposed (Robust Implementation):** We rely on the standard ECMAScript Module syntax. Modern bundlers like Vite are highly capable of resolving named exports from CommonJS or UMD packages.

```
// Named import guarantees availability at build time
import { EpubCFI } from 'epubjs';

export function getEpubCFI() {
  return EpubCFI;
}

```

3\. Detailed Implementation Steps
---------------------------------

The migration to static imports requires a few precise steps to ensure TypeScript and the bundler are aligned.

### Step 1: Verify and Update Type Definitions

Before changing the code, we must ensure TypeScript knows that `EpubCFI` is a valid named export.

-   **Action:** Inspect `src/types/epubjs.d.ts`.

-   **Check:** Look for a named export in the module declaration, such as `export class EpubCFI { ... }` or `export const EpubCFI: ...`.

-   **Remediation:** If the types currently only support a default export (e.g., `export default ePub`), we must add the named export definition. This ensures the IDE and compiler do not throw errors when we switch syntax.

### Step 2: Refactor the Utility Library

Open `src/lib/cfi-utils.ts` and apply the changes.

-   **Action:** Remove the logic that checks `ePub.default` or `window.ePub`.

-   **Action:** Change the import statement to `import { EpubCFI } from 'epubjs';`.

-   **Contingency:** If `epubjs` does not export `EpubCFI` at the top level, check if a direct path is available, such as `import EpubCFI from 'epubjs/lib/epubcfi';`. (Note: The top-level named import is preferred for compatibility).

### Step 3: Cleanup and simplification

Once the import is static, the `fallbackCfiCompare` function becomes largely obsolete.

-   **Action:** We should consider removing or strictly deprecating the fallback logic. "Fail fast" is often better than "fail silently with corrupt data."

-   **Action:** If we keep the fallback for absolute worst-case scenarios, we must log a high-severity warning whenever it is triggered, alerting us that the static import failed (which theoretically shouldn't happen if the build succeeds).

### Step 4: Verification via Test Suite

The existing test suite `src/lib/cfi-utils.test.ts` is the source of truth for verification.

-   **Action:** Run the tests specifically for this module.

-   **Success Criteria:** All tests pass *without* triggering the fallback logic. We can verify this by temporarily adding a `console.warn` inside the fallback function; if that warning never appears in the test logs, the fix is successful.

-   **Correctness Check:** Ensure that tests involving numerical steps (e.g., comparing `/2` vs `/10`) pass correctly. This proves the official `epub.js` comparator is being used, as it handles integers correctly unlike the string-based fallback.

4\. Verification & Execution
----------------------------

To apply and verify this fix, execute the following commands in the terminal. This will confirm that the bundler resolves the import and that the logic functions as intended.

```
# Run the specific test suite for CFI utilities
npx vitest src/lib/cfi-utils.test.ts

```

If successful, this change significantly hardens the reading history feature, preventing data corruption and ensuring users always resume their books at the correct location.
