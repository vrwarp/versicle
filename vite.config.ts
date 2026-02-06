/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useHttps = env.VITE_HTTPS !== 'false';
  return {
    build: {
      sourcemap: true,
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
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
    server: {
      proxy: {
        '/__/auth': {
          target: env.VITE_FIREBASE_AUTH_DOMAIN ? `https://${env.VITE_FIREBASE_AUTH_DOMAIN}` : 'https://firebaseapp.com',
          changeOrigin: true,
          // Manually strip the Domain attribute to allow cookies to be set on localhost
          configure: (proxy, _options) => {
            proxy.on('proxyRes', (proxyRes, _req, _res) => {
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
