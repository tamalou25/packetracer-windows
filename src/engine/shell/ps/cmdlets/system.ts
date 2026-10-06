/**
 * Cmdlets système : rôles et fonctionnalités, redémarrage, renommage.
 */
import { allFeatures, featureInfo, installFeatures, uninstallFeatures } from '../../../roles/features'
import { renameComputer, restartComputer } from '../../../services/system'
import { setPower } from '../../../topology/actions'
import { psError } from '../errors'
import type { CmdContext } from '../interpreter'
import type { CmdletDef } from '../registry'
import { flatten, psObject, psToString, wildcardToRegExp } from '../values'
import { onServer } from './helpers'

const featureNames = () => allFeatures().map((f) => f.name)

function featureResult(success: boolean, names: string[], restart = false) {
  return psObject(
    'FeatureOperationResult',
    {
      Success: success,
      'Restart Needed': restart ? 'Yes' : 'No',
      'Exit Code': names.length === 0 ? 'NoChangeNeeded' : 'Success',
      'Feature Result': `{${names.join(', ')}}`
    },
    { kind: 'table', props: ['Success', 'Restart Needed', 'Exit Code', 'Feature Result'] }
  )
}

function restartNow(ctx: CmdContext): void {
  ctx.apply(restartComputer(ctx.state, ctx.deviceId))
  ctx.write('Redémarrage de l’ordinateur…')
  ctx.exit = true
}

export const systemCmdlets: CmdletDef[] = [
  {
    name: 'Get-WindowsFeature',
    module: 'ServerManager',
    synopsis: 'Liste les rôles et fonctionnalités du serveur.',
    params: [{ name: 'Name', type: 'string[]', position: 0, complete: featureNames }],
    available: onServer,
    run(ctx, args) {
      const patterns = args['Name']
        ? flatten([args['Name']]).map((p) => wildcardToRegExp(psToString(p)))
        : null
      const installed = ctx.host.host.features
      const rows = allFeatures().filter((f) => !patterns || patterns.some((p) => p.test(f.name)))
      if (rows.length === 0) return []
      const width = Math.max(...rows.map((f) => f.displayName.length + (f.parent ? 4 : 0))) + 6
      const lines = [
        '',
        `${'Display Name'.padEnd(width)}${'Name'.padEnd(28)}Install State`,
        `${'------------'.padEnd(width)}${'----'.padEnd(28)}-------------`
      ]
      for (const f of rows) {
        const mark = installed.includes(f.name) ? '[X]' : '[ ]'
        const indent = f.parent ? '    ' : ''
        lines.push(
          `${`${indent}${mark} ${f.displayName}`.padEnd(width)}${f.name.padEnd(28)}${installed.includes(f.name) ? 'Installed' : 'Available'}`
        )
      }
      lines.push('')
      return lines
    }
  },
  {
    name: 'Install-WindowsFeature',
    aliases: ['Add-WindowsFeature'],
    module: 'ServerManager',
    synopsis: 'Installe des rôles ou fonctionnalités.',
    params: [
      { name: 'Name', type: 'string[]', position: 0, mandatory: true, complete: featureNames },
      { name: 'IncludeManagementTools', type: 'switch' },
      { name: 'IncludeAllSubFeature', type: 'switch' },
      { name: 'Restart', type: 'switch' }
    ],
    available: onServer,
    run(ctx, args) {
      const names = flatten([args['Name'] ?? []]).map(psToString)
      for (const n of names)
        if (!featureInfo(n))
          throw psError(
            `ArgumentNotValid : la fonctionnalité de rôle, de service de rôle ou de fonctionnalité est introuvable : « ${n} ». Le nom est introuvable.`,
            'InvalidArgument',
            'NameDoesNotExist',
            n
          )
      ctx.write('Début de l’installation…')
      const result = ctx.apply(
        installFeatures(ctx.state, ctx.deviceId, names, {
          includeManagementTools: args['IncludeManagementTools'] === true
        })
      )
      if (result.installed.some((f) => f.name === 'AD-Domain-Services'))
        ctx.warn(
          'Pour terminer, promouvez ce serveur en contrôleur de domaine (Install-ADDSForest ou Gestionnaire de serveur).'
        )
      return [
        featureResult(
          true,
          result.installed.map((f) => f.displayName)
        )
      ]
    }
  },
  {
    name: 'Uninstall-WindowsFeature',
    aliases: ['Remove-WindowsFeature'],
    module: 'ServerManager',
    synopsis: 'Désinstalle des rôles ou fonctionnalités.',
    params: [
      { name: 'Name', type: 'string[]', position: 0, mandatory: true, complete: featureNames },
      { name: 'Restart', type: 'switch' }
    ],
    available: onServer,
    run(ctx, args) {
      const names = flatten([args['Name'] ?? []]).map(psToString)
      const result = ctx.apply(uninstallFeatures(ctx.state, ctx.deviceId, names))
      return [
        featureResult(
          true,
          result.installed.map((f) => f.displayName)
        )
      ]
    }
  },
  {
    name: 'Restart-Computer',
    module: 'Management',
    synopsis: 'Redémarre l’ordinateur.',
    params: [{ name: 'Force', type: 'switch' }],
    run(ctx) {
      restartNow(ctx)
    }
  },
  {
    name: 'Stop-Computer',
    module: 'Management',
    synopsis: 'Arrête l’ordinateur.',
    params: [{ name: 'Force', type: 'switch' }],
    run(ctx) {
      ctx.write('Arrêt de l’ordinateur… (rallumez-le depuis son onglet Config ou le panneau Propriétés)')
      ctx.apply(setPower(ctx.state, ctx.deviceId, false))
      ctx.exit = true
    }
  },
  {
    name: 'Rename-Computer',
    module: 'Management',
    synopsis: 'Renomme l’ordinateur (effectif après redémarrage).',
    params: [
      { name: 'NewName', type: 'string', position: 0, mandatory: true },
      { name: 'Restart', type: 'switch' },
      { name: 'Force', type: 'switch' },
      { name: 'DomainCredential', type: 'credential' }
    ],
    run(ctx, args) {
      const name = psToString(args['NewName'])
      ctx.apply(renameComputer(ctx.state, ctx.deviceId, name))
      if (args['Restart'] === true) restartNow(ctx)
      else
        ctx.warn(
          `Les modifications seront prises en compte après le redémarrage de l’ordinateur ${ctx.host.name}.`
        )
    }
  }
]
