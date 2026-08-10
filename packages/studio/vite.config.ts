import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "src/ui",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/viewer": { target: "ws://127.0.0.1:4747", ws: true },
      "/editor": { target: "http://127.0.0.1:4747" },
    },
  },
})
