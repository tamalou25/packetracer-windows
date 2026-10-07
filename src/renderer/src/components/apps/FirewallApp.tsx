/**
 * Pare-feu Windows Defender avec fonctions avancées de sécurité (wf.msc) : état des profils,
 * règles de trafic entrant et sortant (prédéfinies, locales, de stratégie de groupe).
 */
import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck } from 'lucide-react'
import {
  activeProfile,
  command,
  effectiveRules,
  FIREWALL_PROFILES,
  PROFILE_LABELS,
  profileEnabled,
  type FirewallProfileName,
  type HostDevice
} from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Node = 'root' | 'inbound' | 'outbound'

export function FirewallApp({ device }: { device: HostDevice }) {
  // Lecture de l'équipement à jour (la fenêtre reçoit l'instantané de son ouverture)
  const host = useLabStore((s) => s.lab.devices[device.id]) as HostDevice | undefined
  const [node, setNode] = useState<Node>('root')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  if (!host) return null

  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: 'Pare-feu Windows Defender avec fonctions avancées de sécurité sur Ordinateur local',
      icon: ShieldCheck,
      iconClass: 'text-emerald-700',
      children: [
        { id: 'inbound', label: 'Règles de trafic entrant', icon: ArrowDownToLine },
        { id: 'outbound', label: 'Règles de trafic sortant', icon: ArrowUpFromLine }
      ]
    }
  ]
  const direction = node === 'outbound' ? 'Outbound' : 'Inbound'
  const rules = effectiveRules(host).filter((r) => r.direction === direction)
  const rule = rules.find((r) => r.id === selected)
  const active = activeProfile(host)

  const toggleProfile = (p: FirewallProfileName) =>
    runCommand(
      command('firewall.setProfile', host.id, [p], { enabled: !host.host.firewall.profiles[p].enabled })
    )

  let actions = null
  let content
  if (node === 'root') {
    content = (
      <div className="flex flex-col gap-2 p-3 text-xs text-slate-700" data-testid="wf-overview">
        <p className="font-semibold">Vue d’ensemble</p>
        {FIREWALL_PROFILES.map((p) => (
          <div key={p} className="rounded border border-slate-200 p-2" data-testid={`wf-profile-${p}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                Profil {PROFILE_LABELS[p].toLowerCase()}
                {p === active ? ' est actif' : ''}
              </span>
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => toggleProfile(p)}
                data-testid={`wf-toggle-${p}`}
              >
                {host.host.firewall.profiles[p].enabled ? 'Désactiver' : 'Activer'}
              </button>
            </div>
            <p className={profileEnabled(host, p) ? 'text-emerald-700' : 'text-red-700'}>
              {profileEnabled(host, p)
                ? 'Le Pare-feu Windows Defender est actif.'
                : 'Le Pare-feu Windows Defender est désactivé.'}
            </p>
            <p>
              Les connexions entrantes qui ne correspondent à aucune règle sont{' '}
              {host.host.firewall.profiles[p].defaultInbound === 'Block' ? 'bloquées' : 'autorisées'}.
            </p>
            <p>
              Les connexions sortantes qui ne correspondent à aucune règle sont{' '}
              {host.host.firewall.profiles[p].defaultOutbound === 'Block' ? 'bloquées' : 'autorisées'}.
            </p>
          </div>
        ))}
      </div>
    )
  } else {
    actions = (
      <>
        <MmcAction onClick={() => setDialog(true)} testId="wf-new-rule">
          Nouvelle règle…
        </MmcAction>
        {rule && rule.source === 'local' && (
          <>
            <MmcAction
              onClick={() =>
                runCommand(command('firewall.setRuleEnabled', host.id, { name: rule.id }, !rule.enabled))
              }
              testId="wf-toggle-rule"
            >
              {rule.enabled ? 'Désactiver la règle' : 'Activer la règle'}
            </MmcAction>
            {!rule.group && (
              <MmcAction
                danger
                onClick={() => {
                  if (runCommandOk(command('firewall.removeRule', host.id, { name: rule.id })))
                    setSelected(null)
                }}
              >
                Supprimer
              </MmcAction>
            )}
          </>
        )}
      </>
    )
    content = (
      <MmcTable
        testId="wf-rules"
        columns={['Nom', 'Groupe', 'Profil', 'Activée', 'Action', 'Protocole', 'Port local']}
        empty="Aucune règle."
        rows={rules.map((r) => [
          <button
            key="n"
            type="button"
            className={`text-left ${selected === r.id ? 'font-semibold text-sky-700' : ''}`}
            onClick={() => setSelected(r.id)}
            data-testid={`wf-rule-${r.displayName}`}
          >
            {r.displayName}
            {r.source === 'gpo' ? ' (stratégie de groupe)' : ''}
          </button>,
          r.group,
          r.profiles.length === 0 ? 'Tout' : r.profiles.map((p) => PROFILE_LABELS[p]).join(', '),
          r.enabled ? 'Oui' : 'Non',
          r.action === 'Allow' ? 'Autoriser' : 'Bloquer',
          r.protocol === 'Any' ? 'Tout' : r.protocol,
          r.localPorts.join(', ') || 'Tout'
        ])}
      />
    )
  }

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={node}
        onSelect={(id) => {
          setNode(id as Node)
          setSelected(null)
        }}
        actions={actions ?? undefined}
        testId="wf-console"
        treeWidth={300}
      >
        {content}
      </Mmc>
      {dialog && (
        <FormDialog
          title={`Assistant Nouvelle règle de trafic ${direction === 'Inbound' ? 'entrant' : 'sortant'}`}
          fields={[
            { key: 'name', label: 'Nom', placeholder: 'Autoriser le site intranet' },
            {
              key: 'action',
              label: 'Action',
              type: 'select',
              options: [
                { value: 'Allow', label: 'Autoriser la connexion' },
                { value: 'Block', label: 'Bloquer la connexion' }
              ]
            },
            {
              key: 'protocol',
              label: 'Protocole',
              type: 'select',
              options: [
                { value: 'TCP', label: 'TCP' },
                { value: 'UDP', label: 'UDP' },
                { value: 'ICMPv4', label: 'ICMPv4' },
                { value: 'Any', label: 'Tout' }
              ]
            },
            { key: 'ports', label: 'Ports locaux spécifiques (vide : tous)', placeholder: '80, 443' },
            { key: 'remote', label: 'Adresses IP distantes (vide : toutes)', placeholder: '192.168.10.0/24' }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('firewall.newRule', host.id, {
                displayName: String(v['name']),
                direction,
                action: v['action'] === 'Block' ? 'Block' : 'Allow',
                protocol: String(v['protocol']) as 'TCP' | 'UDP' | 'ICMPv4' | 'Any',
                localPorts: String(v['ports'])
                  .split(/[,;\s]+/)
                  .filter(Boolean)
                  .map(Number),
                remoteAddresses: String(v['remote'])
                  .split(/[,;\s]+/)
                  .filter(Boolean)
              }),
              { success: 'La règle a été créée.' }
            )
          }
          onClose={() => setDialog(false)}
          testId="wf-dialog"
        />
      )}
    </div>
  )
}
