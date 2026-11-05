import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const productionCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'zendev-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <meta http-equiv="Content-Security-Policy" content="${productionCsp}" />\n  </head>`,
      )
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  define: { global: 'globalThis' },
  build: { target: 'chrome124' },
  optimizeDeps: {
    include: ['@smartspectra/node-sdk/renderer', '@smartspectra/node-sdk/messages'],
  },
})
