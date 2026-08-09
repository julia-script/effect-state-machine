import { Effect, Layer, ManagedRuntime, Result, Stream } from "effect"
import { toMermaid } from "./effect-machine-devtools"
import {
  type Todo,
  type TodoAdapter,
  TodoApp,
  type TodoEvent,
  type TodoState,
  Todos,
  todoDefinition,
} from "./todo-effect-machine"

type HarnessCommand =
  | Readonly<{ _tag: "UseMemory" }>
  | Readonly<{ _tag: "UseFailing" }>
  | Readonly<{ _tag: "ResetDemo" }>
type PrototypeCommand = TodoEvent | HarnessCommand

type GuideStep = Readonly<{
  label: string
  note: string
  ready: (state: TodoState) => boolean
  command: (state: TodoState) => PrototypeCommand
}>

type Scenario = Readonly<{
  title: string
  adapter: TodoAdapter
  description: string
  watch: string
  steps: ReadonlyArray<GuideStep>
}>

const mermaid = toMermaid(todoDefinition)

const createBrowserApp = (adapter: TodoAdapter) => {
  const selectedAdapter = adapter === "memory" ? Todos.Memory : Todos.Failing
  const runtime = ManagedRuntime.make(TodoApp.layer.pipe(Layer.provide(selectedAdapter)))

  return {
    send: (event: TodoEvent) =>
      runtime.runPromise(Effect.flatMap(TodoApp, (app) => Effect.result(app.send(event)))),
    snapshot: () => runtime.runPromise(Effect.flatMap(TodoApp, (app) => app.snapshot)),
    subscribe: (onState: (state: TodoState) => void) => {
      runtime.runFork(
        Effect.flatMap(TodoApp, (app) =>
          Stream.runForEach(app.changes, (state) => Effect.sync(() => onState(state))),
        ),
      )
    },
    dispose: () => runtime.dispose(),
  }
}

type BrowserApp = ReturnType<typeof createBrowserApp>

const isIdle = (state: TodoState): state is Extract<TodoState, { _tag: "Idle" }> =>
  state._tag === "Idle"

const isOperating = (state: TodoState) =>
  ["Adding", "Toggling", "Deleting", "Clearing"].includes(state._tag)

const todosOf = (state: TodoState): ReadonlyArray<Todo> => {
  switch (state._tag) {
    case "Idle":
    case "Adding":
    case "Toggling":
    case "Deleting":
    case "Clearing":
      return state.todos
    case "Loading":
    case "Crashed":
      return []
  }
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    title: "Swap the dependency",
    adapter: "memory",
    description:
      "Run one machine definition against two Todos implementations selected only when execution begins.",
    watch:
      "The state graph and inferred requirement never change. Only the Layer provided to Machine.run changes.",
    steps: [
      {
        label: "Add through Todos.Memory",
        note: "The in-memory adapter accepts the write and returns the new list.",
        ready: isIdle,
        command: () => ({ _tag: "Add", title: "Provided by Memory" }),
      },
      {
        label: "Re-run with Todos.Failing",
        note: "The machine is reconstructed with a different Layer, not edited.",
        ready: isIdle,
        command: () => ({ _tag: "UseFailing" }),
      },
      {
        label: "Try the same ADD",
        note: "The typed StorageUnavailable error flows directly into onFailure.",
        ready: isIdle,
        command: () => ({ _tag: "Add", title: "Rejected by adapter" }),
      },
      {
        label: "Return to Todos.Memory",
        note: "The identical machine can execute again with a working implementation.",
        ready: (state) => isIdle(state) && state.error !== null,
        command: () => ({ _tag: "UseMemory" }),
      },
    ],
  },
  {
    title: "Typed failure",
    adapter: "failing",
    description:
      "Observe a TodoError travel through the Effect error channel without crossing a Promise actor.",
    watch:
      "Machine.invoke infers the error type from Effect<Todos, TodoError, Todos>; onFailure receives TodoError directly.",
    steps: [
      {
        label: "Attempt ADD",
        note: "The failing adapter rejects the write after the artificial delay.",
        ready: isIdle,
        command: () => ({ _tag: "Add", title: "Typed failure" }),
      },
      {
        label: "Attempt CLEAR_COMPLETED",
        note: "A different invoked state receives the same typed dependency failure.",
        ready: (state) => isIdle(state) && state.error !== null,
        command: () => ({ _tag: "ClearCompleted" }),
      },
    ],
  },
  {
    title: "Scope + cancellation",
    adapter: "memory",
    description: "Cancel an operation owned by the machine’s Effect Scope.",
    watch:
      "Cancel changes state, FiberMap interrupts the active Todos.add fiber, and the in-memory adapter never commits its Ref update.",
    steps: [
      {
        label: "Start a slow ADD",
        note: "The artificial latency leaves Adding visible for 1.4 seconds.",
        ready: isIdle,
        command: () => ({ _tag: "Add", title: "Should be cancelled" }),
      },
      {
        label: "Attempt another ADD",
        note: "The event queue returns a typed InvalidTransition while Adding is active.",
        ready: isOperating,
        command: () => ({ _tag: "Add", title: "Collision" }),
      },
      {
        label: "Cancel the active fiber",
        note: "Cancel is declared on Adding, so it is accepted and returns to Idle.",
        ready: isOperating,
        command: () => ({ _tag: "Cancel" }),
      },
    ],
  },
]

type JournalEntry = Readonly<{
  number: number
  state: string
  event: string
  outcome: string
}>

let activeScenario = 0
let nextGuideStep = 0
let sequence = 0
let adapter: TodoAdapter = "memory"
let appGeneration = 0
let app: BrowserApp = createBrowserApp(adapter)
let currentState: TodoState = { _tag: "Loading" }
let externalNotice: Readonly<{ event: string; outcome: string }> | null = null
const history: Array<JournalEntry> = []

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

const describeState = (state: TodoState): string => {
  switch (state._tag) {
    case "Loading":
      return "Invoking Todos.list through the provided Layer."
    case "Idle":
      return state.outcome
    case "Adding":
      return `Invoking Todos.add(“${state.title}”).`
    case "Toggling":
      return `Invoking Todos.toggle(${state.id}).`
    case "Deleting":
      return `Invoking Todos.remove(${state.id}).`
    case "Clearing":
      return "Invoking Todos.clearCompleted."
    case "Crashed":
      return state.cause
  }
}

const invokedCapability = (state: TodoState): string => {
  switch (state._tag) {
    case "Loading":
      return "Todos.list"
    case "Adding":
      return "Todos.add"
    case "Toggling":
      return "Todos.toggle"
    case "Deleting":
      return "Todos.remove"
    case "Clearing":
      return "Todos.clearCompleted"
    case "Idle":
    case "Crashed":
      return "None"
  }
}

const appendJournal = (state: string, event: string, outcome: string) => {
  const latest = history.at(-1)
  if (
    latest !== undefined &&
    latest.state === state &&
    latest.event === event &&
    latest.outcome === outcome
  ) {
    return
  }
  sequence += 1
  history.push({ number: sequence, state, event, outcome })
}

const render = () => {
  const root = document.querySelector<HTMLElement>("#app")
  if (root === null) return

  const scenario = scenarios[activeScenario]
  const currentStep = scenario.steps[nextGuideStep]
  const todos = todosOf(currentState)
  const completed = todos.filter((todo) => todo.completed).length
  const error = currentState._tag === "Idle" ? currentState.error : null
  const displayedEvent = externalNotice?.event ?? "machine"
  const displayedOutcome = externalNotice?.outcome ?? describeState(currentState)

  root.innerHTML = `
    <header class="hero">
      <div class="eyebrow">THROWAWAY EFFECT-NATIVE MACHINE</div>
      <h1>Can dependencies be part of the machine’s type?</h1>
      <p class="question"><strong>Question.</strong> Can one pure state-machine definition infer its Effect requirements, run with swappable Layers, preserve typed errors and scoped cancellation, and generate an honest Mermaid graph?</p>
      <p class="thesis">There is no XState or Promise actor in this version. The interpreter is built from Effect queues, fibers, scopes, references, streams, and context.</p>
    </header>

    <main>
      <section aria-labelledby="current-state-title">
        <div class="section-heading">
          <div>
            <div class="eyebrow">CURRENT TAGGED STATE</div>
            <h2 id="current-state-title">${escapeHtml(currentState._tag)}</h2>
          </div>
          <span class="status ${isOperating(currentState) || currentState._tag === "Loading" ? "status-running" : currentState._tag === "Crashed" ? "status-failed" : "status-idle"}">
            ${isOperating(currentState) || currentState._tag === "Loading" ? "Effect fiber active" : currentState._tag === "Crashed" ? "Defect" : "Accepting events"}
          </span>
        </div>

        <div class="state-grid">
          <article class="metric">
            <span>Machine requirement</span>
            <strong class="metric-copy">Todos</strong>
            <small>inferred from invoked Effects</small>
          </article>
          <article class="metric">
            <span>Provided Layer</span>
            <strong class="metric-copy">Todos.${adapter === "memory" ? "Memory" : "Failing"}</strong>
            <small>selected at execution time</small>
          </article>
          <article class="metric">
            <span>Invoked capability</span>
            <strong class="metric-copy">${escapeHtml(invokedCapability(currentState))}</strong>
            <small>${todos.length} todos · ${completed} completed</small>
          </article>
          <article class="metric ${error === null ? "" : "metric-error"}">
            <span>Typed error</span>
            <strong class="metric-copy">${escapeHtml(error?._tag ?? "None")}</strong>
            <small>${escapeHtml(error?.message ?? displayedOutcome)}</small>
          </article>
        </div>

        <div class="dependency-flow" aria-label="Dependency provision flow">
          <div><b>todoDefinition</b><span>requires Todos</span></div>
          <span>+</span>
          <div class="selected"><b>Todos.${adapter === "memory" ? "Memory" : "Failing"}</b><span>Layer adapter</span></div>
          <span>→</span>
          <div><b>Machine.run</b><span>scoped handle</span></div>
        </div>

        <details class="raw-state" open>
          <summary>Generated Mermaid — derived without running the machine</summary>
          <pre>${escapeHtml(mermaid)}</pre>
        </details>

        <details class="raw-state">
          <summary>Inspect the complete tagged state</summary>
          <pre>${escapeHtml(JSON.stringify(currentState, null, 2))}</pre>
        </details>
      </section>

      <section aria-labelledby="todo-title">
        <div class="section-heading compact">
          <div>
            <div class="eyebrow">FREE PLAY</div>
            <h2 id="todo-title">Drive the Effect machine</h2>
          </div>
          <div class="button-row">
            <button class="secondary ${adapter === "memory" ? "selected-control" : ""}" data-command="UseMemory">Use Memory Layer</button>
            <button class="secondary ${adapter === "failing" ? "selected-control" : ""}" data-command="UseFailing">Use Failing Layer</button>
            <button class="secondary" data-command="ClearCompleted">Clear completed</button>
            <button class="secondary" data-command="Cancel">Cancel</button>
            <button class="ghost" data-command="ResetDemo">Reset runtime</button>
          </div>
        </div>

        <form id="add-form" class="add-form">
          <label for="todo-title-input">New todo</label>
          <div>
            <input id="todo-title-input" name="title" placeholder="Describe one small thing" autocomplete="off" />
            <button type="submit">Send Add event</button>
          </div>
        </form>

        <div class="todo-list">
          ${todos.length === 0 ? `<p class="empty">No todos in the current machine snapshot.</p>` : ""}
          ${todos
            .map(
              (todo) => `
                <article class="todo ${todo.completed ? "completed" : ""}">
                  <button class="check" data-action="toggle" data-id="${escapeHtml(todo.id)}" aria-label="Toggle ${escapeHtml(todo.title)}">${todo.completed ? "✓" : ""}</button>
                  <div><strong>${escapeHtml(todo.title)}</strong><small>${escapeHtml(todo.id)}</small></div>
                  <button class="delete" data-action="delete" data-id="${escapeHtml(todo.id)}">Delete</button>
                </article>
              `,
            )
            .join("")}
        </div>
        <p class="hint"><strong>${escapeHtml(displayedEvent)}:</strong> ${escapeHtml(displayedOutcome)}</p>
      </section>

      <section aria-labelledby="walkthrough-title">
        <div class="eyebrow">GUIDED WALKTHROUGHS</div>
        <h2 id="walkthrough-title">Test the module’s interface</h2>
        <div class="tabs" role="tablist">
          ${scenarios
            .map(
              (item, index) =>
                `<button role="tab" data-scenario="${index}" class="tab ${index === activeScenario ? "selected" : ""}" aria-selected="${index === activeScenario}">${escapeHtml(item.title)}</button>`,
            )
            .join("")}
        </div>
        <article class="scenario">
          <div class="scenario-copy">
            <h3>${escapeHtml(scenario.title)}</h3>
            <p>${escapeHtml(scenario.description)}</p>
            <p class="watch"><strong>Watch for:</strong> ${escapeHtml(scenario.watch)}</p>
          </div>
          <ol class="steps">
            ${scenario.steps
              .map((step, index) => {
                const done = index < nextGuideStep
                const current = index === nextGuideStep
                const ready = current && step.ready(currentState)
                return `
                  <li class="step ${done ? "done" : ""} ${current ? "current" : ""}">
                    <span class="step-number">${done ? "✓" : index + 1}</span>
                    <div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.note)}</small></div>
                    ${current ? `<button data-guide-step="${index}" ${ready ? "" : "disabled"}>${ready ? "Do this" : "Wait for state"}</button>` : ""}
                  </li>
                `
              })
              .join("")}
          </ol>
          ${currentStep === undefined ? `<div class="complete-callout">Walkthrough complete. The machine definition stayed fixed throughout.</div>` : ""}
        </article>
      </section>

      <section aria-labelledby="history-title">
        <div class="eyebrow">STATE STREAM</div>
        <h2 id="history-title">SubscriptionRef changes</h2>
        <div class="history">
          ${history
            .slice(-12)
            .reverse()
            .map(
              (entry) =>
                `<div><span>#${entry.number}</span><b>${escapeHtml(entry.state)}</b><code>${escapeHtml(entry.event)}</code><p>${escapeHtml(entry.outcome)}</p></div>`,
            )
            .join("")}
        </div>
      </section>
    </main>

    <footer>
      <p><strong>Module under test:</strong> pure definition + inferred Effect requirements + Layer-provided execution + scoped interpreter.</p>
      <p>effect 4.0.0-beta.106 · no XState · in-memory · throwaway</p>
    </footer>
  `
}

const observeApp = (observedApp: BrowserApp, generation: number) => {
  observedApp.subscribe((state) => {
    if (generation !== appGeneration) return
    currentState = state
    appendJournal(state._tag, externalNotice?.event ?? "internal", describeState(state))
    render()
  })
}

const replaceApp = async (nextAdapter: TodoAdapter) => {
  appGeneration += 1
  const generation = appGeneration
  await app.dispose()
  adapter = nextAdapter
  app = createBrowserApp(adapter)
  currentState = { _tag: "Loading" }
  externalNotice = {
    event: "Layer provided",
    outcome: `Running the unchanged machine with Todos.${adapter === "memory" ? "Memory" : "Failing"}.`,
  }
  appendJournal(currentState._tag, externalNotice.event, externalNotice.outcome)
  render()
  observeApp(app, generation)
}

const dispatch = async (command: PrototypeCommand) => {
  if (command._tag === "UseMemory") {
    await replaceApp("memory")
    return
  }
  if (command._tag === "UseFailing") {
    await replaceApp("failing")
    return
  }
  if (command._tag === "ResetDemo") {
    await replaceApp(adapter)
    return
  }

  externalNotice = {
    event: command._tag,
    outcome: `Queued ${command._tag} for the Effect-native interpreter.`,
  }
  const result = await app.send(command)
  if (Result.isFailure(result)) {
    externalNotice = {
      event: command._tag,
      outcome: result.failure.message,
    }
    appendJournal(currentState._tag, command._tag, result.failure.message)
    render()
  }
}

document.addEventListener("submit", (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== "add-form") return
  event.preventDefault()
  const data = new FormData(event.target)
  void dispatch({ _tag: "Add", title: String(data.get("title") ?? "") })
  event.target.reset()
})

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest<HTMLButtonElement>("button")
  if (button === null) return

  const scenarioIndex = button.dataset.scenario
  if (scenarioIndex !== undefined) {
    activeScenario = Number(scenarioIndex)
    nextGuideStep = 0
    void replaceApp(scenarios[activeScenario].adapter)
    return
  }

  const guideIndex = button.dataset.guideStep
  if (guideIndex !== undefined) {
    const step = scenarios[activeScenario].steps[Number(guideIndex)]
    if (step?.ready(currentState)) {
      nextGuideStep += 1
      void dispatch(step.command(currentState))
    }
    return
  }

  const action = button.dataset.action
  const id = button.dataset.id
  if (action === "toggle" && id !== undefined) void dispatch({ _tag: "Toggle", id })
  if (action === "delete" && id !== undefined) void dispatch({ _tag: "Delete", id })

  switch (button.dataset.command) {
    case "UseMemory":
      void dispatch({ _tag: "UseMemory" })
      break
    case "UseFailing":
      void dispatch({ _tag: "UseFailing" })
      break
    case "ClearCompleted":
      void dispatch({ _tag: "ClearCompleted" })
      break
    case "Cancel":
      void dispatch({ _tag: "Cancel" })
      break
    case "ResetDemo":
      void dispatch({ _tag: "ResetDemo" })
      break
  }
})

render()
observeApp(app, appGeneration)
window.addEventListener("beforeunload", () => void app.dispose())
