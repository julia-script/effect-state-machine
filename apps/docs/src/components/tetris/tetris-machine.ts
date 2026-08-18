/**
 * Tetris as one machine definition. Gravity is a named state-derived timer owned
 * by the Falling state (pausing cancels it, `stay` steering updates leave it
 * running), every input is a machine event, and lock/clear/top-out decisions
 * are named guards visible in the inspection stream and Studio.
 */
import { Schema } from "effect"
import { Machine } from "effect-state-machine"

// ---------------------------------------------------------------------------
// Pure Tetris logic
// ---------------------------------------------------------------------------

export const WIDTH = 10
export const HEIGHT = 20

export interface PieceData {
  readonly kind: number
  readonly rotation: number
  readonly x: number
  readonly y: number
}

export type BoardData = ReadonlyArray<ReadonlyArray<number>>

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

export const ROTATIONS: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>> =
  BASE.map(({ size, cells }) => {
    const rotations: Array<ReadonlyArray<readonly [number, number]>> = [cells]
    for (let step = 0; step < 3; step += 1) {
      const previous = rotations[rotations.length - 1]
      rotations.push(previous.map(([row, column]) => [column, size - 1 - row]))
    }
    return rotations
  })

export const cellsOf = (piece: PieceData): ReadonlyArray<readonly [number, number]> =>
  ROTATIONS[piece.kind][piece.rotation & 3].map(([row, column]) => [
    piece.y + row,
    piece.x + column,
  ])

export const collides = (board: BoardData, piece: PieceData): boolean =>
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

export const down = (piece: PieceData): PieceData => ({ ...piece, y: piece.y + 1 })

export const dropped = (board: BoardData, piece: PieceData): PieceData => {
  let candidate = piece
  while (!collides(board, down(candidate))) candidate = down(candidate)
  return candidate
}

// Plain LCG keeps the piece stream a pure function of the seed; a 7-bag
// randomizer would reduce streaks but needs no library features this demo shows.
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
    description: "One piece is falling. A named state-derived timer owns the gravity interval.",
  },
  Clearing: {
    fields: { ...progressFields, cleared: Schema.Array(Schema.Number) },
    description: "Hold completed rows on screen briefly before collapsing them.",
  },
  Paused: {
    fields: { ...progressFields, piece: Piece },
    description: "Leaving Falling cancels its gravity timer; nothing ticks here.",
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
  Pause: { fields: {}, description: "Suspend play; cancels the gravity timer." },
  Resume: { fields: {}, description: "Return to Falling; gravity starts on entry." },
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
      "A complete Tetris game as one machine: gravity as a named timer, inputs as events, lock decisions as named guards.",
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
    Falling: tetris.state(
      {
        // `stay` updates state data without exiting or re-entering the node,
        // so steering the piece never restarts the running gravity timer.
        MoveLeft: {
          stay: ({ state }) => {
            const moved = { ...state.piece, x: state.piece.x - 1 }
            return collides(state.board, moved) ? state : { ...state, piece: moved }
          },
        },
        MoveRight: {
          stay: ({ state }) => {
            const moved = { ...state.piece, x: state.piece.x + 1 }
            return collides(state.board, moved) ? state : { ...state, piece: moved }
          },
        },
        Rotate: {
          stay: ({ state }) => {
            const turned = { ...state.piece, rotation: (state.piece.rotation + 1) & 3 }
            for (const nudge of [0, -1, 1, -2, 2]) {
              const candidate = { ...turned, x: turned.x + nudge }
              if (!collides(state.board, candidate)) return { ...state, piece: candidate }
            }
            return state
          },
        },
        SoftDrop: {
          stay: ({ state }) =>
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
      {
        after: {
          duration: {
            name: "gravity-interval",
            description: "750ms minus 60ms per level, with a 90ms floor.",
            compute: (state) => gravityMs(state.level),
          },
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
      },
    ),
    Clearing: tetris.state(
      {},
      {
        after: {
          duration: "280 millis",
          description: "Hold the completed rows on screen before collapsing them.",
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
      },
    ),
    Paused: tetris.state({
      Resume: {
        target: "Falling",
        reduce: ({ state }) => ({ ...state, _tag: "Falling" as const }),
      },
    }),
    GameOver: tetris.final(),
  },
)
