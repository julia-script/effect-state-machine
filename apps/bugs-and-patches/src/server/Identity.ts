import * as Schema from "effect/Schema"

export const MatchMode = Schema.Literals(["Friendly", "Ranked"])
export type MatchMode = Schema.Schema.Type<typeof MatchMode>

export const GitHubIdentity = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.String,
  profileUrl: Schema.String,
})
export type GitHubIdentity = Schema.Schema.Type<typeof GitHubIdentity>

export const Player = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  anonymous: Schema.Boolean,
  github: GitHubIdentity,
  rating: Schema.Int,
  wins: Schema.Int,
  losses: Schema.Int,
  games: Schema.Int,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
})
export type Player = Schema.Schema.Type<typeof Player>

export const AccountPublicIdentity = Schema.Struct({
  kind: Schema.Literal("Account"),
  displayName: Schema.String,
  github: Schema.NullOr(GitHubIdentity),
})
export type AccountPublicIdentity = Schema.Schema.Type<typeof AccountPublicIdentity>

export const AgentPublicIdentity = Schema.Struct({
  kind: Schema.Literal("Agent"),
  displayName: Schema.String,
  github: Schema.Null,
})
export type AgentPublicIdentity = Schema.Schema.Type<typeof AgentPublicIdentity>

export const PublicIdentity = Schema.Union([AccountPublicIdentity, AgentPublicIdentity])
export type PublicIdentity = Schema.Schema.Type<typeof PublicIdentity>

export const SelfProfile = Player
export type SelfProfile = Player

export const GitHubProfile = Schema.Struct({
  githubId: Schema.String,
  login: Schema.String,
  avatarUrl: Schema.String,
  profileUrl: Schema.String,
})
export type GitHubProfile = Schema.Schema.Type<typeof GitHubProfile>

export const AppSession = Schema.Struct({
  tokenDigest: Schema.String,
  playerId: Schema.String,
  expiresAt: Schema.Int,
  createdAt: Schema.Int,
})
export type AppSession = Schema.Schema.Type<typeof AppSession>

export const RankedResultReason = Schema.Literals(["Uptime", "Surrender", "Forfeit"])
export type RankedResultReason = Schema.Schema.Type<typeof RankedResultReason>

export const RankedResult = Schema.Struct({
  matchId: Schema.String,
  winnerId: Schema.String,
  loserId: Schema.String,
  reason: RankedResultReason,
  winnerRatingBefore: Schema.Int,
  loserRatingBefore: Schema.Int,
  winnerRatingAfter: Schema.Int,
  loserRatingAfter: Schema.Int,
  completedAt: Schema.Int,
})
export type RankedResult = Schema.Schema.Type<typeof RankedResult>

export const LeaderboardRow = Schema.Struct({
  rank: Schema.Int,
  identity: PublicIdentity,
  rating: Schema.Int,
  wins: Schema.Int,
  losses: Schema.Int,
  games: Schema.Int,
})
export type LeaderboardRow = Schema.Schema.Type<typeof LeaderboardRow>

export const LeaderboardResponse = Schema.Struct({
  title: Schema.String,
  subtitle: Schema.String,
  rows: Schema.Array(LeaderboardRow),
})
export type LeaderboardResponse = Schema.Schema.Type<typeof LeaderboardResponse>

export const UpdateProfileRequest = Schema.Struct({
  displayName: Schema.String,
  anonymous: Schema.Boolean,
})
export type UpdateProfileRequest = Schema.Schema.Type<typeof UpdateProfileRequest>

export const DeleteAccountRequest = Schema.Struct({
  confirmation: Schema.Literal("DELETE"),
})
export type DeleteAccountRequest = Schema.Schema.Type<typeof DeleteAccountRequest>

const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })

export const normalizeDisplayName = (value: string): string | undefined => {
  const displayName = value.trim()
  return displayName.length >= 2 && displayName.length <= 24 && !hasControlCharacter(displayName)
    ? displayName
    : undefined
}

export const defaultDisplayName = (login: string): string => {
  const candidate = login.trim().slice(0, 24)
  return candidate.length >= 2 ? candidate : `${candidate || "dev"}_`.slice(0, 24)
}

export const publicIdentity = (player: Player): PublicIdentity => ({
  kind: "Account",
  displayName: player.displayName,
  github: player.anonymous ? null : player.github,
})

export const agentIdentity = (displayName: string): AgentPublicIdentity => ({
  kind: "Agent",
  displayName,
  github: null,
})

export const retiredIdentity = (): PublicIdentity => ({
  kind: "Account",
  displayName: "Deleted player",
  github: null,
})

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  operation: Schema.String,
  message: Schema.String,
}) {}

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  { message: Schema.String },
) {}

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "AuthenticationError",
  { code: Schema.String, message: Schema.String },
) {}
