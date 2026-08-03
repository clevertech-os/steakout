import nimiq from '@nimiq/core/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // @nimiq/core Transaction.fromAny needs WASM (P0-03 hash derivation on client).
  plugins: [react(), ...nimiq()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
