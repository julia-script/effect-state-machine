import { Effect, Exit, Layer, Ref, Scope, Stream } from "effect"
import { type RawSourceMap, SourceMapConsumer } from "source-map-js"
import * as DevToolsSession from "../src/DevToolsSession.js"
import * as DevToolsViewer from "../src/DevToolsViewer.js"
import * as Machine from "../src/Machine.js"
import type * as SourceLocation from "../src/SourceLocation.js"
import { Checkout, Orders, PaymentDeclined } from "./Checkout.js"
import { LargeMachine } from "./LargeMachine.js"
import { Documents, LocalFirstDocument, Synchronizer } from "./LocalFirstDocument.js"

type Fixture = "checkout" | "document" | "large"
const root = document.querySelector<HTMLElement>("#app")
if (root === null) throw new Error("Missing #app")
let activeScope: Scope.Closeable | undefined
const projectRoot = "__INTERACTIVE_PROJECT_ROOT__"
let mapSource: SourceLocation.Mapper | undefined

const loadSourceMapper = async (): Promise<SourceLocation.Mapper | undefined> => {
  try {
    const response = await fetch(new URL("./interactive-devtools.js.map", location.href))
    if (!response.ok) return undefined
    const consumer = new SourceMapConsumer((await response.json()) as RawSourceMap)
    return (generated) => {
      if (!generated.file.endsWith("/interactive-devtools.js")) return generated
      const original = consumer.originalPositionFor({
        line: generated.line,
        column: Math.max(0, generated.column - 1),
      })
      if (original.source == null || original.line == null || original.column == null) {
        return undefined
      }
      const relative = original.source.replace(/^(?:\.\.\/)+/, "")
      return {
        file: `${projectRoot}/${relative}`,
        line: original.line,
        column: original.column + 1,
        ...(original.name === undefined ? {} : { functionName: original.name }),
      }
    }
  } catch {
    return undefined
  }
}

const button = (label: string, run: () => void): HTMLButtonElement => {
  const control = document.createElement("button")
  control.type = "button"
  control.textContent = label
  control.addEventListener("click", run)
  return control
}

const mode = new URLSearchParams(location.search).get("mode")
const standalone = mode === "viewer" || mode === "standalone"

const shell = (fixture: Fixture) => {
  root.replaceChildren()
  root.className = "tool-shell"
  const strip = document.createElement("header")
  strip.className = "app-strip"
  const title = document.createElement("h1")
  title.textContent = "Machine explorer"
  const label = document.createElement("label")
  label.textContent = "Fixture"
  const select = document.createElement("select")
  for (const value of ["checkout", "document", "large"] as const) {
    const option = document.createElement("option")
    option.value = value
    option.textContent =
      value === "checkout"
        ? "Checkout"
        : value === "document"
          ? "Local-first document"
          : "Large synthetic machine"
    option.selected = fixture === value
    select.append(option)
  }
  select.addEventListener("change", () => void start(select.value as Fixture))
  label.append(select)
  strip.append(title, label)
  const workspace = document.createElement("div")
  workspace.className = "workspace"
  if (standalone) workspace.dataset.standalone = ""
  const host = document.createElement("section")
  host.className = "host"
  const viewer = document.createElement("section")
  viewer.className = "viewer"
  host.hidden = standalone
  workspace.append(host, viewer)
  root.append(strip, workspace)
  return { host, viewer }
}

const startCheckout = async (host: HTMLElement, viewer: HTMLElement, scope: Scope.Closeable) => {
  host.parentElement?.setAttribute("data-dock", "")
  const attempts = await Effect.runPromise(Ref.make(0))
  const orders = Layer.succeed(
    Orders,
    Orders.of({
      place: () =>
        Ref.updateAndGet(attempts, (n) => n + 1).pipe(
          Effect.flatMap((n) =>
            n === 1
              ? Effect.fail(new PaymentDeclined({ message: "Try another payment method." }))
              : Effect.succeed(`order-${n}`),
          ),
        ),
    }),
  )
  const handle = await Effect.runPromise(
    Machine.run(Checkout.definition, {}).pipe(
      Effect.provide(orders),
      Effect.provideService(Scope.Scope, scope),
    ),
  )
  const session = await Effect.runPromise(
    DevToolsSession.attach({
      definition: Checkout.definition,
      handle,
      mapSource,
      projectState: (state) => state,
      quickEvents: [
        {
          id: "add",
          label: "Add random",
          group: "Cart",
          make: () => ({ _tag: "AddItem" as const, amount: 1 + Math.floor(Math.random() * 3) }),
        },
        { id: "checkout", label: "Checkout", group: "Cart", event: { _tag: "BeginCheckout" } },
        { id: "submit", label: "Submit", group: "Payment", event: { _tag: "SubmitOrder" } },
        { id: "retry", label: "Retry", group: "Payment", event: { _tag: "RetryPayment" } },
        { id: "back", label: "Back", group: "Cart", event: { _tag: "BackToShop" } },
      ],
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  host.innerHTML =
    "<h2>Checkout host</h2><p>These are ordinary application controls. The first payment fails; retry succeeds.</p>"
  const actions = document.createElement("div")
  actions.className = "host__actions"
  actions.append(
    button("Add item", () =>
      Effect.runFork(handle.send({ _tag: "AddItem", amount: 1 }).pipe(Effect.ignore)),
    ),
    button("Checkout", () =>
      Effect.runFork(handle.send({ _tag: "BeginCheckout" }).pipe(Effect.ignore)),
    ),
    button("Submit", () =>
      Effect.runFork(handle.send({ _tag: "SubmitOrder" }).pipe(Effect.ignore)),
    ),
    button("Retry", () =>
      Effect.runFork(handle.send({ _tag: "RetryPayment" }).pipe(Effect.ignore)),
    ),
  )
  host.append(actions)
  await Effect.runPromise(
    DevToolsViewer.mount({
      session,
      container: viewer,
      presentation: "dock",
      initiallyOpen: true,
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
}

const startDocument = async (host: HTMLElement, viewer: HTMLElement, scope: Scope.Closeable) => {
  host.parentElement?.setAttribute("data-dock", "")
  const deps = Layer.merge(
    Layer.succeed(
      Documents,
      Documents.of({
        open: (id) => Effect.succeed({ id, text: "Readable machines", revision: 1 }),
        save: ({ revision }) => Effect.succeed(revision + 1),
      }),
    ),
    Layer.succeed(
      Synchronizer,
      Synchronizer.of({ sync: ({ revision }) => Effect.succeed(revision + 1) }),
    ),
  )
  const handle = await Effect.runPromise(
    Machine.run(LocalFirstDocument.definition, { documentId: "demo" }).pipe(
      Effect.provide(deps),
      Effect.provideService(Scope.Scope, scope),
    ),
  )
  const session = await Effect.runPromise(
    DevToolsSession.attach({
      definition: LocalFirstDocument.definition,
      handle,
      mapSource,
      projectState: (state) => ({ tag: state._tag }),
      quickEvents: [
        {
          id: "edit",
          label: "Random edit",
          group: "Document",
          make: () => ({ _tag: "Edit" as const, text: `Draft ${Math.floor(Math.random() * 100)}` }),
        },
        { id: "save", label: "Save", group: "Document", event: { _tag: "Save" } },
        { id: "close", label: "Close", group: "Session", event: { _tag: "Close" } },
      ],
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  host.innerHTML =
    "<h2>Document host</h2><p>The same viewer observes a dependency-driven local-first workflow.</p>"
  const state = document.createElement("p")
  Effect.runFork(
    Stream.runForEach(handle.changes, (value) =>
      Effect.sync(() => {
        state.textContent = `Application state: ${value._tag}`
      }),
    ),
  )
  const actions = document.createElement("div")
  actions.className = "host__actions"
  actions.append(
    button("Edit", () =>
      Effect.runFork(
        handle.send({ _tag: "Edit", text: "Edited in the real app" }).pipe(Effect.ignore),
      ),
    ),
    button("Save", () => Effect.runFork(handle.send({ _tag: "Save" }).pipe(Effect.ignore))),
    button("Close", () => Effect.runFork(handle.send({ _tag: "Close" }).pipe(Effect.ignore))),
  )
  host.append(state, actions)
  await Effect.runPromise(
    DevToolsViewer.mount({
      session,
      container: viewer,
      presentation: "dock",
      initiallyOpen: true,
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
}

const startLarge = async (host: HTMLElement, viewer: HTMLElement, scope: Scope.Closeable) => {
  const handle = await Effect.runPromise(
    Machine.run(LargeMachine.definition, {}).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  const session = await Effect.runPromise(
    DevToolsSession.attach({
      definition: LargeMachine.definition,
      handle,
      mapSource,
      quickEvents: [
        { id: "next", label: "Next", group: "Move", event: { _tag: "Next" } },
        { id: "skip", label: "Skip seven", group: "Move", event: { _tag: "Skip" } },
        { id: "reset", label: "Reset", group: "Move", event: { _tag: "Reset" } },
        { id: "stay", label: "Stay", group: "Move", event: { _tag: "Stay" } },
      ],
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  host.innerHTML =
    "<h2>Large fixture</h2><p>A real 100-state, 400-edge machine. Focus stays bounded until you request the full map.</p>"
  host.hidden = true
  host.parentElement?.setAttribute("data-standalone", "")
  await Effect.runPromise(
    DevToolsViewer.mount({ session, container: viewer }).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  )
}

const start = async (fixture: Fixture) => {
  if (activeScope !== undefined) await Effect.runPromise(Scope.close(activeScope, Exit.void))
  const scope = await Effect.runPromise(Scope.make())
  activeScope = scope
  const { host, viewer } = shell(fixture)
  if (fixture === "checkout") await startCheckout(host, viewer, scope)
  else if (fixture === "document") await startDocument(host, viewer, scope)
  else await startLarge(host, viewer, scope)
}

const fixture = new URLSearchParams(location.search).get("fixture")
void loadSourceMapper().then((mapper) => {
  mapSource = mapper
  return start(fixture === "document" || fixture === "large" ? fixture : "checkout")
})
