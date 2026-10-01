import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { betsApi } from './server/betsApi.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), betsApi('data/bets.db')],
    server: {
      proxy: {
        '/api/agentmail': {
          target: 'https://api.agentmail.to',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/agentmail/, '/v0'),
          // Inject the auth header
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.VITE_AGENTMAIL_API_KEY}`);
            });
          },
        },
      }
  }}
})
