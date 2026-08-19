import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import * as Catalog from "../game/Catalog.js"
import type * as Identity from "../server/Identity.js"
import { ApiClient, ApiError } from "./Api.js"
import * as ChallengeLink from "./ChallengeLink.js"
import { serverUrlFromEnv } from "./ClientConfig.js"
import { ConnectionController, websocketUrl } from "./Connection.js"
import { Battle } from "./components/Battle.js"
import { GameCard } from "./components/GameCard.js"
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Notice,
  Page,
  Panel,
} from "./components/Primitives.js"
import { howToPlaySections, modeCopy, playAction } from "./HowToPlayContent.js"
import { navigate, pathFor, type Route, routeFromPath } from "./Routes.js"

type SessionState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "SignedOut" }
  | { readonly _tag: "SignedIn"; readonly player: Identity.SelfProfile }
  | { readonly _tag: "Error"; readonly message: string }

const serverUrl = serverUrlFromEnv(import.meta.env.VITE_BUGS_PATCHES_SERVER_URL, location.origin)

const Link = ({
  to,
  children,
  className = "",
}: {
  to: Route
  children: ReactNode
  className?: string
}) => (
  <a
    href={pathFor(to)}
    className={className}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate(to)
    }}
  >
    {children}
  </a>
)

const Logo = () => (
  <Link to="lobby" className="logo" aria-label="Bugs and Patches home">
    <span className="logo__bug" aria-hidden="true">
      <i />
      <i />
    </span>
    <span>
      Bugs <b>&amp;</b> Patches
    </span>
  </Link>
)

const Shell = ({
  session,
  children,
}: {
  readonly session: SessionState
  readonly children: ReactNode
}) => (
  <div className="app-shell">
    <header className="site-header">
      <Logo />
      <nav className="site-nav" aria-label="Main navigation">
        <Link to="how-to-play">How to Play</Link>
        <Link to="stack">The Stack</Link>
        <Link to="leaderboard">Top Contributors</Link>
        {session._tag === "SignedIn" ? <Link to="settings">Settings</Link> : null}
      </nav>
      {session._tag === "SignedIn" ? (
        <Link to="settings" className="header-profile">
          <Avatar
            name={session.player.displayName}
            src={session.player.github.avatarUrl}
            size="small"
          />
          <span>{session.player.displayName}</span>
        </Link>
      ) : (
        <a className="btn btn--push btn--pear header-sign-in" href={`${serverUrl}/auth/github`}>
          Sign in
        </a>
      )}
      <details className="mobile-nav">
        <summary aria-label="Open navigation">Menu</summary>
        <nav aria-label="Mobile navigation">
          <Link to="lobby">Play</Link>
          <Link to="how-to-play">How to Play</Link>
          <Link to="stack">The Stack</Link>
          <Link to="leaderboard">Top Contributors</Link>
          {session._tag === "SignedIn" ? <Link to="settings">Settings</Link> : null}
        </nav>
      </details>
    </header>
    {children}
    <footer className="site-footer">
      <p>Ship Bugs. Deploy Patches. Keep Uptime above zero.</p>
      <div>
        <Logo />
        <span>A small server-authoritative card game demo.</span>
      </div>
    </footer>
  </div>
)

const LeaderboardBoard = ({ api }: { readonly api: ApiClient }) => {
  const [state, setState] = useState<{
    loading: boolean
    data: Identity.LeaderboardResponse | null
    error: string | null
  }>({ loading: true, data: null, error: null })
  useEffect(() => {
    void api.leaderboard().then(
      (data) => setState({ loading: false, data, error: null }),
      (error: unknown) =>
        setState({
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "The leaderboard could not be read.",
        }),
    )
  }, [api])
  return (
    <section className="lobby-leaderboard">
      <header>
        <h2>Top Contributors</h2>
        <Badge tone="ink">start 1000</Badge>
      </header>
      {state.loading ? (
        <div className="leaderboard-skeleton" role="status" aria-label="Loading leaderboard">
          <span />
          <span />
          <span />
        </div>
      ) : state.error !== null ? (
        <p className="leaderboard-note">{state.error}</p>
      ) : state.data === null || state.data.rows.length === 0 ? (
        <p className="leaderboard-note">
          No Ranked incidents yet. The first completed match opens the board.
        </p>
      ) : (
        <ol className="leaderboard-list">
          {state.data.rows.map((row) => (
            <li key={`${row.rank}-${row.identity.displayName}`}>
              <span className="leaderboard-rank">#{row.rank}</span>
              <Avatar
                name={row.identity.displayName}
                src={row.identity.github?.avatarUrl}
                size="small"
              />
              <strong className="leaderboard-name">{row.identity.displayName}</strong>
              {row.identity.github === null ? null : (
                <a
                  className="github-chip"
                  href={row.identity.github.profileUrl}
                  rel="noreferrer"
                  aria-label={`${row.identity.displayName} on GitHub`}
                >
                  GH
                </a>
              )}
              <span className="leaderboard-record">
                {row.wins}W / {row.losses}L
              </span>
              <strong className="leaderboard-rating">{row.rating}</strong>
            </li>
          ))}
        </ol>
      )}
      <footer>rating survives restarts · active matches do not</footer>
    </section>
  )
}

const LobbyTitle = () => (
  <header className="lobby-title">
    <h1>
      Bugs <span>&amp;</span> Patches
    </h1>
    <p>Ship Bugs at your opponent. Patch theirs before they land. Last dev above 0 Uptime wins.</p>
  </header>
)

const SignedOutLobby = ({ api }: { readonly api: ApiClient }) => (
  <Page className="lobby-page">
    <LobbyTitle />
    <div className="lobby-grid">
      <div className="lobby-column">
        <Panel className="profile-card sign-in-card">
          <div>
            <h2>Sign in to play</h2>
            <p>GitHub connects your public profile. You can hide it or delete the account later.</p>
          </div>
          <a className="btn btn--push btn--ink" href={`${serverUrl}/auth/github`}>
            Sign in with GitHub
          </a>
        </Panel>
        <Panel className="mode-card mode-card--ranked">
          <Badge tone="coral">Ranked</Badge>
          <h2>Ranked queue</h2>
          <p>{modeCopy.Ranked}</p>
          <Button tone="coral" disabled>
            Join Ranked queue
          </Button>
          <small>Sign in with GitHub before playing.</small>
        </Panel>
        <Panel className="mode-card mode-card--friendly">
          <Badge tone="cyan">Friendly</Badge>
          <h2>Friendly match</h2>
          <p>{modeCopy.Friendly}</p>
          <Button tone="cyan" disabled>
            Create invite code
          </Button>
          <small>Sign in with GitHub before playing.</small>
        </Panel>
      </div>
      <LeaderboardBoard api={api} />
    </div>
  </Page>
)

const Lobby = ({
  session,
  connection,
  api,
}: {
  readonly session: Extract<SessionState, { readonly _tag: "SignedIn" }>
  readonly connection: ConnectionController
  readonly api: ApiClient
}) => {
  const snapshot = useSyncExternalStore(connection.subscribe, connection.getSnapshot)
  const [joinCode, setJoinCode] = useState("")
  const [copyState, setCopyState] = useState<"Idle" | "Copied" | "Failed">("Idle")

  useEffect(() => {
    if (snapshot.agentChallenge?.status !== "Open") return
    const timer = setInterval(() => connection.refreshChallengeExpiry(), 1_000)
    return () => clearInterval(timer)
  }, [connection, snapshot.agentChallenge?.status])

  const copyChallenge = () => {
    const url = snapshot.agentChallenge?.url
    if (url === undefined) return
    void ChallengeLink.copy(navigator.clipboard, url).then(setCopyState)
  }

  return (
    <Page className="lobby-page lobby-page--signed-in">
      <LobbyTitle />
      {snapshot.notice === null ? null : (
        <Notice tone="error" onDismiss={() => connection.clearNotice()}>
          {snapshot.notice}
        </Notice>
      )}
      <div className="lobby-grid">
        <div className="lobby-column">
          <Panel className="profile-card">
            <Avatar
              name={session.player.displayName}
              src={session.player.anonymous ? null : session.player.github.avatarUrl}
            />
            <div>
              <strong>{session.player.displayName}</strong>
              <span className="profile-stats">
                <Badge tone="pear">ELO {session.player.rating}</Badge>
                <Badge tone="ink">
                  {session.player.wins}W / {session.player.losses}L
                </Badge>
              </span>
            </div>
            <Badge tone="success">Signed in</Badge>
          </Panel>
          <Panel className="mode-card mode-card--ranked">
            <Badge tone="coral">Ranked</Badge>
            <h2>Ranked queue</h2>
            <p>
              Get paired with the next dev in line. Rating is on the line; surrendering or vanishing
              counts as a loss.
            </p>
            {snapshot.kind === "Queued" ? (
              <>
                <div className="queue-chip">Waiting in the Ranked queue…</div>
                <Button variant="outline" tone="ink" onClick={() => connection.leaveRanked()}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                tone="coral"
                disabled={snapshot.kind === "Connecting"}
                onClick={() => connection.joinRanked()}
              >
                {snapshot.kind === "Connecting" ? "Connecting…" : "Join Ranked queue"}
              </Button>
            )}
          </Panel>
          <Panel className="mode-card mode-card--friendly">
            <Badge tone="cyan">Friendly</Badge>
            <h2>Friendly match</h2>
            <p>
              No rating, no pressure. Invite another person—or hand a scoped link to an AI agent.
            </p>
            {snapshot.kind === "Waiting" && snapshot.inviteCode !== null ? (
              <>
                <div className="invite-code">
                  <strong>{snapshot.inviteCode}</strong>
                  <Button
                    variant="outline"
                    tone="ink"
                    onClick={() => void navigator.clipboard.writeText(snapshot.inviteCode ?? "")}
                  >
                    Copy
                  </Button>
                </div>
                <div className="queue-chip">Waiting for your opponent to join…</div>
              </>
            ) : (
              <Button
                tone="cyan"
                disabled={snapshot.kind === "Connecting" || snapshot.kind === "Waiting"}
                onClick={() => connection.createFriendly()}
              >
                Create invite code
              </Button>
            )}
            <div className="join-row">
              <input
                aria-label="Invite code"
                value={joinCode}
                maxLength={12}
                autoCapitalize="characters"
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="e.g. 7B2FBE51"
              />
              <Button
                variant="outline"
                tone="ink"
                disabled={
                  joinCode.trim().length === 0 ||
                  snapshot.kind === "Connecting" ||
                  snapshot.kind === "Waiting"
                }
                onClick={() => connection.joinFriendly(joinCode)}
              >
                Join →
              </Button>
            </div>
            <div className="agent-challenge">
              <div className="agent-challenge__heading">
                <span aria-hidden="true">✦</span>
                <div>
                  <strong>Challenge your agent</strong>
                  <small>One ephemeral agent seat · always unranked</small>
                </div>
              </div>
              {snapshot.agentChallenge?.status === "Open" ? (
                <>
                  <code>{snapshot.agentChallenge.url}</code>
                  <div className="button-row">
                    <Button tone="pear" onClick={copyChallenge}>
                      {copyState === "Copied" ? "Copied!" : "Copy challenge link"}
                    </Button>
                    <Button
                      variant="outline"
                      tone="ink"
                      onClick={() => connection.revokeAgentChallenge()}
                    >
                      Revoke
                    </Button>
                  </div>
                  <small className="agent-challenge__warning">
                    Anyone with this link controls the agent seat. It expires at{" "}
                    {new Date(snapshot.agentChallenge.expiresAt).toLocaleTimeString()} and a server
                    restart invalidates it.
                  </small>
                  {copyState === "Failed" ? (
                    <span role="alert">Copy failed—select the URL above manually.</span>
                  ) : null}
                </>
              ) : snapshot.agentChallenge?.status === "Expired" ||
                snapshot.agentChallenge?.status === "Revoked" ? (
                <>
                  <p>
                    {snapshot.agentChallenge.status === "Expired"
                      ? "That challenge link expired."
                      : "Challenge revoked."}
                  </p>
                  <Button tone="pear" onClick={() => connection.createAgentChallenge()}>
                    Create a fresh link
                  </Button>
                </>
              ) : snapshot.agentChallenge?.status === "Active" ? (
                <div className="queue-chip">
                  {snapshot.agentChallenge.agent?.displayName ?? "Your agent"} joined. Opening the
                  incident table…
                </div>
              ) : (
                <Button
                  tone="pear"
                  disabled={snapshot.kind === "Connecting" || snapshot.kind === "Waiting"}
                  onClick={() => connection.createAgentChallenge()}
                >
                  {snapshot.kind === "Connecting" ? "Creating…" : "Create agent challenge"}
                </Button>
              )}
            </div>
          </Panel>
          {snapshot.hasSavedSeat &&
          (snapshot.kind === "Disconnected" ||
            snapshot.kind === "Error" ||
            snapshot.kind === "Lobby") ? (
            <aside className="saved-seat">
              <div>
                <strong>A match seat is saved.</strong>
                <span>Restore the latest server view.</span>
              </div>
              <Button variant="outline" tone="ink" onClick={() => connection.reconnect()}>
                Reconnect
              </Button>
            </aside>
          ) : null}
        </div>
        <LeaderboardBoard api={api} />
      </div>
    </Page>
  )
}

const HowToPlay = ({ session }: { readonly session: SessionState }) => {
  const action = playAction(session._tag === "SignedIn", serverUrl)
  return (
    <Page className="rules-page">
      <header className="page-intro page-intro--rules">
        <Badge tone="pear">How to Play</Badge>
        <h1>One incident. Three phases. Zero sensible deployment decisions.</h1>
        <p>
          Learn the complete demo rules in about three minutes. Card balance is provisional; the
          server’s legal actions are always authoritative.
        </p>
        <div className="button-row">
          {action.internal ? (
            <Link to="lobby" className="btn btn--push btn--pear">
              {action.label}
            </Link>
          ) : (
            <a className="btn btn--push btn--pear" href={action.href}>
              {action.label}
            </a>
          )}
          <Link to="stack" className="btn btn--outline btn--ink">
            Browse the Stack
          </Link>
        </div>
      </header>
      <section className="rule-facts" aria-label="Game facts">
        <div>
          <strong>100</strong>
          <span>starting Uptime</span>
        </div>
        <div>
          <strong>30</strong>
          <span>cards per Stack</span>
        </div>
        <div>
          <strong>5</strong>
          <span>opening cards</span>
        </div>
        <div>
          <strong>2</strong>
          <span>players</span>
        </div>
      </section>
      <section className="workflow" aria-label="Turn sequence">
        {howToPlaySections.map((section, index) => (
          <article className={`workflow-step workflow-step--${(index % 3) + 1}`} key={section.id}>
            <span className="workflow-step__number">{index + 1}</span>
            <div>
              <h2>{section.title}</h2>
              <p>{section.copy}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="card-types">
        <div>
          <Badge tone="bug">Bug</Badge>
          <h2>Attack</h2>
          <p>
            Pay the cost, deal base damage, then resolve printed abilities. Some Bugs simply attack.
          </p>
        </div>
        <div>
          <Badge tone="patch">Patch</Badge>
          <h2>Defend</h2>
          <p>Reduce base damage and sometimes clean up, reflect, heal, or cancel a side effect.</p>
        </div>
        <div>
          <Badge tone="sideeffect">Side Effect</Badge>
          <h2>Change the incident</h2>
          <p>
            Draw, discard, heal, damage, or leave an ongoing effect. They do not all target the
            opponent.
          </p>
        </div>
      </section>
      <section className="rules-notes">
        <article>
          <h2>Timing matters</h2>
          <p>
            Victory is checked after base damage and again as secondary abilities resolve. A Patch
            can cancel secondary abilities without erasing the Bug’s base attack.
          </p>
        </article>
        <article>
          <h2>The discard is not forever</h2>
          <p>
            When a Stack empties, its discard pile becomes the next Stack. Running out of cards is
            not a loss condition.
          </p>
        </article>
        <article>
          <h2>Friendly or Ranked</h2>
          <p>
            Friendly uses an invite and never affects rating. Ranked uses a random queue and records
            one canonical result.
          </p>
        </article>
      </section>
    </Page>
  )
}

const StackGallery = () => {
  const counts = new Map(Catalog.stack().map(({ cardId }) => [cardId, 0]))
  for (const { cardId } of Catalog.stack()) {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
  }
  const groups = (["Bug", "Patch", "SideEffect"] as const).map((type) => ({
    type,
    cards: Catalog.catalog.filter((card) => card._tag === type),
    count: Catalog.stack().filter(({ cardId }) => Catalog.find(cardId)?._tag === type).length,
  }))
  const groupLabel = (type: (typeof groups)[number]["type"]) =>
    type === "Patch" ? "Patches" : type === "Bug" ? "Bugs" : "Side Effects"
  return (
    <Page className="stack-page">
      <header className="page-intro page-intro--stack">
        <Badge tone="ink">The Stack · v0</Badge>
        <h1>The Stack — 30 cards</h1>
        <p>
          16 unique cards. The ×N badge shows how many copies each Stack runs. Costs, attack, and
          defense use Uptime points.
        </p>
      </header>
      {groups.map(({ type, cards, count }) => (
        <section className="stack-group" key={type}>
          <Badge tone={type === "Bug" ? "bug" : type === "Patch" ? "patch" : "sideeffect"}>
            {groupLabel(type)} · {count} cards
          </Badge>
          <div className="catalog-grid">
            {cards.map((card) => (
              <GameCard key={card.id} card={card} count={counts.get(card.id)} />
            ))}
          </div>
        </section>
      ))}
      <Notice>
        Balance is provisional. These are implementation cards; the real card-design pass remains
        open.
      </Notice>
    </Page>
  )
}

const Leaderboard = ({ api }: { readonly api: ApiClient }) => {
  return (
    <Page className="leaderboard-page">
      <header className="page-intro page-intro--leaderboard">
        <Badge tone="coral">Ranked</Badge>
        <h1>Top Contributors</h1>
        <p>To production incidents. Only completed Ranked matches appear here.</p>
      </header>
      <LeaderboardBoard api={api} />
    </Page>
  )
}

const Settings = ({
  session,
  api,
  onSession,
  connection,
}: {
  readonly session: Extract<SessionState, { readonly _tag: "SignedIn" }>
  readonly api: ApiClient
  readonly onSession: (state: SessionState) => void
  readonly connection: ConnectionController
}) => {
  const [displayName, setDisplayName] = useState(session.player.displayName)
  const [anonymous, setAnonymous] = useState(session.player.anonymous)
  const [status, setStatus] = useState<{ saving: boolean; error: string | null }>({
    saving: false,
    error: null,
  })
  const [deleteStep, setDeleteStep] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const validName = displayName.trim().length >= 2 && displayName.trim().length <= 24
  const save = () => {
    setStatus({ saving: true, error: null })
    void api.updateProfile({ displayName, anonymous }).then(
      (player) => {
        onSession({ _tag: "SignedIn", player })
        setStatus({ saving: false, error: null })
      },
      (error: unknown) =>
        setStatus({
          saving: false,
          error: error instanceof Error ? error.message : "Profile settings were not saved.",
        }),
    )
  }
  const signOut = () => {
    setStatus({ saving: true, error: null })
    void api.signOut().then(
      () => {
        connection.reset()
        onSession({ _tag: "SignedOut" })
        navigate("lobby")
      },
      (error: unknown) =>
        setStatus({
          saving: false,
          error: error instanceof Error ? error.message : "Sign-out did not complete.",
        }),
    )
  }
  const deleteAccount = () => {
    setStatus({ saving: true, error: null })
    void api.deleteAccount().then(
      () => {
        connection.reset()
        onSession({ _tag: "SignedOut" })
        navigate("lobby")
      },
      (error: unknown) =>
        setStatus({
          saving: false,
          error:
            error instanceof Error
              ? error.message
              : "Account deletion did not complete. Try again.",
        }),
    )
  }
  return (
    <Page className="settings-page">
      <header className="page-intro">
        <Badge tone="ink">Settings</Badge>
        <h1>Account settings</h1>
      </header>
      {status.error === null ? null : <Notice tone="error">{status.error}</Notice>}
      <Panel className="settings-panel">
        <h2>Identity</h2>
        <div className="linked-profile">
          <Avatar name={session.player.displayName} src={session.player.github.avatarUrl} />
          <div>
            <strong>github.com/{session.player.github.login}</strong>
            <small>connected · rating and record live on this account</small>
          </div>
        </div>
        <Field
          label="In-game username — shown to everyone"
          helper="Use 2–24 characters. Defaults to your GitHub handle."
          error={validName ? null : "Display name must be between 2 and 24 characters."}
        >
          <input
            value={displayName}
            aria-invalid={!validName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={24}
          />
        </Field>
        <div className="button-row">
          <Button tone="coral" disabled={!validName || status.saving} onClick={save}>
            {status.saving ? "Saving…" : "Save username"}
          </Button>
          <Button variant="outline" tone="ink" disabled={status.saving} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Panel>
      <Panel className="settings-panel privacy-panel">
        <h2>Privacy</h2>
        <label className="privacy-toggle">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          <span>
            <strong>Stay anonymous</strong>
            <small>
              Hide your GitHub identity everywhere. Your in-game username is shown either way.
            </small>
          </span>
        </label>
        <div className="identity-preview">
          <span>How you appear</span>
          <div>
            <Avatar
              name={displayName}
              src={anonymous ? null : session.player.github.avatarUrl}
              size="small"
            />
            <strong>{displayName || "Player"}</strong>
            {anonymous ? null : <span className="github-chip">GH</span>}
          </div>
        </div>
      </Panel>
      <Panel className="danger-panel">
        <h2>Delete account</h2>
        <p>
          This revokes every session, unlinks GitHub, removes you from Top Contributors, and turns
          retained match results into an anonymous “Deleted player” record. It cannot be undone.
        </p>
        {!deleteStep ? (
          <Button variant="outline" tone="coral" onClick={() => setDeleteStep(true)}>
            Start account deletion
          </Button>
        ) : (
          <div className="delete-confirm">
            <Field label="Type DELETE to confirm" helper="This is the final confirmation.">
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="button-row">
              <Button
                variant="soft"
                tone="coral"
                disabled={confirmation !== "DELETE" || status.saving}
                onClick={deleteAccount}
              >
                {status.saving ? "Deleting account…" : "Delete account forever"}
              </Button>
              <Button
                variant="outline"
                tone="ink"
                disabled={status.saving}
                onClick={() => {
                  setDeleteStep(false)
                  setConfirmation("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </Page>
  )
}

export const App = () => {
  const api = useMemo(() => new ApiClient(serverUrl), [])
  const connection = useMemo(
    () => new ConnectionController(websocketUrl(serverUrl), localStorage),
    [],
  )
  const connectionSnapshot = useSyncExternalStore(connection.subscribe, connection.getSnapshot)
  const [route, setRoute] = useState<Route>(() => routeFromPath(location.pathname))
  const [session, setSession] = useState<SessionState>({ _tag: "Loading" })

  useEffect(() => {
    const update = () => setRoute(routeFromPath(location.pathname))
    addEventListener("popstate", update)
    return () => removeEventListener("popstate", update)
  }, [])

  useEffect(() => {
    void api.me().then(
      (player) => setSession({ _tag: "SignedIn", player }),
      (error: unknown) =>
        setSession(
          error instanceof ApiError && error.status === 401
            ? { _tag: "SignedOut" }
            : {
                _tag: "Error",
                message:
                  error instanceof Error ? error.message : "The session could not be checked.",
              },
        ),
    )
    return () => connection.dispose()
  }, [api, connection])

  useEffect(() => {
    if (
      connectionSnapshot.view !== null &&
      connectionSnapshot.view.phase !== "Waiting" &&
      route === "lobby"
    )
      navigate("battle")
  }, [connectionSnapshot.view, route])

  let content: ReactNode
  if (route === "how-to-play") content = <HowToPlay session={session} />
  else if (route === "stack") content = <StackGallery />
  else if (route === "leaderboard") content = <Leaderboard api={api} />
  else if (route === "battle")
    content =
      connectionSnapshot.view === null ? (
        <Page>
          <EmptyState
            title="No active battle view"
            action={
              connectionSnapshot.hasSavedSeat ? (
                <Button onClick={() => connection.reconnect()}>Reconnect saved match</Button>
              ) : (
                <Link to="lobby" className="btn btn--push btn--pear">
                  Return to lobby
                </Link>
              )
            }
          >
            Start a match or reconnect a saved seat to load the authoritative table.
          </EmptyState>
        </Page>
      ) : (
        <Page className="battle-page">
          <Battle
            view={connectionSnapshot.view}
            pending={connectionSnapshot.pendingRequestId !== null}
            notice={connectionSnapshot.notice}
            onDismissNotice={() => connection.clearNotice()}
            onCommand={(event) => connection.command(event)}
          />
        </Page>
      )
  else if (route === "settings")
    content =
      session._tag === "SignedIn" ? (
        <Settings session={session} api={api} onSession={setSession} connection={connection} />
      ) : (
        <Page>
          <EmptyState
            title="Sign in to change settings"
            action={
              <a className="btn btn--push btn--pear" href={`${serverUrl}/auth/github`}>
                Sign in with GitHub
              </a>
            }
          >
            Profile and privacy settings belong to a signed-in player.
          </EmptyState>
        </Page>
      )
  else if (session._tag === "Loading")
    content = (
      <Page>
        <Panel className="status-panel">
          <div className="loader" />
          <h1>Checking the pager…</h1>
        </Panel>
      </Page>
    )
  else if (session._tag === "Error")
    content = (
      <Page>
        <EmptyState
          title="The session check failed"
          action={<Button onClick={() => location.reload()}>Try again</Button>}
        >
          {session.message}
        </EmptyState>
      </Page>
    )
  else if (session._tag === "SignedOut") content = <SignedOutLobby api={api} />
  else content = <Lobby session={session} connection={connection} api={api} />

  return route === "battle" ? (
    <div className="battle-shell">{content}</div>
  ) : (
    <Shell session={session}>{content}</Shell>
  )
}
