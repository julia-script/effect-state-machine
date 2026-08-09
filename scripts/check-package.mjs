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
const Loading = Schema.TaggedStruct("Loading", { name: Schema.String })
const Done = Schema.TaggedStruct("Done", { message: Schema.String })
const Failed = Schema.TaggedStruct("Failed", { message: Schema.String })
const State = Schema.Union([Loading, Done, Failed]).pipe(Schema.toTaggedUnion("_tag"))
const Cancel = Schema.TaggedStruct("Cancel", {})
const Event = Schema.Union([Cancel]).pipe(Schema.toTaggedUnion("_tag"))
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
    `import { Graph, Mermaid } from "effect-state-machine/devtools"
import { definition } from "./core.js"

const graph = Graph.fromDefinition(definition)
const source = Mermaid.render(graph)
if (!source.includes("stateDiagram-v2")) throw new Error("missing Mermaid graph")
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
