import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const output = await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: ["es2022"],
  sourcemap: false,
  legalComments: "none",
})

const shell = await readFile(join(root, "src/prototype.html"), "utf8")
const html = shell.replace("/* PROTOTYPE_BUNDLE */", output.outputFiles[0].text)
const outputDirectory = join(root, "dist")
await mkdir(outputDirectory, { recursive: true })
await writeFile(join(outputDirectory, "effect-native-todo.prototype.html"), html)

const mermaidBundle = await build({
  entryPoints: [join(root, "src/mermaid-entry.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: ["node22"],
  legalComments: "none",
})
const mermaidModule = await import(
  `data:text/javascript;base64,${Buffer.from(mermaidBundle.outputFiles[0].text).toString("base64")}`
)
await writeFile(join(outputDirectory, "effect-native-todo.mmd"), mermaidModule.default)

console.log("Built dist/effect-native-todo.prototype.html and dist/effect-native-todo.mmd")
