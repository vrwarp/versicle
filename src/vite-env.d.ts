/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  /**
   * Set to 'true' by E2E builds (Dockerfile.verification) to install the
   * typed window.__versicleTest API (src/lib/test-api.ts). Never set in
   * production builds.
   */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.ogg' {
    const src: string;
    export default src;
}

declare module '*.mp3' {
    const src: string;
    export default src;
}
