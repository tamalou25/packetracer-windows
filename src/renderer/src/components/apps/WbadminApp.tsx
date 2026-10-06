/**
 * Console Sauvegarde Windows Server (wbadmin.msc) : sauvegarde locale planifiée, sauvegarde
 * unique, versions disponibles et récupération de fichiers et dossiers.
 */
import { useState } from 'react'
import { Archive, HardDrive } from 'lucide-react'
import { backupOf, command, RECOVERY_OPTIONS, type ServerDevice } from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { FormDialog, type FormField, type FormValues } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'schedule' | 'once' | 'recover' | null

const RECOVERY_LABELS: Record<(typeof RECOVERY_OPTIONS)[number], string> = {
  CreateCopy: 'Créer des copies afin de disposer des deux versions',
  Overwrite: 'Remplacer les versions existantes par les versions récupérées',
  Skip: 'Ne pas récupérer les éléments qui existent déjà'
}

/** Liste « C:\Compta, C:\RH » saisie dans l'assistant. */
const itemsOf = (v: FormValues) =>
  String(v['items'] ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)

export function WbadminApp({ device }: { device: ServerDevice }) {
  const [selected, setSelected] = useState('local')
  const [dialog, setDialog] = useState<Dialog>(null)
  const backup = backupOf(device)
  const policy = backup?.policy ?? null
  const sets = backup?.sets ?? []

  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: 'Sauvegarde Windows Server (local)',
      icon: Archive,
      iconClass: 'text-emerald-700',
      children: [{ id: 'local', label: 'Sauvegarde locale', icon: HardDrive }]
    }
  ]

  const forms: Record<
    Exclude<Dialog, null>,
    { title: string; fields: FormField[]; submit: (v: FormValues) => boolean }
  > = {
    schedule: {
      title: 'Assistant Planification de sauvegarde',
      fields: [
        {
          key: 'items',
          label: 'Éléments à sauvegarder (séparés par des virgules)',
          placeholder: 'C:\\Compta',
          initial: policy?.items.join(', ') ?? ''
        },
        {
          key: 'systemState',
          label: 'État du système',
          type: 'checkbox',
          initial: policy?.systemState ?? false
        },
        {
          key: 'time',
          label: 'Heure de la sauvegarde (une fois par jour)',
          initial: policy?.time ?? '21:00'
        },
        {
          key: 'target',
          label: 'Destination (volume ou partage)',
          placeholder: 'E:',
          initial: policy?.target ?? ''
        }
      ],
      submit: (v) =>
        runCommandOk(
          command('backup.setPolicy', device.id, {
            items: itemsOf(v),
            systemState: v['systemState'] === true,
            target: String(v['target']),
            time: String(v['time'])
          }),
          { success: 'La sauvegarde planifiée a été configurée.' }
        )
    },
    once: {
      title: 'Assistant Sauvegarde unique',
      fields: [
        {
          key: 'mode',
          label: 'Options de sauvegarde',
          type: 'select',
          options: [
            ...(policy ? [{ value: 'policy', label: 'Options de sauvegarde planifiée' }] : []),
            { value: 'custom', label: 'Des options différentes' }
          ]
        },
        { key: 'items', label: 'Éléments (options différentes)', placeholder: 'C:\\Compta' },
        { key: 'systemState', label: 'État du système', type: 'checkbox' },
        { key: 'target', label: 'Destination (options différentes)', placeholder: 'E:' }
      ],
      submit: (v) => {
        const input =
          v['mode'] === 'policy'
            ? null
            : { items: itemsOf(v), systemState: v['systemState'] === true, target: String(v['target']) }
        const version = runCommand(command('backup.start', device.id, input), {
          success: 'L’opération de sauvegarde s’est terminée avec succès.'
        })
        return version !== undefined
      }
    },
    recover: {
      title: 'Assistant Récupération',
      fields: [
        {
          key: 'version',
          label: 'Date de la sauvegarde',
          type: 'select',
          options: [...sets].reverse().map((s) => ({ value: s.version, label: s.version }))
        },
        { key: 'item', label: 'Fichier ou dossier à récupérer', placeholder: 'C:\\Compta\\budget.xlsx' },
        {
          key: 'option',
          label: 'Lorsque l’Assistant trouve des éléments existants',
          type: 'select',
          options: RECOVERY_OPTIONS.map((o) => ({ value: o, label: RECOVERY_LABELS[o] }))
        }
      ],
      submit: (v) => {
        const count = runCommand(
          command(
            'backup.recover',
            device.id,
            String(v['version']),
            String(v['item']),
            String(v['option']) as (typeof RECOVERY_OPTIONS)[number]
          ),
          { success: 'La récupération est terminée.' }
        )
        return count !== undefined
      }
    }
  }

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('schedule')} testId="wb-schedule">
        Planification de sauvegarde…
      </MmcAction>
      <MmcAction onClick={() => setDialog('once')} testId="wb-once">
        Sauvegarde unique…
      </MmcAction>
      {sets.length > 0 && (
        <MmcAction onClick={() => setDialog('recover')} testId="wb-recover">
          Récupérer…
        </MmcAction>
      )}
      {policy && (
        <MmcAction onClick={() => runCommand(command('backup.removePolicy', device.id))} testId="wb-stop">
          Arrêter la sauvegarde…
        </MmcAction>
      )}
    </>
  )

  const content =
    selected === 'local' ? (
      <div className="flex h-full flex-col gap-3 p-3 text-xs text-slate-700">
        <section data-testid="wb-policy">
          <h3 className="mb-1 font-semibold">Sauvegarde planifiée</h3>
          {policy ? (
            <p>
              Tous les jours à {policy.time} vers {policy.target} :{' '}
              {[...policy.items, ...(policy.systemState ? ['État du système'] : [])].join(', ')}
            </p>
          ) : (
            <p className="text-slate-500">
              Aucune sauvegarde planifiée n’a été configurée pour cet ordinateur. Utilisez l’Assistant
              Planification de sauvegarde.
            </p>
          )}
        </section>
        <section className="min-h-0 flex-1">
          <h3 className="mb-1 font-semibold">Toutes les sauvegardes</h3>
          <MmcTable
            testId="wb-versions"
            columns={['Version', 'Destination', 'Éléments', 'Fichiers et dossiers']}
            empty="Aucune sauvegarde disponible."
            rows={[...sets]
              .reverse()
              .map((s) => [
                s.version,
                s.target,
                [...s.items, ...(s.systemState ? ['État du système'] : [])].join(', '),
                String(s.entries.length)
              ])}
          />
        </section>
      </div>
    ) : (
      <div className="p-4 text-sm text-slate-600">
        Sélectionnez « Sauvegarde locale » pour planifier ou exécuter une sauvegarde.
      </div>
    )

  const d = dialog ? forms[dialog] : null
  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={selected}
        onSelect={setSelected}
        actions={actions}
        testId="wb-console"
        treeWidth={240}
      >
        {content}
      </Mmc>
      {d && (
        <FormDialog
          title={d.title}
          fields={d.fields}
          onSubmit={d.submit}
          onClose={() => setDialog(null)}
          testId="wb-dialog"
        />
      )}
    </div>
  )
}
