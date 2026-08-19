import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as Card from "../src/game/Card.js"
import * as Catalog from "../src/game/Catalog.js"
import * as Match from "../src/game/Match.js"
import * as Random from "../src/game/Random.js"

describe("v0 card catalog", () => {
  it("decodes all selected cards with presentation-independent copy", () => {
    const decoded = Schema.decodeUnknownSync(Schema.Array(Card.Card))(Catalog.catalog)

    assert.strictEqual(decoded.length, 16)
    assert.strictEqual(decoded.filter(Card.isBug).length, 7)
    assert.strictEqual(decoded.filter(Card.isPatch).length, 5)
    assert.strictEqual(decoded.filter(Card.isSideEffect).length, 4)
    for (const card of decoded) {
      assert.ok(card.rulesText.length > 0)
      assert.ok(card.flavorText.length > 0)
    }
  })

  it("defines the exact provisional values and mechanics", () => {
    const summary = Catalog.catalog.map((card) => ({
      id: card.id,
      type: card._tag,
      cost: card.cost,
      power: Card.isBug(card) ? card.attack : Card.isPatch(card) ? card.defense : null,
      abilities: card.abilities.map((ability) => ability._tag),
    }))

    assert.deepStrictEqual(summary, [
      { id: "off-by-one", type: "Bug", cost: 4, power: 12, abilities: ["Discard"] },
      { id: "null-pointer", type: "Bug", cost: 4, power: 12, abilities: [] },
      { id: "heisenbug", type: "Bug", cost: 8, power: 12, abilities: ["Undefendable"] },
      { id: "ddos", type: "Bug", cost: 8, power: 8, abilities: ["Prohibit"] },
      { id: "sql-injection", type: "Bug", cost: 8, power: 8, abilities: ["Discard"] },
      { id: "stack-overflow", type: "Bug", cost: 8, power: 20, abilities: ["Damage"] },
      { id: "zero-day", type: "Bug", cost: 20, power: 32, abilities: ["Undefendable"] },
      {
        id: "git-revert",
        type: "Patch",
        cost: 4,
        power: 12,
        abilities: ["CancelLatestOngoing"],
      },
      {
        id: "switch-on-and-off",
        type: "Patch",
        cost: 12,
        power: 28,
        abilities: ["CleanseNegative"],
      },
      {
        id: "restore-from-backup",
        type: "Patch",
        cost: 8,
        power: 12,
        abilities: ["Heal"],
      },
      {
        id: "works-on-my-machine",
        type: "Patch",
        cost: 4,
        power: 4,
        abilities: ["ReflectRemaining"],
      },
      {
        id: "containerize",
        type: "Patch",
        cost: 4,
        power: 12,
        abilities: ["CancelSecondary"],
      },
      {
        id: "merge-conflict",
        type: "SideEffect",
        cost: 4,
        power: null,
        abilities: ["Discard", "Discard", "Draw"],
      },
      {
        id: "friday-night-release",
        type: "SideEffect",
        cost: 4,
        power: null,
        abilities: ["UptimeCheck"],
      },
      {
        id: "technical-debt",
        type: "SideEffect",
        cost: 0,
        power: null,
        abilities: ["Draw", "OverTime"],
      },
      { id: "lgtm", type: "SideEffect", cost: 0, power: null, abilities: ["Draw"] },
    ])
  })

  it("builds the exact 30-card 12/10/8 Stack with unique instance identities", () => {
    const stack = Catalog.stack()
    const counts = new Map<string, number>()
    const categories = { Bug: 0, Patch: 0, SideEffect: 0 }

    for (const instance of stack) {
      counts.set(instance.cardId, (counts.get(instance.cardId) ?? 0) + 1)
      const definition = Catalog.find(instance.cardId)
      assert.ok(definition)
      categories[definition._tag] += 1
    }

    assert.strictEqual(stack.length, 30)
    assert.strictEqual(new Set(stack.map(({ id }) => id)).size, 30)
    assert.deepStrictEqual(categories, { Bug: 12, Patch: 10, SideEffect: 8 })
    assert.deepStrictEqual(
      [...counts],
      Catalog.stackRecipe.map(([id, count]) => [id, count]),
    )

    const input = Match.defaultInput(42)
    assert.strictEqual(
      input.playerOneDeck.some(({ id }) => input.playerTwoDeck.some((other) => other.id === id)),
      false,
    )
    assert.deepStrictEqual(
      Match.initial(input).players.map(({ uptime }) => uptime),
      [100, 100],
    )
    assert.strictEqual(Catalog.find("switch-on-and-off")?.name, "Switch On and Off")
    assert.strictEqual(Catalog.find("turn-it-off-and-on-again"), undefined)
  })

  it("shuffles reproducibly from the retained seed", () => {
    const first = Random.shuffle(Random.seeded(123), Catalog.stack())[0]
    const repeated = Random.shuffle(Random.seeded(123), Catalog.stack())[0]
    const different = Random.shuffle(Random.seeded(456), Catalog.stack())[0]

    assert.deepStrictEqual(first, repeated)
    assert.strictEqual(JSON.stringify(first) === JSON.stringify(different), false)
  })
})
