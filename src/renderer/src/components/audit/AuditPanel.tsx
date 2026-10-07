/**
 * Onglet Audit : score de sécurité du lab (sur 100) et recommandations classées par gravité,
 * avec les objets concernés et la correction suggérée. L'analyse suit l'état du lab en direct ;
 * comparaison avec l'état au chargement (départ du lab) et export du rapport en PDF.
 */
import { useMemo } from 'react'
import { FileDown, ShieldAlert, ShieldCheck } from 'lucide-react'
import { auditLab, compareAudits, type AuditSeverity } from '@engine/index'
import { exportAuditReport } from '../../lib/auditReport'
import { useLabStore } from '../../store/lab'
import { Button } from '../common/ui'

const SEVERITY_CLASS: Record<AuditSeverity, string> = {
  critique: 'bg-danger text-on-accent',
  élevée: 'bg-danger-soft text-danger',
  moyenne: 'bg-warn-soft text-warn',
  faible: 'bg-info-soft text-info'
}

const scoreClass = (score: number) => (score >= 80 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-danger')

export function AuditPanel() {
  const lab = useLabStore((s) => s.lab)
  const loadedLab = useLabStore((s) => s.loadedLab)
  const report = useMemo(() => auditLab(lab), [lab])
  const baseline = useMemo(() => auditLab(loadedLab), [loadedLab])
  const corrected = useMemo(
    () => compareAudits(baseline, report).filter((c) => c.corrected).length,
    [baseline, report]
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="audit-panel">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        {report.recommendations.length === 0 ? (
          <ShieldCheck size={28} className="text-ok" />
        ) : (
          <ShieldAlert size={28} className={scoreClass(report.score)} />
        )}
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
            Score de sécurité
          </div>
          <div className={`text-2xl font-semibold ${scoreClass(report.score)}`} data-testid="audit-score">
            {report.score}
            <span className="text-sm text-fg-subtle"> / 100</span>
          </div>
          <div className="text-[11px] text-fg-muted" data-testid="audit-baseline">
            Au chargement : {baseline.score} / 100 · {corrected} recommandation(s) corrigée(s)
          </div>
        </div>
        <Button
          onClick={() => void exportAuditReport()}
          className="ml-auto"
          title="Exporter le rapport d’audit en PDF"
          data-testid="audit-export"
        >
          <FileDown size={14} /> PDF
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {report.recommendations.length === 0 ? (
          <p className="text-xs text-fg-muted">
            Aucune recommandation : toutes les règles de l’audit sont respectées.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {report.recommendations.map((r) => (
              <li
                key={r.rule}
                className="rounded-md border border-line bg-surface p-3"
                data-testid={`audit-${r.rule}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASS[r.severity]}`}
                  >
                    {r.severity}
                  </span>
                  <span className="text-xs font-semibold text-fg">{r.title}</span>
                </div>
                <ul className="mb-2 flex flex-col gap-0.5">
                  {r.findings.map((f) => (
                    <li key={f.object} className="text-[11px] text-fg-muted">
                      <span className="font-mono text-fg">{f.object}</span> — {f.detail}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-fg-muted">
                  <span className="font-semibold text-fg">Correction : </span>
                  {r.fix}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] text-fg-subtle">
          {report.passed.length} règle(s) respectée(s). Chaque règle enfreinte retire des points selon sa
          gravité (critique 25, élevée 15, moyenne 10, faible 5).
        </p>
      </div>
    </div>
  )
}
