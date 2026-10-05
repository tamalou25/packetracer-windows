/**
 * Onglet Config d'un équipement : paramètres généraux et interfaces.
 */
import { Power } from 'lucide-react'
import { setInterfaceEnabled, setPower, type Device } from '@engine/index'
import { runAction } from '../../lib/run'
import { EditableName } from '../common/EditableName'
import { Button, Field, Section } from '../common/ui'
import { InterfaceList } from '../properties/InterfaceList'

export function ConfigTab({ device }: { device: Device }) {
  return (
    <div className="flex h-full">
      <nav className="w-44 shrink-0 border-r border-slate-200 bg-slate-50 p-2 text-xs">
        <div className="rounded bg-sky-100 px-2 py-1.5 font-semibold text-sky-800">Paramètres généraux</div>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
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
        <Section title="Ports">
          <div className="mb-2 flex flex-wrap gap-1">
            {device.interfaces.map((iface) => (
              <label
                key={iface.id}
                className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={iface.enabled}
                  onChange={(e) =>
                    runAction((lab) => setInterfaceEnabled(lab, device.id, iface.id, e.target.checked))
                  }
                />
                {iface.name}
              </label>
            ))}
          </div>
          <InterfaceList device={device} />
        </Section>
      </div>
    </div>
  )
}
