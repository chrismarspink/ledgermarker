import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// LedgerMarker Web — 발급·원장·검증 PWA (DEV SPEC §8의 LM Verify에서 확장)
// Service Worker(Workbox)가 신뢰목록·최신 체크포인트를 캐시해
// 오프라인에서도 L1 검증이 가능하다.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LedgerMarker',
        short_name: 'LedgerMarker',
        description: 'LedgerMarker — 문서 라벨 발급·원장·검증',
        theme_color: '#1a2b4a',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            // 신뢰목록·CRL: 오프라인 L1 검증의 생명선 — 캐시 우선 갱신
            urlPattern: ({ url }) => url.pathname === '/v1/trust/list',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'lm-trust' }
          },
          {
            urlPattern: ({ url }) => url.pathname === '/v1/checkpoints/latest',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'lm-checkpoint' }
          },
          {
            // 포맷 카탈로그: 도움말 오프라인 렌더링용 (H2)
            urlPattern: ({ url }) => url.pathname === '/v1/formats',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'lm-formats' }
          }
        ]
      }
    })
  ],
  server: {
    proxy: {
      '/v1': process.env.LM_PROXY_TARGET || 'http://localhost:8080'
    }
  }
})
