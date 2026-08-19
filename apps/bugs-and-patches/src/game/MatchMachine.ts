import * as Machine from "effect-state-machine/Machine"
import * as Match from "./Match.js"

const match = Machine.builder({ input: Match.Input, state: Match.State, event: Match.Event })

const expectBugPhase = (state: Match.State) => {
  if (state._tag === "BugPhase") return state
  throw new Error(`Expected BugPhase, received ${state._tag}`)
}

const expectPatchResponse = (state: Match.State) => {
  if (state._tag === "PatchResponse") return state
  throw new Error(`Expected PatchResponse, received ${state._tag}`)
}

const expectSideEffectPhase = (state: Match.State) => {
  if (state._tag === "SideEffectPhase") return state
  throw new Error(`Expected SideEffectPhase, received ${state._tag}`)
}

const expectFinished = (state: Match.State) => {
  if (state._tag === "Finished") return state
  throw new Error(`Expected Finished, received ${state._tag}`)
}

const bugResult = (
  state: Extract<Match.State, { readonly _tag: "BugPhase" }>,
  event: Extract<Match.Event, { readonly _tag: "PlayBug" }>,
) => Match.playBug(state, event)

const patchResult = (
  state: Extract<Match.State, { readonly _tag: "PatchResponse" }>,
  event?: Extract<Match.Event, { readonly _tag: "PlayPatch" }>,
) => Match.resolvePatch(state, event)

const sideEffectResult = (
  state: Extract<Match.State, { readonly _tag: "SideEffectPhase" }>,
  event: Extract<Match.Event, { readonly _tag: "PlaySideEffect" }>,
) => Match.playSideEffect(state, event)

const passSideEffectResult = (state: Extract<Match.State, { readonly _tag: "SideEffectPhase" }>) =>
  Match.endTurn(state)

type BugPlayArgs = Readonly<{
  state: Extract<Match.State, { readonly _tag: "BugPhase" }>
  event: Extract<Match.Event, { readonly _tag: "PlayBug" }>
}>
type BugPassArgs = Readonly<{
  state: Extract<Match.State, { readonly _tag: "BugPhase" }>
  event: Extract<Match.Event, { readonly _tag: "PassBug" }>
}>
type PatchPlayArgs = Readonly<{
  state: Extract<Match.State, { readonly _tag: "PatchResponse" }>
  event: Extract<Match.Event, { readonly _tag: "PlayPatch" }>
}>
type PatchPassArgs = Readonly<{
  state: Extract<Match.State, { readonly _tag: "PatchResponse" }>
  event: Extract<Match.Event, { readonly _tag: "PassPatch" }>
}>
type SideEffectPlayArgs = Readonly<{
  state: Extract<Match.State, { readonly _tag: "SideEffectPhase" }>
  event: Extract<Match.Event, { readonly _tag: "PlaySideEffect" }>
}>
type SideEffectPassArgs = Readonly<{
  state: Extract<Match.State, { readonly _tag: "SideEffectPhase" }>
  event: Extract<Match.Event, { readonly _tag: "PassSideEffect" }>
}>

const branch = <Args>(name: string, guard: (args: Args) => boolean) => ({ name, guard })

export const definition = match.define(
  {
    id: "bugs-and-patches-match",
    description:
      "A server-authoritative two-player v0 match: play a Bug, allow one Patch response, then optionally play a Side Effect.",
    initial: Match.initial,
  },
  {
    BugPhase: match.state({
      PlayBug: {
        branches: [
          {
            when: branch(
              "legal Bug ends match",
              ({ state, event }: BugPlayArgs) =>
                Match.canPlayBug(state, event) && bugResult(state, event)._tag === "Finished",
            ),
            target: "Finished",
            reduce: ({ state, event }) => expectFinished(bugResult(state, event)),
          },
          {
            when: branch(
              "legal Bug offers Patch response",
              ({ state, event }: BugPlayArgs) =>
                Match.canPlayBug(state, event) && bugResult(state, event)._tag === "PatchResponse",
            ),
            target: "PatchResponse",
            reduce: ({ state, event }) => expectPatchResponse(bugResult(state, event)),
          },
          {
            when: branch(
              "legal Bug grants another Bug play",
              ({ state, event }: BugPlayArgs) =>
                Match.canPlayBug(state, event) && bugResult(state, event)._tag === "BugPhase",
            ),
            target: "BugPhase",
            reduce: ({ state, event }) => expectBugPhase(bugResult(state, event)),
          },
          {
            when: branch(
              "legal Bug advances to Side Effect phase",
              ({ state, event }: BugPlayArgs) =>
                Match.canPlayBug(state, event) && bugResult(state, event)._tag === "SideEffectPhase",
            ),
            target: "SideEffectPhase",
            reduce: ({ state, event }) => expectSideEffectPhase(bugResult(state, event)),
          },
        ],
      },
      PassBug: {
        branches: [
          {
            when: branch(
              "active player passes Bug phase",
              ({ state, event }: BugPassArgs) => event.playerId === state.activePlayer,
            ),
            target: "SideEffectPhase",
            reduce: ({ state }) => expectSideEffectPhase(Match.passBug(state)),
          },
        ],
      },
      Surrender: {
        target: "Finished",
        reduce: ({ state, event }) => expectFinished(Match.surrender(state, event.playerId)),
      },
    }),
    PatchResponse: match.state({
      PlayPatch: {
        branches: [
          {
            when: branch(
              "legal Patch ends match",
              ({ state, event }: PatchPlayArgs) =>
                Match.canPlayPatch(state, event) && patchResult(state, event)._tag === "Finished",
            ),
            target: "Finished",
            reduce: ({ state, event }) => expectFinished(patchResult(state, event)),
          },
          {
            when: branch(
              "legal Patch returns to Bug phase",
              ({ state, event }: PatchPlayArgs) =>
                Match.canPlayPatch(state, event) && patchResult(state, event)._tag === "BugPhase",
            ),
            target: "BugPhase",
            reduce: ({ state, event }) => expectBugPhase(patchResult(state, event)),
          },
          {
            when: branch(
              "legal Patch advances to Side Effect phase",
              ({ state, event }: PatchPlayArgs) =>
                Match.canPlayPatch(state, event) &&
                patchResult(state, event)._tag === "SideEffectPhase",
            ),
            target: "SideEffectPhase",
            reduce: ({ state, event }) => expectSideEffectPhase(patchResult(state, event)),
          },
        ],
      },
      PassPatch: {
        branches: [
          {
            when: branch(
              "defender passes Patch response and match ends",
              ({ state, event }: PatchPassArgs) =>
                event.playerId === Match.opponentOf(state.activePlayer) &&
                patchResult(state)._tag === "Finished",
            ),
            target: "Finished",
            reduce: ({ state }) => expectFinished(patchResult(state)),
          },
          {
            when: branch(
              "defender passes and another Bug play remains",
              ({ state, event }: PatchPassArgs) =>
                event.playerId === Match.opponentOf(state.activePlayer) &&
                patchResult(state)._tag === "BugPhase",
            ),
            target: "BugPhase",
            reduce: ({ state }) => expectBugPhase(patchResult(state)),
          },
          {
            when: branch(
              "defender passes and Side Effect phase begins",
              ({ state, event }: PatchPassArgs) =>
                event.playerId === Match.opponentOf(state.activePlayer) &&
                patchResult(state)._tag === "SideEffectPhase",
            ),
            target: "SideEffectPhase",
            reduce: ({ state }) => expectSideEffectPhase(patchResult(state)),
          },
        ],
      },
      Surrender: {
        target: "Finished",
        reduce: ({ state, event }) => expectFinished(Match.surrender(state, event.playerId)),
      },
    }),
    SideEffectPhase: match.state({
      PlaySideEffect: {
        branches: [
          {
            when: branch(
              "legal Side Effect ends match",
              ({ state, event }: SideEffectPlayArgs) =>
                Match.canPlaySideEffect(state, event) && sideEffectResult(state, event)._tag === "Finished",
            ),
            target: "Finished",
            reduce: ({ state, event }) => expectFinished(sideEffectResult(state, event)),
          },
          {
            when: branch(
              "legal Side Effect starts opponent Bug phase",
              ({ state, event }: SideEffectPlayArgs) =>
                Match.canPlaySideEffect(state, event) && sideEffectResult(state, event)._tag === "BugPhase",
            ),
            target: "BugPhase",
            reduce: ({ state, event }) => expectBugPhase(sideEffectResult(state, event)),
          },
          {
            when: branch(
              "legal Side Effect meets attack prohibition",
              ({ state, event }: SideEffectPlayArgs) =>
                Match.canPlaySideEffect(state, event) &&
                sideEffectResult(state, event)._tag === "SideEffectPhase",
            ),
            target: "SideEffectPhase",
            reduce: ({ state, event }) => expectSideEffectPhase(sideEffectResult(state, event)),
          },
        ],
      },
      PassSideEffect: {
        branches: [
          {
            when: branch(
              "active player passes and end-of-turn processing ends match",
              ({ state, event }: SideEffectPassArgs) =>
                event.playerId === state.activePlayer &&
                passSideEffectResult(state)._tag === "Finished",
            ),
            target: "Finished",
            reduce: ({ state }) => expectFinished(passSideEffectResult(state)),
          },
          {
            when: branch(
              "active player passes and opponent may play a Bug",
              ({ state, event }: SideEffectPassArgs) =>
                event.playerId === state.activePlayer &&
                passSideEffectResult(state)._tag === "BugPhase",
            ),
            target: "BugPhase",
            reduce: ({ state }) => expectBugPhase(passSideEffectResult(state)),
          },
          {
            when: branch(
              "active player passes and opponent attack is prohibited",
              ({ state, event }: SideEffectPassArgs) =>
                event.playerId === state.activePlayer &&
                passSideEffectResult(state)._tag === "SideEffectPhase",
            ),
            target: "SideEffectPhase",
            reduce: ({ state }) => expectSideEffectPhase(passSideEffectResult(state)),
          },
        ],
      },
      Surrender: {
        target: "Finished",
        reduce: ({ state, event }) => expectFinished(Match.surrender(state, event.playerId)),
      },
    }),
    Finished: match.final(),
  },
)

export const MatchMachine = {
  Input: Match.Input,
  State: Match.State,
  Event: Match.Event,
  definition,
} as const
