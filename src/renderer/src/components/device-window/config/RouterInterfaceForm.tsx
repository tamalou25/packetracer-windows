/**
 * Configuration d'une interface de routeur ou du lien WAN du nuage (adressage statique).
 */
import { useEffect, useState } from 'react'
import { prefixToMask, type Device, type NetInterface, command } from '@engine/index'
import { runCommand } from '../../../lib/run'
import { useUiStore } from '../../../store/ui'
import { Button, Section, inputClass } from '../../common/ui'

export function RouterInterfaceForm({ device, iface }: { device: Device; iface: NetInterface }) {
  const [address, setAddress] = useState(iface.address ?? '')
  const [mask, setMask] = useState(iface.prefixLength !== null ? prefixToMask(iface.prefixLength) : '')
  useEffect(() => {
    setAddress(iface.address ?? '')
    setMask(iface.prefixLength !== null ? prefixToMask(iface.prefixLength) : '')
  }, [iface])

  const apply = (clear = false) => {
    const result = runCommand(
      command('net.setInterfaceIpv4', device.id, iface.id, {
        addressing: 'static',
        address: clear ? '' : address,
        mask: clear ? '' : mask
      })
    )
    if (!result) return
    const ui = useUiStore.getState()
    result.warnings.forEach((w) => ui.notify('warning', w))
    if (result.warnings.length === 0) ui.notify('success', `Interface ${iface.name} configurée.`)
  }

  return (
    <Section title={`Interface ${iface.name}`}>
      <div className="flex max-w-lg flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={iface.enabled}
            onChange={(e) =>
              runCommand(command('net.setInterfaceEnabled', device.id, iface.id, e.target.checked))
            }
          />
          Interface activée
        </label>
        <div className="grid grid-cols-[150px_1fr] items-center gap-2">
          <span className="text-xs text-fg-muted">Adresse IPv4</span>
          <input
            className={inputClass}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            data-testid="if-address"
          />
          <span className="text-xs text-fg-muted">Masque de sous-réseau</span>
          <input
            className={inputClass}
            value={mask}
            onChange={(e) => setMask(e.target.value)}
            data-testid="if-mask"
          />
          <span className="text-xs text-fg-muted">Adresse MAC</span>
          <span className="selectable font-mono text-xs">{iface.mac}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => apply()} data-testid="if-apply">
            Appliquer
          </Button>
          <Button onClick={() => apply(true)}>Effacer l’adresse</Button>
        </div>
      </div>
    </Section>
  )
}
