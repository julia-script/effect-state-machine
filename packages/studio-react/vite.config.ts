import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    assetsInlineLimit: 0,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rollupOptions: {
      external: [
        /^@effect-state-machine\/studio-client(?:\/.*)?$/,
        /^@effect\/atom-react(?:\/.*)?$/,
        /^@xyflow\/react(?:\/.*)?$/,
        /^effect(?:\/.*)?$/,
        /^effect-state-machine(?:\/.*)?$/,
        /^elkjs(?:\/.*)?$/,
        /^react(?:\/.*)?$/,
        /^react-dom(?:\/.*)?$/,
      ],
    },
  },
})
