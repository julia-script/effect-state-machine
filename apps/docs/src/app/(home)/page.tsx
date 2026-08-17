import type { Metadata } from "next"
import Link from "next/link"
import { BugEmporiumDemo } from "@/components/landing/bug-emporium-demo"
import { appName, docsRoute, gitConfig } from "@/lib/shared"

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`
const installCommand = "pnpm add effect-state-machine effect@4.0.0-beta.106"

export const metadata: Metadata = {
  description:
    "Code-first, Effect-native state machines. The definition you author is the one Studio inspects.",
}

function HeroCode() {
  return (
    <figure className="code-card">
      <div className="code-card__bar">
        <figcaption className="code-card__file">checkout.ts — the machine below</figcaption>
        <span className="code-card__sticker">100% inspectable</span>
      </div>
      <pre>
        <code>
          <span className="tok-com">const</span> definition = checkout.define({"\n"}
          {"  { id: "}
          <span className="tok-str">"checkout"</span>
          {", initial: () => ({ _tag: "}
          <span className="tok-str">"Browsing"</span>
          {", items: 0 }) },\n"}
          {"  {\n"}
          {"    Browsing: checkout."}
          <span className="tok-key">state</span>
          {"({\n"}
          {"      AddItem: { target: "}
          <span className="tok-str">"Browsing"</span>
          {", reduce: … },\n"}
          {"      RemoveItem: { target: "}
          <span className="tok-str">"Browsing"</span>
          {", reduce: … },\n"}
          {"      BeginCheckout: { branches: [{ when: cartHasItems, target: "}
          <span className="tok-str">"Checkout"</span>
          {" }] },\n"}
          {"    }),\n"}
          {"    Checkout: checkout."}
          <span className="tok-key">state</span>
          {"({ SubmitOrder: …, BackToShop: … }),\n"}
          {"    PlacingOrder: checkout."}
          <span className="tok-key">invoke</span>
          {"({\n"}
          {"      name: "}
          <span className="tok-str">"Orders.place"</span>
          {",\n"}
          {"      "}
          <span className="tok-com">
            {"// an Effect that needs a service — its Layer comes later"}
          </span>
          {"\n"}
          {"      effect: (state) => Effect.flatMap(Orders, ({ place }) => place(state.items)),\n"}
          {"      onSuccess: { target: "}
          <span className="tok-str">"Ordered"</span>
          {", reduce: ({ value }) => ({ orderId: value }) },\n"}
          {"      onFailure: { target: "}
          <span className="tok-str">"PaymentFailed"</span>
          {" },  "}
          <span className="tok-com">{"// typed PaymentDeclined"}</span>
          {"\n"}
          {"    }),\n"}
          {"    PaymentFailed: checkout."}
          <span className="tok-key">state</span>
          {"({ RetryPayment: …, BackToShop: … }),\n"}
          {"    Ordered: checkout."}
          <span className="tok-key">final</span>
          {"(),\n"}
          {"  },\n"}
          {")\n\n"}
          <span className="tok-com">
            {"// a scoped Effect — Orders is inferred, provided by a Layer"}
          </span>
          {"\n"}
          <span className="tok-com">const</span>
          {" handle = "}
          <span className="tok-key">yield*</span>
          {" Machine.run(definition, {}).pipe(\n"}
          {"  Effect.provide(OrdersLive),\n"}
          {")"}
        </code>
      </pre>
    </figure>
  )
}

export default function HomePage() {
  return (
    <main id="main">
      <div className="landing-shell">
        <div className="landing-shell__wide">
          <section className="hero">
            <div className="hero__copy">
              <p className="hero__label">Code-first · Effect-native</p>
              <h1 className="hero__title">
                Write the machine. <span className="hero__highlight">Watch it run.</span>
              </h1>
              <p className="hero__lede">
                State machines for Effect. Model checkouts, syncs, and retries as explicit states
                and typed events — impossible states can't happen, every transition has a name, and
                the definition you author — or your agent writes — is the one Studio shows you
                running.
              </p>
              <div className="hero__actions">
                <Link className="btn btn--primary" href={docsRoute}>
                  Read the docs
                </Link>
                <a className="btn btn--surface" href="#demo">
                  Buy some bugs ↓
                </a>
              </div>
            </div>
            <HeroCode />
          </section>

          <section id="demo" className="demo-section">
            <div className="demo-section__intro">
              <h2>
                Every click below is <span className="demo-section__highlight">an event.</span>
              </h2>
              <p>
                The Bug Emporium is an ordinary Effect app: one <code>Machine.run</code>, one{" "}
                <code>Attach.attach</code>. Buy some bugs — get declined, retry — and Studio's map,
                snapshot, and history follow. Click a history step to time-travel the inspector; the
                shop never notices.
              </p>
            </div>
            <BugEmporiumDemo />
          </section>
        </div>
      </div>

      <section className="band">
        <div className="band__copy">
          <h2>
            Built <span className="band__highlight">for Effect</span>, not adapted to it.
          </h2>
          <p>
            Dependencies stay services provided by Layers. Expected failures stay typed.
            Cancellation uses Scope and fibers, retry uses native Schedule. The handle is
            Effect-native: no Promise methods, no global runtime.
          </p>
          <div className="band__terminal">
            <span className="band__prompt">$</span>
            <code>{installCommand}</code>
          </div>
        </div>
      </section>

      <div className="landing-shell">
        <div className="landing-shell__wide">
          <section className="spec">
            <div className="spec__intro">
              <h2>
                What the definition <span className="spec__highlight">actually is</span>
              </h2>
              <p>
                One immutable value describes input, states, events, transitions, invoked work, and
                children. Tooling reads that value — it never executes Effects to discover the
                graph. Agents make code cheap to write; the graph keeps it cheap to review.
              </p>
            </div>
            <div className="spec__grid">
              <div className="spec-card spec-card--tilt-a">
                <span className="spec-card__kind spec-card__kind--pear">value</span>
                <span className="spec-card__title">Machine definition</span>
                <p>Immutable authored value. Inspectable without running Effects.</p>
              </div>
              <div className="spec-card spec-card--tilt-b">
                <span className="spec-card__kind spec-card__kind--cyan">effect</span>
                <span className="spec-card__title">Machine.run</span>
                <p>Scoped Effect. Requirements inferred from invoked work and children.</p>
              </div>
              <div className="spec-card spec-card--tilt-c">
                <span className="spec-card__kind spec-card__kind--coral">api</span>
                <span className="spec-card__title">Handle</span>
                <p>
                  <code>snapshot</code>, <code>changes</code>, <code>send</code>, <code>can</code>,{" "}
                  <code>completion</code>, <code>inspection</code>.
                </p>
              </div>
              <div className="spec-card spec-card--tilt-d">
                <span className="spec-card__kind spec-card__kind--cyan">devtool</span>
                <span className="spec-card__title">Studio</span>
                <p>
                  One devtool for every running machine — browser or Node. Attaching is one line,
                  and free when Studio isn't open.
                </p>
              </div>
              <div className="spec-card spec-card--tilt-e">
                <span className="spec-card__kind spec-card__kind--pear">graph</span>
                <span className="spec-card__title">Read-only graph</span>
                <p>
                  The definition projected for humans reviewing code — yours or your agent's. Never
                  a second editable source of truth.
                </p>
              </div>
              <div className="spec-card spec-card--dashed spec-card--tilt-f">
                <span className="spec-card__kind spec-card__kind--muted">not yet</span>
                <span className="spec-card__title">Outside v0</span>
                <p>Persistence, dynamic actors, and durable resumption of interrupted Effects.</p>
              </div>
            </div>
          </section>

          <footer className="foot-stmt">
            <p className="foot-stmt__line">
              Keep the behavior you can still <span className="foot-stmt__highlight">explain.</span>
            </p>
            <div className="foot-stmt__meta">
              <span>{appName}</span>
              <span>no bugs were harmed in this demo</span>
              <span>
                <Link href={docsRoute}>Docs</Link>
                {" · "}
                <a href={githubUrl} rel="noreferrer">
                  GitHub
                </a>
                {" · MIT"}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </main>
  )
}
