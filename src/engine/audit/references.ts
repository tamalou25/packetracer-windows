/**
 * Référentiels de l'audit : recommandations du guide d'hygiène informatique de l'ANSSI (42 mesures,
 * v2 2017) et mesures (safeguards) des CIS Controls v8. Chaque règle de l'audit cite les
 * recommandations qu'elle vérifie ; une recommandation est « cochée » quand toutes ses règles sont
 * respectées. `verified` : numéro et intitulé confirmés par une source ; sinon à vérifier
 * (docs/fidelite.md, série C).
 */
import type { AuditReport } from './audit'
import type { AuditRule } from './types'

export type AuditFramework = 'ANSSI' | 'CIS'

export interface AuditReference {
  framework: AuditFramework
  /** Numéro de la mesure (« 10 », « 5.2 »). */
  id: string
  title: string
  verified: boolean
}

const anssi = (id: string, title: string, verified: boolean): AuditReference => ({
  framework: 'ANSSI',
  id,
  title,
  verified
})
const cis = (id: string, title: string): AuditReference => ({ framework: 'CIS', id, title, verified: true })

/** Recommandations citées par les règles (clé : « anssi-10 », « cis-5.2 »). */
export const AUDIT_REFERENCES = {
  'anssi-5': anssi(
    '5',
    'Disposer d’un inventaire exhaustif des comptes privilégiés et le maintenir à jour',
    true
  ),
  'anssi-6': anssi(
    '6',
    'Organiser les procédures d’arrivée, de départ et de changement de fonction des utilisateurs',
    false
  ),
  'anssi-7': anssi(
    '7',
    'Autoriser la connexion au réseau de l’entité aux seuls équipements maîtrisés',
    false
  ),
  'anssi-9': anssi(
    '9',
    'Attribuer les bons droits sur les ressources sensibles du système d’information',
    false
  ),
  'anssi-10': anssi(
    '10',
    'Définir et vérifier des règles de choix et de dimensionnement des mots de passe',
    true
  ),
  'anssi-17': anssi('17', 'Activer et configurer le pare-feu local des postes de travail', true),
  'anssi-19': anssi('19', 'Segmenter le réseau et mettre en place un cloisonnement entre ces zones', false),
  'anssi-21': anssi('21', 'Utiliser des protocoles réseaux sécurisés dès qu’ils existent', false),
  'cis-3.3': cis('3.3', 'Configure Data Access Control Lists'),
  'cis-4.4': cis('4.4', 'Implement and Manage a Firewall on Servers'),
  'cis-4.5': cis('4.5', 'Implement and Manage a Firewall on End-User Devices'),
  'cis-4.8': cis('4.8', 'Uninstall or Disable Unnecessary Services on Enterprise Assets and Software'),
  'cis-5.2': cis('5.2', 'Use Unique Passwords'),
  'cis-5.3': cis('5.3', 'Disable Dormant Accounts'),
  'cis-5.4': cis('5.4', 'Restrict Administrator Privileges to Dedicated Administrator Accounts'),
  'cis-12.2': cis('12.2', 'Establish and Maintain a Secure Network Architecture'),
  'cis-13.9': cis('13.9', 'Deploy Port-Level Access Control')
} satisfies Record<string, AuditReference>

export type AuditReferenceKey = keyof typeof AUDIT_REFERENCES

/** Libellé court : « ANSSI 10 », « CIS 5.2 ». */
export const referenceLabel = (ref: AuditReference): string => `${ref.framework} ${ref.id}`

/** Références d'une règle, dans l'ordre déclaré. */
export function ruleReferences(rule: Pick<AuditRule, 'refs'>): AuditReference[] {
  return (rule.refs ?? []).map((key) => AUDIT_REFERENCES[key])
}

/** État d'une recommandation de référentiel au regard d'un audit. */
export interface ReferenceStatus extends AuditReference {
  key: AuditReferenceKey
  /** Toutes les règles qui la citent sont respectées. */
  satisfied: boolean
  /** Règles qui la citent. */
  rules: string[]
}

/** Recommandations citées par les règles données, cochées si toutes leurs règles sont respectées. */
export function referenceStatuses(report: AuditReport, rules: AuditRule[]): ReferenceStatus[] {
  const failing = new Set(report.recommendations.map((r) => r.rule))
  const byKey = new Map<AuditReferenceKey, string[]>()
  for (const rule of rules)
    for (const key of rule.refs ?? []) byKey.set(key, [...(byKey.get(key) ?? []), rule.id])
  const order = Object.keys(AUDIT_REFERENCES) as AuditReferenceKey[]
  return [...byKey.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([key, ids]) => ({
      ...AUDIT_REFERENCES[key],
      key,
      rules: ids,
      satisfied: ids.every((id) => !failing.has(id))
    }))
}
