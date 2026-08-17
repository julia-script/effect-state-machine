/**
 * PROTOTYPE — throwaway Tetris demo for effect-state-machine. Not part of the
 * published package. The whole game is one machine definition: gravity is a
 * scoped invoked Effect owned by the Falling state (pausing cancels it), every
 * input is a machine event, and lock/clear/top-out decisions are named guards.
 *
 * Build the single-file page with:
 *   node examples/build-tetris-demo.prototype.mjs
 * then open examples/tetris-demo.prototype.html
 */
import { Context, Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import * as Machine from "../src/Machine.js"

// ---------------------------------------------------------------------------
// Pure Tetris logic
// ---------------------------------------------------------------------------

const WIDTH = 10
const HEIGHT = 20

interface PieceData {
  readonly kind: number
  readonly rotation: number
  readonly x: number
  readonly y: number
}

type BoardData = ReadonlyArray<ReadonlyArray<number>>

const BASE: ReadonlyArray<{
  readonly size: number
  readonly cells: ReadonlyArray<readonly [number, number]>
}> = [
  {
    size: 4,
    cells: [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
  }, // I
  {
    size: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  }, // J
  {
    size: 3,
    cells: [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  }, // L
  {
    size: 2,
    cells: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  }, // O
  {
    size: 3,
    cells: [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
  }, // S
  {
    size: 3,
    cells: [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  }, // T
  {
    size: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  }, // Z
]

const ROTATIONS: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = BASE.map(
  ({ size, cells }) => {
    const rotations: Array<ReadonlyArray<readonly [number, number]>> = [cells]
    for (let step = 0; step < 3; step += 1) {
      const previous = rotations[rotations.length - 1]
      rotations.push(previous.map(([row, column]) => [column, size - 1 - row]))
    }
    return rotations
  },
)

const cellsOf = (piece: PieceData): ReadonlyArray<readonly [number, number]> =>
  ROTATIONS[piece.kind][piece.rotation & 3].map(([row, column]) => [
    piece.y + row,
    piece.x + column,
  ])

const collides = (board: BoardData, piece: PieceData): boolean =>
  cellsOf(piece).some(
    ([row, column]) =>
      column < 0 || column >= WIDTH || row >= HEIGHT || (row >= 0 && board[row][column] !== 0),
  )

const mergePiece = (board: BoardData, piece: PieceData): BoardData => {
  const merged = board.map((row) => [...row])
  for (const [row, column] of cellsOf(piece)) {
    if (row >= 0) merged[row][column] = piece.kind + 1
  }
  return merged
}

const fullRows = (board: BoardData): ReadonlyArray<number> =>
  board.flatMap((row, index) => (row.every((cell) => cell !== 0) ? [index] : []))

const collapse = (board: BoardData, rows: ReadonlyArray<number>): BoardData => {
  const kept = board.filter((_, index) => !rows.includes(index))
  const empty = Array.from({ length: rows.length }, () => Array.from({ length: WIDTH }, () => 0))
  return [...empty, ...kept]
}

const spawn = (kind: number): PieceData => ({ kind, rotation: 0, x: 3, y: kind === 0 ? -1 : 0 })

const down = (piece: PieceData): PieceData => ({ ...piece, y: piece.y + 1 })

const dropped = (board: BoardData, piece: PieceData): PieceData => {
  let candidate = piece
  while (!collides(board, down(candidate))) candidate = down(candidate)
  return candidate
}

// ponytail: plain LCG instead of a 7-bag randomizer; swap in a bag if streaks annoy
const nextSeed = (seed: number): number => (Math.imul(seed, 1664525) + 1013904223) >>> 0
const roll = (seed: number): readonly [number, number] => {
  const advanced = nextSeed(seed)
  return [(advanced >>> 16) % 7, advanced]
}

const LINE_SCORES = [0, 100, 300, 500, 800]
const gravityMs = (level: number): number => Math.max(90, 750 - (level - 1) * 60)

const EMPTY_BOARD: BoardData = Array.from({ length: HEIGHT }, () =>
  Array.from({ length: WIDTH }, () => 0),
)

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

const Piece = Schema.Struct({
  kind: Schema.Number,
  rotation: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
})
const Board = Schema.Array(Schema.Array(Schema.Number))

const progressFields = {
  board: Board,
  queue: Schema.Array(Schema.Number),
  score: Schema.Number,
  lines: Schema.Number,
  level: Schema.Number,
  seed: Schema.Number,
}

const Input = Schema.Struct({ seed: Schema.Number }).annotate({
  description: "Seed for the pure piece generator; the same seed replays the same game.",
})

const State = Machine.taggedUnion({
  Falling: {
    fields: { ...progressFields, piece: Piece },
    description:
      "One piece is falling. The gravity delay is an invoked Effect owned by this state.",
  },
  Clearing: {
    fields: { ...progressFields, cleared: Schema.Array(Schema.Number) },
    description: "Hold completed rows on screen briefly before collapsing them.",
  },
  Paused: {
    fields: { ...progressFields, piece: Piece },
    description: "Leaving Falling cancels the scoped gravity Effect; nothing ticks here.",
  },
  GameOver: {
    fields: { board: Board, score: Schema.Number, lines: Schema.Number, level: Schema.Number },
    description: "A locked piece blocked the spawn row. The machine is complete.",
  },
})

const Event = Machine.taggedUnion({
  MoveLeft: { fields: {}, description: "Shift the falling piece one column left." },
  MoveRight: { fields: {}, description: "Shift the falling piece one column right." },
  Rotate: { fields: {}, description: "Rotate clockwise, nudging off walls when needed." },
  SoftDrop: { fields: {}, description: "Descend one row without waiting for gravity." },
  HardDrop: { fields: {}, description: "Drop to the floor and lock immediately." },
  Pause: { fields: {}, description: "Suspend play; cancels the gravity Effect." },
  Resume: { fields: {}, description: "Return to Falling; gravity is re-invoked." },
})

type FallingState = {
  readonly board: BoardData
  readonly piece: PieceData
  readonly queue: ReadonlyArray<number>
  readonly score: number
  readonly lines: number
  readonly level: number
  readonly seed: number
}

type ProgressState = Omit<FallingState, "piece">

const spawnNext = (state: ProgressState, board: BoardData) => {
  const [kind, seed] = roll(state.seed)
  return {
    _tag: "Falling" as const,
    board,
    piece: spawn(state.queue[0]),
    queue: [...state.queue.slice(1), kind],
    score: state.score,
    lines: state.lines,
    level: state.level,
    seed,
  }
}

const toClearing = (state: FallingState, merged: BoardData, cleared: ReadonlyArray<number>) => {
  const lines = state.lines + cleared.length
  return {
    _tag: "Clearing" as const,
    board: merged,
    cleared,
    queue: state.queue,
    score: state.score + LINE_SCORES[cleared.length] * state.level,
    lines,
    level: 1 + Math.floor(lines / 10),
    seed: state.seed,
  }
}

const toGameOver = (state: ProgressState, board: BoardData) => ({
  _tag: "GameOver" as const,
  board,
  score: state.score,
  lines: state.lines,
  level: state.level,
})

/** The three lock outcomes, shared by the gravity tick and HardDrop. */
const lockBranches = (pieceOf: (state: FallingState) => PieceData) =>
  [
    {
      when: {
        name: "rows-completed",
        description: "Locking this piece completes at least one row.",
        guard: ({ state }: { readonly state: FallingState }) =>
          fullRows(mergePiece(state.board, pieceOf(state))).length > 0,
      },
      target: "Clearing" as const,
      reduce: ({ state }: { readonly state: FallingState }) => {
        const merged = mergePiece(state.board, pieceOf(state))
        return toClearing(state, merged, fullRows(merged))
      },
    },
    {
      when: {
        name: "spawn-blocked",
        description: "The next piece cannot enter the board.",
        guard: ({ state }: { readonly state: FallingState }) =>
          collides(mergePiece(state.board, pieceOf(state)), spawn(state.queue[0])),
      },
      target: "GameOver" as const,
      reduce: ({ state }: { readonly state: FallingState }) =>
        toGameOver(state, mergePiece(state.board, pieceOf(state))),
    },
    {
      otherwise: true as const,
      target: "Falling" as const,
      reduce: ({ state }: { readonly state: FallingState }) =>
        spawnNext(state, mergePiece(state.board, pieceOf(state))),
    },
  ] as const

const tetris = Machine.builder({ input: Input, state: State, event: Event })

export const definition = tetris.define(
  {
    id: "tetris",
    description:
      "A complete Tetris game as one machine: gravity as a scoped invoked Effect, inputs as events, lock decisions as named guards.",
    initial: (input) => {
      let seed = input.seed >>> 0
      const kinds: Array<number> = []
      for (let index = 0; index < 4; index += 1) {
        const [kind, advanced] = roll(seed)
        kinds.push(kind)
        seed = advanced
      }
      return {
        _tag: "Falling",
        board: EMPTY_BOARD,
        piece: spawn(kinds[0]),
        queue: kinds.slice(1),
        score: 0,
        lines: 0,
        level: 1,
        seed,
      }
    },
  },
  {
    Falling: tetris.invoke(
      {
        name: "gravity.wait",
        description:
          "Sleep one gravity interval. The sleep is scoped to Falling: any transition cancels and re-invokes it.",
        effect: (state) => Effect.sleep(gravityMs(state.level)),
        onSuccess: {
          branches: [
            {
              when: {
                name: "piece-can-descend",
                description: "The row below the piece is free.",
                guard: ({ state }) => !collides(state.board, down(state.piece)),
              },
              target: "Falling",
              reduce: ({ state }) => ({ ...state, piece: down(state.piece) }),
            },
            ...lockBranches((state) => state.piece),
          ],
        },
        // Effect.sleep cannot fail; the type still requires a transition.
        onFailure: {
          target: "GameOver",
          reduce: ({ state }) => toGameOver(state, state.board),
        },
      },
      {
        MoveLeft: {
          target: "Falling",
          reduce: ({ state }) => {
            const moved = { ...state.piece, x: state.piece.x - 1 }
            return collides(state.board, moved) ? state : { ...state, piece: moved }
          },
        },
        MoveRight: {
          target: "Falling",
          reduce: ({ state }) => {
            const moved = { ...state.piece, x: state.piece.x + 1 }
            return collides(state.board, moved) ? state : { ...state, piece: moved }
          },
        },
        Rotate: {
          target: "Falling",
          reduce: ({ state }) => {
            const turned = { ...state.piece, rotation: (state.piece.rotation + 1) & 3 }
            for (const nudge of [0, -1, 1, -2, 2]) {
              const candidate = { ...turned, x: turned.x + nudge }
              if (!collides(state.board, candidate)) return { ...state, piece: candidate }
            }
            return state
          },
        },
        SoftDrop: {
          target: "Falling",
          reduce: ({ state }) =>
            collides(state.board, down(state.piece))
              ? state
              : { ...state, piece: down(state.piece) },
        },
        HardDrop: {
          branches: [...lockBranches((state) => dropped(state.board, state.piece))],
        },
        Pause: {
          target: "Paused",
          reduce: ({ state }) => ({ ...state, _tag: "Paused" as const }),
        },
      },
    ),
    Clearing: tetris.invoke({
      name: "clear.settle",
      description: "Hold the completed rows on screen before collapsing them.",
      effect: () => Effect.sleep(280),
      onSuccess: {
        branches: [
          {
            when: {
              name: "spawn-blocked",
              description: "Even after clearing, the next piece cannot enter.",
              guard: ({ state }) =>
                collides(collapse(state.board, state.cleared), spawn(state.queue[0])),
            },
            target: "GameOver",
            reduce: ({ state }) => toGameOver(state, collapse(state.board, state.cleared)),
          },
          {
            otherwise: true,
            target: "Falling",
            reduce: ({ state }) => spawnNext(state, collapse(state.board, state.cleared)),
          },
        ],
      },
      onFailure: {
        target: "GameOver",
        reduce: ({ state }) => toGameOver(state, state.board),
      },
    }),
    Paused: tetris.state({
      Resume: {
        target: "Falling",
        reduce: ({ state }) => ({ ...state, _tag: "Falling" as const }),
      },
    }),
    GameOver: tetris.final(),
  },
)

// ---------------------------------------------------------------------------
// Browser wiring
// ---------------------------------------------------------------------------

type State = Machine.MachineState<typeof definition>
type GameEvent = Machine.MachineEvent<typeof definition>
type Completion = Extract<State, { readonly _tag: "GameOver" }>
type Handle = Machine.MachineHandle<State, GameEvent, Completion>

class Game extends Context.Service<Game, Handle>()("examples/TetrisGame") {}

const makeGame = (seed: number) => {
  const runtime = ManagedRuntime.make(Layer.effect(Game)(Machine.run(definition, { seed })))
  return {
    send: (event: GameEvent) =>
      runtime.runPromise(Effect.flatMap(Game, ({ send }) => Effect.exit(send(event)))),
    subscribeState: (onState: (state: State) => void) => {
      runtime.runFork(
        Effect.flatMap(Game, ({ changes }) =>
          Stream.runForEach(changes, (state) => Effect.sync(() => onState(state))),
        ),
      )
    },
    subscribeInspection: (onEvent: (event: Machine.InspectionEvent) => void) => {
      runtime.runFork(
        Effect.flatMap(Game, ({ inspection }) =>
          Stream.runForEach(inspection, (event) => Effect.sync(() => onEvent(event))),
        ),
      )
    },
    snapshot: () => runtime.runPromise(Effect.flatMap(Game, ({ snapshot }) => snapshot)),
    dispose: () => runtime.dispose(),
  }
}

type GameApp = ReturnType<typeof makeGame>

let app: GameApp | undefined
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

const send = (event: GameEvent) => {
  void app?.send(event)
}

const restart = () => {
  void replaceGame((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1)
}

const replaceGame = async (seed: number) => {
  const myGeneration = generation + 1
  generation = myGeneration
  const previous = app
  app = undefined
  currentState = undefined
  trace = []
  traceSequence = 0
  render()
  if (previous !== undefined) await previous.dispose()
  if (myGeneration !== generation) return
  const next = makeGame(seed)
  app = next
  next.subscribeState((state) => {
    if (myGeneration !== generation) return
    currentState = state
    render()
  })
  next.subscribeInspection((event) => {
    if (myGeneration !== generation) return
    const text = summarize(event)
    if (text === undefined) return
    traceSequence += 1
    trace = [...trace, { number: traceSequence, text }].slice(-40)
    renderTrace()
  })
  currentState = await next.snapshot()
  render()
}

// ---------------------------------------------------------------------------
// Rendering
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
  const root = document.querySelector("#app")
  if (root === null) return
  const state = currentState
  if (state === undefined) {
    root.innerHTML = `<p class="boot-message">Booting the tetris machine…</p>`
    return
  }
  root.innerHTML = `
    <header class="top">
      <span class="brand">effect-state-machine</span>
      <span class="sticker">tetris · prototype</span>
      <span class="top-spacer"></span>
      <span class="top-hint">← → move · ↑ rotate · ↓ soft drop · space hard drop · P pause</span>
    </header>
    <main class="layout">
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
          <p class="panel-note">One tagged union, four nodes. Gravity is an invoked Effect owned by <code>Falling</code>; leaving the state cancels it.</p>
        </div>
        ${controls(state)}
      </aside>
      <section class="trace-card">
        <div class="trace-bar">
          <span class="trace-title">inspection stream</span>
          <span class="trace-sticker">live</span>
        </div>
        <div class="trace-log" id="trace-log"></div>
      </section>
    </main>
    <footer class="foot">
      PROTOTYPE · throwaway demo · machine definition in <code>examples/tetris-demo.prototype.ts</code>
    </footer>`
  renderTrace()
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
  const button = target.closest("button")
  if (button === null) return
  const action = button.getAttribute("data-action")
  if (action === "restart") {
    restart()
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

void replaceGame(0xc0ffee)
