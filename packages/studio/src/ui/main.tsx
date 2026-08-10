import { RegistryProvider } from "@effect/atom-react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import "./theme.css"

const container = document.getElementById("root")
if (container === null) throw new Error("missing #root container")

createRoot(container).render(
  <RegistryProvider>
    <App />
  </RegistryProvider>,
)
