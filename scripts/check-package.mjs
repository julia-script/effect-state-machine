import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.cwd()
const temporary = await mkdtemp(join(tmpdir(), "effect-state-machine-consumer-"))
const packed = join(temporary, "packed")
const consumer = join(temporary, "consumer")

const execute = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

try {
  await mkdir(packed)
  await mkdir(consumer)
  execute("pnpm", ["pack", "--pack-destination", packed])
  const archiveName = (await readdir(packed)).find((name) => name.endsWith(".tgz"))
  assert.ok(archiveName, "pnpm pack did not produce an archive")
  const archive = join(packed, archiveName)
  const contents = execute("tar", ["-tf", archive])
  assert.match(contents, /package\/dist\/index\.d\.ts/)
  assert.match(contents, /package\/dist\/devtools\.js/)
  assert.match(contents, /package\/dist\/devtools-viewer\.js/)
  assert.match(contents, /package\/dist\/devtools-viewer\.d\.ts/)
  assert.match(contents, /package\/dist\/devtools-viewer\.js\.map/)
  assert.doesNotMatch(contents, /prototype|src\/main|todo-effect-machine/)

  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "effect-state-machine-consumer-check",
        private: true,
        type: "module",
        dependencies: {
          effect: "4.0.0-beta.106",
          "effect-state-machine": `file:${archive}`,
        },
        devDependencies: {
          esbuild: "0.28.1",
          typescript: "7.0.2",
        },
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(consumer, "core.ts"),
    `import { Context, Effect, Layer, Schema } from "effect"
import { Machine } from "effect-state-machine"

class GreetFailed extends Schema.TaggedError<GreetFailed>()("GreetFailed", {
  message: Schema.String,
}) {}
class Greeter extends Context.Service<Greeter, Readonly<{
  greet: (name: string) => Effect.Effect<string, GreetFailed>
}>>()("consumer/Greeter") {}

const Input = Schema.Struct({ name: Schema.String })
const State = Machine.taggedUnion({
  Loading: {
    fields: { name: Schema.String },
    description: "Load a greeting through the injected service.",
  },
  Done: {
    fields: { message: Schema.String },
    description: "Complete with the generated greeting.",
  },
  Failed: {
    fields: { message: Schema.String },
    description: "Complete with an expected greeting failure.",
  },
})
const Cancel = Schema.TaggedStruct("Cancel", {})
const Event = Schema.Union([Cancel])
const greeting = Machine.builder({ input: Input, state: State, event: Event })

export const definition = greeting.make({
  id: "consumer-greeting",
  initial: (input) => ({ _tag: "Loading", name: input.name }),
  nodes: [
    greeting.invoke("Loading", {
      name: "Greeter.greet",
      effect: (state) => Effect.flatMap(Greeter, ({ greet }) => greet(state.name)),
      onSuccess: {
        target: "Done",
        reduce: ({ value }) => ({ _tag: "Done", message: value }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ _tag: "Failed", message: error.message }),
      },
    }),
    greeting.final("Done"),
    greeting.final("Failed"),
  ],
})

const GreeterLive = Layer.succeed(
  Greeter,
  Greeter.of({ greet: (name) => Effect.succeed(\`Hello, \${name}!\`) }),
)
const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* Machine.run(definition, { name: "Effect" })
    const completion = yield* handle.completion
    if (completion._tag !== "Done" || completion.message !== "Hello, Effect!") {
      throw new Error("unexpected completion")
    }
  }),
).pipe(Effect.provide(GreeterLive))

await Effect.runPromise(program)
`,
  )
  await writeFile(
    join(consumer, "tooling.ts"),
    `import { Effect, Schema, Stream } from "effect"
import { Machine } from "effect-state-machine"
import { Graph, Mermaid, Session } from "effect-state-machine/devtools"
import { definition } from "./core.js"

const graph = Graph.fromDefinition(definition)
const source = Mermaid.render(graph)
if (!source.includes("stateDiagram-v2")) throw new Error("missing Mermaid graph")

const Input = Schema.Struct({})
const State = Machine.taggedUnion({ Active: { fields: { count: Schema.Number } } })
const Event = Machine.taggedUnion({ Increment: { fields: { amount: Schema.Number } } })
const counter = Machine.builder({ input: Input, state: State, event: Event })
const counterDefinition = counter.make({
  id: "packed-counter",
  initial: () => ({ _tag: "Active", count: 0 }),
  nodes: [counter.state("Active", { on: { Increment: {
    target: "Active",
    reduce: ({ state, event }) => ({ ...state, count: state.count + event.amount }),
  } } })],
})
await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const handle = yield* Machine.run(counterDefinition, {})
  const session = yield* Session.attach({
    definition: counterDefinition,
    handle,
    quickEvents: [{ id: "increment", label: "Increment", event: { _tag: "Increment", amount: 2 } }],
  })
  yield* session.dispatchQuickEvent("increment")
  const observed = yield* Stream.runHead(session.changes.pipe(Stream.filter((view) => view.liveHead === 1)))
  if (observed._tag !== "Some" || observed.value.history.semantic.length !== 2) {
    throw new Error("missing session history")
  }
  if (Graph.focus(observed.value.graph, "Active", 1).nodes.length !== 1) {
    throw new Error("missing focused graph")
  }
})))
`,
  )
  await writeFile(
    join(consumer, "viewer.ts"),
    `import { Viewer } from "effect-state-machine/devtools/viewer"
void Viewer.mount
`,
  )

  execute("pnpm", ["install", "--offline"], consumer)
  execute("pnpm", ["exec", "tsc", "--noEmit"], consumer)
  execute(
    "pnpm",
    [
      "exec",
      "esbuild",
      "core.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--outfile=core.mjs",
      "--metafile=core-meta.json",
    ],
    consumer,
  )
  const coreMetadata = JSON.parse(await readFile(join(consumer, "core-meta.json"), "utf8"))
  const coreInputs = Object.keys(coreMetadata.inputs)
  assert.ok(coreInputs.some((input) => input.endsWith("/dist/Machine.js")))
  assert.deepEqual(
    coreInputs.filter((input) =>
      /effect-state-machine\/dist\/(Graph|Mermaid|devtools)\.js$/.test(input),
    ),
    [],
  )
  assert.doesNotMatch(await readFile(join(consumer, "core.mjs"), "utf8"), /stateDiagram-v2/)
  execute("node", ["core.mjs"], consumer)

  execute(
    "pnpm",
    [
      "exec",
      "esbuild",
      "tooling.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--outfile=tooling.mjs",
      "--metafile=tooling-meta.json",
    ],
    consumer,
  )
  const toolingMetadata = JSON.parse(await readFile(join(consumer, "tooling-meta.json"), "utf8"))
  assert.deepEqual(
    Object.keys(toolingMetadata.inputs).filter((input) =>
      /effect-state-machine\/dist\/(DevToolsViewer|devtools-viewer)\.js$/.test(input),
    ),
    [],
  )
  execute("node", ["tooling.mjs"], consumer)

  console.log(
    "Packed consumer verified core isolation, declarations, Layers, execution, and graph tooling",
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
