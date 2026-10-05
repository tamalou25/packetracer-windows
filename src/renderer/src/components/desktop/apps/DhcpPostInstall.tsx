/**
 * Assistant Configuration post-installation DHCP : création des groupes de sécurité,
 * autorisation du serveur dans Active Directory (compte Admins du domaine) ou autorisation ignorée.
 */
import { useState } from 'react'
import { CircleCheck, CircleX, MinusCircle } from 'lucide-react'
import { type DhcpPostInstallResult, type ServerDevice, command } from '@engine/index'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import { WinButton } from '../shell/classic'
import { NoteList, WizardFrame, type WizardStep } from './Wizard'

const STEPS: WizardStep[] = [
  { id: 'description', label: 'Description' },
  { id: 'authorization', label: 'Autorisation' },
  { id: 'summary', label: 'Résumé' }
]

export function DhcpPostInstall({ device }: { device: ServerDevice }) {
  const win = useAppWindow()
  const [step, setStep] = useState('description')
  const [authorize, setAuthorize] = useState(true)
  const [outcome, setOutcome] = useState<
    { ok: true; value: DhcpPostInstallResult } | { ok: false; message: string } | null
  >(null)
  const member = !!device.host.domain
  const session = device.host.session
  const account = session ? `${session.domain ?? device.name}\\${session.user}` : '—'

  const commit = () => {
    const r = useLabStore
      .getState()
      .dispatch(command('dhcp.completePostInstall', device.id, { authorize: member && authorize }))
    setOutcome(r.ok ? { ok: true, value: r.value } : { ok: false, message: r.error.message })
    setStep('summary')
  }

  const status = (label: string, state: 'done' | 'skipped' | 'failed') => (
    <div className="flex items-start justify-between gap-3 border-b border-[#eee] py-1.5">
      <span>{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {state === 'done' ? (
          <CircleCheck size={13} className="text-[#06b025]" />
        ) : state === 'skipped' ? (
          <MinusCircle size={13} className="text-[#777]" />
        ) : (
          <CircleX size={13} className="text-[#e81123]" />
        )}
        {state === 'done' ? 'Effectué' : state === 'skipped' ? 'Ignoré' : 'Échec'}
      </span>
    </div>
  )

  let content
  if (step === 'description')
    content = (
      <div className="flex flex-col gap-3">
        <p>
          Les étapes suivantes seront effectuées pour terminer la configuration du serveur DHCP sur
          l’ordinateur cible :
        </p>
        <p>Créer les groupes de sécurité suivants pour la délégation de l’administration du serveur DHCP :</p>
        <NoteList items={['Administrateurs DHCP', 'Utilisateurs DHCP']} />
        <p>Autoriser le serveur DHCP sur l’ordinateur cible (si l’ordinateur est joint à un domaine).</p>
      </div>
    )
  else if (step === 'authorization')
    content = member ? (
      <div className="flex flex-col gap-3">
        <p>
          Spécifiez les informations d’identification à utiliser pour autoriser ce serveur DHCP dans les
          services AD DS.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={authorize}
            onChange={() => setAuthorize(true)}
            data-testid="dhcppost-authorize"
          />
          Utiliser les informations d’identification de l’utilisateur suivant
        </label>
        <div className="pl-6 text-[#555]">Nom d’utilisateur : {account}</div>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!authorize}
            onChange={() => setAuthorize(false)}
            data-testid="dhcppost-skip"
          />
          Ignorer l’autorisation AD
        </label>
      </div>
    ) : (
      <p>Cet ordinateur n’est pas membre d’un domaine : le serveur DHCP n’a pas besoin d’être autorisé.</p>
    )
  else
    content = (
      <div className="flex flex-col gap-2" data-testid="dhcppost-summary">
        <p>L’état de la configuration post-installation est indiqué ci-dessous :</p>
        {outcome?.ok ? (
          <>
            {status('Création de groupes de sécurité', 'done')}
            {status(
              'Autorisation du serveur DHCP',
              outcome.value.authorization === 'done' ? 'done' : 'skipped'
            )}
            {outcome.value.authorization === 'not-member' && (
              <p className="text-[#555]">Serveur autonome (groupe de travail) : autorisation sans objet.</p>
            )}
          </>
        ) : (
          <>
            {status('Création de groupes de sécurité', 'failed')}
            {status('Autorisation du serveur DHCP', 'failed')}
            <p className="text-[#c42b1c]">{outcome?.message}</p>
          </>
        )}
      </div>
    )

  return (
    <WizardFrame
      heading={step === 'summary' ? 'Résumé' : step === 'authorization' ? 'Autorisation' : 'Description'}
      destination={device.name}
      steps={STEPS}
      current={step}
      testId="dhcppost-wizard"
      footer={
        step === 'summary' ? (
          <WinButton primary onClick={() => win?.close()} data-testid="wiz-close">
            Fermer
          </WinButton>
        ) : (
          <>
            <WinButton
              onClick={() => setStep('description')}
              disabled={step === 'description'}
              data-testid="wiz-prev"
            >
              &lt; Précédent
            </WinButton>
            <WinButton
              onClick={() => setStep('authorization')}
              disabled={step !== 'description'}
              data-testid="wiz-next"
            >
              Suivant &gt;
            </WinButton>
            <WinButton
              primary
              onClick={commit}
              disabled={step !== 'authorization'}
              data-testid="dhcppost-commit"
            >
              Valider
            </WinButton>
            <WinButton onClick={() => win?.close()}>Annuler</WinButton>
          </>
        )
      }
    >
      {content}
    </WizardFrame>
  )
}
