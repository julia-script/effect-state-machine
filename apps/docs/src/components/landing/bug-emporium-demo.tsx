"use client"

import { Studio } from "@effect-state-machine/studio-react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as React from "react"
import {
  type EmporiumEvent,
  type EmporiumState,
  emporiumDefinition,
  emporiumQuickEvents,
  emporiumStart,
  type Product,
  products,
} from "./bug-emporium-machine"

type EmporiumHandle = Effect.Success<typeof emporiumStart>

const idleWireText = "Attach.attach({ definition, handle }) — Studio is observing"

type CartLines = Readonly<Record<string, number>>

const addToLines = (lines: CartLines, sku: string, amount: number): CartLines => ({
  ...lines,
  [sku]: (lines[sku] ?? 0) + amount,
})

// The machine only tracks the total item count, so removal falls back to any
// non-empty line (Studio's "Remove random" may name a sku that is not in the jar).
const removeFromLines = (lines: CartLines, sku: string, amount: number): CartLines => {
  const next: Record<string, number> = { ...lines }
  let remaining = amount
  const take = (key: string) => {
    const count = next[key] ?? 0
    const taken = Math.min(count, remaining)
    next[key] = count - taken
    remaining -= taken
  }
  take(sku)
  for (const product of products) {
    if (remaining === 0) break
    take(product.sku)
  }
  return next
}

const linesTotal = (lines: CartLines): number =>
  products.reduce((total, product) => total + (lines[product.sku] ?? 0) * product.price, 0)

function HeisenbugDoodle() {
  return (
    <svg viewBox="0 0 60 44" className="shop-item__doodle" aria-label="a bug, half vanished">
      <g
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3 3"
        opacity="0.75"
      >
        <ellipse cx="30" cy="27" rx="10" ry="12" />
        <circle cx="30" cy="11" r="5" />
        <line x1="27" y1="7" x2="22" y2="2" />
        <line x1="33" y1="7" x2="38" y2="2" />
        <line x1="30" y1="15" x2="30" y2="39" />
        <line x1="20" y1="20" x2="13" y2="16" />
        <line x1="20" y1="27" x2="12" y2="27" />
        <line x1="20" y1="34" x2="13" y2="38" />
        <line x1="40" y1="20" x2="47" y2="16" />
        <line x1="40" y1="27" x2="48" y2="27" />
        <line x1="40" y1="34" x2="47" y2="38" />
      </g>
    </svg>
  )
}

function RaceConditionDoodle() {
  return (
    <svg viewBox="0 0 60 44" className="shop-item__doodle" aria-label="two bugs racing">
      <g fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round">
        <line x1="2" y1="16" x2="10" y2="16" />
        <line x1="4" y1="22" x2="12" y2="22" />
        <line x1="2" y1="28" x2="10" y2="28" />
        <ellipse cx="24" cy="22" rx="7" ry="9" fill="var(--color-cyan)" />
        <circle cx="24" cy="10" r="4" />
        <line x1="17" y1="18" x2="12" y2="15" />
        <line x1="17" y1="26" x2="12" y2="29" />
        <line x1="31" y1="18" x2="36" y2="15" />
        <line x1="31" y1="26" x2="36" y2="29" />
        <ellipse cx="47" cy="27" rx="7" ry="9" fill="var(--color-cyan)" />
        <circle cx="47" cy="15" r="4" />
        <line x1="40" y1="23" x2="35" y2="20" />
        <line x1="40" y1="31" x2="35" y2="34" />
        <line x1="54" y1="23" x2="59" y2="20" />
        <line x1="54" y1="31" x2="59" y2="34" />
      </g>
    </svg>
  )
}

function OffByOneDoodle() {
  return (
    <svg viewBox="0 0 60 44" className="shop-item__doodle" aria-label="a bug missing one leg">
      <g fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="30" cy="27" rx="10" ry="12" fill="var(--color-pear)" />
        <circle cx="30" cy="11" r="5" />
        <line x1="27" y1="7" x2="22" y2="2" />
        <line x1="33" y1="7" x2="38" y2="2" />
        <line x1="30" y1="15" x2="30" y2="39" />
        <line x1="20" y1="20" x2="13" y2="16" />
        <line x1="20" y1="27" x2="12" y2="27" />
        <line x1="20" y1="34" x2="13" y2="38" />
        <line x1="40" y1="20" x2="47" y2="16" />
        <line x1="40" y1="27" x2="48" y2="27" />
        <text
          x="44"
          y="40"
          fontSize="9"
          fontFamily="ui-monospace,monospace"
          fill="var(--color-danger)"
          stroke="none"
        >
          −1
        </text>
      </g>
    </svg>
  )
}

const doodles: Record<string, () => React.ReactElement> = {
  heisenbug: HeisenbugDoodle,
  "race-condition": RaceConditionDoodle,
  "off-by-one": OffByOneDoodle,
}

function ProductRow({
  product,
  count,
  tilt,
  onAdd,
  onRemove,
}: {
  readonly product: Product
  readonly count: number
  readonly tilt: "a" | "b" | "c"
  readonly onAdd: () => void
  readonly onRemove: () => void
}) {
  const Doodle = doodles[product.sku] ?? HeisenbugDoodle
  return (
    <div className={`shop-item shop-item--tilt-${tilt}`}>
      <div className="shop-item__thumb">
        <Doodle />
        <span className={`shop-item__sticker shop-item__sticker--${product.stickerTone}`}>
          {product.sticker}
        </span>
      </div>
      <div className="shop-item__info">
        <span className="shop-item__name">
          {product.name} <span className="shop-item__price">· ${product.price}</span>
        </span>
        <span className="shop-item__sub">
          {product.origin} · {product.note}
        </span>
      </div>
      {count > 0 ? (
        <>
          <span className="shop-item__count">× {count}</span>
          <button type="button" className="shop-item__minus" title="Remove one" onClick={onRemove}>
            −
          </button>
        </>
      ) : null}
      <button type="button" className="shop-item__add" onClick={onAdd}>
        Add
      </button>
    </div>
  )
}

export function BugEmporiumDemo() {
  const [run, setRun] = React.useState(0)
  const [handle, setHandle] = React.useState<EmporiumHandle | undefined>(undefined)
  const [snapshot, setSnapshot] = React.useState<EmporiumState>({ _tag: "Browsing", items: 0 })
  const [lines, setLines] = React.useState<CartLines>({})
  const [wireText, setWireText] = React.useState(idleWireText)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` deliberately disposes the scope and starts a fresh Machine.run for "Run it again"
  React.useEffect(() => {
    const scope = Effect.runSync(Scope.make())
    const nextHandle = Effect.runSync(emporiumStart.pipe(Effect.provideService(Scope.Scope, scope)))
    setHandle(nextHandle)
    setSnapshot({ _tag: "Browsing", items: 0 })
    setLines({})
    setWireText(idleWireText)
    return () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [run])

  React.useEffect(() => {
    if (handle === undefined) return
    const changesFiber = Effect.runFork(
      Stream.runForEach(handle.changes, (state) => Effect.sync(() => setSnapshot(state))),
    )
    const inspectionFiber = Effect.runFork(
      Stream.runForEach(
        handle.inspect((event) => event),
        (event) =>
          Effect.sync(() => {
            if (event._tag !== "EventReceived") return
            setWireText(`handle.send(${JSON.stringify(event.details)})`)
            if (event.stateTag !== "Browsing") return
            const detail = event.details
            if (detail._tag === "AddItem") {
              setLines((current) => addToLines(current, detail.sku, detail.amount))
            } else if (detail._tag === "RemoveItem") {
              setLines((current) => removeFromLines(current, detail.sku, detail.amount))
            }
          }),
      ),
    )
    return () => {
      Effect.runFork(Fiber.interrupt(changesFiber))
      Effect.runFork(Fiber.interrupt(inspectionFiber))
    }
  }, [handle])

  const machine = React.useMemo(
    () =>
      handle === undefined
        ? undefined
        : {
            definition: emporiumDefinition,
            handle,
            appName: "bug-emporium",
            quickEvents: emporiumQuickEvents,
          },
    [handle],
  )

  const send = React.useCallback(
    (event: EmporiumEvent) => {
      if (handle !== undefined) Effect.runFork(handle.send(event))
    },
    [handle],
  )

  const cartCount = snapshot._tag === "Ordered" ? 0 : snapshot.items
  const cartTotal = snapshot._tag === "Ordered" ? 0 : linesTotal(lines)
  const cartLines = products.filter((product) => (lines[product.sku] ?? 0) > 0)
  const browsing = snapshot._tag === "Browsing"
  const placing = snapshot._tag === "PlacingOrder"
  const failed = snapshot._tag === "PaymentFailed"
  const review = snapshot._tag === "Checkout" || placing || failed
  const ordered = snapshot._tag === "Ordered"
  const tilts: ReadonlyArray<"a" | "b" | "c"> = ["a", "b", "c"]

  return (
    <div className="demo">
      <div className="demo__wire">
        <span className="wire-chip">{wireText}</span>
      </div>
      <div className="demo__windows">
        <div className="shop">
          <div className="shop__chrome">
            <span className="shop__dot shop__dot--coral" />
            <span className="shop__dot shop__dot--cyan" />
            <span className="shop__dot shop__dot--surface" />
            <span className="shop__url">bug-emporium.example/shop</span>
            <span className="shop__chrome-spacer" />
          </div>
          <div className="shop__body">
            <div className="shop__header">
              <div className="shop__masthead">
                <span className="shop__title">The Bug Emporium</span>
                <span className="shop__spacer" />
                <span className="shop__jar">
                  jar: {cartCount} bugs · ${cartTotal}
                </span>
              </div>
              <span className="shop__tagline">
                artisanal, free-range bugs · sourced from production
              </span>
            </div>

            {browsing ? (
              <>
                <div className="shop__products">
                  {products.map((product, index) => (
                    <ProductRow
                      key={product.sku}
                      product={product}
                      count={lines[product.sku] ?? 0}
                      tilt={tilts[index % tilts.length] ?? "a"}
                      onAdd={() => send({ _tag: "AddItem", sku: product.sku, amount: 1 })}
                      onRemove={() => send({ _tag: "RemoveItem", sku: product.sku, amount: 1 })}
                    />
                  ))}
                </div>
                <div className="shop__footer">
                  <span className="shop__hint">
                    {cartCount === 0
                      ? "guard: checkout requires at least one bug in the jar."
                      : "bugs ship straight to production. no refunds, only patches."}
                  </span>
                  <span className="shop__spacer" />
                  <button
                    type="button"
                    className="shop__checkout"
                    disabled={cartCount === 0}
                    onClick={() => send({ _tag: "BeginCheckout" })}
                  >
                    Checkout → {cartCount} bugs
                  </button>
                </div>
              </>
            ) : null}

            {review ? (
              <div className="shop-review">
                <span className="shop-review__title">Review your bugs</span>
                <div className="shop-review__lines">
                  {cartLines.map((product) => (
                    <div key={product.sku} className="shop-review__line">
                      <span>
                        {product.name} × {lines[product.sku] ?? 0}
                      </span>
                      <span className="shop-review__amount">
                        ${(lines[product.sku] ?? 0) * product.price}
                      </span>
                    </div>
                  ))}
                  <div className="shop-review__total">
                    <span>Total (plus invisible fees)</span>
                    <span className="shop-review__amount">${cartTotal}</span>
                  </div>
                </div>
                {placing ? (
                  <div className="shop-review__placing">
                    <span className="shop-review__spinner" />
                    <span>
                      Bagging your bugs — <code>Orders.place</code> is running…
                    </span>
                  </div>
                ) : null}
                {failed ? (
                  <div className="shop-review__failed">
                    Payment declined — <code>PaymentDeclined("card declined")</code>. Ironically, a
                    bug. Typed and expected: the machine routed it, nothing crashed.
                  </div>
                ) : null}
                <div className="shop-review__actions">
                  <button
                    type="button"
                    className="shop-review__back"
                    disabled={placing}
                    onClick={() => send({ _tag: "BackToShop" })}
                  >
                    Back to shop
                  </button>
                  {failed ? (
                    <button
                      type="button"
                      className="shop-review__primary"
                      onClick={() => send({ _tag: "RetryPayment" })}
                    >
                      Retry payment
                    </button>
                  ) : null}
                  {snapshot._tag === "Checkout" ? (
                    <button
                      type="button"
                      className="shop-review__primary"
                      onClick={() => send({ _tag: "SubmitOrder" })}
                    >
                      Place order
                    </button>
                  ) : null}
                  {placing ? (
                    <button type="button" className="shop-review__primary" disabled>
                      Place order
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {ordered ? (
              <div className="shop-done">
                <span className="shop-done__badge">✓</span>
                <span className="shop-done__title">Bugs shipped</span>
                <span className="shop-done__order">{snapshot.orderId}</span>
                <span className="shop-done__note">
                  Straight to production, as is tradition. The machine reached its final state —{" "}
                  <code>completion</code> resolved below.
                </span>
                <button
                  type="button"
                  className="shop-done__again"
                  onClick={() => setRun((current) => current + 1)}
                >
                  Run it again
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="studio-frame">
          {machine === undefined ? (
            <div className="studio-frame__loading">Starting the checkout machine…</div>
          ) : (
            <Studio machine={machine} theme="light" style={{ height: 560 }} />
          )}
        </div>
      </div>
    </div>
  )
}
