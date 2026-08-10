import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { Schema } from "effect"
import { build } from "esbuild"

const output = await build({
  entryPoints: ["prototypes/public-machine-definition-api/example.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: ["node22"],
  legalComments: "none",
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
const { documentDefinition } = await import(moduleUrl)

assert.equal(documentDefinition.id, "document-session")
assert.deepEqual(
  documentDefinition.nodes.map((node) => [node.kind, node.tag]),
  [
    ["state", "Closed"],
    ["invoke", "Opening"],
    ["state", "Editing"],
    ["invoke", "Saving"],
    ["child", "Resolving"],
    ["state", "Failed"],
    ["final", "Done"],
  ],
)

assert.equal(
  Schema.resolveAnnotations(documentDefinition.schemas.state.cases.Editing)?.description,
  "The document is open and may contain unsaved changes.",
)
assert.equal(
  Schema.resolveAnnotations(documentDefinition.schemas.event.cases.Save)?.description,
  "Persist the current document contents.",
)

const opening = documentDefinition.nodes.find((node) => node.tag === "Opening")
assert.equal(opening?.kind, "invoke")
assert.equal(opening.name, "Documents.open")
assert.equal(opening.retry?.name, "retry transient open failures")
assert.equal(typeof opening.effect, "function")

const editing = documentDefinition.nodes.find((node) => node.tag === "Editing")
assert.equal(editing?.kind, "state")
assert.equal(editing.on.Save.branches[0].when.name, "document has changes")
assert.equal(editing.on.Save.branches[1].otherwise, true)

const resolving = documentDefinition.nodes.find((node) => node.tag === "Resolving")
assert.equal(resolving?.kind, "child")
assert.equal(resolving.name, "resolve document conflict")
assert.equal(resolving.machine.id, "resolve-conflict")
assert.deepEqual(resolving.forward, ["ChooseLocal", "ChooseRemote"])

console.log("Public API prototype is synchronously inspectable without running Effects")
