/**
 * Application « Système » : nom de l'ordinateur et appartenance (groupe de travail / domaine).
 */
import { useState } from 'react'
import { renameComputer, restartComputer, type HostDevice } from '@engine/index'
import { runAction } from '../../lib/run'
import { useUiStore } from '../../store/ui'
import { Button, Field, Section, inputClass } from '../common/ui'

export function SystemApp({ device }: { device: HostDevice }) {
  const [name, setName] = useState(device.host.pendingName ?? device.name)
  return (
    <div className="h-full overflow-y-auto">
      <Section title="Nom de l’ordinateur, domaine et groupe de travail">
        <dl className="mb-4 grid max-w-lg grid-cols-[200px_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">Nom complet de l’ordinateur</dt>
          <dd className="font-medium">
            {device.host.domain ? `${device.name}.${device.host.domain}` : device.name}
          </dd>
          <dt className="text-slate-500">{device.host.domain ? 'Domaine' : 'Groupe de travail'}</dt>
          <dd className="font-medium">{device.host.domain ?? device.host.workgroup}</dd>
          <dt className="text-slate-500">Utilisateur connecté</dt>
          <dd className="font-medium">
            {device.host.session
              ? `${device.host.session.domain ?? device.name}\\${device.host.session.user}`
              : '—'}
          </dd>
        </dl>
        {device.host.pendingReboot && (
          <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
            Vous devez redémarrer l’ordinateur pour appliquer ces modifications.
          </p>
        )}
        <div className="flex max-w-lg items-end gap-2">
          <Field label="Nom de l’ordinateur">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            onClick={() => {
              if (runAction((lab) => renameComputer(lab, device.id, name)) !== undefined)
                useUiStore
                  .getState()
                  .notify('warning', 'Vous devez redémarrer l’ordinateur pour appliquer ces modifications.')
            }}
          >
            Modifier
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              runAction((lab) => restartComputer(lab, device.id), { success: `${device.name} a redémarré.` })
            }
          >
            Redémarrer
          </Button>
        </div>
      </Section>
    </div>
  )
}
