# Source Code

The layered module map, with a one-line description of every directory
below, lives in the GENERATED `architecture.md` §1 at the repo root — it is
rendered from the code's own registries and cannot drift, so it wins over
anything written here. Layer READMEs with per-module detail:

*   **`kernel/README.md`** (generated) — L0 utilities + the egress registry.
*   **`data/README.md`** (generated) — the only IndexedDB subsystem.
*   **`store/README.md`** (generated) — the three-tier store registry.
*   **`domains/README.md`** (generated) — the vertical feature modules.
*   **`lib/README.md`**, **`workers/README.md`**, **`types/README.md`**,
    **`hooks/README.md`**, **`components/README.md`** — hand-written.

## Root files

*   **`main.tsx`**: the entry point — installs the test API (DEV/E2E
    builds) and mounts `<App/>`.
*   **`App.tsx`**: boot-state rendering + the router gate over
    `app/routes.tsx`; the boot sequence itself is `app/bootstrap.ts` (C11).
*   **`sw.ts`**: the service worker (workbox precache, runtime caching,
    SKIP_WAITING handshake).
*   **`test-api.ts`**: `window.__versicleTest` page-side test seams.
*   **`index.css`**: global stylesheets — Tailwind directives and theme
    variables.
*   **`App_*.test.tsx` / `integration.test.ts`**: the C11 entry-gate boot
    suites and cross-store integration tests.
