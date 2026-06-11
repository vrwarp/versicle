import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'
import { visualizer } from 'rollup-plugin-visualizer'

// Path aliases (Phase 1 path-alias codemod): one alias per top-level src/
// root. MUST stay in sync with the `paths` map in tsconfig.app.json and the
// copy of this object in vitest.config.ts (a root vitest.config.ts does NOT
// merge this file, so vitest needs its own resolve.alias). Vite applies
// resolve.alias to worker bundles (worker.format: 'es') and the
// vite-plugin-pwa sw.ts build as well. types/ is '~types' not '@types'
// because TypeScript rejects '@types/…' specifiers (TS6137 — see
// tsconfig.app.json).
const srcAlias = (dir: string) => fileURLToPath(new URL(`./src/${dir}`, import.meta.url))
const aliases = {
  '@app': srcAlias('app'),
  '@components': srcAlias('components'),
  '@db': srcAlias('db'),
  '@hooks': srcAlias('hooks'),
  '@lib': srcAlias('lib'),
  '@store': srcAlias('store'),
  '~types': srcAlias('types'),
  '@test': srcAlias('test'),
  '@workers': srcAlias('workers'),
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useHttps = env.VITE_HTTPS !== 'false';
  // ANALYZE=true vite build → per-module treemaps for the main bundle (stats.html) and the
  // TTS worker bundle (stats-worker.html). Dev-only; normal builds are unaffected.
  const analyze = env.ANALYZE === 'true';
  return {
    base: env.VITE_BASE || '/',
    resolve: {
      alias: aliases,
    },
    build: {
      sourcemap: true,
    },
    // ES-module workers so the TTS engine worker (a large, code-split module graph) can be
    // bundled — the default 'iife' format rejects code-splitting. Workers are loaded with
    // { type: 'module' }, so this matches.
    worker: {
      format: 'es',
      plugins: () => (analyze
        ? [visualizer({ filename: 'stats-worker.html', gzipSize: true, brotliSize: true })]
        : []),
    },
    preview: {
      headers: {
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://apis.google.com https://*.firebaseapp.com; style-src 'self' 'unsafe-inline' blob:; img-src 'self' data: blob: https:; connect-src 'self' https: blob: https://*.googleapis.com https://*.firebaseio.com; font-src 'self' data:;"
      }
    },
    plugins: [
      ...(useHttps ? [mkcert()] : []),
      ...(analyze ? [visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true })] : []),
      react(),
      VitePWA({
        devOptions: {
          enabled: true,
          type: 'module',
        },
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectManifest: {
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 // 4MB
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        manifest: {
          name: 'Versicle Reader',
          short_name: 'Versicle',
          description: 'Local-first EPUB reader and manager.',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    // NOTE: no `test` block here on purpose. Vitest is configured exclusively
    // in vitest.config.ts — a root vitest.config.ts overrides (not merges)
    // any `test` field in this file, so settings added here would be dead.
    server: {
      proxy: {
        '/__/auth': {
          target: env.VITE_FIREBASE_AUTH_DOMAIN ? `https://${env.VITE_FIREBASE_AUTH_DOMAIN}` : 'https://firebaseapp.com',
          changeOrigin: true,
          // Manually strip the Domain attribute to allow cookies to be set on localhost
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              const cookies = proxyRes.headers['set-cookie'];
              if (cookies && Array.isArray(cookies)) {
                proxyRes.headers['set-cookie'] = cookies.map((cookie) => {
                  return cookie.replace(/Domain=[^;]+;/gi, '');
                });
              }
            });
          },
        },
      },
    },
  }
})
