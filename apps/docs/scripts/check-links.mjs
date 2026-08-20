import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"

const contentRoot = join(process.cwd(), "content/docs")

const files = (await readdir(contentRoot, { recursive: true }))
  .filter((file) => file.endsWith(".mdx"))
  .map((file) => join(contentRoot, file))

const routeOf = (file) => {
  const local = relative(contentRoot, file)
    .split(sep)
    .join("/")
    .replace(/\.mdx$/, "")
  return `/docs${local === "index" ? "" : `/${local.replace(/\/index$/, "")}`}`
}

const slug = (heading) =>
  heading
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")

const pages = new Map()
for (const file of files) {
  const source = await readFile(file, "utf8")
  const anchors = new Set()
  const occurrences = new Map()
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = slug(match[1])
    const occurrence = occurrences.get(base) ?? 0
    anchors.add(occurrence === 0 ? base : `${base}-${occurrence}`)
    occurrences.set(base, occurrence + 1)
  }
  pages.set(routeOf(file), { file, source, anchors })
}

for (const page of pages.values()) {
  for (const match of page.source.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1]
    assert.doesNotMatch(
      href,
      /\.mdx(?:#|$)/,
      `${page.file} contains an unrewritten MDX link: ${href}`,
    )
    if (href.startsWith("#")) {
      assert.ok(page.anchors.has(href.slice(1)), `${page.file} has no local anchor ${href}`)
      continue
    }
    if (!href.startsWith("/docs")) continue
    const [route, fragment] = href.split("#", 2)
    const target = pages.get(route)
    assert.ok(target, `${page.file} links to missing documentation route ${route}`)
    if (fragment !== undefined) {
      assert.ok(target.anchors.has(fragment), `${page.file} links to missing anchor ${href}`)
    }
  }
}

console.log(`Verified links across ${pages.size} documentation pages`)
