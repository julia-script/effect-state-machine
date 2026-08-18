import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Metadata } from "next"
import { TetrisDemo } from "@/components/tetris/tetris-demo"
import "@/components/tetris/tetris.css"

export const metadata: Metadata = {
  title: "Tetris demo",
  description:
    "A complete Tetris game as one effect-state-machine definition, with the embedded Studio watching it live.",
}

export default async function TetrisPage() {
  const source = await readFile(
    path.join(process.cwd(), "src/components/tetris/tetris-machine.ts"),
    "utf8",
  )
  return (
    <main id="main" className="tetris-page">
      <div className="tetris-page__inner">
        <header className="tetris-intro">
          <h1>Tetris, as one machine definition</h1>
          <p>
            The whole game is a single machine: gravity is a named timer owned by the{" "}
            <code>Falling</code> state, steering is a <code>stay</code> update that leaves it
            running, and every lock, clear, and top-out decision is a named guard. The embedded
            Studio is attached to the same handle — play from the keyboard or drive the machine from
            Studio&apos;s quick events.
          </p>
          <p className="tetris-hint">
            ← → move · ↑ rotate · ↓ soft drop · space hard drop · P pause
          </p>
        </header>
        <TetrisDemo />
        <details className="tetris-code">
          <summary>
            <span className="tetris-panel-label">the code</span>
            <span className="tetris-code-note">
              tetris-machine.ts — the whole game is this one definition
            </span>
          </summary>
          <div className="tetris-code-body">
            <pre>{source}</pre>
          </div>
        </details>
      </div>
    </main>
  )
}
