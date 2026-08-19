import { assert, it } from "@effect/vitest"
import * as Protocol from "../src/protocol/Protocol.js"

it("exposes the game socket path", () => {
  assert.strictEqual(Protocol.path, "/game")
})
