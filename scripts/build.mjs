import { Buffer } from "node:buffer"
import { mkdir, writeFile } from "node:fs/promises"
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
await mkdir("dist", { recursive: true })
await writeFile("dist/reference-workflow.mmd", `${mermaid}\n`)

console.log("Built package modules, declarations, and dist/reference-workflow.mmd")
