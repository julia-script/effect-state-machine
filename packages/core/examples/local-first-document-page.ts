import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import * as Mermaid from "../src/Mermaid.js"
import {
  type Document,
  Documents,
  LocalFirstDocument,
  OpenFailed,
  SaveFailed,
  SyncConflict,
  Synchronizer,
  SyncOffline,
} from "./LocalFirstDocument.js"

type State = Machine.MachineState<typeof LocalFirstDocument.definition>
type Event = Machine.MachineEvent<typeof LocalFirstDocument.definition>
type Completion = Extract<State, { readonly _tag: "OpeningFailed" | "SavingFailed" | "Closed" }>
type Handle = Machine.MachineHandle<State, Event, Completion>

type ProfileKey = "healthy" | "offline" | "conflict" | "open-failure" | "save-failure" | "defect"

interface Profile {
  readonly key: ProfileKey
  readonly label: string
  readonly description: string
  readonly watch: string
}

const profiles: ReadonlyArray<Profile> = [
  {
    key: "healthy",
    label: "Healthy services",
    description: "Local saves and remote synchronization both succeed immediately.",
    watch: "Opening → Editing → Saving → Syncing → Editing",
  },
  {
    key: "offline",
    label: "Offline, then back",
    description: "Synchronization fails twice. Advance the TestClock to drive the retry Schedule.",
    watch: "Two named retry decisions, one minute apart, without real waiting.",
  },
  {
    key: "conflict",
    label: "Remote conflict",
    description: "The first sync returns a typed conflict and opens the scoped child machine.",
    watch: "Parent forwarding, child completion, then a second save and sync.",
  },
  {
    key: "open-failure",
    label: "Typed open failure",
    description: "Documents.open fails through its typed error channel.",
    watch: "OpeningFailed is an explicit final state, not an interpreter defect.",
  },
  {
    key: "save-failure",
    label: "Typed save failure",
    description: "Documents.save fails after the document has opened normally.",
    watch: "SavingFailed is modeled application behavior.",
  },
  {
    key: "defect",
    label: "Unexpected defect",
    description: "The synchronizer dies instead of returning a typed failure.",
    watch: "The machine terminates; the consumer observes the Cause and may reset it.",
  },
]

const profileByKey = (key: ProfileKey): Profile =>
  profiles.find((profile) => profile.key === key) ?? profiles[0]

const initialDocument: Document = {
  id: "field-notes",
  text: "The graph should help me read the code I am already writing.",
  revision: 1,
}

const makeDocumentsLayer = (profile: ProfileKey) =>
  Layer.effect(
    Documents,
    Effect.gen(function* () {
      const stored = yield* Ref.make(initialDocument)
      return Documents.of({
        open: (id) =>
          profile === "open-failure"
            ? Effect.fail(new OpenFailed({ message: `No local snapshot exists for ${id}.` }))
            : Ref.get(stored).pipe(Effect.map((document) => ({ ...document, id }))),
        save: (request) =>
          profile === "save-failure"
            ? Effect.fail(
                new SaveFailed({
                  message: "The local store refused this revision. Reset with another Layer.",
                }),
              )
            : Ref.updateAndGet(stored, () => ({
                ...request,
                revision: request.revision + 1,
              })).pipe(Effect.map(({ revision }) => revision)),
      })
    }),
  )

const makeSynchronizerLayer = (profile: ProfileKey) =>
  Layer.effect(
    Synchronizer,
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      return Synchronizer.of({
        sync: ({ revision }) =>
          Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
            Effect.flatMap((attempt): Effect.Effect<number, SyncOffline | SyncConflict> => {
              if (profile === "offline" && attempt < 3) {
                return Effect.fail(
                  new SyncOffline({ message: `Remote unavailable on attempt ${attempt}.` }),
                )
              }
              if (profile === "conflict" && attempt === 1) {
                return Effect.fail(
                  new SyncConflict({
                    remoteText: "The graph should help me question the code an agent wrote.",
                  }),
                )
              }
              if (profile === "defect") {
                return Effect.die(new Error("Remote protocol returned an impossible response."))
              }
              return Effect.succeed(revision + 1)
            }),
          ),
      })
    }),
  )

class DocumentSession extends Context.Service<DocumentSession, Handle>()(
  "examples/DocumentSession",
) {
  static readonly layer = Layer.effect(this)(
    Machine.run(LocalFirstDocument.definition, { documentId: "field-notes" }),
  )
}

const makeBrowserApp = (profile: ProfileKey) => {
  const dependencies = Layer.mergeAll(
    makeDocumentsLayer(profile),
    makeSynchronizerLayer(profile),
    TestClock.layer(),
  )
  const runtime = ManagedRuntime.make(DocumentSession.layer.pipe(Layer.provideMerge(dependencies)))

  return {
    snapshot: () => runtime.runPromise(Effect.flatMap(DocumentSession, ({ snapshot }) => snapshot)),
    can: (event: Event) =>
      runtime.runPromise(Effect.flatMap(DocumentSession, ({ can }) => can(event))),
    send: (event: Event) =>
      runtime.runPromise(Effect.flatMap(DocumentSession, ({ send }) => Effect.exit(send(event)))),
    advanceMinute: () => runtime.runPromise(TestClock.adjust("1 minute")),
    subscribeState: (onState: (state: State) => void) => {
      runtime.runFork(
        Effect.flatMap(DocumentSession, ({ changes }) =>
          Stream.runForEach(changes, (state) => Effect.sync(() => onState(state))),
        ),
      )
    },
    subscribeInspection: (onEvent: (event: Machine.InspectionEvent) => void) => {
      runtime.runFork(
        Effect.flatMap(DocumentSession, ({ inspection }) =>
          Stream.runForEach(inspection, (event) => Effect.sync(() => onEvent(event))),
        ),
      )
    },
    completion: () =>
      runtime.runPromise(
        Effect.flatMap(DocumentSession, ({ completion }) => Effect.exit(completion)),
      ),
    dispose: () => runtime.dispose(),
  }
}

type BrowserApp = ReturnType<typeof makeBrowserApp>

interface TraceEntry {
  readonly number: number
  readonly event: Machine.InspectionEvent
}

const graph = Graph.fromDefinition(LocalFirstDocument.definition)
const mermaid = Mermaid.render(graph)

let selectedProfile: ProfileKey = "healthy"
let app: BrowserApp | undefined
let appGeneration = 0
let currentState: State | undefined
let allowedEvents = new Set<Event["_tag"]>()
let trace: ReadonlyArray<TraceEntry> = []
let traceSequence = 0
let graphMode: "focus" | "full" = "focus"
let draftText = initialDocument.text
let mergeText = initialDocument.text
let busy = true
let lastNotice = "Building the scoped machine from the selected Layers."
let noticeTone: "info" | "error" = "info"
let machineDefect: string | undefined

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")

const isTextState = (state: State): state is Extract<State, { readonly text: string }> =>
  "text" in state

const stateTone = (state: State | undefined): "idle" | "working" | "final" | "defect" => {
  if (machineDefect !== undefined) return "defect"
  if (state === undefined) return "working"
  if (state._tag === "Opening" || state._tag === "Saving" || state._tag === "Syncing") {
    return "working"
  }
  if (state._tag === "Closed" || state._tag === "OpeningFailed" || state._tag === "SavingFailed") {
    return "final"
  }
  return "idle"
}

const eventSamples = (): ReadonlyArray<Event> => [
  { _tag: "Edit", text: draftText },
  { _tag: "Save" },
  { _tag: "GoOffline" },
  { _tag: "GoOnline" },
  { _tag: "Cancel" },
  { _tag: "ResolveConflict", text: mergeText },
  { _tag: "AbortConflict" },
  { _tag: "Close" },
]

const refreshAllowedEvents = async (generation: number) => {
  const observedApp = app
  if (observedApp === undefined || generation !== appGeneration) return
  const samples = eventSamples()
  const accepted = await Promise.all(
    samples.map(async (event) => ({ event, accepted: await observedApp.can(event) })),
  )
  if (generation !== appGeneration) return
  allowedEvents = new Set(accepted.flatMap(({ event, accepted }) => (accepted ? [event._tag] : [])))
  render()
}

const inspectionSummary = (event: Machine.InspectionEvent): string => {
  switch (event._tag) {
    case "MachineStarted":
      return `initial ${event.initialStateTag}`
    case "EventReceived":
      return `${event.eventTag} received in ${event.stateTag}`
    case "TransitionSelected":
      return `${event.sourceStateTag} → ${event.targetStateTag} via ${event.eventTag}${
        event.branch === undefined
          ? ""
          : ` · ${event.branch.kind === "guard" ? event.branch.name : "otherwise"}`
      }`
    case "StateChanged":
      return `${event.previousStateTag} → ${event.nextStateTag}`
    case "InvocationRetryScheduled":
      return `${event.policy} · attempt ${event.attempt} · ${event.delayMillis / 1_000}s`
    case "TimerStarted":
    case "TimerFired":
    case "TimerCancelled":
      return `${event.timer} · ${event.stateTag} · generation ${event.generation}`
    case "StaleOutcomeIgnored":
      return `${event.outcome} ignored for stale ${event.ownerPath}`
    case "InvocationStarted":
    case "InvocationSucceeded":
    case "InvocationFailed":
    case "InvocationCancelled":
    case "InvocationDefected":
      return `${event.invocation} · ${event.stateTag} · generation ${event.generation}`
    case "ChildStarted":
      return `${event.invocation} started ${event.instanceId}`
    case "ChildEventForwarded":
      return `${event.parentEventTag} → ${event.childEventTag} · ${event.instanceId}`
    case "ChildCompleted":
    case "ChildCancelled":
    case "ChildDefected":
      return `${event.invocation} · ${event.instanceId}`
    case "MachineCompleted":
      return `final ${event.finalStateTag}`
    case "MachineDefected":
      return `${event.defect} while handling ${event.eventTag} in ${event.stateTag}`
    case "EventIgnored":
      return `${event.eventTag} ignored in ${event.stateTag}`
  }
}

const updateTextFromState = (state: State) => {
  if (isTextState(state)) draftText = state.text
  if (state._tag === "ResolvingConflict") mergeText = state.localText
}

const replaceApp = async (profile: ProfileKey) => {
  const generation = appGeneration + 1
  appGeneration = generation
  busy = true
  machineDefect = undefined
  currentState = undefined
  allowedEvents = new Set()
  trace = []
  traceSequence = 0
  selectedProfile = profile
  lastNotice = `Providing the ${profileByKey(profile).label} Layers.`
  noticeTone = "info"
  render()

  const previous = app
  app = undefined
  if (previous !== undefined) await previous.dispose()
  if (generation !== appGeneration) return

  const next = makeBrowserApp(profile)
  app = next
  next.subscribeState((state) => {
    if (generation !== appGeneration) return
    currentState = state
    updateTextFromState(state)
    busy = false
    render()
    void refreshAllowedEvents(generation)
  })
  next.subscribeInspection((event) => {
    if (generation !== appGeneration) return
    traceSequence += 1
    trace = [...trace, { number: traceSequence, event }].slice(-80)
    render()
  })

  try {
    currentState = await next.snapshot()
    updateTextFromState(currentState)
    busy = false
    render()
    await refreshAllowedEvents(generation)
  } catch (error) {
    if (generation !== appGeneration) return
    machineDefect = String(error)
    busy = false
    noticeTone = "error"
    lastNotice = "The runtime could not start. Reset the machine to try again."
    render()
  }

  void next
    .completion()
    .then((exit) => {
      if (generation !== appGeneration || Exit.isSuccess(exit)) return
      machineDefect = Cause.pretty(exit.cause)
      noticeTone = "error"
      lastNotice =
        "The machine terminated with an unexpected Cause. The definition did not model it."
      busy = false
      render()
    })
    .catch((error: unknown) => {
      if (generation !== appGeneration) return
      machineDefect = String(error)
      noticeTone = "error"
      lastNotice = "The consumer runtime stopped before the machine completed."
      busy = false
      render()
    })
}

const send = async (event: Event) => {
  const observedApp = app
  if (observedApp === undefined || busy) return false
  busy = true
  lastNotice = `Sending ${event._tag} through the serialized queue.`
  noticeTone = "info"
  render()
  const exit = await observedApp.send(event)
  busy = false
  if (Exit.isFailure(exit)) {
    machineDefect = Cause.pretty(exit.cause)
    lastNotice = `${event._tag} caused the machine to terminate.`
    noticeTone = "error"
    render()
    return false
  }
  lastNotice = `${event._tag} was accepted by ${currentState?._tag ?? "the machine"}.`
  render()
  await refreshAllowedEvents(appGeneration)
  return true
}

const applyDraft = () => send({ _tag: "Edit", text: draftText })

const saveDraft = async () => {
  if (currentState !== undefined && isTextState(currentState) && currentState.text !== draftText) {
    const edited = await applyDraft()
    if (!edited) return
  }
  await send({ _tag: "Save" })
}

const advanceClock = async () => {
  const observedApp = app
  if (observedApp === undefined || busy) return
  busy = true
  lastNotice = "Advancing Effect’s TestClock by one minute."
  noticeTone = "info"
  render()
  try {
    await observedApp.advanceMinute()
    lastNotice = "One virtual minute passed; scheduled fibers may continue."
  } catch (error) {
    noticeTone = "error"
    lastNotice = `The virtual clock could not advance: ${String(error)}`
  } finally {
    busy = false
    render()
  }
}

const renderEventButton = (
  eventTag: Event["_tag"],
  label: string,
  className = "button--quiet",
): string => {
  const disabled = busy || machineDefect !== undefined || !allowedEvents.has(eventTag)
  return `<button class="${className}" data-event="${eventTag}" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`
}

const renderEditor = (): string => {
  const state = currentState
  const canEdit = allowedEvents.has("Edit") && machineDefect === undefined
  return `
    <section class="panel editor-panel" id="document" aria-labelledby="document-title">
      <div class="panel__head">
        <div class="panel__head-copy">
          <h2 id="document-title">Document</h2>
          <p>The editor sends ordinary schema-described events. Promise conversion lives only in this page.</p>
        </div>
        <span class="state-tag" data-tone="${stateTone(state)}">${escapeHtml(state?._tag ?? "Booting")}</span>
      </div>
      <div class="panel__body editor">
        <div class="editor__meta">
          <span>${escapeHtml(state !== undefined && "documentId" in state ? state.documentId : "field-notes")}</span>
          <span>revision ${escapeHtml(state !== undefined && "revision" in state ? state.revision : "—")}</span>
        </div>
        <label class="field-label" for="document-text">Local text</label>
        <textarea id="document-text" ${canEdit ? "" : "disabled"} aria-describedby="document-help">${escapeHtml(draftText)}</textarea>
        <p class="field-help" id="document-help">${
          canEdit
            ? "Apply the edit explicitly, or save and let the page send Edit first."
            : "This state does not accept Edit. The graph and controls agree."
        }</p>
        <div class="action-row">
          ${renderEventButton("Edit", "Apply edit")}
          ${renderEventButton("Save", "Save + sync", "button--pear")}
          ${renderEventButton("GoOffline", "Go offline")}
          ${renderEventButton("GoOnline", "Go online")}
          ${renderEventButton("Cancel", "Cancel")}
          ${renderEventButton("Close", "Close")}
          ${
            selectedProfile === "offline" && state?._tag === "Syncing"
              ? `<button class="button--success" data-command="advance-clock" ${busy ? "disabled" : ""}>Advance 1 minute</button>`
              : ""
          }
        </div>
        <p class="notice" data-tone="${noticeTone}">${escapeHtml(lastNotice)}</p>
      </div>
      ${renderConflictWorkspace()}
    </section>
  `
}

const renderConflictWorkspace = (): string => {
  const state = currentState
  if (state?._tag !== "ResolvingConflict") return ""
  return `
    <div class="conflict-workspace">
      <div>
        <h3>Scoped conflict child</h3>
        <p>The parent forwards one decision; leaving this state interrupts the child Scope.</p>
      </div>
      <div class="conflict-versions">
        <div class="conflict-version">
          <span class="field-label">Local version</span>
          <pre>${escapeHtml(state.localText)}</pre>
        </div>
        <div class="conflict-version">
          <span class="field-label">Remote version</span>
          <pre>${escapeHtml(state.remoteText)}</pre>
        </div>
      </div>
      <label class="field-label" for="merge-text">Merged version</label>
      <textarea id="merge-text">${escapeHtml(mergeText)}</textarea>
      <div class="action-row">
        ${renderEventButton("ResolveConflict", "Use merged text", "button--pear")}
        ${renderEventButton("AbortConflict", "Keep local text")}
      </div>
    </div>
  `
}

const renderStateFacts = (): string => {
  const state = currentState
  if (state === undefined) return `<p>Waiting for the initial snapshot.</p>`
  const facts = Object.entries(state).filter(([key]) => key !== "_tag")
  return `
    <dl class="state-facts">
      ${facts
        .map(
          ([key, value]) => `
            <div>
              <dt>${escapeHtml(key)}</dt>
              <dd>${escapeHtml(typeof value === "string" ? value : JSON.stringify(value))}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `
}

const focusedNodeIds = (): ReadonlySet<string> => {
  if (graphMode === "full" || currentState === undefined) {
    return new Set(graph.nodes.map(({ id }) => id))
  }
  const active = currentState._tag
  return new Set([
    active,
    ...graph.edges.flatMap((edge) => (edge.source === active ? [edge.target] : [])),
  ])
}

const edgeLabel = (edge: Graph.Edge): string => {
  const trigger = edge.event?.tag ?? edge.outcome?.kind ?? "transition"
  if (edge.branch?.kind === "guard") return `${trigger} · ${edge.branch.name}`
  if (edge.branch?.kind === "otherwise") return `${trigger} · otherwise`
  return trigger
}

const renderGraph = (): string => {
  const visibleIds = focusedNodeIds()
  const nodes = graph.nodes.filter(({ id }) => visibleIds.has(id))
  const edges = graph.edges.filter(({ source, target }) =>
    graphMode === "focus"
      ? source === currentState?._tag
      : visibleIds.has(source) && visibleIds.has(target),
  )
  return `
    <section class="panel graph-panel" id="graph" aria-labelledby="graph-title">
      <div class="panel__head">
        <div class="panel__head-copy">
          <h2 id="graph-title">Read-only graph</h2>
          <p>Focus view keeps the active neighborhood readable. Full view proves the same graph can expand without changing the definition.</p>
        </div>
        <div class="graph-toolbar" aria-label="Graph view">
          <button class="button--quiet" data-graph-mode="focus" aria-pressed="${graphMode === "focus"}">Focus</button>
          <button class="button--quiet" data-graph-mode="full" aria-pressed="${graphMode === "full"}">Full map</button>
        </div>
      </div>
      <div class="panel__body machine-map">
        <div class="machine-map__nodes">
          ${nodes
            .map(
              (node) => `
                <article class="machine-node" ${node.id === currentState?._tag ? 'aria-current="step"' : ""}>
                  <span class="machine-node__kind">${escapeHtml(node.kind)}</span>
                  <h3>${escapeHtml(node.title)}</h3>
                  ${node.description === undefined ? "" : `<p>${escapeHtml(node.description)}</p>`}
                  ${
                    node.invocation === undefined
                      ? ""
                      : `<span class="machine-node__owned">Effect · ${escapeHtml(node.invocation.name)}${
                          node.invocation.retry === undefined
                            ? ""
                            : ` · retry ${escapeHtml(node.invocation.retry.name)}`
                        }</span>`
                  }
                  ${
                    node.child === undefined
                      ? ""
                      : `<span class="machine-node__owned">Child · ${escapeHtml(node.child.name)} → ${escapeHtml(node.child.definition.id)}</span>`
                  }
                </article>
              `,
            )
            .join("")}
        </div>
        <div class="machine-map__edges" aria-label="Visible transitions">
          ${edges
            .map(
              (edge) => `
                <div class="machine-edge ${edge.source === currentState?._tag ? "is-active" : ""}">
                  <span>${escapeHtml(edge.source)}</span>
                  <span class="machine-edge__verb">${escapeHtml(edgeLabel(edge))} →</span>
                  <span>${escapeHtml(edge.target)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
  `
}

const renderTrace = (): string => `
  <section class="panel inspection-panel" id="trace" aria-labelledby="trace-title">
    <div class="panel__head">
      <div class="panel__head-copy">
        <h2 id="trace-title">Semantic inspection</h2>
        <p>Metadata only: tags, decisions, invocation names, retries, child identities, and lifecycle.</p>
      </div>
      <span class="mono">${trace.length} events</span>
    </div>
    <div class="panel__body inspection-layout">
      <div class="trace" aria-live="polite">
        ${
          trace.length === 0
            ? `<p>No inspection events yet.</p>`
            : trace
                .slice()
                .reverse()
                .map(
                  ({ number, event }) => `
                    <div class="trace__entry">
                      <span class="trace__index">${String(number).padStart(2, "0")}</span>
                      <div class="trace__copy">
                        <b>${escapeHtml(event._tag)}</b>
                        <span>${escapeHtml(inspectionSummary(event))}</span>
                      </div>
                    </div>
                  `,
                )
                .join("")
        }
      </div>
      <div>
        <details class="raw-inspector" open>
          <summary>Complete tagged state</summary>
          <pre>${escapeHtml(JSON.stringify(currentState ?? { _tag: "Booting" }, null, 2))}</pre>
        </details>
        <details class="raw-inspector">
          <summary>Generated Mermaid</summary>
          <pre>${escapeHtml(mermaid)}</pre>
        </details>
        <details class="raw-inspector">
          <summary>Graph model</summary>
          <pre>${escapeHtml(JSON.stringify(graph, null, 2))}</pre>
        </details>
        ${
          machineDefect === undefined
            ? ""
            : `<p class="notice" data-tone="error"><strong>Cause</strong><br />${escapeHtml(machineDefect)}</p>`
        }
      </div>
    </div>
  </section>
`

const render = () => {
  const root = document.querySelector<HTMLElement>("#app")
  if (root === null) return
  const profile = profileByKey(selectedProfile)
  root.innerHTML = `
    <header class="nav-slab">
      <a class="nav-slab__mark" href="#top">effect / machine</a>
      <nav class="nav-slab__links" aria-label="Workbench">
        <a href="#document">Document</a>
        <a href="#graph">Graph</a>
        <a href="#trace">Trace</a>
      </nav>
      <button class="button--quiet" data-command="reset" data-state="${busy ? "loading" : "idle"}">Reset</button>
    </header>
    <main id="top">
      <div class="shell">
        <header class="workbench-head">
          <div class="workbench-head__copy">
            <h1>Run the graph. Poke the edges.</h1>
            <p class="lede">One schema-first definition, real Effect services, a scoped interpreter, and a graph that stays useful by showing only what surrounds the current state.</p>
          </div>
          <div class="runtime-picker">
            <label for="profile">Layer profile</label>
            <select id="profile">
              ${profiles
                .map(
                  ({ key, label }) =>
                    `<option value="${key}" ${key === selectedProfile ? "selected" : ""}>${escapeHtml(label)}</option>`,
                )
                .join("")}
            </select>
            <p>${escapeHtml(profile.description)}</p>
          </div>
        </header>
        <div class="dependency-strip" aria-label="Runtime composition">
          <div class="dependency-strip__part">
            <b>definition</b>
            <span>requires Documents + Synchronizer</span>
          </div>
          <span class="dependency-strip__arrow">+</span>
          <div class="dependency-strip__part">
            <b>${escapeHtml(profile.label)}</b>
            <span>Layers chosen at execution time</span>
          </div>
          <span class="dependency-strip__arrow">→</span>
          <div class="dependency-strip__part">
            <b>Machine.run</b>
            <span>${escapeHtml(profile.watch)}</span>
          </div>
        </div>
        <div class="workspace">
          ${renderEditor()}
          <aside class="panel state-panel" aria-labelledby="state-title">
            <div class="panel__head">
              <div class="panel__head-copy">
                <h2 id="state-title">State data</h2>
                <p>Only fields valid for this tag exist.</p>
              </div>
            </div>
            <div class="panel__body">${renderStateFacts()}</div>
          </aside>
          ${renderGraph()}
          ${renderTrace()}
        </div>
      </div>
    </main>
    <footer class="foot-marquee" aria-label="Runtime contract">
      <div class="foot-marquee__track" aria-hidden="true">
        <span>EFFECTS IN · EFFECTS OUT · LAYERS AT THE EDGE · GRAPH FROM CODE ·</span>
        <span>EFFECTS IN · EFFECTS OUT · LAYERS AT THE EDGE · GRAPH FROM CODE ·</span>
      </div>
      <p class="visually-hidden">Effects in, Effects out, Layers at the edge, graph from code.</p>
    </footer>
  `
}

document.addEventListener("input", (domEvent) => {
  if (!(domEvent.target instanceof HTMLTextAreaElement)) return
  if (domEvent.target.id === "document-text") draftText = domEvent.target.value
  if (domEvent.target.id === "merge-text") mergeText = domEvent.target.value
})

document.addEventListener("change", (domEvent) => {
  if (!(domEvent.target instanceof HTMLSelectElement) || domEvent.target.id !== "profile") return
  const key = domEvent.target.value
  if (profiles.some((profile) => profile.key === key)) void replaceApp(key as ProfileKey)
})

document.addEventListener("click", (domEvent) => {
  if (!(domEvent.target instanceof Element)) return
  const button = domEvent.target.closest<HTMLButtonElement>("button")
  if (button === null || button.disabled) return

  const mode = button.dataset.graphMode
  if (mode === "focus" || mode === "full") {
    graphMode = mode
    render()
    return
  }

  switch (button.dataset.command) {
    case "reset":
      void replaceApp(selectedProfile)
      return
    case "advance-clock":
      void advanceClock()
      return
  }

  switch (button.dataset.event) {
    case "Edit":
      void applyDraft()
      break
    case "Save":
      void saveDraft()
      break
    case "GoOffline":
      void send({ _tag: "GoOffline" })
      break
    case "GoOnline":
      void send({ _tag: "GoOnline" })
      break
    case "Cancel":
      void send({ _tag: "Cancel" })
      break
    case "ResolveConflict":
      void send({ _tag: "ResolveConflict", text: mergeText })
      break
    case "AbortConflict":
      void send({ _tag: "AbortConflict" })
      break
    case "Close":
      void send({ _tag: "Close" })
      break
  }
})

render()
void replaceApp(selectedProfile)
window.addEventListener("beforeunload", () => void app?.dispose())
