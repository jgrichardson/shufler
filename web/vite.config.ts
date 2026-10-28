/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import type { IncomingMessage, ClientRequest } from 'node:http';

const DAEMON = 'http://127.0.0.1:4700';

/**
 * The daemon accepts only its own origin (plus :5173 under SHUFLER_DEV=1). A page served by this dev
 * server, on any port, is shown to the daemon as the daemon's own origin. Only same-origin requests
 * (Origin equals this server's Host, and the Host is loopback) are rewritten, so other sites stay blocked.
 */
// Loopback only: matching Origin to Host alone would let a DNS-rebound attacker domain through.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;

function asDaemon(opts: ProxyOptions): ProxyOptions {
  const rewrite = (proxyReq: ClientRequest, req: IncomingMessage) => {
    const host = req.headers.host?.toLowerCase();
    if (host && LOOPBACK_HOST.test(host) && req.headers.origin === `http://${host}`) proxyReq.setHeader('origin', DAEMON);
  };
  return {
    target: DAEMON,
    ...opts,
    configure: (proxy) => {
      proxy.on('proxyReq', rewrite);
      proxy.on('proxyReqWs', rewrite);
    },
  };
}

export default defineConfig({
  // A static demo build sets SHUFLER_BASE (./ on GitHub Pages, so it works under /shufler/ and on a custom domain); the daemon serves the app at /.
  base: process.env.SHUFLER_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': asDaemon({ changeOrigin: false }),
      '/ws': asDaemon({ ws: true }),
      '/term': asDaemon({ ws: true }),
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
