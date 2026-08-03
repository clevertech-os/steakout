import nimiq from '@nimiq/core/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Monorepo root `.env` (same file as the server). Vite's default envDir is `client/`.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  envDir: repoRoot,
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
