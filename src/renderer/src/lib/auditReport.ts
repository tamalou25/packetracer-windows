/**
 * Rapport d'audit : contenu construit par le moteur (référence = état au chargement du document,
 * c'est-à-dire le départ du lab) puis export PDF par le process principal.
 */
import { auditLab, buildAuditReport, type AuditReportDocument } from '@engine/index'
import { documentName } from './document'
import { t } from './i18n'
import { useLabStore } from '../store/lab'
import { useLabsStore } from '../store/labs'
import { useUiStore } from '../store/ui'

/** Nom affiché dans le rapport : titre du lab en cours, sinon nom du document. */
export function reportLabName(): string {
  const active = useLabsStore.getState().active
  return active ? active.title : documentName().replace(/\.slab$/i, '')
}

export function currentAuditReport(date: Date = new Date()): AuditReportDocument {
  const { lab, loadedLab } = useLabStore.getState()
  return buildAuditReport({
    lab: reportLabName(),
    date: date.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }),
    current: auditLab(lab),
    baseline: auditLab(loadedLab)
  })
}

/** Dialogue « Enregistrer sous » puis PDF ; notification du chemin ou de l'erreur. */
export async function exportAuditReport(): Promise<void> {
  const res = await window.serverlab.exportAuditPdf(currentAuditReport())
  const ui = useUiStore.getState()
  if (res.ok) ui.notify('success', t('audit.exported', { path: res.value }))
  else if (!res.canceled)
    ui.showModal({ title: t('audit.exportFailed'), message: res.error ?? t('error.unknown') })
}
