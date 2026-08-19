import * as Schema from "effect/Schema"
import * as Card from "./Card.js"
import * as Catalog from "./Catalog.js"
import * as Random from "./Random.js"

export const Condition = Schema.TaggedStruct("Prohibition", {
  id: Schema.String,
  action: Schema.Literals(["Attack", "Defend"]),
})
export type Condition = Schema.Schema.Type<typeof Condition>

export const OngoingAbility = Schema.Struct({
  id: Schema.String,
  sourceCardId: Card.CardId,
  sourcePlayerId: Schema.optional(Card.PlayerId),
  kind: Schema.Literals(["Damage", "Heal"]),
  amount: Schema.Int,
  remainingTurns: Schema.Int,
})
export type OngoingAbility = Schema.Schema.Type<typeof OngoingAbility>

export const Player = Schema.Struct({
  id: Card.PlayerId,
  uptime: Schema.Int,
  deck: Schema.Array(Card.CardInstance),
  hand: Schema.Array(Card.CardInstance),
  discard: Schema.Array(Card.CardInstance),
  conditions: Schema.Array(Condition),
  ongoing: Schema.Array(OngoingAbility),
})
export type Player = Schema.Schema.Type<typeof Player>

const commonFields = {
  players: Schema.Array(Player),
  activePlayer: Card.PlayerId,
  turn: Schema.Int,
  bugPlaysRemaining: Schema.Int,
  randomState: Schema.Int,
  lastBug: Schema.NullOr(Card.CardInstance),
  lastPatch: Schema.NullOr(Card.CardInstance),
}

export const State = Schema.Union([
  Schema.TaggedStruct("BugPhase", commonFields),
  Schema.TaggedStruct("PatchResponse", {
    ...commonFields,
    bug: Card.CardInstance,
  }),
  Schema.TaggedStruct("SideEffectPhase", commonFields),
  Schema.TaggedStruct("Finished", {
    ...commonFields,
    winner: Card.PlayerId,
    loser: Card.PlayerId,
    reason: Schema.Literals(["Uptime", "Surrender"]),
  }),
]).pipe(Schema.toTaggedUnion("_tag"))
export type State = Schema.Schema.Type<typeof State>
export type PlayingState = Exclude<State, { readonly _tag: "Finished" }>

export const Input = Schema.Struct({
  playerOneDeck: Schema.Array(Card.CardInstance),
  playerTwoDeck: Schema.Array(Card.CardInstance),
  randomSeed: Schema.Int,
})
export type Input = Schema.Schema.Type<typeof Input>

export const Event = Schema.Union([
  Schema.TaggedStruct("PlayBug", {
    playerId: Card.PlayerId,
    cardInstanceId: Schema.String,
  }),
  Schema.TaggedStruct("PassBug", { playerId: Card.PlayerId }),
  Schema.TaggedStruct("PlayPatch", {
    playerId: Card.PlayerId,
    cardInstanceId: Schema.String,
  }),
  Schema.TaggedStruct("PassPatch", { playerId: Card.PlayerId }),
  Schema.TaggedStruct("PlaySideEffect", {
    playerId: Card.PlayerId,
    cardInstanceId: Schema.String,
  }),
  Schema.TaggedStruct("PassSideEffect", { playerId: Card.PlayerId }),
  Schema.TaggedStruct("Surrender", { playerId: Card.PlayerId }),
]).pipe(Schema.toTaggedUnion("_tag"))
export type Event = Schema.Schema.Type<typeof Event>

export const opponentOf = (playerId: Card.PlayerId): Card.PlayerId =>
  playerId === "player-one" ? "player-two" : "player-one"

export const player = (state: State, playerId: Card.PlayerId): Player | undefined =>
  state.players.find((candidate) => candidate.id === playerId)

const hasDefeatedPlayer = (state: State): boolean =>
  state.players.some((candidate) => candidate.uptime <= 0)

const updatePlayer = <S extends State>(state: S, updated: Player): S => ({
  ...state,
  players: state.players.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
})

const drawOne = (
  self: Player,
  generator: Random.Generator,
): readonly [Player, Random.Generator] => {
  let deck = self.deck
  let discard = self.discard
  let nextGenerator = generator
  if (deck.length === 0 && discard.length > 0) {
    const recycled = Random.shuffle(generator, discard)
    deck = recycled[0]
    discard = []
    nextGenerator = recycled[1]
  }
  const top = deck[0]
  if (top === undefined) return [{ ...self, deck, discard }, nextGenerator]
  return [{ ...self, deck: deck.slice(1), discard, hand: [...self.hand, top] }, nextGenerator]
}

const drawMany = (
  self: Player,
  count: number,
  generator: Random.Generator,
): readonly [Player, Random.Generator] => {
  let current = self
  let nextGenerator = generator
  for (let index = 0; index < Math.max(0, count); index += 1) {
    const next = drawOne(current, nextGenerator)
    current = next[0]
    nextGenerator = next[1]
  }
  return [current, nextGenerator]
}

const initialPlayer = (
  id: Card.PlayerId,
  deck: ReadonlyArray<Card.CardInstance>,
  generator: Random.Generator,
): readonly [Player, Random.Generator] =>
  drawMany(
    { id, uptime: 100, deck, hand: [], discard: [], conditions: [], ongoing: [] },
    5,
    generator,
  )

export const initial = (input: Input): Extract<State, { readonly _tag: "BugPhase" }> => {
  let generator = Random.seeded(input.randomSeed)
  const firstDeck = Random.shuffle(generator, input.playerOneDeck)
  generator = firstDeck[1]
  const secondDeck = Random.shuffle(generator, input.playerTwoDeck)
  generator = secondDeck[1]
  const first = initialPlayer("player-one", firstDeck[0], generator)
  generator = first[1]
  const second = initialPlayer("player-two", secondDeck[0], generator)
  generator = second[1]
  const initiative = Random.integer(generator, 2)
  generator = initiative[1]
  const activePlayer: Card.PlayerId = initiative[0] === 0 ? "player-one" : "player-two"
  const active = activePlayer === "player-one" ? first[0] : second[0]
  const inactive = activePlayer === "player-one" ? second[0] : first[0]
  const openingDraw = drawOne(active, generator)
  const players =
    activePlayer === "player-one" ? [openingDraw[0], inactive] : [inactive, openingDraw[0]]
  return {
    _tag: "BugPhase",
    players,
    activePlayer,
    turn: 1,
    bugPlaysRemaining: 1,
    randomState: openingDraw[1].state,
    lastBug: null,
    lastPatch: null,
  }
}

const cardInHand = (state: State, playerId: Card.PlayerId, instanceId: string) => {
  const owner = player(state, playerId)
  const instance = owner?.hand.find((candidate) => candidate.id === instanceId)
  const definition = instance === undefined ? undefined : Catalog.find(instance.cardId)
  return owner === undefined || instance === undefined || definition === undefined
    ? undefined
    : { owner, instance, definition }
}

export const canPlayBug = (
  state: Extract<State, { readonly _tag: "BugPhase" }>,
  event: Extract<Event, { readonly _tag: "PlayBug" }>,
): boolean => {
  const found = cardInHand(state, event.playerId, event.cardInstanceId)
  return (
    event.playerId === state.activePlayer &&
    state.bugPlaysRemaining > 0 &&
    found !== undefined &&
    Card.isBug(found.definition)
  )
}

export const canPlayPatch = (
  state: Extract<State, { readonly _tag: "PatchResponse" }>,
  event: Extract<Event, { readonly _tag: "PlayPatch" }>,
): boolean => {
  const found = cardInHand(state, event.playerId, event.cardInstanceId)
  return (
    event.playerId === opponentOf(state.activePlayer) &&
    found !== undefined &&
    Card.isPatch(found.definition)
  )
}

export const canPlaySideEffect = (
  state: Extract<State, { readonly _tag: "SideEffectPhase" }>,
  event: Extract<Event, { readonly _tag: "PlaySideEffect" }>,
): boolean => {
  const found = cardInHand(state, event.playerId, event.cardInstanceId)
  return (
    event.playerId === state.activePlayer &&
    found !== undefined &&
    Card.isSideEffect(found.definition)
  )
}

const spendAndDiscard = <S extends State>(
  state: S,
  playerId: Card.PlayerId,
  instance: Card.CardInstance,
  cost: number,
): S => {
  const owner = player(state, playerId)
  if (owner === undefined) return state
  return updatePlayer(state, {
    ...owner,
    uptime: Math.max(1, owner.uptime - cost),
    hand: owner.hand.filter((card) => card.id !== instance.id),
    discard: [...owner.discard, instance],
  })
}

const consumeCondition = <S extends State>(
  state: S,
  playerId: Card.PlayerId,
  action: "Attack" | "Defend",
): S => {
  const owner = player(state, playerId)
  if (owner === undefined) return state
  const index = owner.conditions.findIndex((condition) => condition.action === action)
  if (index < 0) return state
  return updatePlayer(state, {
    ...owner,
    conditions: owner.conditions.filter((_, conditionIndex) => conditionIndex !== index),
  })
}

const hasCondition = (state: State, playerId: Card.PlayerId, action: "Attack" | "Defend") =>
  player(state, playerId)?.conditions.some((condition) => condition.action === action) ?? false

const changeUptime = <S extends State>(
  state: S,
  playerId: Card.PlayerId,
  amount: number,
  minimum = 0,
): S => {
  const owner = player(state, playerId)
  return owner === undefined
    ? state
    : updatePlayer(state, { ...owner, uptime: Math.max(minimum, owner.uptime + amount) })
}

const targetOf = (owner: Card.PlayerId, subject: Card.AbilitySubject): Card.PlayerId =>
  subject === "Self" ? owner : opponentOf(owner)

const applyAbility = <S extends State>(
  state: S,
  ability: Card.Ability,
  ownerId: Card.PlayerId,
  sourceCardId: string,
  sequence: number,
): S => {
  const targetId = targetOf(ownerId, ability.subject)
  const target = player(state, targetId)
  if (target === undefined) return state
  switch (ability._tag) {
    case "Draw": {
      const result = drawMany(target, ability.count, Random.seeded(state.randomState))
      return { ...updatePlayer(state, result[0]), randomState: result[1].state }
    }
    case "Discard": {
      let current = target
      let generator = Random.seeded(state.randomState)
      for (let index = 0; index < ability.count && current.hand.length > 0; index += 1) {
        const selected =
          ability.chooser === "MostRecent"
            ? ([current.hand.length - 1, generator] as const)
            : Random.integer(generator, current.hand.length)
        generator = selected[1]
        const discarded = current.hand[selected[0]]
        if (discarded === undefined) continue
        current = {
          ...current,
          hand: current.hand.filter((card) => card.id !== discarded.id),
          discard: [...current.discard, discarded],
        }
      }
      return { ...updatePlayer(state, current), randomState: generator.state }
    }
    case "Damage":
      return changeUptime(state, targetId, -ability.amount, targetId === ownerId ? 1 : 0)
    case "Heal":
      return changeUptime(state, targetId, ability.amount)
    case "Reflect":
      return changeUptime(state, targetId, -ability.amount)
    case "ReflectRemaining":
      return state
    case "ExtraBug":
      return targetId === state.activePlayer
        ? { ...state, bugPlaysRemaining: state.bugPlaysRemaining + ability.count }
        : state
    case "Undefendable":
    case "CancelSecondary":
      return state
    case "CancelOngoing":
      return updatePlayer(state, {
        ...target,
        ongoing: target.ongoing.filter((ongoing) => ongoing.kind !== ability.kind),
      })
    case "CancelLatestOngoing":
      return updatePlayer(state, {
        ...target,
        ongoing: target.ongoing.slice(0, -1),
      })
    case "CleanseNegative":
      return updatePlayer(state, {
        ...target,
        conditions: [],
        ongoing: target.ongoing.filter((ongoing) => ongoing.kind !== "Damage"),
      })
    case "UptimeCheck": {
      const checked = Random.integer(Random.seeded(state.randomState), 2)
      const changed = changeUptime(
        state,
        targetId,
        checked[0] === 0 ? ability.successAmount : ability.failureAmount,
        targetId === ownerId && checked[0] !== 0 ? 1 : 0,
      )
      return { ...changed, randomState: checked[1].state }
    }
    case "OverTime":
      return updatePlayer(state, {
        ...target,
        ongoing: [
          ...target.ongoing,
          {
            id: `${sourceCardId}-${state.turn}-${sequence}`,
            sourceCardId,
            sourcePlayerId: ownerId,
            kind: ability.kind,
            amount: ability.amount,
            remainingTurns: ability.turns,
          },
        ],
      })
    case "Prohibit":
      return updatePlayer(state, {
        ...target,
        conditions: [
          ...target.conditions,
          {
            _tag: "Prohibition",
            id: `${sourceCardId}-${state.turn}-${sequence}`,
            action: ability.action,
          },
        ],
      })
  }
}

const applyAbilities = <S extends State>(
  state: S,
  abilities: ReadonlyArray<Card.Ability>,
  ownerId: Card.PlayerId,
  sourceCardId: string,
  trigger: Card.AbilityTrigger,
): S =>
  abilities
    .filter((ability) => ability.trigger === trigger)
    .reduce(
      (current, ability, index) =>
        hasDefeatedPlayer(current)
          ? current
          : applyAbility(current, ability, ownerId, sourceCardId, index),
      state,
    )

const finishIfDefeated = <S extends PlayingState>(state: S): State => {
  const loser = state.players.find((candidate) => candidate.uptime <= 0)
  return loser === undefined
    ? state
    : {
        ...state,
        _tag: "Finished",
        winner: opponentOf(loser.id),
        loser: loser.id,
        reason: "Uptime",
      }
}

const toPostBugPhase = (state: PlayingState): State =>
  state.bugPlaysRemaining > 0 ? { ...state, _tag: "BugPhase" } : { ...state, _tag: "SideEffectPhase" }

const resolveCombat = (
  state:
    | Extract<State, { readonly _tag: "PatchResponse" }>
    | Extract<State, { readonly _tag: "BugPhase" }>,
  bugInstance: Card.CardInstance,
  patchInstance?: Card.CardInstance,
): State => {
  const bug = Catalog.find(bugInstance.cardId)
  const patch = patchInstance === undefined ? undefined : Catalog.find(patchInstance.cardId)
  if (bug === undefined || !Card.isBug(bug)) return { ...state, _tag: "SideEffectPhase" }
  const defenderId = opponentOf(state.activePlayer)
  const defense = patch !== undefined && Card.isPatch(patch) ? patch.defense : 0
  const remainingDamage = Math.max(0, bug.attack - defense)
  const reflectsRemaining = patch !== undefined && Card.hasAbility(patch, "ReflectRemaining")
  let current: PlayingState = changeUptime(
    state,
    reflectsRemaining ? state.activePlayer : defenderId,
    -remainingDamage,
  )
  current = { ...current, lastBug: bugInstance, lastPatch: patchInstance ?? null }
  const afterBaseDamage = finishIfDefeated(current)
  if (afterBaseDamage._tag === "Finished") return afterBaseDamage
  current = afterBaseDamage
  const cancelsBug = patch !== undefined && Card.hasAbility(patch, "CancelSecondary")
  if (!cancelsBug)
    current = applyAbilities(current, bug.abilities, state.activePlayer, bug.id, "AfterDamage")
  const afterBugAbilities = finishIfDefeated(current)
  if (afterBugAbilities._tag === "Finished") return afterBugAbilities
  current = afterBugAbilities
  if (patch !== undefined && Card.isPatch(patch)) {
    current = applyAbilities(current, patch.abilities, defenderId, patch.id, "OnDefense")
  }
  const afterPatchAbilities = finishIfDefeated(current)
  if (afterPatchAbilities._tag === "Finished") return afterPatchAbilities
  return toPostBugPhase(afterPatchAbilities)
}

export const playBug = (
  state: Extract<State, { readonly _tag: "BugPhase" }>,
  event: Extract<Event, { readonly _tag: "PlayBug" }>,
): State => {
  const found = cardInHand(state, event.playerId, event.cardInstanceId)
  if (found === undefined || !Card.isBug(found.definition)) return state
  let current = spendAndDiscard(state, event.playerId, found.instance, found.definition.cost)
  current = {
    ...current,
    bugPlaysRemaining: Math.max(0, current.bugPlaysRemaining - 1),
    lastBug: found.instance,
    lastPatch: null,
  }
  current = applyAbilities(
    current,
    found.definition.abilities,
    event.playerId,
    found.definition.id,
    "OnPlay",
  )
  const defenderId = opponentOf(state.activePlayer)
  const skipsDefense =
    Card.hasAbility(found.definition, "Undefendable") || hasCondition(current, defenderId, "Defend")
  if (hasCondition(current, defenderId, "Defend"))
    current = consumeCondition(current, defenderId, "Defend")
  if (skipsDefense) return resolveCombat(current, found.instance)
  return { ...current, _tag: "PatchResponse", bug: found.instance }
}

export const resolvePatch = (
  state: Extract<State, { readonly _tag: "PatchResponse" }>,
  event?: Extract<Event, { readonly _tag: "PlayPatch" }>,
): State => {
  if (event === undefined) return resolveCombat(state, state.bug)
  const found = cardInHand(state, event.playerId, event.cardInstanceId)
  if (found === undefined || !Card.isPatch(found.definition)) return state
  const paid = spendAndDiscard(state, event.playerId, found.instance, found.definition.cost)
  return resolveCombat(paid, state.bug, found.instance)
}

const processOngoing = <S extends PlayingState>(state: S, playerId: Card.PlayerId): S => {
  const owner = player(state, playerId)
  if (owner === undefined) return state
  let uptime = owner.uptime
  for (const ongoing of owner.ongoing) {
    const amount = ongoing.kind === "Damage" ? -ongoing.amount : ongoing.amount
    const selfOriginated = ongoing.sourcePlayerId === undefined || ongoing.sourcePlayerId === playerId
    uptime = Math.max(amount < 0 && selfOriginated ? 1 : 0, uptime + amount)
    if (uptime <= 0) break
  }
  return updatePlayer(state, {
    ...owner,
    uptime: Math.max(0, uptime),
    ongoing: owner.ongoing
      .map((ongoing) => ({ ...ongoing, remainingTurns: ongoing.remainingTurns - 1 }))
      .filter((ongoing) => ongoing.remainingTurns > 0),
  })
}

export const endTurn = (state: Extract<State, { readonly _tag: "SideEffectPhase" }>): State => {
  const processed = processOngoing(state, state.activePlayer)
  const finished = finishIfDefeated(processed)
  if (finished._tag === "Finished") return finished
  const nextActive = opponentOf(state.activePlayer)
  let next: PlayingState = {
    ...finished,
    _tag: "BugPhase",
    activePlayer: nextActive,
    turn: state.turn + 1,
    bugPlaysRemaining: 1,
    lastBug: null,
    lastPatch: null,
  }
  const nextOwner = player(next, nextActive)
  if (nextOwner !== undefined) {
    const drawn = drawOne(nextOwner, Random.seeded(next.randomState))
    next = { ...updatePlayer(next, drawn[0]), randomState: drawn[1].state }
  }
  if (hasCondition(next, nextActive, "Attack")) {
    const consumed = consumeCondition(next, nextActive, "Attack")
    return { ...consumed, _tag: "SideEffectPhase" }
  }
  return next
}

export const playSideEffect = (
  state: Extract<State, { readonly _tag: "SideEffectPhase" }>,
  event: Extract<Event, { readonly _tag: "PlaySideEffect" }>,
): State => {
  const found = cardInHand(state, event.playerId, event.cardInstanceId)
  if (found === undefined || !Card.isSideEffect(found.definition)) return state
  const paid = spendAndDiscard(state, event.playerId, found.instance, found.definition.cost)
  const resolved = applyAbilities(
    paid,
    found.definition.abilities,
    event.playerId,
    found.definition.id,
    "OnPlay",
  )
  const finished = finishIfDefeated(resolved)
  return finished._tag === "Finished" ? finished : endTurn({ ...finished, _tag: "SideEffectPhase" })
}

export const surrender = (state: PlayingState, playerId: Card.PlayerId): State => ({
  ...state,
  _tag: "Finished",
  winner: opponentOf(playerId),
  loser: playerId,
  reason: "Surrender",
})

export const passBug = (state: Extract<State, { readonly _tag: "BugPhase" }>): State => ({
  ...state,
  _tag: "SideEffectPhase",
  bugPlaysRemaining: 0,
})

export const defaultInput = (seed: number): Input => ({
  playerOneDeck: Catalog.stack(),
  playerTwoDeck: Catalog.stack().map((card) => ({ ...card, id: `two-${card.id}` })),
  randomSeed: seed,
})
