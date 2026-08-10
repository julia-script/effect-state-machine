import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"

/**
 * Opens a source location in the developer's editor by executing the
 * configured editor command with a `file:line:column` argument. Failure is
 * reported so the viewer can fall back to copying the reference.
 */

export class EditorOpenError extends Data.TaggedError("EditorOpenError")<{
  readonly message: string
}> {}

export interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
}

export class EditorOpener extends Context.Service<
  EditorOpener,
  Readonly<{
    open: (location: Location) => Effect.Effect<void, EditorOpenError>
  }>
>()("@effect-state-machine/studio/EditorOpener") {}

export const layer = (command = "cursor"): Layer.Layer<EditorOpener, never, ChildProcessSpawner> =>
  Layer.effect(
    EditorOpener,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      return EditorOpener.of({
        open: (location) =>
          spawner
            .exitCode(
              ChildProcess.make(command, [`${location.file}:${location.line}:${location.column}`]),
            )
            .pipe(
              Effect.mapError(
                (cause) => new EditorOpenError({ message: `${command} failed: ${cause.message}` }),
              ),
              Effect.flatMap((code) =>
                code === 0
                  ? Effect.void
                  : Effect.fail(
                      new EditorOpenError({ message: `${command} exited with code ${code}` }),
                    ),
              ),
            ),
      })
    }),
  )
