import { fileURLToPath, URL } from 'node:url'
import { createReadStream, existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'
import { visualizer } from 'rollup-plugin-visualizer'
import { renderCsp } from './src/kernel/net/csp'
import wasm from 'vite-plugin-wasm'

/**
 * CSP injection (Phase 7 §I): the policy is GENERATED from the egress
 * destination registry (src/kernel/net/destinations.ts) — renderCsp() is the
 * single renderer behind nginx.conf (scripts/generate-csp.mjs), the preview
 * headers below, and this build-time index.html <meta> tag. The meta tag is
 * what gives the Capacitor Android WebView a CSP at all (it serves dist/
 * without nginx; before Phase 7 it ran with none — privacy report D4).
 * Injected at BUILD only: the dev server needs the HMR websocket (ws:),
 * which a committed meta would block. The registry==CSP unit test
 * (src/kernel/net/csp.test.ts) pins all copies against the registry.
 */
function cspMetaPlugin(): Plugin {
  return {
    name: 'versicle:csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${renderCsp()}" />`,
      )
    },
  }
}

/**
 * Serve + ship the vendored Piper runtime (Phase 5a-PR3,
 * plan/overhaul/prep/phase5-tts-strangler.md §5a.2).
 *
 * `third-party/piper/` is checked into git (patched worker as committed source,
 * local onnxruntime build, PROVENANCE.md) and replaces the install-time
 * `prepare-piper` postinstall that copied gitignored blobs into `public/piper/`.
 * The runtime URL layout is UNCHANGED (`/piper/piper_worker.js`,
 * `/piper/onnxruntime/…`), so existing user caches and download state survive:
 *  - dev/preview: a middleware serves `/piper/**` straight from the vendor dir;
 *  - build: the directory is copied into `dist/piper/` (PROVENANCE.md included —
 *    it is the GPL §6 provenance record for the shipped blobs).
 */
function piperVendorPlugin(): Plugin {
  const vendorRoot = fileURLToPath(new URL('./third-party/piper', import.meta.url))
  const contentTypes: Record<string, string> = {
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
    '.data': 'application/octet-stream',
    '.json': 'application/json',
    '.md': 'text/markdown',
  }
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (!url.startsWith('/piper/')) return next()
    const file = path.join(vendorRoot, url.slice('/piper/'.length))
    // path.join normalizes '..' — keep lookups inside the vendor dir.
    if (!file.startsWith(vendorRoot + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      return next()
    }
    res.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  }
  const copyDir = (from: string, to: string) => {
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name)
      const dest = path.join(to, entry.name)
      if (entry.isDirectory()) copyDir(src, dest)
      else copyFileSync(src, dest)
    }
  }
  let outDir = 'dist'
  return {
    name: 'versicle:piper-vendor',
    configResolved(config) {
      outDir = path.isAbsolute(config.build.outDir)
        ? config.build.outDir
        : path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
    closeBundle() {
      // Runs once per rollup build (main + worker); the copy is idempotent.
      copyDir(vendorRoot, path.join(outDir, 'piper'))
    },
  }
}

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
  '@data': srcAlias('data'),
  '@domains': srcAlias('domains'),
  '@hooks': srcAlias('hooks'),
  '@kernel': srcAlias('kernel'),
  '@lib': srcAlias('lib'),
  '@store': srcAlias('store'),
  '~types': srcAlias('types'),
  '@test': srcAlias('test'),
  '@workers': srcAlias('workers'),
  // epub.js's Node/IE fallback DOM implementation — unreachable in browser
  // builds but not tree-shakeable (~158KB in the entry AND TTS-worker
  // chunks). Stubbed for app builds only; vitest.config.ts deliberately does
  // NOT carry this alias so tests exercise the real package.
  '@xmldom/xmldom': srcAlias('lib/xmldom-browser-stub.ts'),
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
      // Single-instance guard (phase2-fork-surgery.md §6.6c): the upstream
      // y-cinder / y-idb / zustand-middleware-yjs deps declare yjs/zustand/lib0
      // as peers; dedupe is the bundler-level belt-and-braces so a second copy
      // can never split `instanceof Y.Map` identity (or y-idb's lib0/observable
      // base). Keep in sync with vitest.config.ts and assert-single-instance.cjs.
      dedupe: ['yjs', 'zustand', 'lib0'],
    },
    build: {
      sourcemap: true,
    },
    // ES-module workers so the TTS engine worker (a large, code-split module graph) can be
    // bundled — the default 'iife' format rejects code-splitting. Workers are loaded with
    // { type: 'module' }, so this matches.
    worker: {
      format: 'es',
      plugins: () => [
        wasm(),
        ...(analyze ? [visualizer({ filename: 'stats-worker.html', gzipSize: true, brotliSize: true })] : []),
      ],
    },
    preview: {
      headers: {
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        // Generated from the egress destination registry — see cspMetaPlugin.
        'Content-Security-Policy': renderCsp()
      }
    },
    plugins: [
      wasm(),
      piperVendorPlugin(),
      cspMetaPlugin(),
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
        // Phase 8 §G: prompt-style updates. A new SW waits until the user
        // accepts the update toast (src/components/SWUpdatePrompt.tsx →
        // updateServiceWorker() → SKIP_WAITING message handled in src/sw.ts).
        // The previously-fielded autoUpdate SW skipWaiting-s ITSELF out, so
        // the transition to the first prompt-build is seamless (prep risk #1).
        registerType: 'prompt',
        injectManifest: {
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4MB
          // The vendored onnxruntime wasm builds (dist/piper/onnxruntime/, ~10MB
          // each — see piperVendorPlugin) are far beyond any sane precache budget;
          // they load on demand when Piper synthesizes (and are runtime-cached
          // by the /piper/* CacheFirst route in src/sw.ts since Phase 8 §G).
          globIgnores: ['**/piper/onnxruntime/*.wasm', '**/*tern_engine*.wasm'],
        },
        // Reality-checked (Phase 8 §G, prep RC-11): favicon.ico was committed
        // as `favico.ico` (typo, now renamed), apple-touch-icon.png is
        // generated from pwa-512x512.png, and the phantom mask-icon.svg
        // entry was trimmed — no such asset has ever existed.
        includeAssets: ['apple-touch-icon.png'],
        manifest: {
          // `id` pins app identity across start_url changes; lang/dir feed
          // the OS shell (Phase 8 §F: UI locale is en until a second locale
          // ships); display/start_url are the Lighthouse installability
          // requirements.
          id: '/',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          lang: 'en',
          dir: 'ltr',
          name: 'Versicle Reader',
          short_name: 'Versicle',
          description: 'Local-first EPUB reader and manager.',
          theme_color: '#ffffff',
          background_color: '#ffffff',
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
