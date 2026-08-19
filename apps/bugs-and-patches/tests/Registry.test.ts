import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as TestClock from "effect/testing/TestClock"
import type * as AgentChallenge from "../src/protocol/AgentChallenge.js"
import type * as Identity from "../src/server/Identity.js"
import * as Registry from "../src/server/Registry.js"
import * as Storage from "../src/server/Storage.js"
import * as Postgres from "./Postgres.js"

const profile = (githubId: string, login: string): Identity.GitHubProfile => ({
  githubId,
  login,
  avatarUrl: `https://avatars.test/${login}`,
  profileUrl: `https://github.com/${login}`,
})

const player = (id: string, login: string): Identity.Player => ({
  id,
  displayName: login,
  anonymous: false,
  github: {
    login,
    avatarUrl: `https://avatars.test/${login}`,
    profileUrl: `https://github.com/${login}`,
  },
  rating: 1000,
  wins: 0,
  losses: 0,
  games: 0,
  createdAt: 1,
  updatedAt: 1,
})

const testLayer = (
  databaseUrl: string,
  disconnectGraceMs = 60_000,
  options?: Omit<Registry.Options, "disconnectGraceMs">,
) => {
  const storage = Postgres.storageLayer(databaseUrl)
  const registry = Registry.layer({ disconnectGraceMs, ...options }).pipe(Layer.provide(storage))
  return Layer.merge(storage, registry)
}

const seedPlayers = Effect.gen(function* () {
  const storage = yield* Storage.Storage
  const firstPlayer = yield* storage.upsertProfile(profile("1", "octocat"), 1)
  const secondPlayer = yield* storage.upsertProfile(profile("2", "hubot"), 1)
  return { firstPlayer, secondPlayer }
})

const pairRanked = (firstPlayer: Identity.Player, secondPlayer: Identity.Player) =>
  Effect.gen(function* () {
    const registry = yield* Registry.Registry
    let firstSeat: Registry.Seat | undefined
    const first = yield* registry.joinRanked(firstPlayer, (seat) =>
      Effect.sync(() => {
        firstSeat = seat
      }),
    )
    assert.strictEqual(first._tag === "Accepted" && first.value._tag, "Waiting")
    const second = yield* registry.joinRanked(secondPlayer, () => Effect.void)
    assert.strictEqual(second._tag, "Accepted")
    if (second._tag === "Rejected" || second.value._tag === "Waiting" || firstSeat === undefined) {
      return yield* Effect.die("Ranked pairing failed")
    }
    return { first: firstSeat, second: second.value.seat }
  })

describe("authenticated Friendly and Ranked registry", () => {
  it.effect("creates one expiring capability and lets exactly one named agent claim it", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry
          const storage = yield* Storage.Storage
          const { firstPlayer } = yield* seedPlayers
          const first = yield* registry.createAgentChallenge(firstPlayer)
          const repeated = yield* registry.createAgentChallenge(firstPlayer)
          if (first._tag === "Rejected" || repeated._tag === "Rejected")
            return yield* Effect.die("Challenge creation failed")
          assert.strictEqual(repeated.value.challenge.url, first.value.challenge.url)
          assert.strictEqual(repeated.value.matchId, first.value.matchId)
          const capability = new URL(first.value.challenge.url).pathname.split("/").at(-1)
          if (capability === undefined) return yield* Effect.die("Challenge capability missing")

          const invalid = yield* Effect.exit(registry.acceptAgentChallenge(capability, "x"))
          assert.strictEqual(invalid._tag, "Failure")
          const claims = yield* Effect.all(
            [
              Effect.exit(registry.acceptAgentChallenge(capability, "Codex")),
              Effect.exit(registry.acceptAgentChallenge(capability, "Patch Bot")),
            ],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(claims.filter(({ _tag }) => _tag === "Success").length, 1)
          const acceptedClaim = claims.find(
            (claim): claim is Exit.Success<AgentChallenge.MatchProjection> =>
              claim._tag === "Success",
          )
          assert.strictEqual(acceptedClaim?.value.view?.mode, "Friendly")
          assert.strictEqual(
            acceptedClaim?.value.view?.players.find(({ id }) => id === "player-two")?.identity.kind,
            "Agent",
          )
          assert.strictEqual(JSON.stringify(acceptedClaim?.value).includes("seatToken"), false)
          assert.strictEqual(
            (yield* registry.reconnect(firstPlayer.id, first.value.matchId, capability))._tag,
            "Rejected",
          )
          yield* registry.surrenderAgent(capability)
          assert.deepStrictEqual(yield* storage.leaderboard, [])
        }).pipe(
          Effect.provide(
            testLayer(databaseUrl, 60_000, {
              challengeOrigin: "https://game.example.test",
            }),
          ),
        ),
      ),
    ),
  )

  it.effect("expires, revokes, recreates, and retires open challenges without reviving links", () =>
    Postgres.withDatabase((databaseUrl) => {
      let now = 1_000
      return Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry
          const { firstPlayer } = yield* seedPlayers
          const expiring = yield* registry.createAgentChallenge(firstPlayer)
          if (expiring._tag === "Rejected") return yield* Effect.die("Challenge creation failed")
          const expiredCapability = new URL(expiring.value.challenge.url).pathname.split("/").at(-1)
          if (expiredCapability === undefined) return yield* Effect.die("Capability missing")
          now = 1_011
          assert.strictEqual((yield* registry.challengeInfo(expiredCapability))._tag, "Rejected")

          const fresh = yield* registry.createAgentChallenge(firstPlayer)
          if (fresh._tag === "Rejected") return yield* Effect.die("Fresh challenge failed")
          assert.notStrictEqual(fresh.value.challenge.url, expiring.value.challenge.url)
          const freshCapability = new URL(fresh.value.challenge.url).pathname.split("/").at(-1)
          if (freshCapability === undefined) return yield* Effect.die("Fresh capability missing")
          const inspected = yield* registry.inspectAgentChallenge(firstPlayer.id)
          assert.strictEqual(inspected._tag, "Accepted")
          if (inspected._tag === "Accepted") {
            assert.strictEqual(inspected.value.url, fresh.value.challenge.url)
          }
          assert.strictEqual(
            (yield* registry.revokeAgentChallenge(firstPlayer.id))._tag,
            "Accepted",
          )
          assert.strictEqual(
            (yield* registry.inspectAgentChallenge(firstPlayer.id))._tag,
            "Rejected",
          )
          assert.strictEqual((yield* registry.challengeInfo(freshCapability))._tag, "Rejected")

          const retired = yield* registry.createAgentChallenge(firstPlayer)
          if (retired._tag === "Rejected") return yield* Effect.die("Retirement challenge failed")
          const retiredCapability = new URL(retired.value.challenge.url).pathname.split("/").at(-1)
          if (retiredCapability === undefined)
            return yield* Effect.die("Retired capability missing")
          assert.strictEqual((yield* registry.retire(firstPlayer.id))._tag, "Accepted")
          assert.strictEqual((yield* registry.challengeInfo(retiredCapability))._tag, "Rejected")
        }).pipe(
          Effect.provide(
            testLayer(databaseUrl, 60_000, {
              challengeLifetimeMs: 10,
              challengeOrigin: "https://game.example.test",
              now: () => now,
            }),
          ),
        ),
      )
    }),
  )

  it.effect("invalidates process-local challenge capabilities when the registry restarts", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.gen(function* () {
        const capability = yield* Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* Registry.Registry
            const { firstPlayer } = yield* seedPlayers
            const created = yield* registry.createAgentChallenge(firstPlayer)
            if (created._tag === "Rejected") return yield* Effect.die("Challenge creation failed")
            const value = new URL(created.value.challenge.url).pathname.split("/").at(-1)
            return value === undefined ? yield* Effect.die("Challenge capability missing") : value
          }).pipe(
            Effect.provide(
              testLayer(databaseUrl, 60_000, {
                challengeOrigin: "https://game.example.test",
              }),
            ),
          ),
        )

        yield* Effect.scoped(
          Effect.gen(function* () {
            const restarted = yield* Registry.Registry
            assert.strictEqual((yield* restarted.challengeInfo(capability))._tag, "Rejected")
          }).pipe(
            Effect.provide(
              testLayer(databaseUrl, 60_000, {
                challengeOrigin: "https://game.example.test",
              }),
            ),
          ),
        )
      }),
    ),
  )

  it.effect("binds opaque action IDs to one revision and reports agent presence", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry
          const { firstPlayer } = yield* seedPlayers
          const created = yield* registry.createAgentChallenge(firstPlayer)
          if (created._tag === "Rejected") return yield* Effect.die("Challenge creation failed")
          const capability = new URL(created.value.challenge.url).pathname.split("/").at(-1)
          if (capability === undefined) return yield* Effect.die("Capability missing")
          let projection = yield* registry.acceptAgentChallenge(capability, "Codex")
          for (let attempts = 0; attempts < 3 && projection.actions.length === 0; attempts++) {
            const human = yield* registry.view(created.value)
            if (human._tag === "Accepted") {
              const pass = human.value.legalActions.find(
                ({ action, enabled }) => enabled && action.startsWith("Pass"),
              )
              if (
                pass?.action === "PassBug" ||
                pass?.action === "PassPatch" ||
                pass?.action === "PassSideEffect"
              ) {
                yield* registry.command(created.value, {
                  _tag: pass.action,
                  playerId: "player-one",
                })
              }
            }
            projection = yield* registry.agentProjection(capability)
          }
          const action = projection.actions[0]
          assert.ok(action !== undefined)
          const next = yield* registry.takeAgentAction(capability, action.actionId)
          assert.ok(next.revision > projection.revision)
          const stale = yield* Effect.exit(registry.takeAgentAction(capability, action.actionId))
          assert.strictEqual(stale._tag, "Failure")

          const connected = yield* registry.view(created.value)
          assert.strictEqual(
            connected._tag === "Accepted" && connected.value.players[1]?.presence,
            "Connected",
          )
          yield* TestClock.adjust("101 millis")
          const disconnected = yield* registry.view(created.value)
          assert.strictEqual(
            disconnected._tag === "Accepted" && disconnected.value.players[1]?.presence,
            "Disconnected",
          )
          assert.strictEqual(
            (yield* registry.agentProjection(capability)).agentPresence,
            "Connected",
          )
        }).pipe(
          Effect.provide(
            testLayer(databaseUrl, 60_000, {
              agentPresenceMs: 100,
              challengeOrigin: "https://game.example.test",
            }),
          ),
        ),
      ),
    ),
  )

  it.effect(
    "prevents self-joining and forged account/seat combinations while preserving command serialization",
    () =>
      Postgres.withDatabase((databaseUrl) =>
        Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* Registry.Registry
            const { firstPlayer, secondPlayer } = yield* seedPlayers
            const created = yield* registry.createFriendly(firstPlayer)
            if (created._tag === "Rejected") return yield* Effect.die("Friendly creation failed")
            const first = created.value
            const selfJoin = yield* registry.joinFriendly(firstPlayer, first.inviteCode)
            assert.strictEqual(selfJoin._tag, "Rejected")
            if (selfJoin._tag === "Rejected")
              assert.strictEqual(selfJoin.code, "CannotJoinOwnMatch")
            const joined = yield* registry.joinFriendly(secondPlayer, first.inviteCode)
            assert.strictEqual(joined._tag, "Accepted")
            if (joined._tag === "Rejected") return

            const forged = yield* registry.reconnect(
              secondPlayer.id,
              first.matchId,
              first.seatToken,
            )
            assert.strictEqual(forged._tag, "Rejected")
            const forgedCommand = yield* registry.command(
              { ...first, accountId: secondPlayer.id },
              {
                _tag: "Surrender",
                playerId: "player-one",
              },
            )
            assert.strictEqual(forgedCommand._tag, "Rejected")

            const opened = yield* registry.view(first)
            assert.strictEqual(opened._tag, "Accepted")
            if (opened._tag === "Rejected") return
            assert.strictEqual(opened.value.mode, "Friendly")
            const active = opened.value.activePlayer === first.playerId ? first : joined.value
            const event = { _tag: "PassBug" as const, playerId: active.playerId }
            const results = yield* Effect.all(
              [registry.command(active, event), registry.command(active, event)],
              { concurrency: "unbounded" },
            )
            assert.strictEqual(results.filter(({ _tag }) => _tag === "Accepted").length, 1)
            assert.strictEqual(results.filter(({ _tag }) => _tag === "Rejected").length, 1)

            yield* registry.command(joined.value, {
              _tag: "Surrender",
              playerId: joined.value.playerId,
            })
            assert.deepStrictEqual(yield* (yield* Storage.Storage).leaderboard, [])
          }).pipe(Effect.provide(testLayer(databaseUrl))),
        ),
      ),
  )

  it.effect(
    "queues each account once, supports cancellation, pairs distinct accounts, and ranks completion once",
    () =>
      Postgres.withDatabase((databaseUrl) =>
        Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* Registry.Registry
            const storage = yield* Storage.Storage
            const { firstPlayer, secondPlayer } = yield* seedPlayers
            const waiting = yield* registry.joinRanked(firstPlayer, () => Effect.void)
            assert.strictEqual(waiting._tag === "Accepted" && waiting.value._tag, "Waiting")
            const duplicate = yield* registry.joinRanked(firstPlayer, () => Effect.void)
            assert.strictEqual(duplicate._tag, "Rejected")
            if (duplicate._tag === "Rejected") assert.strictEqual(duplicate.code, "AlreadyQueued")
            assert.strictEqual((yield* registry.leaveRanked(firstPlayer.id))._tag, "Accepted")
            assert.strictEqual((yield* registry.leaveRanked(firstPlayer.id))._tag, "Rejected")

            const seats = yield* pairRanked(firstPlayer, secondPlayer)
            const firstView = yield* registry.view(seats.first)
            const secondView = yield* registry.view(seats.second)
            assert.strictEqual(firstView._tag === "Accepted" && firstView.value.mode, "Ranked")
            if (firstView._tag === "Accepted" && secondView._tag === "Accepted") {
              assert.strictEqual(secondView.value.phase, firstView.value.phase)
            }
            const finished = yield* registry.command(seats.second, {
              _tag: "Surrender",
              playerId: seats.second.playerId,
            })
            assert.strictEqual(finished._tag === "Accepted" && finished.value.phase, "Finished")
            assert.strictEqual((yield* storage.leaderboard).length, 2)
            assert.strictEqual(
              (yield* storage.rankedResult(seats.first.matchId))?.reason,
              "Surrender",
            )
            const again = yield* registry.command(seats.second, {
              _tag: "Surrender",
              playerId: seats.second.playerId,
            })
            assert.strictEqual(again._tag, "Rejected")
            assert.strictEqual((yield* storage.player(firstPlayer.id))?.games, 1)
          }).pipe(Effect.provide(testLayer(databaseUrl))),
        ),
      ),
  )

  it.effect(
    "cancels a disconnect for an in-time reconnect and forfeits only when one player remains absent",
    () =>
      Postgres.withDatabase((databaseUrl) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { firstPlayer, secondPlayer } = yield* seedPlayers
            const registry = yield* Registry.Registry
            const storage = yield* Storage.Storage
            const seats = yield* pairRanked(firstPlayer, secondPlayer)
            const firstScope = yield* Scope.make()
            const secondScope = yield* Scope.make()
            const finished = yield* Deferred.make<void>()
            yield* registry
              .subscribe(seats.first, (message) =>
                message._tag === "View" && message.view.phase === "Finished"
                  ? Deferred.succeed(finished, undefined).pipe(Effect.asVoid)
                  : Effect.void,
              )
              .pipe(Effect.provideService(Scope.Scope, firstScope))
            yield* registry
              .subscribe(seats.second, () => Effect.void)
              .pipe(Effect.provideService(Scope.Scope, secondScope))
            yield* Scope.close(secondScope, Exit.void)
            yield* TestClock.adjust("30 seconds")
            const reconnectedScope = yield* Scope.make()
            yield* registry
              .subscribe(seats.second, () => Effect.void)
              .pipe(Effect.provideService(Scope.Scope, reconnectedScope))
            yield* TestClock.adjust("31 seconds")
            assert.strictEqual((yield* storage.leaderboard).length, 0)
            yield* Scope.close(reconnectedScope, Exit.void)
            yield* TestClock.adjust("60 seconds")
            yield* Deferred.await(finished)
            assert.strictEqual(
              (yield* storage.rankedResult(seats.first.matchId))?.reason,
              "Forfeit",
            )
            assert.strictEqual((yield* registry.view(seats.first))._tag, "Accepted")
          }).pipe(Effect.provide(testLayer(databaseUrl))),
        ),
      ),
  )

  it.effect("does not score a Ranked match while both players are absent", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { firstPlayer, secondPlayer } = yield* seedPlayers
          const registry = yield* Registry.Registry
          const storage = yield* Storage.Storage
          const seats = yield* pairRanked(firstPlayer, secondPlayer)
          const firstScope = yield* Scope.make()
          const secondScope = yield* Scope.make()
          yield* registry
            .subscribe(seats.first, () => Effect.void)
            .pipe(Effect.provideService(Scope.Scope, firstScope))
          yield* registry
            .subscribe(seats.second, () => Effect.void)
            .pipe(Effect.provideService(Scope.Scope, secondScope))
          yield* Scope.close(firstScope, Exit.void)
          yield* Scope.close(secondScope, Exit.void)
          yield* TestClock.adjust("61 seconds")
          assert.strictEqual(yield* storage.rankedResult(seats.first.matchId), undefined)
        }).pipe(Effect.provide(testLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("reports atomic persistence failure without changing durable rankings", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const registry = yield* Registry.Registry
          const seats = yield* pairRanked(
            player(crypto.randomUUID(), "octocat"),
            player(crypto.randomUUID(), "hubot"),
          )
          const result = yield* registry.command(seats.second, {
            _tag: "Surrender",
            playerId: seats.second.playerId,
          })
          assert.strictEqual(result._tag, "Rejected")
          if (result._tag === "Rejected") assert.strictEqual(result.code, "PersistenceFailed")
          assert.deepStrictEqual(yield* storage.leaderboard, [])
          assert.strictEqual(yield* storage.rankedResult(seats.first.matchId), undefined)
        }).pipe(Effect.provide(testLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("removes retired accounts from the Ranked queue and waiting invitations", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry
          const storage = yield* Storage.Storage
          const { firstPlayer, secondPlayer } = yield* seedPlayers
          const queued = yield* registry.joinRanked(firstPlayer, () => Effect.void)
          assert.strictEqual(queued._tag === "Accepted" && queued.value._tag, "Waiting")
          assert.strictEqual((yield* registry.retire(firstPlayer.id))._tag, "Accepted")
          assert.strictEqual(yield* storage.player(firstPlayer.id), undefined)
          const secondQueued = yield* registry.joinRanked(secondPlayer, () => Effect.void)
          assert.strictEqual(secondQueued._tag === "Accepted" && secondQueued.value._tag, "Waiting")
          yield* registry.leaveRanked(secondPlayer.id)

          const invitation = yield* registry.createFriendly(secondPlayer)
          if (invitation._tag === "Rejected") return yield* Effect.die("Invitation failed")
          assert.strictEqual((yield* registry.retire(secondPlayer.id))._tag, "Accepted")
          const third = yield* storage.upsertProfile(profile("3", "third-player"), 3)
          const joined = yield* registry.joinFriendly(third, invitation.value.inviteCode)
          assert.strictEqual(joined._tag, "Rejected")
          if (joined._tag === "Rejected") assert.strictEqual(joined.code, "MatchNotFound")
        }).pipe(Effect.provide(testLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("finishes active Friendly play and invalidates the retired seat", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry
          const { firstPlayer, secondPlayer } = yield* seedPlayers
          const created = yield* registry.createFriendly(firstPlayer)
          if (created._tag === "Rejected") return yield* Effect.die("Friendly creation failed")
          const joined = yield* registry.joinFriendly(secondPlayer, created.value.inviteCode)
          if (joined._tag === "Rejected") return yield* Effect.die("Friendly join failed")
          assert.strictEqual((yield* registry.retire(firstPlayer.id))._tag, "Accepted")

          const remaining = yield* registry.view(joined.value)
          assert.strictEqual(remaining._tag === "Accepted" && remaining.value.phase, "Finished")
          if (remaining._tag === "Accepted") {
            assert.strictEqual(remaining.value.outcome?.loser, "player-one")
            assert.strictEqual(
              remaining.value.players.find(({ id }) => id === "player-one")?.identity.displayName,
              "Deleted player",
            )
          }
          assert.strictEqual(
            (yield* registry.reconnect(
              firstPlayer.id,
              created.value.matchId,
              created.value.seatToken,
            ))._tag,
            "Rejected",
          )
          assert.strictEqual(
            (yield* registry.command(created.value, {
              _tag: "Surrender",
              playerId: "player-one",
            }))._tag,
            "Rejected",
          )
        }).pipe(Effect.provide(testLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("settles a Ranked retirement once and excludes the tombstone", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* Registry.Registry
          const storage = yield* Storage.Storage
          const { firstPlayer, secondPlayer } = yield* seedPlayers
          const seats = yield* pairRanked(firstPlayer, secondPlayer)
          assert.strictEqual((yield* registry.retire(secondPlayer.id))._tag, "Accepted")
          assert.strictEqual(
            (yield* storage.rankedResult(seats.first.matchId))?.reason,
            "Surrender",
          )
          assert.strictEqual((yield* storage.player(firstPlayer.id))?.games, 1)
          assert.strictEqual(yield* storage.player(secondPlayer.id), undefined)
          assert.deepStrictEqual(
            (yield* storage.leaderboard).map(({ identity }) => identity.displayName),
            [firstPlayer.displayName],
          )
          assert.strictEqual((yield* registry.view(seats.first))._tag, "Accepted")
          assert.strictEqual((yield* registry.retire(secondPlayer.id))._tag, "Rejected")
        }).pipe(Effect.provide(testLayer(databaseUrl))),
      ),
    ),
  )

  it.effect(
    "reuses an existing result and leaves identity intact when retirement storage fails",
    () =>
      Postgres.withDatabase((databaseUrl) =>
        Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* Registry.Registry
            const storage = yield* Storage.Storage
            const { firstPlayer, secondPlayer } = yield* seedPlayers
            const seats = yield* pairRanked(firstPlayer, secondPlayer)
            yield* registry.command(seats.second, {
              _tag: "Surrender",
              playerId: seats.second.playerId,
            })
            assert.strictEqual((yield* registry.retire(secondPlayer.id))._tag, "Accepted")
            assert.strictEqual((yield* storage.player(firstPlayer.id))?.games, 1)

            const unpersistedOne = player(crypto.randomUUID(), "ghost-one")
            const unpersistedTwo = yield* storage.upsertProfile(profile("4", "ghost-two"), 4)
            const unpersistedSeats = yield* pairRanked(unpersistedOne, unpersistedTwo)
            const failed = yield* Effect.exit(registry.retire(unpersistedTwo.id))
            assert.strictEqual(failed._tag, "Failure")
            assert.strictEqual((yield* registry.view(unpersistedSeats.second))._tag, "Accepted")
            assert.strictEqual(
              (yield* storage.player(unpersistedTwo.id))?.github.login,
              "ghost-two",
            )
            assert.strictEqual(
              yield* storage.rankedResult(unpersistedSeats.first.matchId),
              undefined,
            )
          }).pipe(Effect.provide(testLayer(databaseUrl))),
        ),
      ),
  )
})
