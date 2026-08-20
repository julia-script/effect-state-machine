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
  assert.match(contents, /package\/dist\/Durable\.d\.ts/)
  assert.match(contents, /package\/dist\/devtools\.js/)
  assert.doesNotMatch(contents, /devtools-viewer/)
  assert.doesNotMatch(contents, /interactive-devtools|local-first-document|reference-workflow/)
  assert.doesNotMatch(contents, /prototype|src\/main|todo-effect-machine/)

  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  assert.equal(manifest.publishConfig.exports["./Source"], undefined, "Source must stay private")
  assert.equal(manifest.publishConfig.exports["./DurableProtocol"], undefined)
  assert.equal(manifest.publishConfig.exports["./MachinePlan"], undefined)
  assert.doesNotMatch(await readFile(join(root, "dist/Machine.d.ts"), "utf8"), /_durableRuntime/)
  const packedFiles = new Set(contents.split("\n"))
  for (const [subpath, entry] of Object.entries(manifest.publishConfig.exports)) {
    if (typeof entry === "string") continue
    for (const file of Object.values(entry)) {
      assert.ok(
        packedFiles.has(`package/${file.slice(2)}`),
        `publishConfig export ${subpath} points at ${file}, which is missing from the packed archive`,
      )
    }
  }

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
    `// Intentional aggregate-import smoke test for the published root contracts.
import { Context, Effect, Layer, Schema } from "effect"
import * as Machine from "effect-state-machine/Machine"
import * as Durable from "effect-state-machine/Durable"

// @ts-expect-error Source is internal and must not resolve through the export map
import type * as PrivateSource from "effect-state-machine/Source"
// @ts-expect-error DurableProtocol is an implementation leaf, not a public subpath
import type * as PrivateDurableProtocol from "effect-state-machine/DurableProtocol"
// @ts-expect-error MachinePlan is an implementation leaf, not a public subpath
import type * as PrivateMachinePlan from "effect-state-machine/MachinePlan"

// @ts-expect-error the shared planner is package-private
Machine._durableRuntime

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

export const definition = greeting.define(
  {
    id: "consumer-greeting",
    initial: (input) => ({ _tag: "Loading", name: input.name }),
  },
  {
    Loading: greeting.invoke({
      name: "Greeter.greet",
      success: Schema.String,
      error: GreetFailed,
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
    Done: greeting.final(),
    Failed: greeting.final(),
  },
)

export const durableOptions: Durable.RunOptions = {
  instanceId: Durable.instanceId("consumer-greeting"),
  persistenceVersion: Durable.persistenceVersion("1"),
}

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
import { Graph, Mermaid } from "effect-state-machine/devtools"
import { definition } from "./core.js"

const graph = Graph.fromDefinition(definition)
const source = Mermaid.render(graph)
if (!source.includes("stateDiagram-v2")) throw new Error("missing Mermaid graph")
if (Graph.focus(graph, "Loading", 1).nodes.length < 1) throw new Error("missing focused graph")

const Input = Schema.Struct({})
const State = Machine.taggedUnion({ Active: { fields: { count: Schema.Number } } })
const Event = Machine.taggedUnion({ Increment: { fields: { amount: Schema.Number } } })
const counter = Machine.builder({ input: Input, state: State, event: Event })
const counterDefinition = counter.define(
  {
    id: "packed-counter",
    initial: () => ({ _tag: "Active", count: 0 }),
  },
  {
    Active: counter.state({
      Increment: {
        target: "Active",
        reduce: ({ state, event }) => ({ ...state, count: state.count + event.amount }),
      },
    }),
  },
)
await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const handle = yield* Machine.run(counterDefinition, {})
  yield* handle.send({ _tag: "Increment", amount: 2 })
  const observed = yield* Stream.runHead(handle.changes.pipe(Stream.filter((state) => state.count === 2)))
  if (observed._tag !== "Some") throw new Error("missing state change")
})))
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
  execute("node", ["tooling.mjs"], consumer)

  console.log(
    "Packed consumer verified core isolation, declarations, Layers, execution, and graph tooling",
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
