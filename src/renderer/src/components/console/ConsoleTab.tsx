/**
 * Onglet Console : Invite de commandes ou PowerShell.
 */
import { useState } from 'react'
import type { HostDevice, ShellKind } from '@engine/index'
import { Terminal } from './Terminal'

export function ConsoleTab({ device }: { device: HostDevice }) {
  const [kind, setKind] = useState<ShellKind>(device.kind === 'server' ? 'powershell' : 'cmd')
  if (!device.host.session)
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-fg-muted">
        Aucune session ouverte : connectez-vous depuis l’onglet Bureau.
      </div>
    )
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-line bg-surface-2 px-2 py-1">
        {(['cmd', 'powershell'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            data-testid={`console-${k}`}
            className={`rounded px-3 py-1 text-xs font-medium ${kind === k ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface-3'}`}
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
