import { assert, describe, it } from "@effect/vitest"
import type * as Card from "../src/game/Card.js"
import * as Match from "../src/game/Match.js"
import * as Random from "../src/game/Random.js"

const instance = (cardId: string, id = `${cardId}-test`): Card.CardInstance => ({ id, cardId })

const makePlayer = (
  id: Card.PlayerId,
  options: Partial<Omit<Match.Player, "id">> = {},
): Match.Player => ({
  id,
  uptime: options.uptime ?? 100,
  deck: options.deck ?? [],
  hand: options.hand ?? [],
  discard: options.discard ?? [],
  conditions: options.conditions ?? [],
  ongoing: options.ongoing ?? [],
})

const bugPhase = (
  first: Match.Player,
  second: Match.Player,
  randomState = 1,
): Extract<Match.State, { readonly _tag: "BugPhase" }> => ({
  _tag: "BugPhase",
  players: [first, second],
  activePlayer: "player-one",
  turn: 1,
  bugPlaysRemaining: 1,
  randomState,
  lastBug: null,
  lastPatch: null,
})

const importPhase = (
  first: Match.Player,
  second: Match.Player,
  randomState = 1,
): Extract<Match.State, { readonly _tag: "SideEffectPhase" }> => ({
  ...bugPhase(first, second, randomState),
  _tag: "SideEffectPhase",
  bugPlaysRemaining: 0,
})

const playBug = (
  cardId: string,
  firstOptions: Partial<Omit<Match.Player, "id">> = {},
  secondOptions: Partial<Omit<Match.Player, "id">> = {},
  randomState = 1,
): Match.State => {
  const bug = instance(cardId)
  const state = bugPhase(
    makePlayer("player-one", { ...firstOptions, hand: [...(firstOptions.hand ?? []), bug] }),
    makePlayer("player-two", secondOptions),
    randomState,
  )
  const pending = Match.playBug(state, {
    _tag: "PlayBug",
    playerId: "player-one",
    cardInstanceId: bug.id,
  })
  return pending._tag === "PatchResponse" ? Match.resolvePatch(pending) : pending
}

const playPatchedBug = (
  bugId: string,
  patchId: string,
  firstOptions: Partial<Omit<Match.Player, "id">> = {},
  secondOptions: Partial<Omit<Match.Player, "id">> = {},
): Match.State => {
  const bug = instance(bugId)
  const patch = instance(patchId)
  const state = bugPhase(
    makePlayer("player-one", { ...firstOptions, hand: [...(firstOptions.hand ?? []), bug] }),
    makePlayer("player-two", { ...secondOptions, hand: [...(secondOptions.hand ?? []), patch] }),
  )
  const pending = Match.playBug(state, {
    _tag: "PlayBug",
    playerId: "player-one",
    cardInstanceId: bug.id,
  })
  assert.strictEqual(pending._tag, "PatchResponse")
  if (pending._tag !== "PatchResponse") return pending
  return Match.resolvePatch(pending, {
    _tag: "PlayPatch",
    playerId: "player-two",
    cardInstanceId: patch.id,
  })
}

const playSideEffect = (
  cardId: string,
  firstOptions: Partial<Omit<Match.Player, "id">> = {},
  secondOptions: Partial<Omit<Match.Player, "id">> = {},
  randomState = 1,
): Match.State => {
  const imported = instance(cardId)
  return Match.playSideEffect(
    importPhase(
      makePlayer("player-one", {
        ...firstOptions,
        hand: [...(firstOptions.hand ?? []), imported],
      }),
      makePlayer("player-two", secondOptions),
      randomState,
    ),
    { _tag: "PlaySideEffect", playerId: "player-one", cardInstanceId: imported.id },
  )
}

const uptime = (state: Match.State, playerId: Card.PlayerId): number =>
  Match.player(state, playerId)?.uptime ?? -1

describe("selected Bugs", () => {
  it("resolves plain Null Pointer damage", () => {
    const state = playBug("null-pointer")
    assert.strictEqual(state._tag, "SideEffectPhase")
    assert.strictEqual(uptime(state, "player-one"), 96)
    assert.strictEqual(uptime(state, "player-two"), 88)
  })

  it("makes Off-by-one discard the most recently drawn remaining card", () => {
    const older = instance("lgtm", "older")
    const recent = instance("null-pointer", "recent")
    const state = playBug("off-by-one", { hand: [older, recent] })
    const owner = Match.player(state, "player-one")

    assert.deepStrictEqual(
      owner?.hand.map(({ id }) => id),
      ["older"],
    )
    assert.deepStrictEqual(
      owner?.discard.map(({ id }) => id),
      ["off-by-one-test", "recent"],
    )
  })

  it("makes Heisenbug and 0-day undefendable", () => {
    const heisenbug = playBug("heisenbug")
    const zeroDay = playBug("zero-day")

    assert.strictEqual(heisenbug._tag, "SideEffectPhase")
    assert.strictEqual(uptime(heisenbug, "player-two"), 88)
    assert.strictEqual(zeroDay._tag, "SideEffectPhase")
    assert.strictEqual(uptime(zeroDay, "player-one"), 80)
    assert.strictEqual(uptime(zeroDay, "player-two"), 68)
  })

  it("makes DDoS skip the opponent's next Bug opportunity exactly once", () => {
    const attacked = playBug("ddos")
    assert.strictEqual(attacked._tag, "SideEffectPhase")
    if (attacked._tag !== "SideEffectPhase") return
    const skipped = Match.endTurn(attacked)

    assert.strictEqual(skipped._tag, "SideEffectPhase")
    assert.strictEqual(skipped.activePlayer, "player-two")
    assert.deepStrictEqual(Match.player(skipped, "player-two")?.conditions, [])
  })

  it("makes SQL Injection discard a deterministic random opposing card", () => {
    const state = playBug(
      "sql-injection",
      {},
      { hand: [instance("lgtm", "a"), instance("lgtm", "b")] },
      99,
    )
    const opponent = Match.player(state, "player-two")

    assert.strictEqual(opponent?.hand.length, 1)
    assert.strictEqual(opponent?.discard.length, 1)
  })

  it("makes Stack Overflow deal twenty and cost its owner eight extra Uptime", () => {
    const state = playBug("stack-overflow")
    assert.strictEqual(uptime(state, "player-one"), 84)
    assert.strictEqual(uptime(state, "player-two"), 80)
  })
})

describe("selected Patches", () => {
  it("makes git revert remove only the latest ongoing effect", () => {
    const state = playPatchedBug(
      "null-pointer",
      "git-revert",
      {},
      {
        ongoing: [
          { id: "heal", sourceCardId: "old", kind: "Heal", amount: 1, remainingTurns: 2 },
          { id: "damage", sourceCardId: "new", kind: "Damage", amount: 2, remainingTurns: 2 },
        ],
      },
    )

    assert.deepStrictEqual(
      Match.player(state, "player-two")?.ongoing.map(({ id }) => id),
      ["heal"],
    )
  })

  it("makes reboot cleanse harmful state while preserving healing", () => {
    const state = playPatchedBug(
      "null-pointer",
      "switch-on-and-off",
      {},
      {
        conditions: [{ _tag: "Prohibition", id: "attack", action: "Attack" }],
        ongoing: [
          { id: "damage", sourceCardId: "debt", kind: "Damage", amount: 1, remainingTurns: 3 },
          { id: "heal", sourceCardId: "help", kind: "Heal", amount: 1, remainingTurns: 2 },
        ],
      },
    )
    const defender = Match.player(state, "player-two")

    assert.deepStrictEqual(defender?.conditions, [])
    assert.deepStrictEqual(
      defender?.ongoing.map(({ id }) => id),
      ["heal"],
    )
  })

  it("makes Restore from Backup heal after defending", () => {
    const state = playPatchedBug("null-pointer", "restore-from-backup")
    assert.strictEqual(uptime(state, "player-two"), 104)
  })

  it("makes Works on My Machine redirect all remaining base damage", () => {
    const state = playPatchedBug("null-pointer", "works-on-my-machine")
    assert.strictEqual(uptime(state, "player-one"), 88)
    assert.strictEqual(uptime(state, "player-two"), 96)
  })

  it("makes Containerize preserve base attack but cancel the secondary effect", () => {
    const victim = instance("lgtm", "victim")
    const state = playPatchedBug("sql-injection", "containerize", {}, { hand: [victim] })
    const defender = Match.player(state, "player-two")

    assert.strictEqual(uptime(state, "player-two"), 96)
    assert.deepStrictEqual(
      defender?.hand.map(({ id }) => id),
      ["victim"],
    )
  })
})

describe("selected Side Effects", () => {
  it("makes Merge Conflict discard for both players before drawing", () => {
    const selfSpare = instance("lgtm", "self-spare")
    const opponentA = instance("lgtm", "opponent-a")
    const opponentB = instance("lgtm", "opponent-b")
    const drawn = instance("null-pointer", "drawn")
    const state = playSideEffect(
      "merge-conflict",
      { hand: [selfSpare], deck: [drawn] },
      { hand: [opponentA, opponentB], deck: [instance("null-pointer", "turn-draw")] },
      27,
    )

    assert.deepStrictEqual(
      Match.player(state, "player-one")?.hand.map(({ id }) => id),
      ["drawn"],
    )
    assert.strictEqual(Match.player(state, "player-two")?.hand.length, 2)
    assert.strictEqual(Match.player(state, "player-two")?.discard.length, 1)
  })

  it("supports both seeded Friday Night Release outcomes", () => {
    const seeds = Array.from({ length: 10_000 }, (_, seed) => seed + 1)
    const successSeed = seeds.find((seed) => Random.integer(Random.seeded(seed), 2)[0] === 0)
    const failureSeed = seeds.find((seed) => Random.integer(Random.seeded(seed), 2)[0] === 1)
    assert.ok(successSeed)
    assert.ok(failureSeed)

    const success = playSideEffect("friday-night-release", {}, {}, successSeed)
    const failure = playSideEffect("friday-night-release", {}, {}, failureSeed)
    assert.strictEqual(uptime(success, "player-one"), 116)
    assert.strictEqual(uptime(failure, "player-one"), 76)
  })

  it("makes Technical Debt draw three and begin three end-of-turn payments", () => {
    const deck = [instance("lgtm", "one"), instance("lgtm", "two"), instance("lgtm", "three")]
    const state = playSideEffect("technical-debt", { deck })
    const owner = Match.player(state, "player-one")

    assert.deepStrictEqual(
      owner?.hand.map(({ id }) => id),
      ["one", "two", "three"],
    )
    assert.strictEqual(owner?.uptime, 96)
    assert.strictEqual(owner?.ongoing[0]?.remainingTurns, 2)
  })

  it("makes LGTM draw one", () => {
    const state = playSideEffect("lgtm", { deck: [instance("null-pointer", "drawn")] })
    assert.deepStrictEqual(
      Match.player(state, "player-one")?.hand.map(({ id }) => id),
      ["drawn"],
    )
  })
})

describe("resolution boundaries", () => {
  it("checks lethal reflected base damage before Stack Overflow's secondary damage", () => {
    const state = playPatchedBug("stack-overflow", "works-on-my-machine", { uptime: 9 })

    assert.strictEqual(state._tag, "Finished")
    if (state._tag !== "Finished") return
    assert.strictEqual(state.winner, "player-two")
    assert.strictEqual(uptime(state, "player-one"), 0)
  })

  it("lets a card spend its owner down to one Uptime but never below it", () => {
    const bug = instance("zero-day")
    const state = bugPhase(
      makePlayer("player-one", { uptime: 20, hand: [bug] }),
      makePlayer("player-two"),
    )
    assert.strictEqual(
      Match.canPlayBug(state, {
        _tag: "PlayBug",
        playerId: "player-one",
        cardInstanceId: bug.id,
      }),
      true,
    )
    const played = Match.playBug(state, {
      _tag: "PlayBug",
      playerId: "player-one",
      cardInstanceId: bug.id,
    })
    assert.strictEqual(uptime(played, "player-one"), 1)
  })

  it("floors self-damage from a card at one Uptime", () => {
    const state = playBug("stack-overflow", { uptime: 9 })

    assert.notStrictEqual(state._tag, "Finished")
    assert.strictEqual(uptime(state, "player-one"), 1)
  })

  it("floors a failed deployment check at one Uptime", () => {
    const failureSeed = Array.from({ length: 10_000 }, (_, seed) => seed + 1).find(
      (seed) => Random.integer(Random.seeded(seed), 2)[0] === 1,
    )
    assert.ok(failureSeed)

    const state = playSideEffect("friday-night-release", { uptime: 5 }, {}, failureSeed)
    assert.notStrictEqual(state._tag, "Finished")
    assert.strictEqual(uptime(state, "player-one"), 1)
  })

  it("floors stacked self-authored ongoing damage at one Uptime", () => {
    const debt = {
      id: "debt",
      sourceCardId: "technical-debt",
      sourcePlayerId: "player-one" as const,
      kind: "Damage" as const,
      amount: 4,
      remainingTurns: 3,
    }
    const state = Match.endTurn(
      importPhase(makePlayer("player-one", { uptime: 5, ongoing: [debt, { ...debt, id: "debt-2" }] }), makePlayer("player-two")),
    )

    assert.notStrictEqual(state._tag, "Finished")
    assert.strictEqual(uptime(state, "player-one"), 1)
  })

  it("still lets opponent-authored ongoing damage defeat a player", () => {
    const state = Match.endTurn(
      importPhase(
        makePlayer("player-one", {
          uptime: 4,
          ongoing: [
            {
              id: "opponent-dot",
              sourceCardId: "future-opponent-dot",
              sourcePlayerId: "player-two",
              kind: "Damage",
              amount: 4,
              remainingTurns: 1,
            },
          ],
        }),
        makePlayer("player-two"),
      ),
    )

    assert.strictEqual(state._tag, "Finished")
    assert.strictEqual(uptime(state, "player-one"), 0)
  })
})
