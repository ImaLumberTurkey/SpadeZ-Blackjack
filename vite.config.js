import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only: forward API calls and uploaded images to the local Worker (see scripts/dev.js).
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/assets': 'http://127.0.0.1:8788',
    },
  },
})