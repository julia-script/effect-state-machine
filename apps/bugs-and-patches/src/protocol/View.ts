import type * as Card from "../game/Card.js"
import * as Catalog from "../game/Catalog.js"
import * as Match from "../game/Match.js"
import type * as Identity from "../server/Identity.js"
import type * as Protocol from "./Protocol.js"

export interface ProjectionOptions {
  readonly matchId: string
  readonly mode: Protocol.PlayerView["mode"]
  readonly viewer: Card.PlayerId
  readonly presence: Readonly<Record<Card.PlayerId, Protocol.Presence>>
  readonly identities: Readonly<Record<Card.PlayerId, Identity.PublicIdentity>>
  readonly forfeitLoser?: Card.PlayerId
}

const cardActions = (
  state: Match.State,
  viewer: Card.PlayerId,
): ReadonlyArray<Protocol.LegalAction> => {
  const owner = Match.player(state, viewer)
  if (owner === undefined || state._tag === "Finished") return []
  return owner.hand.flatMap((instance) => {
    const card = Catalog.find(instance.cardId)
    if (card === undefined) return []
    const action =
      card._tag === "Bug" ? "PlayBug" : card._tag === "Patch" ? "PlayPatch" : "PlaySideEffect"
    const phaseAllows =
      (state._tag === "BugPhase" && card._tag === "Bug" && state.activePlayer === viewer) ||
      (state._tag === "PatchResponse" && card._tag === "Patch" && state.activePlayer !== viewer) ||
      (state._tag === "SideEffectPhase" && card._tag === "SideEffect" && state.activePlayer === viewer)
    const reason = phaseAllows ? null : "This card cannot be played in the current phase."
    return [{ action, cardInstanceId: instance.id, enabled: reason === null, reason }]
  })
}

const passActions = (
  state: Match.State,
  viewer: Card.PlayerId,
): ReadonlyArray<Protocol.LegalAction> => {
  if (state._tag === "Finished") return []
  const action =
    state._tag === "BugPhase" && state.activePlayer === viewer
      ? "PassBug"
      : state._tag === "PatchResponse" && state.activePlayer !== viewer
        ? "PassPatch"
        : state._tag === "SideEffectPhase" && state.activePlayer === viewer
          ? "PassSideEffect"
          : undefined
  return action === undefined ? [] : [{ action, cardInstanceId: null, enabled: true, reason: null }]
}

export const project = (state: Match.State, options: ProjectionOptions): Protocol.PlayerView => {
  const owner = Match.player(state, options.viewer)
  const visible = (instance: Card.CardInstance | null) => {
    if (instance === null) return null
    const card = Catalog.find(instance.cardId)
    return card === undefined ? null : { instance, card }
  }
  return {
    matchId: options.matchId,
    mode: options.mode,
    viewer: options.viewer,
    phase: state._tag,
    turn: state.turn,
    activePlayer: state.activePlayer,
    players: state.players.map((candidate) => ({
      id: candidate.id,
      identity: options.identities[candidate.id],
      uptime: candidate.uptime,
      handCount: candidate.hand.length,
      deckCount: candidate.deck.length,
      discardCount: candidate.discard.length,
      conditions: candidate.conditions,
      ongoing: candidate.ongoing,
      presence: options.presence[candidate.id],
    })),
    hand: (owner?.hand ?? []).flatMap((instance) => {
      const card = Catalog.find(instance.cardId)
      return card === undefined ? [] : [{ instance, card }]
    }),
    lastBug: visible(state.lastBug),
    lastPatch: visible(state.lastPatch),
    legalActions: [
      ...cardActions(state, options.viewer),
      ...passActions(state, options.viewer),
      ...(state._tag === "Finished"
        ? []
        : [{ action: "Surrender" as const, cardInstanceId: null, enabled: true, reason: null }]),
    ],
    outcome:
      state._tag === "Finished"
        ? {
            winner: state.winner,
            loser: state.loser,
            reason: options.forfeitLoser === state.loser ? "Forfeit" : state.reason,
          }
        : null,
  }
}
