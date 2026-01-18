/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
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
