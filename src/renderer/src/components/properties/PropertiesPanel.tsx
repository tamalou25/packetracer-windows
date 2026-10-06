/**
 * Panneau des propriétés (à droite) : détails de l'équipement ou du câble sélectionné,
 * en sections repliables ; vue d'ensemble du lab quand rien n'est sélectionné.
 */
import type { ReactNode } from 'react'
import {
  AppWindow,
  CircleAlert,
  Info,
  Monitor,
  MousePointerClick,
  Plus,
  Power,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  Unplug,
  type LucideIcon
} from 'lucide-react'
import {
  DEVICE_KIND_INFO,
  DEVICE_KINDS,
  endStatus,
  FEATURES,
  isHostDevice,
  linkStatus,
  type Device,
  type HostDevice,
  type LabState,
  type Link,
  type RouterDevice,
  command
} from '@engine/index'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { runCommand } from '../../lib/run'
import { DEVICE_ICONS, KIND_STRIPE } from '../../lib/devices'
import { formatSimTime } from '../../lib/format'
import { deviceHealth, type DeviceHealth } from '../../lib/health'
import { EditableName } from '../common/EditableName'
import { Button, StatusDot } from '../common/ui'
import { InterfaceList } from './InterfaceList'
import { PanelSection } from './PanelSection'

const HEALTH_DOT: Record<DeviceHealth, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  off: 'bg-danger',
  idle: 'bg-fg-subtle'
}

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection)
  const lab = useLabStore((s) => s.lab)
  const devices = selection.devices.map((id) => lab.devices[id]).filter((d): d is Device => !!d)
  const link = selection.link ? lab.links[selection.link] : undefined

  let content
  if (devices.length === 1 && devices[0]) content = <DeviceProperties device={devices[0]} />
  else if (devices.length > 1) content = <MultiProperties devices={devices} />
  else if (link) content = <LinkProperties link={link} />
  else content = <LabOverview lab={lab} />

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="properties-panel">
      {content}
    </div>
  )
}

/** Bouton d'action compact (icône + infobulle). */
function IconAction({
  icon: Icon,
  label,
  onClick,
  testId,
  tone = 'default'
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  testId?: string
  tone?: 'default' | 'primary' | 'danger'
}) {
  const tones = {
    default: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
    primary: 'bg-accent text-on-accent hover:bg-accent-hover',
    danger: 'text-danger hover:bg-danger-soft'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${tones[tone]}`}
    >
      <Icon size={15} />
    </button>
  )
}

/** Liste clé / valeur dense. */
function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[104px_1fr] gap-x-2 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="selectable min-w-0 truncate text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function DeviceProperties({ device }: { device: Device }) {
  const lab = useLabStore((s) => s.lab)
  const ui = useUiStore.getState
  const Icon = DEVICE_ICONS[device.kind]
  const health = deviceHealth(lab, device)
  const host = isHostDevice(device) ? device : null

  return (
    <>
      <div className="border-b border-line px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong bg-surface text-fg-muted">
            <span className={`absolute inset-y-0 left-0 w-[3px] ${KIND_STRIPE[device.kind]}`} />
            <Icon size={20} strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-fg">{device.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-fg-muted" title={health.label}>
              {DEVICE_KIND_INFO[device.kind].label}
              <span className="text-fg-subtle">·</span>
              <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[health.status]}`} />
              <span className="truncate" data-testid="properties-health">
                {health.label}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1" role="toolbar" aria-label="Actions">
          <IconAction
            icon={AppWindow}
            label="Ouvrir la fenêtre de l’équipement"
            onClick={() => ui().openWindow(device.id, 'config')}
            testId="open-device-window"
            tone="primary"
          />
          {host && (
            <>
              <IconAction
                icon={Monitor}
                label="Ouvrir le Bureau"
                onClick={() => ui().openWindow(device.id, 'desktop')}
                testId="open-desktop"
              />
              <IconAction
                icon={SquareTerminal}
                label="Ouvrir la console"
                onClick={() => ui().openWindow(device.id, 'console')}
                testId="open-console"
              />
            </>
          )}
          <IconAction
            icon={Power}
            label={device.powered ? 'Éteindre' : 'Allumer'}
            onClick={() =>
              runCommand(command('topology.setPower', device.id, !device.powered), {
                success: device.powered ? `${device.name} éteint` : `${device.name} démarré`
              })
            }
            testId="power-toggle"
          />
          <span className="ml-auto" />
          <IconAction
            icon={Trash2}
            label="Supprimer l’équipement"
            onClick={() => {
              runCommand(command('topology.removeDevices', [device.id]))
              ui().closeWindow(device.id)
              ui().clearSelection()
            }}
            testId="delete-device"
            tone="danger"
          />
        </div>
      </div>

      <PanelSection id="general" title="Général">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {host ? 'Nom de l’ordinateur' : 'Nom'}
            <EditableName deviceId={device.id} name={device.name} />
          </label>
          <KeyValues rows={generalRows(lab, device)} />
        </div>
      </PanelSection>

      <PanelSection
        id="interfaces"
        title={device.kind === 'switch' ? 'Ports' : 'Interfaces'}
        count={device.interfaces.length}
        actions={
          device.kind === 'server' ? (
            <button
              type="button"
              onClick={() => runCommand(command('topology.addServerInterface', device.id))}
              title="Ajouter une carte réseau"
              aria-label="Ajouter une carte réseau"
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <Plus size={14} />
            </button>
          ) : null
        }
      >
        <InterfaceList device={device} compact={device.kind === 'switch'} />
      </PanelSection>

      {device.kind === 'server' && <RolesSection device={device} />}
      {host && <ServicesSection lab={lab} device={host} />}
      {device.kind === 'router' && <RoutesSection device={device} />}
      {host && <EventsSection device={host} />}
    </>
  )
}

function generalRows(lab: LabState, device: Device): [string, ReactNode][] {
  const rows: [string, ReactNode][] = []
  if (isHostDevice(device)) {
    const { host } = device
    rows.push(host.domain ? ['Domaine', host.domain] : ['Groupe de travail', host.workgroup], [
      'Session',
      host.session ? (
        `${host.session.domain ?? device.name}\\${host.session.user}`
      ) : (
        <span className="text-fg-subtle">écran de connexion</span>
      )
    ])
    if (host.pendingReboot) rows.push(['Redémarrage', <span className="text-warn">requis</span>])
  }
  if (device.kind === 'switch') {
    const used = device.interfaces.filter((i) =>
      Object.values(lab.links).some((l) => isEnd(l, device.id, i.id))
    )
    rows.push(['Ports utilisés', `${used.length} / ${device.interfaces.length}`])
  }
  if (device.kind === 'router') rows.push(['Routes statiques', String(device.routes.length)])
  rows.push(['État', device.powered ? 'allumé' : 'éteint'])
  return rows
}

function isEnd(link: Link, deviceId: string, ifaceId: string): boolean {
  return (
    (link.a.deviceId === deviceId && link.a.ifaceId === ifaceId) ||
    (link.b.deviceId === deviceId && link.b.ifaceId === ifaceId)
  )
}

function RolesSection({ device }: { device: HostDevice }) {
  const roles = FEATURES.filter((f) => f.role && device.host.features.includes(f.name))
  return (
    <PanelSection id="roles" title="Rôles installés" count={roles.length}>
      {roles.length === 0 ? (
        <p className="text-xs text-fg-subtle">Aucun rôle installé.</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {roles.map((r) => (
            <li
              key={r.name}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg"
              title={r.name}
            >
              {r.displayName}
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

function ServicesSection({ lab, device }: { lab: LabState; device: HostDevice }) {
  const rows: [string, ReactNode][] = []
  if (device.kind === 'server') {
    const dhcp = device.services.dhcp
    if (dhcp) {
      const scopes = dhcp.scopes.length
      const leases = dhcp.scopes.reduce((n, s) => n + s.leases.length, 0)
      rows.push([
        'Serveur DHCP',
        <>
          {scopes} étendue{scopes > 1 ? 's' : ''} · {leases} bail{leases > 1 ? 'x' : ''}
          {device.host.domain && (
            <span className={dhcp.authorized ? 'text-ok' : 'text-warn'}>
              {dhcp.authorized ? ' · autorisé' : ' · non autorisé'}
            </span>
          )}
        </>
      ])
    }
    const dns = device.services.dns
    if (dns) {
      const zones = dns.zones.length
      rows.push([
        'Serveur DNS',
        `${zones} zone${zones > 1 ? 's' : ''}${dns.forwarders.length ? ' · redirecteurs' : ''}`
      ])
    }
    const domain = Object.values(lab.domains).find((d) => d.controllers.includes(device.id))
    if (domain) rows.push(['AD DS', `contrôleur de ${domain.name}`])
  }
  const dhcpClients = device.interfaces.filter((i) => i.l3 && i.addressing === 'dhcp')
  rows.push([
    'Client DHCP',
    dhcpClients.length > 0 ? (
      dhcpClients.map((i) => i.name).join(', ')
    ) : (
      <span className="text-fg-subtle">—</span>
    )
  ])
  const dns = [...new Set(device.interfaces.flatMap((i) => i.dnsServers))]
  rows.push([
    'Client DNS',
    dns.length > 0 ? (
      <span className="font-mono">{dns.join(', ')}</span>
    ) : (
      <span className="text-fg-subtle">—</span>
    )
  ])
  return (
    <PanelSection id="services" title="Services">
      <KeyValues rows={rows} />
    </PanelSection>
  )
}

function RoutesSection({ device }: { device: RouterDevice }) {
  return (
    <PanelSection id="routes" title="Routes statiques" count={device.routes.length}>
      {device.routes.length === 0 ? (
        <p className="text-xs text-fg-subtle">Aucune route statique.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-fg">
          {device.routes.map((r) => (
            <li key={`${r.network}/${r.prefixLength}-${r.nextHop}`} className="selectable">
              {r.network}/{r.prefixLength} → {r.nextHop}
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

const LEVELS = {
  information: { icon: Info, cls: 'text-info', label: 'Information' },
  warning: { icon: TriangleAlert, cls: 'text-warn', label: 'Avertissement' },
  error: { icon: CircleAlert, cls: 'text-danger', label: 'Erreur' }
} as const

function EventsSection({ device }: { device: HostDevice }) {
  const events = device.host.eventLog.slice(-5).reverse()
  return (
    <PanelSection id="events" title="Derniers événements" count={device.host.eventLog.length}>
      {events.length === 0 ? (
        <p className="text-xs text-fg-subtle">Aucun événement.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {events.map((e) => {
            const level = LEVELS[e.level]
            const LevelIcon = level.icon
            return (
              <li key={e.id} className="flex gap-2 text-xs" title={e.message}>
                <LevelIcon size={13} className={`mt-0.5 shrink-0 ${level.cls}`} aria-label={level.label} />
                <div className="min-w-0">
                  <div className="flex gap-1.5 text-[11px] text-fg-muted">
                    <span className="font-mono">{formatSimTime(e.time).slice(-8)}</span>
                    <span className="truncate">
                      {e.source} · {e.eventId}
                    </span>
                  </div>
                  <div className="truncate text-fg">{e.message}</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => useUiStore.getState().openWindow(device.id, 'config')}
        className="mt-2 text-[11px] text-accent-text hover:underline"
      >
        Ouvrir le journal complet
      </button>
    </PanelSection>
  )
}

function MultiProperties({ devices }: { devices: Device[] }) {
  return (
    <PanelSection id="multi" title={`${devices.length} équipements sélectionnés`}>
      <ul className="mb-3 flex flex-col gap-1 text-[13px]">
        {devices.map((d) => (
          <li key={d.id}>
            {d.name} <span className="text-xs text-fg-subtle">— {DEVICE_KIND_INFO[d.kind].label}</span>
          </li>
        ))}
      </ul>
      <Button
        variant="danger"
        onClick={() => {
          runCommand(
            command(
              'topology.removeDevices',
              devices.map((d) => d.id)
            )
          )
          useUiStore.getState().clearSelection()
        }}
      >
        <Trash2 size={14} /> Supprimer la sélection
      </Button>
    </PanelSection>
  )
}

function LinkProperties({ link }: { link: Link }) {
  const lab = useLabStore((s) => s.lab)
  const describe = (side: 'a' | 'b') => {
    const end = link[side]
    const device = lab.devices[end.deviceId]
    const iface = device?.interfaces.find((i) => i.id === end.ifaceId)
    const status = endStatus(lab, link, side)
    return { device, iface, status }
  }
  const ends = [describe('a'), describe('b')]
  const labels = { up: 'actif', degraded: 'actif, adressage incomplet', down: 'inactif' }
  return (
    <PanelSection id="link" title="Câble Ethernet">
      <ul className="mb-3 flex flex-col gap-2">
        {ends.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px]">
            <StatusDot status={e.status} />
            <span className="font-semibold">{e.device?.name}</span>
            <span className="font-mono text-xs text-fg-muted">{e.iface?.name}</span>
            <span className="ml-auto text-xs text-fg-subtle">{labels[e.status]}</span>
          </li>
        ))}
      </ul>
      <Button
        variant="danger"
        onClick={() => {
          runCommand(command('topology.disconnect', link.id))
          useUiStore.getState().clearSelection()
        }}
      >
        <Unplug size={14} /> Débrancher le câble
      </Button>
    </PanelSection>
  )
}

/** Sans sélection : vue d'ensemble du lab. */
function LabOverview({ lab }: { lab: LabState }) {
  const devices = Object.values(lab.devices)
  const links = Object.values(lab.links)
  const byStatus = { up: 0, degraded: 0, down: 0 }
  for (const l of links) byStatus[linkStatus(lab, l)]++
  return (
    <>
      <PanelSection id="overview" title="Vue d’ensemble">
        <div className="grid grid-cols-5 gap-1">
          {DEVICE_KINDS.map((kind) => {
            const Icon = DEVICE_ICONS[kind]
            const n = devices.filter((d) => d.kind === kind).length
            return (
              <div
                key={kind}
                className="relative flex flex-col items-center gap-0.5 overflow-hidden rounded-md border border-line bg-surface py-1.5"
                title={DEVICE_KIND_INFO[kind].label}
              >
                <span className={`absolute inset-x-0 top-0 h-[2px] ${KIND_STRIPE[kind]}`} />
                <Icon size={15} className="text-fg-muted" />
                <span className="text-xs font-medium text-fg">{n}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-3">
          <KeyValues
            rows={[
              ['Équipements', String(devices.length)],
              [
                'Liens',
                <>
                  {links.length}
                  {links.length > 0 && (
                    <span className="text-fg-muted">
                      {' '}
                      · <span className="text-ok">{byStatus.up} actifs</span>
                      {byStatus.degraded > 0 && (
                        <span className="text-warn"> · {byStatus.degraded} à vérifier</span>
                      )}
                      {byStatus.down > 0 && <span className="text-danger"> · {byStatus.down} inactifs</span>}
                    </span>
                  )}
                </>
              ],
              ['Domaines AD', Object.keys(lab.domains).join(', ') || '—']
            ]}
          />
        </div>
      </PanelSection>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-fg-subtle">
        <MousePointerClick size={24} strokeWidth={1.5} />
        <p>Sélectionnez un équipement ou un câble pour afficher ses propriétés.</p>
      </div>
    </>
  )
}
