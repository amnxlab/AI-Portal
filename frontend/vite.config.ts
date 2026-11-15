import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pre-bundle ALL heavy deps upfront so Vite doesn't re-discover them lazily
  // (which causes cascading 504 "Outdated Optimize Dep" reloads and blank pages).
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router-dom',
      'antd',
      '@ant-design/icons',
      'axios',
      'zustand',
      'zustand/middleware',
      'socket.io-client',
      'recharts',
      'dayjs',
      '@hello-pangea/dnd',
      'react-big-calendar',
      '@tanstack/react-query',
    ],
  },
  build: {
    // Not `dist`: that directory contains an orphaned `dist/html` folder left
    // by an April container operation, with ACLs that deny removal to both the
    // Windows user and container root. Vite empties its outDir before writing,
    // so it could never complete there. `build` is clean.
    outDir: 'build',

    // Split the heavy, rarely-changing dependencies out of the app chunk.
    // Previously everything shipped as one 3.1 MB file, so the login screen
    // downloaded the PDF renderer and the charting library before it could
    // paint. These four are each used by only one or two routes.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-antd':     ['antd', '@ant-design/icons'],
          'vendor-charts':   ['recharts'],
          'vendor-capture':  ['html2canvas'],
          'vendor-calendar': ['react-big-calendar'],
          'vendor-dnd':      ['@hello-pangea/dnd'],
        },
      },
    },
    // The vendor-antd chunk legitimately sits near this line; raising it keeps
    // the warning meaningful rather than permanently firing.
    chunkSizeWarningLimit: 900,
  },
  server: {
    // Bind to all interfaces so VS Code Remote forwards port 5173 to the browser.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        ws: true,
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
})
