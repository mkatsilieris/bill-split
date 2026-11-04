import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bill Split - Κοινά έξοδα',
        short_name: 'Bill Split',
        description: 'Διαχείριση κοινών οικογενειακών εξόδων',
        lang: 'el',
        theme_color: '#1d4ed8',
        background_color: '#f3f4f6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // never cache API responses in the service worker
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        // push / notificationclick handlers (public/push-sw.js)
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
