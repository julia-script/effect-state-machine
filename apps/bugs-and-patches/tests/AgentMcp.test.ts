import { assert, describe, it } from "@effect/vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as AgentMcp from "../src/server/AgentMcp.js"
import type * as Identity from "../src/server/Identity.js"
import * as Registry from "../src/server/Registry.js"
import * as Postgres from "./Postgres.js"

const player = (): Identity.Player => ({
  id: crypto.randomUUID(),
  displayName: "Human Dev",
  anonymous: true,
  github: {
    login: "human-dev",
    avatarUrl: "https://avatars.test/human-dev",
    profileUrl: "https://github.com/human-dev",
  },
  rating: 1000,
  wins: 0,
  losses: 0,
  games: 0,
  createdAt: 1,
  updatedAt: 1,
})

describe("agent challenge MCP boundary", () => {
  it.effect(
    "plays through the official MCP client without exposing another seat",
    () =>
      Postgres.withDatabase((databaseUrl) =>
        Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* Registry.Registry
            const human = player()
            const created = yield* registry.createAgentChallenge(human)
            if (created._tag === "Rejected") return yield* Effect.die("Challenge creation failed")
            const capability = new URL(created.value.challenge.url).pathname.split("/").at(-1)
            if (capability === undefined) return yield* Effect.die("Capability missing")

            const client = new Client({ name: "bugs-and-patches-test-agent", version: "1.0.0" })
            const clientTransport = new StreamableHTTPClientTransport(
              new URL(created.value.challenge.url),
              {
                fetch: (url, init) =>
                  Effect.runPromise(
                    AgentMcp.handleRequest(new Request(url, init), registry, capability, {
                      agentWaitMaxMs: 10,
                    }),
                  ),
              },
            )
            yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => client.connect(clientTransport),
                catch: (cause) => new Error(String(cause)),
              }),
              () =>
                Effect.tryPromise({
                  try: () => client.close(),
                  catch: (cause) => new Error(String(cause)),
                }).pipe(
                  Effect.catch(() => Effect.void),
                  Effect.asVoid,
                ),
            )

            const listed = yield* Effect.tryPromise(() => client.listTools())
            assert.deepStrictEqual(listed.tools.map(({ name }) => name).sort(), [
              "accept_challenge",
              "get_match",
              "surrender",
              "take_action",
              "wait_for_turn",
            ])
            const accepted = yield* Effect.tryPromise(() =>
              client.callTool({ name: "accept_challenge", arguments: { agent_name: "Codex" } }),
            )
            assert.notStrictEqual(accepted.isError, true)
            assert.strictEqual(JSON.stringify(accepted).includes("seatToken"), false)
            assert.strictEqual(JSON.stringify(accepted).includes("githubId"), false)

            let read = yield* Effect.tryPromise(() =>
              client.callTool({ name: "get_match", arguments: {} }),
            )
            let structured = read.structuredContent as
              | {
                  readonly revision?: number
                  readonly actions?: ReadonlyArray<{ readonly actionId: string }>
                }
              | undefined
            for (
              let attempts = 0;
              attempts < 3 && (structured?.actions?.length ?? 0) === 0;
              attempts++
            ) {
              const humanView = yield* registry.view(created.value)
              if (humanView._tag === "Accepted") {
                const pass = humanView.value.legalActions.find(
                  ({ action, enabled }) => enabled && action.startsWith("Pass"),
                )
                if (
                  pass?.action === "PassBug" ||
                  pass?.action === "PassPatch" ||
                  pass?.action === "PassSideEffect"
                ) {
                  yield* registry.command(created.value, {
                    _tag: pass.action,
                    playerId: "player-one",
                  })
                }
              }
              read = yield* Effect.tryPromise(() =>
                client.callTool({ name: "get_match", arguments: {} }),
              )
              structured = read.structuredContent as
                | {
                    readonly revision?: number
                    readonly actions?: ReadonlyArray<{ readonly actionId: string }>
                  }
                | undefined
            }
            const action = structured?.actions?.[0]
            assert.ok(action !== undefined)
            const acted = yield* Effect.tryPromise(() =>
              client.callTool({ name: "take_action", arguments: { action_id: action.actionId } }),
            )
            assert.notStrictEqual(acted.isError, true)
            const stale = yield* Effect.tryPromise(() =>
              client.callTool({ name: "take_action", arguments: { action_id: action.actionId } }),
            )
            assert.strictEqual(stale.isError, true)

            const waited = yield* Effect.tryPromise(() =>
              client.callTool({
                name: "wait_for_turn",
                arguments: { after_revision: structured?.revision, timeout_seconds: 0.001 },
              }),
            )
            assert.notStrictEqual(waited.isError, true)
            const surrendered = yield* Effect.tryPromise(() =>
              client.callTool({ name: "surrender", arguments: {} }),
            )
            assert.notStrictEqual(surrendered.isError, true)
            assert.match(JSON.stringify(surrendered), /Completed/)
            const creatorView = yield* registry.inspectAgentChallenge(human.id)
            assert.strictEqual(creatorView._tag, "Accepted")
            if (creatorView._tag === "Accepted") {
              assert.strictEqual(creatorView.value.status, "Completed")
            }
          }).pipe(
            Effect.provide(
              Registry.layer({ challengeOrigin: "https://game.example.test" }).pipe(
                Layer.provide(Postgres.storageLayer(databaseUrl)),
              ),
            ),
          ),
        ),
      ),
    20_000,
  )

  it("serves truthful human and agent instructions without exposing a creator", () => {
    const info = { status: "Open" as const, expiresAt: Date.UTC(2030, 0, 1) }
    const endpoint = "https://game.example.test/challenge/secret"
    const markdown = AgentMcp.markdown(endpoint, info)
    const html = AgentMcp.html(info)
    assert.match(markdown, /remote MCP server/)
    assert.match(markdown, /accept_challenge/)
    assert.match(markdown, /manually/)
    assert.notMatch(markdown, /GitHub/)
    assert.match(html, /Challenge your agent/)
    assert.notMatch(html, /human-dev/)
    assert.match(AgentMcp.redactedCapabilityId("secret"), /^challenge:[a-f0-9]{12}$/u)
  })

  it("rate-limits by a redacted capability identity and resets the window", () => {
    const capability = `secret-${crypto.randomUUID()}`
    const redacted = AgentMcp.redactedCapabilityId(capability)
    assert.strictEqual(redacted.includes(capability), false)
    assert.strictEqual(AgentMcp.allowRequest("192.0.2.10", capability, 2, 1_000), true)
    assert.strictEqual(AgentMcp.allowRequest("192.0.2.10", capability, 2, 1_001), true)
    assert.strictEqual(AgentMcp.allowRequest("192.0.2.10", capability, 2, 1_002), false)
    assert.strictEqual(AgentMcp.allowRequest("192.0.2.10", capability, 2, 61_000), true)
  })
})
