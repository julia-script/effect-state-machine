import * as Effect from "effect/Effect"
import * as MachineEngine from "../src/MachineEngine.js"

/** Runs one test instance through the same explicit volatile engine used by applications. */
export const runMachine = <Input, Value, Error, Requirements>(
  definition: Readonly<{
    run: (input: Input) => Effect.Effect<Value, Error, Requirements | MachineEngine.MachineEngine>
  }>,
  input: Input,
  config: MachineEngine.Config = {},
) => definition.run(input).pipe(Effect.provide(MachineEngine.layerMemory(config)))
