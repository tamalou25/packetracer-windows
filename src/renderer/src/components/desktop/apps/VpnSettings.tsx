/**
 * Paramètres > Réseau et Internet > VPN : connexions VPN de l'ordinateur, connexion avec un
 * compte (tracée en mode Simulation), déconnexion, suppression.
 */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { command, type HostDevice } from '@engine/index'
import { runCommand, runCommandOk } from '../../../lib/run'
import { useUiStore } from '../../../store/ui'
import { FormDialog } from '../../common/FormDialog'

export function VpnSettings({ device }: { device: HostDevice }) {
  const [dialog, setDialog] = useState<'add' | { connect: string } | null>(null)
  const connections = device.host.vpnConnections

  return (
    <div
      className="relative flex h-full flex-col gap-3 bg-white p-5 text-sm text-slate-800"
      data-testid="vpn-settings"
    >
      <h2 className="text-xl font-semibold">VPN</h2>
      <button
        type="button"
        className="self-start rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs hover:bg-slate-100"
        onClick={() => setDialog('add')}
        data-testid="vpn-add"
      >
        + Ajouter une connexion VPN
      </button>
      {connections.length === 0 && <p className="text-xs text-slate-500">Aucune connexion VPN.</p>}
      {connections.map((c) => (
        <div
          key={c.name}
          className="flex items-center gap-3 rounded border border-slate-200 p-3"
          data-testid={`vpn-${c.name}`}
        >
          <ShieldCheck size={20} className={c.connected ? 'text-emerald-600' : 'text-slate-400'} />
          <div className="flex-1">
            <div className="font-medium">{c.name}</div>
            <div className="text-xs text-slate-500">
              {c.connected ? `Connecté — adresse ${c.connected.address}` : `Serveur ${c.server}`}
            </div>
          </div>
          {c.connected ? (
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              onClick={() => runCommand(command('vpn.disconnect', device.id, c.name))}
              data-testid="vpn-disconnect"
            >
              Déconnecter
            </button>
          ) : (
            <>
              <button
                type="button"
                className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700"
                onClick={() => setDialog({ connect: c.name })}
                data-testid="vpn-connect"
              >
                Se connecter
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
                onClick={() => runCommand(command('vpn.removeConnection', device.id, c.name))}
              >
                Supprimer
              </button>
            </>
          )}
        </div>
      ))}
      {dialog === 'add' && (
        <FormDialog
          title="Ajouter une connexion VPN"
          fields={[
            { key: 'name', label: 'Nom de la connexion', placeholder: 'Bureau' },
            { key: 'server', label: 'Nom ou adresse du serveur', placeholder: '203.0.113.2' }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('vpn.addConnection', device.id, {
                name: String(v['name']),
                server: String(v['server'])
              })
            )
          }
          onClose={() => setDialog(null)}
          testId="vpn-dialog"
        />
      )}
      {dialog && dialog !== 'add' && (
        <FormDialog
          title={`Se connecter à ${dialog.connect}`}
          fields={[
            { key: 'user', label: 'Nom d’utilisateur', placeholder: 'LAB\\jdupont' },
            { key: 'password', label: 'Mot de passe', type: 'password' }
          ]}
          onSubmit={(v) => {
            const r = runCommand(
              command('vpn.connect', device.id, dialog.connect, {
                user: String(v['user']),
                password: String(v['password'])
              })
            )
            if (r && !r.ok) useUiStore.getState().notify('error', r.message)
            return !!r?.ok
          }}
          onClose={() => setDialog(null)}
          testId="vpn-dialog"
        />
      )}
    </div>
  )
}
