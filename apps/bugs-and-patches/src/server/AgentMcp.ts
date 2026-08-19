import { createHash } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import * as Effect from "effect/Effect"
import * as z from "zod/v4"
import type * as AgentChallenge from "../protocol/AgentChallenge.js"
import type { ServerConfiguration } from "./Config.js"
import type { RegistryShape } from "./Registry.js"

const buckets = new Map<string, { count: number; resetAt: number }>()

export const redactedCapabilityId = (capability: string): string =>
  `challenge:${createHash("sha256").update(capability).digest("hex").slice(0, 12)}`

export const allowRequest = (
  remoteAddress: string,
  capability: string,
  limit: number,
  now = Date.now(),
): boolean => {
  const key = `${remoteAddress}:${redactedCapabilityId(capability)}`
  const current = buckets.get(key)
  if (current === undefined || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    return true
  }
  current.count += 1
  return current.count <= limit
}

const summary = (projection: AgentChallenge.MatchProjection) => {
  if (projection.status === "Completed") return "The Friendly match is complete."
  if (projection.actions.length === 0)
    return `Match revision ${projection.revision}. The other player is deciding; call wait_for_turn.`
  return `Match revision ${projection.revision}. Choose one of ${projection.actions.length} current legal actions.`
}

const success = (projection: AgentChallenge.MatchProjection, message = summary(projection)) => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: { ...projection },
})

const failure = (error: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text:
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : "This agent challenge is unavailable.",
    },
  ],
})

const run = <A>(effect: Effect.Effect<A, AgentChallenge.ChallengeError>) =>
  Effect.runPromise(effect).catch((error: unknown) => Promise.reject(error))

export const makeServer = (
  registry: RegistryShape,
  capability: string,
  configuration: Pick<ServerConfiguration, "agentWaitMaxMs">,
) => {
  const server = new McpServer({ name: "bugs-and-patches", version: "1.0.0" })

  server.registerTool(
    "accept_challenge",
    {
      title: "Accept Bugs & Patches challenge",
      description:
        "Claim this one Friendly opponent seat with a public agent name. Call this once before the other tools.",
      inputSchema: {
        agent_name: z.string().min(2).max(24).describe("Public 2-24 character agent name"),
      },
    },
    ({ agent_name }) =>
      run(registry.acceptAgentChallenge(capability, agent_name)).then(
        (projection) =>
          success(projection, `Challenge accepted as ${agent_name}. ${summary(projection)}`),
        failure,
      ),
  )

  server.registerTool(
    "get_match",
    {
      title: "Read my Bugs & Patches match",
      description:
        "Return only this agent seat's authoritative private view and current opaque legal actions.",
    },
    () => run(registry.agentProjection(capability)).then(success, failure),
  )

  server.registerTool(
    "wait_for_turn",
    {
      title: "Wait for my next decision",
      description:
        "Wait briefly for the match revision to advance or for this agent to receive legal actions.",
      inputSchema: {
        after_revision: z.number().int().nonnegative().optional(),
        timeout_seconds: z.number().positive().max(25).optional(),
      },
    },
    ({ after_revision, timeout_seconds }) => {
      const requested = Math.round(
        (timeout_seconds ?? configuration.agentWaitMaxMs / 1_000) * 1_000,
      )
      return run(
        registry.waitForAgentTurn(
          capability,
          after_revision,
          Math.min(requested, configuration.agentWaitMaxMs),
        ),
      ).then(success, failure)
    },
  )

  server.registerTool(
    "take_action",
    {
      title: "Take a current legal action",
      description:
        "Execute exactly one opaque action_id returned by the latest authoritative match projection.",
      inputSchema: {
        action_id: z.string().min(1).describe("Opaque action ID from the latest projection"),
      },
    },
    ({ action_id }) => run(registry.takeAgentAction(capability, action_id)).then(success, failure),
  )

  server.registerTool(
    "surrender",
    {
      title: "Surrender this Friendly match",
      description: "End this match immediately with the agent as loser. This cannot be undone.",
      annotations: { destructiveHint: true },
    },
    () =>
      run(registry.surrenderAgent(capability)).then(
        (projection) =>
          success(projection, "The agent surrendered. The Friendly match is complete."),
        failure,
      ),
  )

  return server
}

export const handleRequest = Effect.fn("AgentMcp.handleRequest")(function* (
  request: Request,
  registry: RegistryShape,
  capability: string,
  configuration: Pick<ServerConfiguration, "agentWaitMaxMs">,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      const server = makeServer(registry, capability, configuration)
      await server.connect(transport)
      try {
        return await transport.handleRequest(request)
      } finally {
        await server.close()
      }
    },
    catch: () => new Error("The MCP request could not be handled."),
  })
})

const statusCopy = (status: AgentChallenge.Lifecycle) =>
  status === "Open"
    ? "This challenge is waiting for an agent."
    : status === "Active"
      ? "This challenge has been claimed and the match is active."
      : status === "Completed"
        ? "This Friendly match has finished."
        : "This challenge is unavailable."

export const markdown = (
  endpoint: string,
  info: Readonly<{ status: AgentChallenge.Lifecycle; expiresAt: number }>,
) => `# Bugs & Patches agent challenge

${statusCopy(info.status)} This link authorizes one ephemeral opponent seat in an unranked Friendly match.

Remote MCP endpoint: ${endpoint}
Open challenge expires: ${new Date(info.expiresAt).toISOString()}

Connect this exact URL as a remote MCP server, then call \`accept_challenge\` with a 2-24 character public agent name. Use \`get_match\`, \`wait_for_turn\`, and only the opaque action IDs returned to \`take_action\`. Use \`surrender\` only when you intend to end the match.

If your agent host cannot attach a remote MCP server dynamically, add the endpoint manually in that host's MCP settings. Do not paste or share this bearer link anywhere else.
`

export const html = (
  info: Readonly<{ status: AgentChallenge.Lifecycle; expiresAt: number }>,
) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Challenge your agent · Bugs &amp; Patches</title>
<style>body{margin:0;background:#f6f0d8;color:#17172d;font:18px/1.5 system-ui,sans-serif}main{max-width:760px;margin:8vh auto;padding:3rem;border:3px dashed #17172d;border-radius:32px;background:#fffbea}h1{font-size:clamp(2rem,6vw,4rem);line-height:1;margin:.2em 0}code{word-break:break-word}strong{background:#e8ef35;padding:.15em .35em}.note{border-left:8px solid #ff6f61;padding:1rem;background:#fff}</style>
</head><body><main><small>BUGS &amp; PATCHES · FRIENDLY</small><h1>Challenge your agent</h1><p><strong>${statusCopy(info.status)}</strong></p><p>Give this exact page URL to a compatible AI agent. It doubles as a scoped remote MCP endpoint for one opponent seat.</p><p>Open-link expiry: <time>${new Date(info.expiresAt).toISOString()}</time></p><p class="note">Anyone holding this link can control the agent seat. It cannot access accounts, Ranked play, or other matches.</p><p>If the agent cannot connect automatically, add this page URL manually as a remote MCP server, then ask it to call <code>accept_challenge</code>.</p></main></body></html>`
