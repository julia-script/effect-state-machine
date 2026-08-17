import type { Metadata } from "next"
import Link from "next/link"
import { MachineStudioDemo } from "@/components/embedded-studio-demo"
import { CopyButton } from "@/components/landing/copy-button"
import { appName, docsRoute, gitConfig } from "@/lib/shared"

const installCommand = "pnpm add effect-state-machine effect@4.0.0-beta.106"
const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`

const heroSource = `export const definition = greeting.define(
  {
    id: "greeting",
    initial: (input) => ({ _tag: "Loading", name: input.name }),
  },
  {
    Loading: greeting.invoke({
      name: "Greeter.greet",
      effect: (state) =>
        Effect.flatMap(Greeter, ({ greet }) => greet(state.name)),
      onSuccess: { target: "Done", reduce: ({ value }) => ({ message: value }) },
      onFailure: { target: "Failed", reduce: ({ error }) => ({ message: error.message }) },
    }),
    Done: greeting.final(),
    Failed: greeting.final(),
  },
)`

const counterSource = `const definition = counter.define(
  {
    id: "counter",
    initial: ({ initialCount }) => ({ _tag: "Ready", count: initialCount }),
  },
  {
    Ready: counter.state({
      Start: { target: "Counting", reduce: ({ state }) => ({ count: state.count }) },
    }),
    Counting: counter.state({
      Increment: { stay: ({ state, event }) => ({ count: state.count + event.amount }) },
      Finish: { target: "Done", reduce: ({ state }) => ({ count: state.count }) },
    }),
    Done: counter.final(),
  },
)`

export const metadata: Metadata = {
  description:
    "Code-first, Effect-native state machines. The definition you author is the one Studio inspects.",
}

export default function HomePage() {
  return (
    <main id="main">
      <div className="landing-shell">
        <div className="landing-shell__wide">
          <section className="hero">
            <div className="hero__copy">
              <p className="hero__label">v0 · Effect 4 beta</p>
              <h1 className="hero__title">Write the machine. Watch it run.</h1>
              <p className="hero__lede">
                Code-first state machines for Effect. The definition you write is the one Studio
                inspects.
              </p>
              <div className="hero__actions">
                <Link className="btn btn--primary" href={docsRoute}>
                  Read the docs
                </Link>
                <CopyButton value={installCommand} label="Copy install" />
              </div>
            </div>
            <figure className="code-card">
              <div className="code-card__bar">
                <figcaption className="code-card__file">greeting.ts</figcaption>
                <CopyButton value={heroSource} label="Copy" />
              </div>
              <pre>
                <code>
                  <span className="tok-muted">export const</span> definition = greeting.define(
                  {"\n"}
                  {"  { id: "}
                  <span className="tok-str">"greeting"</span>
                  {", initial: (input) => ({ _tag: "}
                  <span className="tok-str">"Loading"</span>
                  {", name: input.name }) },"}
                  {"\n"}
                  {"  {"}
                  {"\n"}
                  {"    Loading: greeting."}
                  <span className="tok-key">invoke</span>
                  {"({"}
                  {"\n"}
                  {"      name: "}
                  <span className="tok-str">"Greeter.greet"</span>
                  {","}
                  {"\n"}
                  {"      effect: (state) =>"}
                  {"\n"}
                  {"        Effect.flatMap(Greeter, ({ greet }) => greet(state.name)),"}
                  {"\n"}
                  {"      onSuccess: { target: "}
                  <span className="tok-str">"Done"</span>
                  {", reduce: ({ value }) => ({ message: value }) },"}
                  {"\n"}
                  {"      onFailure: { target: "}
                  <span className="tok-str">"Failed"</span>
                  {", reduce: ({ error }) => ({ message: error.message }) },"}
                  {"\n"}
                  {"    }),"}
                  {"\n"}
                  {"    Done: greeting.final(),"}
                  {"\n"}
                  {"    Failed: greeting.final(),"}
                  {"\n"}
                  {"  },"}
                  {"\n"}
                  {")"}
                </code>
              </pre>
            </figure>
          </section>

          <section className="playground">
            <div className="playground__intro">
              <h2>Dispatch events. Inspect the graph.</h2>
              <p>
                This is the counter from{" "}
                <Link href={`${docsRoute}/tutorials/first-machine`}>Build your first machine</Link>.
                Select Start counting, Increment by 3, and Finish. The active node, snapshot, and
                history follow those three steps.
              </p>
            </div>
            <figure className="code-card playground__code">
              <div className="code-card__bar">
                <figcaption className="code-card__file">counter.ts</figcaption>
                <CopyButton value={counterSource} label="Copy" />
              </div>
              <pre>
                <code>{counterSource}</code>
              </pre>
            </figure>
            <div className="playground__stage">
              <MachineStudioDemo example="counter" height={480} />
            </div>
          </section>
        </div>
      </div>

      <section className="band">
        <div className="landing-shell">
          <div className="landing-shell__wide band__copy">
            <h2>Install against the verified Effect beta.</h2>
            <p>
              v0 targets <code>effect@4.0.0-beta.106</code>. Layers stay at the composition root.
              The handle is Effect-native: no Promise methods, no global runtime.
            </p>
            <div className="install">
              <code>{installCommand}</code>
              <CopyButton value={installCommand} label="Copy" />
            </div>
            <Link className="btn btn--primary" href={`${docsRoute}/tutorials/first-machine`}>
              First machine
            </Link>
          </div>
        </div>
      </section>

      <div className="landing-shell">
        <div className="landing-shell__wide">
          <section className="spec">
            <div className="spec__intro">
              <h2>What the definition actually is</h2>
              <p>
                One immutable value describes input, states, events, transitions, invoked work, and
                children. Tooling reads that value. It does not execute Effects to discover the
                graph.
              </p>
            </div>
            <table className="spec-sheet">
              <tbody>
                <tr>
                  <th scope="row">Machine definition</th>
                  <td>Immutable authored value. Inspectable without running Effects.</td>
                </tr>
                <tr>
                  <th scope="row">Machine.run</th>
                  <td>Scoped Effect. Requirements inferred from invoked work and children.</td>
                </tr>
                <tr>
                  <th scope="row">Handle</th>
                  <td>
                    <code>snapshot</code>, <code>changes</code>, <code>send</code>, <code>can</code>
                    , <code>completion</code>, <code>inspection</code>.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Graph</th>
                  <td>
                    Opt-in <code>effect-state-machine/devtools</code>. The core import does not load
                    it.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Studio</th>
                  <td>
                    Observational WebSocket session. Attaching does not interrupt the machine.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Outside v0</th>
                  <td>
                    Persistence, visual editing, dynamic actors, and durable resumption of
                    interrupted Effects.
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <footer className="foot-stmt">
            <p className="foot-stmt__line">Keep the behavior you can still explain.</p>
            <div className="foot-stmt__meta">
              <span>{appName}</span>
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
