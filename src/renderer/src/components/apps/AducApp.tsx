/**
 * Utilisateurs et ordinateurs Active Directory : arborescence des conteneurs et OU,
 * création d'objets, propriétés, appartenance aux groupes, déplacement, suppression.
 */
import { useState } from 'react'
import { Folder, FolderKey, Globe, Monitor, User, UserX, Users, type LucideIcon } from 'lucide-react'
import {
  addGroup,
  addGroupMembers,
  addOrganizationalUnit,
  addUser,
  allObjects,
  containerDn,
  moveObject,
  objectDn,
  removeGroupMembers,
  removeObject,
  resetPassword,
  setAccountEnabled,
  type AdObject,
  type Domain,
  type HostDevice
} from '@engine/index'
import { requireAdmin } from '../../lib/directory'
import { runAction } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { FormDialog, type FormField, type FormValues } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

const SCOPE_LABEL = { DomainLocal: 'Domaine local', Global: 'Global', Universal: 'Universel' } as const

function typeLabel(o: AdObject): string {
  switch (o.kind) {
    case 'container':
      return o.obj.kind === 'ou' ? 'Unité d’organisation' : 'Conteneur'
    case 'user':
      return 'Utilisateur'
    case 'group':
      return `Groupe de ${o.obj.category === 'Security' ? 'sécurité' : 'distribution'} - ${SCOPE_LABEL[o.obj.scope]}`
    case 'computer':
      return 'Ordinateur'
  }
}

function iconOf(o: AdObject): LucideIcon {
  if (o.kind === 'container') return o.obj.kind === 'ou' ? FolderKey : Folder
  if (o.kind === 'user') return o.obj.enabled ? User : UserX
  if (o.kind === 'group') return Users
  return Monitor
}

type Dialog = 'ou' | 'user' | 'group' | 'password' | 'member' | 'addToGroup' | 'move' | null

export function AducApp({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const domain: Domain | undefined = device.host.domain ? lab.domains[device.host.domain] : undefined
  const [selected, setSelected] = useState<string>('root')
  const [objectId, setObjectId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (!domain)
    return <div className="p-6 text-sm text-slate-500">Cet ordinateur n’est pas membre d’un domaine.</div>

  const containerId = selected === 'root' ? null : selected
  const buildTree = (parentId: string | null): MmcNode[] =>
    domain.containers
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((c) => ({
        id: c.id,
        label: c.name,
        icon: c.kind === 'ou' ? FolderKey : Folder,
        iconClass: c.kind === 'ou' ? 'text-amber-600' : 'text-slate-500',
        children: buildTree(c.id)
      }))
  const nodes: MmcNode[] = [
    { id: 'root', label: domain.name, icon: Globe, iconClass: 'text-sky-600', children: buildTree(null) }
  ]

  const objects = allObjects(domain)
    .filter((o) => o.obj.parentId === containerId)
    .sort((a, b) => a.obj.name.localeCompare(b.obj.name, 'fr'))
  const current = objectId ? allObjects(domain).find((o) => o.obj.id === objectId) : undefined
  const path = containerDn(domain, containerId)
  const guard = (fn: () => void) => () => {
    if (requireAdmin(device)) fn()
  }
  const ok = <T,>(v: T | undefined) => v !== undefined

  const containerOptions = domain.containers.map((c) => ({
    value: containerDn(domain, c.id),
    label: containerDn(domain, c.id)
  }))
  const groupOptions = domain.groups.map((g) => ({ value: g.sam, label: g.name }))
  const principalOptions = allObjects(domain)
    .filter((o) => o.kind !== 'container')
    .map((o) => ({
      value: o.kind === 'computer' ? `${o.obj.name}$` : (o.obj as { sam: string }).sam,
      label: `${o.obj.name} (${typeLabel(o)})`
    }))

  const dialogs: Record<
    Exclude<Dialog, null>,
    { title: string; fields: FormField[]; submit: (v: FormValues) => boolean }
  > = {
    ou: {
      title: `Nouvel objet - Unité d’organisation (dans ${path})`,
      fields: [
        { key: 'name', label: 'Nom' },
        {
          key: 'protected',
          label: 'Protéger le conteneur contre une suppression accidentelle',
          type: 'checkbox',
          initial: true
        }
      ],
      submit: (v) =>
        ok(
          runAction((l) =>
            addOrganizationalUnit(l, domain.name, {
              name: String(v['name']),
              path,
              protectedFromDeletion: v['protected'] === true
            })
          )
        )
    },
    user: {
      title: `Nouvel objet - Utilisateur (dans ${path})`,
      fields: [
        { key: 'given', label: 'Prénom' },
        { key: 'surname', label: 'Nom' },
        { key: 'sam', label: 'Nom d’ouverture de session de l’utilisateur', placeholder: 'jdupont' },
        { key: 'password', label: 'Mot de passe', type: 'password' },
        { key: 'confirm', label: 'Confirmer le mot de passe', type: 'password' },
        {
          key: 'mustChange',
          label: 'L’utilisateur doit changer le mot de passe à la prochaine ouverture de session',
          type: 'checkbox',
          initial: true
        },
        { key: 'disabled', label: 'Le compte est désactivé', type: 'checkbox' }
      ],
      submit: (v) => {
        if (v['password'] !== v['confirm']) {
          useUiStore.getState().notify('error', 'Les mots de passe ne correspondent pas.')
          return false
        }
        const name = `${String(v['given'])} ${String(v['surname'])}`.trim() || String(v['sam'])
        const result = runAction((l) =>
          addUser(l, domain.name, {
            name,
            sam: String(v['sam']),
            givenName: String(v['given']),
            surname: String(v['surname']),
            upn: v['sam'] ? `${String(v['sam'])}@${domain.name}` : '',
            path: containerId === null ? undefined : path,
            password: String(v['password']),
            enabled: v['disabled'] !== true,
            mustChangePassword: v['mustChange'] === true
          })
        )
        if (result?.passwordError)
          useUiStore.getState().showModal({
            title: 'Services de domaine Active Directory',
            message: `Le mot de passe n’a pas pu être défini : ${result.passwordError}\nL’objet « ${name} » a été créé mais le compte est désactivé.`
          })
        return ok(result)
      }
    },
    group: {
      title: `Nouvel objet - Groupe (dans ${path})`,
      fields: [
        { key: 'name', label: 'Nom du groupe' },
        {
          key: 'scope',
          label: 'Étendue du groupe',
          type: 'select',
          options: [
            { value: 'Global', label: 'Globale' },
            { value: 'DomainLocal', label: 'Domaine local' },
            { value: 'Universal', label: 'Universelle' }
          ]
        },
        {
          key: 'category',
          label: 'Type de groupe',
          type: 'select',
          options: [
            { value: 'Security', label: 'Sécurité' },
            { value: 'Distribution', label: 'Distribution' }
          ]
        }
      ],
      submit: (v) =>
        ok(
          runAction((l) =>
            addGroup(l, domain.name, {
              name: String(v['name']),
              scope: String(v['scope']) as 'Global',
              category: String(v['category']) as 'Security',
              path: containerId === null ? undefined : path
            })
          )
        )
    },
    password: {
      title: `Réinitialiser le mot de passe de ${current?.obj.name ?? ''}`,
      fields: [
        { key: 'password', label: 'Nouveau mot de passe', type: 'password' },
        { key: 'confirm', label: 'Confirmer le mot de passe', type: 'password' },
        {
          key: 'mustChange',
          label: 'L’utilisateur doit changer le mot de passe à la prochaine ouverture de session',
          type: 'checkbox',
          initial: true
        }
      ],
      submit: (v) => {
        if (!current) return false
        if (v['password'] !== v['confirm']) {
          useUiStore.getState().notify('error', 'Les mots de passe ne correspondent pas.')
          return false
        }
        return ok(
          runAction(
            (l) =>
              resetPassword(
                l,
                domain.name,
                objectDn(domain, current),
                String(v['password']),
                v['mustChange'] === true
              ),
            { success: 'Le mot de passe a été modifié.' }
          )
        )
      }
    },
    member: {
      title: `Ajouter un membre à ${current?.obj.name ?? ''}`,
      fields: [{ key: 'member', label: 'Objet', type: 'select', options: principalOptions }],
      submit: (v) =>
        !!current &&
        ok(
          runAction((l) => addGroupMembers(l, domain.name, objectDn(domain, current), [String(v['member'])]))
        )
    },
    addToGroup: {
      title: `Ajouter ${current?.obj.name ?? ''} à un groupe`,
      fields: [{ key: 'group', label: 'Groupe', type: 'select', options: groupOptions }],
      submit: (v) =>
        !!current &&
        ok(
          runAction((l) => addGroupMembers(l, domain.name, String(v['group']), [objectDn(domain, current)]), {
            success: 'Ajouté au groupe.'
          })
        )
    },
    move: {
      title: `Déplacer ${current?.obj.name ?? ''}`,
      fields: [
        {
          key: 'target',
          label: 'Déplacer l’objet vers le conteneur',
          type: 'select',
          options: containerOptions
        }
      ],
      submit: (v) =>
        !!current && ok(runAction((l) => moveObject(l, domain.name, current.obj.id, String(v['target']))))
    }
  }

  const actions = (
    <>
      <MmcAction onClick={guard(() => setDialog('ou'))} testId="aduc-new-ou">
        Nouvelle unité d’organisation…
      </MmcAction>
      {containerId !== null && (
        <>
          <MmcAction onClick={guard(() => setDialog('user'))} testId="aduc-new-user">
            Nouvel utilisateur…
          </MmcAction>
          <MmcAction onClick={guard(() => setDialog('group'))} testId="aduc-new-group">
            Nouveau groupe…
          </MmcAction>
        </>
      )}
      {current && current.kind === 'user' && (
        <>
          <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] font-semibold text-slate-400 uppercase">
            {current.obj.name}
          </div>
          <MmcAction
            onClick={guard(() =>
              runAction((l) => setAccountEnabled(l, domain.name, current.obj.sam, !current.obj.enabled))
            )}
          >
            {current.obj.enabled ? 'Désactiver le compte' : 'Activer le compte'}
          </MmcAction>
          <MmcAction onClick={guard(() => setDialog('password'))}>Réinitialiser le mot de passe…</MmcAction>
          <MmcAction onClick={guard(() => setDialog('addToGroup'))}>Ajouter à un groupe…</MmcAction>
        </>
      )}
      {current && current.kind === 'group' && (
        <>
          <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] font-semibold text-slate-400 uppercase">
            {current.obj.name}
          </div>
          <MmcAction onClick={guard(() => setDialog('member'))} testId="aduc-add-member">
            Ajouter un membre…
          </MmcAction>
        </>
      )}
      {current && !(current.kind !== 'computer' && current.obj.builtin) && (
        <>
          <MmcAction onClick={guard(() => setDialog('move'))}>Déplacer…</MmcAction>
          <MmcAction
            danger
            onClick={guard(() => {
              if (runAction((l) => removeObject(l, domain.name, current.obj.id, true)) !== undefined)
                setObjectId(null)
            })}
          >
            Supprimer
          </MmcAction>
        </>
      )}
    </>
  )

  const d = dialog ? dialogs[dialog] : null
  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={selected}
        onSelect={(id) => {
          setSelected(id)
          setObjectId(null)
        }}
        actions={actions}
        testId="aduc-console"
      >
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MmcTable
              testId="aduc-objects"
              columns={['Nom', 'Type', 'Description']}
              empty="Il n’y a aucun élément à afficher dans cet affichage."
              rows={objects.map((o) => {
                const Icon = iconOf(o)
                return [
                  <button
                    key="n"
                    type="button"
                    className={`flex items-center gap-1.5 text-left ${objectId === o.obj.id ? 'font-semibold text-sky-700' : ''}`}
                    onClick={() => setObjectId(o.obj.id)}
                    onDoubleClick={() => o.kind === 'container' && setSelected(o.obj.id)}
                    data-testid={`aduc-obj-${o.obj.name}`}
                  >
                    <Icon
                      size={13}
                      className={o.kind === 'user' && !o.obj.enabled ? 'text-red-500' : 'text-slate-500'}
                    />{' '}
                    {o.obj.name}
                  </button>,
                  typeLabel(o),
                  o.kind === 'computer' ? '' : o.obj.description
                ]
              })}
            />
          </div>
          {current && (
            <ObjectDetails
              domain={domain}
              object={current}
              onRemoveMember={(m) =>
                guard(() =>
                  runAction((l) => removeGroupMembers(l, domain.name, objectDn(domain, current), [m]))
                )()
              }
            />
          )}
        </div>
      </Mmc>
      {d && (
        <FormDialog
          title={d.title}
          fields={d.fields}
          onSubmit={d.submit}
          onClose={() => setDialog(null)}
          testId="aduc-dialog"
        />
      )}
    </div>
  )
}

function ObjectDetails({
  domain,
  object,
  onRemoveMember
}: {
  domain: Domain
  object: AdObject
  onRemoveMember: (dn: string) => void
}) {
  const memberOf = domain.groups.filter((g) => g.members.includes(object.obj.id))
  return (
    <div
      className="max-h-48 overflow-y-auto border-t border-slate-200 bg-slate-50 p-3 text-xs"
      data-testid="aduc-details"
    >
      <div className="selectable mb-1 font-mono text-[11px] text-slate-500">{objectDn(domain, object)}</div>
      {object.kind === 'user' && (
        <p className="mb-1">
          Ouverture de session :{' '}
          <b>
            {domain.netbios}\{object.obj.sam}
          </b>{' '}
          — compte {object.obj.enabled ? 'activé' : 'désactivé'}
          {object.obj.mustChangePassword ? ' — changement de mot de passe imposé' : ''}
        </p>
      )}
      {object.kind === 'group' && (
        <div className="mb-1">
          <b>Membres :</b>{' '}
          {object.obj.members.length === 0
            ? 'aucun'
            : object.obj.members.map((id) => {
                const m = allObjects(domain).find((o) => o.obj.id === id)
                return m ? (
                  <span
                    key={id}
                    className="mr-1 inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 shadow-sm"
                  >
                    {m.obj.name}
                    <button
                      type="button"
                      className="text-red-500"
                      title="Retirer"
                      onClick={() => onRemoveMember(objectDn(domain, m))}
                    >
                      ×
                    </button>
                  </span>
                ) : null
              })}
        </div>
      )}
      {object.kind !== 'container' && (
        <p>
          <b>Membre de :</b> {memberOf.length === 0 ? 'aucun groupe' : memberOf.map((g) => g.name).join(', ')}
        </p>
      )}
    </div>
  )
}
