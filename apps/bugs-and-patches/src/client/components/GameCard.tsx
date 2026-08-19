import type { CSSProperties } from "react"
import type * as Card from "../../game/Card.js"
import { artFor } from "../Art.js"
import { Badge } from "./Primitives.js"

export const cardTypeLabel = (tag: Card.Card["_tag"]): string =>
  tag === "SideEffect" ? "Side Effect" : tag

export const GameCard = ({
  card,
  instanceId,
  count,
  selected = false,
  playable = true,
  pending = false,
  unavailableReason,
  compact = false,
  style,
  onSelect,
  onPreviewChange,
}: {
  readonly card: Card.Card
  readonly instanceId?: string
  readonly count?: number
  readonly selected?: boolean
  readonly playable?: boolean
  readonly pending?: boolean
  readonly unavailableReason?: string | null
  readonly compact?: boolean
  readonly style?: CSSProperties
  readonly onSelect?: () => void
  readonly onPreviewChange?: (visible: boolean) => void
}) => {
  const primaryStat =
    card._tag === "Bug"
      ? { label: "ATK", value: card.attack }
      : card._tag === "Patch"
        ? { label: "DEF", value: card.defense }
        : null
  const accessibleStats = `${primaryStat === null ? "" : `${primaryStat.value} ${primaryStat.label}, `}${card.cost} Uptime cost`
  const body = (
    <>
      <div className="game-card__topline">
        <h3>{card.name}</h3>
        <div className="game-card__stats" aria-label={accessibleStats}>
          {primaryStat === null ? null : (
            <span className="game-card__primary-stat">
              <strong>{primaryStat.value}</strong>
              <small>{primaryStat.label}</small>
            </span>
          )}
          <span className="game-card__cost">
            <strong>{card.cost === 0 ? "0" : card.cost}</strong>
            <small>COST</small>
          </span>
        </div>
      </div>
      <div className="game-card__art-frame">
        <img
          className="game-card__art"
          src={artFor(card.id)}
          alt=""
          width="112"
          height="82"
          loading={compact ? "eager" : "lazy"}
        />
        <Badge tone={card._tag.toLowerCase()}>{cardTypeLabel(card._tag)}</Badge>
      </div>
      <div className="game-card__copy">
        <p className="game-card__rules">{card.rulesText}</p>
        <p className="game-card__flavor">{card.flavorText}</p>
      </div>
      <footer className="game-card__footer">
        <span className="game-card__id">{card.id}</span>
      </footer>
      {count === undefined ? null : <span className="game-card__count">×{count}</span>}
    </>
  )

  const classes = [
    "game-card",
    `game-card--${card._tag.toLowerCase()}`,
    compact ? "game-card--compact" : "",
    selected ? "is-selected" : "",
    playable ? "is-playable" : "is-unplayable",
    pending ? "is-pending" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return onSelect === undefined ? (
    <article className={classes} data-instance-id={instanceId} style={style}>
      {body}
    </article>
  ) : (
    <button
      className={classes}
      type="button"
      onClick={onSelect}
      onPointerEnter={() => onPreviewChange?.(true)}
      onPointerLeave={() => onPreviewChange?.(false)}
      onFocus={() => onPreviewChange?.(true)}
      onBlur={() => onPreviewChange?.(false)}
      aria-pressed={selected}
      aria-describedby={unavailableReason == null ? undefined : `${instanceId}-reason`}
      aria-label={`${card.name}. ${cardTypeLabel(card._tag)}. ${accessibleStats}.${selected ? playable ? " Selected; activate again to play." : " Selected; unavailable to play." : " Activate to inspect."}`}
      data-instance-id={instanceId}
      data-playable={playable ? "true" : "false"}
      data-pending={pending ? "true" : "false"}
      style={style}
    >
      {body}
      {unavailableReason === undefined || unavailableReason === null ? null : (
        <span className="game-card__disabled-reason" id={`${instanceId}-reason`}>
          {unavailableReason}
        </span>
      )}
    </button>
  )
}
