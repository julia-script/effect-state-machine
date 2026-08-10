import { assert, describe, it } from "@effect/vitest"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import * as SourceLocation from "../src/SourceLocation.js"
import { counterDefinition } from "./fixtures/Counter.js"

describe("SourceLocation", () => {
  it("parses common Node and browser frames and rejects malformed frames", () => {
    assert.deepStrictEqual(SourceLocation.parseFrame("at decide (/workspace/app.ts:12:7)"), {
      file: "/workspace/app.ts",
      line: 12,
      column: 7,
      functionName: "decide",
    })
    assert.deepStrictEqual(SourceLocation.parseFrame("render@http://localhost/app.ts:9:4"), {
      file: "http://localhost/app.ts",
      line: 9,
      column: 4,
      functionName: "render",
    })
    assert.strictEqual(SourceLocation.parseFrame("at node:internal/process:1:1"), undefined)
    assert.strictEqual(
      SourceLocation.parseFrame("at http://localhost/dist/example.html:100:4"),
      undefined,
    )
    assert.strictEqual(SourceLocation.parseFrame("not a frame"), undefined)
  })

  it("captures declaration-level node locations and maps them when requested", () => {
    const graph = Graph.fromDefinition(counterDefinition)
    const active = graph.nodes.find((node) => node.id === "Active")
    const increment = graph.edges.find((edge) => edge.event?.tag === "Increment")
    assert.match(active?.location?.file ?? "", /tests\/fixtures\/Counter\.ts$/)
    assert.strictEqual(increment?.location?.file, active?.location?.file)

    const mapped = Graph.fromDefinition(counterDefinition, {
      mapSource: () => ({ file: "/authored/counter.ts", line: 5, column: 3 }),
    })
    assert.deepStrictEqual(mapped.nodes[0]?.location, {
      file: "/authored/counter.ts",
      line: 5,
      column: 3,
    })
  })

  it("captures named guards and omits absent or untrustworthy references", () => {
    const guard = Machine.namedGuard<unknown>({ name: "always", guard: () => true })
    assert.match(
      SourceLocation.resolve(guard.source)?.file ?? "",
      /tests\/SourceLocation\.test\.ts$/,
    )
    assert.strictEqual(SourceLocation.resolve(undefined), undefined)
    assert.strictEqual(
      SourceLocation.resolve({ stack: () => "Error\n at node:internal/process:1:1" }),
      undefined,
    )
  })

  it("filters internal frames after source-map projection", () => {
    const reference = {
      stack: () =>
        "Error\n at capture (http://localhost/interactive-devtools.js:1:1)\n at authored (http://localhost/interactive-devtools.js:2:1)",
    }
    assert.deepStrictEqual(
      SourceLocation.resolve(reference, {
        map: (generated) =>
          generated.line === 1
            ? { file: "/workspace/src/Source.ts", line: 7, column: 17 }
            : { file: "/workspace/examples/App.ts", line: 42, column: 9 },
      }),
      { file: "/workspace/examples/App.ts", line: 42, column: 9 },
    )
  })

  it("creates built-in VS Code and Cursor links and supports custom resolvers", () => {
    const source = { file: "/workspace/my file.ts", line: 12, column: 7 }
    assert.strictEqual(SourceLocation.vscode(source), "vscode://file/workspace/my%20file.ts:12:7")
    assert.strictEqual(SourceLocation.cursor(source), "cursor://file/workspace/my%20file.ts:12:7")
    const custom: SourceLocation.EditorResolver = (location) =>
      `editor://${location.line}:${location.column}`
    assert.strictEqual(custom(source), "editor://12:7")
  })
})
