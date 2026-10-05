/**
 * Gestionnaire de serveur simulé : tableau de bord, ajout de rôles, outils d'administration.
 */
import { useState } from 'react'
import { ChevronDown, Flag, Plus } from 'lucide-react'
import { effectiveIpv4, FEATURES, installFeatures, type ServerDevice } from '@engine/index'
import { runAction } from '../../lib/run'
import { useUiStore } from '../../store/ui'
import { useDesktopStore } from '../../store/desktop'
import { Button } from '../common/ui'
import { DESKTOP_APPS } from './apps'

/** Rôles proposés dans l'assistant d'ajout. */
const INSTALLABLE = FEATURES.filter((f) => f.role && !f.parent && f.name !== 'FileAndStorage-Services')

export function ServerManagerApp({ device }: { device: ServerDevice }) {
  const [wizard, setWizard] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const tools = DESKTOP_APPS.filter((a) => a.tool && a.available(device))
  const launch = (id: string) => useDesktopStore.getState().launch(device.id, id)
  const installedRoles = FEATURES.filter((f) => f.role && device.host.features.includes(f.name))
  const notifications: string[] = []
  if (device.host.features.includes('AD-Domain-Services') && !device.host.domain)
    notifications.push('Configuration post-déploiement : promouvoir ce serveur en contrôleur de domaine.')
  if (device.host.pendingReboot)
    notifications.push('Un redémarrage est nécessaire pour terminer la configuration.')

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-300 bg-white px-4 py-2">
        <span className="text-base font-semibold text-slate-700">Gestionnaire de serveur</span>
        <span className="text-slate-400">›</span>
        <span className="text-sm text-slate-600">Tableau de bord</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            title={notifications.join('\n') || 'Aucune notification'}
            className={notifications.length ? 'text-amber-500' : 'text-slate-300'}
          >
            <Flag size={16} />
          </span>
          <Button onClick={() => setWizard(true)} data-testid="add-roles">
            <Plus size={14} /> Gérer : ajouter des rôles
          </Button>
          <div className="relative">
            <Button onClick={() => setToolsOpen(!toolsOpen)} data-testid="sm-tools">
              Outils <ChevronDown size={14} />
            </Button>
            {toolsOpen && (
              <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {tools.length === 0 && (
                  <div className="px-3 py-1.5 text-xs text-slate-400">Aucun outil : installez un rôle.</div>
                )}
                {tools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-sky-50"
                    onClick={() => {
                      setToolsOpen(false)
                      launch(t.id)
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-4">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-sky-700">Serveur local</h3>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1 text-xs">
            <dt className="text-slate-500">Nom de l’ordinateur</dt>
            <dd className="font-medium">{device.name}</dd>
            <dt className="text-slate-500">{device.host.domain ? 'Domaine' : 'Groupe de travail'}</dt>
            <dd className="font-medium">{device.host.domain ?? device.host.workgroup}</dd>
            {device.interfaces.map((i) => {
              const eff = effectiveIpv4(i)
              return [
                <dt key={`${i.id}-l`} className="text-slate-500">
                  {i.name}
                </dt>,
                <dd key={`${i.id}-v`} className="font-medium">
                  {!eff
                    ? 'Non connecté'
                    : eff.source === 'static'
                      ? eff.address
                      : `${eff.address} (adresse IPv4 attribuée par DHCP)`}
                </dd>
              ]
            })}
          </dl>
        </section>
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-sky-700">Rôles et groupes de serveurs</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {installedRoles.map((r) => (
              <li key={r.name} className="rounded bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                {r.displayName}
              </li>
            ))}
          </ul>
        </section>
        {notifications.length > 0 && (
          <section className="col-span-2 rounded border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            {notifications.map((n) => (
              <p key={n}>⚠ {n}</p>
            ))}
            {device.host.features.includes('AD-Domain-Services') && !device.host.domain && (
              <p className="mt-1 text-amber-700">
                Utilisez « Promouvoir ce serveur en contrôleur de domaine » (outil AD DS) ou
                Install-ADDSForest dans PowerShell.
              </p>
            )}
          </section>
        )}
      </div>
      {wizard && <AddRolesDialog device={device} onClose={() => setWizard(false)} />}
    </div>
  )
}

function AddRolesDialog({ device, onClose }: { device: ServerDevice; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [tools, setTools] = useState(true)
  const install = () => {
    const result = runAction((lab) =>
      installFeatures(lab, device.id, selected, { includeManagementTools: tools })
    )
    if (result) {
      useUiStore
        .getState()
        .notify(
          'success',
          `Installation réussie sur ${device.name} : ${result.installed.map((f) => f.displayName).join(', ') || 'aucune modification'}.`
        )
      onClose()
    }
  }
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/30">
      <div className="w-[460px] rounded-lg bg-white p-5 shadow-xl" data-testid="add-roles-dialog">
        <h3 className="mb-1 text-base font-semibold">Assistant Ajout de rôles et de fonctionnalités</h3>
        <p className="mb-3 text-xs text-slate-500">
          Sélectionnez un ou plusieurs rôles à installer sur {device.name}.
        </p>
        <ul className="mb-3 flex flex-col gap-1">
          {INSTALLABLE.map((f) => {
            const installed = device.host.features.includes(f.name)
            return (
              <li key={f.name}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={installed}
                    checked={installed || selected.includes(f.name)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? [...selected, f.name] : selected.filter((n) => n !== f.name)
                      )
                    }
                    data-testid={`role-${f.name}`}
                  />
                  {f.displayName}
                  {installed && <span className="text-xs text-slate-400">(installé)</span>}
                </label>
              </li>
            )
          })}
        </ul>
        <label className="mb-4 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} />
          Inclure les outils de gestion
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            disabled={selected.length === 0}
            onClick={install}
            data-testid="install-roles"
          >
            Installer
          </Button>
        </div>
      </div>
    </div>
  )
}
