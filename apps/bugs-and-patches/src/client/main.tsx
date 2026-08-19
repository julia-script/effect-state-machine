import { lazy, StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import "./styles/app.css"

const root = document.getElementById("root")
if (root === null) throw new Error("The Bugs & Patches client root is missing.")

const DevelopmentPreview =
  import.meta.env.DEV && location.pathname === "/__dev/battle"
    ? lazy(() =>
        import("./BattlePreview.js").then(({ BattlePreview }) => ({ default: BattlePreview })),
      )
    : null

createRoot(root).render(
  <StrictMode>
    {DevelopmentPreview === null ? (
      <App />
    ) : (
      <Suspense fallback={null}>
        <DevelopmentPreview />
      </Suspense>
    )}
  </StrictMode>,
)
