import { afterEach, assert, describe, it, vi } from "@effect/vitest"
import * as SourceMap from "../src/SourceMap.js"

// esbuild `--loader=tsx --sourcemap=inline` map for a 13-line authored module;
// `defineMachine(` sits on authored line 10 and generated line 6.
const INLINE_MAP_BASE64 =
  "ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiL3dvcmtzcGFjZS9leGFtcGxlcy9tYWluLnRzeCJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IFJlYWN0IGZyb20gJ3JlYWN0J1xuLy8gY29tbWVudCBsaW5lIDJcbnR5cGUgRm9vID0geyBhOiBudW1iZXIgfVxuY29uc3QgeDogRm9vID0geyBhOiAxIH1cbmZ1bmN0aW9uIEFwcCgpIHtcbiAgcmV0dXJuIDxkaXY+XG4gICAgaGVsbG9cbiAgPC9kaXY+XG59XG5jb25zdCBtYWNoaW5lID0gZGVmaW5lTWFjaGluZSh7XG4gIGlkOiAndG9nZ2xlJyxcbn0pXG5jb25zb2xlLmxvZyh4LCBBcHAsIG1hY2hpbmUpXG4iXSwKICAibWFwcGluZ3MiOiAiQUFBQSxPQUFPLFdBQVc7QUFHbEIsTUFBTSxJQUFTLEVBQUUsR0FBRyxFQUFFO0FBQ3RCLFNBQVMsTUFBTTtBQUNiLFNBQU8sb0NBQUMsYUFBSSxPQUVaO0FBQ0Y7QUFDQSxNQUFNLFVBQVUsY0FBYztBQUFBLEVBQzVCLElBQUk7QUFDTixDQUFDO0FBQ0QsUUFBUSxJQUFJLEdBQUcsS0FBSyxPQUFPOyIsCiAgIm5hbWVzIjogW10KfQo="

// vite-node blanks any literal `sourceMappingURL=` occurrence in transformed
// test files (length-preserving), so the magic comment is assembled at runtime.
const TRANSPILED_MODULE = [
  'import React from "react";',
  "const x = { a: 1 };",
  "function App() {",
  '  return /* @__PURE__ */ React.createElement("div", null, "hello");',
  "}",
  "const machine = defineMachine({",
  '  id: "toggle"',
  "});",
  "console.log(x, App, machine);",
  `//# source${"MappingURL"}=data:application/json;base64,${INLINE_MAP_BASE64}`,
  "",
].join("\n")

const MODULE_URL = "http://localhost:5174/main.tsx"

const stubFetch = (routes: Readonly<Record<string, string>>) => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const body = routes[String(input)]
    return Promise.resolve(
      body === undefined ? new Response(undefined, { status: 404 }) : new Response(body),
    )
  })
}

describe("SourceMap.mapper", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps generated positions back through an inline source map", async () => {
    stubFetch({ [MODULE_URL]: TRANSPILED_MODULE })
    const map = await SourceMap.mapper([MODULE_URL])
    assert.isDefined(map)
    assert.deepStrictEqual(
      map?.({ file: MODULE_URL, line: 6, column: 17, functionName: "definition" }),
      { file: "/workspace/examples/main.tsx", line: 10, column: 17, functionName: "definition" },
    )
    assert.deepStrictEqual(map?.({ file: MODULE_URL, line: 7, column: 3 }), {
      file: "/workspace/examples/main.tsx",
      line: 11,
      column: 3,
    })
  })

  it("passes unmapped modules through and drops unmappable positions", async () => {
    stubFetch({ [MODULE_URL]: TRANSPILED_MODULE })
    const map = await SourceMap.mapper([MODULE_URL])
    const untouched = { file: "http://localhost:5174/other.tsx", line: 3, column: 1 }
    assert.deepStrictEqual(map?.(untouched), untouched)
    assert.strictEqual(map?.({ file: MODULE_URL, line: 999, column: 1 }), undefined)
  })

  it("returns undefined when no module yields a usable map", async () => {
    stubFetch({ [MODULE_URL]: "console.log('no source map here')" })
    assert.strictEqual(await SourceMap.mapper([MODULE_URL]), undefined)
    assert.strictEqual(await SourceMap.mapper(["/local/path.ts"]), undefined)
    assert.strictEqual(await SourceMap.mapper(["http://localhost:5174/missing.tsx"]), undefined)
  })
})
