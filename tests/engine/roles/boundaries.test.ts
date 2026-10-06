/**
 * Frontière cœur / rôles : un nouveau rôle ne doit pas toucher au cœur du moteur. Seul le registre
 * (`roles/registry.ts`) connaît la liste des rôles ; les autres fichiers du cœur qui importent un
 * rôle précis sont listés ici (fonctions client utilisées par le système de base, réexports).
 * Toute nouvelle dépendance du cœur envers un rôle fait échouer ce test : elle doit être justifiée.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { roleModules } from '@engine/index'

const ENGINE = join(__dirname, '../../../src/engine')

/** Fichiers .ts du moteur, chemins relatifs à src/engine (séparateur /). */
function engineFiles(dir = ENGINE): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return engineFiles(path)
    return path.endsWith('.ts') ? [relative(ENGINE, path).split('\\').join('/')] : []
  })
}

/** Dépendances actuelles du cœur envers un rôle précis (état de la 2.0.0). */
const ALLOWED_CORE_TO_ROLE = [
  'commands/catalog.ts', // types des adaptateurs (réexport)
  'commands/labels.ts', // libellés : nom d'étendue DHCP
  'index.ts', // API publique du moteur
  'serialization/migrations.ts', // migration 1 → 2 : GPO par défaut
  'services/system.ts', // redémarrage : inscription DNS du poste joint
  'shell/cmd/interpreter.ts', // cd (système de fichiers du serveur)
  'shell/filesystem.ts', // chemins, partages et jetons d'accès
  'shell/tools/net.ts' // ipconfig /renew, résolution de noms, whoami /groups
]

describe('frontière cœur / rôles', () => {
  const roleIds = roleModules().map((m) => m.id)
  const roleImport = new RegExp(`from '[./]*/?roles/(${roleIds.join('|')})(/|')`)

  it('seuls le registre et les dépendances connues importent un rôle précis', () => {
    const offenders = engineFiles()
      .filter((f) => !f.startsWith('roles/'))
      .filter((f) => roleImport.test(readFileSync(join(ENGINE, f), 'utf8')))
    expect(offenders.sort()).toEqual(ALLOWED_CORE_TO_ROLE)
  })

  it('aucun aiguillage sur l’identifiant d’un rôle dans le cœur', () => {
    const switchOnRole = new RegExp(`case '(${roleIds.join('|')})'`)
    const offenders = engineFiles()
      .filter((f) => !f.startsWith('roles/'))
      .filter((f) => switchOnRole.test(readFileSync(join(ENGINE, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
