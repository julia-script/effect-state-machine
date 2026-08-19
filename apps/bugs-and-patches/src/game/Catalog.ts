import * as Schema from "effect/Schema"
import * as Card from "./Card.js"

const rawCatalog = [
  {
    _tag: "Bug",
    id: "off-by-one",
    name: "Off-by-one",
    rulesText:
      "After this Bug resolves, discard the most recently drawn card remaining in your hand.",
    flavorText: "It worked perfectly, except for the part that didn't.",
    cost: 4,
    attack: 12,
    abilities: [
      { _tag: "Discard", trigger: "AfterDamage", subject: "Self", count: 1, chooser: "MostRecent" },
    ],
  },
  {
    _tag: "Bug",
    id: "null-pointer",
    name: "Null Pointer",
    rulesText: "No secondary effect.",
    flavorText: "The value was definitely here a moment ago.",
    cost: 4,
    attack: 12,
    abilities: [],
  },
  {
    _tag: "Bug",
    id: "heisenbug",
    name: "Heisenbug",
    rulesText: "This Bug is undefendable.",
    flavorText: "It stopped happening when we opened the debugger.",
    cost: 8,
    attack: 12,
    abilities: [{ _tag: "Undefendable", trigger: "OnPlay", subject: "Opponent" }],
  },
  {
    _tag: "Bug",
    id: "ddos",
    name: "DDoS",
    rulesText: "Your opponent cannot play a Bug during their next turn.",
    flavorText: "One request is a question. A million are an architecture review.",
    cost: 8,
    attack: 8,
    abilities: [
      { _tag: "Prohibit", trigger: "AfterDamage", subject: "Opponent", action: "Attack" },
    ],
  },
  {
    _tag: "Bug",
    id: "sql-injection",
    name: "SQL Injection",
    rulesText: "After this Bug resolves, your opponent discards one random card.",
    flavorText: "Please enter your name and the rest of the database.",
    cost: 8,
    attack: 8,
    abilities: [
      { _tag: "Discard", trigger: "AfterDamage", subject: "Opponent", count: 1, chooser: "Random" },
    ],
  },
  {
    _tag: "Bug",
    id: "stack-overflow",
    name: "Stack Overflow",
    rulesText: "After this Bug resolves, lose 8 Uptime.",
    flavorText: "There was plenty of room when we started.",
    cost: 8,
    attack: 20,
    abilities: [{ _tag: "Damage", trigger: "AfterDamage", subject: "Self", amount: 8 }],
  },
  {
    _tag: "Bug",
    id: "zero-day",
    name: "0-day",
    rulesText: "This Bug is undefendable.",
    flavorText: "The fix is scheduled for yesterday.",
    cost: 20,
    attack: 32,
    abilities: [{ _tag: "Undefendable", trigger: "OnPlay", subject: "Opponent" }],
  },
  {
    _tag: "Patch",
    id: "git-revert",
    name: "git revert",
    rulesText: "Remove the most recently applied ongoing effect from yourself.",
    flavorText: "This reverts the part where everything caught fire.",
    cost: 4,
    defense: 12,
    abilities: [{ _tag: "CancelLatestOngoing", trigger: "OnDefense", subject: "Self" }],
  },
  {
    _tag: "Patch",
    id: "switch-on-and-off",
    name: "Switch On and Off",
    rulesText: "Remove all damaging ongoing effects and prohibitions from yourself.",
    flavorText: "We have exhausted every sophisticated option.",
    cost: 12,
    defense: 28,
    abilities: [{ _tag: "CleanseNegative", trigger: "OnDefense", subject: "Self" }],
  },
  {
    _tag: "Patch",
    id: "restore-from-backup",
    name: "Restore from Backup",
    rulesText: "After defending, gain 12 Uptime.",
    flavorText: "Good news: the backup exists.",
    cost: 8,
    defense: 12,
    abilities: [{ _tag: "Heal", trigger: "OnDefense", subject: "Self", amount: 12 }],
  },
  {
    _tag: "Patch",
    id: "works-on-my-machine",
    name: "Works on My Machine",
    rulesText: "Redirect all base damage remaining after this Patch to the Bug's owner.",
    flavorText: "Cannot reproduce.",
    cost: 4,
    defense: 4,
    abilities: [{ _tag: "ReflectRemaining", trigger: "OnDefense", subject: "Opponent" }],
  },
  {
    _tag: "Patch",
    id: "containerize",
    name: "Containerize",
    rulesText: "Cancel the Bug's secondary abilities. Its base attack still resolves.",
    flavorText: "It can't break what it can't reach.",
    cost: 4,
    defense: 12,
    abilities: [{ _tag: "CancelSecondary", trigger: "OnDefense", subject: "Opponent" }],
  },
  {
    _tag: "SideEffect",
    id: "merge-conflict",
    name: "Merge Conflict",
    rulesText: "Both players discard one random card, then draw one card.",
    flavorText: "Resolved by accepting both changes and understanding neither.",
    cost: 4,
    abilities: [
      { _tag: "Discard", trigger: "OnPlay", subject: "Self", count: 1, chooser: "Random" },
      { _tag: "Discard", trigger: "OnPlay", subject: "Opponent", count: 1, chooser: "Random" },
      { _tag: "Draw", trigger: "OnPlay", subject: "Self", count: 1 },
    ],
  },
  {
    _tag: "SideEffect",
    id: "friday-night-release",
    name: "Friday Night Release",
    rulesText: "Run a 50/50 deployment check. Gain 20 Uptime on success or lose 20 on failure.",
    flavorText: "The tests were green enough.",
    cost: 4,
    abilities: [
      {
        _tag: "UptimeCheck",
        trigger: "OnPlay",
        subject: "Self",
        successAmount: 20,
        failureAmount: -20,
      },
    ],
  },
  {
    _tag: "SideEffect",
    id: "technical-debt",
    name: "Technical Debt",
    rulesText: "Draw three cards, then lose 4 Uptime at the end of each of your next three turns.",
    flavorText: "Future us has much more free time.",
    cost: 0,
    abilities: [
      { _tag: "Draw", trigger: "OnPlay", subject: "Self", count: 3 },
      { _tag: "OverTime", trigger: "OnPlay", subject: "Self", kind: "Damage", amount: 4, turns: 3 },
    ],
  },
  {
    _tag: "SideEffect",
    id: "lgtm",
    name: "LGTM",
    rulesText: "Draw one card.",
    flavorText: "No questions asked.",
    cost: 0,
    abilities: [{ _tag: "Draw", trigger: "OnPlay", subject: "Self", count: 1 }],
  },
] as const

export const catalog = Schema.decodeUnknownSync(Schema.Array(Card.Card))(rawCatalog)

const catalogById = new Map(catalog.map((card) => [card.id, card]))

export const find = (id: Card.CardId): Card.Card | undefined => catalogById.get(id)

export const stackRecipe = [
  ["off-by-one", 2],
  ["null-pointer", 2],
  ["heisenbug", 2],
  ["ddos", 2],
  ["sql-injection", 2],
  ["stack-overflow", 1],
  ["zero-day", 1],
  ["git-revert", 2],
  ["switch-on-and-off", 2],
  ["restore-from-backup", 2],
  ["works-on-my-machine", 2],
  ["containerize", 2],
  ["merge-conflict", 2],
  ["friday-night-release", 2],
  ["technical-debt", 2],
  ["lgtm", 2],
] as const

export const stack = (): ReadonlyArray<Card.CardInstance> =>
  stackRecipe.flatMap(([cardId, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `v0-${cardId}-${index + 1}`,
      cardId,
    })),
  )
