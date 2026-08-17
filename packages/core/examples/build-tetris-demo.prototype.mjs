/* PROTOTYPE — builds the single-file Tetris demo page.
 * Run: node examples/build-tetris-demo.prototype.mjs
 * Output: examples/tetris-demo.prototype.html (double-click to play). */
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))

const bundle = await build({
  entryPoints: [join(here, "tetris-demo.prototype.ts")],
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

const css = await readFile(join(here, "tetris-demo.prototype.css"), "utf8")

const template = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Tetris as one effect-state-machine definition. Prototype demo." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap"
      rel="stylesheet"
    />
    <title>Tetris · effect-state-machine prototype</title>
    <style>
      /* PAGE_CSS */
    </style>
  </head>
  <body>
    <div id="app">
      <p class="boot-message">Booting the tetris machine…</p>
    </div>
    <script>
      /* PAGE_BUNDLE */
    </script>
  </body>
</html>
`

const page = template
  .replace("/* PAGE_CSS */", () => css)
  .replace("/* PAGE_BUNDLE */", () => bundle.outputFiles[0].text)

await writeFile(join(here, "tetris-demo.prototype.html"), page)
console.log("Built examples/tetris-demo.prototype.html")
