import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = process.cwd()
const sourceDirectory = join(root, "src")
const sourceFiles = (await readdir(sourceDirectory)).filter((file) => file.endsWith(".ts"))
const graph = new Map()

for (const file of sourceFiles) {
  const source = await readFile(join(sourceDirectory, file), "utf8")
  const dependencies = [...source.matchAll(/(?:from\s+|import\s*)["']\.\/([^"']+)\.js["']/g)]
    .map((match) => `${match[1]}.ts`)
    .filter((dependency) => sourceFiles.includes(dependency))
  graph.set(file, dependencies)
}

const visiting = new Set()
const visited = new Set()
const visit = (file, path = []) => {
  if (visiting.has(file)) {
    assert.fail(`source import cycle: ${[...path, file].join(" -> ")}`)
  }
  if (visited.has(file)) return
  visiting.add(file)
  for (const dependency of graph.get(file) ?? []) visit(dependency, [...path, file])
  visiting.delete(file)
  visited.add(file)
}
for (const file of graph.keys()) visit(file)

for (const implementation of ["DurableRunner.ts", "DurableMemory.ts", "DurableConformance.ts"]) {
  const source = await readFile(join(sourceDirectory, implementation), "utf8")
  assert.doesNotMatch(
    source,
    /from ["']\.\/Durable\.js["']/,
    `${implementation} must import DurableProtocol, never the public Durable façade`,
  )
}

const machine = await readFile(join(sourceDirectory, "Machine.ts"), "utf8")
assert.doesNotMatch(machine, /export\s+const\s+_durableRuntime/)

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
for (const privateModule of ["./DurableProtocol", "./MachinePlan", "./Internal"]) {
  assert.equal(manifest.exports[privateModule], undefined)
  assert.equal(manifest.publishConfig.exports[privateModule], undefined)
}

const maintained = [join(root, "README.md")]
for (const directory of ["examples", "prototypes"]) {
  const files = await readdir(join(root, directory), { recursive: true })
  maintained.push(
    ...files
      .filter((file) => file.endsWith(".ts") || file.endsWith(".md"))
      .map((file) => join(root, directory, file)),
  )
}
for (const file of maintained) {
  const source = await readFile(file, "utf8")
  assert.doesNotMatch(source, /from ["']effect["']/, `${file} must use Effect public subpaths`)
  assert.doesNotMatch(
    source,
    /from ["']effect-state-machine(?:\/devtools)?["']/,
    `${file} must use package public subpaths`,
  )
}

console.log(
  `Verified ${graph.size} acyclic source modules, private boundaries, and maintained imports`,
)
