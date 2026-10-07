/**
 * Éditeur de labs : catalogue des critères déduit des schémas, construction d'un critère depuis
 * le formulaire, test sur le lab courant, définition complète (départ instantané) exportée puis
 * réimportée, indices progressifs.
 */
import { describe, expect, it } from 'vitest'
import {
  buildCheck,
  buildLabStart,
  checkLab,
  checkValues,
  command,
  createLabDefinition,
  criterionCatalog,
  criterionTypeInfo,
  criterionTypes,
  dispatch,
  draftFromLab,
  labIdFromTitle,
  labReferences,
  parseLabText,
  serializeLab,
  testCheck,
  type LabDraft,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

function draft(overrides: Partial<LabDraft> = {}): LabDraft {
  const check = buildCheck('featureInstalled', { device: 'SRV1', feature: 'Web-Server' })
  if (!check.ok) throw new Error(check.message)
  return {
    title: 'Mon lab IIS',
    difficulty: 'Débutant',
    duration: '15 min',
    summary: 'Installer le rôle IIS.',
    statement: '## Objectif\n\nInstallez le rôle **IIS** sur SRV1.',
    criteria: [
      {
        label: 'Le rôle IIS est installé sur SRV1',
        hints: [
          'Le Gestionnaire de serveur ajoute des rôles.',
          'Gérer › Ajouter des rôles et fonctionnalités.'
        ],
        check: check.check
      }
    ],
    ...overrides
  }
}

describe('Catalogue des critères', () => {
  it('chaque type a un libellé et des champs décrits (aucun libellé brut)', () => {
    const catalog = criterionCatalog()
    expect(catalog.length).toBe(criterionTypes().size)
    for (const t of catalog) {
      expect(t.label.length, t.type).toBeGreaterThan(3)
      for (const f of t.fields) expect(f.label, `${t.type}.${f.key}`).not.toBe(f.key)
    }
  })

  it('champs : obligatoire, facultatif, valeur par défaut, énumération, liste, référence', () => {
    const ping = criterionTypeInfo('ping')!
    expect(ping.fields.find((f) => f.key === 'from')).toMatchObject({
      kind: 'text',
      optional: false,
      reference: 'device'
    })
    expect(ping.fields.find((f) => f.key === 'success')).toMatchObject({
      kind: 'boolean',
      optional: true,
      defaultValue: true
    })
    const profile = criterionTypeInfo('firewallProfile')!.fields.find((f) => f.key === 'profile')
    expect(profile).toMatchObject({ kind: 'enum', options: ['Domain', 'Private', 'Public'] })
    const allow = criterionTypeInfo('effectiveAccess')!.fields.find((f) => f.key === 'allow')
    expect(allow?.kind).toBe('enumList')
    expect(criterionTypeInfo('siteLink')!.fields.find((f) => f.key === 'sites')?.kind).toBe('list')
  })

  it('suggestions tirées du lab courant', () => {
    const refs = labReferences(buildReferenceLab())
    expect(refs.device).toEqual(expect.arrayContaining(['SRV1', 'PC1']))
    expect(refs.domain).toEqual(['lab.local'])
    expect(refs.account).toContain('jdupont')
    expect(refs.group).toContain('GG_Compta')
    expect(refs.gpo).toContain('Default Domain Policy')
  })
})

describe('Construction d’un critère', () => {
  it('valeurs du formulaire converties (nombre, booléen, liste) et validées', () => {
    const r = buildCheck('interfaceIp', { device: 'PC1', address: '192.168.1.10', prefixLength: '24' })
    expect(r).toEqual({
      ok: true,
      check: { type: 'interfaceIp', device: 'PC1', address: '192.168.1.10', prefixLength: 24 }
    })
    const access = buildCheck('effectiveAccess', {
      server: 'SRV1',
      path: 'D:\\Compta',
      account: 'jdupont',
      allow: ['read', 'write']
    })
    expect(access.ok && access.check['allow']).toEqual(['read', 'write'])
    const link = buildCheck('siteLink', { name: 'Paris-Lyon', sites: 'Paris, Lyon' })
    expect(link.ok && link.check['sites']).toEqual(['Paris', 'Lyon'])
    // Champ facultatif vide : valeur par défaut du type
    const ping = buildCheck('ping', { from: 'PC1', to: 'SRV1', success: undefined })
    expect(ping.ok && ping.check['success']).toBe(true)
  })

  it('erreurs en français : champ obligatoire, nombre, énumération, type inconnu', () => {
    expect(buildCheck('ping', { from: 'PC1' })).toEqual({
      ok: false,
      message: 'Le champ « Vers (nom ou adresse) » est obligatoire.'
    })
    expect(buildCheck('auditScore', { min: 'beaucoup' })).toEqual({
      ok: false,
      message: '« Score minimal » doit être un nombre.'
    })
    expect(buildCheck('auditScore', { min: '150' })).toEqual({
      ok: false,
      message: 'Valeur invalide pour « Score minimal ».'
    })
    expect(buildCheck('firewallProfile', { device: 'SRV1', profile: 'Bureau' }).ok).toBe(false)
    expect(buildCheck('inconnu', {}).ok).toBe(false)
  })

  it('aller-retour formulaire ↔ critère', () => {
    const r = buildCheck('ping', { from: 'PC1', to: '192.168.1.1', success: false })
    if (!r.ok) throw new Error(r.message)
    expect(buildCheck('ping', checkValues(r.check))).toEqual(r)
  })

  it('test immédiat sur le lab courant', () => {
    let s = buildReferenceLab()
    const r = buildCheck('featureInstalled', { device: 'SRV1', feature: 'Web-Server' })
    if (!r.ok) throw new Error(r.message)
    expect(testCheck(s, r.check)).toBe(false)
    const installed = dispatch(
      s,
      command('system.installFeatures', id(s, 'SRV1'), ['Web-Server'], { includeManagementTools: true })
    )
    if (!installed.ok) throw new Error(installed.error.message)
    s = installed.state
    expect(testCheck(s, r.check)).toBe(true)
  })
})

describe('Définition de lab', () => {
  const options = { appVersion: '2.4.0', savedAt: '2026-10-07T12:00:00.000Z' }

  it('départ = instantané du lab courant ; export puis import identiques', () => {
    const start = buildReferenceLab()
    const r = createLabDefinition(draft(), start, options)
    if (!r.ok) throw new Error(r.message)
    expect(r.lab.id).toBe('custom-mon-lab-iis')
    expect(r.lab.criteria[0]).toMatchObject({
      id: 'c1',
      hint: 'Le Gestionnaire de serveur ajoute des rôles.',
      hints: ['Gérer › Ajouter des rôles et fonctionnalités.']
    })
    const text = serializeLab(r.lab)
    const imported = parseLabText(text)
    if (!imported.ok) throw new Error(imported.message)
    expect(imported.lab).toEqual(r.lab)
    // Le départ reconstruit est exactement le lab de l'auteur
    expect(buildLabStart(imported.lab.start)).toEqual(start)
    expect(checkLab(buildLabStart(imported.lab.start), imported.lab).passed).toBe(0)
    expect(draftFromLab(imported.lab)).toEqual(draft())
  })

  it('brouillon incomplet : message explicite', () => {
    const start = buildReferenceLab()
    expect(createLabDefinition(draft({ title: ' ' }), start, options)).toEqual({
      ok: false,
      message: 'Donnez un titre au lab.'
    })
    expect(createLabDefinition(draft({ criteria: [] }), start, options)).toEqual({
      ok: false,
      message: 'Ajoutez au moins un critère.'
    })
    const noHint = draft()
    noHint.criteria[0]!.hints = ['  ']
    expect(createLabDefinition(noHint, start, options)).toEqual({
      ok: false,
      message: 'Critère 1 : rédigez au moins un indice.'
    })
  })

  it('import : instantané invalide refusé à la construction du départ', () => {
    const r = createLabDefinition(draft(), buildReferenceLab(), options)
    if (!r.ok) throw new Error(r.message)
    const broken = JSON.parse(serializeLab(r.lab)) as { start: { snapshot: Record<string, unknown> } }
    broken.start.snapshot['app'] = 'Autre'
    const parsed = parseLabText(JSON.stringify(broken))
    if (!parsed.ok) throw new Error(parsed.message)
    expect(() => buildLabStart(parsed.lab.start)).toThrow('Topologie de départ invalide')
  })

  it('identifiant tiré du titre', () => {
    expect(labIdFromTitle('Sécurité : réseau & AD !')).toBe('custom-securite-reseau-ad')
    expect(labIdFromTitle('???')).toBe('custom-lab')
  })
})
