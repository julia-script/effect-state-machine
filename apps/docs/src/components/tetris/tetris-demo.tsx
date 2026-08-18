"use client"

import { Studio } from "@effect-state-machine/studio-react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { Machine } from "effect-state-machine"
import * as React from "react"
import { cellsOf, definition, dropped, ROTATIONS, WIDTH } from "./tetris-machine"

type State = Machine.MachineState<typeof definition>
type GameEvent = Machine.MachineEvent<typeof definition>
type Completion = Extract<State, { readonly _tag: "GameOver" }>
type Handle = Machine.MachineHandle<State, GameEvent, Completion>

interface TraceEntry {
  readonly number: number
  readonly text: string
}

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

const KEY_EVENTS: Readonly<Record<string, GameEvent["_tag"]>> = {
  ArrowLeft: "MoveLeft",
  ArrowRight: "MoveRight",
  ArrowUp: "Rotate",
  ArrowDown: "SoftDrop",
  Space: "HardDrop",
}

const randomSeed = (): number => (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1

const useTetrisGame = (seed: number) => {
  const [handle, setHandle] = React.useState<Handle | undefined>(undefined)
  const [state, setState] = React.useState<State | undefined>(undefined)
  const [trace, setTrace] = React.useState<ReadonlyArray<TraceEntry>>([])

  React.useEffect(() => {
    const scope = Effect.runSync(Scope.make())
    const nextHandle = Effect.runSync(
      Machine.run(definition, { seed }).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    let sequence = 0
    setHandle(nextHandle)
    setTrace([])
    setState(Effect.runSync(nextHandle.snapshot))
    Effect.runFork(
      Stream.runForEach(nextHandle.changes, (next) => Effect.sync(() => setState(next))),
    )
    Effect.runFork(
      Stream.runForEach(nextHandle.inspection, (event) =>
        Effect.sync(() => {
          const text = summarize(event)
          if (text === undefined) return
          sequence += 1
          const entry = { number: sequence, text }
          setTrace((previous) => [...previous, entry].slice(-40))
        }),
      ),
    )
    return () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [seed])

  return { handle, state, trace }
}

const PIECE_CLASSES = ["", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]

type CellKind = "cell" | "ghost" | "clearing"

const displayCells = (
  state: State,
): ReadonlyArray<ReadonlyArray<{ readonly value: number; readonly kind: CellKind }>> => {
  const grid = state.board.map((row) => row.map((value) => ({ value, kind: "cell" as CellKind })))
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

function Board({ state, onRestart }: { readonly state: State; readonly onRestart: () => void }) {
  const cells = displayCells(state).flatMap((row, rowIndex) =>
    row.map(({ value, kind }, columnIndex) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed 10×20 grid, position is identity
        key={rowIndex * WIDTH + columnIndex}
        className={`tetris-cell ${value === 0 ? "" : PIECE_CLASSES[value]} ${
          kind === "ghost" ? "ghost" : kind === "clearing" ? "clearing" : ""
        }`}
      />
    )),
  )
  return (
    <>
      <div className={`tetris-board${state._tag === "GameOver" ? " is-over" : ""}`}>{cells}</div>
      {state._tag === "Paused" ? (
        <div className="tetris-overlay">
          <div className="tetris-overlay-card tetris-overlay-card--pear">
            Paused
            <span>gravity timer cancelled</span>
          </div>
        </div>
      ) : null}
      {state._tag === "GameOver" ? (
        <div className="tetris-overlay">
          <div className="tetris-overlay-card tetris-overlay-card--coral">
            Game over
            <span>final state reached</span>
            <button type="button" className="btn btn--surface" onClick={onRestart}>
              Play again
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function Queue({ state }: { readonly state: State }) {
  if (state._tag === "GameOver") return null
  return (
    <div className="tetris-queue">
      {state.queue.map((kind, queueIndex) => {
        const occupied = new Set(ROTATIONS[kind][0].map(([row, column]) => row * 4 + column))
        return (
          <div
            className="tetris-preview"
            // biome-ignore lint/suspicious/noArrayIndexKey: previews are positional
            key={queueIndex}
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed 4×2 grid
                key={index}
                className={`tetris-cell ${occupied.has(index) ? PIECE_CLASSES[kind + 1] : ""}`}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

const STATE_TAGS = ["Falling", "Clearing", "Paused", "GameOver"] as const

function TracePanel({ trace }: { readonly trace: ReadonlyArray<TraceEntry> }) {
  const logRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (trace.length === 0) return
    const log = logRef.current
    if (log !== null) log.scrollTop = log.scrollHeight
  }, [trace])
  return (
    <section className="tetris-trace">
      <div className="tetris-trace-bar">
        <span className="tetris-trace-title">inspection stream</span>
        <span className="tetris-trace-sticker">live</span>
      </div>
      <div className="tetris-trace-log" ref={logRef}>
        {trace.map(({ number, text }) => (
          <div className="tetris-trace-line" key={number}>
            <span className="tetris-trace-number">{String(number).padStart(3, "0")}</span>
            {text}
          </div>
        ))}
      </div>
    </section>
  )
}

const QUICK_EVENTS = [
  { id: "pause", label: "Pause", event: { _tag: "Pause" } },
  { id: "resume", label: "Resume", event: { _tag: "Resume" } },
  { id: "left", label: "Move left", event: { _tag: "MoveLeft" } },
  { id: "right", label: "Move right", event: { _tag: "MoveRight" } },
  { id: "rotate", label: "Rotate", event: { _tag: "Rotate" } },
  { id: "drop", label: "Hard drop", event: { _tag: "HardDrop" } },
] as const

export function TetrisDemo() {
  const [seed, setSeed] = React.useState(0xc0ffee)
  const { handle, state, trace } = useTetrisGame(seed)
  const restart = React.useCallback(() => setSeed(randomSeed()), [])

  const handleRef = React.useRef(handle)
  handleRef.current = handle
  const stateRef = React.useRef(state)
  stateRef.current = state

  const send = React.useCallback((event: GameEvent) => {
    const current = handleRef.current
    if (current === undefined) return
    Effect.runFork(Effect.exit(current.send(event)))
  }, [])

  React.useEffect(() => {
    const onKeyDown = (keyboard: KeyboardEvent) => {
      const target = keyboard.target
      if (
        target instanceof Element &&
        (target.closest("[data-effect-state-machine-studio]") !== null ||
          target.closest("input, textarea") !== null)
      ) {
        return
      }
      if (keyboard.repeat && keyboard.code === "Space") return
      if (keyboard.code === "KeyP") {
        keyboard.preventDefault()
        send({ _tag: stateRef.current?._tag === "Paused" ? "Resume" : "Pause" })
        return
      }
      const tag = KEY_EVENTS[keyboard.code]
      if (tag === undefined) return
      keyboard.preventDefault()
      send({ _tag: tag })
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [send])

  if (state === undefined) {
    return <p className="tetris-boot">Booting the tetris machine…</p>
  }

  const playing = state._tag === "Falling"
  const paused = state._tag === "Paused"

  return (
    <div className="tetris-layout">
      <section className="tetris-board-card">
        <Board state={state} onRestart={restart} />
      </section>
      <aside className="tetris-side">
        <div className="tetris-jars">
          <span className="tetris-jar">
            score <b>{state.score}</b>
          </span>
          <span className="tetris-jar">
            lines <b>{state.lines}</b>
          </span>
          <span className="tetris-jar">
            level <b>{state.level}</b>
          </span>
        </div>
        <div className="tetris-panel">
          <span className="tetris-panel-label">next</span>
          <Queue state={state} />
        </div>
        <div className="tetris-panel">
          <span className="tetris-panel-label">machine state</span>
          <div className="tetris-state-strip">
            {STATE_TAGS.map((tag) => (
              <span
                key={tag}
                className={`tetris-state-chip${state._tag === tag ? " is-active" : ""}`}
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="tetris-panel-note">
            One tagged union, four nodes. Gravity is a named timer owned by <code>Falling</code>:
            steering is a <code>stay</code> update that leaves it running; leaving the state cancels
            it. Studio watches the same handle.
          </p>
        </div>
        <div className="tetris-pad">
          <button
            type="button"
            className="btn btn--surface"
            disabled={!playing}
            aria-label="Move left"
            onClick={() => send({ _tag: "MoveLeft" })}
          >
            ◀
          </button>
          <button
            type="button"
            className="btn btn--surface"
            disabled={!playing}
            aria-label="Soft drop"
            onClick={() => send({ _tag: "SoftDrop" })}
          >
            ▼
          </button>
          <button
            type="button"
            className="btn btn--surface"
            disabled={!playing}
            aria-label="Move right"
            onClick={() => send({ _tag: "MoveRight" })}
          >
            ▶
          </button>
          <button
            type="button"
            className="btn btn--surface"
            disabled={!playing}
            aria-label="Rotate"
            onClick={() => send({ _tag: "Rotate" })}
          >
            ⟳
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!playing}
            onClick={() => send({ _tag: "HardDrop" })}
          >
            Drop
          </button>
          {paused ? (
            <button
              type="button"
              className="btn btn--surface"
              onClick={() => send({ _tag: "Resume" })}
            >
              Resume
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--surface"
              disabled={!playing}
              onClick={() => send({ _tag: "Pause" })}
            >
              Pause
            </button>
          )}
          <button type="button" className="btn btn--surface" onClick={restart}>
            Restart
          </button>
        </div>
      </aside>
      <div className="tetris-studio">
        {handle === undefined ? (
          <div className="tetris-studio-loading">Mounting Studio…</div>
        ) : (
          <Studio
            machine={{
              definition,
              handle,
              appName: "Tetris demo",
              quickEvents: QUICK_EVENTS,
            }}
            style={{ height: "100%", minHeight: 560 }}
          />
        )}
      </div>
      <TracePanel trace={trace} />
    </div>
  )
}
