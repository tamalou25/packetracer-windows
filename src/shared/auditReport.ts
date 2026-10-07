/**
 * Rapport d'audit exporté en PDF : schéma du contenu reçu du renderer (validé par le main) et
 * mise en page HTML imprimée par le main (printToPDF). Tout texte du lab est échappé ; la page
 * n'exécute aucun script et ne charge aucune ressource externe (CSP).
 */
import { z } from 'zod'

/** Bornes du contenu accepté (protection contre un message aberrant du renderer). */
const MAX_TEXT = 1000
const MAX_ITEMS = 100
const MAX_FINDINGS = 200

const text = z.string().max(MAX_TEXT)

export const AuditReportSchema = z.object({
  lab: z.string().min(1).max(200),
  date: z.string().min(1).max(100),
  score: z.number().int().min(0).max(100),
  baselineScore: z.number().int().min(0).max(100).nullable(),
  items: z
    .array(
      z.object({
        rule: z.string().max(100),
        title: text,
        severity: z.enum(['critique', 'élevée', 'moyenne', 'faible']),
        fix: text,
        status: z.enum(['corrigé', 'non corrigé']),
        added: z.boolean(),
        findings: z.array(z.object({ object: text, detail: text })).max(MAX_FINDINGS)
      })
    )
    .max(MAX_ITEMS),
  corrected: z.number().int().min(0),
  remaining: z.number().int().min(0),
  passed: z.number().int().min(0)
})

export type AuditReportData = z.infer<typeof AuditReportSchema>

/** Contenu validé, ou null s'il ne respecte pas le schéma. */
export function parseAuditReport(value: unknown): AuditReportData | null {
  const parsed = AuditReportSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Nom de fichier proposé : caractères interdits par les systèmes de fichiers retirés. */
export function auditReportFileName(lab: unknown): string {
  // Caractères réservés et caractères de contrôle (code < 32) remplacés par une espace
  const name =
    typeof lab === 'string'
      ? Array.from(lab, (c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
          .join('')
          .trim()
      : ''
  return `Rapport d’audit - ${name.slice(0, 80) || 'Sans titre'}.pdf`
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)
}

const SEVERITY_COLORS: Record<AuditReportData['items'][number]['severity'], string> = {
  critique: '#b91c1c',
  élevée: '#c2410c',
  moyenne: '#a16207',
  faible: '#1d4ed8'
}

function itemHtml(item: AuditReportData['items'][number]): string {
  const corrected = item.status === 'corrigé'
  const findings = item.findings
    .map((f) => `<li><span class="obj">${escapeHtml(f.object)}</span> — ${escapeHtml(f.detail)}</li>`)
    .join('')
  return `<section class="item${corrected ? ' done' : ''}">
<div class="head"><span class="sev" style="background:${SEVERITY_COLORS[item.severity]}">${escapeHtml(item.severity)}</span>
<span class="title">${escapeHtml(item.title)}</span>
<span class="status ${corrected ? 'ok' : 'ko'}">${corrected ? 'Corrigé' : 'Non corrigé'}</span>${item.added ? '<span class="new">nouvelle</span>' : ''}</div>
${findings ? `<ul>${findings}</ul>` : ''}
<p class="fix"><b>Correction :</b> ${escapeHtml(item.fix)}</p>
</section>`
}

/** Document HTML autonome du rapport (A4, sans script ni ressource externe). */
export function renderAuditReportHtml(report: AuditReportData): string {
  const score = report.score
  const scoreColor = score >= 80 ? '#15803d' : score >= 50 ? '#a16207' : '#b91c1c'
  const baseline =
    report.baselineScore === null
      ? ''
      : ` <span class="muted">(référence : ${report.baselineScore} / 100)</span>`
  const body =
    report.items.length === 0
      ? '<p>Aucune recommandation : toutes les règles de l’audit sont respectées.</p>'
      : report.items.map(itemHtml).join('\n')
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Rapport d’audit de sécurité</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
body { font-family: Inter, "Segoe UI", Arial, sans-serif; font-size: 11px; color: #111827; margin: 0; }
h1 { font-size: 20px; margin: 0 0 4px; }
.meta { color: #4b5563; margin-bottom: 12px; }
.score { font-size: 28px; font-weight: 700; color: ${scoreColor}; }
.muted { color: #6b7280; font-size: 12px; font-weight: 400; }
.summary { margin: 4px 0 16px; color: #374151; }
.item { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px 10px; margin-bottom: 8px; page-break-inside: avoid; }
.item.done { background: #f9fafb; }
.head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.sev { color: #fff; border-radius: 3px; padding: 1px 6px; font-weight: 600; font-size: 10px; }
.title { font-weight: 600; flex: 1; }
.status { font-weight: 600; }
.status.ok { color: #15803d; }
.status.ko { color: #b91c1c; }
.new { border: 1px solid #9ca3af; border-radius: 3px; padding: 0 4px; color: #4b5563; font-size: 10px; }
ul { margin: 2px 0 4px 16px; padding: 0; }
.obj { font-family: "JetBrains Mono", Consolas, monospace; }
.fix { margin: 2px 0 0; color: #374151; }
footer { margin-top: 16px; color: #6b7280; font-size: 10px; }
</style>
</head>
<body>
<h1>Rapport d’audit de sécurité</h1>
<div class="meta">Lab : <b>${escapeHtml(report.lab)}</b> · ${escapeHtml(report.date)}</div>
<div class="score">${score} / 100${baseline}</div>
<p class="summary">${report.corrected} recommandation(s) corrigée(s), ${report.remaining} non corrigée(s), ${report.passed} règle(s) respectée(s).</p>
${body}
<footer>Généré par ServerLab — environnement simulé : aucune commande n’a été exécutée sur un vrai système.</footer>
</body>
</html>
`
}
