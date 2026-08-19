import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { renderToStaticMarkup } from "react-dom/server"
import { artFor, cardArt } from "../src/client/Art.js"
import * as ChallengeLink from "../src/client/ChallengeLink.js"
import {
  BATTLE_PREVIEW_PATH,
  battleScenarios,
  isBattlePreviewPath,
  scenarioFromSearch,
} from "../src/client/BattlePreview.js"
import {
  applyAgentChallengeUpdate,
  type ConnectionSnapshot,
  expireOpenChallenge,
} from "../src/client/Connection.js"
import {
  Battle,
  cardActivation,
  describeViewTransition,
  legalCardSelection,
  phaseDecisionLabel,
  prefersReducedMotion,
  uptimeProjections,
} from "../src/client/components/Battle.js"
import { Avatar } from "../src/client/components/Primitives.js"
import { howToPlaySections, playAction } from "../src/client/HowToPlayContent.js"
import { pathFor, routeFromPath } from "../src/client/Routes.js"
import { clearSeat, readSeat, type StorageLike, writeSeat } from "../src/client/SeatCredentials.js"
import * as Catalog from "../src/game/Catalog.js"
import type * as Protocol from "../src/protocol/Protocol.js"

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

const view = (): Protocol.PlayerView => ({
  matchId: "match-1",
  mode: "Friendly",
  viewer: "player-one",
  phase: "BugPhase",
  turn: 1,
  activePlayer: "player-one",
  players: [
    {
      id: "player-one",
      identity: { kind: "Account", displayName: "One", github: null },
      uptime: 100,
      handCount: 1,
      deckCount: 24,
      discardCount: 0,
      conditions: [],
      ongoing: [],
      presence: "Connected",
    },
    {
      id: "player-two",
      identity: { kind: "Account", displayName: "Two", github: null },
      uptime: 100,
      handCount: 5,
      deckCount: 25,
      discardCount: 0,
      conditions: [],
      ongoing: [],
      presence: "Connected",
    },
  ],
  hand:
    Catalog.catalog[0] === undefined
      ? []
      : [
          {
            instance: { id: "v0-off-by-one-1", cardId: "off-by-one" },
            card: Catalog.catalog[0],
          },
        ],
  lastBug: null,
  lastPatch: null,
  legalActions: [
    { action: "PlayBug", cardInstanceId: "v0-off-by-one-1", enabled: true, reason: null },
    { action: "PassBug", cardInstanceId: null, enabled: true, reason: null },
    { action: "Surrender", cardInstanceId: null, enabled: true, reason: null },
  ],
  outcome: null,
})

describe("game client contracts", () => {
  it("exposes deterministic battle states only through the development-only preview path", () => {
    assert.isTrue(isBattlePreviewPath(true, BATTLE_PREVIEW_PATH))
    assert.isFalse(isBattlePreviewPath(false, BATTLE_PREVIEW_PATH))
    assert.isFalse(isBattlePreviewPath(true, "/battle"))
    assert.strictEqual(scenarioFromSearch("?scenario=patch").id, "patch")
    assert.strictEqual(scenarioFromSearch("?scenario=missing").id, "bug")
  })

  it("renders every battle preview scenario through the real battle surface", () => {
    for (const scenario of battleScenarios) {
      const markup = renderToStaticMarkup(
        <Battle
          view={scenario.view}
          pending={false}
          notice={null}
          onDismissNotice={() => undefined}
          onCommand={() => undefined}
        />,
      )
      assert.match(markup, /Bugs &amp; Patches/)
      assert.match(markup, new RegExp(`battle--phase-${scenario.view.phase.toLowerCase()}`))
    }
  })

  it("maps every public route and falls unknown paths back to the lobby", () => {
    assert.strictEqual(pathFor("how-to-play"), "/how-to-play")
    assert.strictEqual(routeFromPath("/leaderboard"), "leaderboard")
    assert.strictEqual(routeFromPath("/missing"), "lobby")
  })

  it("keeps the public guide canonical and makes its play action session-aware", () => {
    const copy = howToPlaySections.map(({ title, copy }) => `${title} ${copy}`).join(" ")
    assert.match(copy, /100 Uptime/)
    assert.match(copy, /Side Effect/)
    assert.notMatch(copy, /\bImport\b/)
    assert.deepStrictEqual(playAction(true, "https://game.test"), {
      label: "Play now",
      href: "/",
      internal: true,
    })
    assert.deepStrictEqual(playAction(false, "https://game.test"), {
      label: "Sign in to play",
      href: "https://game.test/auth/github",
      internal: false,
    })
  })

  it("has one illustration for every canonical card and a fallback for unknown IDs", () => {
    assert.strictEqual(Object.keys(cardArt).length, Catalog.catalog.length)
    for (const card of Catalog.catalog)
      assert.notStrictEqual(artFor(card.id), artFor("missing-card"))
    assert.strictEqual(artFor("missing-card"), artFor("another-missing-card"))
  })

  it("derives the canonical 30-card copy counts from the Stack recipe", () => {
    const cards = Catalog.stack()
    assert.strictEqual(cards.length, 30)
    assert.strictEqual(cards.filter(({ cardId }) => cardId === "zero-day").length, 1)
    assert.strictEqual(cards.filter(({ cardId }) => cardId === "off-by-one").length, 2)
  })

  it("renders linked and anonymous public identities differently", () => {
    const anonymous = renderToStaticMarkup(<Avatar name="Quiet Coder" />)
    const linked = renderToStaticMarkup(
      <Avatar name="Octocat" src="https://avatars.test/octocat" />,
    )
    assert.match(anonymous, /anonymous/)
    assert.notMatch(anonymous, /<img/)
    assert.match(linked, /<img/)
  })

  it("selects cards exclusively from authoritative legal actions", () => {
    assert.deepStrictEqual(legalCardSelection(view(), "v0-off-by-one-1"), {
      enabled: true,
      reason: null,
    })
    assert.deepStrictEqual(legalCardSelection(view(), "not-in-hand"), {
      enabled: false,
      reason: "This card has no legal action right now.",
    })
  })

  it("inspects every card before committing a legal second activation", () => {
    assert.strictEqual(cardActivation(null, "card-1", false, false), "Inspect")
    assert.strictEqual(cardActivation("card-1", "card-1", false, false), "Unavailable")
    assert.strictEqual(cardActivation("card-1", "card-1", true, true), "Unavailable")
    assert.strictEqual(cardActivation("card-1", "card-1", true, false), "Play")
    assert.strictEqual(cardActivation("card-1", "card-2", true, false), "Inspect")
  })

  it("names the current decision owner instead of treating the active attacker as every actor", () => {
    const base = view()
    assert.strictEqual(phaseDecisionLabel(base, true), "Your Bug phase")
    assert.strictEqual(
      phaseDecisionLabel({ ...base, phase: "PatchResponse" }, false),
      "Two · Patch",
    )
  })

  it("previews deterministic Bug cost and base damage without committing the scores", () => {
    const base = view()
    const preview = uptimeProjections(base, "v0-off-by-one-1")
    assert.deepStrictEqual(preview["player-one"], { value: 96, formula: "100 − 4 = 96" })
    assert.deepStrictEqual(preview["player-two"], { value: 88, formula: "100 − 12 = 88" })
    assert.strictEqual(base.players[0]?.uptime, 100)
    assert.strictEqual(base.players[1]?.uptime, 100)
  })

  it("describes combat changes for the persistent incident log", () => {
    const base = view()
    const card = base.hand[0]
    if (card === undefined) throw new Error("Fixture card is missing")
    const next: Protocol.PlayerView = {
      ...base,
      phase: "PatchResponse",
      players: base.players.map((player) =>
        player.id === "player-one" ? { ...player, uptime: 96 } : player,
      ),
      lastBug: card,
    }
    const entries = describeViewTransition(base, next)
    assert.match(entries.map(({ text }) => text).join(" "), /You shipped Off-by-one/)
    assert.match(entries.map(({ text }) => text).join(" "), /You lost 4 Uptime/)
  })

  it("stores, reads, and clears reconnect credentials without exposing them to UI state", () => {
    const storage = new MemoryStorage()
    writeSeat(storage, { matchId: "match-1", seatToken: "secret-token" })
    assert.deepStrictEqual(readSeat(storage), { matchId: "match-1", seatToken: "secret-token" })
    clearSeat(storage)
    assert.strictEqual(readSeat(storage), null)
  })

  it("switches zone exits to immediate layout when reduced motion is requested", () => {
    assert.strictEqual(
      prefersReducedMotion(() => ({ matches: true })),
      true,
    )
    assert.strictEqual(
      prefersReducedMotion(() => ({ matches: false })),
      false,
    )
  })

  it.effect("reports challenge-link clipboard success and failure", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* Effect.promise(() =>
          ChallengeLink.copy(
            { writeText: () => Promise.resolve() },
            "https://game.test/challenge/a",
          ),
        ),
        "Copied",
      )
      assert.strictEqual(
        yield* Effect.promise(() =>
          ChallengeLink.copy(
            { writeText: () => Promise.reject(new Error("clipboard denied")) },
            "https://game.test/challenge/a",
          ),
        ),
        "Failed",
      )
    }),
  )

  it("moves an open challenge to the expired lobby state at its authoritative deadline", () => {
    const snapshot: ConnectionSnapshot = {
      kind: "Waiting",
      view: null,
      matchId: "match-1",
      inviteCode: null,
      agentChallenge: {
        url: "https://game.test/challenge/a",
        expiresAt: 100,
        status: "Open",
        agent: null,
        agentPresence: null,
      },
      notice: null,
      pendingRequestId: null,
      hasSavedSeat: true,
    }
    assert.strictEqual(expireOpenChallenge(snapshot, 99), snapshot)
    const expired = expireOpenChallenge(snapshot, 100)
    assert.strictEqual(expired.kind, "Lobby")
    assert.strictEqual(expired.agentChallenge?.status, "Expired")
    assert.strictEqual(expired.hasSavedSeat, false)

    const revoked = applyAgentChallengeUpdate(snapshot, {
      ...snapshot.agentChallenge,
      status: "Revoked",
    })
    assert.strictEqual(revoked.kind, "Lobby")
    assert.strictEqual(revoked.agentChallenge?.status, "Revoked")
    assert.strictEqual(revoked.hasSavedSeat, false)
  })

  it("renders an agent marker and presence through the ordinary battle surface", () => {
    const base = view()
    const human = base.players[0]
    const opponent = base.players[1]
    if (human === undefined || opponent === undefined)
      throw new Error("Fixture players are missing")
    const agentView: Protocol.PlayerView = {
      ...base,
      players: [
        human,
        {
          ...opponent,
          identity: { kind: "Agent", displayName: "Codex", github: null },
          presence: "Disconnected",
        },
      ],
    }
    const markup = renderToStaticMarkup(
      <Battle
        view={agentView}
        pending={false}
        notice={null}
        onDismissNotice={() => undefined}
        onCommand={() => undefined}
      />,
    )
    assert.match(markup, /Codex/)
    assert.match(markup, /Agent/)
    assert.match(markup, /Disconnected/)
    assert.match(markup, /Your agent’s uptime is worse than yours/)
    assert.match(markup, /ping them to wake them up/)
  })
})
