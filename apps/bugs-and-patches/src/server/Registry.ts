import { createHash, createHmac, randomBytes } from "node:crypto"
import { Attach, Transport, WebSocketTransport } from "@effect-state-machine/studio-client"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import type * as Machine from "effect-state-machine/Machine"
import * as MachineEngine from "effect-state-machine/MachineEngine"
import type * as Card from "../game/Card.js"
import * as Match from "../game/Match.js"
import { definition } from "../game/MatchMachine.js"
import * as AgentChallenge from "../protocol/AgentChallenge.js"
import type * as Protocol from "../protocol/Protocol.js"
import * as View from "../protocol/View.js"
import * as Identity from "./Identity.js"
import { type RankedCompletion, Storage } from "./Storage.js"

type Send = (message: Protocol.ServerMessage) => Effect.Effect<void>
type Handle = Machine.MachineHandle<
  Match.State,
  Match.Event,
  Extract<Match.State, { readonly _tag: "Finished" }>
>

const infallibleHandle = <Error>(
  handle: Machine.MachineHandle<
    Match.State,
    Match.Event,
    Extract<Match.State, { readonly _tag: "Finished" }>,
    Error
  >,
): Handle => ({
  ...handle,
  snapshot: handle.snapshot.pipe(Effect.orDie),
  changes: handle.changes.pipe(Stream.orDie),
  completion: handle.completion.pipe(Effect.orDie),
  send: (event, options) => handle.send(event, options).pipe(Effect.orDie),
  can: (event) => handle.can(event).pipe(Effect.orDie),
  status: handle.status.pipe(Effect.orDie),
})

export interface AccountOwner {
  readonly _tag: "Account"
  readonly player: Identity.Player
}

export interface AgentOwner {
  readonly _tag: "Agent"
  readonly challengeDigest: string
  readonly publicIdentity: Identity.AgentPublicIdentity
}

export type ParticipantOwner = AccountOwner | AgentOwner

interface WaitingMatch {
  readonly _tag: "Waiting"
  readonly matchId: string
  readonly inviteCode: string
  readonly createdAt: number
  readonly playerOneToken: string
  readonly playerOne: AccountOwner
  readonly senders: Map<Card.PlayerId, Send>
  readonly presence: Record<Card.PlayerId, Protocol.Presence>
}

interface ActiveMatch extends Omit<WaitingMatch, "_tag" | "inviteCode"> {
  readonly _tag: "Active"
  readonly mode: Identity.MatchMode
  readonly playerTwoToken: string
  readonly owners: Readonly<Record<Card.PlayerId, ParticipantOwner>>
  readonly handle: Handle
  readonly mutex: Semaphore.Semaphore
  readonly scope: Scope.Closeable
  readonly disconnectFibers: Map<Card.PlayerId, Fiber.Fiber<void>>
  forfeitLoser?: Card.PlayerId
}

type Entry = WaitingMatch | ActiveMatch

interface QueueEntry {
  readonly player: Identity.Player
  readonly matched: (seat: Seat) => Effect.Effect<void, never, Scope.Scope>
}

export interface Seat {
  readonly matchId: string
  readonly seatToken: string
  readonly playerId: Card.PlayerId
  readonly accountId: string
}

interface ChallengeEntry {
  readonly digest: string
  readonly creatorId: string
  readonly matchId: string
  readonly createdAt: number
  readonly expiresAt: number
  status: AgentChallenge.Lifecycle
  agent: AgentOwner | undefined
  revision: number
  actionRevision: number
  readonly actions: Map<string, Match.Event>
  readonly waiters: Set<() => void>
  presenceFiber: Fiber.Fiber<void> | undefined
}

export interface AgentChallengeCreated extends Seat {
  readonly challenge: Protocol.AgentChallengeCreatorView
}

export type Result<A> =
  | Readonly<{ _tag: "Accepted"; value: A }>
  | Readonly<{ _tag: "Rejected"; code: Protocol.RejectionCode; message: string }>

export type QueueResult = Result<
  Readonly<{ _tag: "Waiting" }> | Readonly<{ _tag: "Matched"; seat: Seat }>
>

const accepted = <A>(value: A): Result<A> => ({ _tag: "Accepted", value })
const rejected = (code: Protocol.RejectionCode, message: string): Result<never> => ({
  _tag: "Rejected",
  code,
  message,
})

export interface RegistryShape {
  readonly createFriendly: (
    player: Identity.Player,
  ) => Effect.Effect<Result<Seat & { readonly inviteCode: string }>>
  readonly joinFriendly: (
    player: Identity.Player,
    inviteCode: string,
  ) => Effect.Effect<Result<Seat>>
  readonly createAgentChallenge: (
    player: Identity.Player,
  ) => Effect.Effect<Result<AgentChallengeCreated>>
  readonly inspectAgentChallenge: (
    accountId: string,
  ) => Effect.Effect<Result<Protocol.AgentChallengeCreatorView>>
  readonly revokeAgentChallenge: (
    accountId: string,
  ) => Effect.Effect<Result<Protocol.AgentChallengeCreatorView>>
  readonly challengeInfo: (
    capability: string,
  ) => Effect.Effect<Result<Readonly<{ status: AgentChallenge.Lifecycle; expiresAt: number }>>>
  readonly acceptAgentChallenge: (
    capability: string,
    agentName: string,
  ) => Effect.Effect<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError>
  readonly agentProjection: (
    capability: string,
  ) => Effect.Effect<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError>
  readonly waitForAgentTurn: (
    capability: string,
    afterRevision: number | undefined,
    timeoutMs: number,
  ) => Effect.Effect<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError>
  readonly takeAgentAction: (
    capability: string,
    actionId: string,
  ) => Effect.Effect<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError>
  readonly surrenderAgent: (
    capability: string,
  ) => Effect.Effect<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError>
  readonly joinRanked: (
    player: Identity.Player,
    matched: (seat: Seat) => Effect.Effect<void, never, Scope.Scope>,
  ) => Effect.Effect<QueueResult, never, Scope.Scope>
  readonly leaveRanked: (accountId: string) => Effect.Effect<Result<void>>
  readonly reconnect: (
    accountId: string,
    matchId: string,
    token: string,
  ) => Effect.Effect<Result<Seat>>
  readonly subscribe: (seat: Seat, send: Send) => Effect.Effect<void, never, Scope.Scope>
  readonly command: (seat: Seat, event: Match.Event) => Effect.Effect<Result<Protocol.PlayerView>>
  readonly view: (seat: Seat) => Effect.Effect<Result<Protocol.PlayerView>>
  readonly retire: (accountId: string) => Effect.Effect<Result<void>, Identity.StorageError>
}

export class Registry extends Context.Service<Registry, RegistryShape>()(
  "@bugs-and-patches/Registry",
) {}

const token = () => crypto.randomUUID()
const code = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()
const publicIdentity = Identity.publicIdentity

export interface Options {
  readonly disconnectGraceMs?: number
  readonly challengeOrigin?: string
  readonly challengeLifetimeMs?: number
  readonly agentPresenceMs?: number
  readonly now?: () => number
}

const make = (options?: Options) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const machineEngine = yield* MachineEngine.MachineEngine
    const registryMutex = yield* Semaphore.make(1)
    const entries = new Map<string, Entry>()
    const queue = new Map<string, QueueEntry>()
    const retiredAccounts = new Set<string>()
    const disconnectGraceMs = options?.disconnectGraceMs ?? 60_000
    const challengeOrigin = options?.challengeOrigin ?? "http://127.0.0.1:4788"
    const challengeLifetimeMs = options?.challengeLifetimeMs ?? 10 * 60 * 1_000
    const agentPresenceMs = options?.agentPresenceMs ?? 45_000
    const now = options?.now ?? Date.now
    const challengeSecret = randomBytes(32)
    const challenges = new Map<string, ChallengeEntry>()
    const creatorChallenges = new Map<string, string>()
    const matchChallenges = new Map<string, string>()

    const accountOwner = (player: Identity.Player): AccountOwner => ({ _tag: "Account", player })
    const ownerAccountId = (owner: ParticipantOwner): string | undefined =>
      owner._tag === "Account" ? owner.player.id : undefined
    const ownerIdentity = (owner: ParticipantOwner): Identity.PublicIdentity =>
      owner._tag === "Account"
        ? retiredAccounts.has(owner.player.id)
          ? Identity.retiredIdentity()
          : publicIdentity(owner.player)
        : owner.publicIdentity

    const capabilityFor = (entry: Pick<ChallengeEntry, "creatorId" | "matchId" | "createdAt">) =>
      createHmac("sha256", challengeSecret)
        .update(`${entry.creatorId}:${entry.matchId}:${entry.createdAt}`)
        .digest("base64url")
    const digestCapability = (capability: string) =>
      createHash("sha256").update(capability).digest("hex")
    const challengeUrl = (entry: ChallengeEntry) =>
      `${challengeOrigin}/challenge/${capabilityFor(entry)}`
    const wakeChallenge = (challenge: ChallengeEntry) => {
      challenge.revision += 1
      challenge.actionRevision = -1
      challenge.actions.clear()
      for (const wake of challenge.waiters) wake()
      challenge.waiters.clear()
    }
    const unavailable = (message = "This agent challenge is unavailable.") =>
      new AgentChallenge.ChallengeError({ code: "Unavailable", message })

    const expireChallenge = (challenge: ChallengeEntry, currentTime = now()) => {
      if (challenge.status !== "Open" || challenge.expiresAt > currentTime) return false
      challenge.status = "Expired"
      creatorChallenges.delete(challenge.creatorId)
      entries.delete(challenge.matchId)
      wakeChallenge(challenge)
      return true
    }

    const challengeCreatorView = (
      challenge: ChallengeEntry,
    ): Protocol.AgentChallengeCreatorView => ({
      url: challengeUrl(challenge),
      expiresAt: challenge.expiresAt,
      status: challenge.status,
      agent: challenge.agent?.publicIdentity ?? null,
      agentPresence:
        challenge.agent === undefined
          ? null
          : (entries.get(challenge.matchId)?.presence["player-two"] ?? "Disconnected"),
    })

    const cleanup = () => {
      const cutoff = Date.now() - 60 * 60 * 1_000
      for (const [matchId, entry] of entries) {
        if (entry.createdAt < cutoff && entry._tag === "Waiting") entries.delete(matchId)
      }
    }

    const get = (matchId: string) =>
      registryMutex.withPermits(1)(
        Effect.sync(() => {
          cleanup()
          return entries.get(matchId)
        }),
      )

    const project = Effect.fn("Registry.project")(function* (
      entry: ActiveMatch,
      viewer: Card.PlayerId,
    ) {
      const state = yield* entry.handle.snapshot
      return View.project(state, {
        matchId: entry.matchId,
        mode: entry.mode,
        viewer,
        presence: entry.presence,
        identities: {
          "player-one": ownerIdentity(entry.owners["player-one"]),
          "player-two": ownerIdentity(entry.owners["player-two"]),
        },
        forfeitLoser: entry.forfeitLoser,
      })
    })

    const broadcast = Effect.fn("Registry.broadcast")(function* (entry: ActiveMatch) {
      for (const [viewer, send] of entry.senders) {
        yield* send({ _tag: "View", view: yield* project(entry, viewer) }).pipe(
          Effect.catch(() => Effect.void),
        )
      }
    })

    const persistFinished = Effect.fn("Registry.persistFinished")(function* (
      entry: ActiveMatch,
      state: Match.State,
    ) {
      if (entry.mode !== "Ranked" || state._tag !== "Finished") return
      const winner = entry.owners[state.winner]
      const loser = entry.owners[state.loser]
      if (winner._tag !== "Account" || loser._tag !== "Account") return
      yield* storage.applyRankedResult({
        matchId: entry.matchId,
        winnerId: winner.player.id,
        loserId: loser.player.id,
        reason: entry.forfeitLoser === state.loser ? "Forfeit" : state.reason,
        completedAt: Date.now(),
      })
    })

    const attachStudio = Effect.fn("Registry.attachStudio")(function* (entry: ActiveMatch) {
      if (process.env.BUGS_PATCHES_STUDIO !== "1") return
      yield* Attach.attach({
        definition,
        handle: entry.handle,
        appName: "bugs-and-patches-v0",
        instanceKey: `bugs-and-patches:${entry.matchId}`,
      }).pipe(
        Effect.provideService(
          Transport.StudioTransport,
          WebSocketTransport.make({ url: process.env.BUGS_PATCHES_STUDIO_URL }),
        ),
        Effect.provideService(Scope.Scope, entry.scope),
      )
    })

    const activate = Effect.fn("Registry.activate")(function* (
      waiting: WaitingMatch,
      playerTwo: ParticipantOwner,
      mode: Identity.MatchMode,
    ) {
      const scope = yield* Scope.make()
      const handle = yield* definition
        .run(Match.defaultInput(Date.now()))
        .pipe(
          Effect.provideService(MachineEngine.MachineEngine, machineEngine),
          Effect.provideService(Scope.Scope, scope),
          Effect.orDie,
          Effect.map(infallibleHandle),
        )
      const active: ActiveMatch = {
        _tag: "Active",
        matchId: waiting.matchId,
        createdAt: waiting.createdAt,
        playerOneToken: waiting.playerOneToken,
        playerOne: waiting.playerOne,
        senders: waiting.senders,
        presence: waiting.presence,
        mode,
        playerTwoToken: token(),
        owners: { "player-one": waiting.playerOne, "player-two": playerTwo },
        handle,
        mutex: yield* Semaphore.make(1),
        scope,
        disconnectFibers: new Map(),
      }
      entries.set(active.matchId, active)
      yield* attachStudio(active)
      return active
    })

    const createWaiting = (player: Identity.Player): WaitingMatch => {
      let matchId = code()
      while (entries.has(matchId)) matchId = code()
      return {
        _tag: "Waiting",
        matchId,
        inviteCode: matchId,
        createdAt: Date.now(),
        playerOneToken: token(),
        playerOne: accountOwner(player),
        senders: new Map(),
        presence: { "player-one": "Disconnected", "player-two": "Disconnected" },
      }
    }

    const createFriendly = (player: Identity.Player) =>
      registryMutex.withPermits(1)(
        Effect.sync(() => {
          if (retiredAccounts.has(player.id))
            return rejected("AccountRetired", "This player account is no longer active.")
          cleanup()
          const waiting = createWaiting(player)
          entries.set(waiting.matchId, waiting)
          return accepted({
            matchId: waiting.matchId,
            inviteCode: waiting.inviteCode,
            seatToken: waiting.playerOneToken,
            playerId: "player-one" as const,
            accountId: player.id,
          })
        }),
      )

    const createAgentChallenge = Effect.fn("Registry.createAgentChallenge")(function* (
      player: Identity.Player,
    ): Effect.fn.Return<Result<AgentChallengeCreated>> {
      return yield* registryMutex.withPermits(1)(
        Effect.sync(() => {
          if (retiredAccounts.has(player.id))
            return rejected("AccountRetired", "This player account is no longer active.")
          const existingDigest = creatorChallenges.get(player.id)
          const existing = existingDigest === undefined ? undefined : challenges.get(existingDigest)
          if (existing !== undefined && !expireChallenge(existing)) {
            const waiting = entries.get(existing.matchId)
            if (existing.status === "Open" && waiting?._tag === "Waiting") {
              return accepted({
                matchId: waiting.matchId,
                seatToken: waiting.playerOneToken,
                playerId: "player-one" as const,
                accountId: player.id,
                challenge: challengeCreatorView(existing),
              })
            }
          }

          const waiting = createWaiting(player)
          const seed = {
            creatorId: player.id,
            matchId: waiting.matchId,
            createdAt: now(),
          }
          const capability = capabilityFor(seed)
          const digest = digestCapability(capability)
          const challenge: ChallengeEntry = {
            ...seed,
            digest,
            expiresAt: seed.createdAt + challengeLifetimeMs,
            status: "Open",
            agent: undefined,
            revision: 0,
            actionRevision: -1,
            actions: new Map(),
            waiters: new Set(),
            presenceFiber: undefined,
          }
          entries.set(waiting.matchId, waiting)
          challenges.set(digest, challenge)
          creatorChallenges.set(player.id, digest)
          matchChallenges.set(waiting.matchId, digest)
          return accepted({
            matchId: waiting.matchId,
            seatToken: waiting.playerOneToken,
            playerId: "player-one" as const,
            accountId: player.id,
            challenge: challengeCreatorView(challenge),
          })
        }),
      )
    })

    const revokeAgentChallenge = (accountId: string) =>
      registryMutex.withPermits(1)(
        Effect.sync(() => {
          const digest = creatorChallenges.get(accountId)
          const challenge = digest === undefined ? undefined : challenges.get(digest)
          if (challenge === undefined || expireChallenge(challenge) || challenge.status !== "Open")
            return rejected("ChallengeUnavailable", "There is no open agent challenge to revoke.")
          challenge.status = "Revoked"
          creatorChallenges.delete(accountId)
          entries.delete(challenge.matchId)
          wakeChallenge(challenge)
          return accepted(challengeCreatorView(challenge))
        }),
      )

    const inspectAgentChallenge = (accountId: string) =>
      registryMutex.withPermits(1)(
        Effect.sync(() => {
          const digest = creatorChallenges.get(accountId)
          const challenge = digest === undefined ? undefined : challenges.get(digest)
          if (challenge === undefined || expireChallenge(challenge))
            return rejected("ChallengeUnavailable", "There is no current agent challenge.")
          return accepted(challengeCreatorView(challenge))
        }),
      )

    const resolveChallenge = (capability: string): ChallengeEntry | undefined => {
      const challenge = challenges.get(digestCapability(capability))
      if (challenge === undefined || capabilityFor(challenge) !== capability) return undefined
      expireChallenge(challenge)
      return challenge
    }

    const challengeInfo = (capability: string) =>
      registryMutex.withPermits(1)(
        Effect.sync(() => {
          const challenge = resolveChallenge(capability)
          return challenge === undefined ||
            challenge.status === "Expired" ||
            challenge.status === "Revoked"
            ? rejected("ChallengeUnavailable", "This agent challenge is unavailable.")
            : accepted({ status: challenge.status, expiresAt: challenge.expiresAt })
        }),
      )

    const eventFor = (
      legal: Protocol.LegalAction,
      playerId: Card.PlayerId,
    ): Match.Event | undefined => {
      if (!legal.enabled || legal.action === "Surrender") return undefined
      if (
        legal.action === "PlayBug" ||
        legal.action === "PlayPatch" ||
        legal.action === "PlaySideEffect"
      ) {
        return legal.cardInstanceId === null
          ? undefined
          : { _tag: legal.action, playerId, cardInstanceId: legal.cardInstanceId }
      }
      return { _tag: legal.action, playerId }
    }

    const actionLabel = (view: Protocol.PlayerView, legal: Protocol.LegalAction) => {
      if (legal.cardInstanceId === null) return legal.action.replace(/^Pass/u, "Pass ")
      const card = view.hand.find(({ instance }) => instance.id === legal.cardInstanceId)?.card
      return card === undefined
        ? legal.action
        : `${legal.action.replace(/^Play/u, "Play ")}: ${card.name}`
    }

    const syncChallengeOutcome = (challenge: ChallengeEntry, view: Protocol.PlayerView) => {
      if (view.phase === "Finished" && challenge.status !== "Completed") {
        challenge.status = "Completed"
        wakeChallenge(challenge)
      }
    }

    const projectAgent = Effect.fn("Registry.projectAgent")(function* (
      challenge: ChallengeEntry,
      entry: ActiveMatch,
    ) {
      const view = yield* project(entry, "player-two")
      syncChallengeOutcome(challenge, view)
      if (challenge.actionRevision !== challenge.revision) {
        challenge.actions.clear()
        if (challenge.status === "Active") {
          for (const legal of view.legalActions) {
            const event = eventFor(legal, "player-two")
            if (event === undefined) continue
            challenge.actions.set(crypto.randomUUID(), event)
          }
        }
        challenge.actionRevision = challenge.revision
      }
      const actions = [...challenge.actions].map(([actionId, event]) => {
        const legal = view.legalActions.find(
          (candidate) =>
            candidate.action === event._tag &&
            candidate.cardInstanceId === ("cardInstanceId" in event ? event.cardInstanceId : null),
        )
        return {
          actionId,
          label: legal === undefined ? event._tag : actionLabel(view, legal),
          description: legal?.reason ?? "Apply this current legal game action.",
        }
      })
      return {
        revision: challenge.revision,
        status: challenge.status,
        view,
        actions,
        agentPresence: entry.presence["player-two"],
      } satisfies AgentChallenge.MatchProjection
    })

    const refreshAgentPresence = Effect.fn("Registry.refreshAgentPresence")(function* (
      challenge: ChallengeEntry,
      entry: ActiveMatch,
    ) {
      const previous = challenge.presenceFiber
      if (previous !== undefined) yield* Fiber.interrupt(previous)
      const changed = entry.presence["player-two"] !== "Connected"
      entry.presence["player-two"] = "Connected"
      if (changed) yield* broadcast(entry)
      challenge.presenceFiber = yield* Effect.gen(function* () {
        yield* Effect.sleep(agentPresenceMs)
        yield* entry.mutex.withPermits(1)(
          Effect.gen(function* () {
            if (challenge.status !== "Active") return
            entry.presence["player-two"] = "Disconnected"
            yield* broadcast(entry)
          }),
        )
      }).pipe(Effect.forkIn(entry.scope))
    })

    const activeAgent = (
      challenge: ChallengeEntry,
    ): Effect.Effect<ActiveMatch, AgentChallenge.ChallengeError> => {
      if (challenge.status !== "Active" && challenge.status !== "Completed")
        return Effect.fail(unavailable())
      const entry = entries.get(challenge.matchId)
      if (
        entry?._tag !== "Active" ||
        entry.owners["player-two"]._tag !== "Agent" ||
        entry.owners["player-two"].challengeDigest !== challenge.digest
      )
        return Effect.fail(unavailable())
      return Effect.succeed(entry)
    }

    const acceptAgentChallenge = Effect.fn("Registry.acceptAgentChallenge")(function* (
      capability: string,
      agentName: string,
    ): Effect.fn.Return<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError> {
      const displayName = Identity.normalizeDisplayName(agentName)
      if (displayName === undefined)
        return yield* Effect.fail(
          new AgentChallenge.ChallengeError({
            code: "InvalidAgentName",
            message: "Agent name must be 2-24 characters without control characters.",
          }),
        )
      const claimed = yield* registryMutex.withPermits(1)(
        Effect.gen(function* () {
          const challenge = resolveChallenge(capability)
          if (
            challenge === undefined ||
            challenge.status === "Expired" ||
            challenge.status === "Revoked"
          )
            return yield* Effect.fail(unavailable())
          if (challenge.status !== "Open")
            return yield* Effect.fail(
              new AgentChallenge.ChallengeError({
                code: "AlreadyClaimed",
                message: "This agent challenge has already been claimed.",
              }),
            )
          const waiting = entries.get(challenge.matchId)
          if (waiting?._tag !== "Waiting") return yield* Effect.fail(unavailable())
          const agent: AgentOwner = {
            _tag: "Agent",
            challengeDigest: challenge.digest,
            publicIdentity: Identity.agentIdentity(displayName),
          }
          const active = yield* activate(waiting, agent, "Friendly")
          challenge.agent = agent
          challenge.status = "Active"
          challenge.revision = 1
          challenge.actionRevision = -1
          active.presence["player-two"] = "Connected"
          return { challenge, active }
        }),
      )
      yield* refreshAgentPresence(claimed.challenge, claimed.active)
      yield* broadcast(claimed.active)
      return yield* projectAgent(claimed.challenge, claimed.active)
    })

    const agentProjection = Effect.fn("Registry.agentProjection")(function* (
      capability: string,
    ): Effect.fn.Return<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError> {
      const challenge = resolveChallenge(capability)
      if (challenge === undefined) return yield* Effect.fail(unavailable())
      const entry = yield* activeAgent(challenge)
      yield* refreshAgentPresence(challenge, entry)
      return yield* entry.mutex.withPermits(1)(projectAgent(challenge, entry))
    })

    const waitForAgentTurn = Effect.fn("Registry.waitForAgentTurn")(function* (
      capability: string,
      afterRevision: number | undefined,
      timeoutMs: number,
    ): Effect.fn.Return<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError> {
      const first = yield* agentProjection(capability)
      if (
        afterRevision === undefined ||
        first.revision > afterRevision ||
        first.actions.length > 0 ||
        first.status === "Completed"
      )
        return first
      const challenge = resolveChallenge(capability)
      if (challenge === undefined) return yield* Effect.fail(unavailable())
      const changed = Effect.callback<void>((resume) => {
        const wake = () => resume(Effect.void)
        challenge.waiters.add(wake)
        return Effect.sync(() => challenge.waiters.delete(wake))
      })
      yield* Effect.race(changed, Effect.sleep(timeoutMs))
      return yield* agentProjection(capability)
    })

    const takeAgentAction = Effect.fn("Registry.takeAgentAction")(function* (
      capability: string,
      actionId: string,
    ): Effect.fn.Return<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError> {
      const challenge = resolveChallenge(capability)
      if (challenge === undefined) return yield* Effect.fail(unavailable())
      const entry = yield* activeAgent(challenge)
      yield* refreshAgentPresence(challenge, entry)
      return yield* entry.mutex.withPermits(1)(
        Effect.gen(function* () {
          yield* projectAgent(challenge, entry)
          const event = challenge.actions.get(actionId)
          if (event === undefined)
            return yield* Effect.fail(
              new AgentChallenge.ChallengeError({
                code: challenge.status === "Completed" ? "MatchFinished" : "StaleAction",
                message:
                  challenge.status === "Completed"
                    ? "This match has finished."
                    : "That action is stale or was not issued for the current revision.",
              }),
            )
          if (!(yield* entry.handle.can(event)))
            return yield* Effect.fail(
              new AgentChallenge.ChallengeError({
                code: "StaleAction",
                message: "That action is no longer legal.",
              }),
            )
          yield* entry.handle.send(event)
          wakeChallenge(challenge)
          const projected = yield* projectAgent(challenge, entry)
          yield* broadcast(entry)
          return projected
        }),
      )
    })

    const surrenderAgent = Effect.fn("Registry.surrenderAgent")(function* (
      capability: string,
    ): Effect.fn.Return<AgentChallenge.MatchProjection, AgentChallenge.ChallengeError> {
      const challenge = resolveChallenge(capability)
      if (challenge === undefined) return yield* Effect.fail(unavailable())
      const entry = yield* activeAgent(challenge)
      yield* refreshAgentPresence(challenge, entry)
      return yield* entry.mutex.withPermits(1)(
        Effect.gen(function* () {
          if (challenge.status === "Completed")
            return yield* Effect.fail(
              new AgentChallenge.ChallengeError({
                code: "MatchFinished",
                message: "This match has already finished.",
              }),
            )
          const event: Match.Event = { _tag: "Surrender", playerId: "player-two" }
          if (!(yield* entry.handle.can(event)))
            return yield* Effect.fail(
              new AgentChallenge.ChallengeError({
                code: "MatchFinished",
                message: "This match cannot accept a surrender.",
              }),
            )
          yield* entry.handle.send(event)
          wakeChallenge(challenge)
          const projected = yield* projectAgent(challenge, entry)
          yield* broadcast(entry)
          return projected
        }),
      )
    })

    const joinFriendly = Effect.fn("Registry.joinFriendly")(function* (
      player: Identity.Player,
      inviteCode: string,
    ): Effect.fn.Return<Result<Seat>> {
      return yield* registryMutex.withPermits(1)(
        Effect.gen(function* () {
          if (retiredAccounts.has(player.id))
            return rejected("AccountRetired", "This player account is no longer active.")
          cleanup()
          const entry = entries.get(inviteCode)
          if (entry === undefined) return rejected("MatchNotFound", "Friendly match not found.")
          if (entry._tag === "Active")
            return rejected("MatchFull", "Friendly match already has two players.")
          if (entry.playerOne.player.id === player.id) {
            return rejected(
              "CannotJoinOwnMatch",
              "You cannot occupy both seats in a Friendly match.",
            )
          }
          const active = yield* activate(entry, accountOwner(player), "Friendly")
          return accepted({
            matchId: active.matchId,
            seatToken: active.playerTwoToken,
            playerId: "player-two" as const,
            accountId: player.id,
          })
        }),
      )
    })

    const joinRanked = Effect.fn("Registry.joinRanked")(function* (
      player: Identity.Player,
      matched: (seat: Seat) => Effect.Effect<void, never, Scope.Scope>,
    ): Effect.fn.Return<QueueResult, never, Scope.Scope> {
      const pairing = yield* registryMutex.withPermits(1)(
        Effect.gen(function* () {
          if (retiredAccounts.has(player.id))
            return {
              result: rejected("AccountRetired", "This player account is no longer active."),
            }
          if (queue.has(player.id)) {
            return { result: rejected("AlreadyQueued", "You are already waiting for Ranked play.") }
          }
          const opponent = queue.values().next().value as QueueEntry | undefined
          if (opponent === undefined) {
            queue.set(player.id, { player, matched })
            return { result: accepted({ _tag: "Waiting" as const }) }
          }
          queue.delete(opponent.player.id)
          const waiting = createWaiting(opponent.player)
          const active = yield* activate(waiting, accountOwner(player), "Ranked")
          const first: Seat = {
            matchId: active.matchId,
            seatToken: active.playerOneToken,
            playerId: "player-one",
            accountId: opponent.player.id,
          }
          const second: Seat = {
            matchId: active.matchId,
            seatToken: active.playerTwoToken,
            playerId: "player-two",
            accountId: player.id,
          }
          return {
            result: accepted({ _tag: "Matched" as const, seat: second }),
            notify: opponent.matched,
            first,
          }
        }),
      )
      if (pairing.notify !== undefined && pairing.first !== undefined)
        yield* pairing.notify(pairing.first)
      return pairing.result
    })

    const leaveRanked = (accountId: string) =>
      registryMutex.withPermits(1)(
        Effect.sync(() =>
          retiredAccounts.has(accountId)
            ? rejected("AccountRetired", "This player account is no longer active.")
            : queue.delete(accountId)
              ? accepted(undefined)
              : rejected("NotQueued", "You are not waiting for Ranked play."),
        ),
      )

    const reconnect = Effect.fn("Registry.reconnect")(function* (
      accountId: string,
      matchId: string,
      seatToken: string,
    ): Effect.fn.Return<Result<Seat>> {
      if (retiredAccounts.has(accountId))
        return rejected("AccountRetired", "This player account is no longer active.")
      const entry = yield* get(matchId)
      if (entry === undefined) return rejected("MatchNotFound", "Match not found.")
      if (entry.playerOneToken === seatToken && entry.playerOne.player.id === accountId) {
        return accepted({ matchId, seatToken, playerId: "player-one", accountId })
      }
      if (
        entry._tag === "Active" &&
        entry.playerTwoToken === seatToken &&
        entry.owners["player-two"]._tag === "Account" &&
        entry.owners["player-two"].player.id === accountId
      ) {
        return accepted({ matchId, seatToken, playerId: "player-two", accountId })
      }
      return rejected("InvalidToken", "The account and seat token do not identify this seat.")
    })

    const authenticate = Effect.fn("Registry.authenticate")(function* (
      seat: Seat,
    ): Effect.fn.Return<Result<Entry>> {
      if (retiredAccounts.has(seat.accountId))
        return rejected("AccountRetired", "This player account is no longer active.")
      const entry = yield* get(seat.matchId)
      if (entry === undefined) return rejected("MatchNotFound", "Match not found.")
      const expectedToken =
        seat.playerId === "player-one"
          ? entry.playerOneToken
          : entry._tag === "Active"
            ? entry.playerTwoToken
            : undefined
      const expectedAccount =
        seat.playerId === "player-one"
          ? entry.playerOne.player.id
          : entry._tag === "Active"
            ? ownerAccountId(entry.owners["player-two"])
            : undefined
      return expectedToken === seat.seatToken && expectedAccount === seat.accountId
        ? accepted(entry)
        : rejected("InvalidToken", "The account and seat token do not identify this seat.")
    })

    const view = Effect.fn("Registry.view")(function* (
      seat: Seat,
    ): Effect.fn.Return<Result<Protocol.PlayerView>> {
      const authenticated = yield* authenticate(seat)
      if (authenticated._tag === "Rejected") return authenticated
      if (authenticated.value._tag === "Waiting")
        return rejected("WaitingForOpponent", "Waiting for another player.")
      return accepted(yield* project(authenticated.value, seat.playerId))
    })

    const command = Effect.fn("Registry.command")(function* (
      seat: Seat,
      event: Match.Event,
    ): Effect.fn.Return<Result<Protocol.PlayerView>> {
      const authenticated = yield* authenticate(seat)
      if (authenticated._tag === "Rejected") return authenticated
      if (authenticated.value._tag === "Waiting")
        return rejected("WaitingForOpponent", "Waiting for another player.")
      const entry = authenticated.value
      return yield* entry.mutex.withPermits(1)(
        Effect.gen(function* () {
          if (event.playerId !== seat.playerId)
            return rejected("WrongActor", "Commands may only act for the authenticated seat.")
          if (!(yield* entry.handle.can(event)))
            return rejected("IllegalAction", "That action is not legal in the current state.")
          yield* entry.handle.send(event)
          const challengeDigest = matchChallenges.get(entry.matchId)
          const challenge =
            challengeDigest === undefined ? undefined : challenges.get(challengeDigest)
          if (challenge !== undefined) wakeChallenge(challenge)
          const state = yield* entry.handle.snapshot
          const persisted = yield* Effect.exit(persistFinished(entry, state))
          if (Exit.isFailure(persisted))
            return rejected("PersistenceFailed", "The Ranked result could not be saved atomically.")
          const projected = yield* project(entry, seat.playerId)
          if (challenge !== undefined) syncChallengeOutcome(challenge, projected)
          yield* broadcast(entry)
          return accepted(projected)
        }),
      )
    })

    const beginDisconnectTimer = Effect.fn("Registry.beginDisconnectTimer")(function* (
      entry: ActiveMatch,
      playerId: Card.PlayerId,
    ) {
      const existing = entry.disconnectFibers.get(playerId)
      if (existing !== undefined) yield* Fiber.interrupt(existing)
      const timer = yield* Effect.gen(function* () {
        yield* Effect.sleep(disconnectGraceMs)
        yield* registryMutex.withPermits(1)(
          entry.mutex.withPermits(1)(
            Effect.gen(function* () {
              if (
                entries.get(entry.matchId) !== entry ||
                entry.presence[playerId] !== "Disconnected"
              )
                return
              const opponent = Match.opponentOf(playerId)
              if (entry.presence[opponent] !== "Connected") return
              const state = yield* entry.handle.snapshot
              if (state._tag === "Finished") return
              const surrender: Match.Event = { _tag: "Surrender", playerId }
              if (!(yield* entry.handle.can(surrender))) return
              entry.forfeitLoser = playerId
              yield* entry.handle.send(surrender)
              const finished = yield* entry.handle.snapshot
              const persisted = yield* Effect.exit(persistFinished(entry, finished))
              if (Exit.isSuccess(persisted)) yield* broadcast(entry)
            }),
          ),
        )
      }).pipe(Effect.forkIn(entry.scope))
      entry.disconnectFibers.set(playerId, timer)
    })

    const subscribe = Effect.fn("Registry.subscribe")(function* (seat: Seat, send: Send) {
      const authenticated = yield* authenticate(seat)
      if (authenticated._tag === "Rejected") return
      const entry = authenticated.value
      entry.senders.set(seat.playerId, send)
      entry.presence[seat.playerId] = "Connected"
      if (entry._tag === "Active") {
        const timer = entry.disconnectFibers.get(seat.playerId)
        if (timer !== undefined) {
          yield* Fiber.interrupt(timer)
          entry.disconnectFibers.delete(seat.playerId)
        }
        const opponent = Match.opponentOf(seat.playerId)
        if (entry.mode === "Ranked" && entry.presence[opponent] === "Disconnected")
          yield* beginDisconnectTimer(entry, opponent)
        yield* broadcast(entry)
      }
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          entry.senders.delete(seat.playerId)
          entry.presence[seat.playerId] = "Disconnected"
          if (retiredAccounts.has(seat.accountId)) return
          if (entry._tag === "Active") {
            yield* broadcast(entry)
            if (
              entry.mode === "Ranked" &&
              entry.presence[Match.opponentOf(seat.playerId)] === "Connected"
            ) {
              yield* beginDisconnectTimer(entry, seat.playerId)
            }
          }
        }),
      )
    })

    const retire = Effect.fn("Registry.retire")(function* (
      accountId: string,
    ): Effect.fn.Return<Result<void>, Identity.StorageError> {
      return yield* registryMutex.withPermits(1)(
        Effect.gen(function* () {
          if (retiredAccounts.has(accountId))
            return rejected("AccountRetired", "This player account is no longer active.")

          let activeEntry: ActiveMatch | undefined
          let activePlayerId: Card.PlayerId | undefined
          for (const entry of entries.values()) {
            if (entry.playerOne.player.id === accountId) {
              if (entry._tag === "Active") {
                activeEntry = entry
                activePlayerId = "player-one"
              }
              break
            }
            if (
              entry._tag === "Active" &&
              ownerAccountId(entry.owners["player-two"]) === accountId
            ) {
              activeEntry = entry
              activePlayerId = "player-two"
              break
            }
          }

          if (activeEntry !== undefined && activePlayerId !== undefined) {
            return yield* activeEntry.mutex.withPermits(1)(
              Effect.gen(function* () {
                let state = yield* activeEntry.handle.snapshot
                if (state._tag !== "Finished") {
                  const surrender: Match.Event = { _tag: "Surrender", playerId: activePlayerId }
                  if (!(yield* activeEntry.handle.can(surrender)))
                    return rejected(
                      "IllegalAction",
                      "The active match could not be retired safely.",
                    )
                  yield* activeEntry.handle.send(surrender)
                  state = yield* activeEntry.handle.snapshot
                }
                if (state._tag !== "Finished")
                  return rejected(
                    "IllegalAction",
                    "The active match did not finish during retirement.",
                  )

                const challengeDigest = matchChallenges.get(activeEntry.matchId)
                const challenge =
                  challengeDigest === undefined ? undefined : challenges.get(challengeDigest)
                if (challenge !== undefined) {
                  wakeChallenge(challenge)
                  challenge.status = "Completed"
                  creatorChallenges.delete(challenge.creatorId)
                }

                const completion: RankedCompletion | undefined =
                  activeEntry.mode === "Ranked"
                    ? (() => {
                        const winner = activeEntry.owners[state.winner]
                        const loser = activeEntry.owners[state.loser]
                        return winner._tag === "Account" && loser._tag === "Account"
                          ? {
                              matchId: activeEntry.matchId,
                              winnerId: winner.player.id,
                              loserId: loser.player.id,
                              reason:
                                activeEntry.forfeitLoser === state.loser
                                  ? ("Forfeit" as const)
                                  : state.reason,
                              completedAt: Date.now(),
                            }
                          : undefined
                      })()
                    : undefined
                const retired = yield* storage.retirePlayer(accountId, completion)
                if (!retired.retired)
                  return rejected("AccountRetired", "This player account is no longer active.")

                retiredAccounts.add(accountId)
                queue.delete(accountId)
                activeEntry.senders.delete(activePlayerId)
                activeEntry.presence[activePlayerId] = "Disconnected"
                const timer = activeEntry.disconnectFibers.get(activePlayerId)
                if (timer !== undefined) {
                  yield* Fiber.interrupt(timer)
                  activeEntry.disconnectFibers.delete(activePlayerId)
                }
                yield* broadcast(activeEntry)
                return accepted(undefined)
              }),
            )
          }

          const retired = yield* storage.retirePlayer(accountId)
          if (!retired.retired)
            return rejected("AccountRetired", "This player account is no longer active.")
          retiredAccounts.add(accountId)
          queue.delete(accountId)
          for (const [matchId, entry] of entries) {
            if (entry._tag === "Waiting" && entry.playerOne.player.id === accountId) {
              const digest = matchChallenges.get(matchId)
              const challenge = digest === undefined ? undefined : challenges.get(digest)
              if (challenge !== undefined) {
                challenge.status = "Revoked"
                creatorChallenges.delete(accountId)
                wakeChallenge(challenge)
              }
              entries.delete(matchId)
            }
          }
          return accepted(undefined)
        }),
      )
    })

    yield* Effect.addFinalizer(() =>
      Effect.forEach(entries.values(), (entry) =>
        entry._tag === "Active" ? Scope.close(entry.scope, Exit.void) : Effect.void,
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            entries.clear()
            queue.clear()
            challenges.clear()
            creatorChallenges.clear()
            matchChallenges.clear()
          }),
        ),
        Effect.asVoid,
      ),
    )

    return Registry.of({
      createFriendly,
      joinFriendly,
      createAgentChallenge,
      inspectAgentChallenge,
      revokeAgentChallenge,
      challengeInfo,
      acceptAgentChallenge,
      agentProjection,
      waitForAgentTurn,
      takeAgentAction,
      surrenderAgent,
      joinRanked,
      leaveRanked,
      reconnect,
      subscribe,
      command,
      view,
      retire,
    })
  })

export const layer = (options?: Options) =>
  Layer.effect(Registry, make(options)).pipe(Layer.provide(MachineEngine.layerMemory()))
