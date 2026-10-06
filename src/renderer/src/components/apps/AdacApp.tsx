/**
 * Centre d'administration Active Directory, limité à la Corbeille : activation (irréversible)
 * et restauration des objets supprimés, à leur emplacement d'origine ou dans un autre conteneur.
 */
import { useState } from 'react'
import { Globe, Trash2 } from 'lucide-react'
import { command, containerDn, formatShortDate, type Domain, type HostDevice } from '@engine/index'
import { requireAdmin } from '../../lib/directory'
import { runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

const KIND_LABEL = {
  user: 'Utilisateur',
  group: 'Groupe',
  computer: 'Ordinateur',
  container: 'Unité d’organisation'
} as const

export function AdacApp({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const domain: Domain | undefined = device.host.domain ? lab.domains[device.host.domain] : undefined
  const [selected, setSelected] = useState('root')
  const [confirm, setConfirm] = useState(false)
  const [restoreTo, setRestoreTo] = useState<string | null>(null)
  if (!domain)
    return <div className="p-6 text-sm text-slate-500">Cet ordinateur n’est pas membre d’un domaine.</div>

  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: `${domain.name.split('.')[0]} (local)`,
      icon: Globe,
      iconClass: 'text-sky-600',
      children: [{ id: 'deleted', label: 'Deleted Objects', icon: Trash2 }]
    }
  ]

  const restore = (objectId: string, targetId?: string | null) =>
    requireAdmin(device) &&
    runCommandOk(
      targetId === undefined
        ? command('adds.restoreDeleted', domain.name, objectId)
        : command('adds.restoreDeleted', domain.name, objectId, targetId),
      { success: 'L’objet a été restauré.' }
    )

  const actions =
    selected === 'root' && !domain.recycleBin ? (
      <MmcAction onClick={() => setConfirm(true)} testId="adac-enable-recycle">
        Activer la Corbeille…
      </MmcAction>
    ) : null

  const content =
    selected === 'deleted' ? (
      domain.recycleBin ? (
        <MmcTable
          testId="adac-deleted"
          columns={['Nom', 'Type', 'Dernier parent connu', 'Supprimé le', '']}
          empty="Aucun objet supprimé."
          rows={domain.deletedObjects.map((d) => [
            d.obj.name,
            KIND_LABEL[d.kind],
            d.obj.parentId === null ? domain.name : containerDn(domain, d.obj.parentId),
            formatShortDate(d.deletedAt),
            <span key="actions" className="flex gap-3">
              <button
                type="button"
                className="text-sky-700 hover:underline"
                data-testid={`adac-restore-${d.obj.name}`}
                onClick={() => restore(d.obj.id)}
              >
                Restaurer
              </button>
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => setRestoreTo(d.obj.id)}
              >
                Restaurer dans…
              </button>
            </span>
          ])}
        />
      ) : (
        <div className="p-4 text-sm text-slate-600">
          La Corbeille Active Directory n’est pas activée : les objets supprimés ne peuvent pas être restaurés
          depuis cette console.
        </div>
      )
    ) : (
      <div className="p-4 text-sm text-slate-600" data-testid="adac-overview">
        <p>
          Domaine <b>{domain.name}</b> — Corbeille : <b>{domain.recycleBin ? 'activée' : 'désactivée'}</b>.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Une fois activée, la Corbeille conserve les objets supprimés avec leurs attributs et leurs
          appartenances aux groupes ; elle ne peut plus être désactivée.
        </p>
      </div>
    )

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={selected}
        onSelect={setSelected}
        actions={actions}
        testId="adac-console"
        treeWidth={220}
      >
        {content}
      </Mmc>
      {confirm && (
        <FormDialog
          title="Confirmation de l’activation de la Corbeille"
          description="Êtes-vous sûr de vouloir effectuer cette action ? Une fois la Corbeille activée, elle ne peut plus être désactivée."
          fields={[]}
          onSubmit={() =>
            requireAdmin(device) &&
            runCommandOk(command('adds.enableRecycleBin', domain.name), {
              success: 'La Corbeille Active Directory est activée.'
            })
          }
          onClose={() => setConfirm(false)}
          testId="adac-dialog"
        />
      )}
      {restoreTo && (
        <FormDialog
          title="Restaurer dans"
          fields={[
            {
              key: 'target',
              label: 'Conteneur de destination',
              type: 'select',
              options: domain.containers.map((c) => ({ value: c.id, label: containerDn(domain, c.id) }))
            }
          ]}
          onSubmit={(v) => restore(restoreTo, String(v['target']))}
          onClose={() => setRestoreTo(null)}
          testId="adac-dialog"
        />
      )}
    </div>
  )
}
