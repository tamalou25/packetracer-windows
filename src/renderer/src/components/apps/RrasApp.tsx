/**
 * Console Routage et accès distant (rrasmgmt.msc) : assistant de configuration (NAT, VPN, VPN et
 * NAT, routage LAN), état du serveur, clients VPN connectés, pool d'adresses.
 */
import { useState } from 'react'
import { Network, Router, Users } from 'lucide-react'
import {
  batch,
  command,
  effectiveIpv4,
  MODE_LABELS,
  rrasOf,
  type RrasMode,
  type ServerDevice
} from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'wizard' | 'pool' | 'auth' | null

export function RrasApp({ device }: { device: ServerDevice }) {
  const [node, setNode] = useState('server')
  const [dialog, setDialog] = useState<Dialog>(null)
  const rras = rrasOf(device)
  const configured = !!rras?.mode
  const vpn = rras?.mode === 'vpn' || rras?.mode === 'vpn-nat'

  const nodes: MmcNode[] = [
    {
      id: 'server',
      label: `${device.name} (local)`,
      icon: Router,
      iconClass: configured ? 'text-emerald-700' : 'text-red-600',
      children: configured
        ? [
            { id: 'interfaces', label: 'Interfaces réseau', icon: Network },
            ...(vpn ? [{ id: 'clients', label: 'Clients d’accès à distance', icon: Users }] : [])
          ]
        : []
    }
  ]
  const ifaceOptions = device.interfaces
    .filter((i) => effectiveIpv4(i))
    .map((i) => ({ value: i.id, label: `${i.name} (${effectiveIpv4(i)?.address})` }))

  const actions = !configured ? (
    <MmcAction onClick={() => setDialog('wizard')} testId="rras-configure">
      Configurer et activer le routage et l’accès distant
    </MmcAction>
  ) : (
    <>
      {vpn && (
        <MmcAction onClick={() => setDialog('pool')} testId="rras-pool">
          Pool d’adresses IPv4…
        </MmcAction>
      )}
      {vpn && (
        <MmcAction onClick={() => setDialog('auth')} testId="rras-auth">
          Fournisseur d’authentification…
        </MmcAction>
      )}
      <MmcAction danger onClick={() => runCommand(command('rras.disable', device.id))} testId="rras-disable">
        Désactiver le routage et l’accès distant
      </MmcAction>
    </>
  )

  let content
  if (node === 'interfaces' && rras) {
    content = (
      <MmcTable
        testId="rras-interfaces"
        columns={['Interface', 'Adresse', 'Rôle']}
        empty=""
        rows={device.interfaces.map((i) => [
          i.name,
          effectiveIpv4(i)?.address ?? '—',
          i.id === rras.publicIfaceId ? (rras.mode === 'vpn' ? 'Publique (VPN)' : 'Publique (NAT)') : 'Privée'
        ])}
      />
    )
  } else if (node === 'clients' && rras) {
    content = (
      <MmcTable
        testId="rras-clients"
        columns={['Utilisateur', 'Adresse attribuée', 'Adresse du client', 'Tunnel']}
        empty="Aucun client d’accès à distance n’est connecté."
        rows={rras.sessions.map((s) => [s.user, s.address, s.clientAddress, 'SSTP'])}
      />
    )
  } else {
    content = (
      <div className="flex flex-col gap-2 p-4 text-xs text-slate-700" data-testid="rras-status">
        {configured && rras?.mode ? (
          <>
            <p className="font-semibold text-emerald-700">Le routage et l’accès distant est activé.</p>
            <p>Configuration : {MODE_LABELS[rras.mode]}.</p>
            {vpn && rras.pool && (
              <p>
                Pool d’adresses des clients VPN : {rras.pool.start} – {rras.pool.end} ; {rras.sessions.length}{' '}
                client(s) connecté(s).
              </p>
            )}
            {vpn && (
              <p data-testid="rras-auth-provider">
                Fournisseur d’authentification :{' '}
                {rras.radius.length > 0
                  ? `Authentification RADIUS (${rras.radius.map((r) => r.server).join(', ')})`
                  : 'Authentification Windows'}
                .
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-semibold">Le routage et l’accès distant n’est pas configuré sur ce serveur.</p>
            <p>
              Utilisez l’action « Configurer et activer le routage et l’accès distant » : traduction
              d’adresses (NAT) pour partager une connexion Internet, accès VPN pour les clients distants, ou
              routage entre réseaux.
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={node}
        onSelect={setNode}
        actions={actions}
        testId="rras-console"
        treeWidth={240}
      >
        {content}
      </Mmc>
      {dialog === 'wizard' && (
        <FormDialog
          title="Assistant Installation du serveur de routage et d’accès distant"
          fields={[
            {
              key: 'mode',
              label: 'Configuration',
              type: 'select',
              options: (['nat', 'vpn', 'vpn-nat', 'routing'] as RrasMode[]).map((m) => ({
                value: m,
                label: MODE_LABELS[m]
              }))
            },
            {
              key: 'public',
              label: 'Interface connectée à Internet',
              type: 'select',
              options: ifaceOptions
            },
            { key: 'start', label: 'Pool VPN : adresse de début', placeholder: '192.168.10.200' },
            { key: 'end', label: 'Pool VPN : adresse de fin', placeholder: '192.168.10.220' }
          ]}
          onSubmit={(v) => {
            const mode = String(v['mode']) as RrasMode
            const withVpn = mode === 'vpn' || mode === 'vpn-nat'
            return runCommandOk(
              command('rras.configure', device.id, {
                mode,
                publicIfaceId: mode === 'routing' ? null : String(v['public']),
                pool: withVpn ? { start: String(v['start']), end: String(v['end']) } : null
              }),
              { success: 'Le routage et l’accès distant est configuré et démarré.' }
            )
          }}
          onClose={() => setDialog(null)}
          testId="rras-dialog"
        />
      )}
      {dialog === 'auth' && rras && (
        <FormDialog
          title="Fournisseur d’authentification"
          fields={[
            {
              key: 'provider',
              label: 'Fournisseur d’authentification',
              type: 'select',
              initial: rras.radius.length > 0 ? 'radius' : 'windows',
              options: [
                { value: 'windows', label: 'Authentification Windows' },
                { value: 'radius', label: 'Authentification RADIUS' }
              ]
            },
            {
              key: 'server',
              label: 'Serveur RADIUS (nom ou adresse)',
              initial: rras.radius[0]?.server ?? ''
            },
            { key: 'secret', label: 'Secret partagé', type: 'password' }
          ]}
          onSubmit={(v) => {
            const remove = rras.radius.map((r) => command('rras.removeRadius', device.id, r.server))
            const add =
              v['provider'] === 'radius'
                ? [
                    command('rras.addRadius', device.id, {
                      server: String(v['server']),
                      sharedSecret: String(v['secret'])
                    })
                  ]
                : []
            // Déjà en authentification Windows : rien à modifier
            if (remove.length + add.length === 0) return true
            return runCommandOk(batch('Fournisseur d’authentification', [...remove, ...add]))
          }}
          onClose={() => setDialog(null)}
          testId="rras-dialog"
        />
      )}
      {dialog === 'pool' && (
        <FormDialog
          title="Plage d’adresses IPv4 statiques"
          fields={[
            { key: 'start', label: 'Adresse IPv4 de début', initial: rras?.pool?.start ?? '' },
            { key: 'end', label: 'Adresse IPv4 de fin', initial: rras?.pool?.end ?? '' }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('rras.setPool', device.id, { start: String(v['start']), end: String(v['end']) })
            )
          }
          onClose={() => setDialog(null)}
          testId="rras-dialog"
        />
      )}
    </div>
  )
}
