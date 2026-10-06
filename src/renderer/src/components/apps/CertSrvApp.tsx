/**
 * Console Autorité de certification (certsrv.msc) : configuration de l'autorité racine
 * d'entreprise, certificats délivrés et révoqués, modèles de certificats publiés.
 */
import { useState } from 'react'
import { BadgeCheck, BadgeX, FileBadge, Landmark } from 'lucide-react'
import {
  CERT_TEMPLATES,
  REVOCATION_LABELS,
  REVOCATION_REASONS,
  adcsOf,
  command,
  defaultCaName,
  formatShortDate,
  type ServerDevice
} from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { Button, inputClass } from '../common/ui'
import { Mmc, MmcTable, type MmcNode } from '../mmc/Mmc'

export function CertSrvApp({ device }: { device: ServerDevice }) {
  const ca = adcsOf(device)
  const lab = useLabStore((s) => s.lab)
  const [selected, setSelected] = useState('issued')
  const [reason, setReason] = useState<(typeof REVOCATION_REASONS)[number]>('Unspecified')
  const [template, setTemplate] = useState('')
  if (!ca || !device.host.features.includes('ADCS-Cert-Authority'))
    return (
      <div className="p-6 text-sm text-slate-500">Le rôle Autorité de certification n’est pas installé.</div>
    )
  if (!ca.configured) return <Configure device={device} initial={defaultCaName(lab, device.id)} />

  const nodes: MmcNode[] = [
    {
      id: 'ca',
      label: ca.caName,
      icon: Landmark,
      iconClass: 'text-emerald-700',
      children: [
        { id: 'revoked', label: 'Certificats révoqués', icon: BadgeX },
        { id: 'issued', label: 'Certificats délivrés', icon: BadgeCheck },
        { id: 'templates', label: 'Modèles de certificats', icon: FileBadge }
      ]
    }
  ]
  const unpublished = Object.keys(CERT_TEMPLATES).filter((t) => !ca.templates.includes(t))

  let content
  if (selected === 'templates')
    content = (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
          Modèle à délivrer :
          <select
            className={`${inputClass} !h-6 w-64 !py-0 text-xs`}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            data-testid="ca-template-select"
          >
            <option value="">Choisir…</option>
            {unpublished.map((t) => (
              <option key={t} value={t}>
                {CERT_TEMPLATES[t]?.display}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              if (template && runCommandOk(command('adcs.addTemplate', device.id, template))) setTemplate('')
            }}
          >
            Ajouter
          </Button>
        </div>
        <MmcTable
          testId="ca-templates"
          columns={['Nom', 'Nom court', '']}
          empty="Aucun modèle publié."
          rows={ca.templates.map((t) => [
            CERT_TEMPLATES[t]?.display ?? t,
            t,
            <button
              key="del"
              type="button"
              className="text-red-600 hover:underline"
              onClick={() => runCommand(command('adcs.removeTemplate', device.id, t))}
            >
              Supprimer
            </button>
          ])}
        />
      </div>
    )
  else {
    const revoked = selected === 'revoked'
    const list = ca.issued.filter((c) => c.revoked === revoked)
    content = (
      <div className="flex h-full flex-col">
        {!revoked && (
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
            Motif de révocation :
            <select
              className={`${inputClass} !h-6 w-72 !py-0 text-xs`}
              value={reason}
              onChange={(e) => setReason(e.target.value as (typeof REVOCATION_REASONS)[number])}
            >
              {REVOCATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REVOCATION_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        )}
        <MmcTable
          testId={revoked ? 'ca-revoked' : 'ca-issued'}
          columns={[
            'N° de série',
            'Nom du demandeur',
            'Nom commun',
            'Modèle',
            revoked ? 'Motif' : 'Date',
            ''
          ]}
          empty="Aucun certificat."
          rows={list.map((c) => [
            <span key="s" className="font-mono">
              {c.serial}
            </span>,
            c.requester,
            c.subject.replace(/^CN=/, ''),
            CERT_TEMPLATES[c.template]?.display ?? c.template,
            revoked && c.reason
              ? REVOCATION_LABELS[c.reason as (typeof REVOCATION_REASONS)[number]]
              : formatShortDate(c.issuedAt),
            revoked ? (
              ''
            ) : (
              <button
                key="rv"
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => runCommand(command('adcs.revoke', device.id, c.serial, reason))}
                data-testid={`ca-revoke-${c.serial}`}
              >
                Révoquer
              </button>
            )
          ])}
        />
      </div>
    )
  }

  return (
    <Mmc nodes={nodes} selected={selected} onSelect={setSelected} testId="ca-console">
      {content}
    </Mmc>
  )
}

/** Configuration des services de certificats (assistant simplifié : autorité racine d'entreprise). */
function Configure({ device, initial }: { device: ServerDevice; initial: string }) {
  const [name, setName] = useState(initial)
  return (
    <div className="flex max-w-lg flex-col gap-3 p-6 text-sm" data-testid="ca-configure">
      <h2 className="font-semibold">Configuration des services de certificats Active Directory</h2>
      <p className="text-xs text-slate-600">
        Type d’installation : <b>autorité de certification d’entreprise</b>, type d’AC : <b>racine</b>. Le
        certificat de l’autorité sera distribué aux membres du domaine par la stratégie de groupe.
      </p>
      <label className="text-xs">Nom commun de cette AC :</label>
      <input
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="ca-name"
      />
      <div>
        <Button
          variant="primary"
          onClick={() =>
            runCommand(command('adcs.install', device.id, { caName: name }), {
              success: 'Configuration de l’autorité de certification réussie.'
            })
          }
        >
          Configurer
        </Button>
      </div>
    </div>
  )
}
