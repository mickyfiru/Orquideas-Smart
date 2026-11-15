import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'graficos', test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/telemetria': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
})
