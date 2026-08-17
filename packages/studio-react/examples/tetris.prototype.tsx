/**
 * PROTOTYPE — throwaway Tetris demo page. Not part of the published package.
 * Run the vite example server (pnpm dev:example) and open /tetris.prototype.html.
 *
 * The game area is plain DOM re-rendered per state change; the embedded
 * Studio component is a separate React root watching the same machine handle.
 */
import { Effect, Exit, Scope, Stream } from "effect"
import { Machine } from "effect-state-machine"
import { createRoot } from "react-dom/client"
import { Studio } from "../src/index.js"
import { cellsOf, definition, dropped, ROTATIONS, WIDTH } from "./tetris-machine.prototype.js"
import machineSource from "./tetris-machine.prototype.ts?raw"

type State = Machine.MachineState<typeof definition>
type GameEvent = Machine.MachineEvent<typeof definition>
type Completion = Extract<State, { readonly _tag: "GameOver" }>
type Handle = Machine.MachineHandle<State, GameEvent, Completion>

// ---------------------------------------------------------------------------
// Machine lifecycle
// ---------------------------------------------------------------------------

interface Game {
  readonly handle: Handle
  readonly dispose: () => void
}

let game: Game | undefined
let generation = 0
let currentState: State | undefined
let trace: ReadonlyArray<{ readonly number: number; readonly text: string }> = []
let traceSequence = 0

const summarize = (event: Machine.InspectionEvent): string | undefined => {
  switch (event._tag) {
    case "MachineStarted":
      return `machine started · initial ${event.initialStateTag}`
    case "TransitionSelected": {
      const branch =
        event.branch === undefined
          ? ""
          : event.branch.kind === "guard"
            ? ` · guard "${event.branch.name}"`
            : " · otherwise"
      return `${event.sourceStateTag} → ${event.targetStateTag} on ${event.eventTag}${branch}`
    }
    case "InvocationStarted":
      return `invoke ${event.invocation} · ${event.stateTag}`
    case "InvocationSucceeded": {
      const branch =
        event.branch === undefined
          ? ""
          : event.branch.kind === "guard"
            ? ` · guard "${event.branch.name}"`
            : " · otherwise"
      return `done ${event.invocation}${branch}`
    }
    case "InvocationCancelled":
      return `cancel ${event.invocation} · left ${event.stateTag}`
    case "EventIgnored":
      return `${event.eventTag} ignored in ${event.stateTag}`
    case "MachineCompleted":
      return `machine completed · final ${event.finalStateTag}`
    default:
      return undefined
  }
}

const studioRoot = createRoot(document.querySelector("#studio-root") as Element)

const mountStudio = (handle: Handle) => {
  studioRoot.render(
    <Studio
      machine={{
        definition,
        handle,
        appName: "Tetris demo",
        quickEvents: [
          { id: "pause", label: "Pause", event: { _tag: "Pause" } },
          { id: "resume", label: "Resume", event: { _tag: "Resume" } },
          { id: "left", label: "Move left", event: { _tag: "MoveLeft" } },
          { id: "right", label: "Move right", event: { _tag: "MoveRight" } },
          { id: "rotate", label: "Rotate", event: { _tag: "Rotate" } },
          { id: "drop", label: "Hard drop", event: { _tag: "HardDrop" } },
        ],
      }}
      style={{ height: "100%", minHeight: 560 }}
    />,
  )
}

const send = (event: GameEvent) => {
  const handle = game?.handle
  if (handle === undefined) return
  Effect.runFork(Effect.exit(handle.send(event)))
}

const replaceGame = (seed: number) => {
  const myGeneration = generation + 1
  generation = myGeneration
  game?.dispose()
  game = undefined
  currentState = undefined
  trace = []
  traceSequence = 0
  render()

  const scope = Effect.runSync(Scope.make())
  const handle = Effect.runSync(
    Machine.run(definition, { seed }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  game = {
    handle,
    dispose: () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
  Effect.runFork(
    Stream.runForEach(handle.changes, (state) =>
      Effect.sync(() => {
        if (myGeneration !== generation) return
        currentState = state
        render()
      }),
    ),
  )
  Effect.runFork(
    Stream.runForEach(handle.inspection, (event) =>
      Effect.sync(() => {
        if (myGeneration !== generation) return
        const text = summarize(event)
        if (text === undefined) return
        traceSequence += 1
        trace = [...trace, { number: traceSequence, text }].slice(-40)
        renderTrace()
      }),
    ),
  )
  currentState = Effect.runSync(handle.snapshot)
  render()
  mountStudio(handle)
}

// ---------------------------------------------------------------------------
// Rendering (plain DOM, landing design language)
// ---------------------------------------------------------------------------

const PIECE_CLASSES = ["", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]

const displayCells = (
  state: State,
): ReadonlyArray<
  ReadonlyArray<{ readonly value: number; readonly kind: "cell" | "ghost" | "clearing" }>
> => {
  const grid = state.board.map((row) =>
    row.map((value) => ({ value, kind: "cell" as "cell" | "ghost" | "clearing" })),
  )
  if (state._tag === "Falling" || state._tag === "Paused") {
    const ghost = dropped(state.board, state.piece)
    for (const [row, column] of cellsOf(ghost)) {
      if (row >= 0) grid[row][column] = { value: state.piece.kind + 1, kind: "ghost" }
    }
    for (const [row, column] of cellsOf(state.piece)) {
      if (row >= 0) grid[row][column] = { value: state.piece.kind + 1, kind: "cell" }
    }
  }
  if (state._tag === "Clearing") {
    for (const row of state.cleared) {
      for (let column = 0; column < WIDTH; column += 1) {
        grid[row][column] = { value: grid[row][column].value, kind: "clearing" }
      }
    }
  }
  return grid
}

const renderBoard = (state: State): string => {
  const cells = displayCells(state)
    .flatMap((row) =>
      row.map(({ value, kind }) => {
        const color = value === 0 ? "" : ` ${PIECE_CLASSES[value]}`
        const modifier = kind === "ghost" ? " ghost" : kind === "clearing" ? " clearing" : ""
        return `<div class="cell${color}${modifier}"></div>`
      }),
    )
    .join("")
  const overlay =
    state._tag === "Paused"
      ? `<div class="board-overlay"><div class="overlay-card overlay-card--pear">Paused<span>gravity Effect cancelled</span></div></div>`
      : state._tag === "GameOver"
        ? `<div class="board-overlay"><div class="overlay-card overlay-card--coral">Game over<span>final state reached</span><button type="button" class="btn btn--surface" data-action="restart">Play again</button></div></div>`
        : ""
  return `<div class="board${state._tag === "GameOver" ? " is-over" : ""}">${cells}</div>${overlay}`
}

const renderQueue = (state: State): string => {
  if (state._tag === "GameOver") return ""
  return state.queue
    .map((kind) => {
      const occupied = new Set(ROTATIONS[kind][0].map(([row, column]) => row * 4 + column))
      const cells = Array.from({ length: 8 }, (_, index) =>
        occupied.has(index)
          ? `<div class="cell ${PIECE_CLASSES[kind + 1]}"></div>`
          : `<div class="cell"></div>`,
      ).join("")
      return `<div class="preview">${cells}</div>`
    })
    .join("")
}

const STATE_TAGS = ["Falling", "Clearing", "Paused", "GameOver"] as const

const renderStateStrip = (state: State): string =>
  STATE_TAGS.map(
    (tag) => `<span class="state-chip${state._tag === tag ? " is-active" : ""}">${tag}</span>`,
  ).join("")

const renderTrace = () => {
  const log = document.querySelector("#trace-log")
  if (log === null) return
  log.innerHTML = trace
    .map(
      ({ number, text }) =>
        `<div class="trace-line"><span class="trace-number">${String(number).padStart(3, "0")}</span>${text}</div>`,
    )
    .join("")
  log.scrollTop = log.scrollHeight
}

const controls = (state: State): string => {
  const playing = state._tag === "Falling"
  const paused = state._tag === "Paused"
  const disabled = playing ? "" : " disabled"
  return `
    <div class="pad">
      <button type="button" class="btn btn--surface" data-ev="MoveLeft"${disabled} aria-label="Move left">◀</button>
      <button type="button" class="btn btn--surface" data-ev="SoftDrop"${disabled} aria-label="Soft drop">▼</button>
      <button type="button" class="btn btn--surface" data-ev="MoveRight"${disabled} aria-label="Move right">▶</button>
      <button type="button" class="btn btn--surface" data-ev="Rotate"${disabled} aria-label="Rotate">⟳</button>
      <button type="button" class="btn btn--primary" data-ev="HardDrop"${disabled}>Drop</button>
      ${
        paused
          ? `<button type="button" class="btn btn--surface" data-ev="Resume">Resume</button>`
          : `<button type="button" class="btn btn--surface" data-ev="Pause"${disabled}>Pause</button>`
      }
      <button type="button" class="btn btn--surface" data-action="restart">Restart</button>
    </div>`
}

const render = () => {
  const root = document.querySelector("#game-root")
  if (root === null) return
  const state = currentState
  if (state === undefined) {
    root.innerHTML = `<p class="boot-message">Booting the tetris machine…</p>`
    return
  }
  root.innerHTML = `
    <section class="board-card">
      ${renderBoard(state)}
    </section>
    <aside class="side">
      <div class="jars">
        <span class="jar">score <b>${state.score}</b></span>
        <span class="jar">lines <b>${state.lines}</b></span>
        <span class="jar">level <b>${state.level}</b></span>
      </div>
      <div class="panel">
        <span class="panel-label">next</span>
        <div class="queue">${renderQueue(state)}</div>
      </div>
      <div class="panel">
        <span class="panel-label">machine state</span>
        <div class="state-strip">${renderStateStrip(state)}</div>
        <p class="panel-note">One tagged union, four nodes. Gravity is an invoked Effect owned by <code>Falling</code>; leaving the state cancels it. Studio watches the same handle.</p>
      </div>
      ${controls(state)}
    </aside>
    <section class="trace-card">
      <div class="trace-bar">
        <span class="trace-title">inspection stream</span>
        <span class="trace-sticker">live</span>
      </div>
      <div class="trace-log" id="trace-log"></div>
    </section>`
  renderTrace()
}

// ---------------------------------------------------------------------------
// Code panel
// ---------------------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const codeTarget = document.querySelector("#code-source")
if (codeTarget !== null) {
  codeTarget.innerHTML = `<pre>${escapeHtml(machineSource)}</pre>`
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_EVENTS: Readonly<Record<string, GameEvent["_tag"]>> = {
  ArrowLeft: "MoveLeft",
  ArrowRight: "MoveRight",
  ArrowUp: "Rotate",
  ArrowDown: "SoftDrop",
  Space: "HardDrop",
}

document.addEventListener("keydown", (keyboard) => {
  const target = keyboard.target
  if (
    target instanceof Element &&
    (target.closest("#studio-root") !== null || target.closest("input, textarea") !== null)
  ) {
    return
  }
  if (keyboard.repeat && keyboard.code === "Space") return
  if (keyboard.code === "KeyP") {
    keyboard.preventDefault()
    send({ _tag: currentState?._tag === "Paused" ? "Resume" : "Pause" })
    return
  }
  const tag = KEY_EVENTS[keyboard.code]
  if (tag === undefined) return
  keyboard.preventDefault()
  send({ _tag: tag })
})

document.addEventListener("click", (pointer) => {
  const target = pointer.target
  if (!(target instanceof Element)) return
  if (target.closest("#studio-root") !== null) return
  const button = target.closest("button")
  if (button === null) return
  const action = button.getAttribute("data-action")
  if (action === "restart") {
    replaceGame((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1)
    return
  }
  const tag = button.getAttribute("data-ev")
  if (tag !== null) send({ _tag: tag as GameEvent["_tag"] })
})

// Debug hook for scripting the demo from the console.
;(globalThis as { __tetris?: unknown }).__tetris = {
  send,
  state: () => currentState,
}

window.addEventListener("beforeunload", () => {
  game?.dispose()
})

replaceGame(0xc0ffee)
