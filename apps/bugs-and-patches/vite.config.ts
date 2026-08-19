import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/game": { target: "ws://127.0.0.1:4788", ws: true },
      "/auth": { target: "http://127.0.0.1:4788" },
      "/api": { target: "http://127.0.0.1:4788" },
    },
  },
})
