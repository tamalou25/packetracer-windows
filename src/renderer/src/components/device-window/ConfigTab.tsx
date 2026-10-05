/**
 * Onglet Config d'un équipement : navigation à gauche, page de paramètres à droite.
 */
import { useState } from 'react'
import { Power } from 'lucide-react'
import { isHostDevice, setInterfaceEnabled, setPower, type Device } from '@engine/index'
import { runAction } from '../../lib/run'
import { EditableName } from '../common/EditableName'
import { Button, Field, Section } from '../common/ui'
import { InterfaceList } from '../properties/InterfaceList'
import { EventLogView } from './config/EventLogView'
import { HostInterfaceForm } from './config/HostInterfaceForm'
import { RouterInterfaceForm } from './config/RouterInterfaceForm'
import { RoutesPanel } from './config/RoutesPanel'

type Page = { kind: 'general' } | { kind: 'iface'; ifaceId: string } | { kind: 'routes' } | { kind: 'events' }

export function ConfigTab({ device }: { device: Device }) {
  const [page, setPage] = useState<Page>({ kind: 'general' })
  const l3 = device.interfaces.filter((i) => i.l3)
  const iface = page.kind === 'iface' ? device.interfaces.find((i) => i.id === page.ifaceId) : undefined

  const navItem = (label: string, target: Page, testId?: string) => {
    const active =
      page.kind === target.kind &&
      (target.kind !== 'iface' || (page.kind === 'iface' && page.ifaceId === target.ifaceId))
    return (
      <button
        key={label}
        type="button"
        data-testid={testId}
        onClick={() => setPage(target)}
        className={`w-full rounded-md px-2 py-1.5 text-left ${active ? 'bg-accent-soft font-semibold text-accent-text' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-panel p-2 text-xs">
        <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
          Global
        </div>
        {navItem('Paramètres généraux', { kind: 'general' })}
        {device.kind === 'router' && navItem('Routage statique', { kind: 'routes' }, 'nav-routes')}
        {isHostDevice(device) && navItem('Journal d’événements', { kind: 'events' }, 'nav-events')}
        {l3.length > 0 && (
          <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
            Interfaces
          </div>
        )}
        {l3.map((i) => navItem(i.name, { kind: 'iface', ifaceId: i.id }, `nav-iface-${i.name}`))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {page.kind === 'general' && (
          <>
            <Section title="Paramètres généraux">
              <div className="grid max-w-md gap-3">
                <Field label="Nom">
                  <EditableName deviceId={device.id} name={device.name} />
                </Field>
                <div>
                  <Button onClick={() => runAction((lab) => setPower(lab, device.id, !device.powered))}>
                    <Power size={14} /> {device.powered ? 'Éteindre l’équipement' : 'Allumer l’équipement'}
                  </Button>
                </div>
              </div>
            </Section>
            <Section title={device.kind === 'switch' ? 'Ports' : 'Interfaces'}>
              {device.kind === 'switch' && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {device.interfaces.map((port) => (
                    <label
                      key={port.id}
                      className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={port.enabled}
                        onChange={(e) =>
                          runAction((lab) => setInterfaceEnabled(lab, device.id, port.id, e.target.checked))
                        }
                      />
                      {port.name}
                    </label>
                  ))}
                </div>
              )}
              <InterfaceList device={device} />
            </Section>
          </>
        )}
        {page.kind === 'iface' &&
          iface &&
          (isHostDevice(device) ? (
            <HostInterfaceForm device={device} iface={iface} />
          ) : (
            <RouterInterfaceForm device={device} iface={iface} />
          ))}
        {page.kind === 'routes' && device.kind === 'router' && <RoutesPanel device={device} />}
        {page.kind === 'events' && isHostDevice(device) && <EventLogView device={device} />}
      </div>
    </div>
  )
}
