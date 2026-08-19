import * as Schema from "effect/Schema"

export const PlayerId = Schema.Literals(["player-one", "player-two"])
export type PlayerId = Schema.Schema.Type<typeof PlayerId>

export const CardId = Schema.String
export type CardId = Schema.Schema.Type<typeof CardId>

export const CardInstance = Schema.Struct({
  id: Schema.String,
  cardId: CardId,
})
export type CardInstance = Schema.Schema.Type<typeof CardInstance>

export const AbilityTrigger = Schema.Literals(["OnPlay", "AfterDamage", "OnDefense", "EndTurn"])
export type AbilityTrigger = Schema.Schema.Type<typeof AbilityTrigger>

export const AbilitySubject = Schema.Literals(["Self", "Opponent"])
export type AbilitySubject = Schema.Schema.Type<typeof AbilitySubject>

const Draw = Schema.TaggedStruct("Draw", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  count: Schema.Int,
})

const Discard = Schema.TaggedStruct("Discard", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  count: Schema.Int,
  chooser: Schema.Literals(["Random", "MostRecent"]),
})

const Damage = Schema.TaggedStruct("Damage", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  amount: Schema.Int,
})

const Heal = Schema.TaggedStruct("Heal", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  amount: Schema.Int,
})

const ReflectAbility = Schema.TaggedStruct("Reflect", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  amount: Schema.Int,
})

const ReflectRemaining = Schema.TaggedStruct("ReflectRemaining", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
})

const ExtraBug = Schema.TaggedStruct("ExtraBug", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  count: Schema.Int,
})

const Undefendable = Schema.TaggedStruct("Undefendable", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
})

const CancelSecondary = Schema.TaggedStruct("CancelSecondary", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
})

const CancelOngoing = Schema.TaggedStruct("CancelOngoing", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  kind: Schema.Literals(["Damage", "Heal"]),
})

const CancelLatestOngoing = Schema.TaggedStruct("CancelLatestOngoing", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
})

const CleanseNegative = Schema.TaggedStruct("CleanseNegative", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
})

const UptimeCheck = Schema.TaggedStruct("UptimeCheck", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  successAmount: Schema.Int,
  failureAmount: Schema.Int,
})

const OverTime = Schema.TaggedStruct("OverTime", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  kind: Schema.Literals(["Damage", "Heal"]),
  amount: Schema.Int,
  turns: Schema.Int,
})

const Prohibit = Schema.TaggedStruct("Prohibit", {
  trigger: AbilityTrigger,
  subject: AbilitySubject,
  action: Schema.Literals(["Attack", "Defend"]),
})

export const Ability = Schema.Union([
  Draw,
  Discard,
  Damage,
  Heal,
  ReflectAbility,
  ReflectRemaining,
  ExtraBug,
  Undefendable,
  CancelSecondary,
  CancelOngoing,
  CancelLatestOngoing,
  CleanseNegative,
  UptimeCheck,
  OverTime,
  Prohibit,
])
export type Ability = Schema.Schema.Type<typeof Ability>

const fields = {
  id: CardId,
  name: Schema.String,
  rulesText: Schema.String,
  flavorText: Schema.String,
  cost: Schema.Int,
}

export const Bug = Schema.TaggedStruct("Bug", {
  ...fields,
  attack: Schema.Int,
  abilities: Schema.Array(Ability),
})
export type Bug = Schema.Schema.Type<typeof Bug>

export const Patch = Schema.TaggedStruct("Patch", {
  ...fields,
  defense: Schema.Int,
  abilities: Schema.Array(Ability),
})
export type Patch = Schema.Schema.Type<typeof Patch>

export const SideEffect = Schema.TaggedStruct("SideEffect", {
  ...fields,
  abilities: Schema.NonEmptyArray(Ability),
})
export type SideEffect = Schema.Schema.Type<typeof SideEffect>

export const Card = Schema.Union([Bug, Patch, SideEffect])
export type Card = Schema.Schema.Type<typeof Card>

export const isBug = (card: Card): card is Bug => card._tag === "Bug"
export const isPatch = (card: Card): card is Patch => card._tag === "Patch"
export const isSideEffect = (card: Card): card is SideEffect => card._tag === "SideEffect"

export const hasAbility = (card: Card, tag: Ability["_tag"]): boolean =>
  card.abilities.some((ability) => ability._tag === tag)
