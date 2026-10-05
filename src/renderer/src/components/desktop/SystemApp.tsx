/**
 * Application « Système » : nom de l'ordinateur, membre d'un domaine ou d'un groupe de travail.
 */
import { useState } from 'react'
import { joinDomain, leaveDomain, renameComputer, restartComputer, type HostDevice } from '@engine/index'
import { runDirectoryOperation } from '../../lib/directory'
import { runAction } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { Button, Field, Section, inputClass } from '../common/ui'
import { FormDialog } from '../common/FormDialog'

export function SystemApp({ device }: { device: HostDevice }) {
  const [name, setName] = useState(device.host.pendingName ?? device.name)
  const [domainName, setDomainName] = useState(device.host.domain ?? '')
  const [credentials, setCredentials] = useState(false)
  const isDc = Object.values(useLabStore((s) => s.lab.domains)).some((d) => d.controllers.includes(device.id))
  const pending = device.host.pendingDomain

  const join = (user: string, password: string) => {
    const op = joinDomain(useLabStore.getState().lab, device.id, { domain: domainName, user, password })
    runDirectoryOperation(op, () => {
      useUiStore.getState().showModal({
        title: op.ok
          ? 'Modifications du nom ou du domaine de l’ordinateur'
          : 'Modifications du nom ou du domaine de l’ordinateur — erreur',
        message: op.message
      })
    })
    return true
  }

  return (
    <div className="relative h-full overflow-y-auto">
      <Section title="Nom de l’ordinateur, domaine et groupe de travail">
        <dl className="mb-4 grid max-w-lg grid-cols-[200px_1fr] gap-y-1 text-sm">
          <dt className="text-slate-500">Nom complet de l’ordinateur</dt>
          <dd className="font-medium">
            {device.host.domain ? `${device.name}.${device.host.domain}` : device.name}
          </dd>
          <dt className="text-slate-500">{device.host.domain ? 'Domaine' : 'Groupe de travail'}</dt>
          <dd className="font-medium" data-testid="system-membership">
            {device.host.domain ?? device.host.workgroup}
            {pending !== null && (
              <span className="ml-1 text-xs text-amber-700">
                (après redémarrage : {pending || 'WORKGROUP'})
              </span>
            )}
          </dd>
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
            Renommer
          </Button>
        </div>
      </Section>
      {!isDc && (
        <Section title="Membre d’un domaine">
          <div className="flex max-w-lg items-end gap-2">
            <Field label="Domaine">
              <input
                className={inputClass}
                value={domainName}
                placeholder="lab.local"
                onChange={(e) => setDomainName(e.target.value)}
                data-testid="join-domain"
              />
            </Field>
            <Button
              variant="primary"
              onClick={() => setCredentials(true)}
              disabled={!domainName.trim()}
              data-testid="join-submit"
            >
              Joindre
            </Button>
            {device.host.domain && (
              <Button
                onClick={() => {
                  const op = leaveDomain(useLabStore.getState().lab, device.id)
                  runDirectoryOperation(op, () =>
                    useUiStore.getState().notify(op.ok ? 'warning' : 'error', op.message)
                  )
                }}
              >
                Quitter le domaine
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Le DNS de l’ordinateur doit pointer vers un contrôleur du domaine.
          </p>
        </Section>
      )}
      <Section title="Alimentation">
        <Button
          variant="primary"
          onClick={() =>
            runAction((lab) => restartComputer(lab, device.id), { success: `${device.name} a redémarré.` })
          }
          data-testid="system-restart"
        >
          Redémarrer maintenant
        </Button>
      </Section>
      {credentials && (
        <FormDialog
          title="Sécurité"
          description={`Entrez le nom et le mot de passe d’un compte autorisé à joindre le domaine ${domainName}.`}
          fields={[
            { key: 'user', label: 'Nom d’utilisateur', placeholder: 'LAB\\Administrateur' },
            { key: 'password', label: 'Mot de passe', type: 'password' }
          ]}
          onSubmit={(v) => join(String(v['user']), String(v['password']))}
          onClose={() => setCredentials(false)}
          testId="join-credentials"
        />
      )}
    </div>
  )
}
