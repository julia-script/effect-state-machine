import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { AsyncResult, Atom } from "effect/unstable/reactivity"
import * as ViewerClient from "./ViewerClient.js"

/**
 * All shared UI state. Wire-fed data flows through `worldAtom`; everything
 * else here is per-viewer presentation state that never crosses the wire.
 */

export const runtime = Atom.runtime(ViewerClient.layer())

export const worldAtom = runtime
  .atom(Stream.unwrap(Effect.map(ViewerClient.ViewerClient, (client) => client.world)))
  .pipe(Atom.keepAlive, Atom.withLabel("world"))

/** The folded world with a safe empty default while connecting. */
export const worldViewAtom = Atom.map(worldAtom, (result) =>
  AsyncResult.getOrElse(result, () => ViewerClient.emptyWorld),
)

export const selectedSessionIdAtom = Atom.make<string | undefined>(undefined).pipe(
  Atom.keepAlive,
  Atom.withLabel("selectedSession"),
)

/** The session being inspected: the explicit choice, or the first available. */
export const currentSessionAtom = Atom.make((get) => {
  const world = get(worldViewAtom)
  const selected = get(selectedSessionIdAtom)
  return world.sessions.find((session) => session.sessionId === selected) ?? world.sessions[0]
})

export const dispatchAtom = runtime.fn(
  Effect.fnUntraced(function* (input: ViewerClient.DispatchInput) {
    const client = yield* ViewerClient.ViewerClient
    return yield* client.dispatch(input)
  }),
)

export const openEditorAtom = runtime.fn(
  Effect.fnUntraced(function* (location: {
    readonly file: string
    readonly line: number
    readonly column: number
  }) {
    const client = yield* ViewerClient.ViewerClient
    return yield* client.openEditor(location)
  }),
)

// Per-session view state. TTL'd so switching sessions and back keeps the
// cursor for a while without retaining state for every session forever.
export const cursorAtom = Atom.family((sessionId: string) =>
  Atom.make<number | undefined>(undefined).pipe(
    Atom.setIdleTTL("10 minutes"),
    Atom.withLabel(`cursor:${sessionId}`),
  ),
)

export const selectedStepAtom = Atom.family((sessionId: string) =>
  Atom.make<number | undefined>(undefined).pipe(
    Atom.setIdleTTL("10 minutes"),
    Atom.withLabel(`selectedStep:${sessionId}`),
  ),
)

export const selectedActorIdAtom = Atom.family((sessionId: string) =>
  Atom.make<string | undefined>(undefined).pipe(
    Atom.setIdleTTL("10 minutes"),
    Atom.withLabel(`selectedActor:${sessionId}`),
  ),
)

/** Map depth in hops from the active node; "all" shows the whole machine. */
export const depthAtom = Atom.family((sessionId: string) =>
  Atom.make<number | "all">("all").pipe(
    Atom.setIdleTTL("10 minutes"),
    Atom.withLabel(`depth:${sessionId}`),
  ),
)

export interface MapSelection {
  readonly kind: "node" | "edge"
  readonly id: string
  readonly definitionPath: string
  readonly actorId?: string
}

export const selectionAtom = Atom.family((sessionId: string) =>
  Atom.make<MapSelection | undefined>(undefined).pipe(
    Atom.setIdleTTL("10 minutes"),
    Atom.withLabel(`selection:${sessionId}`),
  ),
)

export const graphJsonAtom = Atom.family((_sessionId: string) =>
  Atom.make(false).pipe(Atom.setIdleTTL("10 minutes")),
)

export const diffAtom = Atom.make(true).pipe(Atom.keepAlive)
export const railCollapsedAtom = Atom.make(false).pipe(Atom.keepAlive)

/** The position being inspected: cursor when time-traveling, else the head. */
export const displayedPositionAtom = Atom.make((get) => {
  const session = get(currentSessionAtom)
  if (session === undefined) return undefined
  const head = session.history.positions.length - 1
  if (head < 0) return undefined
  const cursor = get(cursorAtom(session.sessionId))
  return cursor === undefined ? head : Math.min(cursor, head)
})

/** Global tree sequence represented by the cursor, including terminal facts at live head. */
export const displayedSequenceAtom = Atom.make((get) => {
  const session = get(currentSessionAtom)
  if (session === undefined) return undefined
  const cursor = get(cursorAtom(session.sessionId))
  if (cursor === undefined) {
    return session.history.facts[session.history.facts.length - 1]?.sequence
  }
  return session.history.positions[Math.min(cursor, session.history.positions.length - 1)]?.sequence
})

export const isLiveAtom = Atom.make((get) => {
  const session = get(currentSessionAtom)
  return session === undefined ? true : get(cursorAtom(session.sessionId)) === undefined
})
