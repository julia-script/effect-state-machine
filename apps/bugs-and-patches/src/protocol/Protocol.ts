import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Card from "../game/Card.js"
import * as Match from "../game/Match.js"
import * as Identity from "../server/Identity.js"

export const PATH = "/game"
export const path = PATH

export const Presence = Schema.Literals(["Connected", "Disconnected"])
export type Presence = Schema.Schema.Type<typeof Presence>

export const LegalAction = Schema.Struct({
  action: Schema.Literals([
    "PlayBug",
    "PassBug",
    "PlayPatch",
    "PassPatch",
    "PlaySideEffect",
    "PassSideEffect",
    "Surrender",
  ]),
  cardInstanceId: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
})
export type LegalAction = Schema.Schema.Type<typeof LegalAction>

export const PublicPlayer = Schema.Struct({
  id: Card.PlayerId,
  identity: Identity.PublicIdentity,
  uptime: Schema.Int,
  handCount: Schema.Int,
  deckCount: Schema.Int,
  discardCount: Schema.Int,
  conditions: Schema.Array(Match.Condition),
  ongoing: Schema.Array(Match.OngoingAbility),
  presence: Presence,
})

export const VisibleCard = Schema.Struct({
  instance: Card.CardInstance,
  card: Card.Card,
})

export const PlayerView = Schema.Struct({
  matchId: Schema.String,
  mode: Identity.MatchMode,
  viewer: Card.PlayerId,
  phase: Schema.Literals(["Waiting", "BugPhase", "PatchResponse", "SideEffectPhase", "Finished"]),
  turn: Schema.Int,
  activePlayer: Schema.NullOr(Card.PlayerId),
  players: Schema.Array(PublicPlayer),
  hand: Schema.Array(VisibleCard),
  lastBug: Schema.NullOr(VisibleCard),
  lastPatch: Schema.NullOr(VisibleCard),
  legalActions: Schema.Array(LegalAction),
  outcome: Schema.NullOr(
    Schema.Struct({
      winner: Card.PlayerId,
      loser: Card.PlayerId,
      reason: Identity.RankedResultReason,
    }),
  ),
})
export type PlayerView = Schema.Schema.Type<typeof PlayerView>

export const AgentChallengeLifecycle = Schema.Literals([
  "Open",
  "Active",
  "Expired",
  "Revoked",
  "Completed",
])

export const AgentChallengeCreatorView = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.Int,
  status: AgentChallengeLifecycle,
  agent: Schema.NullOr(Identity.AgentPublicIdentity),
  agentPresence: Schema.NullOr(Presence),
})
export type AgentChallengeCreatorView = Schema.Schema.Type<typeof AgentChallengeCreatorView>

export const ClientMessage = Schema.Union([
  Schema.TaggedStruct("CreateFriendly", {}),
  Schema.TaggedStruct("CreateAgentChallenge", {}),
  Schema.TaggedStruct("RevokeAgentChallenge", {}),
  Schema.TaggedStruct("JoinFriendly", { inviteCode: Schema.String }),
  Schema.TaggedStruct("JoinRankedQueue", {}),
  Schema.TaggedStruct("LeaveRankedQueue", {}),
  Schema.TaggedStruct("Reconnect", { matchId: Schema.String, seatToken: Schema.String }),
  Schema.TaggedStruct("Command", { requestId: Schema.String, event: Match.Event }),
]).pipe(Schema.toTaggedUnion("_tag"))
export type ClientMessage = Schema.Schema.Type<typeof ClientMessage>

export const RejectionCode = Schema.Literals([
  "InvalidMessage",
  "NotAuthenticated",
  "MatchNotFound",
  "MatchFull",
  "InvalidToken",
  "WrongActor",
  "IllegalAction",
  "WaitingForOpponent",
  "CannotJoinOwnMatch",
  "AlreadyQueued",
  "NotQueued",
  "PersistenceFailed",
  "AccountRetired",
  "ChallengeUnavailable",
  "InvalidAgentName",
  "ChallengeAlreadyClaimed",
  "RateLimited",
])
export type RejectionCode = Schema.Schema.Type<typeof RejectionCode>

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("FriendlyCreated", {
    matchId: Schema.String,
    inviteCode: Schema.String,
    seatToken: Schema.String,
    playerId: Card.PlayerId,
  }),
  Schema.TaggedStruct("AgentChallengeCreated", {
    matchId: Schema.String,
    seatToken: Schema.String,
    playerId: Card.PlayerId,
    challenge: AgentChallengeCreatorView,
  }),
  Schema.TaggedStruct("AgentChallengeUpdated", {
    challenge: AgentChallengeCreatorView,
  }),
  Schema.TaggedStruct("Joined", {
    matchId: Schema.String,
    seatToken: Schema.String,
    playerId: Card.PlayerId,
  }),
  Schema.TaggedStruct("Waiting", { queue: Schema.Literal("Ranked") }),
  Schema.TaggedStruct("LeftQueue", { queue: Schema.Literal("Ranked") }),
  Schema.TaggedStruct("Matched", {
    matchId: Schema.String,
    seatToken: Schema.String,
    playerId: Card.PlayerId,
  }),
  Schema.TaggedStruct("View", { view: PlayerView }),
  Schema.TaggedStruct("Acknowledged", { requestId: Schema.String, view: PlayerView }),
  Schema.TaggedStruct("Rejected", {
    requestId: Schema.NullOr(Schema.String),
    code: RejectionCode,
    message: Schema.String,
    view: Schema.NullOr(PlayerView),
  }),
]).pipe(Schema.toTaggedUnion("_tag"))
export type ServerMessage = Schema.Schema.Type<typeof ServerMessage>

const ClientJson = Schema.fromJsonString(ClientMessage)
const ServerJson = Schema.fromJsonString(ServerMessage)

export const decodeClient = Effect.fn("Protocol.decodeClient")((text: string) =>
  Schema.decodeEffect(ClientJson)(text),
)

export const encodeServer = Effect.fn("Protocol.encodeServer")((message: ServerMessage) =>
  Schema.encodeEffect(ServerJson)(message),
)

export const encodeClient = Effect.fn("Protocol.encodeClient")((message: ClientMessage) =>
  Schema.encodeEffect(ClientJson)(message),
)

export const decodeServer = Effect.fn("Protocol.decodeServer")((text: string) =>
  Schema.decodeEffect(ServerJson)(text),
)
