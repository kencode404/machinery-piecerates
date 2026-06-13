import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
// `base` is "/" locally, but "/<repo>/" on GitHub Pages — the deploy workflow
// sets VITE_BASE to the repo name so assets resolve under the sub-path.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
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
        orientation: 'portrait',
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
})
