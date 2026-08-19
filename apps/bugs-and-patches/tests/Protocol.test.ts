import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Card from "../src/game/Card.js"
import * as Match from "../src/game/Match.js"
import * as Protocol from "../src/protocol/Protocol.js"
import * as View from "../src/protocol/View.js"

const identities = {
  "player-one": {
    kind: "Account",
    displayName: "octocat",
    github: {
      login: "octocat",
      avatarUrl: "https://example.test/one.png",
      profileUrl: "https://github.com/octocat",
    },
  },
  "player-two": {
    kind: "Account",
    displayName: "hubot",
    github: {
      login: "hubot",
      avatarUrl: "https://example.test/two.png",
      profileUrl: "https://github.com/hubot",
    },
  },
} as const

const options = {
  matchId: "TEST",
  mode: "Friendly" as const,
  presence: { "player-one": "Connected", "player-two": "Connected" } as const,
  identities,
}

describe("authenticated multiplayer protocol", () => {
  it("projects only the viewer's private cards plus public identities and mode", () => {
    const state = Match.initial(Match.defaultInput(77))
    const view = View.project(state, { ...options, viewer: "player-one" })
    const opponent = Match.player(state, "player-two")
    const encoded = JSON.stringify(view)

    assert.strictEqual(view.mode, "Friendly")
    assert.strictEqual(view.players[0]?.identity.github?.login, "octocat")
    assert.strictEqual(view.hand.length, Match.player(state, "player-one")?.hand.length)
    for (const card of opponent?.hand ?? []) assert.strictEqual(encoded.includes(card.id), false)
    for (const card of state.players.flatMap(({ deck }) => deck))
      assert.strictEqual(encoded.includes(card.id), false)
    assert.strictEqual(encoded.includes("seatToken"), false)
    assert.strictEqual(encoded.includes("githubId"), false)
    assert.strictEqual(encoded.includes("session"), false)
  })

  it("reveals played cards but not the opponent's remaining hand", () => {
    const bug: Card.CardInstance = { id: "public-bug", cardId: "null-pointer" }
    const secret: Card.CardInstance = { id: "private-patch", cardId: "git-revert" }
    const initial = Match.initial({ playerOneDeck: [bug], playerTwoDeck: [secret], randomSeed: 1 })
    const state: Match.State = {
      ...initial,
      lastBug: bug,
      players: initial.players.map((player) =>
        player.id === "player-two" ? { ...player, hand: [secret] } : player,
      ),
    }
    const encoded = JSON.stringify(View.project(state, { ...options, viewer: "player-one" }))
    assert.strictEqual(encoded.includes("public-bug"), true)
    assert.strictEqual(encoded.includes("private-patch"), false)
  })

  it.effect("encodes new entry outcomes and rejects legacy or malformed messages", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* Protocol.decodeClient(JSON.stringify({ _tag: "JoinFriendly", inviteCode: "ABCD" })),
        { _tag: "JoinFriendly", inviteCode: "ABCD" },
      )
      assert.deepStrictEqual(
        yield* Protocol.decodeClient(JSON.stringify({ _tag: "CreateAgentChallenge" })),
        { _tag: "CreateAgentChallenge" },
      )
      assert.strictEqual(
        Exit.isFailure(
          yield* Effect.exit(
            Protocol.decodeClient(JSON.stringify({ _tag: "JoinMatch", matchId: "ABCD" })),
          ),
        ),
        true,
      )
      assert.strictEqual(
        Exit.isFailure(yield* Effect.exit(Protocol.decodeClient("not-json"))),
        true,
      )
      const encoded = yield* Protocol.encodeServer({ _tag: "Waiting", queue: "Ranked" })
      assert.deepStrictEqual(yield* Protocol.decodeServer(encoded), {
        _tag: "Waiting",
        queue: "Ranked",
      })
      const challenge = yield* Protocol.encodeServer({
        _tag: "AgentChallengeUpdated",
        challenge: {
          url: "https://game.test/challenge/redacted",
          expiresAt: 100,
          status: "Open",
          agent: null,
          agentPresence: null,
        },
      })
      assert.strictEqual((yield* Protocol.decodeServer(challenge))._tag, "AgentChallengeUpdated")
    }),
  )
})
