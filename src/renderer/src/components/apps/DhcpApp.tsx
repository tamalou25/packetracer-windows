/**
 * Console DHCP : étendues, pool d'adresses, baux, réservations, options, autorisation.
 */
import { useState } from 'react'
import { CircleArrowDown, CircleCheck, FolderOpen, ListTree, Server, Settings2 } from 'lucide-react'
import {
  formatLeaseDuration,
  formatShortDate,
  prefixToMask,
  type DhcpOptions,
  type DhcpScope,
  type ServerDevice,
  command
} from '@engine/index'
import { runCommand } from '../../lib/run'
import { useUiStore } from '../../store/ui'
import { Button, Field, inputClass } from '../common/ui'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

export function DhcpApp({ device }: { device: ServerDevice }) {
  const dhcp = device.services.dhcp
  const [selected, setSelected] = useState('server')
  const [dialog, setDialog] = useState<'scope' | null>(null)
  if (!dhcp) return <div className="p-6 text-sm text-slate-500">Le rôle Serveur DHCP n’est pas installé.</div>

  const authorizedLabel = !device.host.domain
    ? 'serveur autonome'
    : dhcp.authorized
      ? 'autorisé'
      : 'non autorisé'
  const nodes: MmcNode[] = [
    {
      id: 'server',
      label: `${device.name.toLowerCase()} (${authorizedLabel})`,
      icon: device.host.domain && !dhcp.authorized ? CircleArrowDown : Server,
      iconClass: device.host.domain && !dhcp.authorized ? 'text-red-600' : 'text-emerald-600',
      children: [
        {
          id: 'ipv4',
          label: 'IPv4',
          icon: ListTree,
          children: [
            { id: 'serverOptions', label: 'Options de serveur', icon: Settings2 },
            ...dhcp.scopes.map((s) => ({
              id: `scope:${s.scopeId}`,
              label: `Étendue [${s.scopeId}] ${s.name}${s.state === 'Inactive' ? ' (inactive)' : ''}`,
              icon: FolderOpen,
              iconClass: s.state === 'Active' ? 'text-amber-600' : 'text-slate-400',
              children: [
                { id: `pool:${s.scopeId}`, label: 'Pool d’adresses' },
                { id: `leases:${s.scopeId}`, label: 'Baux d’adresse' },
                { id: `res:${s.scopeId}`, label: 'Réservations' },
                { id: `opts:${s.scopeId}`, label: 'Options d’étendue' }
              ]
            }))
          ]
        }
      ]
    }
  ]

  const [kind, scopeId] = selected.includes(':') ? (selected.split(':') as [string, string]) : [selected, '']
  const scope = dhcp.scopes.find((s) => s.scopeId === scopeId)

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('scope')} testId="dhcp-new-scope">
        Nouvelle étendue…
      </MmcAction>
      {device.host.domain && (
        <MmcAction
          onClick={() =>
            runCommand(command('dhcp.authorize', device.id, !dhcp.authorized), {
              success: dhcp.authorized
                ? 'Autorisation retirée.'
                : 'Serveur DHCP autorisé dans Active Directory.'
            })
          }
        >
          {dhcp.authorized ? 'Annuler l’autorisation' : 'Autoriser'}
        </MmcAction>
      )}
      {scope && (
        <>
          <MmcAction
            onClick={() =>
              runCommand(command('dhcp.setScopeState', device.id, scope.scopeId, scope.state !== 'Active'))
            }
          >
            {scope.state === 'Active' ? 'Désactiver l’étendue' : 'Activer l’étendue'}
          </MmcAction>
          <MmcAction
            danger
            onClick={() => {
              if (runCommand(command('dhcp.removeScope', device.id, scope.scopeId)) !== undefined)
                setSelected('ipv4')
            }}
          >
            Supprimer l’étendue
          </MmcAction>
        </>
      )}
    </>
  )

  return (
    <div className="relative h-full">
      <Mmc nodes={nodes} selected={selected} onSelect={setSelected} actions={actions} testId="dhcp-console">
        {kind === 'server' && (
          <div className="p-4 text-sm">
            <h3 className="mb-2 font-semibold">Serveur DHCP {device.name}</h3>
            {!device.host.domain && (
              <p className="text-slate-600">
                Serveur autonome (groupe de travail) : aucune autorisation Active Directory n’est nécessaire.
              </p>
            )}
            {device.host.domain && !dhcp.authorized && (
              <p className="rounded bg-red-50 p-2 text-red-700">
                Ce serveur est membre du domaine {device.host.domain} mais n’est pas autorisé dans Active
                Directory : il ne distribue aucune adresse.
              </p>
            )}
            {device.host.domain && dhcp.authorized && (
              <p className="flex items-center gap-1 text-emerald-700">
                <CircleCheck size={14} /> Autorisé dans le domaine {device.host.domain}.
              </p>
            )}
          </div>
        )}
        {kind === 'ipv4' && (
          <MmcTable
            columns={['Étendue', 'Nom', 'État', 'Plage', 'Durée du bail']}
            empty="Aucune étendue. Utilisez « Nouvelle étendue… »."
            rows={dhcp.scopes.map((s) => [
              s.scopeId,
              s.name,
              s.state === 'Active' ? 'Active' : 'Inactive',
              `${s.start} - ${s.end}`,
              formatLeaseDuration(s.leaseDurationSec)
            ])}
          />
        )}
        {kind === 'serverOptions' && (
          <OptionsEditor device={device} scopeId={null} options={dhcp.serverOptions} />
        )}
        {scope && kind === 'scope' && (
          <div className="p-4 text-xs">
            <dl className="grid grid-cols-[160px_1fr] gap-y-1">
              <dt className="text-slate-500">Nom</dt>
              <dd>{scope.name}</dd>
              <dt className="text-slate-500">Plage</dt>
              <dd>
                {scope.start} - {scope.end}
              </dd>
              <dt className="text-slate-500">Masque</dt>
              <dd>{prefixToMask(scope.prefixLength)}</dd>
              <dt className="text-slate-500">Baux actifs</dt>
              <dd>{scope.leases.filter((l) => l.state === 'Active').length}</dd>
            </dl>
          </div>
        )}
        {scope && kind === 'pool' && <PoolView device={device} scope={scope} />}
        {scope && kind === 'leases' && (
          <MmcTable
            testId="dhcp-leases"
            columns={['Adresse IP du client', 'Nom', 'Expiration du bail', 'Identificateur unique']}
            empty="Aucun bail."
            rows={scope.leases.map((l) => [
              l.ip,
              l.hostName,
              l.state === 'BadAddress' ? 'Adresse incorrecte' : formatShortDate(l.expiresAt),
              l.mac.toLowerCase()
            ])}
          />
        )}
        {scope && kind === 'res' && <ReservationsView device={device} scope={scope} />}
        {scope && kind === 'opts' && (
          <OptionsEditor device={device} scopeId={scope.scopeId} options={scope.options} />
        )}
      </Mmc>
      {dialog === 'scope' && (
        <NewScopeDialog
          device={device}
          onClose={() => setDialog(null)}
          onCreated={(id) => setSelected(`scope:${id}`)}
        />
      )}
    </div>
  )
}

function PoolView({ device, scope }: { device: ServerDevice; scope: DhcpScope }) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  return (
    <div>
      <MmcTable
        columns={['Adresse IP de début', 'Adresse IP de fin', 'Description', '']}
        empty=""
        rows={[
          [scope.start, scope.end, 'Plage d’adresses pour la distribution', ''],
          ...scope.exclusions.map((ex, i) => [
            ex.start,
            ex.end,
            'Adresses exclues de la distribution',
            <button
              key="d"
              type="button"
              className="text-red-600 hover:underline"
              onClick={() => runCommand(command('dhcp.removeExclusion', device.id, scope.scopeId, i))}
            >
              Supprimer
            </button>
          ])
        ]}
      />
      <div className="flex items-end gap-2 p-3">
        <Field label="Exclure de">
          <input
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            data-testid="excl-start"
          />
        </Field>
        <Field label="à">
          <input className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          onClick={() => {
            if (
              runCommand(command('dhcp.addExclusion', device.id, scope.scopeId, start, end || start)) !==
              undefined
            ) {
              setStart('')
              setEnd('')
            }
          }}
        >
          Ajouter
        </Button>
      </div>
    </div>
  )
}

function ReservationsView({ device, scope }: { device: ServerDevice; scope: DhcpScope }) {
  const [form, setForm] = useState({ name: '', ip: '', mac: '' })
  return (
    <div>
      <MmcTable
        columns={['Nom', 'Adresse IP', 'Adresse MAC', '']}
        empty="Aucune réservation."
        rows={scope.reservations.map((r) => [
          r.name,
          r.ip,
          r.mac,
          <button
            key="d"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('dhcp.removeReservation', device.id, scope.scopeId, r.ip))}
          >
            Supprimer
          </button>
        ])}
      />
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 p-3">
        <Field label="Nom de réservation">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Adresse IP">
          <input
            className={inputClass}
            value={form.ip}
            onChange={(e) => setForm({ ...form, ip: e.target.value })}
          />
        </Field>
        <Field label="Adresse MAC">
          <input
            className={inputClass}
            value={form.mac}
            placeholder="02-53-4C-00-00-05"
            onChange={(e) => setForm({ ...form, mac: e.target.value })}
          />
        </Field>
        <Button
          variant="primary"
          onClick={() => {
            if (runCommand(command('dhcp.addReservation', device.id, scope.scopeId, form)) !== undefined)
              setForm({ name: '', ip: '', mac: '' })
          }}
        >
          Ajouter
        </Button>
      </div>
    </div>
  )
}

function OptionsEditor({
  device,
  scopeId,
  options
}: {
  device: ServerDevice
  scopeId: string | null
  options: DhcpOptions
}) {
  const [router, setRouter] = useState(options.router.join(', '))
  const [dns, setDns] = useState(options.dnsServers.join(', '))
  const [domain, setDomain] = useState(options.dnsDomain ?? '')
  const [force, setForce] = useState(false)
  const split = (v: string) => v.split(/[,; ]+/).filter((x) => x)
  return (
    <div className="flex max-w-md flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold">
        {scopeId ? `Options de l’étendue ${scopeId}` : 'Options de serveur (toutes les étendues)'}
      </h3>
      <Field label="003 Routeur">
        <input
          className={inputClass}
          value={router}
          onChange={(e) => setRouter(e.target.value)}
          data-testid="opt-router"
        />
      </Field>
      <Field label="006 Serveurs DNS">
        <input
          className={inputClass}
          value={dns}
          onChange={(e) => setDns(e.target.value)}
          data-testid="opt-dns"
        />
      </Field>
      <Field label="015 Nom de domaine DNS">
        <input className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        Enregistrer même si un serveur DNS ne répond pas
      </label>
      <div>
        <Button
          variant="primary"
          data-testid="opt-apply"
          onClick={() =>
            runCommand(
              command('dhcp.setOptions', device.id, scopeId, {
                router: split(router),
                dnsServers: split(dns),
                dnsDomain: domain,
                force
              }),
              {
                success: 'Options enregistrées.'
              }
            )
          }
        >
          Appliquer
        </Button>
      </div>
    </div>
  )
}

function NewScopeDialog({
  device,
  onClose,
  onCreated
}: {
  device: ServerDevice
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [form, setForm] = useState({
    name: '',
    start: '',
    end: '',
    mask: '255.255.255.0',
    lease: '8.00:00:00',
    router: '',
    dns: '',
    domain: ''
  })
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v })
  const create = () => {
    const split = (v: string) => v.split(/[,; ]+/).filter((x) => x)
    const id = runCommand(
      command(
        'dhcp.createScope',
        device.id,
        { name: form.name, start: form.start, end: form.end, mask: form.mask, leaseDuration: form.lease },
        form.router || form.dns || form.domain
          ? { router: split(form.router), dnsServers: split(form.dns), dnsDomain: form.domain || null }
          : null
      )
    )
    if (id) {
      useUiStore.getState().notify('success', `Étendue ${id} créée et activée.`)
      onCreated(id)
      onClose()
    }
  }
  const fields: [keyof typeof form, string, string?][] = [
    ['name', 'Nom de l’étendue'],
    ['start', 'Adresse IP de début', '192.168.1.100'],
    ['end', 'Adresse IP de fin', '192.168.1.200'],
    ['mask', 'Masque de sous-réseau'],
    ['lease', 'Durée du bail (j.hh:mm:ss)'],
    ['router', 'Routeur (passerelle) — option 003'],
    ['dns', 'Serveurs DNS — option 006'],
    ['domain', 'Domaine parent — option 015']
  ]
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/30">
      <div className="w-[440px] rounded-lg bg-white p-5 shadow-xl" data-testid="new-scope-dialog">
        <h3 className="mb-3 text-base font-semibold">Assistant Nouvelle étendue</h3>
        <div className="grid grid-cols-[180px_1fr] items-center gap-2">
          {fields.map(([k, label, ph]) => [
            <span key={`${k}-l`} className="text-xs text-slate-600">
              {label}
            </span>,
            <input
              key={k}
              className={inputClass}
              value={form[k]}
              placeholder={ph}
              onChange={(e) => set(k, e.target.value)}
              data-testid={`scope-${k}`}
            />
          ])}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={create} data-testid="scope-create">
            Terminer
          </Button>
        </div>
      </div>
    </div>
  )
}
