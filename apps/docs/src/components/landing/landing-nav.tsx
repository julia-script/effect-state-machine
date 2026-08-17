import packageJson from "effect-state-machine/package.json"
import Link from "next/link"
import { appName, docsRoute, gitConfig } from "@/lib/shared"

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`

export function LandingNav() {
  return (
    <header className="landing-nav">
      <div className="landing-nav__inner">
        <Link className="landing-nav__brand" href="/" aria-current="page">
          {appName}
        </Link>
        <span className="landing-nav__sticker">v{packageJson.version} · MIT</span>
        <span className="landing-nav__spacer" />
        <nav className="landing-nav__links" aria-label="Primary">
          <Link className="chip-btn" href={docsRoute}>
            Docs
          </Link>
          <Link className="chip-btn" href="/tetris">
            Tetris
          </Link>
          <a className="chip-btn" href={githubUrl} rel="noreferrer">
            GitHub
          </a>
          <a className="chip-btn chip-btn--coral" href="/#demo">
            Try the demo
          </a>
        </nav>
      </div>
    </header>
  )
}
