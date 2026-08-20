import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"

/** Package-private erased execution seam shared by definitions and the public engine module. */
export interface Service {
  readonly run: (definition: unknown, input: unknown) => Effect.Effect<unknown, unknown, unknown>
}

/** Package-private service key; the focused MachineEngine module owns the public re-export. */
export class MachineEngine extends Context.Service<MachineEngine, Service>()(
  "effect-state-machine/MachineEngine",
) {}
