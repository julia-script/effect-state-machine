import { Attach, MemoryTransport, Transport } from "@effect-state-machine/studio-client"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as SourceLocation from "effect-state-machine/SourceLocation"
import * as React from "react"
import { StudioViewer, type StudioViewerProps } from "./StudioViewer.js"
import * as ViewerClient from "./state/ViewerClient.js"

interface Tagged {
  readonly _tag: string
}

const handleKeys = new WeakMap<object, number>()
let nextHandleKey = 0

const keyForHandle = (handle: object): number => {
  const existing = handleKeys.get(handle)
  if (existing !== undefined) return existing
  const key = nextHandleKey
  nextHandleKey += 1
  handleKeys.set(handle, key)
  return key
}

export type StudioMachine<State extends Tagged, Event extends Tagged> = Attach.AttachOptions<
  State,
  Event
>

export interface StudioProps<State extends Tagged, Event extends Tagged>
  extends Omit<
    StudioViewerProps,
    "viewerLayer" | "registryKey" | "connectionKind" | "singleSession" | "canOpenSource"
  > {
  readonly machine: StudioMachine<State, Event>
  readonly onOpenSource?: (location: SourceLocation.Location) => void | Promise<void>
}

const sourceOpener = (
  onOpenSource: ((location: SourceLocation.Location) => void | Promise<void>) | undefined,
): ViewerClient.Options["openSource"] =>
  onOpenSource === undefined
    ? undefined
    : (location) =>
        Effect.tryPromise({
          try: () => Promise.resolve(onOpenSource(location)),
          catch: (cause) => new ViewerClient.EditorOpenFailed({ message: String(cause) }),
        })

const embeddedLayer = <State extends Tagged, Event extends Tagged>(
  machine: StudioMachine<State, Event>,
  onOpenSource: StudioProps<State, Event>["onOpenSource"],
): Layer.Layer<ViewerClient.ViewerClient> =>
  Layer.effect(
    ViewerClient.ViewerClient,
    Effect.gen(function* () {
      const pair = yield* MemoryTransport.makeDuplex
      yield* Attach.attach(machine).pipe(
        Effect.provideService(Transport.StudioTransport, pair.application),
      )
      return yield* ViewerClient.make({
        transport: pair.viewer,
        reconnectInterval: "10 millis",
        ...(onOpenSource === undefined ? {} : { openSource: sourceOpener(onOpenSource) }),
      })
    }),
  )

export function Studio<State extends Tagged, Event extends Tagged>({
  machine,
  onOpenSource,
  ...viewerProps
}: StudioProps<State, Event>) {
  const layer = React.useMemo(() => embeddedLayer(machine, onOpenSource), [machine, onOpenSource])
  const registryKey = keyForHandle(machine.handle)
  return (
    <StudioViewer
      {...viewerProps}
      viewerLayer={layer}
      registryKey={`${machine.definition.id}:${registryKey}`}
      connectionKind="direct"
      singleSession
      canOpenSource={onOpenSource !== undefined}
    />
  )
}
