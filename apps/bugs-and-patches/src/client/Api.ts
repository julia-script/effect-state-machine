import * as Schema from "effect/Schema"
import * as Identity from "../server/Identity.js"

const ErrorResponse = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
})
const OkResponse = Schema.Struct({ ok: Schema.Boolean })

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

const decode = <A>(schema: Schema.Decoder<A>, value: unknown): A =>
  Schema.decodeUnknownSync(schema)(value)

export class ApiClient {
  constructor(readonly serverUrl: string) {}

  path(pathname: string): string {
    return `${this.serverUrl}${pathname}`
  }

  private async request<A>(
    pathname: string,
    schema: Schema.Decoder<A>,
    init?: RequestInit,
  ): Promise<A> {
    const response = await fetch(this.path(pathname), {
      ...init,
      credentials: "include",
      headers:
        init?.body === undefined
          ? init?.headers
          : { "content-type": "application/json", ...init.headers },
    })
    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      try {
        const failure = decode(ErrorResponse, body)
        throw new ApiError(response.status, failure.error.code, failure.error.message)
      } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(response.status, "InvalidResponse", "The server returned an unreadable error.")
      }
    }
    try {
      return decode(schema, body)
    } catch {
      throw new ApiError(502, "InvalidResponse", "The server response did not match the client contract.")
    }
  }

  me(): Promise<Identity.SelfProfile> {
    return this.request("/api/me", Identity.SelfProfile)
  }

  updateProfile(input: Identity.UpdateProfileRequest): Promise<Identity.SelfProfile> {
    return this.request("/api/me", Identity.SelfProfile, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  }

  deleteAccount(): Promise<{ readonly ok: boolean }> {
    return this.request("/api/me", OkResponse, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    })
  }

  leaderboard(): Promise<Identity.LeaderboardResponse> {
    return this.request("/api/leaderboard", Identity.LeaderboardResponse)
  }

  signOut(): Promise<{ readonly ok: boolean }> {
    return this.request("/auth/logout", OkResponse, { method: "POST" })
  }
}
