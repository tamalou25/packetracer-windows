/**
 * Gestionnaire des services Internet (IIS) : sites (démarrage, arrêt, dossier racine, liaisons)
 * et certificats de serveur (création d'un certificat auto-signé).
 */
import { useState } from 'react'
import { Globe, KeyRound, Server, Shield } from 'lucide-react'
import {
  bindingInformation,
  command,
  iisServerOf,
  personalCertificates,
  type IisSite,
  type ServerDevice
} from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useUiStore } from '../../store/ui'
import { Button, inputClass } from '../common/ui'
import { FormDialog, type FormValues } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'site' | 'binding' | 'cert' | 'domainCert' | null

export function IisApp({ device }: { device: ServerDevice }) {
  const iis = iisServerOf(device)
  const [selected, setSelected] = useState('server')
  const [dialog, setDialog] = useState<Dialog>(null)
  if (!iis || !device.host.features.includes('Web-Server'))
    return <div className="p-6 text-sm text-slate-500">Le rôle Serveur Web (IIS) n’est pas installé.</div>

  const certificates = personalCertificates(device)
  const nodes: MmcNode[] = [
    {
      id: 'server',
      label: device.name,
      icon: Server,
      iconClass: 'text-emerald-600',
      children: [
        {
          id: 'sites',
          label: 'Sites',
          icon: Globe,
          children: iis.sites.map((s) => ({
            id: `site:${s.name}`,
            label: s.name,
            icon: Globe,
            iconClass: s.state === 'Started' ? 'text-sky-600' : 'text-slate-400'
          }))
        },
        { id: 'certs', label: 'Certificats de serveur', icon: KeyRound }
      ]
    }
  ]
  const site = selected.startsWith('site:') ? iis.sites.find((s) => s.name === selected.slice(5)) : undefined
  const warn = (text: string) => useUiStore.getState().notify('warning', text)

  const submitSite = (v: FormValues): boolean => {
    const name = String(v['name'])
    const result = runCommand(
      command('iis.addSite', device.id, {
        name,
        physicalPath: String(v['path']),
        binding: {
          protocol: String(v['protocol']) as 'http' | 'https',
          ip: String(v['ip']) || '*',
          port: Number(v['port']) || undefined,
          host: String(v['host']),
          certificate: String(v['cert']) || null
        }
      })
    )
    if (!result) return false
    if (!result.started)
      warn(`Le site « ${name} » n’a pas démarré : sa liaison est déjà utilisée par un autre site.`)
    setSelected(`site:${name}`)
    return true
  }

  const submitBinding = (v: FormValues): boolean => {
    if (!site) return false
    const result = runCommand(
      command('iis.addBinding', device.id, site.name, {
        protocol: String(v['protocol']) as 'http' | 'https',
        ip: String(v['ip']) || '*',
        port: Number(v['port']) || undefined,
        host: String(v['host']),
        certificate: String(v['cert']) || null
      })
    )
    if (result?.conflict)
      warn(
        `Cette liaison est déjà utilisée par le site « ${result.conflict} » : un seul des deux sites peut démarrer.`
      )
    return result !== undefined
  }

  const bindingFields = [
    {
      key: 'protocol',
      label: 'Type',
      type: 'select' as const,
      options: [
        { value: 'http', label: 'http' },
        { value: 'https', label: 'https' }
      ]
    },
    { key: 'ip', label: 'Adresse IP (* = toutes non attribuées)', initial: '*' },
    { key: 'port', label: 'Port (80 en http, 443 en https)', placeholder: '80' },
    { key: 'host', label: 'Nom de l’hôte', placeholder: 'intranet.lab.local' },
    {
      key: 'cert',
      label: 'Certificat SSL (https)',
      type: 'select' as const,
      options: [
        { value: '', label: 'Non sélectionné' },
        ...certificates.map((c) => ({
          value: c.thumbprint,
          label: `${c.subject} (${c.thumbprint.slice(0, 8)}…)`
        }))
      ]
    }
  ]

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('site')} testId="iis-new-site">
        Ajouter un site Web…
      </MmcAction>
      {selected === 'certs' && (
        <>
          <MmcAction onClick={() => setDialog('domainCert')} testId="iis-domain-cert">
            Créer un certificat de domaine…
          </MmcAction>
          <MmcAction onClick={() => setDialog('cert')} testId="iis-new-cert">
            Créer un certificat auto-signé…
          </MmcAction>
        </>
      )}
      {site && (
        <>
          <MmcAction onClick={() => setDialog('binding')} testId="iis-new-binding">
            Ajouter une liaison…
          </MmcAction>
          {site.state === 'Started' ? (
            <MmcAction
              onClick={() => runCommand(command('iis.setSiteState', device.id, site.name, false))}
              testId="iis-stop"
            >
              Arrêter
            </MmcAction>
          ) : (
            <MmcAction
              onClick={() => runCommand(command('iis.setSiteState', device.id, site.name, true))}
              testId="iis-start"
            >
              Démarrer
            </MmcAction>
          )}
          <MmcAction
            danger
            onClick={() => {
              if (runCommandOk(command('iis.removeSite', device.id, site.name))) setSelected('sites')
            }}
          >
            Supprimer le site
          </MmcAction>
        </>
      )}
    </>
  )

  let content
  if (site) content = <SiteView device={device} site={site} />
  else if (selected === 'certs')
    content = (
      <MmcTable
        testId="iis-certs"
        columns={['Nom', 'Délivré à', 'Délivré par', 'Hachage du certificat']}
        empty="Aucun certificat dans le magasin Personnel."
        rows={certificates.map((c) => [
          c.dnsNames[0] ?? '',
          c.subject.replace(/^CN=/, ''),
          c.issuer.replace(/^CN=/, ''),
          <span key="t" className="font-mono">
            {c.thumbprint}
          </span>
        ])}
      />
    )
  else
    content = (
      <MmcTable
        testId="iis-sites"
        columns={['Nom', 'ID', 'État', 'Liaisons', 'Chemin d’accès']}
        empty="Aucun site."
        rows={iis.sites.map((s) => [
          s.name,
          String(s.id),
          s.state === 'Started' ? 'Démarré' : 'Arrêté',
          s.bindings.map((b) => `${bindingInformation(b)} (${b.protocol})`).join(', '),
          s.physicalPath
        ])}
      />
    )

  return (
    <div className="relative h-full">
      <Mmc nodes={nodes} selected={selected} onSelect={setSelected} actions={actions} testId="iis-console">
        {content}
      </Mmc>
      {dialog === 'site' && (
        <FormDialog
          title="Ajouter un site Web"
          fields={[
            { key: 'name', label: 'Nom du site' },
            { key: 'path', label: 'Chemin d’accès physique', placeholder: 'C:\\inetpub\\wwwroot' },
            ...bindingFields
          ]}
          onSubmit={submitSite}
          onClose={() => setDialog(null)}
          submitLabel="OK"
          testId="iis-site-dialog"
        />
      )}
      {dialog === 'binding' && (
        <FormDialog
          title="Ajouter la liaison de site"
          fields={bindingFields}
          onSubmit={submitBinding}
          onClose={() => setDialog(null)}
          testId="iis-binding-dialog"
        />
      )}
      {dialog === 'cert' && (
        <FormDialog
          title="Créer un certificat auto-signé"
          description="Le certificat est placé dans le magasin Personnel (Cert:\LocalMachine\My)."
          fields={[
            { key: 'dns', label: 'Nom DNS couvert par le certificat', placeholder: 'intranet.lab.local' }
          ]}
          onSubmit={(v) =>
            runCommand(command('system.newSelfSignedCertificate', device.id, [String(v['dns'])])) !==
            undefined
          }
          onClose={() => setDialog(null)}
          testId="iis-cert-dialog"
        />
      )}
      {dialog === 'domainCert' && (
        <FormDialog
          title="Créer un certificat de domaine"
          description="Demande un certificat (modèle Serveur Web) à l’autorité de certification d’entreprise du domaine."
          fields={[{ key: 'dns', label: 'Nom commun (nom DNS du site)', placeholder: 'intranet.lab.local' }]}
          onSubmit={(v) =>
            runCommand(
              command('adcs.request', device.id, { template: 'WebServer', dnsNames: [String(v['dns'])] })
            ) !== undefined
          }
          onClose={() => setDialog(null)}
          testId="iis-domain-cert-dialog"
        />
      )}
    </div>
  )
}

function SiteView({ device, site }: { device: ServerDevice; site: IisSite }) {
  const [path, setPath] = useState(site.physicalPath)
  const certificates = personalCertificates(device)
  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <p>
        Site <b>{site.name}</b> (ID {site.id}) — {site.state === 'Started' ? 'démarré' : 'arrêté'}.
      </p>
      <div className="flex items-center gap-2">
        Chemin d’accès physique :
        <input
          className={`${inputClass} w-72`}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          data-testid="iis-path"
        />
        <Button onClick={() => runCommand(command('iis.setPhysicalPath', device.id, site.name, path))}>
          Appliquer
        </Button>
      </div>
      <MmcTable
        testId="iis-bindings"
        columns={['Type', 'Nom de l’hôte', 'Port', 'Adresse IP', 'Certificat', '']}
        empty="Aucune liaison."
        rows={site.bindings.map((b) => [
          b.protocol,
          b.host,
          String(b.port),
          b.ip === '*' ? '*' : b.ip,
          b.protocol === 'https' ? (
            <select
              key="cert"
              className={`${inputClass} !h-6 !py-0 text-xs`}
              value={b.certificate ?? ''}
              onChange={(e) =>
                runCommand(
                  command('iis.setBindingCertificate', device.id, site.name, b, e.target.value || null)
                )
              }
            >
              <option value="">Non sélectionné</option>
              {certificates.map((c) => (
                <option key={c.thumbprint} value={c.thumbprint}>
                  {c.subject}
                </option>
              ))}
            </select>
          ) : (
            <Shield key="none" size={12} className="text-slate-300" />
          ),
          <button
            key="del"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('iis.removeBinding', device.id, site.name, b))}
          >
            Supprimer
          </button>
        ])}
      />
    </div>
  )
}
