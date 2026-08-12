import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Expose the package.json version to the app (shown in Settings → About).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// https://vitejs.dev/config/
// `base` is "/" locally, but "/<repo>/" on GitHub Pages — the deploy workflow
// sets VITE_BASE to the repo name so assets resolve under the sub-path.
// `npm run dev:https` (mode "https") serves over self-signed HTTPS so a PHONE
// on the same Wi-Fi gets a secure context — required for GPS/geolocation,
// wake lock and camera. The phone shows a one-time certificate warning
// (Advanced → Proceed); that's expected for a self-signed dev cert.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || '/',
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  plugins: [
    ...(mode === 'https' ? [basicSsl()] : []),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon-32x32.png'],
      manifest: {
        name: 'Machinery Piece Rates',
        short_name: 'PieceRates',
        description: 'Record heavy-machine work, offline-first.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        // 'any' so the installed app can rotate — the GPS map is much easier to
        // read in landscape. Forms are mobile-first and still fine either way.
        orientation: 'any',
        // Relative so they work under a GitHub Pages sub-path.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Pre-cache the app shell so it loads fully offline after first visit.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // Never let the SW intercept Supabase API/storage calls.
        navigateFallbackDenylist: [/^\/api/, /supabase\.co/]
      },
      devOptions: {
        // Enable the service worker in `npm run dev` so offline can be tested locally.
        enabled: true,
        type: 'module'
      }
    })
  ],
  server: { host: true }
}))
