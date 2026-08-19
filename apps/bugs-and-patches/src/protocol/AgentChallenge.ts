import * as Schema from "effect/Schema"
import * as Identity from "../server/Identity.js"
import { PlayerView } from "./Protocol.js"

const Presence = Schema.Literals(["Connected", "Disconnected"])

export const Lifecycle = Schema.Literals(["Open", "Active", "Expired", "Revoked", "Completed"])
export type Lifecycle = Schema.Schema.Type<typeof Lifecycle>

export const CreatorView = Schema.Struct({
  url: Schema.String,
  expiresAt: Schema.Int,
  status: Lifecycle,
  agent: Schema.NullOr(Identity.AgentPublicIdentity),
  agentPresence: Schema.NullOr(Presence),
})
export type CreatorView = Schema.Schema.Type<typeof CreatorView>

export const OpaqueAction = Schema.Struct({
  actionId: Schema.String,
  label: Schema.String,
  description: Schema.String,
})
export type OpaqueAction = Schema.Schema.Type<typeof OpaqueAction>

export const MatchProjection = Schema.Struct({
  revision: Schema.Int,
  status: Lifecycle,
  view: Schema.NullOr(PlayerView),
  actions: Schema.Array(OpaqueAction),
  agentPresence: Schema.NullOr(Presence),
})
export type MatchProjection = Schema.Schema.Type<typeof MatchProjection>

export const AcceptInput = Schema.Struct({ agent_name: Schema.String })
export type AcceptInput = Schema.Schema.Type<typeof AcceptInput>

export const WaitInput = Schema.Struct({
  after_revision: Schema.optional(Schema.Int),
  timeout_seconds: Schema.optional(Schema.Number),
})
export type WaitInput = Schema.Schema.Type<typeof WaitInput>

export const TakeActionInput = Schema.Struct({ action_id: Schema.String })
export type TakeActionInput = Schema.Schema.Type<typeof TakeActionInput>

export const ErrorCode = Schema.Literals([
  "Unavailable",
  "InvalidAgentName",
  "AlreadyClaimed",
  "NotClaimed",
  "StaleAction",
  "MatchFinished",
  "RateLimited",
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export class ChallengeError extends Schema.TaggedError<ChallengeError>()("ChallengeError", {
  code: ErrorCode,
  message: Schema.String,
}) {}
