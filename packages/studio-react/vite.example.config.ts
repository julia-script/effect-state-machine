import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "examples",
  plugins: [react(), tailwindcss()],
  define: {
    // Stamped into the served bundle so Studio can absolutize the
    // dev-server-relative paths that browser source maps produce.
    __PROJECT_ROOT__: JSON.stringify(resolve(import.meta.dirname, "examples")),
  },
})
