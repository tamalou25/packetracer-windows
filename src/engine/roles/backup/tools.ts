/**
 * wbadmin (sous-ensemble) : sauvegarde unique, planification, versions, récupération de fichiers.
 */
import type { ExecContext } from '../../shell/context'
import type { ToolDef } from '../../shell/tools/types'
import { RECOVERY_OPTIONS, recoverItem, setBackupPolicy, startBackup, type RecoveryOption } from './actions'
import { backupOf } from './state'
import { formatShortDate } from '../../core/clock'

/** Options « -nom:valeur » et « -drapeau ». */
function options(args: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const a of args) {
    const m = /^[-/]([a-z]+)(?::(.*))?$/i.exec(a)
    if (m) map.set((m[1] as string).toLowerCase(), m[2] ?? '')
  }
  return map
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x)

function fail(ctx: ExecContext, message: string): void {
  ctx.writeLines([`ERREUR - ${message}`], 'error')
}

export const wbadminTool: ToolDef = {
  name: 'wbadmin',
  synopsis: 'Sauvegarde et récupération (Sauvegarde Windows Server).',
  switches: [
    'start',
    'enable',
    'get',
    'backup',
    'recovery',
    'versions',
    '-backupTarget:',
    '-include:',
    '-systemState',
    '-quiet'
  ],
  available: (ctx) => {
    const d = ctx.device
    return d.kind === 'server' && d.host.features.includes('Windows-Server-Backup')
  },
  run(ctx, args) {
    const [verb = '', noun = '', ...rest] = args.map((a) => a.trim())
    const opts = options(rest)
    ctx.writeLines([
      'wbadmin 1.0 - Outil en ligne de commande de sauvegarde',
      '(C) Copyright Microsoft Corporation. Tous droits réservés.',
      ''
    ])
    const action = `${verb} ${noun}`.toLowerCase()
    if (action === 'start backup') {
      const r = startBackup(ctx.state, ctx.deviceId, {
        items: list(opts.get('include')),
        systemState: opts.has('systemstate') || opts.has('allcritical'),
        target: opts.get('backuptarget') ?? ''
      })
      if (!r.ok) return fail(ctx, r.error.message)
      ctx.apply(r)
      ctx.writeLines([
        `Récupération des informations sur le volume...`,
        `La sauvegarde sera enregistrée sur ${opts.get('backuptarget')}.`,
        `Opération de sauvegarde réussie.`,
        `Identificateur de version : ${r.value}`
      ])
      return
    }
    if (action === 'enable backup') {
      const r = setBackupPolicy(ctx.state, ctx.deviceId, {
        items: list(opts.get('include')),
        systemState: opts.has('systemstate') || opts.has('allcritical'),
        target: opts.get('addtarget') ?? '',
        time: opts.get('schedule') ?? ''
      })
      if (!r.ok) return fail(ctx, r.error.message)
      ctx.apply(r)
      ctx.write(`La sauvegarde planifiée est activée (tous les jours à ${opts.get('schedule')}).`)
      return
    }
    if (action === 'get versions') {
      const sets = backupOf(ctx.device)?.sets ?? []
      if (sets.length === 0) return ctx.write('Aucune sauvegarde n’a été trouvée.')
      for (const s of sets)
        ctx.writeLines([
          `Heure de la sauvegarde : ${formatShortDate(s.time)}`,
          `Cible de la sauvegarde : ${s.target}`,
          `Identificateur de version : ${s.version}`,
          `Peut récupérer : Fichier(s)${s.systemState ? ', État du système' : ''}`,
          ''
        ])
      return
    }
    if (action === 'start recovery') {
      const overwrite = opts.get('overwrite') ?? 'CreateCopy'
      const option = RECOVERY_OPTIONS.find((o) => o.toLowerCase() === overwrite.toLowerCase())
      if (!option) return fail(ctx, `Valeur de -overwrite non valide : ${overwrite}.`)
      const items = list(opts.get('items'))
      let total = 0
      for (const item of items) {
        const r = recoverItem(
          ctx.state,
          ctx.deviceId,
          opts.get('version') ?? '',
          item,
          option as RecoveryOption
        )
        if (!r.ok) return fail(ctx, r.error.message)
        ctx.apply(r)
        total += r.value
      }
      ctx.writeLines([`Opération de récupération terminée.`, `${total} élément(s) récupéré(s).`])
      return
    }
    ctx.writeLines([
      'Commandes prises en charge :',
      '  wbadmin start backup -backupTarget:E: -include:C:\\Dossier [-systemState] -quiet',
      '  wbadmin enable backup -addTarget:E: -schedule:21:00 -include:C:\\Dossier [-systemState] -quiet',
      '  wbadmin get versions',
      '  wbadmin start recovery -version:jj/mm/aaaa-hh:mm -itemType:File -items:C:\\Dossier\\fichier -overwrite:CreateCopy|Overwrite|Skip -quiet'
    ])
  }
}
