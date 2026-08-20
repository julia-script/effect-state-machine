import { assert, describe, it } from "@effect/vitest"
import * as MachinePlan from "../src/MachinePlan.js"

type State = Readonly<{ _tag: "Idle"; count: number }> | Readonly<{ _tag: "Done"; count: number }>
type Event = Readonly<{ _tag: "Advance"; amount: number }>

const idle: State = { _tag: "Idle", count: 1 }
const advance: Event = { _tag: "Advance", amount: 2 }

describe("MachinePlan", () => {
  it("plans ignored, stay, self-target, and guarded event decisions without effects", () => {
    assert.strictEqual(MachinePlan.planEvent(undefined, idle, advance), undefined)
    assert.deepStrictEqual(MachinePlan.planEvent({ ignore: true }, idle, advance), {
      kind: "ignore",
    })
    assert.deepStrictEqual(
      MachinePlan.planEvent(
        { stay: ({ state, event }) => ({ count: state.count + event.amount }) },
        idle,
        advance,
      ),
      {
        kind: "stay",
        previous: idle,
        next: { _tag: "Idle", count: 3 },
        entry: { source: "Idle", target: "Idle", changed: false },
      },
    )
    const self = MachinePlan.planEvent(
      { target: "Idle", reduce: ({ state }) => ({ count: state.count + 1 }) },
      idle,
      advance,
    )
    assert.strictEqual(self?.kind, "transition")
    if (self?.kind !== "transition") return
    assert.deepStrictEqual(self.entry, { source: "Idle", target: "Idle", changed: true })

    const guarded = MachinePlan.planEvent(
      {
        branches: [
          {
            when: { name: "large", guard: ({ event }) => event.amount > 5 },
            target: "Done",
            reduce: ({ state }) => ({ count: state.count }),
          },
          {
            otherwise: true,
            target: "Idle",
            reduce: ({ state, event }) => ({ count: state.count + event.amount }),
          },
        ],
      },
      idle,
      advance,
    )
    assert.strictEqual(guarded?.kind, "transition")
    if (guarded?.kind !== "transition") return
    assert.deepStrictEqual(guarded.branch, { kind: "otherwise", index: 1 })
  })

  it("plans region updates as one deterministic macrostep", () => {
    const parent = {
      _tag: "Parallel",
      left: { _tag: "Waiting", count: 0 },
      right: { _tag: "Waiting", count: 10 },
    }
    const left = { _tag: "Done", count: 1 }
    const right = { _tag: "Waiting", count: 11 }
    const updates: Readonly<Record<string, MachinePlan.Tagged>> = { left, right }
    const planned = MachinePlan.planRegionMacrostep(parent, updates, new Set(["left"]))
    assert.deepStrictEqual(planned.next, {
      _tag: "Parallel",
      left,
      right,
    })
    assert.deepStrictEqual([...planned.reenteredSlots], ["left"])
  })

  it("recognizes final region sets and stale entry identities", () => {
    const node: MachinePlan.RegionsNode<MachinePlan.Tagged, MachinePlan.Tagged> = {
      kind: "regions",
      regions: {
        left: { states: { Done: { final: true } } },
        right: { states: { Done: { final: true } } },
      },
    }
    assert.strictEqual(
      MachinePlan.regionsComplete(node, {
        _tag: "Parallel",
        left: { _tag: "Done" },
        right: { _tag: "Done" },
      }),
      true,
    )
    assert.strictEqual(
      MachinePlan.isStaleEntry(
        { stateTag: "Active", generation: 1 },
        { stateTag: "Active", generation: 2 },
      ),
      true,
    )
  })
})
