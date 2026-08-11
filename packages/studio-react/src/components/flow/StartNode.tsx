import { Handle, Position } from "@xyflow/react"
import { START_SIZE } from "../../lib/elkLayout.js"

/** The initial-state marker: a start dot that takes part in the layout. */
export function StartNode() {
  return (
    <div
      className="flex items-center justify-center rounded-full border-2 border-ink bg-surface"
      style={{ width: START_SIZE, height: START_SIZE }}
      title="Initial state"
    >
      <span className="block h-2 w-2 rounded-full bg-ink" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
