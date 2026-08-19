import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/DatabaseSchema.ts",
  out: "./drizzle",
})
