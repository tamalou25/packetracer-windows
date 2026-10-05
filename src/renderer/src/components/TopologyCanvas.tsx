/**
 * Canvas de topologie (React Flow).
 */
import { Background, BackgroundVariant, Controls, ReactFlow } from '@xyflow/react'

export function TopologyCanvas() {
  return (
    <div className="relative h-full w-full" data-testid="topology-canvas">
      <ReactFlow nodes={[]} edges={[]} proOptions={{ hideAttribution: true }} fitView>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
        <Controls showInteractive={false} position="top-left" />
      </ReactFlow>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <p className="rounded-lg bg-white/80 px-4 py-2 text-slate-500 shadow-sm">
          Glissez un équipement depuis la palette pour commencer.
        </p>
      </div>
    </div>
  )
}
