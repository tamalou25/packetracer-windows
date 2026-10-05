/**
 * Connexions réseau (ncpa.cpl) et boîtes de dialogue associées : État, Détails, Propriétés de la carte,
 * Propriétés du protocole Internet version 4 (TCP/IPv4) avec champs d'adresse en quatre octets.
 * Toute modification passe par les mêmes actions du moteur que l'onglet Config et PowerShell.
 */
import { useState, type MouseEvent } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, EthernetPort, Search } from 'lucide-react'
import {
  effectiveIpv4,
  formatLongDate,
  isIpv4,
  ping,
  prefixToMask,
  setInterfaceEnabled,
  setInterfaceIpv4,
  type HostDevice,
  type LabState,
  type NetInterface
} from '@engine/index'
import { launch } from '../../../lib/desktop'
import { adapterStatus, type AdapterStatus } from '../../../lib/netstatus'
import { runAction } from '../../../lib/run'
import { useDesktopStore } from '../../../store/desktop'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import {
  DialogBody,
  DialogFooter,
  GroupBox,
  IpBox,
  MessageBox,
  TabStrip,
  WinButton,
  type MessageIcon
} from '../shell/classic'
import { NetworkGlyph } from '../shell/Taskbar'

const ADAPTER_MODEL = 'Carte réseau Gigabit (simulée)'

function ifaceOf(device: HostDevice, ifaceId?: string): NetInterface | undefined {
  return device.interfaces.find((i) => i.id === ifaceId)
}

/** Diagnostic simple de la connexion (comme l'utilitaire de résolution des problèmes). */
export function diagnose(
  lab: LabState,
  device: HostDevice,
  iface: NetInterface
): { icon: MessageIcon; text: string } {
  const status = adapterStatus(lab, device, iface)
  if (status.state === 'disabled')
    return {
      icon: 'warning',
      text: `La carte « ${iface.name} » est désactivée. Activez-la pour vous connecter.`
    }
  if (status.state === 'unplugged')
    return {
      icon: 'error',
      text: 'Le câble réseau n’est pas correctement branché ou est peut-être endommagé.'
    }
  const eff = effectiveIpv4(iface)
  if (!eff || eff.source === 'apipa')
    return {
      icon: 'error',
      text: `« ${iface.name} » n’a pas de configuration IP valide. ${iface.addressing === 'dhcp' ? 'Aucun serveur DHCP n’a répondu.' : ''}`.trim()
    }
  const reach = (ip: string) => {
    const r = ping(lab, device.id, ip, { count: 1 })
    return r.ok && r.value.success
  }
  if (eff.gateway && !reach(eff.gateway))
    return { icon: 'error', text: 'La passerelle par défaut n’est pas disponible.' }
  const dns = eff.dnsServers.filter((d) => !d.startsWith('127.'))
  if (dns.length > 0 && !dns.some(reach))
    return {
      icon: 'error',
      text: 'L’ordinateur semble correctement configuré, mais le serveur DNS ne répond pas.'
    }
  return {
    icon: 'info',
    text:
      status.state === 'internet'
        ? 'L’utilitaire de résolution des problèmes n’a pas pu identifier le problème.'
        : 'Connexion locale opérationnelle. Aucun accès à Internet : vérifiez la passerelle et la route vers Internet.'
  }
}

function showDiagnosis(device: HostDevice, iface: NetInterface) {
  const result = diagnose(useLabStore.getState().lab, device, iface)
  useDesktopStore.getState().showNotice(device.id, {
    title: 'Diagnostics réseau',
    message: result.text,
    kind: result.icon === 'question' ? 'info' : result.icon
  })
}

export function NetworkConnections({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const win = useAppWindow()
  const adapters = device.interfaces.filter((i) => i.l3).map((i) => adapterStatus(lab, device, i))
  const [selected, setSelected] = useState<string | null>(adapters[0]?.iface.id ?? null)
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null)
  const current = adapters.find((a) => a.iface.id === selected)

  const openStatus = (a: AdapterStatus) => {
    if (a.state === 'disabled') runAction((l) => setInterfaceEnabled(l, device.id, a.iface.id, true))
    else launch(device.id, 'netstatus', { arg: a.iface.id, parent: win?.win.id })
  }
  const openProperties = (a: AdapterStatus) =>
    launch(device.id, 'netprops', { arg: a.iface.id, parent: win?.win.id })
  const toggle = (a: AdapterStatus) =>
    runAction((l) => setInterfaceEnabled(l, device.id, a.iface.id, a.state === 'disabled'))

  const command = (label: string, onClick: () => void, testId: string) => (
    <button type="button" onClick={onClick} className="px-2 py-1 hover:bg-[#e5f3ff]" data-testid={testId}>
      {label}
    </button>
  )

  return (
    <div
      className="relative flex h-full flex-col bg-white text-xs text-black"
      onClick={() => setContext(null)}
    >
      <div className="flex items-center gap-1 border-b border-[#e5e5e5] px-2 py-1.5 text-[#6d6d6d]">
        <ArrowLeft size={14} />
        <ArrowRight size={14} />
        <ArrowUp size={14} />
        <div className="ml-2 flex flex-1 items-center gap-1 border border-[#d9d9d9] px-2 py-0.5 text-black">
          <EthernetPort size={13} className="text-emerald-600" /> Panneau de configuration{' '}
          <ChevronRight size={12} /> Réseau et Internet <ChevronRight size={12} /> Connexions réseau
        </div>
        <div className="flex w-44 items-center gap-1 border border-[#d9d9d9] px-2 py-0.5 text-[#999]">
          <Search size={12} /> Rechercher dans : Connexions réseau
        </div>
      </div>
      <div className="flex h-8 items-center gap-1 border-b border-[#f0f0f0] bg-[#f5f6f7] px-2">
        <span className="px-2 py-1 text-[#333]">Organiser ▾</span>
        {current && (
          <>
            {command(
              current.state === 'disabled'
                ? 'Activer ce périphérique réseau'
                : 'Désactiver ce périphérique réseau',
              () => toggle(current),
              'ncpa-toggle'
            )}
            {current.state !== 'disabled' &&
              command(
                'Diagnostiquer cette connexion',
                () => showDiagnosis(device, current.iface),
                'ncpa-diagnose'
              )}
            {current.state !== 'disabled' &&
              command('Afficher le statut de cette connexion', () => openStatus(current), 'ncpa-status')}
            {command(
              'Modifier les paramètres de cette connexion',
              () => openProperties(current),
              'ncpa-properties'
            )}
          </>
        )}
      </div>
      <div className="flex flex-1 flex-wrap content-start gap-2 p-3">
        {adapters.map((a) => (
          <button
            key={a.iface.id}
            type="button"
            onClick={() => setSelected(a.iface.id)}
            onDoubleClick={() => openStatus(a)}
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              setSelected(a.iface.id)
              const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
              setContext({ id: a.iface.id, x: e.clientX - box.left, y: e.clientY - box.top + 64 })
            }}
            className={`flex w-[270px] items-center gap-3 border p-2 text-left ${
              selected === a.iface.id
                ? 'border-[#99d1ff] bg-[#cce8ff]'
                : 'border-transparent hover:bg-[#e5f3ff]'
            }`}
            data-testid={`ncpa-adapter-${a.iface.name}`}
          >
            <span className={`text-[#1e6fbf] ${a.state === 'disabled' ? 'opacity-40 grayscale' : ''}`}>
              <NetworkGlyph state={a.state} size={36} />
            </span>
            <span className="min-w-0 leading-snug">
              <span className="block truncate font-semibold">{a.iface.name}</span>
              <span className="block truncate text-[#555]">{a.label}</span>
              <span className="block truncate text-[#555]">{ADAPTER_MODEL}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-[#f0f0f0] px-2 py-0.5 text-[11px] text-[#6d6d6d]">
        {adapters.length} élément{adapters.length > 1 ? 's' : ''}
      </div>
      {context &&
        (() => {
          const a = adapters.find((x) => x.iface.id === context.id)
          if (!a) return null
          const item = (label: string, onClick: () => void, disabled = false) => (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setContext(null)
                onClick()
              }}
              className="block w-full px-6 py-1 text-left hover:bg-[#91c9f7] disabled:text-[#999] disabled:hover:bg-transparent"
            >
              {label}
            </button>
          )
          return (
            <div
              className="absolute z-30 w-52 border border-[#ccc] bg-[#f2f2f2] py-1 shadow-lg"
              style={{ left: context.x, top: context.y }}
              data-testid="ncpa-context"
            >
              {item(a.state === 'disabled' ? 'Activer' : 'Désactiver', () => toggle(a))}
              {item('Statut', () => openStatus(a), a.state === 'disabled')}
              {item('Diagnostiquer', () => showDiagnosis(device, a.iface), a.state === 'disabled')}
              <div className="my-1 border-t border-[#ccc]" />
              {item('Propriétés', () => openProperties(a))}
            </div>
          )
        })()}
    </div>
  )
}

/** Durée de connexion : temps simulé écoulé depuis le démarrage. */
function uptime(lab: LabState, device: HostDevice): string {
  const sec = Math.max(0, Math.floor((lab.clock - device.host.bootedAt) / 1000))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`
}

export function AdapterStatusDialog({ device, ifaceId }: { device: HostDevice; ifaceId?: string }) {
  const lab = useLabStore((s) => s.lab)
  const win = useAppWindow()
  const iface = ifaceOf(device, ifaceId)
  if (!iface) return null
  const status = adapterStatus(lab, device, iface)
  const connected = status.state !== 'unplugged' && status.state !== 'disabled'
  const row = (k: string, v: string) => (
    <div className="flex justify-between py-0.5">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  )
  return (
    <div className="flex h-full flex-col" data-testid="netstatus">
      <TabStrip tabs={[{ id: 'general', label: 'Général' }]} active="general" onChange={() => undefined} />
      <DialogBody className="flex flex-col gap-3 bg-white">
        <GroupBox label="Connexion">
          {row('Connectivité IPv4 :', status.connectivity)}
          {row('Connectivité IPv6 :', 'Pas d’accès réseau')}
          {row('État du média :', connected ? 'Activé' : 'Média déconnecté')}
          {row('Durée :', connected ? uptime(lab, device) : '—')}
          {row('Vitesse :', connected ? '1,0 Gbit/s' : '—')}
          <WinButton
            className="mt-2"
            disabled={!connected}
            onClick={() => launch(device.id, 'netdetails', { arg: iface.id, parent: win?.win.id })}
            data-testid="netstatus-details"
          >
            Détails…
          </WinButton>
        </GroupBox>
        <GroupBox label="Activité">
          <div className="flex justify-between py-0.5 text-[#555]">
            <span>Envoyés —</span>
            <span>— Reçus</span>
          </div>
        </GroupBox>
        <div className="flex gap-2">
          <WinButton onClick={() => launch(device.id, 'netprops', { arg: iface.id, parent: win?.win.id })}>
            Propriétés
          </WinButton>
          <WinButton onClick={() => runAction((l) => setInterfaceEnabled(l, device.id, iface.id, false))}>
            Désactiver
          </WinButton>
          <WinButton onClick={() => showDiagnosis(device, iface)}>Diagnostiquer</WinButton>
        </div>
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={() => win?.close()}>
          Fermer
        </WinButton>
      </DialogFooter>
    </div>
  )
}

export function NetDetailsDialog({ device, ifaceId }: { device: HostDevice; ifaceId?: string }) {
  const win = useAppWindow()
  const iface = ifaceOf(device, ifaceId)
  if (!iface) return null
  const eff = effectiveIpv4(iface)
  const lease = iface.addressing === 'dhcp' ? iface.dhcpLease : null
  const rows: [string, string][] = [
    ['Suffixe DNS propre à la connexion', lease?.dnsSuffix ?? ''],
    ['Description', ADAPTER_MODEL],
    ['Adresse physique', iface.mac],
    ['DHCP activé', iface.addressing === 'dhcp' ? 'Oui' : 'Non'],
    ['Adresse IPv4', eff ? `${eff.address}${eff.source === 'apipa' ? ' (autoconfiguration)' : ''}` : ''],
    ['Masque de sous-réseau IPv4', eff ? prefixToMask(eff.prefixLength) : ''],
    ...(lease
      ? ([
          ['Bail obtenu', formatLongDate(lease.obtainedAt)],
          ['Bail expirant', formatLongDate(lease.expiresAt)]
        ] as [string, string][])
      : []),
    ['Passerelle par défaut IPv4', eff?.gateway ?? ''],
    ...(lease ? ([['Serveur DHCP IPv4', lease.serverId]] as [string, string][]) : []),
    ['Serveurs DNS IPv4', eff ? eff.dnsServers.join(', ') : ''],
    ['Serveur WINS IPv4', ''],
    ['NetBIOS sur TCP/IP activé', 'Oui']
  ]
  return (
    <div className="flex h-full flex-col" data-testid="netdetails">
      <DialogBody>
        <p className="mb-2">Détails de connexion réseau :</p>
        <table className="selectable w-full border border-[#a0a0a0] bg-white">
          <thead className="text-left">
            <tr className="border-b border-[#e5e5e5]">
              <th className="px-1.5 py-0.5 font-normal">Propriété</th>
              <th className="px-1.5 py-0.5 font-normal">Valeur</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="px-1.5 py-0.5 whitespace-nowrap">{k}</td>
                <td className="px-1.5 py-0.5">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={() => win?.close()}>
          Fermer
        </WinButton>
      </DialogFooter>
    </div>
  )
}

const COMPONENTS = [
  {
    id: 'client',
    label: 'Client pour les réseaux',
    description: 'Permet à cet ordinateur d’accéder aux ressources d’un réseau.'
  },
  {
    id: 'sharing',
    label: 'Partage de fichiers et imprimantes pour les réseaux',
    description: 'Permet aux autres ordinateurs d’accéder aux ressources de cet ordinateur sur un réseau.'
  },
  { id: 'qos', label: 'Planificateur de paquets QoS', description: 'Fournit le contrôle du trafic réseau.' },
  {
    id: 'ipv4',
    label: 'Protocole Internet version 4 (TCP/IPv4)',
    description:
      'Protocole TCP/IP (Transmission Control Protocol/Internet Protocol). Le protocole de réseau étendu par défaut qui permet la communication entre différents réseaux interconnectés.'
  },
  {
    id: 'ipv6',
    label: 'Protocole Internet version 6 (TCP/IPv6)',
    description:
      'La dernière version du protocole Internet (non simulée : seul IPv4 est utilisé dans ServerLab).'
  },
  {
    id: 'lltd',
    label: 'Répondeur de découverte de topologie de la couche de liaison',
    description: 'Permet à cet ordinateur d’être découvert et de figurer sur la carte du réseau.'
  }
]

export function AdapterPropertiesDialog({ device, ifaceId }: { device: HostDevice; ifaceId?: string }) {
  const win = useAppWindow()
  const [selected, setSelected] = useState('ipv4')
  const iface = ifaceOf(device, ifaceId)
  if (!iface) return null
  const openIpv4 = () => launch(device.id, 'ipv4', { arg: iface.id, parent: win?.win.id })
  const current = COMPONENTS.find((c) => c.id === selected)
  return (
    <div className="flex h-full flex-col" data-testid="netprops">
      <TabStrip
        tabs={[{ id: 'network', label: 'Gestion de réseau' }]}
        active="network"
        onChange={() => undefined}
      />
      <DialogBody className="flex flex-col gap-2 bg-white">
        <span>Connexion en utilisant :</span>
        <div className="flex items-center gap-2 border border-[#a0a0a0] px-2 py-1">
          <EthernetPort size={14} className="text-emerald-600" /> {ADAPTER_MODEL}
        </div>
        <div className="flex justify-end">
          <WinButton disabled>Configurer…</WinButton>
        </div>
        <span>Cette connexion utilise les éléments suivants :</span>
        <ul className="h-28 overflow-y-auto border border-[#a0a0a0]">
          {COMPONENTS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelected(c.id)}
                onDoubleClick={() => c.id === 'ipv4' && openIpv4()}
                className={`flex w-full items-center gap-2 px-1.5 py-0.5 text-left ${selected === c.id ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
                data-testid={`netprops-${c.id}`}
              >
                <input type="checkbox" checked readOnly className="pointer-events-none" tabIndex={-1} />
                {c.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <WinButton disabled>Installer…</WinButton>
          <WinButton disabled>Désinstaller</WinButton>
          <WinButton disabled={selected !== 'ipv4'} onClick={openIpv4} data-testid="netprops-properties">
            Propriétés
          </WinButton>
        </div>
        <GroupBox label="Description">
          <p className="min-h-10">{current?.description}</p>
        </GroupBox>
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={() => win?.close()} data-testid="netprops-ok">
          OK
        </WinButton>
        <WinButton onClick={() => win?.close()}>Annuler</WinButton>
      </DialogFooter>
    </div>
  )
}

/** Masque par défaut selon la classe de l'adresse (rempli quand on entre dans le champ masque). */
function classfulMask(address: string): string {
  const first = Number(address.split('.')[0])
  if (!isIpv4(address) || first < 1 || first > 223) return ''
  return first < 128 ? '255.0.0.0' : first < 192 ? '255.255.0.0' : '255.255.255.0'
}

interface PendingBox {
  icon: MessageIcon
  message: string
  confirm?: () => void
}

export function Ipv4PropertiesDialog({ device, ifaceId }: { device: HostDevice; ifaceId?: string }) {
  const win = useAppWindow()
  const iface = ifaceOf(device, ifaceId)
  const [tab, setTab] = useState<'general' | 'alternate'>('general')
  const [dhcp, setDhcp] = useState(iface?.addressing === 'dhcp')
  const [address, setAddress] = useState(iface?.address ?? '')
  const [mask, setMask] = useState(iface?.prefixLength != null ? prefixToMask(iface.prefixLength) : '')
  const [gateway, setGateway] = useState(iface?.gateway ?? '')
  const [dnsAuto, setDnsAuto] = useState(iface?.dnsMode === 'dhcp')
  const [dns1, setDns1] = useState(iface?.dnsServers[0] ?? '')
  const [dns2, setDns2] = useState(iface?.dnsServers[1] ?? '')
  const [validate, setValidate] = useState(false)
  const [box, setBox] = useState<PendingBox | null>(null)
  if (!iface) return null
  const dnsStatic = !dhcp || !dnsAuto

  const input = () => ({
    addressing: dhcp ? ('dhcp' as const) : ('static' as const),
    address,
    mask,
    gateway,
    dnsMode: dnsStatic ? ('static' as const) : ('dhcp' as const),
    dnsServers: [dns1, dns2]
  })

  const commit = () => {
    const result = runAction((lab) => setInterfaceIpv4(lab, device.id, iface.id, input()))
    if (result === undefined) return
    win?.close()
    // Conflit d'adresse : signalé après application, comme le système
    const conflict = result.warnings.find((w) => w.startsWith('Conflit'))
    if (conflict)
      useDesktopStore
        .getState()
        .showNotice(device.id, { title: 'Conflit d’adresse IP', message: conflict, kind: 'warning' })
    else if (validate) {
      const fresh = useLabStore.getState().lab.devices[device.id]
      const freshIface = fresh?.interfaces.find((i) => i.id === iface.id)
      if (fresh && freshIface && (fresh.kind === 'server' || fresh.kind === 'client'))
        showDiagnosis(fresh, freshIface)
    }
  }

  const ok = () => {
    // Essai à blanc : le moteur valide sans rien modifier
    const trial = setInterfaceIpv4(useLabStore.getState().lab, device.id, iface.id, input())
    if (!trial.ok) {
      setBox({ icon: 'error', message: trial.error.message })
      return
    }
    const gatewayWarning = trial.value.warnings.find((w) => w.startsWith('La passerelle'))
    if (gatewayWarning) {
      setBox({
        icon: 'warning',
        message: `${gatewayWarning}\n\nVoulez-vous enregistrer cette configuration ?`,
        confirm: commit
      })
      return
    }
    commit()
  }

  const radio = (checked: boolean, onChange: () => void, label: string, testId: string, disabled = false) => (
    <label className={`flex items-center gap-2 ${disabled ? 'text-[#a0a0a0]' : ''}`}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} data-testid={testId} />
      {label}
    </label>
  )
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    testId: string,
    disabled: boolean,
    onFocus?: () => void
  ) => (
    <div className="flex items-center justify-between py-0.5 pl-5">
      <span className={disabled ? 'text-[#a0a0a0]' : ''}>{label}</span>
      <IpBox
        value={value}
        onChange={set}
        disabled={disabled}
        testId={testId}
        onFocus={onFocus}
        label={label}
      />
    </div>
  )

  return (
    <div className="relative flex h-full flex-col" data-testid="ipv4-dialog">
      <TabStrip
        tabs={
          dhcp
            ? [
                { id: 'general', label: 'Général' },
                { id: 'alternate', label: 'Configuration alternative' }
              ]
            : [{ id: 'general', label: 'Général' }]
        }
        active={dhcp ? tab : 'general'}
        onChange={setTab}
      />
      <DialogBody className="flex flex-col gap-2 bg-white">
        {tab === 'general' || !dhcp ? (
          <>
            <p>
              Les paramètres IP peuvent être déterminés automatiquement si votre réseau le permet. Sinon, vous
              devez demander les paramètres IP appropriés à votre administrateur réseau.
            </p>
            {radio(dhcp, () => setDhcp(true), 'Obtenir une adresse IP automatiquement', 'ipv4-dhcp')}
            <GroupBox
              label={radio(!dhcp, () => setDhcp(false), 'Utiliser l’adresse IP suivante :', 'ipv4-static')}
            >
              {field('Adresse IP :', address, setAddress, 'ipv4-address', dhcp)}
              {field('Masque de sous-réseau :', mask, setMask, 'ipv4-mask', dhcp, () => {
                if (!mask) setMask(classfulMask(address))
              })}
              {field('Passerelle par défaut :', gateway, setGateway, 'ipv4-gateway', dhcp)}
            </GroupBox>
            {radio(
              !dnsStatic,
              () => setDnsAuto(true),
              'Obtenir les adresses des serveurs DNS automatiquement',
              'ipv4-dns-auto',
              !dhcp
            )}
            <GroupBox
              label={radio(
                dnsStatic,
                () => setDnsAuto(false),
                'Utiliser l’adresse de serveur DNS suivante :',
                'ipv4-dns-static'
              )}
            >
              {field('Serveur DNS préféré :', dns1, setDns1, 'ipv4-dns1', !dnsStatic)}
              {field('Serveur DNS auxiliaire :', dns2, setDns2, 'ipv4-dns2', !dnsStatic)}
            </GroupBox>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} />
                Valider les paramètres en quittant
              </label>
              <WinButton disabled>Avancé…</WinButton>
            </div>
          </>
        ) : (
          <>
            <p>
              Si cet ordinateur est utilisé sur plusieurs réseaux, entrez les paramètres IP alternatifs
              ci-dessous.
            </p>
            {radio(true, () => undefined, 'Adresse IP privée automatique', 'ipv4-apipa')}
            {radio(false, () => undefined, 'Configuré par l’utilisateur', 'ipv4-alternate-user', true)}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={ok} data-testid="ipv4-ok">
          OK
        </WinButton>
        <WinButton onClick={() => win?.close()}>Annuler</WinButton>
      </DialogFooter>
      {box && (
        <MessageBox
          title="TCP/IP"
          icon={box.icon}
          message={box.message}
          testId="ipv4-msgbox"
          buttons={
            box.confirm
              ? [
                  {
                    label: 'Oui',
                    primary: true,
                    testId: 'ipv4-msgbox-yes',
                    onClick: () => {
                      const confirm = box.confirm
                      setBox(null)
                      confirm?.()
                    }
                  },
                  { label: 'Non', testId: 'ipv4-msgbox-no', onClick: () => setBox(null) }
                ]
              : [{ label: 'OK', primary: true, testId: 'ipv4-msgbox-ok', onClick: () => setBox(null) }]
          }
        />
      )}
    </div>
  )
}
