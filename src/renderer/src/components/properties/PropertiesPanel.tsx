/**
 * Panneau des propriétés (à droite) : détails de l'équipement ou du câble sélectionné.
 */
import { AppWindow, MousePointerClick, Plus, Power, Trash2, Unplug } from 'lucide-react'
import {
  addServerInterface,
  DEVICE_KIND_INFO,
  disconnect,
  endStatus,
  removeDevices,
  setPower,
  type Device,
  type Link
} from '@engine/index'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { runAction } from '../../lib/run'
import { DEVICE_COLORS, DEVICE_ICONS } from '../../lib/devices'
import { EditableName } from '../common/EditableName'
import { Button, Field, Section, StatusDot } from '../common/ui'
import { InterfaceList } from './InterfaceList'

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection)
  const lab = useLabStore((s) => s.lab)
  const devices = selection.devices.map((id) => lab.devices[id]).filter((d): d is Device => !!d)
  const link = selection.link ? lab.links[selection.link] : undefined

  let content
  if (devices.length === 1 && devices[0]) content = <DeviceProperties device={devices[0]} />
  else if (devices.length > 1) content = <MultiProperties devices={devices} />
  else if (link) content = <LinkProperties link={link} />
  else
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
        <MousePointerClick size={28} strokeWidth={1.5} />
        <p>Sélectionnez un équipement ou un câble pour afficher ses propriétés.</p>
      </div>
    )

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white"
      aria-label="Propriétés"
      data-testid="properties-panel"
    >
      <header className="border-b border-slate-200 px-4 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Propriétés
      </header>
      {content}
    </aside>
  )
}

function DeviceProperties({ device }: { device: Device }) {
  const Icon = DEVICE_ICONS[device.kind]
  const ui = useUiStore.getState
  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${DEVICE_COLORS[device.kind]}`}
        >
          <Icon size={22} strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-800">{device.name}</div>
          <div className="text-xs text-slate-500">{DEVICE_KIND_INFO[device.kind].label}</div>
        </div>
      </div>
      <Section title="Général">
        <div className="flex flex-col gap-3">
          <Field label={device.kind === 'server' || device.kind === 'client' ? 'Nom de l’ordinateur' : 'Nom'}>
            <EditableName deviceId={device.id} name={device.name} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => ui().openWindow(device.id)}
              data-testid="open-device-window"
            >
              <AppWindow size={14} /> Ouvrir
            </Button>
            <Button
              onClick={() =>
                runAction((lab) => setPower(lab, device.id, !device.powered), {
                  success: device.powered ? `${device.name} éteint` : `${device.name} démarré`
                })
              }
            >
              <Power size={14} /> {device.powered ? 'Éteindre' : 'Allumer'}
            </Button>
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={() => {
                runAction((lab) => removeDevices(lab, [device.id]))
                ui().closeWindow(device.id)
                ui().clearSelection()
              }}
            >
              <Trash2 size={14} /> Supprimer
            </Button>
          </div>
        </div>
      </Section>
      <Section
        title={device.kind === 'switch' ? 'Ports' : 'Interfaces réseau'}
        actions={
          device.kind === 'server' ? (
            <Button
              variant="ghost"
              onClick={() => runAction((lab) => addServerInterface(lab, device.id))}
              title="Ajouter une carte réseau"
            >
              <Plus size={14} /> Carte
            </Button>
          ) : null
        }
      >
        <InterfaceList device={device} />
      </Section>
    </>
  )
}

function MultiProperties({ devices }: { devices: Device[] }) {
  return (
    <Section title={`${devices.length} équipements sélectionnés`}>
      <ul className="mb-3 flex flex-col gap-1 text-sm">
        {devices.map((d) => (
          <li key={d.id}>
            {d.name} <span className="text-xs text-slate-400">— {DEVICE_KIND_INFO[d.kind].label}</span>
          </li>
        ))}
      </ul>
      <Button
        variant="danger"
        onClick={() => {
          runAction((lab) =>
            removeDevices(
              lab,
              devices.map((d) => d.id)
            )
          )
          useUiStore.getState().clearSelection()
        }}
      >
        <Trash2 size={14} /> Supprimer la sélection
      </Button>
    </Section>
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
    <Section title="Câble Ethernet">
      <ul className="mb-3 flex flex-col gap-2">
        {ends.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <StatusDot status={e.status} />
            <span className="font-semibold">{e.device?.name}</span>
            <span className="text-slate-500">{e.iface?.name}</span>
            <span className="ml-auto text-xs text-slate-400">{labels[e.status]}</span>
          </li>
        ))}
      </ul>
      <Button
        variant="danger"
        onClick={() => {
          runAction((l) => disconnect(l, link.id))
          useUiStore.getState().clearSelection()
        }}
      >
        <Unplug size={14} /> Débrancher le câble
      </Button>
    </Section>
  )
}
