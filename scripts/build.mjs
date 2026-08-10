import { Buffer } from "node:buffer"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { build } from "esbuild"

const output = await build({
  stdin: {
    contents: `
      import { LocalFirstDocument } from "./examples/LocalFirstDocument.ts"
      import * as Graph from "./src/Graph.ts"
      import * as Mermaid from "./src/Mermaid.ts"
      export default Mermaid.render(Graph.fromDefinition(LocalFirstDocument.definition))
    `,
    resolveDir: process.cwd(),
    sourcefile: "reference-workflow-entry.ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: ["node22"],
  legalComments: "none",
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
const mermaid = (await import(moduleUrl)).default

const pageBundle = await build({
  entryPoints: ["examples/local-first-document-page.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  legalComments: "none",
  charset: "utf8",
  plugins: [
    {
      name: "unused-node-assert-browser-stub",
      setup(browserBuild) {
        browserBuild.onResolve({ filter: /^node:assert$/ }, () => ({
          path: "node:assert",
          namespace: "browser-stub",
        }))
        browserBuild.onLoad({ filter: /.*/, namespace: "browser-stub" }, () => ({
          contents: "export const deepStrictEqual = () => undefined",
          loader: "js",
        }))
      },
    },
  ],
})

const pageStyles = await build({
  entryPoints: ["examples/local-first-document-page.css"],
  bundle: true,
  write: false,
  loader: { ".css": "css" },
  legalComments: "none",
  charset: "utf8",
})

const pageTemplate = await readFile("examples/local-first-document-page.html", "utf8")
const page = pageTemplate
  .replace("/* PAGE_CSS */", () => pageStyles.outputFiles[0].text)
  .replace("/* PAGE_BUNDLE */", () => pageBundle.outputFiles[0].text)

await mkdir("dist", { recursive: true })
await writeFile("dist/reference-workflow.mmd", `${mermaid}\n`)
await writeFile("dist/local-first-document.html", page)

const interactiveBundle = await build({
  entryPoints: ["examples/interactive-devtools-page.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  legalComments: "none",
  charset: "utf8",
})
const interactiveStyles = await build({
  entryPoints: ["examples/interactive-devtools-page.css"],
  bundle: true,
  write: false,
  loader: { ".css": "css" },
  legalComments: "none",
  charset: "utf8",
})
const interactiveTemplate = await readFile("examples/interactive-devtools-page.html", "utf8")
const interactivePage = interactiveTemplate
  .replace("/* PAGE_CSS */", () => interactiveStyles.outputFiles[0].text)
  .replace("/* PAGE_BUNDLE */", () => interactiveBundle.outputFiles[0].text)
await writeFile("dist/interactive-devtools.html", interactivePage)

console.log(
  "Built package modules, declarations, graph artifacts, and interactive browser examples",
)
