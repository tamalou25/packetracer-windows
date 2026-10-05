/**
 * Application « Paramètres réseau » : propriétés TCP/IPv4 de chaque carte.
 */
import { useState } from 'react'
import type { HostDevice } from '@engine/index'
import { HostInterfaceForm } from '../device-window/config/HostInterfaceForm'

export function NetworkSettingsApp({ device }: { device: HostDevice }) {
  const [ifaceId, setIfaceId] = useState(device.interfaces[0]?.id ?? '')
  const iface = device.interfaces.find((i) => i.id === ifaceId) ?? device.interfaces[0]
  return (
    <div className="flex h-full">
      <nav className="w-40 shrink-0 border-r border-slate-200 bg-slate-50 p-2 text-xs">
        <div className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
          Connexions réseau
        </div>
        {device.interfaces.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setIfaceId(i.id)}
            className={`w-full rounded px-2 py-1.5 text-left ${i.id === iface?.id ? 'bg-sky-100 font-semibold text-sky-800' : 'hover:bg-slate-100'}`}
          >
            {i.name}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {iface && <HostInterfaceForm device={device} iface={iface} />}
      </div>
    </div>
  )
}
