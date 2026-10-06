/**
 * Gestionnaire DNS : zones de recherche directes/inverses, enregistrements, redirecteurs.
 */
import { useState } from 'react'
import { ArrowRightLeft, BookOpen, FolderTree, Server } from 'lucide-react'
import { isDomainController, type DnsZone, type ServerDevice, command } from '@engine/index'
import { runCommand } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { Button, inputClass } from '../common/ui'
import { FormDialog, type FormField, type FormValues } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'zone' | 'A' | 'CNAME' | 'PTR' | null

export function DnsApp({ device }: { device: ServerDevice }) {
  const dns = device.services.dns
  const lab = useLabStore((s) => s.lab)
  const [selected, setSelected] = useState('server')
  const [dialog, setDialog] = useState<Dialog>(null)
  if (!dns) return <div className="p-6 text-sm text-slate-500">Le rôle Serveur DNS n’est pas installé.</div>

  const zoneNode = (z: DnsZone): MmcNode => ({
    id: `zone:${z.name}`,
    label: z.name,
    icon: BookOpen,
    iconClass: z.adIntegrated ? 'text-indigo-600' : 'text-amber-600'
  })
  const nodes: MmcNode[] = [
    {
      id: 'server',
      label: device.name,
      icon: Server,
      iconClass: 'text-emerald-600',
      children: [
        {
          id: 'forward',
          label: 'Zones de recherche directes',
          icon: FolderTree,
          children: dns.zones.filter((z) => !z.reverse).map(zoneNode)
        },
        {
          id: 'reverse',
          label: 'Zones de recherche inversées',
          icon: FolderTree,
          children: dns.zones.filter((z) => z.reverse).map(zoneNode)
        },
        { id: 'forwarders', label: 'Redirecteurs', icon: ArrowRightLeft }
      ]
    }
  ]
  const zone = selected.startsWith('zone:') ? dns.zones.find((z) => z.name === selected.slice(5)) : undefined
  const notifyWarnings = (warnings: string[]) =>
    warnings.forEach((w) => useUiStore.getState().notify('warning', w))

  const submitZone = (v: FormValues): boolean => {
    const reverse = v['kind'] === 'reverse'
    const name = runCommand(
      command('dns.addPrimaryZone', device.id, {
        ...(reverse ? { networkId: String(v['value']) } : { name: String(v['value']) }),
        adIntegrated: v['ad'] === true,
        dynamicUpdate: String(v['dynamic']) as 'None' | 'Secure' | 'NonsecureAndSecure'
      })
    )
    if (name) setSelected(`zone:${name}`)
    return name !== undefined
  }

  const submitRecord =
    (type: 'A' | 'CNAME' | 'PTR') =>
    (v: FormValues): boolean => {
      if (!zone) return false
      const result = runCommand(
        command('dns.addRecord', device.id, zone.name, {
          name: String(v['name']),
          type,
          data: String(v['data']),
          createPtr: v['ptr'] === true
        })
      )
      if (result) notifyWarnings(result.warnings)
      return result !== undefined
    }

  const dialogs: Record<
    Exclude<Dialog, null>,
    { title: string; fields: FormField[]; submit: (v: FormValues) => boolean }
  > = {
    zone: {
      title: 'Assistant Nouvelle zone',
      fields: [
        {
          key: 'kind',
          label: 'Type de recherche',
          type: 'select',
          options: [
            { value: 'forward', label: 'Zone de recherche directe' },
            { value: 'reverse', label: 'Zone de recherche inversée' }
          ]
        },
        {
          key: 'value',
          label: 'Nom de la zone (directe) ou ID réseau (inverse : 192.168.1.0/24)',
          placeholder: 'lab.local'
        },
        ...(isDomainController(lab, device.id)
          ? [
              {
                key: 'ad',
                label: 'Enregistrer la zone dans Active Directory',
                type: 'checkbox' as const,
                initial: true
              }
            ]
          : []),
        {
          key: 'dynamic',
          label: 'Mises à jour dynamiques',
          type: 'select',
          options: [
            { value: 'None', label: 'Ne pas autoriser les mises à jour dynamiques' },
            ...(isDomainController(lab, device.id)
              ? [{ value: 'Secure', label: 'N’autoriser que les mises à jour sécurisées' }]
              : []),
            {
              value: 'NonsecureAndSecure',
              label: 'Autoriser à la fois les mises à jour non sécurisées et sécurisées'
            }
          ]
        }
      ],
      submit: submitZone
    },
    A: {
      title: 'Nouvel hôte',
      fields: [
        { key: 'name', label: 'Nom (utilise le domaine parent si ce champ est vide)' },
        { key: 'data', label: 'Adresse IP', placeholder: '192.168.1.10' },
        { key: 'ptr', label: 'Créer un pointeur d’enregistrement PTR associé', type: 'checkbox' }
      ],
      submit: submitRecord('A')
    },
    CNAME: {
      title: 'Nouvel alias (CNAME)',
      fields: [
        { key: 'name', label: 'Nom de l’alias', placeholder: 'www' },
        {
          key: 'data',
          label: 'Nom de domaine complet (FQDN) pour l’hôte de destination',
          placeholder: 'srv1.lab.local'
        }
      ],
      submit: submitRecord('CNAME')
    },
    PTR: {
      title: 'Nouveau pointeur (PTR)',
      fields: [
        { key: 'name', label: 'Dernier(s) octet(s) de l’adresse IP', placeholder: '10' },
        { key: 'data', label: 'Nom d’hôte', placeholder: 'pc1.lab.local' }
      ],
      submit: submitRecord('PTR')
    }
  }

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('zone')} testId="dns-new-zone">
        Nouvelle zone…
      </MmcAction>
      {zone && !zone.reverse && (
        <>
          <MmcAction onClick={() => setDialog('A')} testId="dns-new-a">
            Nouvel hôte (A)…
          </MmcAction>
          <MmcAction onClick={() => setDialog('CNAME')}>Nouvel alias (CNAME)…</MmcAction>
        </>
      )}
      {zone && zone.reverse && (
        <MmcAction onClick={() => setDialog('PTR')}>Nouveau pointeur (PTR)…</MmcAction>
      )}
      {zone && (
        <MmcAction
          danger
          onClick={() => {
            if (runCommand(command('dns.removeZone', device.id, zone.name)) !== undefined)
              setSelected('server')
          }}
        >
          Supprimer la zone
        </MmcAction>
      )}
    </>
  )

  const d = dialog ? dialogs[dialog] : null
  return (
    <div className="relative h-full">
      <Mmc nodes={nodes} selected={selected} onSelect={setSelected} actions={actions} testId="dns-console">
        {zone ? (
          <MmcTable
            testId="dns-records"
            columns={['Nom', 'Type', 'Données', '']}
            empty="Aucun enregistrement."
            rows={zone.records.map((r) => [
              r.name === '@' ? '(identique au dossier parent)' : r.name,
              {
                A: 'Hôte (A)',
                CNAME: 'Alias (CNAME)',
                PTR: 'Pointeur (PTR)',
                NS: 'Serveur de noms (NS)',
                SOA: 'Source de nom (SOA)',
                SRV: 'Emplacement du service (SRV)'
              }[r.type],
              r.data,
              r.type === 'SOA' || r.type === 'NS' ? (
                ''
              ) : (
                <button
                  key="del"
                  type="button"
                  className="text-red-600 hover:underline"
                  onClick={() =>
                    runCommand(command('dns.removeRecord', device.id, zone.name, r.name, r.type, r.data))
                  }
                >
                  Supprimer
                </button>
              )
            ])}
          />
        ) : selected === 'forwarders' ? (
          <ForwardersView device={device} forwarders={dns.forwarders} />
        ) : (
          <div className="p-4 text-sm text-slate-600">
            <p>
              Serveur DNS <b>{device.name}</b> — {dns.zones.length} zone(s).
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Sélectionnez une zone pour afficher ses enregistrements.
            </p>
          </div>
        )}
      </Mmc>
      {d && (
        <FormDialog
          title={d.title}
          fields={d.fields}
          onSubmit={d.submit}
          onClose={() => setDialog(null)}
          submitLabel="Ajouter"
          testId="dns-dialog"
        />
      )}
    </div>
  )
}

function ForwardersView({ device, forwarders }: { device: ServerDevice; forwarders: string[] }) {
  const [value, setValue] = useState(forwarders.join(', '))
  return (
    <div className="flex max-w-md flex-col gap-2 p-4 text-sm">
      <p className="text-xs text-slate-600">
        Les redirecteurs résolvent les requêtes DNS pour les noms dont ce serveur n’a pas la zone (Internet).
      </p>
      <input
        className={inputClass}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="8.8.8.8"
      />
      <div>
        <Button
          variant="primary"
          onClick={() =>
            runCommand(command('dns.setForwarders', device.id, value.split(/[,; ]+/)), {
              success: 'Redirecteurs enregistrés.'
            })
          }
        >
          Appliquer
        </Button>
      </div>
    </div>
  )
}
