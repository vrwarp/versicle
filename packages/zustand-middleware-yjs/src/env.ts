/**
 * Dev-environment detection without depending on @types/node or vite/client.
 *
 * Used for the loud dev-mode failures of the Phase 2 fork surgery
 * (phase2-fork-surgery.md §2.1 misconfiguration errors, §2.3 scoped-diff
 * sampling assert). Resolution order:
 *
 *   1. Vite / vitest: `import.meta.env.DEV` (defined in dev serve, test, and
 *      statically false in production builds);
 *   2. Node-ish hosts: `process.env.NODE_ENV !== "production"`;
 *   3. otherwise: NOT dev (fail safe — never throw in an unknown production
 *      host).
 */
export const isDevEnvironment = (): boolean =>
{
  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;

  if (viteEnv && typeof viteEnv.DEV === "boolean")
    return viteEnv.DEV;

  const nodeEnv = (globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env?.NODE_ENV;

  if (typeof nodeEnv === "string")
    return nodeEnv !== "production";

  return false;
};
