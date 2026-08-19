import { useMemo, useState } from "react"
import * as Catalog from "../game/Catalog.js"
import type * as Card from "../game/Card.js"
import type * as Protocol from "../protocol/Protocol.js"
import { Battle } from "./components/Battle.js"

export const BATTLE_PREVIEW_PATH = "/__dev/battle"

export const isBattlePreviewPath = (development: boolean, pathname: string): boolean =>
  development && pathname === BATTLE_PREVIEW_PATH

type ScenarioId =
  | "bug"
  | "patch"
  | "combat"
  | "side-effect"
  | "thinking"
  | "offline"
  | "finished"

interface BattleScenario {
  readonly id: ScenarioId
  readonly label: string
  readonly note: string
  readonly view: Protocol.PlayerView
}

const card = (cardId: string, suffix = "preview"): Protocol.PlayerView["hand"][number] => {
  const definition = Catalog.find(cardId)
  if (definition === undefined) throw new Error(`Unknown preview card: ${cardId}`)
  return { instance: { id: `${cardId}-${suffix}`, cardId }, card: definition }
}

const player = (
  id: Card.PlayerId,
  displayName: string,
  uptime: number,
  options: {
    readonly agent?: boolean
    readonly presence?: Protocol.Presence
    readonly handCount?: number
    readonly conditions?: Protocol.PlayerView["players"][number]["conditions"]
    readonly ongoing?: Protocol.PlayerView["players"][number]["ongoing"]
  } = {},
): Protocol.PlayerView["players"][number] => ({
  id,
  identity: options.agent
    ? { kind: "Agent", displayName, github: null }
    : { kind: "Account", displayName, github: null },
  uptime,
  handCount: options.handCount ?? 5,
  deckCount: 23,
  discardCount: 2,
  conditions: options.conditions ?? [],
  ongoing: options.ongoing ?? [],
  presence: options.presence ?? "Connected",
})

const hand = [
  card("sql-injection"),
  card("technical-debt"),
  card("off-by-one"),
  card("restore-from-backup"),
  card("merge-conflict"),
]

const legal = (
  action: Protocol.LegalAction["action"],
  visible: Protocol.PlayerView["hand"][number],
  enabled: boolean,
  reason: string | null = null,
): Protocol.LegalAction => ({ action, cardInstanceId: visible.instance.id, enabled, reason })

const pass = (action: "PassBug" | "PassPatch" | "PassSideEffect"): Protocol.LegalAction => ({
  action,
  cardInstanceId: null,
  enabled: true,
  reason: null,
})

const surrender: Protocol.LegalAction = {
  action: "Surrender",
  cardInstanceId: null,
  enabled: true,
  reason: null,
}

const base = (overrides: Partial<Protocol.PlayerView> = {}): Protocol.PlayerView => ({
  matchId: "PREVIEW1",
  mode: "Friendly",
  viewer: "player-one",
  phase: "BugPhase",
  turn: 4,
  activePlayer: "player-one",
  players: [
    player("player-one", "julia-script", 72),
    player("player-two", "Codex", 56, { agent: true }),
  ],
  hand,
  lastBug: null,
  lastPatch: null,
  legalActions: [
    legal("PlayBug", hand[0]!, true),
    legal("PlaySideEffect", hand[1]!, false, "Wait for the Side Effect phase."),
    legal("PlayBug", hand[2]!, true),
    legal("PlayPatch", hand[3]!, false, "Patches answer an incoming Bug."),
    legal("PlaySideEffect", hand[4]!, false, "Wait for the Side Effect phase."),
    pass("PassBug"),
    surrender,
  ],
  outcome: null,
  ...overrides,
})

export const battleScenarios: ReadonlyArray<BattleScenario> = [
  {
    id: "bug",
    label: "Your Bug phase",
    note: "Playable and unavailable cards, projected Uptime, and pass behavior.",
    view: base(),
  },
  {
    id: "patch",
    label: "Patch response",
    note: "An opponent Bug is staged while your Patch choices remain inspectable.",
    view: base({
      phase: "PatchResponse",
      activePlayer: "player-two",
      lastBug: card("sql-injection", "staged"),
      legalActions: [
        legal("PlayBug", hand[0]!, false, "The Bug has already been shipped."),
        legal("PlaySideEffect", hand[1]!, false, "Resolve the incoming Bug first."),
        legal("PlayBug", hand[2]!, false, "The Bug has already been shipped."),
        legal("PlayPatch", hand[3]!, true),
        legal("PlaySideEffect", hand[4]!, false, "Resolve the incoming Bug first."),
        pass("PassPatch"),
        surrender,
      ],
    }),
  },
  {
    id: "combat",
    label: "Combat pair",
    note: "Bug and Patch proportions, spacing, and score previews on one stage.",
    view: base({
      phase: "PatchResponse",
      activePlayer: "player-two",
      lastBug: card("sql-injection", "combat"),
      lastPatch: card("restore-from-backup", "combat"),
      legalActions: [surrender],
    }),
  },
  {
    id: "side-effect",
    label: "Side Effect phase",
    note: "Conditions, ongoing damage, and multiple playable Side Effects.",
    view: base({
      phase: "SideEffectPhase",
      players: [
        player("player-one", "julia-script", 48, {
          conditions: [{ _tag: "Prohibition", id: "no-attack", action: "Attack" }],
          ongoing: [{
            id: "debt-clock",
            sourceCardId: "technical-debt",
            sourcePlayerId: "player-one",
            kind: "Damage",
            amount: 4,
            remainingTurns: 2,
          }],
        }),
        player("player-two", "Codex", 56, { agent: true }),
      ],
      legalActions: [
        ...hand.map((visible) =>
          legal(
            visible.card._tag === "SideEffect"
              ? "PlaySideEffect"
              : visible.card._tag === "Bug"
                ? "PlayBug"
                : "PlayPatch",
            visible,
            visible.card._tag === "SideEffect",
            visible.card._tag === "SideEffect" ? null : "Only Side Effects can be played now.",
          ),
        ),
        pass("PassSideEffect"),
        surrender,
      ],
    }),
  },
  {
    id: "thinking",
    label: "Agent thinking",
    note: "Opponent-turn messaging and the stable waiting layout.",
    view: base({ activePlayer: "player-two", legalActions: [surrender] }),
  },
  {
    id: "offline",
    label: "Agent disconnected",
    note: "The wake-up warning without a live agent session.",
    view: base({
      activePlayer: "player-two",
      players: [
        player("player-one", "julia-script", 72),
        player("player-two", "Codex", 56, { agent: true, presence: "Disconnected" }),
      ],
      legalActions: [surrender],
    }),
  },
  {
    id: "finished",
    label: "Victory",
    note: "Finished board and delayed result treatment.",
    view: base({
      phase: "Finished",
      activePlayer: null,
      players: [
        player("player-one", "julia-script", 12),
        player("player-two", "Codex", 0, { agent: true }),
      ],
      legalActions: [],
      outcome: { winner: "player-one", loser: "player-two", reason: "Uptime" },
    }),
  },
]

export const scenarioFromSearch = (search: string): BattleScenario => {
  const requested = new URLSearchParams(search).get("scenario")
  return battleScenarios.find(({ id }) => id === requested) ?? battleScenarios[0]!
}

export const BattlePreview = () => {
  const initial = useMemo(() => scenarioFromSearch(location.search), [])
  const [scenarioId, setScenarioId] = useState<ScenarioId>(initial.id)
  const [pending, setPending] = useState(false)
  const [lastCommand, setLastCommand] = useState<string | null>(null)
  const scenario = battleScenarios.find(({ id }) => id === scenarioId) ?? battleScenarios[0]!

  return (
    <main className="battle-preview">
      <header className="battle-preview__toolbar">
        <strong>Battle states</strong>
        <label>
          <span>Scenario</span>
          <select
            value={scenario.id}
            onChange={(event) => {
              const id = event.target.value as ScenarioId
              setScenarioId(id)
              setLastCommand(null)
              history.replaceState(null, "", `${BATTLE_PREVIEW_PATH}?scenario=${id}`)
            }}
          >
            {battleScenarios.map(({ id, label }) => (
              <option value={id} key={id}>{label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => setPending((value) => !value)}
        >
          {pending ? "Stop pending" : "Show pending"}
        </button>
        <span>{lastCommand === null ? scenario.note : `Captured: ${lastCommand}`}</span>
      </header>
      <div className="battle-preview__arena">
        <Battle
          key={scenario.id}
          view={scenario.view}
          pending={pending}
          notice={null}
          onDismissNotice={() => undefined}
          onCommand={(event) => setLastCommand(event._tag)}
        />
      </div>
    </main>
  )
}
