/**
 * Propriétés système (sysdm.cpl) : nom complet, domaine ou groupe de travail, et la boîte
 * « Modification du nom ou du domaine de l'ordinateur » (renommer, joindre ou quitter un domaine).
 */
import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { type HostDevice, command } from '@engine/index'
import { launch } from '../../../lib/desktop'
import { runDirectoryCommand } from '../../../lib/directory'
import { runCommand } from '../../../lib/run'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import {
  DialogBody,
  DialogFooter,
  GroupBox,
  MessageBox,
  TabStrip,
  WinButton,
  WinInput,
  type MessageButton,
  type MessageIcon
} from '../shell/classic'

export function SystemProperties({ device }: { device: HostDevice }) {
  const win = useAppWindow()
  const [restart, setRestart] = useState(false)
  const dc = useLabStore((s) => Object.values(s.lab.domains).some((d) => d.controllers.includes(device.id)))
  const fqdn = device.host.domain ? `${device.name}.${device.host.domain}` : device.name
  const close = () => {
    // Des modifications attendent un redémarrage : le système le propose à la fermeture
    if (device.host.pendingReboot) setRestart(true)
    else win?.close()
  }
  return (
    <div className="relative flex h-full flex-col" data-testid="sysdm">
      <TabStrip
        tabs={[{ id: 'name', label: 'Nom de l’ordinateur' }]}
        active="name"
        onChange={() => undefined}
      />
      <DialogBody className="flex flex-col gap-3 bg-white">
        <div className="flex gap-3">
          <Monitor size={34} className="shrink-0 text-[#1e6fbf]" strokeWidth={1.4} />
          <p>Le système utilise les informations suivantes pour identifier votre ordinateur sur le réseau.</p>
        </div>
        <dl className="grid grid-cols-[150px_1fr] gap-y-2">
          <dt>Nom complet de l’ordinateur :</dt>
          <dd data-testid="sysdm-fqdn">{fqdn}</dd>
          <dt>{device.host.domain ? 'Domaine :' : 'Groupe de travail :'}</dt>
          <dd data-testid="system-membership">{device.host.domain ?? device.host.workgroup}</dd>
        </dl>
        {device.host.pendingReboot && (
          <p className="flex items-start gap-2 text-[#9a6700]">
            <span className="font-bold">⚠</span> Les modifications prendront effet après le redémarrage de cet
            ordinateur.
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-3">
          <p>
            {dc
              ? 'Remarque : l’identification de l’ordinateur ne peut pas être modifiée, car l’ordinateur est un contrôleur de domaine.'
              : 'Pour renommer cet ordinateur ou changer de domaine ou de groupe de travail, cliquez sur Modifier.'}
          </p>
          <WinButton
            disabled={dc}
            onClick={() => launch(device.id, 'sysdmname', { parent: win?.win.id })}
            data-testid="sysdm-change"
          >
            Modifier…
          </WinButton>
        </div>
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={close} data-testid="sysdm-ok">
          OK
        </WinButton>
        <WinButton onClick={close}>Annuler</WinButton>
        <WinButton disabled>Appliquer</WinButton>
      </DialogFooter>
      {restart && (
        <MessageBox
          title="Propriétés système"
          icon="info"
          message={
            'Vous devez redémarrer votre ordinateur pour appliquer ces modifications.\nAvant de redémarrer, enregistrez tous les fichiers ouverts et fermez tous les programmes.'
          }
          buttons={[
            {
              label: 'Redémarrer maintenant',
              primary: true,
              testId: 'restart-now',
              onClick: () => {
                setRestart(false)
                runCommand(
                  command(
                    'system.restartComputer',
                    device.id,
                    'Système d’exploitation : reconfiguration (planifiée)'
                  )
                )
              }
            },
            {
              label: 'Redémarrer ultérieurement',
              testId: 'restart-later',
              onClick: () => {
                setRestart(false)
                win?.close()
              }
            }
          ]}
        />
      )}
    </div>
  )
}

interface Box {
  title: string
  icon: MessageIcon
  message: string
  buttons: MessageButton[]
}

export function ComputerNameDialog({ device }: { device: HostDevice }) {
  const win = useAppWindow()
  const domainInfo = device.host.domain ? useLabStore.getState().lab.domains[device.host.domain] : undefined
  const currentName = device.host.pendingName ?? device.name
  const [name, setName] = useState(currentName)
  const [member, setMember] = useState<'domain' | 'workgroup'>(device.host.domain ? 'domain' : 'workgroup')
  const [domain, setDomain] = useState(device.host.domain ?? '')
  const workgroup = device.host.domain ? 'WORKGROUP' : device.host.workgroup
  const [credentials, setCredentials] = useState(false)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [box, setBox] = useState<Box | null>(null)
  const title = 'Modifications du nom ou du domaine de l’ordinateur'
  const suffix = member === 'domain' && domain.trim() ? `.${domain.trim().toLowerCase()}` : ''

  const done = (message: string) =>
    setBox({
      title,
      icon: 'info',
      message,
      buttons: [{ label: 'OK', primary: true, testId: 'msgbox-ok', onClick: () => win?.close() }]
    })

  const error = (message: string) =>
    setBox({
      title,
      icon: 'error',
      message,
      buttons: [{ label: 'OK', primary: true, testId: 'msgbox-ok', onClick: () => setBox(null) }]
    })

  const ok = () => {
    const renamed = name.trim().toUpperCase() !== currentName.toUpperCase()
    if (renamed && runCommand(command('system.renameComputer', device.id, name)) === undefined) return
    const joining = member === 'domain' && domain.trim().toLowerCase() !== (device.host.domain ?? '')
    const leaving = member === 'workgroup' && !!device.host.domain
    if (joining) {
      setCredentials(true)
      return
    }
    if (leaving) {
      runDirectoryCommand(command('adds.leaveDomain', device.id), (op) =>
        op.success ? done(op.message) : error(op.message)
      )
      return
    }
    if (renamed) done('Vous devez redémarrer cet ordinateur pour appliquer ces modifications.')
    else win?.close()
  }

  const join = () => {
    setCredentials(false)
    runDirectoryCommand(
      command('adds.joinDomain', device.id, { domain: domain.trim(), user, password }),
      (op) => (op.success ? done(op.message) : error(op.message))
    )
  }

  return (
    <div className="relative flex h-full flex-col" data-testid="sysdmname">
      <DialogBody className="flex flex-col gap-2">
        <p>
          Vous pouvez modifier le nom et l’appartenance de cet ordinateur. Ces modifications peuvent influer
          sur l’accès aux ressources réseau.
        </p>
        <label className="flex flex-col gap-1">
          Nom de l’ordinateur :
          <WinInput value={name} onChange={(e) => setName(e.target.value)} data-testid="sysdm-name" />
        </label>
        <div>
          Nom complet de l’ordinateur :
          <div className="font-medium">
            {name.trim().toUpperCase()}
            {suffix}
          </div>
        </div>
        <div className="flex justify-end">
          <WinButton disabled>Autres…</WinButton>
        </div>
        <GroupBox label="Membre d’un">
          <label className="flex items-center gap-2 py-1">
            <input
              type="radio"
              checked={member === 'domain'}
              onChange={() => setMember('domain')}
              data-testid="sysdm-domain-radio"
            />
            Domaine :
          </label>
          <WinInput
            disabled={member !== 'domain'}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={domainInfo?.name ?? 'lab.local'}
            data-testid="join-domain"
          />
          <label className="flex items-center gap-2 py-1">
            <input
              type="radio"
              checked={member === 'workgroup'}
              onChange={() => setMember('workgroup')}
              data-testid="sysdm-workgroup-radio"
            />
            Groupe de travail :
          </label>
          <WinInput
            disabled={member !== 'workgroup'}
            readOnly
            value={workgroup}
            title="Le nom du groupe de travail n’est pas modifiable dans le système simulé."
            data-testid="sysdm-workgroup"
          />
        </GroupBox>
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={ok} data-testid="sysdm-name-ok">
          OK
        </WinButton>
        <WinButton onClick={() => win?.close()}>Annuler</WinButton>
      </DialogFooter>

      {credentials && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
          <div
            className="w-[330px] border border-[#8a8a8a] bg-white shadow-xl"
            data-testid="join-credentials"
          >
            <div className="bg-white px-3 py-2 text-xs">Sécurité</div>
            <div className="flex flex-col gap-2 px-4 pb-3 text-xs">
              <p className="font-semibold">{title}</p>
              <p>Entrez le nom et le mot de passe d’un compte autorisé à joindre le domaine.</p>
              <WinInput
                autoFocus
                placeholder="Nom d’utilisateur"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                data-testid="field-user"
              />
              <WinInput
                type="password"
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                data-testid="field-password"
              />
              <p className="text-[#555]">Domaine : {domain.trim()}</p>
            </div>
            <div className="flex justify-end gap-2 bg-[#f0f0f0] px-3 py-2.5">
              <WinButton primary onClick={join} data-testid="form-submit">
                OK
              </WinButton>
              <WinButton onClick={() => setCredentials(false)}>Annuler</WinButton>
            </div>
          </div>
        </div>
      )}
      {box && <MessageBox title={box.title} icon={box.icon} message={box.message} buttons={box.buttons} />}
    </div>
  )
}
