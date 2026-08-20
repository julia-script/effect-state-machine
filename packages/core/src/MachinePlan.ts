import * as Duration from "effect/Duration"
import { recordFromEntries } from "./Internal.js"

export interface Tagged {
  readonly _tag: string
}

export type SelectedBranch =
  | Readonly<{ kind: "guard"; index: number; name: string }>
  | Readonly<{ kind: "otherwise"; index: number }>

export interface EventTransition<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly reduce: (
    args: Readonly<{ state: State; event: Event }>,
  ) => Readonly<Record<string, unknown>>
}

interface EventStay<State extends Tagged, Event extends Tagged> {
  readonly stay: (
    args: Readonly<{ state: State; event: Event }>,
  ) => Readonly<Record<string, unknown>>
}

interface EventWhen<State extends Tagged, Event extends Tagged>
  extends EventTransition<State, Event> {
  readonly when: Readonly<{
    name: string
    guard: (args: Readonly<{ state: State; event: Event }>) => boolean
  }>
}

interface EventOtherwise<State extends Tagged, Event extends Tagged>
  extends EventTransition<State, Event> {
  readonly otherwise: true
}

export type EventHandler<State extends Tagged, Event extends Tagged> =
  | EventTransition<State, Event>
  | EventStay<State, Event>
  | Readonly<{ ignore: unknown }>
  | Readonly<{
      branches: ReadonlyArray<EventWhen<State, Event> | EventOtherwise<State, Event>>
    }>

export interface OutcomeTransition<State extends Tagged, Value, Key extends "value" | "error"> {
  readonly target: string
  readonly reduce: (
    args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>,
  ) => Readonly<Record<string, unknown>>
}

interface OutcomeWhen<State extends Tagged, Value, Key extends "value" | "error">
  extends OutcomeTransition<State, Value, Key> {
  readonly when: Readonly<{
    name: string
    guard: (args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>) => boolean
  }>
}

interface OutcomeOtherwise<State extends Tagged, Value, Key extends "value" | "error">
  extends OutcomeTransition<State, Value, Key> {
  readonly otherwise: true
}

export type OutcomeHandler<State extends Tagged, Value, Key extends "value" | "error"> =
  | OutcomeTransition<State, Value, Key>
  | Readonly<{
      branches: ReadonlyArray<OutcomeWhen<State, Value, Key> | OutcomeOtherwise<State, Value, Key>>
    }>

export interface NamedDuration<State> {
  readonly name: string
  readonly compute: (state: State) => Duration.Input
}

export type DurationSpec<State> = Duration.Input | NamedDuration<State>

export interface AfterTransition<State extends Tagged> {
  readonly target: string
  readonly reduce: (args: Readonly<{ state: State }>) => Readonly<Record<string, unknown>>
}

interface AfterWhen<State extends Tagged> extends AfterTransition<State> {
  readonly when: Readonly<{
    name: string
    guard: (args: Readonly<{ state: State }>) => boolean
  }>
}

interface AfterOtherwise<State extends Tagged> extends AfterTransition<State> {
  readonly otherwise: true
}

export type After<State extends Tagged> = Readonly<{
  duration: DurationSpec<State>
}> &
  (
    | AfterTransition<State>
    | Readonly<{ branches: ReadonlyArray<AfterWhen<State> | AfterOtherwise<State>> }>
  )

export type RegionEventHandler<State extends Tagged, Event extends Tagged> =
  | Readonly<{
      target: string
      reduce: (
        args: Readonly<{ state: Tagged; event: Event; parent: State }>,
      ) => Readonly<Record<string, unknown>>
    }>
  | Readonly<{
      stay: (
        args: Readonly<{ state: Tagged; event: Event; parent: State }>,
      ) => Readonly<Record<string, unknown>>
    }>
  | Readonly<{ ignore: unknown }>

export interface RegionOutcome<State extends Tagged, Key extends "value" | "error"> {
  readonly target: string
  readonly reduce: (
    args: Readonly<{ state: Tagged; parent: State }> & Readonly<Record<Key, unknown>>,
  ) => Readonly<Record<string, unknown>>
}

export interface RegionAfterTransition<State extends Tagged> {
  readonly target: string
  readonly reduce: (
    args: Readonly<{ state: Tagged; parent: State }>,
  ) => Readonly<Record<string, unknown>>
}

interface RegionAfterWhen<State extends Tagged> extends RegionAfterTransition<State> {
  readonly when: Readonly<{
    name: string
    guard: (args: Readonly<{ state: Tagged; parent: State }>) => boolean
  }>
}

interface RegionAfterOtherwise<State extends Tagged> extends RegionAfterTransition<State> {
  readonly otherwise: true
}

export type RegionAfter<State extends Tagged> = Readonly<{
  duration: DurationSpec<Readonly<{ state: Tagged; parent: State }>>
}> &
  (
    | RegionAfterTransition<State>
    | Readonly<{
        branches: ReadonlyArray<RegionAfterWhen<State> | RegionAfterOtherwise<State>>
      }>
  )

export interface RegionNode<State extends Tagged, Event extends Tagged> {
  readonly final?: true
  readonly on?: Readonly<Record<string, RegionEventHandler<State, Event> | undefined>>
}

export interface RegionsNode<State extends Tagged, Event extends Tagged> {
  readonly kind: "regions"
  readonly regions: Readonly<
    Record<string, Readonly<{ states: Readonly<Record<string, RegionNode<State, Event>>> }>>
  >
}

export interface TransitionPlan<State extends Tagged> {
  readonly kind: "transition"
  readonly previous: State
  readonly next: State
  readonly entry: Readonly<{ source: string; target: string; changed: boolean }>
  readonly branch?: SelectedBranch
}

export interface StayPlan<State extends Tagged> {
  readonly kind: "stay"
  readonly previous: State
  readonly next: State
  readonly entry: Readonly<{ source: string; target: string; changed: boolean }>
}

export type PlannedEvent<State extends Tagged> =
  | Readonly<{ kind: "ignore" }>
  | TransitionPlan<State>
  | StayPlan<State>

export interface RegionTransitionPlan<State extends Tagged> {
  readonly previous: State
  readonly next: State
  readonly updates: Readonly<Record<string, Tagged>>
  readonly reenteredSlots: ReadonlySet<string>
  readonly transitions: ReadonlyArray<Readonly<{ slot: string; source: string; target: string }>>
}

export const planTransition = <State extends Tagged>(
  previous: State,
  target: string,
  fields: Readonly<Record<string, unknown>>,
  branch?: SelectedBranch,
): TransitionPlan<State> => ({
  kind: "transition",
  previous,
  // The target tag and reducer fields are validated by the definition's state Schema at runtime.
  next: { ...fields, _tag: target } as State,
  entry: { source: previous._tag, target, changed: true },
  ...(branch === undefined ? {} : { branch }),
})

const planStay = <State extends Tagged>(
  previous: State,
  fields: Readonly<Record<string, unknown>>,
): StayPlan<State> => ({
  kind: "stay",
  previous,
  next: { ...previous, ...fields, _tag: previous._tag },
  entry: { source: previous._tag, target: previous._tag, changed: false },
})

export const planEvent = <State extends Tagged, Event extends Tagged>(
  handler: EventHandler<State, Event> | undefined,
  state: State,
  event: Event,
): PlannedEvent<State> | undefined => {
  if (handler === undefined) return undefined
  if ("ignore" in handler) return { kind: "ignore" }
  if ("stay" in handler) return planStay(state, handler.stay({ state, event }))
  let transition: EventTransition<State, Event> | undefined
  let branch: SelectedBranch | undefined
  if (!("branches" in handler)) {
    transition = handler
  } else {
    for (const [index, candidate] of handler.branches.entries()) {
      if ("otherwise" in candidate) {
        transition = candidate
        branch = { kind: "otherwise", index }
        break
      }
      if (candidate.when.guard({ state, event })) {
        transition = candidate
        branch = { kind: "guard", index, name: candidate.when.name }
        break
      }
    }
  }
  if (transition === undefined) return undefined
  return planTransition(state, transition.target, transition.reduce({ state, event }), branch)
}

export const canEvent = <State extends Tagged, Event extends Tagged>(
  handler: EventHandler<State, Event> | undefined,
  state: State,
  event: Event,
): boolean => {
  if (handler === undefined) return false
  if (!("branches" in handler)) return true
  return handler.branches.some(
    (candidate) => "otherwise" in candidate || candidate.when.guard({ state, event }),
  )
}

export const selectOutcome = <State extends Tagged, Value, Key extends "value" | "error">(
  handler: OutcomeHandler<State, Value, Key>,
  args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>,
):
  | Readonly<{ transition: OutcomeTransition<State, Value, Key>; branch?: SelectedBranch }>
  | undefined => {
  if (!("branches" in handler)) return { transition: handler }
  for (const [index, candidate] of handler.branches.entries()) {
    if ("otherwise" in candidate) {
      return { transition: candidate, branch: { kind: "otherwise", index } }
    }
    if (candidate.when.guard(args)) {
      return {
        transition: candidate,
        branch: { kind: "guard", index, name: candidate.when.name },
      }
    }
  }
  return undefined
}

export const planOutcome = (
  handler:
    | OutcomeHandler<Tagged, unknown, "value">
    | OutcomeHandler<Tagged, unknown, "error">
    | undefined,
  state: Tagged,
  channel: "success" | "failure",
  value: unknown,
  spreadValue = false,
): TransitionPlan<Tagged> | undefined => {
  if (handler === undefined) return undefined
  if (channel === "success") {
    const selected = selectOutcome(handler as OutcomeHandler<Tagged, unknown, "value">, {
      state,
      value,
    })
    if (selected === undefined) return undefined
    const args =
      spreadValue && typeof value === "object" && value !== null
        ? { state, ...value }
        : { state, value }
    return planTransition(
      state,
      selected.transition.target,
      // Aggregate-all reducers receive their named lanes spread beside state at this erasure seam.
      selected.transition.reduce(
        args as Readonly<{ state: Tagged }> & Readonly<Record<"value", unknown>>,
      ),
      selected.branch,
    )
  }
  const selected = selectOutcome(handler as OutcomeHandler<Tagged, unknown, "error">, {
    state,
    error: value,
  })
  if (selected === undefined) return undefined
  return planTransition(
    state,
    selected.transition.target,
    selected.transition.reduce({ state, error: value }),
    selected.branch,
  )
}

export const selectAfter = <State extends Tagged>(after: After<State>, state: State) => {
  if (!("branches" in after)) return { transition: after }
  for (const [index, candidate] of after.branches.entries()) {
    if ("otherwise" in candidate) {
      return { transition: candidate, branch: { kind: "otherwise", index } as const }
    }
    if (candidate.when.guard({ state })) {
      return {
        transition: candidate,
        branch: { kind: "guard", index, name: candidate.when.name } as const,
      }
    }
  }
  return undefined
}

export const planAfter = <State extends Tagged>(
  after: After<State>,
  state: State,
): TransitionPlan<State> | undefined => {
  const selected = selectAfter(after, state)
  if (selected === undefined) return undefined
  return planTransition(
    state,
    selected.transition.target,
    selected.transition.reduce({ state }),
    selected.branch,
  )
}

export const selectRegionAfter = <State extends Tagged>(
  after: RegionAfter<State>,
  args: Readonly<{ state: Tagged; parent: State }>,
) => {
  if (!("branches" in after)) return { transition: after }
  for (const [index, candidate] of after.branches.entries()) {
    if ("otherwise" in candidate) {
      return { transition: candidate, branch: { kind: "otherwise", index } as const }
    }
    if (candidate.when.guard(args)) {
      return {
        transition: candidate,
        branch: { kind: "guard", index, name: candidate.when.name } as const,
      }
    }
  }
  return undefined
}

export const planRegionEvent = <State extends Tagged, Event extends Tagged>(
  node: Readonly<{ regions?: RegionsNode<State, Event>["regions"] }>,
  current: State,
  event: Event,
): RegionTransitionPlan<State> | undefined => {
  if (node.regions === undefined) return undefined
  const selected: Array<
    Readonly<{ slot: string; active: Tagged; handler: RegionEventHandler<State, Event> }>
  > = []
  const updates = new Map<string, Tagged>()
  const reentered = new Set<string>()
  const transitions: Array<Readonly<{ slot: string; source: string; target: string }>> = []
  for (const [slot, region] of Object.entries(node.regions)) {
    const slotState = (current as Readonly<Record<string, unknown>>)[slot]
    if (typeof slotState !== "object" || slotState === null || !("_tag" in slotState)) continue
    const active = slotState as Tagged
    const handler = region.states[active._tag]?.on?.[event._tag]
    if (handler !== undefined) selected.push({ slot, active, handler })
  }
  for (const { slot, active, handler } of selected) {
    if ("ignore" in handler) continue
    if ("stay" in handler) {
      const fields = handler.stay({ state: active, event, parent: current })
      updates.set(slot, { ...active, ...fields, _tag: active._tag })
      continue
    }
    const fields = handler.reduce({ state: active, event, parent: current })
    updates.set(slot, { ...fields, _tag: handler.target } as Tagged)
    reentered.add(slot)
    transitions.push({ slot, source: active._tag, target: handler.target })
  }
  if (selected.length === 0) return undefined
  const updateRecord = recordFromEntries(updates)
  return {
    ...planRegionMacrostep(current, updateRecord, reentered),
    transitions,
  }
}

export const planRegionMacrostep = <State extends Tagged>(
  previous: State,
  updates: Readonly<Record<string, Tagged>>,
  reenteredSlots: ReadonlySet<string>,
): RegionTransitionPlan<State> => ({
  previous,
  next: { ...previous, ...updates },
  updates,
  reenteredSlots,
  transitions: [],
})

export const planRegionOutcome = (
  transition: RegionOutcome<Tagged, "value"> | RegionOutcome<Tagged, "error">,
  parent: Tagged,
  local: Tagged,
  channel: "success" | "failure",
  value: unknown,
): Tagged => {
  const fields =
    channel === "success"
      ? (transition as RegionOutcome<Tagged, "value">).reduce({ state: local, parent, value })
      : (transition as RegionOutcome<Tagged, "error">).reduce({
          state: local,
          parent,
          error: value,
        })
  return { ...fields, _tag: transition.target } as Tagged
}

export const planRegionAfter = <State extends Tagged>(
  after: RegionAfter<State>,
  parent: State,
  local: Tagged,
): Readonly<{ next: Tagged }> | undefined => {
  const selected = selectRegionAfter(after, { state: local, parent })
  if (selected === undefined) return undefined
  const fields = selected.transition.reduce({ state: local, parent })
  return { next: { ...fields, _tag: selected.transition.target } as Tagged }
}

export const regionsComplete = <State extends Tagged, Event extends Tagged>(
  node: Readonly<{ kind: string; regions?: RegionsNode<State, Event>["regions"] }> | undefined,
  state: State,
): boolean => {
  if (node?.kind !== "regions" || node.regions === undefined) return false
  return Object.entries(node.regions).every(([slot, region]) => {
    const slotState = (state as Readonly<Record<string, unknown>>)[slot]
    return (
      typeof slotState === "object" &&
      slotState !== null &&
      region.states[(slotState as Tagged)._tag]?.final === true
    )
  })
}

export const isStaleEntry = (
  expected: Readonly<{ stateTag: string; generation: number }>,
  current: Readonly<{ stateTag: string; generation: number }>,
): boolean => expected.stateTag !== current.stateTag || expected.generation !== current.generation

export const resolveDuration = <State>(
  duration: DurationSpec<State>,
  state: State,
): Readonly<{ input: Duration.Input; timer: string; durationMillis: number }> => {
  const dynamic =
    typeof duration === "object" && duration !== null && "compute" in duration
      ? (duration as NamedDuration<State>)
      : undefined
  // Duration.Input contains object variants, so this is the single structural erasure boundary.
  const input = dynamic === undefined ? (duration as Duration.Input) : dynamic.compute(state)
  return {
    input,
    timer: dynamic?.name ?? "after",
    durationMillis: Duration.toMillis(input),
  }
}
