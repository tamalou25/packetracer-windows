/**
 * Liste des ports d'un équipement avec leur état et leur raccordement.
 */
import { effectiveIpv4, endStatus, linkOnInterface, prefixToMask, type Device } from '@engine/index'
import { useLabStore } from '../../store/lab'
import { StatusDot } from '../common/ui'

export function InterfaceList({ device, compact = false }: { device: Device; compact?: boolean }) {
  const lab = useLabStore((s) => s.lab)
  return (
    <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
      {device.interfaces.map((iface) => {
        const link = linkOnInterface(lab, device.id, iface.id)
        const side = link && link.a.deviceId === device.id && link.a.ifaceId === iface.id ? 'a' : 'b'
        const status = link ? endStatus(lab, link, side) : 'none'
        const peerEnd = link ? (side === 'a' ? link.b : link.a) : null
        const peer = peerEnd ? lab.devices[peerEnd.deviceId] : undefined
        const peerPort = peerEnd ? peer?.interfaces.find((i) => i.id === peerEnd.ifaceId)?.name : undefined
        const ip = effectiveIpv4(iface)
        if (compact && !link) return null
        return (
          <li key={iface.id} className="flex flex-col gap-0.5 px-2 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <StatusDot status={iface.enabled ? status : 'down'} />
              <span className="font-semibold text-slate-700">{iface.name}</span>
              <span className="ml-auto truncate text-slate-500">
                {peer ? `→ ${peer.name} (${peerPort})` : iface.enabled ? 'non raccordé' : 'désactivé'}
              </span>
            </div>
            {iface.l3 && (
              <div className="selectable pl-4.5 font-mono text-[11px] text-slate-500">
                {ip
                  ? `${ip.address} / ${prefixToMask(ip.prefixLength)}${ip.source === 'apipa' ? ' (APIPA)' : ''}`
                  : 'pas d’adresse IPv4'}
              </div>
            )}
            {!compact && (
              <div className="selectable pl-4.5 font-mono text-[11px] text-slate-400">{iface.mac}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
