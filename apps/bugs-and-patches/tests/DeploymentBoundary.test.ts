import { describe, expect, it } from "vitest"
import { serverUrlFromEnv } from "../src/client/ClientConfig.js"
import * as Origin from "../src/server/Origin.js"

describe("deployment boundary", () => {
  it("accepts only the configured browser origin for credentialed routes", () => {
    expect(
      Origin.isAllowed("https://bugsandpatches.jlort.com", "https://bugsandpatches.jlort.com"),
    ).toBe(true)
    expect(Origin.isAllowed("https://malicious.example", "https://bugsandpatches.jlort.com")).toBe(
      false,
    )
    expect(Origin.isAllowed(undefined, "https://bugsandpatches.jlort.com")).toBe(true)
  })

  it("validates the public game-server build variable as an origin", () => {
    expect(serverUrlFromEnv("https://game.jlort.com", "http://127.0.0.1:5173")).toBe(
      "https://game.jlort.com",
    )
    expect(serverUrlFromEnv(undefined, "http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173")
    expect(() => serverUrlFromEnv("http://game.jlort.com", "http://127.0.0.1:5173")).toThrow()
    expect(() => serverUrlFromEnv("https://game.jlort.com/path", "http://127.0.0.1:5173")).toThrow()
  })
})
