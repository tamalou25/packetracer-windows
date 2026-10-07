/**
 * Console Serveur NPS (nps.msc) : clients RADIUS, stratégies réseau (condition « Groupes
 * Windows », accès accordé ou refusé, ordre de traitement).
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, FileLock2, Monitor, ShieldCheck } from 'lucide-react'
import { command, npsOf, policyCondition, type ServerDevice } from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'client' | 'policy' | null

const rowButton = 'rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:bg-slate-100'

export function NpsApp({ device }: { device: ServerDevice }) {
  const [node, setNode] = useState('root')
  const [dialog, setDialog] = useState<Dialog>(null)
  const lab = useLabStore((s) => s.lab)
  const domain = device.host.domain ? lab.domains[device.host.domain] : undefined
  const nps = npsOf(device)

  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: 'NPS (Local)',
      icon: ShieldCheck,
      iconClass: 'text-emerald-700',
      children: [
        {
          id: 'radius',
          label: 'Clients et serveurs RADIUS',
          icon: Monitor,
          children: [{ id: 'clients', label: 'Clients RADIUS', icon: Monitor }]
        },
        {
          id: 'policies',
          label: 'Stratégies',
          icon: FileLock2,
          children: [{ id: 'network', label: 'Stratégies réseau', icon: FileLock2 }]
        }
      ]
    }
  ]

  const actions = (
    <>
      {(node === 'clients' || node === 'radius') && (
        <MmcAction onClick={() => setDialog('client')} testId="nps-new-client">
          Nouveau client RADIUS…
        </MmcAction>
      )}
      {(node === 'network' || node === 'policies') && (
        <MmcAction onClick={() => setDialog('policy')} testId="nps-new-policy">
          Nouvelle stratégie réseau…
        </MmcAction>
      )}
    </>
  )

  let content
  if (node === 'clients') {
    content = (
      <MmcTable
        testId="nps-clients"
        columns={['Nom convivial', 'Adresse IP', 'Fabricant du périphérique', 'Actions']}
        empty="Aucun client RADIUS n’est configuré."
        rows={(nps?.radiusClients ?? []).map((c) => [
          c.name,
          c.address,
          'RADIUS Standard',
          <button
            key="del"
            type="button"
            className={rowButton}
            onClick={() => runCommand(command('nps.removeClient', device.id, c.name))}
          >
            Supprimer
          </button>
        ])}
      />
    )
  } else if (node === 'network') {
    const policies = nps?.policies ?? []
    content = (
      <MmcTable
        testId="nps-policies"
        columns={[
          'Nom de la stratégie',
          'État',
          'Ordre de traitement',
          'Type d’accès',
          'Conditions',
          'Actions'
        ]}
        empty="Aucune stratégie réseau."
        rows={policies.map((p, i) => [
          p.name,
          p.enabled ? 'Activé' : 'Désactivé',
          String(i + 1),
          p.access === 'Grant' ? 'Accorder l’accès' : 'Refuser l’accès',
          policyCondition(domain, p),
          <span key="actions" className="flex gap-1">
            <button
              type="button"
              className={rowButton}
              title="Monter"
              disabled={i === 0}
              onClick={() => runCommand(command('nps.movePolicy', device.id, p.name, -1))}
            >
              <ArrowUp size={11} />
            </button>
            <button
              type="button"
              className={rowButton}
              title="Descendre"
              disabled={i === policies.length - 1}
              onClick={() => runCommand(command('nps.movePolicy', device.id, p.name, 1))}
            >
              <ArrowDown size={11} />
            </button>
            <button
              type="button"
              className={rowButton}
              onClick={() => runCommand(command('nps.setPolicyEnabled', device.id, p.name, !p.enabled))}
            >
              {p.enabled ? 'Désactiver' : 'Activer'}
            </button>
            <button
              type="button"
              className={rowButton}
              onClick={() => runCommand(command('nps.removePolicy', device.id, p.name))}
            >
              Supprimer
            </button>
          </span>
        ])}
      />
    )
  } else {
    content = (
      <div className="flex flex-col gap-2 p-4 text-xs text-slate-700" data-testid="nps-status">
        <p className="font-semibold">Serveur NPS (Network Policy Server)</p>
        <p>
          Le serveur NPS authentifie les demandes de connexion transmises par les clients RADIUS (serveurs
          VPN) et applique la première stratégie réseau dont les conditions correspondent : l’accès est alors
          accordé ou refusé. Les décisions sont inscrites dans le journal Sécurité (événements 6272 et 6273).
        </p>
        <p>
          {nps?.radiusClients.length ?? 0} client(s) RADIUS, {nps?.policies.length ?? 0} stratégie(s) réseau.
        </p>
      </div>
    )
  }

  const groupOptions = (domain?.groups ?? [])
    .filter((g) => g.category === 'Security')
    .map((g) => ({ value: `${domain?.netbios}\\${g.sam}`, label: `${domain?.netbios}\\${g.sam}` }))

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={node}
        onSelect={setNode}
        actions={actions}
        testId="nps-console"
        treeWidth={240}
      >
        {content}
      </Mmc>
      {dialog === 'client' && (
        <FormDialog
          title="Nouveau client RADIUS"
          fields={[
            { key: 'name', label: 'Nom convivial', placeholder: 'SRV2-VPN' },
            { key: 'address', label: 'Adresse (IP)', placeholder: '192.168.10.2' },
            { key: 'secret', label: 'Secret partagé', type: 'password' }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('nps.addClient', device.id, {
                name: String(v['name']),
                address: String(v['address']),
                sharedSecret: String(v['secret'])
              })
            )
          }
          onClose={() => setDialog(null)}
          testId="nps-dialog"
        />
      )}
      {dialog === 'policy' && (
        <FormDialog
          title="Nouvelle stratégie réseau"
          fields={[
            { key: 'name', label: 'Nom de la stratégie', placeholder: 'Accès VPN' },
            { key: 'group', label: 'Condition : Groupes Windows', type: 'select', options: groupOptions },
            {
              key: 'access',
              label: 'Autorisation d’accès',
              type: 'select',
              options: [
                { value: 'Grant', label: 'Accès accordé' },
                { value: 'Deny', label: 'Accès refusé' }
              ]
            }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('nps.addPolicy', device.id, {
                name: String(v['name']),
                groups: [String(v['group'])],
                access: v['access'] === 'Deny' ? 'Deny' : 'Grant'
              })
            )
          }
          onClose={() => setDialog(null)}
          testId="nps-dialog"
        />
      )}
    </div>
  )
}
