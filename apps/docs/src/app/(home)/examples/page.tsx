import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Examples",
  description: "Interactive examples of effect-state-machine, each with the Studio attached live.",
}

export default function ExamplesPage() {
  return (
    <main id="main" className="landing-shell">
      <div className="landing-shell__wide spec">
        <div className="spec__intro">
          <h2>Examples</h2>
          <p>
            Complete applications modeled as machine definitions, each with the embedded Studio
            attached to the running instance.
          </p>
        </div>
        <div className="spec__grid">
          <Link className="spec-card spec-card--tilt-a" href="/examples/tetris">
            <span className="spec-card__kind spec-card__kind--pear">game loop</span>
            <span className="spec-card__title">Tetris</span>
            <p>
              A full game as one machine: gravity as a named state-derived timer, steering as{" "}
              <code>stay</code> updates, and lock, clear, and top-out decisions as named guards.
            </p>
          </Link>
          <Link className="spec-card spec-card--tilt-b" href="/#demo">
            <span className="spec-card__kind spec-card__kind--cyan">checkout flow</span>
            <span className="spec-card__title">The Bug Emporium</span>
            <p>
              The landing-page shop: a cart and checkout session with typed failures and retries,
              driven live beside Studio&apos;s behavior map.
            </p>
          </Link>
        </div>
      </div>
    </main>
  )
}
