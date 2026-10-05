/**
 * Onglet Console : Invite de commandes ou PowerShell.
 */
import { useState } from 'react'
import type { HostDevice, ShellKind } from '@engine/index'
import { Terminal } from './Terminal'

export function ConsoleTab({ device }: { device: HostDevice }) {
  const [kind, setKind] = useState<ShellKind>(device.kind === 'server' ? 'powershell' : 'cmd')
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
        {(['cmd', 'powershell'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            data-testid={`console-${k}`}
            className={`rounded px-3 py-1 text-xs font-medium ${kind === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-200'}`}
          >
            {k === 'cmd' ? 'Invite de commandes' : 'PowerShell'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Terminal key={k(device.id, kind)} deviceId={device.id} kind={kind} autoFocus />
      </div>
    </div>
  )
}

function k(deviceId: string, kind: ShellKind): string {
  return `${deviceId}-${kind}`
}
