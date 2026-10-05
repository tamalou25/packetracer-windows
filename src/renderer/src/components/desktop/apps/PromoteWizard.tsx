/**
 * Assistant Configuration des services de domaine Active Directory : nouvelle forêt, options du
 * contrôleur (DNS, mot de passe DSRM), NetBIOS, chemins, examen (script PowerShell équivalent),
 * vérification de la configuration requise (essai à blanc du moteur) puis installation et redémarrage.
 */
import { useState } from 'react'
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import {
  installForest,
  passwordMeetsPolicy,
  validDnsName,
  type ForestInput,
  type ServerDevice
} from '@engine/index'
import { runAction } from '../../../lib/run'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import { MessageBox, WinButton, WinInput } from '../shell/classic'
import { WizardFrame, type WizardStep } from './Wizard'

const STEPS: WizardStep[] = [
  { id: 'deploy', label: 'Configuration de déploiement' },
  { id: 'dc', label: 'Options du contrôleur de domaine' },
  { id: 'dns', label: 'Options DNS' },
  { id: 'extra', label: 'Options supplémentaires' },
  { id: 'paths', label: 'Chemins d’accès' },
  { id: 'review', label: 'Examiner les options' },
  { id: 'prereq', label: 'Vérification de la configuration requise' },
  { id: 'install', label: 'Installation' }
]

const HEADINGS: Record<string, string> = {
  deploy: 'Configuration de déploiement',
  dc: 'Options du contrôleur de domaine',
  dns: 'Options DNS',
  extra: 'Options supplémentaires',
  paths: 'Chemins d’accès',
  review: 'Examiner les options',
  prereq: 'Vérification de la configuration requise',
  install: 'Installation'
}

function defaultNetbios(domain: string): string {
  return (domain.trim().split('.')[0] ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 15)
}

export function PromoteWizard({ device }: { device: ServerDevice }) {
  const win = useAppWindow()
  const [step, setStep] = useState('deploy')
  const [visited, setVisited] = useState<string[]>(['deploy'])
  const [domain, setDomain] = useState('')
  const [installDns, setInstallDns] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [netbios, setNetbios] = useState('')
  const [error, setError] = useState('')
  const [script, setScript] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [signout, setSignout] = useState(false)

  const input: ForestInput = {
    domainName: domain.trim(),
    netbios: netbios || defaultNetbios(domain),
    safeModePassword: password,
    installDns
  }
  // Vérification de la configuration requise : essai à blanc sur l'état courant
  const check =
    step === 'prereq' || step === 'install'
      ? installForest(useLabStore.getState().lab, device.id, input)
      : null

  const index = STEPS.findIndex((s) => s.id === step)
  const go = (id: string) => {
    setError('')
    setStep(id)
    setVisited((v) => (v.includes(id) ? v : [...v, id]))
  }
  const validate = (): string => {
    if (step === 'deploy') {
      const name = domain.trim().toLowerCase().replace(/\.$/, '')
      if (!name) return 'Le nom de domaine racine est obligatoire.'
      if (!validDnsName(name) || !name.includes('.'))
        return `Le nom de domaine « ${domain} » n’est pas valide : utilisez un nom DNS complet (exemple : lab.local).`
    }
    if (step === 'dc') {
      if (!password) return 'Un mot de passe DSRM est obligatoire.'
      if (password !== confirm) return 'Les mots de passe ne correspondent pas.'
      if (!passwordMeetsPolicy(password))
        return 'Le mot de passe ne répond pas aux exigences : au moins 7 caractères et trois catégories (majuscules, minuscules, chiffres, symboles).'
    }
    if (step === 'extra' && !/^[A-Z0-9-]{1,15}$/.test(netbios || defaultNetbios(domain)))
      return 'Le nom NetBIOS n’est pas valide (15 caractères maximum : lettres, chiffres, tiret).'
    return ''
  }
  const next = () => {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    const target = STEPS[index + 1]
    if (target?.id === 'extra' && !netbios) setNetbios(defaultNetbios(domain))
    if (target && target.id !== 'install') go(target.id)
  }

  const install = () => {
    go('install')
    setInstalling(true)
    // Le système annonce la déconnexion avant le redémarrage
    window.setTimeout(() => setSignout(true), 900)
  }

  const finish = () => {
    setSignout(false)
    // Promotion et redémarrage : le Bureau revient à l'écran de verrouillage
    runAction((lab) => installForest(lab, device.id, input))
  }

  const nb = netbios || defaultNetbios(domain)
  const scriptText = [
    '#',
    '# Script PowerShell pour le déploiement d’AD DS',
    '#',
    '',
    'Import-Module ADDSDeployment',
    'Install-ADDSForest `',
    '-CreateDnsDelegation:$false `',
    '-DatabasePath "C:\\Windows\\NTDS" `',
    '-DomainMode "WinThreshold" `',
    `-DomainName "${domain.trim().toLowerCase()}" \``,
    `-DomainNetbiosName "${nb}" \``,
    '-ForestMode "WinThreshold" `',
    `-InstallDns:$${installDns ? 'true' : 'false'} \``,
    '-LogPath "C:\\Windows\\NTDS" `',
    '-NoRebootOnCompletion:$false `',
    '-SysvolPath "C:\\Windows\\SYSVOL" `',
    '-Force:$true'
  ].join('\n')

  let content
  if (step === 'deploy')
    content = (
      <div className="flex flex-col gap-3">
        <p className="font-semibold">Sélectionner l’opération de déploiement</p>
        <label className="flex items-center gap-2 text-[#6d6d6d]">
          <input type="radio" disabled /> Ajouter un contrôleur de domaine à un domaine existant
        </label>
        <label className="flex items-center gap-2 text-[#6d6d6d]">
          <input type="radio" disabled /> Ajouter un nouveau domaine à une forêt existante
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked readOnly /> Ajouter une nouvelle forêt
        </label>
        <p className="mt-2 font-semibold">Spécifiez les informations de domaine pour cette opération</p>
        <label className="flex items-center gap-3">
          <span className="w-40">Nom de domaine racine :</span>
          <WinInput
            autoFocus
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            data-testid="field-domain"
          />
        </label>
      </div>
    )
  else if (step === 'dc')
    content = (
      <div className="flex flex-col gap-2">
        <p className="font-semibold">
          Sélectionner le niveau fonctionnel de la nouvelle forêt et du domaine racine
        </p>
        <label className="flex items-center gap-3 text-[#6d6d6d]">
          <span className="w-56">Niveau fonctionnel de la forêt :</span>
          <select disabled className="h-6 border border-[#ccc] px-1">
            <option>2016</option>
          </select>
        </label>
        <label className="flex items-center gap-3 text-[#6d6d6d]">
          <span className="w-56">Niveau fonctionnel du domaine :</span>
          <select disabled className="h-6 border border-[#ccc] px-1">
            <option>2016</option>
          </select>
        </label>
        <p className="mt-2 font-semibold">Spécifier les fonctionnalités de contrôleur de domaine</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={installDns}
            onChange={(e) => setInstallDns(e.target.checked)}
            data-testid="promote-dns"
          />
          Serveur DNS (Domain Name System)
        </label>
        <label className="flex items-center gap-2 text-[#6d6d6d]">
          <input type="checkbox" checked disabled /> Catalogue global (GC)
        </label>
        <label className="flex items-center gap-2 text-[#6d6d6d]">
          <input type="checkbox" disabled /> Contrôleur de domaine en lecture seule (RODC)
        </label>
        <p className="mt-2 font-semibold">
          Taper le mot de passe du mode de restauration des services d’annuaire (DSRM)
        </p>
        <label className="flex items-center gap-3">
          <span className="w-44">Mot de passe :</span>
          <WinInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="field-password"
          />
        </label>
        <label className="flex items-center gap-3">
          <span className="w-44">Confirmer le mot de passe :</span>
          <WinInput
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="field-confirm"
          />
        </label>
      </div>
    )
  else if (step === 'dns')
    content = (
      <div className="flex flex-col gap-3">
        <p className="flex items-start gap-2 border border-[#e3c35e] bg-[#fff8db] p-2">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[#9a6700]" />
          Impossible de créer une délégation pour ce serveur DNS, car la zone parente faisant autorité est
          introuvable ou elle n’exécute pas le serveur DNS. Si vous procédez à l’intégration avec une
          infrastructure DNS existante, vous devez manuellement créer une délégation. Sinon, aucune action
          n’est requise.
        </p>
        <label className="flex items-center gap-2 text-[#6d6d6d]">
          <input type="checkbox" disabled /> Créer une délégation DNS
        </label>
      </div>
    )
  else if (step === 'extra')
    content = (
      <div className="flex flex-col gap-3">
        <p>Vérifiez le nom NetBIOS attribué au domaine et modifiez-le si nécessaire</p>
        <label className="flex items-center gap-3">
          <span className="w-44">Le nom de domaine NetBIOS :</span>
          <WinInput
            value={netbios}
            onChange={(e) => setNetbios(e.target.value.toUpperCase())}
            data-testid="field-netbios"
          />
        </label>
      </div>
    )
  else if (step === 'paths')
    content = (
      <div className="flex flex-col gap-2">
        <p className="font-semibold">
          Spécifier l’emplacement de la base de données AD DS, des fichiers journaux et de SYSVOL
        </p>
        {[
          ['Dossier de la base de données :', 'C:\\Windows\\NTDS'],
          ['Dossier des fichiers journaux :', 'C:\\Windows\\NTDS'],
          ['Dossier SYSVOL :', 'C:\\Windows\\SYSVOL']
        ].map(([k, v]) => (
          <label key={k} className="flex items-center gap-3">
            <span className="w-48">{k}</span>
            <WinInput value={v} readOnly />
          </label>
        ))}
      </div>
    )
  else if (step === 'review')
    content = (
      <div className="flex flex-col gap-3">
        <p className="font-semibold">Passez en revue vos sélections :</p>
        <div className="selectable border border-[#d9d9d9] p-2 leading-relaxed" data-testid="promote-review">
          Configurez ce serveur en tant que premier contrôleur de domaine Active Directory d’une nouvelle
          forêt.
          <br />
          Le nouveau nom de domaine est « {domain.trim().toLowerCase()} ». C’est aussi le nom de la nouvelle
          forêt.
          <br />
          Nom NetBIOS du domaine : {nb}
          <br />
          Niveau fonctionnel de la forêt : 2016 · Niveau fonctionnel du domaine : 2016
          <br />
          Options supplémentaires : catalogue global Oui · serveur DNS {installDns ? 'Oui' : 'Non'} · créer
          une délégation DNS Non
        </div>
        <p>
          Ces paramètres peuvent être exportés vers un script PowerShell pour automatiser des installations
          supplémentaires.
        </p>
        <div>
          <WinButton onClick={() => setScript(!script)} data-testid="promote-script">
            {script ? 'Masquer le script' : 'Afficher le script'}
          </WinButton>
        </div>
        {script && (
          <pre className="selectable overflow-x-auto border border-[#d9d9d9] bg-[#012456] p-2 font-mono text-[11px] text-white">
            {scriptText}
          </pre>
        )}
      </div>
    )
  else if (step === 'prereq')
    content = (
      <div className="flex flex-col gap-3" data-testid="promote-prereq">
        {check?.ok ? (
          <>
            <p className="flex items-center gap-2 border border-[#9fd89f] bg-[#eaf8ea] p-2">
              <CircleCheck size={14} className="shrink-0 text-[#06b025]" />
              Toutes les vérifications de la configuration requise ont donné satisfaction. Cliquez sur «
              Installer » pour commencer l’installation.
            </p>
            {check.value.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[#9a6700]" /> {w}
              </p>
            ))}
            <p className="flex items-start gap-2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[#9a6700]" />
              Le serveur sera redémarré automatiquement à la fin de l’opération de promotion.
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 border border-[#f1a9a9] bg-[#fdecec] p-2">
            <CircleX size={14} className="mt-0.5 shrink-0 text-[#e81123]" />
            <span>
              La vérification de la configuration requise a échoué. Résolvez le problème, puis cliquez sur «
              Réexécuter la vérification ».
              <br />
              <b>{check && !check.ok ? check.error.message : ''}</b>
            </span>
          </p>
        )}
        <div>
          <WinButton onClick={() => setStep('prereq')}>
            Réexécuter la vérification de la configuration requise
          </WinButton>
        </div>
      </div>
    )
  else
    content = (
      <div className="flex flex-col gap-3">
        <p>Progression : {installing ? 'Promotion du serveur en contrôleur de domaine…' : ''}</p>
        <div className="h-3 border border-[#bcbcbc] bg-[#e6e6e6]">
          <div className="h-full w-4/5 animate-pulse bg-[#06b025]" />
        </div>
        <p>
          Création de la base de données AD DS, du dossier SYSVOL et de la zone DNS{' '}
          {domain.trim().toLowerCase()}…
        </p>
      </div>
    )

  return (
    <div className="relative h-full">
      <WizardFrame
        heading={HEADINGS[step] ?? ''}
        destination={device.name}
        steps={STEPS}
        current={step}
        reachable={(id) => !installing && visited.includes(id)}
        onStep={go}
        testId="promote-wizard"
        footer={
          <>
            <WinButton
              onClick={() => go(STEPS[index - 1]?.id ?? 'deploy')}
              disabled={index <= 0 || installing}
              data-testid="wiz-prev"
            >
              &lt; Précédent
            </WinButton>
            <WinButton onClick={next} disabled={step === 'prereq' || installing} data-testid="wiz-next">
              Suivant &gt;
            </WinButton>
            <WinButton
              primary
              onClick={install}
              disabled={step !== 'prereq' || !check?.ok || installing}
              data-testid="promote-install"
            >
              Installer
            </WinButton>
            <WinButton onClick={() => win?.close()} disabled={installing}>
              Annuler
            </WinButton>
          </>
        }
      >
        {error && (
          <p
            className="mb-3 flex items-start gap-2 border border-[#f1a9a9] bg-[#fdecec] p-2"
            data-testid="promote-error"
          >
            <CircleX size={14} className="mt-0.5 shrink-0 text-[#e81123]" /> {error}
          </p>
        )}
        {content}
      </WizardFrame>
      {signout && (
        <MessageBox
          title={device.name}
          icon="warning"
          message={
            'Vous allez être déconnecté.\nL’ordinateur va redémarrer, car les services de domaine Active Directory ont été installés.'
          }
          buttons={[{ label: 'Fermer', primary: true, onClick: finish, testId: 'promote-signout' }]}
        />
      )}
    </div>
  )
}
