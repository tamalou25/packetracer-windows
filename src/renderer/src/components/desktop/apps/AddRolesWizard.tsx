/**
 * Assistant Ajout (ou Suppression) de rôles et de fonctionnalités du Gestionnaire de serveur :
 * type d'installation, serveur de destination, rôles (fonctionnalités requises proposées),
 * fonctionnalités, pages d'information des rôles, confirmation, résultats et configuration
 * post-déploiement (promotion AD DS, configuration DHCP).
 */
import { useEffect, useState } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import {
  effectiveIpv4,
  featureInfo,
  FEATURES,
  installFeatures,
  uninstallFeatures,
  type FeatureInfo,
  type ServerDevice
} from '@engine/index'
import { launch } from '../../../lib/desktop'
import { runAction } from '../../../lib/run'
import { useAppWindow } from '../shell/AppWindow'
import { WinButton } from '../shell/classic'
import { NoteList, WizardFrame, type WizardStep } from './Wizard'

const ROLE_INFO: Record<string, { title: string; text: string; notes: string[] }> = {
  'AD-Domain-Services': {
    title: 'Services de domaine Active Directory',
    text: 'Les services de domaine Active Directory (AD DS) stockent des informations sur les utilisateurs, les ordinateurs et les autres périphériques du réseau. AD DS permet aux administrateurs de gérer ces informations de façon sécurisée et facilite le partage des ressources et la collaboration entre les utilisateurs.',
    notes: [
      'Pour que les utilisateurs puissent ouvrir une session sur le réseau même en cas de panne d’un serveur, installez au moins deux contrôleurs de domaine par domaine.',
      'Les services AD DS nécessitent qu’un serveur DNS soit installé sur le réseau. Si aucun serveur DNS n’est installé, vous serez invité à installer le rôle Serveur DNS sur cet ordinateur.',
      'Après l’installation du rôle, promouvez ce serveur en contrôleur de domaine (configuration post-déploiement).'
    ]
  },
  DHCP: {
    title: 'Serveur DHCP',
    text: 'Le protocole DHCP (Dynamic Host Configuration Protocol) vous permet de configurer, de gérer et de fournir de manière centralisée des adresses IP temporaires et des informations associées aux ordinateurs clients.',
    notes: [
      'Vous devez configurer au moins une adresse IP statique sur cet ordinateur.',
      'Avant d’installer le serveur DHCP, planifiez les sous-réseaux, les étendues et les exclusions. Stockez le plan dans un endroit sûr pour vous y référer ultérieurement.',
      'Un serveur DHCP membre d’un domaine doit être autorisé dans Active Directory pour distribuer des adresses.'
    ]
  },
  DNS: {
    title: 'Serveur DNS',
    text: 'Le système DNS (Domain Name System) fournit une méthode standard pour associer des noms à des adresses Internet numériques. Les utilisateurs peuvent ainsi faire référence aux ordinateurs du réseau à l’aide de noms faciles à retenir au lieu de longues suites de chiffres.',
    notes: [
      'Le serveur DNS peut être intégré aux services de domaine Active Directory : les zones sont alors stockées et répliquées avec l’annuaire.',
      'Si vous installez les services AD DS, l’Assistant Configuration des services de domaine Active Directory peut installer et configurer automatiquement le serveur DNS.'
    ]
  }
}

type Mode = 'install' | 'remove'

/** Fonctionnalités ajoutées automatiquement avec un rôle (dépendances et outils de gestion). */
function companions(info: FeatureInfo, tools: boolean): string[] {
  return [...(info.requires ?? []), ...(tools ? (info.managementTools ?? []) : [])]
}

export function AddRolesWizard({ device, mode = 'install' }: { device: ServerDevice; mode?: Mode }) {
  const win = useAppWindow()
  const installed = device.host.features
  const [step, setStep] = useState('before')
  const [visited, setVisited] = useState<string[]>(['before'])
  const [selected, setSelected] = useState<string[]>(mode === 'remove' ? [...installed] : [])
  const [prompt, setPrompt] = useState<{ role: FeatureInfo; tools: boolean } | null>(null)
  const [restartAuto, setRestartAuto] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<FeatureInfo[]>([])

  const roles = FEATURES.filter((f) => f.role && !f.parent)
  const features = FEATURES.filter((f) => !f.role)
  const added = mode === 'install' ? selected.filter((n) => !installed.includes(n)) : []
  const removed = mode === 'remove' ? installed.filter((n) => !selected.includes(n)) : []
  const rolePages = added.filter((n) => ROLE_INFO[n])
  const hasStaticIp = device.interfaces.some((i) => effectiveIpv4(i)?.source === 'static')

  const steps: WizardStep[] = [
    { id: 'before', label: 'Avant de commencer' },
    ...(mode === 'install' ? [{ id: 'type', label: 'Type d’installation' }] : []),
    { id: 'server', label: 'Sélection du serveur' },
    { id: 'roles', label: 'Rôles de serveurs' },
    { id: 'features', label: 'Fonctionnalités' },
    ...rolePages.map((r) => ({
      id: `info:${r}`,
      label: r === 'AD-Domain-Services' ? 'AD DS' : (featureInfo(r)?.displayName ?? r)
    })),
    { id: 'confirm', label: 'Confirmation' },
    { id: 'results', label: 'Résultats' }
  ]
  const index = steps.findIndex((s) => s.id === step)
  const go = (id: string) => {
    setStep(id)
    setVisited((v) => (v.includes(id) ? v : [...v, id]))
  }
  const next = () => {
    const target = steps[index + 1]
    if (target) go(target.id)
  }
  const prev = () => {
    const target = steps[index - 1]
    if (target) setStep(target.id)
  }

  // Animation de la barre de progression, puis résultat
  useEffect(() => {
    if (phase !== 'running') return
    const timer = window.setInterval(() => setProgress((p) => Math.min(100, p + 20)), 120)
    return () => window.clearInterval(timer)
  }, [phase])
  useEffect(() => {
    if (phase === 'running' && progress >= 100) setPhase('done')
  }, [phase, progress])

  const toggleRole = (role: FeatureInfo, checked: boolean) => {
    if (mode === 'remove') {
      setSelected(checked ? [...selected, role.name] : selected.filter((n) => n !== role.name))
      return
    }
    if (!checked) {
      setSelected(selected.filter((n) => n !== role.name))
      return
    }
    // Fonctionnalités requises : l'assistant demande confirmation, comme le vrai
    const extra = companions(role, true).filter((n) => !installed.includes(n))
    if (extra.length > 0) setPrompt({ role, tools: true })
    else setSelected([...selected, role.name])
  }

  const confirmCompanions = () => {
    if (!prompt) return
    const extra = companions(prompt.role, prompt.tools).filter((n) => !installed.includes(n))
    setSelected([...new Set([...selected, prompt.role.name, ...extra])])
    setPrompt(null)
  }

  const install = () => {
    const value =
      mode === 'install'
        ? runAction((lab) => installFeatures(lab, device.id, added, { includeManagementTools: false }))
        : runAction((lab) => uninstallFeatures(lab, device.id, removed))
    if (!value) return
    setResult(value.installed)
    go('results')
    setProgress(0)
    setPhase('running')
  }

  const checkbox = (info: FeatureInfo, indent = 0) => {
    const isInstalled = installed.includes(info.name)
    const checked = selected.includes(info.name) || (mode === 'install' && isInstalled)
    const locked =
      mode === 'install'
        ? isInstalled
        : !isInstalled || info.name === 'PowerShell' || info.name === 'FileAndStorage-Services'
    return (
      <label
        key={info.name}
        className={`flex items-center gap-2 py-0.5 ${locked ? 'text-[#6d6d6d]' : ''}`}
        style={{ paddingLeft: indent * 18 }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) =>
            info.role
              ? toggleRole(info, e.target.checked)
              : setSelected(
                  e.target.checked ? [...selected, info.name] : selected.filter((n) => n !== info.name)
                )
          }
          data-testid={info.role ? `role-${info.name}` : `feature-${info.name}`}
        />
        {info.displayName}
        {isInstalled && mode === 'install' && <span className="text-[#6d6d6d]">(Installé)</span>}
      </label>
    )
  }

  const childrenOf = (name: string) => FEATURES.filter((f) => f.parent === name)

  let content
  if (step === 'before')
    content = (
      <div className="flex flex-col gap-3">
        <p>
          {mode === 'install'
            ? 'Cet Assistant permet d’installer des rôles, des services de rôle ou des fonctionnalités. Vous devez déterminer les rôles, services de rôle ou fonctionnalités à installer en fonction des besoins informatiques de votre organisation, tels que le partage de documents ou l’hébergement d’un site Web.'
            : 'Cet Assistant permet de supprimer des rôles, des services de rôle ou des fonctionnalités du serveur sélectionné.'}
        </p>
        <p>Avant de continuer, vérifiez que les tâches suivantes ont été effectuées :</p>
        <NoteList
          items={[
            'Le compte d’administrateur possède un mot de passe fort',
            'Les paramètres réseau, comme les adresses IP statiques, sont configurés',
            'Les mises à jour de sécurité les plus récentes sont installées'
          ]}
        />
      </div>
    )
  else if (step === 'type')
    content = (
      <div className="flex flex-col gap-3">
        <p>
          Sélectionnez le type d’installation. Vous pouvez installer des rôles et des fonctionnalités sur un
          ordinateur physique ou virtuel en fonctionnement.
        </p>
        <label className="flex items-start gap-2">
          <input type="radio" checked readOnly />
          <span>
            <b>Installation basée sur un rôle ou une fonctionnalité</b>
            <br />
            Configurez un serveur unique en ajoutant des rôles, des services de rôle et des fonctionnalités.
          </span>
        </label>
        <label className="flex items-start gap-2 text-[#6d6d6d]">
          <input type="radio" disabled />
          <span>
            <b>Installation des services Bureau à distance</b>
            <br />
            Non disponible dans le système simulé.
          </span>
        </label>
      </div>
    )
  else if (step === 'server')
    content = (
      <div className="flex flex-col gap-3">
        <p>
          Sélectionnez le serveur ou le disque dur virtuel sur lequel installer ou supprimer des rôles et des
          fonctionnalités.
        </p>
        <label className="flex items-center gap-2">
          <input type="radio" checked readOnly /> Sélectionner un serveur du pool de serveurs
        </label>
        <table className="w-full border border-[#d9d9d9]">
          <thead className="bg-[#f5f5f5] text-left">
            <tr>
              <th className="px-2 py-1 font-normal">Nom</th>
              <th className="px-2 py-1 font-normal">Adresse IP</th>
              <th className="px-2 py-1 font-normal">Système d’exploitation</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[#cce8ff]">
              <td className="px-2 py-1">
                {device.host.domain ? `${device.name}.${device.host.domain}` : device.name}
              </td>
              <td className="px-2 py-1">
                {device.interfaces
                  .map((i) => effectiveIpv4(i)?.address)
                  .filter(Boolean)
                  .join(', ') || '—'}
              </td>
              <td className="px-2 py-1">Système serveur (simulé) Standard</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  else if (step === 'roles')
    content = (
      <div className="flex flex-col gap-2">
        <p>
          {mode === 'install'
            ? 'Sélectionnez un ou plusieurs rôles à installer sur le serveur sélectionné.'
            : 'Pour supprimer un ou plusieurs rôles installés du serveur sélectionné, désactivez les cases correspondantes.'}
        </p>
        <div className="font-semibold">Rôles</div>
        <div className="border border-[#d9d9d9] p-2">
          {roles.map((r) => (
            <div key={r.name}>
              {checkbox(r)}
              {childrenOf(r.name).map((c) => checkbox(c, 1))}
            </div>
          ))}
        </div>
      </div>
    )
  else if (step === 'features')
    content = (
      <div className="flex flex-col gap-2">
        <p>
          Sélectionnez une ou plusieurs fonctionnalités à {mode === 'install' ? 'installer' : 'supprimer'}.
        </p>
        <div className="font-semibold">Fonctionnalités</div>
        <div className="border border-[#d9d9d9] p-2">
          {features
            .filter((f) => !f.parent)
            .map((f) => (
              <div key={f.name}>
                {checkbox(f)}
                {childrenOf(f.name).map((c) => checkbox(c, 1))}
              </div>
            ))}
        </div>
      </div>
    )
  else if (step.startsWith('info:')) {
    const name = step.slice(5)
    const info = ROLE_INFO[name]
    content = info && (
      <div className="flex flex-col gap-3">
        <p>{info.text}</p>
        <div className="font-semibold">À noter :</div>
        <NoteList items={info.notes} />
        {(name === 'DHCP' || name === 'DNS') && !hasStaticIp && (
          <p className="flex items-start gap-2 border border-[#e3c35e] bg-[#fff8db] p-2">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[#9a6700]" />
            Aucune adresse IP statique n’a été trouvée sur cet ordinateur. Configurez une adresse statique
            pour un fonctionnement fiable du serveur.
          </p>
        )}
      </div>
    )
  } else if (step === 'confirm') {
    const list = mode === 'install' ? added : removed
    content = (
      <div className="flex flex-col gap-3">
        <p>
          Pour {mode === 'install' ? 'installer' : 'supprimer'} les rôles, services de rôle ou fonctionnalités
          suivants sur le serveur sélectionné, cliquez sur {mode === 'install' ? 'Installer' : 'Supprimer'}.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={restartAuto} onChange={(e) => setRestartAuto(e.target.checked)} />
          Redémarrer automatiquement le serveur de destination, si nécessaire
        </label>
        <ul className="border border-[#d9d9d9] p-2" data-testid="wiz-confirm-list">
          {list.length === 0 && <li className="text-[#6d6d6d]">Aucune modification sélectionnée.</li>}
          {list.map((n) => {
            const info = featureInfo(n)
            return (
              <li key={n} style={{ paddingLeft: info?.parent ? 18 : 0 }}>
                {info?.displayName ?? n}
              </li>
            )
          })}
        </ul>
      </div>
    )
  } else if (step === 'results') {
    const isMember = !!device.host.domain
    content = (
      <div className="flex flex-col gap-3" data-testid="wiz-results">
        <p>Afficher la progression de l’installation</p>
        <div className="h-3 border border-[#bcbcbc] bg-[#e6e6e6]">
          <div className="h-full bg-[#06b025] transition-all" style={{ width: `${progress}%` }} />
        </div>
        {phase === 'done' ? (
          <>
            <p className="flex items-center gap-2">
              <CircleCheck size={14} className="text-[#06b025]" />
              {mode === 'install' ? 'Installation' : 'Suppression'} réussie sur {device.name}.
            </p>
            <ul className="border border-[#d9d9d9] p-2">
              {result.map((f) => (
                <li key={f.name}>{f.displayName}</li>
              ))}
            </ul>
            {mode === 'install' && result.some((f) => f.name === 'AD-Domain-Services') && !isMember && (
              <div className="border border-[#e3c35e] bg-[#fff8db] p-2">
                <p className="mb-1">
                  Configuration requise. Des étapes supplémentaires sont requises pour faire de cet ordinateur
                  un contrôleur de domaine.
                </p>
                <button
                  type="button"
                  className="text-[#0066cc] hover:underline"
                  onClick={() => launch(device.id, 'adpromote')}
                  data-testid="promote-dc"
                >
                  Promouvoir ce serveur en contrôleur de domaine
                </button>
              </div>
            )}
            {mode === 'install' && result.some((f) => f.name === 'DHCP') && (
              <div className="border border-[#e3c35e] bg-[#fff8db] p-2">
                <p className="mb-1">Configuration requise : terminez la configuration du serveur DHCP.</p>
                <button
                  type="button"
                  className="text-[#0066cc] hover:underline"
                  onClick={() => launch(device.id, 'dhcppost')}
                  data-testid="dhcp-postinstall"
                >
                  Terminer la configuration DHCP
                </button>
              </div>
            )}
          </>
        ) : (
          <p>Démarrage de l’installation…</p>
        )}
      </div>
    )
  }

  const heading =
    step === 'results'
      ? 'Progression de l’installation'
      : step === 'confirm'
        ? 'Confirmer les sélections d’installation'
        : step === 'roles'
          ? mode === 'install'
            ? 'Sélectionner des rôles de serveurs'
            : 'Supprimer des rôles de serveurs'
          : step === 'features'
            ? 'Sélectionner des fonctionnalités'
            : step === 'server'
              ? 'Sélectionner le serveur de destination'
              : step === 'type'
                ? 'Sélectionner le type d’installation'
                : step.startsWith('info:')
                  ? (ROLE_INFO[step.slice(5)]?.title ?? '')
                  : 'Avant de commencer'

  return (
    <div className="relative h-full">
      <WizardFrame
        heading={heading}
        destination={device.host.domain ? `${device.name}.${device.host.domain}` : device.name}
        steps={steps}
        current={step}
        reachable={(id) => step !== 'results' && visited.includes(id)}
        onStep={go}
        testId={mode === 'install' ? 'add-roles-wizard' : 'remove-roles-wizard'}
        footer={
          step === 'results' ? (
            <WinButton primary onClick={() => win?.close()} data-testid="wiz-close">
              Fermer
            </WinButton>
          ) : (
            <>
              <WinButton onClick={prev} disabled={index <= 0} data-testid="wiz-prev">
                &lt; Précédent
              </WinButton>
              <WinButton onClick={next} disabled={step === 'confirm'} data-testid="wiz-next">
                Suivant &gt;
              </WinButton>
              <WinButton
                primary
                onClick={install}
                disabled={
                  step !== 'confirm' || (mode === 'install' ? added.length === 0 : removed.length === 0)
                }
                data-testid="install-roles"
              >
                {mode === 'install' ? 'Installer' : 'Supprimer'}
              </WinButton>
              <WinButton onClick={() => win?.close()} data-testid="wiz-cancel">
                Annuler
              </WinButton>
            </>
          )
        }
      >
        {content}
      </WizardFrame>
      {prompt && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
          <div
            className="w-[440px] border border-[#8a8a8a] bg-white text-xs text-black shadow-xl"
            data-testid="required-features"
          >
            <div className="px-3 py-2">Assistant Ajout de rôles et de fonctionnalités</div>
            <div className="flex flex-col gap-2 px-4 pb-3">
              <p className="text-sm text-[#1e3287]">
                Ajouter les fonctionnalités requises pour {prompt.role.displayName} ?
              </p>
              <p>
                Les outils suivants sont requis pour gérer cette fonctionnalité, mais ils ne doivent pas
                obligatoirement être installés sur le même serveur.
              </p>
              <ul className="ml-4 list-disc border border-[#d9d9d9] py-1 pl-4">
                {companions(prompt.role, prompt.tools)
                  .filter((n) => !installed.includes(n))
                  .map((n) => (
                    <li key={n}>{featureInfo(n)?.displayName ?? n}</li>
                  ))}
              </ul>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={prompt.tools}
                  onChange={(e) => setPrompt({ ...prompt, tools: e.target.checked })}
                />
                Inclure les outils de gestion (si applicable)
              </label>
            </div>
            <div className="flex justify-end gap-2 bg-[#f0f0f0] px-3 py-2.5">
              <WinButton primary onClick={confirmCompanions} data-testid="add-required">
                Ajouter des fonctionnalités
              </WinButton>
              <WinButton onClick={() => setPrompt(null)}>Annuler</WinButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
