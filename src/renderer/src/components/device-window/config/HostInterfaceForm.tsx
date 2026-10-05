/**
 * Propriétés IPv4 d'une carte réseau (serveur ou poste), à la manière de l'assistant système.
 */
import { useEffect, useState } from 'react'
import {
  dhcpRelease,
  dhcpRenew,
  effectiveIpv4,
  prefixToMask,
  setInterfaceEnabled,
  setInterfaceIpv4,
  type Device,
  type NetInterface
} from '@engine/index'
import { runAction } from '../../../lib/run'
import { runNetworkOperation } from '../../../lib/network'
import { useLabStore } from '../../../store/lab'
import { useUiStore } from '../../../store/ui'
import { Button, Section, inputClass } from '../../common/ui'

interface FormState {
  addressing: 'static' | 'dhcp'
  address: string
  mask: string
  gateway: string
  dnsMode: 'static' | 'dhcp'
  dns1: string
  dns2: string
}

/** Masque par défaut selon la classe de l'adresse (A, B ou C). */
function classfulMask(address: string): string {
  const first = Number(address.trim().split('.')[0])
  if (!address.trim() || Number.isNaN(first) || first < 1 || first > 223) return ''
  return first < 128 ? '255.0.0.0' : first < 192 ? '255.255.0.0' : '255.255.255.0'
}

function fromIface(iface: NetInterface): FormState {
  return {
    addressing: iface.addressing,
    address: iface.address ?? '',
    mask: iface.prefixLength !== null ? prefixToMask(iface.prefixLength) : '',
    gateway: iface.gateway ?? '',
    dnsMode: iface.dnsMode,
    dns1: iface.dnsServers[0] ?? '',
    dns2: iface.dnsServers[1] ?? ''
  }
}

export function HostInterfaceForm({ device, iface }: { device: Device; iface: NetInterface }) {
  const [form, setForm] = useState<FormState>(() => fromIface(iface))
  useEffect(() => setForm(fromIface(iface)), [iface])
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))
  const eff = effectiveIpv4(iface)
  const staticIp = form.addressing === 'static'
  const dnsStatic = staticIp || form.dnsMode === 'static'
  const suggestedMask = classfulMask(form.address)

  /** Opération DHCP (renouveler/libérer) : rejouée en mode Simulation. */
  const dhcpOperation = (kind: 'renew' | 'release') => {
    const lab = useLabStore.getState().lab
    const op = kind === 'renew' ? dhcpRenew(lab, device.id, iface.id) : dhcpRelease(lab, device.id, iface.id)
    runNetworkOperation(op.trace, () => {
      useLabStore.getState().run(() => ({ ok: true, state: op.state, value: undefined }))
      const ui = useUiStore.getState()
      if (op.outcome === 'failed') ui.notify('error', `${iface.name} : ${op.message}`)
      else if (op.outcome === 'released') ui.notify('info', `Bail de ${iface.name} libéré.`)
      else if (op.address) ui.notify('success', `${iface.name} : bail obtenu (${op.address}).`)
    })
  }

  const apply = () => {
    const result = runAction((lab) =>
      setInterfaceIpv4(lab, device.id, iface.id, {
        addressing: form.addressing,
        address: form.address,
        // Masque laissé vide : on applique celui proposé selon la classe, comme l'assistant système
        mask: form.mask.trim() || suggestedMask,
        gateway: form.gateway,
        dnsMode: dnsStatic ? 'static' : 'dhcp',
        dnsServers: [form.dns1, form.dns2]
      })
    )
    if (!result) return
    const ui = useUiStore.getState()
    if (result.warnings.length > 0) result.warnings.forEach((w) => ui.notify('warning', w))
    else ui.notify('success', `Configuration de ${iface.name} appliquée.`)
  }

  return (
    <>
      <Section title={`${iface.name} — Propriétés de TCP/IPv4`}>
        <div className="flex max-w-lg flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={iface.enabled}
              onChange={(e) =>
                runAction((lab) => setInterfaceEnabled(lab, device.id, iface.id, e.target.checked))
              }
            />
            Carte activée
          </label>
          <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={!staticIp}
                onChange={() => set('addressing', 'dhcp')}
                data-testid="ip-dhcp"
              />
              Obtenir une adresse IP automatiquement (DHCP)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={staticIp}
                onChange={() => set('addressing', 'static')}
                data-testid="ip-static"
              />
              Utiliser l’adresse IP suivante :
            </label>
            <div className="grid grid-cols-[150px_1fr] items-center gap-2 pl-6">
              <span className="text-xs text-fg-muted">Adresse IP</span>
              <input
                className={inputClass}
                disabled={!staticIp}
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="192.168.1.10"
                data-testid="ip-address"
              />
              <span className="text-xs text-fg-muted">Masque de sous-réseau</span>
              <input
                className={inputClass}
                disabled={!staticIp}
                value={form.mask}
                onChange={(e) => set('mask', e.target.value)}
                placeholder={suggestedMask || '255.255.255.0'}
                data-testid="ip-mask"
              />
              <span className="text-xs text-fg-muted">Passerelle par défaut</span>
              <input
                className={inputClass}
                disabled={!staticIp}
                value={form.gateway}
                onChange={(e) => set('gateway', e.target.value)}
                data-testid="ip-gateway"
              />
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                disabled={staticIp}
                checked={!dnsStatic}
                onChange={() => set('dnsMode', 'dhcp')}
              />
              Obtenir les adresses des serveurs DNS automatiquement
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={dnsStatic} onChange={() => set('dnsMode', 'static')} />
              Utiliser l’adresse de serveur DNS suivante :
            </label>
            <div className="grid grid-cols-[150px_1fr] items-center gap-2 pl-6">
              <span className="text-xs text-fg-muted">Serveur DNS préféré</span>
              <input
                className={inputClass}
                disabled={!dnsStatic}
                value={form.dns1}
                onChange={(e) => set('dns1', e.target.value)}
                data-testid="ip-dns1"
              />
              <span className="text-xs text-fg-muted">Serveur DNS auxiliaire</span>
              <input
                className={inputClass}
                disabled={!dnsStatic}
                value={form.dns2}
                onChange={(e) => set('dns2', e.target.value)}
              />
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button variant="primary" onClick={apply} data-testid="ip-apply">
              Appliquer
            </Button>
            <Button onClick={() => setForm(fromIface(iface))}>Annuler les modifications</Button>
          </div>
        </div>
      </Section>
      <Section
        title="État de la connexion"
        actions={
          iface.addressing === 'dhcp' ? (
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => dhcpOperation('renew')} data-testid="dhcp-renew">
                Renouveler le bail
              </Button>
              <Button variant="ghost" onClick={() => dhcpOperation('release')}>
                Libérer
              </Button>
            </div>
          ) : null
        }
      >
        <dl className="selectable grid max-w-lg grid-cols-[180px_1fr] gap-y-1 text-xs">
          <dt className="text-fg-muted">Adresse physique</dt>
          <dd className="font-mono">{iface.mac}</dd>
          <dt className="text-fg-muted">Adresse IPv4</dt>
          <dd className="font-mono" data-testid="ip-effective">
            {eff
              ? `${eff.address}${eff.source === 'apipa' ? ' (APIPA — aucun serveur DHCP)' : eff.source === 'dhcp' ? ' (DHCP)' : ''}`
              : '—'}
          </dd>
          <dt className="text-fg-muted">Masque de sous-réseau</dt>
          <dd className="font-mono">{eff ? prefixToMask(eff.prefixLength) : '—'}</dd>
          <dt className="text-fg-muted">Passerelle par défaut</dt>
          <dd className="font-mono">{eff?.gateway ?? '—'}</dd>
          <dt className="text-fg-muted">Serveurs DNS</dt>
          <dd className="font-mono">{eff && eff.dnsServers.length > 0 ? eff.dnsServers.join(', ') : '—'}</dd>
        </dl>
      </Section>
    </>
  )
}
