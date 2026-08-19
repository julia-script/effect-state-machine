import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import type * as Card from "../../game/Card.js"
import type * as Match from "../../game/Match.js"
import type * as Protocol from "../../protocol/Protocol.js"
import { GameCard } from "./GameCard.js"
import { Avatar, Badge, Button, Notice, Panel } from "./Primitives.js"

const thinkingMessages = [
  "Reading the stack trace…",
  "Blaming the cache…",
  "Reproducing locally…",
  "Checking whether it works on their machine…",
] as const

const thinkingMessageDuration = 4_000

interface UptimeProjection {
  readonly value: number
  readonly formula: string
}

interface BattleHistoryEntry {
  readonly id: string
  readonly turn: number
  readonly text: string
  readonly tone: "neutral" | "bug" | "patch" | "result"
}

const phaseLabel = (phase: Protocol.PlayerView["phase"]): string => {
  switch (phase) {
    case "Waiting":
      return "Waiting room"
    case "BugPhase":
      return "Bug phase"
    case "PatchResponse":
      return "Patch response"
    case "SideEffectPhase":
      return "Side Effects"
    case "Finished":
      return "Incident closed"
  }
}

const actionForCard = (
  view: Protocol.PlayerView,
  instanceId: string,
): Protocol.LegalAction | undefined =>
  view.legalActions.find((action) => action.cardInstanceId === instanceId)

const playerName = (view: Protocol.PlayerView, playerId: Card.PlayerId): string =>
  playerId === view.viewer
    ? "You"
    : (view.players.find((candidate) => candidate.id === playerId)?.identity.displayName ??
      "Your opponent")

export const phaseDecisionLabel = (
  view: Protocol.PlayerView,
  viewerCanAct: boolean,
): string => {
  if (view.phase === "Finished") return "Incident closed"
  if (view.phase === "Waiting") return "Waiting for an opponent"
  const move =
    view.phase === "BugPhase"
      ? "Bug"
      : view.phase === "PatchResponse"
        ? "Patch"
        : "Side Effect"
  const actor =
    view.phase === "PatchResponse" && view.activePlayer !== null
      ? view.activePlayer === "player-one"
        ? "player-two"
        : "player-one"
      : (view.activePlayer ?? view.viewer)
  return viewerCanAct ? `Your ${move} phase` : `${playerName(view, actor)} · ${move}`
}

const selfAfterCost = (uptime: number, cost: number): number => Math.max(1, uptime - cost)

export const uptimeProjections = (
  view: Protocol.PlayerView,
  cardInstanceId: string | null,
): Readonly<Partial<Record<Card.PlayerId, UptimeProjection>>> => {
  const selected =
    cardInstanceId === null
      ? undefined
      : view.hand.find(({ instance }) => instance.id === cardInstanceId)
  const selectedAction =
    cardInstanceId === null ? undefined : actionForCard(view, cardInstanceId)
  const projections: Partial<Record<Card.PlayerId, UptimeProjection>> = {}
  const byId = (id: Card.PlayerId) => view.players.find((candidate) => candidate.id === id)

  if (view.phase === "BugPhase" && selected?.card._tag === "Bug" && selectedAction?.enabled) {
    const attacker = byId(view.viewer)
    const defenderId = view.viewer === "player-one" ? "player-two" : "player-one"
    const defender = byId(defenderId)
    if (attacker !== undefined) {
      const value = selfAfterCost(attacker.uptime, selected.card.cost)
      projections[attacker.id] = {
        value,
        formula: `${attacker.uptime} − ${selected.card.cost} = ${value}`,
      }
    }
    if (defender !== undefined) {
      const value = Math.max(0, defender.uptime - selected.card.attack)
      projections[defender.id] = {
        value,
        formula: `${defender.uptime} − ${selected.card.attack} = ${value}`,
      }
    }
    return projections
  }

  if (view.phase === "PatchResponse" && view.lastBug?.card._tag === "Bug") {
    const attackerId = view.activePlayer
    if (attackerId === null) return projections
    const defenderId = attackerId === "player-one" ? "player-two" : "player-one"
    const attacker = byId(attackerId)
    const defender = byId(defenderId)
    const patch =
      selected?.card._tag === "Patch" && selectedAction?.enabled ? selected.card : undefined
    const defense = patch?.defense ?? 0
    const remaining = Math.max(0, view.lastBug.card.attack - defense)
    const reflects = patch?.abilities.some((ability) => ability._tag === "ReflectRemaining") ?? false
    if (defender !== undefined) {
      const afterCost = patch === undefined ? defender.uptime : selfAfterCost(defender.uptime, patch.cost)
      const value = reflects ? afterCost : Math.max(0, afterCost - remaining)
      const parts: Array<string> = [`${defender.uptime}`]
      if (patch !== undefined && patch.cost > 0) parts.push(`− ${patch.cost}`)
      if (!reflects && remaining > 0) parts.push(`− ${remaining}`)
      projections[defender.id] = { value, formula: `${parts.join(" ")} = ${value}` }
    }
    if (reflects && attacker !== undefined) {
      const value = Math.max(0, attacker.uptime - remaining)
      projections[attacker.id] = {
        value,
        formula: `${attacker.uptime} − ${remaining} = ${value}`,
      }
    }
    return projections
  }

  if (view.phase === "SideEffectPhase" && selected?.card._tag === "SideEffect" && selectedAction?.enabled) {
    const owner = byId(view.viewer)
    if (owner !== undefined && selected.card.cost > 0) {
      const value = selfAfterCost(owner.uptime, selected.card.cost)
      projections[owner.id] = {
        value,
        formula: `${owner.uptime} − ${selected.card.cost} = ${value}`,
      }
    }
  }
  return projections
}

export const describeViewTransition = (
  previous: Protocol.PlayerView,
  next: Protocol.PlayerView,
): ReadonlyArray<Omit<BattleHistoryEntry, "id">> => {
  const entries: Array<Omit<BattleHistoryEntry, "id">> = []
  if (next.lastBug !== null && next.lastBug.instance.id !== previous.lastBug?.instance.id) {
    entries.push({
      turn: next.turn,
      text: `${playerName(next, next.activePlayer ?? next.viewer)} shipped ${next.lastBug.card.name}.`,
      tone: "bug",
    })
  }
  if (next.lastPatch !== null && next.lastPatch.instance.id !== previous.lastPatch?.instance.id) {
    const defender = next.activePlayer === "player-one" ? "player-two" : "player-one"
    entries.push({
      turn: next.turn,
      text: `${playerName(next, defender)} deployed ${next.lastPatch.card.name}.`,
      tone: "patch",
    })
  }
  for (const candidate of next.players) {
    const before = previous.players.find((player) => player.id === candidate.id)?.uptime
    if (before !== undefined && before !== candidate.uptime) {
      const amount = candidate.uptime - before
      entries.push({
        turn: next.turn,
        text: `${playerName(next, candidate.id)} ${amount > 0 ? "gained" : "lost"} ${Math.abs(amount)} Uptime (${candidate.uptime} remaining).`,
        tone: amount > 0 ? "patch" : "bug",
      })
    }
  }
  if (
    previous.phase === "BugPhase" &&
    next.phase === "SideEffectPhase" &&
    next.lastBug === null
  ) {
    entries.push({
      turn: next.turn,
      text: `${playerName(next, previous.activePlayer ?? next.viewer)} passed the Bug phase.`,
      tone: "neutral",
    })
  }
  if (previous.phase === "PatchResponse" && next.phase !== "PatchResponse" && next.lastPatch === null) {
    const defender = previous.activePlayer === "player-one" ? "player-two" : "player-one"
    entries.push({
      turn: next.turn,
      text: `${playerName(next, defender)} passed without a Patch.`,
      tone: "neutral",
    })
  }
  if (next.turn > previous.turn) {
    entries.push({
      turn: next.turn,
      text: `Turn ${next.turn} started for ${playerName(next, next.activePlayer ?? next.viewer)}.`,
      tone: "neutral",
    })
  }
  if (next.phase === "Finished" && previous.phase !== "Finished" && next.outcome !== null) {
    entries.push({
      turn: next.turn,
      text: `${playerName(next, next.outcome.winner)} won by ${next.outcome.reason.toLowerCase()}.`,
      tone: "result",
    })
  }
  return entries
}

export const legalCardSelection = (
  view: Protocol.PlayerView,
  instanceId: string,
): { readonly enabled: boolean; readonly reason: string | null } => {
  const action = actionForCard(view, instanceId)
  return action === undefined
    ? { enabled: false, reason: "This card has no legal action right now." }
    : { enabled: action.enabled, reason: action.reason }
}

export const cardActivation = (
  selectedId: string | null,
  instanceId: string,
  playable: boolean,
  pending: boolean,
): "Inspect" | "Play" | "Unavailable" =>
  selectedId !== instanceId ? "Inspect" : playable && !pending ? "Play" : "Unavailable"

const eventFor = (
  action: Protocol.LegalAction,
  playerId: Card.PlayerId,
): Match.Event | undefined => {
  if (action.action === "Surrender") return { _tag: "Surrender", playerId }
  if (action.cardInstanceId === null) {
    return action.action === "PassBug" ||
      action.action === "PassPatch" ||
      action.action === "PassSideEffect"
      ? { _tag: action.action, playerId }
      : undefined
  }
  return action.action === "PlayBug" ||
    action.action === "PlayPatch" ||
    action.action === "PlaySideEffect"
    ? { _tag: action.action, playerId, cardInstanceId: action.cardInstanceId }
    : undefined
}

const PlayerSummary = ({
  player,
  label,
  uptimeDelta,
  projection,
}: {
  readonly player: Protocol.PlayerView["players"][number]
  readonly label: string
  readonly uptimeDelta?: number
  readonly projection?: UptimeProjection
}) => (
  <article className="player-summary">
    <Avatar
      name={player.identity.displayName}
      src={player.identity.github?.avatarUrl}
      size="normal"
    />
    <div className="player-summary__identity">
      <span className="player-summary__label">{label}</span>
      <strong>{player.identity.displayName}</strong>
      {player.identity.kind === "Agent" ? <Badge tone="pear">Agent</Badge> : null}
      <span className={`presence presence--${player.presence.toLowerCase()}`}>
        {player.presence}
      </span>
    </div>
    <div
      className={`uptime ${uptimeDelta === undefined ? "" : "is-changing"}`}
      role="img"
      aria-label={`${player.uptime} Uptime${projection === undefined ? "" : `, projected to ${projection.value}`}${uptimeDelta === undefined ? "" : `, changed by ${uptimeDelta}`}`}
    >
      <strong>{player.uptime}</strong>
      <span>Uptime</span>
      {projection === undefined ? null : (
        <em className="uptime__projection">{projection.formula}</em>
      )}
      {uptimeDelta === undefined ? null : (
        <em className={`uptime__delta ${uptimeDelta > 0 ? "is-positive" : "is-negative"}`}>
          {uptimeDelta > 0 ? "+" : ""}
          {uptimeDelta}
        </em>
      )}
    </div>
    <dl className="player-counts">
      <div>
        <dt>Hand</dt>
        <dd>{player.handCount}</dd>
      </div>
      <div>
        <dt>Stack</dt>
        <dd>{player.deckCount}</dd>
      </div>
      <div>
        <dt>Discard</dt>
        <dd>{player.discardCount}</dd>
      </div>
    </dl>
  </article>
)

const EffectList = ({ player }: { readonly player: Protocol.PlayerView["players"][number] }) => {
  const items = [
    ...player.conditions.map((condition) => `Cannot ${condition.action.toLowerCase()} next turn`),
    ...player.ongoing.map(
      (ongoing) =>
        `${ongoing.kind} ${ongoing.amount} · ${ongoing.remainingTurns} turn${ongoing.remainingTurns === 1 ? "" : "s"}`,
    ),
  ]
  return items.length === 0 ? null : (
    <ul className="effect-list" aria-label={`${player.identity.displayName} effects`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

const cardBackIds = ["back-1", "back-2", "back-3", "back-4", "back-5", "back-6", "back-7", "back-8"]

const CardBacks = ({ count }: { readonly count: number }) => (
  <div className="card-backs" role="img" aria-label={`Opponent has ${count} hidden cards`}>
    {cardBackIds.slice(0, Math.min(count, cardBackIds.length)).map((cardBackId) => (
      <span className="card-back" aria-hidden="true" key={cardBackId}>
        B&amp;P
      </span>
    ))}
    {count > 8 ? <span className="card-backs__more">+{count - 8}</span> : null}
  </div>
)

export const prefersReducedMotion = (
  matcher: (query: string) => { readonly matches: boolean } = (query) => matchMedia(query),
): boolean => matcher("(prefers-reduced-motion: reduce)").matches

const PlayedZoneCard = ({
  visible,
  origin,
  kind,
}: {
  readonly visible: Protocol.PlayerView["lastBug"] | Protocol.PlayerView["lastPatch"]
  readonly origin: "you" | "opponent"
  readonly kind: "bug" | "patch"
}) => {
  const [shown, setShown] = useState(visible)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (visible !== null) {
      setShown(visible)
      setLeaving(false)
      return
    }
    if (prefersReducedMotion()) {
      setShown(null)
      setLeaving(false)
      return
    }
    setLeaving(true)
    const timeout = setTimeout(() => {
      setShown(null)
      setLeaving(false)
    }, 220)
    return () => clearTimeout(timeout)
  }, [visible])

  return shown === null ? null : (
    <div
      className={`stage-card stage-card--${kind} stage-card--from-${origin} ${leaving ? "is-leaving" : ""}`}
      key={shown.instance.id}
    >
      <GameCard card={shown.card} instanceId={shown.instance.id} compact />
    </div>
  )
}

export const Battle = ({
  view,
  pending,
  notice,
  onDismissNotice,
  onCommand,
}: {
  readonly view: Protocol.PlayerView
  readonly pending: boolean
  readonly notice: string | null
  readonly onDismissNotice: () => void
  readonly onCommand: (event: Match.Event) => void
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [surrenderArmed, setSurrenderArmed] = useState(false)
  const [passArmed, setPassArmed] = useState(false)
  const [uptimeDeltas, setUptimeDeltas] = useState<Readonly<Record<string, number>>>({})
  const [impacting, setImpacting] = useState(false)
  const [thinkingIndex, setThinkingIndex] = useState(0)
  const [thinkingPaused, setThinkingPaused] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ReadonlyArray<BattleHistoryEntry>>([
    { id: `turn-${view.turn}-opening`, turn: view.turn, text: `Turn ${view.turn} started.`, tone: "neutral" },
  ])
  const [outcomeReady, setOutcomeReady] = useState(false)
  const [outcomeAcknowledged, setOutcomeAcknowledged] = useState(false)
  const previousView = useRef(view)
  const you = view.players.find((player) => player.id === view.viewer)
  const opponent = view.players.find((player) => player.id !== view.viewer)
  const decisionActions = view.legalActions.filter((action) => action.action !== "Surrender")
  const isYourTurn = decisionActions.some((action) => action.enabled)

  useEffect(() => {
    if (selectedId !== null && !view.hand.some(({ instance }) => instance.id === selectedId)) {
      setSelectedId(null)
    }
    if (hoveredId !== null && !view.hand.some(({ instance }) => instance.id === hoveredId)) {
      setHoveredId(null)
    }
    setSurrenderArmed(false)
    setPassArmed(false)
  }, [hoveredId, selectedId, view])

  useEffect(() => {
    if (isYourTurn || view.phase === "Finished" || thinkingPaused || prefersReducedMotion()) {
      setThinkingIndex(0)
      return
    }
    const interval = setInterval(
      () => setThinkingIndex((current) => (current + 1) % thinkingMessages.length),
      thinkingMessageDuration,
    )
    return () => clearInterval(interval)
  }, [isYourTurn, thinkingPaused, view.phase])

  useEffect(() => {
    if (view.phase !== "Finished" || view.outcome === null) {
      setOutcomeReady(false)
      setOutcomeAcknowledged(false)
      return
    }
    const timeout = setTimeout(() => setOutcomeReady(true), prefersReducedMotion() ? 120 : 900)
    return () => clearTimeout(timeout)
  }, [view.outcome, view.phase])

  useEffect(() => {
    if (!passArmed) return
    const timeout = setTimeout(() => setPassArmed(false), 2200)
    return () => clearTimeout(timeout)
  }, [passArmed])

  useEffect(() => {
    if (selectedId === null) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null)
    }
    window.addEventListener("keydown", dismiss)
    return () => window.removeEventListener("keydown", dismiss)
  }, [selectedId])

  useEffect(() => {
    const previous = previousView.current
    previousView.current = view
    const descriptions = describeViewTransition(previous, view)
    if (descriptions.length > 0) {
      setHistory((current) => [
        ...current,
        ...descriptions.map((entry, index) => ({
          ...entry,
          id: `${view.turn}-${view.phase}-${current.length + index}`,
        })),
      ].slice(-40))
    }
    const previousUptime = new Map(previous.players.map((player) => [player.id, player.uptime]))
    const nextDeltas = Object.fromEntries(
      view.players.flatMap((player) => {
        const before = previousUptime.get(player.id)
        return before === undefined || before === player.uptime
          ? []
          : [[player.id, player.uptime - before] as const]
      }),
    )
    const resolvedCombat =
      (previous.phase === "PatchResponse" && view.phase !== "PatchResponse") ||
      (previous.phase === "BugPhase" && view.phase === "SideEffectPhase" && view.lastBug !== null)
    if (Object.keys(nextDeltas).length > 0) setUptimeDeltas(nextDeltas)
    if (resolvedCombat) setImpacting(true)
    const deltaTimeout = setTimeout(() => setUptimeDeltas({}), 1150)
    const impactTimeout = setTimeout(() => setImpacting(false), 520)
    return () => {
      clearTimeout(deltaTimeout)
      clearTimeout(impactTimeout)
    }
  }, [view])

  const selectedAction = useMemo(
    () => (selectedId === null ? undefined : actionForCard(view, selectedId)),
    [selectedId, view],
  )
  const passAction = view.legalActions.find(
    (action) => action.cardInstanceId === null && action.action !== "Surrender" && action.enabled,
  )
  const surrender =
    view.phase === "Finished"
      ? undefined
      : view.legalActions.find((action) => action.action === "Surrender" && action.enabled)
  const selectedCard =
    selectedId === null ? undefined : view.hand.find(({ instance }) => instance.id === selectedId)
  const projectedCardId = hoveredId ?? selectedId
  const projections = useMemo(
    () => uptimeProjections(view, projectedCardId),
    [projectedCardId, view],
  )
  const playableCards = decisionActions.filter(
    (action) => action.cardInstanceId !== null && action.enabled,
  )
  const recommendPass = passAction !== undefined && playableCards.length === 0

  if (you === undefined || opponent === undefined) {
    return (
      <Notice tone="error">
        The authoritative view is missing a player. Reconnect to refresh it.
      </Notice>
    )
  }

  const agentIsOffline =
    opponent.identity.kind === "Agent" && opponent.presence === "Disconnected"
  const phaseClass = view.phase === "Finished" ? "finished" : view.phase.toLowerCase()
  const decisionLabel = phaseDecisionLabel(view, isYourTurn)
  const passGuidance =
    view.phase === "BugPhase"
      ? "No legal Bugs in hand — pass to Side Effects."
      : view.phase === "PatchResponse"
        ? "No legal Patches in hand — let the Bug resolve."
        : "No legal Side Effects in hand — end your turn."
  const won = view.outcome?.winner === view.viewer

  return (
    <div
      className={`battle battle--phase-${phaseClass} ${isYourTurn ? "battle--your-turn" : "battle--opponent-turn"} ${impacting ? "is-impacting" : ""}`}
      aria-busy={pending}
    >
      {notice === null ? null : (
        <Notice tone="error" onDismiss={onDismissNotice}>
          {notice}
        </Notice>
      )}
      <header className="battle__topbar">
        <a className="battle__brand" href="/">
          Bugs &amp; Patches
        </a>
        <Badge tone="ink">Match {view.matchId.slice(0, 8)}</Badge>
        {surrender === undefined ? null : surrenderArmed ? (
          <div className="battle__surrender-confirm">
            <Button
              tone="coral"
              disabled={pending}
              onClick={() => {
                const event = eventFor(surrender, view.viewer)
                if (event !== undefined) onCommand(event)
              }}
            >
              Surrender
            </Button>
            <Button variant="outline" tone="ink" onClick={() => setSurrenderArmed(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" tone="ink" onClick={() => setSurrenderArmed(true)}>
            Surrender
          </Button>
        )}
      </header>

      <section className="battle__status">
        <div
          className="phase-rail"
          role="status"
          aria-label={`Current phase: ${phaseLabel(view.phase)}`}
        >
          {(["BugPhase", "PatchResponse", "SideEffectPhase"] as const).map((phase, index) => (
            <span className={phase === view.phase ? "is-current" : ""} key={phase}>
              {index + 1} ·{" "}
              {phase === view.phase
                ? decisionLabel
                : phase === "BugPhase"
                  ? "Bug"
                  : phase === "PatchResponse"
                    ? "Patch"
                    : "Side Effect"}
            </span>
          ))}
        </div>
      </section>

      <div
        className={`battle__turn-indicator ${isYourTurn ? "is-yours" : "is-opponents"}`}
        role="status"
        aria-live="polite"
        aria-label={decisionLabel}
        tabIndex={isYourTurn ? undefined : 0}
        onPointerEnter={() => setThinkingPaused(true)}
        onPointerLeave={() => setThinkingPaused(false)}
        onFocus={() => setThinkingPaused(true)}
        onBlur={() => setThinkingPaused(false)}
      >
        <i aria-hidden="true" />
        <strong className="battle__turn-wide">
          {decisionLabel}
        </strong>
        <strong className="battle__turn-compact">{isYourTurn ? "Your move" : "Waiting"}</strong>
        <span aria-hidden="true">
          {view.phase === "Finished"
            ? "Final state recorded"
            : isYourTurn
              ? "Make your move"
              : thinkingMessages[thinkingIndex]}
        </span>
      </div>

      {agentIsOffline ? (
        <aside className="battle__agent-offline" role="status" aria-live="polite">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong>Your agent’s uptime is worse than yours.</strong>
            <span>You may want to ping them to wake them up.</span>
          </div>
        </aside>
      ) : null}

      <section className="battle__opponent" aria-label="Opponent">
        <PlayerSummary
          player={opponent}
          label="Opponent"
          uptimeDelta={uptimeDeltas[opponent.id]}
          projection={projections[opponent.id]}
        />
        <EffectList player={opponent} />
        <CardBacks count={opponent.handCount} />
      </section>

      <section
        className={`battle__stage ${view.lastBug === null ? "is-empty" : "has-combat"}`}
        aria-label="Combat stage"
        aria-live="polite"
      >
        <PlayedZoneCard
          visible={view.lastBug}
          kind="bug"
          origin={view.activePlayer === view.viewer ? "you" : "opponent"}
        />
        <PlayedZoneCard
          visible={view.lastPatch}
          kind="patch"
          origin={view.activePlayer === view.viewer ? "opponent" : "you"}
        />
      </section>

      <section className="battle__you" aria-label="Your player state">
        <PlayerSummary
          player={you}
          label="You"
          uptimeDelta={uptimeDeltas[you.id]}
          projection={projections[you.id]}
        />
        <EffectList player={you} />
      </section>

      <div
        className="deck-pile deck-pile--opponent"
        role="img"
        aria-label={`Opponent Stack has ${opponent.deckCount} cards`}
      >
        <i />
        <i />
        <i />
        <span>Stack {opponent.deckCount}</span>
      </div>
      <div
        className="deck-pile deck-pile--you"
        role="img"
        aria-label={`Your Stack has ${you.deckCount} cards`}
      >
        <i />
        <i />
        <i />
        <span>Stack {you.deckCount}</span>
      </div>

      {selectedId === null ? null : (
        <div
          className="battle__dismiss-selection"
          aria-hidden="true"
          onPointerDown={() => setSelectedId(null)}
        />
      )}

      {selectedCard === undefined ? null : (
        <aside className="battle__inspection" aria-label={`Inspecting ${selectedCard.card.name}`}>
          <GameCard
            card={selectedCard.card}
            instanceId={`inspection-${selectedCard.instance.id}`}
            selected
            playable={selectedAction?.enabled === true}
            pending={pending}
            unavailableReason={selectedAction?.reason}
            onSelect={() => {
              if (selectedAction?.enabled !== true || pending) return
              const event = eventFor(selectedAction, view.viewer)
              if (event !== undefined) onCommand(event)
            }}
          />
        </aside>
      )}

      <section className={`hand ${selectedId === null ? "" : "has-selection"}`} aria-label="Your hand">
        <div className="hand__heading">
          <p>
            {selectedCard === undefined
              ? view.phase === "Finished"
                ? "Incident closed. Review the final board or open the log."
                : passAction !== undefined
                ? "Pick any card to inspect it. Pick it again to play when available."
                : `${opponent.identity.displayName} is deciding. You can still inspect your hand.`
              : selectedAction?.enabled
                ? `${selectedCard.card.name} is ready. Pick it again to play, or press Escape to close.`
                : `${selectedCard.card.name}: ${selectedAction?.reason ?? "This card cannot be played right now."}`}
          </p>
        </div>
        <div className="hand__cards">
          {view.hand.map(({ card, instance }, index) => {
            const legality = legalCardSelection(view, instance.id)
            const middle = (view.hand.length - 1) / 2
            const distance = index - middle
            const fanStyle = {
              "--fan-rotation": `${Math.max(-10, Math.min(10, distance * 4))}deg`,
              "--fan-drop": `${Math.min(1.6, Math.abs(distance) * 0.42)}rem`,
            } as CSSProperties
            return (
              <GameCard
                key={instance.id}
                card={card}
                instanceId={instance.id}
                selected={selectedId === instance.id}
                playable={legality.enabled}
                pending={pending}
                unavailableReason={legality.reason}
                style={fanStyle}
                onPreviewChange={(visible) =>
                  setHoveredId((current) => (visible ? instance.id : current === instance.id ? null : current))
                }
                onSelect={() => {
                  const activation = cardActivation(
                    selectedId,
                    instance.id,
                    legality.enabled,
                    pending,
                  )
                  if (activation === "Inspect") {
                    setPassArmed(false)
                    setSelectedId(instance.id)
                    return
                  }
                  if (activation === "Play") {
                    const action = actionForCard(view, instance.id)
                    const event = action === undefined ? undefined : eventFor(action, view.viewer)
                    if (event !== undefined) onCommand(event)
                  }
                }}
              />
            )
          })}
        </div>
      </section>

      <div className="battle__bottom-actions">
        <Button
          className="battle-history-toggle"
          variant="outline"
          tone="ink"
          onClick={() => setHistoryOpen(true)}
        >
          Log · {history.length}
        </Button>
        {passAction === undefined ? null : (
          <div className={`battle-pass-group ${recommendPass ? "is-recommended" : ""}`}>
            {recommendPass ? (
              <span className="battle-pass__guidance" id="pass-guidance" role="status">
                {passGuidance}
              </span>
            ) : null}
            <Button
              className={`battle-pass battle-pass--${view.phase.toLowerCase()}`}
              tone={
                view.phase === "BugPhase" ? "coral" : view.phase === "PatchResponse" ? "cyan" : "pear"
              }
              disabled={pending}
              aria-describedby={recommendPass ? "pass-guidance" : undefined}
              onClick={() => {
                setSelectedId(null)
                if (!recommendPass && !passArmed) {
                  setPassArmed(true)
                  return
                }
                const event = eventFor(passAction, view.viewer)
                if (event !== undefined) onCommand(event)
              }}
            >
              {passArmed ? "Confirm pass" : recommendPass ? "Pass — no move" : "Pass"}
            </Button>
          </div>
        )}
      </div>

      {historyOpen ? (
        <>
          <button
            className="battle__history-scrim"
            type="button"
            aria-label="Close incident log"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="battle__history" aria-label="Incident log">
            <header>
              <div>
                <span>Match {view.matchId.slice(0, 8)}</span>
                <h2>Incident log</h2>
              </div>
              <Button variant="outline" tone="ink" onClick={() => setHistoryOpen(false)}>
                Close
              </Button>
            </header>
            <ol>
              {[...history].reverse().map((entry) => (
                <li className={`is-${entry.tone}`} key={entry.id}>
                  <span>Turn {entry.turn}</span>
                  <p>{entry.text}</p>
                </li>
              ))}
            </ol>
          </aside>
        </>
      ) : null}

      {view.phase === "Finished" &&
      view.outcome !== null &&
      outcomeReady &&
      !outcomeAcknowledged ? (
        <>
          <div className="match-result__scrim" aria-hidden="true" />
          <Panel
            className={`match-result match-result--${won ? "won" : "lost"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-result-title"
          >
            <Badge tone={won ? "patch" : "bug"}>{view.mode}</Badge>
            <h1 id="match-result-title">
              {won ? "Production survived." : "Production is down."}
            </h1>
            <p>
              {won ? "You closed the incident" : `${opponent.identity.displayName} closed the incident`}{" "}
              by {view.outcome.reason.toLowerCase()}.
            </p>
            <p className="match-result__rating">
              {view.mode === "Ranked"
                ? "This result counts toward both players’ ratings. Updated standings appear in Top Contributors."
                : "Friendly matches do not change rating."}
            </p>
            <div className="match-result__actions">
              <Button tone="pear" onClick={() => setOutcomeAcknowledged(true)}>
                Review final board
              </Button>
              <a className="btn btn--outline" href="/leaderboard">
                Top Contributors
              </a>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  )
}
